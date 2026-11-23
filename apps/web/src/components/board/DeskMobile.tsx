import {
  CheckIcon,
  ChevronDownIcon,
  KanbanSquareIcon,
  LayoutListIcon,
  MonitorIcon,
  NotebookPenIcon,
  SmartphoneIcon,
  SunIcon,
  ZapIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import type { CardChatState } from "./boardCards.logic";
import {
  chatStatus,
  type DeskItem,
  deskTitle,
  type ItemSignals,
  needsWrapUp,
  SPRINT_STATUSES,
  type SprintStatus,
  workKind,
} from "./desk.logic";
import { type DeskNotes, type InboxNote, inboxToSort } from "./deskNotes.logic";
import { fileOnGitHub, InboxCard, QuickNoteForm, suggestTitle } from "./DeskInbox";
import { saveInboxNote } from "./deskNotesStore";
import { findDeskItem } from "./deskStore";
import { toastManager } from "../ui/toast";
import { type Entry, type NowInput, useNowEntries } from "./DeskNow";
import { TypeTag } from "./DeskParts";

/**
 * Fleet fork: the Board on a phone. Each screen does one job: Now is what needs Rigo (across all
 * apps unless he picks one), Sprint is one list by status, Work is the chats. A bottom bar moves
 * between them and takes a quick note.
 */

type Tile = "review" | "test" | "merge" | "notes";
const TILES: ReadonlyArray<{ readonly id: Tile; readonly label: string }> = [
  { id: "review", label: "Review" },
  { id: "test", label: "Test" },
  { id: "merge", label: "Merge" },
  { id: "notes", label: "Notes" },
];
const DOT: Record<string, string> = {
  warning: "bg-warning",
  error: "bg-destructive",
  success: "bg-success",
  info: "bg-info",
  outline: "bg-muted-foreground",
  secondary: "bg-muted-foreground",
};

/** The app the screen is narrowed to, as one button that opens a list to pick from. */
function AppPicker(props: {
  readonly apps: ReadonlyArray<string>;
  readonly app: string | null;
  readonly onApp: (app: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (value: string | null) => {
    props.onApp(value);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-base"
      >
        <span className="truncate">{props.app ?? "All applications"}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogPopup className="sm:max-w-sm">
            <div className="flex flex-col p-2">
              <DialogTitle className="mx-3 my-2">Application</DialogTitle>
              {[null, ...props.apps].map((value) => (
                <button
                  key={value ?? "*"}
                  type="button"
                  onClick={() => pick(value)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded-md px-3 py-3 text-left text-base hover:bg-accent",
                    props.app === value && "font-semibold",
                  )}
                >
                  {value ?? "All applications"}
                  {props.app === value ? <CheckIcon className="size-4" aria-hidden /> : null}
                </button>
              ))}
            </div>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}

function Line(props: {
  readonly tone: string;
  readonly title: string;
  readonly detail: string;
  readonly onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={props.onClick}
        className="flex w-full cursor-pointer items-start gap-3 py-2.5 text-left"
      >
        <span
          aria-hidden
          className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[props.tone] ?? DOT.outline)}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base">{props.title}</span>
          <span className="truncate text-xs text-muted-foreground">{props.detail}</span>
        </span>
      </button>
    </li>
  );
}

const LANE_ORDER: Record<string, number> = { review: 0, merge: 1, test: 2, working: 3 };

/** Now on a phone: app chips, four tiles, then one list of what needs Rigo. */
export function MobileNow(
  props: NowInput & {
    readonly notes: DeskNotes;
    readonly items: ReadonlyArray<DeskItem>;
    readonly sprints: ReadonlyArray<string>;
    readonly currentSprint: string | null;
    readonly onStartChat: (item: DeskItem) => void;
    /** The day's chat, or the button to start it. */
  },
) {
  const [app, setApp] = useState<string | null>(null);
  const [tile, setTile] = useState<Tile | null>(null);
  const [openNote, setOpenNote] = useState<InboxNote | null>(null);
  const { entries } = useNowEntries(props);
  const inApp = (entry: Entry) => app === null || entry.app === app;
  const shown = entries.filter((entry) => entry.lane !== "working" && inApp(entry));
  const notes = inboxToSort(props.notes).filter(
    (note) => app === null || (note.proposal?.app ?? note.app) === app,
  );
  const count = (id: Tile) =>
    id === "notes" ? notes.length : shown.filter((entry) => entry.lane === id).length;
  const working = entries.filter((entry) => entry.lane === "working" && inApp(entry)).length;
  const list = shown
    .filter((entry) => tile === null || entry.lane === tile)
    .toSorted((a, b) => (LANE_ORDER[a.lane] ?? 9) - (LANE_ORDER[b.lane] ?? 9));
  // Answering, approving, reading a result, merging or sending back work on a phone; testing and
  // reviewing code need a computer.
  const atComputer = (entry: Entry) => entry.lane === "test" || entry.badge === "Review";
  const phoneList = list.filter((entry) => !atComputer(entry));
  const computerList = list.filter(atComputer);
  const noteOpen = openNote ? (props.notes.inbox[openNote.id] ?? openNote) : null;
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-24">
      <AppPicker apps={props.apps} app={app} onApp={setApp} />
      <div className="grid grid-cols-4 gap-2">
        {TILES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTile(tile === entry.id ? null : entry.id)}
            className={cn(
              "flex cursor-pointer flex-col items-start rounded-lg border px-2.5 py-2 text-left",
              tile === entry.id ? "border-foreground" : "border-border bg-muted/40",
            )}
          >
            <span className="text-xl font-semibold tabular-nums">{count(entry.id)}</span>
            <span className="text-xs text-muted-foreground">{entry.label}</span>
          </button>
        ))}
      </div>
      <section
        aria-label="Capture"
        className="flex flex-col gap-2 rounded-lg border border-border p-3"
      >
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Capture
        </h2>
        <QuickNoteForm apps={props.apps} inline />
      </section>
      <section className="flex flex-col">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <SmartphoneIcon className="size-3.5" aria-hidden />
          {tile ? TILES.find((entry) => entry.id === tile)?.label : "From your phone"}
          {working > 0 ? ` · ${working} agents working` : ""}
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {tile === null || tile === "notes"
            ? notes.map((note) => (
                <Line
                  key={note.id}
                  tone="warning"
                  title={suggestTitle(note.text)}
                  detail={["Note", note.who, note.proposal ? "route proposed" : "to sort"]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() => setOpenNote(note)}
                />
              ))
            : null}
          {tile === "notes"
            ? null
            : phoneList.map((entry) => (
                <Line
                  key={entry.key}
                  tone={entry.tone}
                  title={entry.title}
                  detail={[app === null ? entry.app : null, entry.badge, entry.meta, entry.ask]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={entry.onClick}
                />
              ))}
        </ul>
        {list.length === 0 && notes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing needs you here.</p>
        ) : null}
      </section>
      {tile !== "notes" && computerList.length > 0 ? (
        <details className="flex flex-col">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <MonitorIcon className="size-3.5" aria-hidden />
            At a computer · {computerList.length}
          </summary>
          <ul className="flex flex-col divide-y divide-border">
            {computerList.map((entry) => (
              <Line
                key={entry.key}
                tone={entry.tone}
                title={entry.title}
                detail={[app === null ? entry.app : null, entry.badge, entry.meta, entry.ask]
                  .filter(Boolean)
                  .join(" · ")}
                onClick={entry.onClick}
              />
            ))}
          </ul>
        </details>
      ) : null}
      {noteOpen ? (
        <Dialog open onOpenChange={(next) => !next && setOpenNote(null)}>
          <DialogPopup className="sm:max-w-lg">
            <div className="flex max-h-[85dvh] flex-col gap-2 overflow-y-auto p-4">
              <DialogTitle>Note</DialogTitle>
              {noteOpen.state === "new" || noteOpen.state === "proposed" ? (
                <ActNow
                  note={noteOpen}
                  apps={props.apps}
                  items={props.items}
                  currentSprint={props.currentSprint}
                  onStarted={(item) => {
                    setOpenNote(null);
                    props.onStartChat(item);
                  }}
                />
              ) : null}
              {noteOpen.state === "new" || noteOpen.state === "proposed" ? (
                <ul>
                  <InboxCard
                    note={noteOpen}
                    items={props.items}
                    apps={props.apps}
                    sprints={props.sprints}
                    chats={props.chats}
                    onOpenChat={(chat) => {
                      setOpenNote(null);
                      props.onOpenChat(chat);
                    }}
                    onStartChat={(item) => {
                      setOpenNote(null);
                      props.onStartChat(item);
                    }}
                    currentSprint={props.currentSprint}
                  />
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sorted: {noteOpen.result?.label ?? noteOpen.state}.
                </p>
              )}
            </div>
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}

const ACT_TYPES = ["Bug", "Story", "Support"] as const;

/**
 * Priority mode for a note: pick the kind and the app, and it's filed as a P1 item in the current
 * sprint with a chat starting on it right away.
 */
export function ActNow(props: {
  readonly note: InboxNote;
  readonly apps: ReadonlyArray<string>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly currentSprint: string | null;
  readonly onStarted: (item: DeskItem) => void;
}) {
  const [type, setType] = useState<(typeof ACT_TYPES)[number]>("Bug");
  const [busy, setBusy] = useState<string | null>(null);
  // The repo an app's work mostly lives in.
  const repoFor = (app: string) => {
    const counts = new Map<string, number>();
    for (const item of props.items) {
      if (item.app === app && item.repo && item.kind !== "pr") {
        counts.set(item.repo, (counts.get(item.repo) ?? 0) + 1);
      }
    }
    return [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const act = async (app: string) => {
    const repo = repoFor(app);
    if (!repo) {
      toastManager.add({ type: "error", title: `No repo found for ${app}.` });
      return;
    }
    setBusy(app);
    try {
      const filed = await fileOnGitHub(props.note, {
        action: "new",
        itemUrl: null,
        repo,
        app,
        type,
        priority: "P1",
        title: suggestTitle(props.note.text),
        sprint: props.currentSprint,
        chat: null,
        reason: "Acted on right away by Rigo.",
      });
      saveInboxNote(filed);
      const item = filed.result?.url ? findDeskItem(filed.result.url) : null;
      if (item) props.onStarted(item);
      else
        toastManager.add({
          type: "success",
          title: `Filed as ${filed.result?.label ?? "a new item"}`,
        });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Couldn't file it",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <ZapIcon className="size-4" aria-hidden />
        Act on this now
      </h3>
      <p className="text-xs text-muted-foreground">
        Files it as P1 in {props.currentSprint ?? "the Backlog"} and starts a chat on it.
      </p>
      <div className="flex gap-2">
        {ACT_TYPES.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setType(entry)}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1 text-sm",
              type === entry ? "border-foreground bg-foreground text-background" : "border-border",
            )}
          >
            {entry}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {props.apps.map((app) => (
          <button
            key={app}
            type="button"
            disabled={busy !== null}
            onClick={() => void act(app)}
            className="cursor-pointer rounded-md border border-border px-3 py-2.5 text-left text-base hover:bg-accent disabled:opacity-60"
          >
            {busy === app ? "Filing…" : app}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Sprint on a phone: the goal in a line, then one list by status with Done folded. */
export function MobileSprint(props: {
  readonly apps: ReadonlyArray<string>;
  readonly app: string | null;
  readonly onApp: (app: string | null) => void;
  readonly heading: string;
  readonly goal: string | null;
  readonly board: Readonly<Record<SprintStatus, ReadonlyArray<DeskItem>>>;
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly signalsFor: (item: DeskItem) => ItemSignals;
  readonly onOpenItem: (item: DeskItem) => void;
}) {
  const order: ReadonlyArray<SprintStatus> = ["In Review", "In Progress", "Todo"];
  const row = (item: DeskItem) => {
    const chat = props
      .chatsFor(item)
      .toSorted((a, b) => chatStatus(a).rank - chatStatus(b).rank)[0];
    // What Rigo can do about it from here: reply, read a result, wrap up; or that it's moving.
    const badge = needsWrapUp(item, props.signalsFor(item))
      ? "Wrap up"
      : chat?.needsYou
        ? "Reply"
        : chat?.column === "done"
          ? "Read result"
          : chat?.working
            ? "Working"
            : chat
              ? "Idle"
              : item.status === "Done" || item.state !== "open"
                ? null
                : "No agent";
    const actionable = badge === "Reply" || badge === "Read result" || badge === "Wrap up";
    return (
      <li key={item.itemId}>
        <button
          type="button"
          onClick={() => props.onOpenItem(item)}
          className="flex w-full cursor-pointer items-center gap-2 py-2.5 text-left"
        >
          <TypeTag kind={workKind(item)} />
          <span className="min-w-0 flex-1 truncate text-base">{deskTitle(item)}</span>
          {badge ? (
            <span className="shrink-0">
              <Badge variant={actionable ? "warning" : "outline"} size="sm">
                {badge}
              </Badge>
            </span>
          ) : null}
        </button>
      </li>
    );
  };
  const section = (status: SprintStatus) => (
    <section key={status} className="flex flex-col">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {status} · {props.board[status].length}
      </h2>
      <ul className="flex flex-col divide-y divide-border">{props.board[status].map(row)}</ul>
    </section>
  );
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-24">
      <AppPicker apps={props.apps} app={props.app} onApp={props.onApp} />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{props.heading}</span>
        {props.goal ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">Goal: {props.goal}</span>
        ) : null}
      </div>
      {order.map(section)}
      <details>
        <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Done · {props.board.Done.length}
        </summary>
        <ul className="flex flex-col divide-y divide-border">{props.board.Done.map(row)}</ul>
      </details>
      {SPRINT_STATUSES.every((status) => props.board[status].length === 0) ? (
        <p className="text-sm text-muted-foreground">
          Nothing planned in this sprint for this app.
        </p>
      ) : null}
    </div>
  );
}

export type MobileScreen = "now" | "work" | "sprint";

/** The phone's bottom bar: the three screens and a quick note. */
export function MobileBottomBar(props: {
  readonly active: MobileScreen | null;
  readonly onScreen: (screen: MobileScreen) => void;
  readonly onNote: () => void;
}) {
  const item = (id: MobileScreen | "note", label: string, icon: ReactNode, onClick: () => void) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      aria-current={props.active === id ? "page" : undefined}
      className={cn(
        "flex flex-1 cursor-pointer flex-col items-center gap-0.5 py-2 text-xs",
        props.active === id ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <nav
      aria-label="Board"
      className="flex shrink-0 border-t border-border bg-background"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {item("now", "Now", <SunIcon className="size-5" />, () => props.onScreen("now"))}
      {item("work", "Work", <LayoutListIcon className="size-5" />, () => props.onScreen("work"))}
      {item("sprint", "Sprint", <KanbanSquareIcon className="size-5" />, () =>
        props.onScreen("sprint"),
      )}
      {item("note", "Note", <NotebookPenIcon className="size-5" />, props.onNote)}
    </nav>
  );
}
