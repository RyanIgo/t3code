import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { RefreshCwIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
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
  summarizeInitiatives,
  waitingOnYou,
} from "./desk.logic";
import { refreshDesk, setDeskLane, useDesk } from "./deskStore";

const DeskMode = Schema.Literals(["lanes", "initiatives"]);
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

function openExternal(url: string) {
  const api = readLocalApi();
  if (window.desktopBridge && api) void api.shell.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

const initiativeLetter = (name: string | null) => name?.match(/^[A-Z]/)?.[0] ?? null;

/**
 * Fleet fork: the Dev Desk. All development work from the GitHub project, by lane and in plain
 * words, with what needs you on top and the T3 chats doing each item. Lives on the fleet hub.
 */
export function DeskPage(props: {
  readonly switcher: ReactNode;
  readonly chats: ReadonlyArray<CardChatState>;
}) {
  const desk = useDesk();
  const board = useBoard();
  const navigate = useNavigate();
  const [mode, setMode] = useLocalStorage("t3-fleet:desk-mode", "lanes" as DeskMode, DeskMode);
  const [storedInitiative, setStoredInitiative] = useLocalStorage(
    "t3-fleet:desk-initiative",
    ALL,
    Schema.String,
  );
  const [query, setQuery] = useState("");
  const [showAllUnsorted, setShowAllUnsorted] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const view = desk.view;
  const initiatives = view?.initiatives ?? [];
  const initiative = initiatives.includes(storedInitiative) ? storedInitiative : null;
  const items = view?.items ?? [];
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

  const columns = buildDeskColumns(items, { initiative, query });
  const waiting = waitingOnYou(items).filter(
    (item) => !initiative || item.initiative === initiative,
  );
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
      showInitiative={initiative === null}
      onOpenChat={openChat}
    />
  );

  return frame(
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
        <ToggleGroup
          aria-label="Desk view"
          value={[mode]}
          onValueChange={(next) => {
            if (next[0] === "lanes" || next[0] === "initiatives") setMode(next[0]);
          }}
        >
          <Toggle value="lanes">Lanes</Toggle>
          <Toggle value="initiatives">Initiatives</Toggle>
        </ToggleGroup>
        <div className="w-64 max-w-full">
          <Select
            value={initiative ?? ALL}
            onValueChange={(value) => {
              if (typeof value === "string") setStoredInitiative(value);
            }}
          >
            <SelectTrigger aria-label="Initiative" size="sm">
              <SelectValue>{initiative ?? "All initiatives"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={ALL}>All initiatives</SelectItem>
              {initiatives.map((name) => (
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
      </div>
      <NeedsYou chats={chatsNeedingYou} items={waiting} onOpenChat={openChat} />
      {mode === "lanes" ? (
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
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto px-4 pb-4 lg:grid-cols-2">
          {summarizeInitiatives(items, initiatives)
            .filter((summary) => initiative === null || summary.name === initiative)
            .map((summary) => (
              <section
                key={summary.name}
                aria-label={summary.name}
                className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
              >
                <header className="flex flex-wrap items-baseline gap-2">
                  <h2 className="text-sm font-semibold">{summary.name}</h2>
                  <span className="text-xs text-muted-foreground">
                    {summary.counts.Now} now · {summary.counts.Next} next · {summary.counts.Blocked}{" "}
                    blocked · {summary.counts.Later + summary.counts.Unsorted} later or unsorted ·{" "}
                    {summary.doneRecently} done in 2 weeks
                  </span>
                </header>
                {summary.focus.length > 0 ? (
                  <ol className="flex flex-col gap-2">
                    {summary.focus.slice(0, 6).map((item) => card(item, false))}
                  </ol>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing in Now, Next or Blocked. Pick something from Lanes.
                  </p>
                )}
              </section>
            ))}
        </div>
      )}
    </>,
  );
}

function NeedsYou(props: {
  readonly chats: ReadonlyArray<CardChatState>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly onOpenChat: (chat: CardChatState) => void;
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
          onClick={() => item.url && openExternal(item.url)}
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

function DeskCard(props: {
  readonly item: DeskItem;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly draggable: boolean;
  readonly showInitiative: boolean;
  readonly onOpenChat: (chat: CardChatState) => void;
}) {
  const { item } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.itemId,
    disabled: !props.draggable,
  });
  const ref = deskRef(item);
  const letter = initiativeLetter(item.initiative);
  const needsYou = props.chats.some(chatWaitsOnYou);
  const working = props.chats.some((chat) => chat.working);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("list-none", isDragging && "relative z-10 opacity-80")}
    >
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 shadow-xs">
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={() => item.url && openExternal(item.url)}
          className="flex cursor-pointer flex-col gap-1 text-left outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            {props.showInitiative && letter ? (
              <span className="rounded border border-border px-1 font-medium">{letter}</span>
            ) : null}
            <span className="truncate">
              {[ref, item.priority, item.size].filter(Boolean).join(" · ")}
            </span>
            {item.kind === "pr" ? <span>· PR</span> : null}
          </span>
          <span className="line-clamp-3 text-sm">{deskTitle(item)}</span>
          {item.plain?.where ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">{item.plain.where}</span>
          ) : null}
        </button>
        <span className="flex flex-wrap items-center gap-1">
          {item.status && item.status !== "Todo" ? (
            <Badge variant="outline" size="sm">
              {item.status}
            </Badge>
          ) : null}
          {item.pullRequests.map((pr) => (
            <Badge
              key={pr.url}
              variant={
                pr.state === "merged" ? "success" : pr.state === "closed" ? "secondary" : "outline"
              }
              size="sm"
            >
              PR #{pr.number}
              {pr.state === "open" ? "" : ` · ${pr.state}`}
            </Badge>
          ))}
          {props.chats.length > 0 ? (
            <button
              type="button"
              className="cursor-pointer"
              onClick={() => props.onOpenChat(props.chats[0] as CardChatState)}
            >
              <Badge variant={needsYou ? "warning" : working ? "info" : "secondary"} size="sm">
                {props.chats.length} chat{props.chats.length === 1 ? "" : "s"}
                {needsYou ? " · needs you" : working ? " · working" : ""}
              </Badge>
            </button>
          ) : null}
          <span className="ms-auto">
            <Select
              value={item.lane ?? "none"}
              onValueChange={(value) => {
                if (typeof value !== "string") return;
                const lane = value === "none" ? null : (value as DeskLane);
                if (lane !== item.lane) void setDeskLane(item.itemId, lane);
              }}
            >
              <SelectTrigger aria-label={`Lane for ${deskTitle(item)}`} size="sm">
                <SelectValue>{item.lane ?? "No lane"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {DESK_LANES.map((lane) => (
                  <SelectItem key={lane} value={lane}>
                    {lane}
                  </SelectItem>
                ))}
                <SelectItem value="none">No lane</SelectItem>
              </SelectPopup>
            </Select>
          </span>
        </span>
      </div>
    </li>
  );
}
