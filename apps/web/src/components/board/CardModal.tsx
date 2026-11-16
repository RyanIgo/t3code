import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";

import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  type CardCategory,
  type CardChatRef,
  type CardChatState,
  type CardStage,
  type CardTesting,
  type PlacedCard,
  CARD_CATEGORIES,
  CARD_STAGES,
  chatKey,
} from "./boardCards.logic";
import { addCard, removeCard, updateCard } from "./boardStore";

const TabsBy = Schema.Literals(["list", "category"]);
type TabsBy = typeof TabsBy.Type;

interface CardTab {
  readonly id: string;
  readonly label: string;
  readonly cards: ReadonlyArray<PlacedCard>;
}

const tabOf = (placed: PlacedCard, by: TabsBy): string =>
  by === "list" ? placed.stage : (placed.card.category ?? "none");

/** One tab per list or category that has cards, in board order. */
function buildTabs(pool: ReadonlyArray<PlacedCard>, by: TabsBy): CardTab[] {
  const groups =
    by === "list" ? CARD_STAGES : [...CARD_CATEGORIES, { id: "none", label: "No category" }];
  return groups.flatMap((group) => {
    const cards = pool.filter((entry) => tabOf(entry, by) === group.id);
    return cards.length > 0 ? [{ id: group.id, label: group.label, cards }] : [];
  });
}

const TESTING_OPTIONS: ReadonlyArray<{
  readonly id: CardTesting | "none";
  readonly label: string;
}> = [
  { id: "none", label: "Not tested" },
  { id: "passed", label: "Passed" },
  { id: "failed", label: "Failed" },
];

/**
 * Fleet fork: a card opened from the board. Its details sit beside its chat, live, so you can
 * answer the agent and step to the next card without leaving the board.
 */
export function CardModal(props: {
  readonly placed: PlacedCard;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly projects: ReadonlyArray<{ readonly projectKey: string; readonly displayName: string }>;
  readonly initiatives: ReadonlyArray<string>;
  /** The board's cards in board order; the window's tabs and previous / next cycle these. */
  readonly pool: ReadonlyArray<PlacedCard>;
  readonly onNavigate: (cardId: string) => void;
  readonly onClose: () => void;
}) {
  const { placed } = props;
  const card = placed.card;
  const [chatRef, setChatRef] = useState<CardChatRef | null>(card.chats[0] ?? null);
  const [mobilePane, setMobilePane] = useState<"chat" | "details">(
    card.chats.length > 0 ? "chat" : "details",
  );
  const shownChat =
    chatRef && card.chats.some((ref) => chatKey(ref) === chatKey(chatRef))
      ? chatRef
      : (card.chats[0] ?? null);
  const chatByKey = new Map(props.chats.map((chat) => [chatKey(chat), chat]));
  const [tabsBy, setTabsBy] = useLocalStorage("t3-fleet:card-tabs", "list" as TabsBy, TabsBy);
  const tabs = buildTabs(props.pool, tabsBy);
  const activeTab = tabs.find((tab) => tab.id === tabOf(placed, tabsBy)) ?? null;
  const sequence = activeTab?.cards.map((entry) => entry.card.id) ?? [];
  const index = sequence.indexOf(card.id);
  const previous = index > 0 ? sequence[index - 1] : undefined;
  const next = index !== -1 ? sequence[index + 1] : undefined;
  const tabIndex = activeTab ? tabs.indexOf(activeTab) : -1;
  const openTab = (tab: CardTab | undefined) => {
    // Land on what needs you first, else the tab's first card.
    const target = tab?.cards.find((entry) => entry.needsYou) ?? tab?.cards[0];
    if (target) props.onNavigate(target.card.id);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const step: Record<string, () => void> = {
      ArrowRight: () => next && props.onNavigate(next),
      ArrowLeft: () => previous && props.onNavigate(previous),
      ArrowDown: () => openTab(tabs[tabIndex + 1]),
      ArrowUp: () => openTab(tabs[tabIndex - 1]),
    };
    const action = step[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };
  const projectName =
    props.projects.find((project) => project.projectKey === card.projectKey)?.displayName ??
    "Unknown project";

  // A chat no card owns yet: make it a card the first time anything on it changes.
  const editableId = (): string => {
    if (!placed.loose) return card.id;
    const created = addCard({
      projectKey: card.projectKey,
      title: card.title,
      stage: placed.stage,
      order: card.order,
      chats: card.chats,
    });
    props.onNavigate(created.id);
    return created.id;
  };
  const change = (changes: Parameters<typeof updateCard>[1]) => updateCard(editableId(), changes);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup
        onKeyDown={onKeyDown}
        showCloseButton={false}
        className="flex h-[92dvh] flex-col sm:max-w-[min(96vw,96rem)]"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border py-2 ps-3 pe-3 sm:pe-36">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous card (Alt+←)"
            disabled={!previous}
            onClick={() => previous && props.onNavigate(previous)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {index === -1 ? "" : `${index + 1} of ${sequence.length}`}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next card (Alt+→)"
            disabled={!next}
            onClick={() => next && props.onNavigate(next)}
          >
            <ChevronRightIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle>
              <span className="block truncate text-sm">
                <span className="text-muted-foreground">{projectName} · </span>
                {card.title}
              </span>
            </DialogTitle>
          </div>
          <ToggleGroup
            aria-label="Show"
            className="sm:hidden"
            value={[mobilePane]}
            onValueChange={(value) => {
              if (value[0] === "chat" || value[0] === "details") setMobilePane(value[0]);
            }}
          >
            <Toggle value="chat">Chat</Toggle>
            <Toggle value="details">Card</Toggle>
          </ToggleGroup>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </header>
        <nav
          aria-label="Card groups"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5"
        >
          <ToggleGroup
            aria-label="Tabs by"
            className="me-2 shrink-0"
            value={[tabsBy]}
            onValueChange={(value) => {
              if (value[0] === "list" || value[0] === "category") setTabsBy(value[0]);
            }}
          >
            <Toggle value="list">List</Toggle>
            <Toggle value="category">Category</Toggle>
          </ToggleGroup>
          {tabs.map((tab) => {
            const needsYou = tab.cards.filter((entry) => entry.needsYou).length;
            return (
              <Button
                key={tab.id}
                variant={tab === activeTab ? "secondary" : "ghost"}
                size="xs"
                aria-current={tab === activeTab ? "true" : undefined}
                className="shrink-0"
                onClick={() => openTab(tab)}
              >
                {tab.label}
                <span className="text-muted-foreground tabular-nums">{tab.cards.length}</span>
                {needsYou > 0 ? (
                  <span
                    aria-label={`${needsYou} need you`}
                    className="size-1.5 rounded-full bg-warning"
                  />
                ) : null}
              </Button>
            );
          })}
        </nav>
        <div className="flex min-h-0 flex-1">
          <aside
            className={
              mobilePane === "details"
                ? "flex min-h-0 w-full flex-col overflow-y-auto border-border sm:w-80 sm:shrink-0 sm:border-e"
                : "hidden min-h-0 w-80 shrink-0 flex-col overflow-y-auto border-e border-border sm:flex"
            }
          >
            <CardDetails
              key={card.id}
              placed={placed}
              projects={props.projects}
              initiatives={props.initiatives}
              chatByKey={chatByKey}
              shownChat={shownChat}
              onShowChat={(ref) => {
                setChatRef(ref);
                setMobilePane("chat");
              }}
              onChange={change}
              onRemove={() => {
                const target = next ?? previous;
                removeCard(card.id);
                if (target) props.onNavigate(target);
                else props.onClose();
              }}
            />
          </aside>
          <section
            className={
              mobilePane === "chat"
                ? "relative flex min-h-0 min-w-0 flex-1 flex-col"
                : "relative hidden min-h-0 min-w-0 flex-1 flex-col sm:flex"
            }
          >
            {shownChat ? (
              <ChatView
                key={chatKey(shownChat)}
                environmentId={shownChat.environmentId as EnvironmentId}
                threadId={shownChat.threadId as ThreadId}
                routeKind="server"
                reserveTitleBarControlInset={false}
              />
            ) : (
              <div className="m-auto max-w-sm p-6 text-center text-sm text-muted-foreground">
                No chat on this card yet. Start one in this project, then drag its card onto this
                one's list, or link it from the board.
              </div>
            )}
          </section>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function CardDetails(props: {
  readonly placed: PlacedCard;
  readonly projects: ReadonlyArray<{ readonly projectKey: string; readonly displayName: string }>;
  readonly initiatives: ReadonlyArray<string>;
  readonly chatByKey: ReadonlyMap<string, CardChatState>;
  readonly shownChat: CardChatRef | null;
  readonly onShowChat: (ref: CardChatRef) => void;
  readonly onChange: (changes: Parameters<typeof updateCard>[1]) => void;
  readonly onRemove: () => void;
}) {
  const { placed, onChange } = props;
  const card = placed.card;
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  const [initiative, setInitiative] = useState(card.initiative ?? "");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const commitText = () => {
    const trimmedTitle = title.trim();
    const trimmedInitiative = initiative.trim() || null;
    const changes = {
      ...(trimmedTitle && trimmedTitle !== card.title ? { title: trimmedTitle } : {}),
      ...(notes !== card.notes ? { notes } : {}),
      ...(trimmedInitiative !== card.initiative ? { initiative: trimmedInitiative } : {}),
    };
    if (Object.keys(changes).length > 0) onChange(changes);
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      {placed.loose ? (
        <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
          This chat isn't on the board yet. Changing anything here adds it as a card.
        </p>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span>Title</span>
        <Input
          id="card-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitText}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span id="card-project-label">Repo</span>
        <Select
          value={card.projectKey}
          onValueChange={(value) => {
            if (typeof value === "string" && value !== card.projectKey) {
              onChange({ projectKey: value });
            }
          }}
        >
          <SelectTrigger aria-labelledby="card-project-label" size="sm">
            <SelectValue>
              {props.projects.find((project) => project.projectKey === card.projectKey)
                ?.displayName ?? "Unknown project"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {props.projects.map((project) => (
              <SelectItem key={project.projectKey} value={project.projectKey}>
                {project.displayName}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <label className="flex flex-col gap-1.5">
        <span>Initiative</span>
        <Input
          id="card-initiative"
          list="card-initiative-options"
          placeholder="e.g. Dev workflow"
          value={initiative}
          onChange={(event) => setInitiative(event.target.value)}
          onBlur={commitText}
        />
        <datalist id="card-initiative-options">
          {props.initiatives.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <div className="flex flex-col gap-1.5">
        <span id="card-category-label">Category</span>
        <ToggleGroup
          aria-labelledby="card-category-label"
          className="flex-wrap"
          value={card.category ? [card.category] : []}
          onValueChange={(next) =>
            onChange({ category: (next[0] as CardCategory | undefined) ?? null })
          }
        >
          {CARD_CATEGORIES.map((category) => (
            <Toggle key={category.id} value={category.id}>
              {category.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="card-stage-label">List</span>
        <ToggleGroup
          aria-labelledby="card-stage-label"
          className="flex-wrap"
          value={[placed.stage]}
          onValueChange={(next) => {
            const stage = next[0] as CardStage | undefined;
            if (stage) onChange({ stage });
          }}
        >
          {CARD_STAGES.map((stage) => (
            <Toggle key={stage.id} value={stage.id}>
              {stage.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="card-testing-label">Testing</span>
        <ToggleGroup
          aria-labelledby="card-testing-label"
          value={[card.testing ?? "none"]}
          onValueChange={(next) => {
            const value = next[0];
            if (value) onChange({ testing: value === "none" ? null : (value as CardTesting) });
          }}
        >
          {TESTING_OPTIONS.map((option) => (
            <Toggle key={option.id} value={option.id}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <label className="flex flex-col gap-1.5">
        <span>Notes</span>
        <Textarea
          id="card-notes"
          rows={5}
          placeholder="What done looks like, links, decisions…"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={commitText}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span>Chats</span>
        {card.chats.length === 0 ? (
          <p className="text-xs text-muted-foreground">No chat yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {card.chats.map((ref) => {
              const chat = props.chatByKey.get(chatKey(ref));
              const shown = props.shownChat !== null && chatKey(props.shownChat) === chatKey(ref);
              return (
                <li key={chatKey(ref)} className="flex items-center gap-1">
                  <Button
                    variant={shown ? "secondary" : "ghost"}
                    size="xs"
                    className="min-w-0 flex-1 justify-start"
                    onClick={() => props.onShowChat(ref)}
                  >
                    <span className="truncate">{chat?.title ?? "Chat not loaded"}</span>
                  </Button>
                  {placed.loose ? null : (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        onChange({
                          chats: card.chats.filter((entry) => chatKey(entry) !== chatKey(ref)),
                        })
                      }
                    >
                      Unlink
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {placed.loose ? null : confirmingRemove ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2">
          <span className="text-xs">Remove this card? Its chats stay on their machines.</span>
          <div className="flex gap-1.5">
            <Button variant="destructive" size="xs" onClick={props.onRemove}>
              Remove card
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setConfirmingRemove(false)}>
              Keep
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          onClick={() => setConfirmingRemove(true)}
        >
          Remove card…
        </Button>
      )}
    </div>
  );
}
