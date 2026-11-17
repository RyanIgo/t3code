import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { RefreshCwIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import type { CardChatState } from "./boardCards.logic";
import { useBoard } from "./boardStore";
import {
  buildDeskColumns,
  chatsForItem,
  chatWaitsOnYou,
  DESK_LANES,
  type DeskItem,
  type DeskLane,
  deskRef,
  deskTitle,
  NOW_LIMIT,
  summarizeApps,
  appRepos,
  chatsForApp,
  type AppSummary,
  currentSprint,
  waitingOnYou,
} from "./desk.logic";
import { refreshDesk, setDeskLane, useDesk } from "./deskStore";
import { type DeskNotes, noteAt } from "./deskNotes.logic";
import { saveDeskNote, useDeskNotes } from "./deskNotesStore";
import { minuteTickToMs } from "./fleetBoard.logic";
import { DeskCard, formatDay, NoteEditor, STAGE_VARIANT, ThreadList } from "./DeskParts";
import { AppView, ItemDialog, SprintView } from "./DeskViews";

const DeskMode = Schema.Literals(["lanes", "apps", "sprint"]);
type DeskMode = typeof DeskMode.Type;
const ALL = "*";
const UNSORTED_SHOWN = 25;

const LANE_HINT: Record<DeskLane | "Unsorted", string> = {
  Now: "Being worked on this week",
  Next: "Up after Now",
  Later: "Wanted, not soon",
  Blocked: "Waiting on someone or something",
  Unsorted: "Open work with no lane yet, highest priority first",
};

/**
 * Fleet fork: the Dev Desk. All development work from the GitHub project in plain words: Lanes
 * for doing it, Apps for leading it (each application's features by stage, this sprint and its
 * 60 / 20 / 20 split), with what needs you on top. Lives on the fleet hub.
 */
export function DeskPage(props: {
  readonly switcher: ReactNode;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly projectName: (projectKey: string) => string | null;
}) {
  const desk = useDesk();
  const notes = useDeskNotes();
  const board = useBoard();
  const navigate = useNavigate();
  const [mode, setMode] = useLocalStorage("t3-fleet:desk-mode", "apps" as DeskMode, DeskMode);
  const [focus, setFocus] = useState<{ app: string; feature: string | null } | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [chosenSprint, setChosenSprint] = useState<string | null>(null);
  const [storedApp, setStoredApp] = useLocalStorage("t3-fleet:desk-app", ALL, Schema.String);
  const [query, setQuery] = useState("");
  const [showAllUnsorted, setShowAllUnsorted] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const view = desk.view;
  const apps = view?.apps ?? [];
  const app = apps.includes(storedApp) ? storedApp : null;
  const items = view?.items ?? [];
  const nowMs = minuteTickToMs(useNowMinute());
  const sprint = currentSprint(view?.sprints ?? [], nowMs);
  const linksByChat = new Map<string, string[]>();
  for (const card of board.document.cards) {
    for (const ref of card.chats) {
      linksByChat.set(
        `${ref.environmentId}:${ref.threadId}`,
        card.links.map((link) => link.url),
      );
    }
  }
  const chatsFor = (item: DeskItem) => chatsForItem(item, props.chats, linksByChat);
  const openChat = (chat: CardChatState) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: chat.environmentId, threadId: chat.threadId },
    });

  const header = (
    <WorkspacePageHeader electron={isElectron} className="border-b border-border">
      <h1 className="hidden shrink-0 text-sm font-medium sm:block">Desk</h1>
      {props.switcher}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {desk.error ??
          view?.error ??
          (view?.syncedAt
            ? `From GitHub · synced ${new Date(view.syncedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}`
            : "")}
      </span>
      {view?.configured ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={desk.loading}
          onClick={() => void refreshDesk()}
        >
          <RefreshCwIcon />
          Refresh
        </Button>
      ) : null}
    </WorkspacePageHeader>
  );

  const frame = (body: ReactNode) => (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {header}
        {body}
      </div>
    </SidebarInset>
  );

  if (!desk.onHub || (view && !view.configured)) {
    return frame(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {desk.onHub ? "Connect the Desk to GitHub" : "The Desk lives on the hub"}
          </EmptyTitle>
          <EmptyDescription>
            {desk.onHub
              ? "Give the hub a GitHub token and the project to read (see fleet/README.md, Dev Desk)."
              : "Open the fleet hub's address to see your development work here."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
  }
  if (!view) {
    return frame(
      <p className="p-6 text-sm text-muted-foreground">
        {desk.error ?? "Loading your work from GitHub…"}
      </p>,
    );
  }

  const columns = buildDeskColumns(items, { app, query });
  const waiting = waitingOnYou(items).filter((item) => !app || item.app === app);
  const chatsNeedingYou = props.chats.filter(chatWaitsOnYou);

  const onDragEnd = (event: DragEndEvent) => {
    const lane = event.over?.data.current?.lane as DeskLane | "Unsorted" | undefined;
    const item = items.find((entry) => entry.itemId === event.active.id);
    if (!item || !lane || (item.lane ?? "Unsorted") === lane) return;
    void setDeskLane(item.itemId, lane === "Unsorted" ? null : lane);
  };

  const card = (item: DeskItem, draggable: boolean) => (
    <DeskCard
      key={item.itemId}
      item={item}
      chats={chatsFor(item)}
      draggable={draggable}
      showApp={app === null}
      currentSprint={sprint?.title ?? null}
      onOpenChat={openChat}
      onOpen={(entry) => setOpenItemId(entry.itemId)}
    />
  );
  const openItem = items.find((entry) => entry.itemId === openItemId) ?? null;
  const sprintShown = view.sprints?.find((entry) => entry.title === chosenSprint) ?? sprint;

  return frame(
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
        <ToggleGroup
          aria-label="Desk view"
          value={[mode]}
          onValueChange={(next) => {
            if (next[0] === "lanes" || next[0] === "apps" || next[0] === "sprint") {
              setMode(next[0]);
              setFocus(null);
            }
          }}
        >
          <Toggle value="apps">Apps</Toggle>
          <Toggle value="sprint">Sprint</Toggle>
          <Toggle value="lanes">Lanes</Toggle>
        </ToggleGroup>
        <div className="w-64 max-w-full">
          <Select
            value={app ?? ALL}
            onValueChange={(value) => {
              if (typeof value === "string") setStoredApp(value);
            }}
          >
            <SelectTrigger aria-label="Application" size="sm">
              <SelectValue>{app ?? "All applications"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={ALL}>All applications</SelectItem>
              {apps.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="w-56 max-w-full">
          <Input
            size="sm"
            type="search"
            aria-label="Search work"
            placeholder="Search work…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {sprint ? (
          <span className="text-xs text-muted-foreground">
            {sprint.title}: {formatDay(sprint.startDate)} –{" "}
            {formatDay(sprint.startDate, sprint.duration - 1)}
          </span>
        ) : null}
      </div>
      {focus === null ? (
        <NeedsYou
          chats={chatsNeedingYou}
          items={waiting}
          onOpenChat={openChat}
          onOpenItem={(entry) => setOpenItemId(entry.itemId)}
        />
      ) : null}
      {openItem ? (
        <ItemDialog
          key={openItem.itemId}
          item={openItem}
          view={view}
          chats={chatsFor(openItem)}
          onOpenChat={openChat}
          onOpenItem={(entry) => setOpenItemId(entry.itemId)}
          onClose={() => setOpenItemId(null)}
        />
      ) : null}
      {mode === "apps" && focus ? (
        <AppView
          app={focus.app}
          feature={focus.feature}
          items={items}
          sprint={sprint}
          notes={notes.notes}
          threads={chatsForApp(props.chats, appRepos(items, focus.app), props.projectName)}
          card={(entry) => card(entry, false)}
          onOpenItem={(entry) => setOpenItemId(entry.itemId)}
          onOpenChat={openChat}
          onFeature={(feature) => setFocus({ app: focus.app, feature })}
          onBack={() => setFocus(null)}
        />
      ) : mode === "sprint" ? (
        sprintShown ? (
          <SprintView
            view={view}
            sprint={sprintShown}
            nowMs={nowMs}
            notes={notes.notes}
            app={app}
            card={(entry) => card(entry, false)}
            onSprint={setChosenSprint}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">The project has no sprints yet.</p>
        )
      ) : mode === "lanes" ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-4 pb-4">
            {["Unsorted" as const, ...DESK_LANES].map((lane) => {
              const laneItems = columns[lane];
              const shown =
                lane === "Unsorted" && !showAllUnsorted
                  ? laneItems.slice(0, UNSORTED_SHOWN)
                  : laneItems;
              return (
                <DeskColumn
                  key={lane}
                  lane={lane}
                  count={laneItems.length}
                  footer={
                    shown.length < laneItems.length ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="mx-2 mb-2"
                        onClick={() => setShowAllUnsorted(true)}
                      >
                        Show {laneItems.length - shown.length} more
                      </Button>
                    ) : null
                  }
                >
                  {shown.map((item) => card(item, true))}
                </DeskColumn>
              );
            })}
          </div>
        </DndContext>
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto px-4 pt-3 pb-4 xl:grid-cols-2">
          {sprint ? (
            <section
              aria-label={`${sprint.title} notes`}
              className="rounded-lg border border-border bg-muted/40 p-3 xl:col-span-2"
            >
              <NoteEditor
                label={`${sprint.title} notes`}
                hint="What this sprint is for and what feedback said. Agents read it."
                placeholder="e.g. Goal: get bid review and access control in front of users by Nov 22; feedback from the test sheets goes here."
                note={noteAt(notes.notes, { kind: "sprintNotes", sprint: sprint.title })}
                rows={3}
                onSave={(text) => saveDeskNote({ kind: "sprintNotes", sprint: sprint.title }, text)}
              />
            </section>
          ) : null}
          {summarizeApps(items, app ? [app] : apps, sprint).map((summary) => (
            <AppScorecard
              key={summary.app}
              summary={summary}
              sprintTitle={sprint?.title ?? null}
              card={(item) => card(item, false)}
              notes={notes.notes}
              threads={chatsForApp(props.chats, appRepos(items, summary.app), props.projectName)}
              onOpenChat={openChat}
              onOpenApp={() => setFocus({ app: summary.app, feature: null })}
              onOpenFeature={(feature) => setFocus({ app: summary.app, feature })}
            />
          ))}
        </div>
      )}
    </>,
  );
}

/** One application for a leader: its features by stage, this sprint's work and split, blockers. */

function AppScorecard(props: {
  readonly summary: AppSummary;
  readonly sprintTitle: string | null;
  readonly card: (item: DeskItem) => ReactNode;
  readonly notes: DeskNotes;
  readonly threads: ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenApp: () => void;
  readonly onOpenFeature: (feature: string) => void;
}) {
  const { summary } = props;
  const goalTarget = props.sprintTitle
    ? ({ kind: "sprintGoal", sprint: props.sprintTitle, app: summary.app } as const)
    : null;
  const { mix } = summary;
  const total = mix.feature + mix.maintenance + mix.other;
  const percent = (value: number) => (total === 0 ? 0 : Math.round((value / total) * 100));
  return (
    <section
      aria-label={summary.app}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">
          <button
            type="button"
            className="cursor-pointer hover:underline"
            onClick={props.onOpenApp}
          >
            {summary.app}
          </button>
        </h2>
        <span className="text-xs text-muted-foreground">
          {summary.open} open · {summary.maintenance} maintenance · {summary.blocked.length} blocked
        </span>
      </header>
      {goalTarget ? (
        <NoteEditor
          label={`${props.sprintTitle} goal`}
          hint="One line: what this app should reach this sprint."
          placeholder="e.g. Estimators level bids on one screen, in Testing with two of them."
          note={noteAt(props.notes, goalTarget)}
          rows={1}
          onSave={(text) => saveDeskNote(goalTarget, text)}
        />
      ) : null}
      {summary.features.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            Features
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {summary.features.map((feature) => (
              <li key={feature.feature} className="flex items-center gap-2">
                <span className="w-24 shrink-0">
                  {feature.stage ? (
                    <Badge variant={STAGE_VARIANT[feature.stage]} size="sm">
                      {feature.stage}
                    </Badge>
                  ) : (
                    <span className="text-2xs text-muted-foreground">No stage</span>
                  )}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline disabled:cursor-default disabled:no-underline"
                  onClick={() => props.onOpenFeature(feature.feature)}
                >
                  {feature.name}
                </button>
                <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                  {feature.inSprint > 0 ? `${feature.inSprint} in sprint · ` : ""}
                  {feature.open} open{feature.blocked > 0 ? ` · ${feature.blocked} blocked` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <h3 className="flex flex-wrap items-baseline gap-2 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          {props.sprintTitle ?? "This sprint"}
          {total > 0 ? (
            <span className="font-normal tracking-normal normal-case">
              {percent(mix.feature)}% features · {percent(mix.maintenance)}% maintenance ·{" "}
              {percent(mix.other)}% fixes, research & support (budget 60 / 20 / 20)
            </span>
          ) : null}
        </h3>
        {summary.sprintItems.length > 0 ? (
          <ol className="flex flex-col gap-2">{summary.sprintItems.map(props.card)}</ol>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing planned for this sprint.</p>
        )}
      </div>
      {summary.blocked.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            Blocked
          </h3>
          <ol className="flex flex-col gap-2">{summary.blocked.map(props.card)}</ol>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          Threads · {props.threads.length}
        </h3>
        <ThreadList
          threads={props.threads}
          onOpenChat={props.onOpenChat}
          empty="No open T3 chats in this app's repos."
        />
      </div>
      <details className="group/notes">
        <summary className="cursor-pointer text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          Notes for agents
          {props.notes.apps[summary.app] ? "" : " · none yet"}
        </summary>
        <div className="mt-1.5">
          <NoteEditor
            label="Notes for agents"
            hint="Goals, decisions, conventions, what not to touch. Agents read this before working here."
            placeholder={
              "e.g.\n- Estimators are the users; keep screens plain.\n- Decided 2026-11-17: leveling is the heart of Bids.\n- Don't change the AI read switches without asking."
            }
            note={props.notes.apps[summary.app] ?? null}
            rows={8}
            onSave={(text) => saveDeskNote({ kind: "app", app: summary.app }, text)}
          />
        </div>
      </details>
    </section>
  );
}

function NeedsYou(props: {
  readonly chats: ReadonlyArray<CardChatState>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = props.chats.length + props.items.length;
  if (total === 0) {
    return <p className="px-4 pt-3 text-xs text-muted-foreground">Nothing is waiting on you.</p>;
  }
  const rows: ReactNode[] = [
    ...props.chats.map((chat) => (
      <li key={`chat:${chat.environmentId}:${chat.threadId}`} className="flex items-center gap-2">
        <Badge variant="warning" size="sm">
          {chat.needsYou ? "Chat" : chat.column === "done" ? "Result" : "Checks"}
        </Badge>
        <button
          type="button"
          className="min-w-0 cursor-pointer truncate text-left hover:underline"
          onClick={() => props.onOpenChat(chat)}
        >
          {chat.title}
        </button>
      </li>
    )),
    ...props.items.map((item) => (
      <li key={item.itemId} className="flex items-center gap-2">
        <Badge variant={item.lane === "Blocked" ? "error" : "info"} size="sm">
          {item.lane === "Blocked" ? "Blocked" : "Review"}
        </Badge>
        <button
          type="button"
          className="min-w-0 cursor-pointer truncate text-left hover:underline"
          onClick={() => props.onOpenItem(item)}
        >
          {deskTitle(item)}
        </button>
        <span className="shrink-0 text-2xs text-muted-foreground">{deskRef(item)}</span>
      </li>
    )),
  ];
  return (
    <section
      aria-label="Needs you"
      className="mx-4 mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Needs you · {total}
      </h2>
      <ul className="flex flex-col gap-1 text-sm">{expanded ? rows : rows.slice(0, 5)}</ul>
      {rows.length > 5 ? (
        <Button variant="ghost" size="xs" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer" : `Show ${rows.length - 5} more`}
        </Button>
      ) : null}
    </section>
  );
}

function DeskColumn(props: {
  readonly lane: DeskLane | "Unsorted";
  readonly count: number;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${props.lane}`,
    data: { lane: props.lane },
  });
  const overLimit = props.lane === "Now" && props.count > NOW_LIMIT;
  return (
    <section
      ref={setNodeRef}
      aria-label={props.lane === "Unsorted" ? "Not sorted" : props.lane}
      className={cn(
        "flex max-h-full w-72 max-w-[85vw] shrink-0 flex-col rounded-lg border border-border bg-muted/40",
        isOver && "border-ring",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-0.5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {props.lane === "Unsorted" ? "Not sorted" : props.lane}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {props.lane === "Now" ? `${props.count} / ${NOW_LIMIT}` : props.count}
        </span>
        {overLimit ? (
          <Badge variant="warning" size="sm" className="ms-auto">
            Too many
          </Badge>
        ) : null}
      </header>
      <p className="px-3 pb-1.5 text-2xs text-muted-foreground">{LANE_HINT[props.lane]}</p>
      <ol className="flex min-h-8 flex-col gap-2 overflow-y-auto px-2 pb-2">{props.children}</ol>
      {props.footer}
    </section>
  );
}
