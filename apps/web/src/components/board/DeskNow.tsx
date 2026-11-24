import { type ReactNode, useState } from "react";
import { Schema } from "effect";

import { useLocalStorage } from "../../hooks/useLocalStorage";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { CardChatState } from "./boardCards.logic";
import { chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import { isDependencyUpdate, type DeskPr } from "./deskPrs.logic";
import { DeskHeading } from "./DeskParts";
import {
  itemForSheet,
  type SheetSummary,
  sheetsTestingPr,
  sheetTurn,
  uncheckedRows,
  useHubSheets,
} from "./deskSheets";
import type { DeskNotes, PlannerDecision, PlannerTodo } from "./deskNotes.logic";
import { savePlanLineDone } from "./deskNotesStore";
import { shippedFocus, WRAP_ASKED } from "./wrapUp.logic";
import { useSendToChat } from "./deskSend";

const SHEET_DAYS = 14;
/** A sheet nobody touched or asked about for this long waits in "Older sheets", not the queue. */
const FRESH_SHEET_DAYS = 3;
const DAY_MS = 86_400_000;

/** Test sheets not finished clean, changed in the last two weeks, newest first. */
function sheetsToTest(all: ReadonlyArray<SheetSummary>, nowMs: number): SheetSummary[] {
  return all
    .filter(
      (sheet) =>
        sheetTurn(sheet) !== "clean" && nowMs - Date.parse(sheet.updatedAt) < SHEET_DAYS * DAY_MS,
    )
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function ago(nowMs: number, iso: string | null | undefined): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (Number.isNaN(minutes)) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/** A chat's `next` line that hands the turn to Rigo: "Rigo: test bid intake on its sheet". */
const RIGO_NEXT = /^\s*(?:rigo|you)\s*[:\-–—]\s*/i;

const PR_LABEL = {
  ready: { label: "Merge", tone: "success" },
  landed: { label: "Close", tone: "secondary" },
  fix: { label: "Send back", tone: "error" },
} as const;

type Tone = "success" | "error" | "warning" | "info" | "outline" | "secondary";
export type Lane = "working" | "review" | "test" | "merge";

export interface Entry {
  readonly key: string;
  readonly lane: Lane;
  readonly app: string;
  /** The verb: what Rigo does here (Test, Decide, Do…), or the state of agents' work. */
  readonly badge: string;
  readonly tone: Tone;
  readonly title: string;
  readonly meta: string;
  /** What's asked of Rigo, in a line: the planner's to-do or the chat's hand-off. */
  readonly ask?: string;
  /** True when Rigo is the one holding it up; everything else is agents' or finished. */
  readonly mine: boolean;
  /** About how long it takes him, when that's known. */
  readonly minutes?: number;
  /** How long it has waited on him. */
  readonly waiting?: string;
  /** The planner to-do behind the row, for Done and "give it to an agent". */
  readonly todo?: PlannerTodo;
  /** Groups rows that aren't Rigo's: agents working, finished turns, older sheets. */
  readonly fold?: "agents" | "sheets";
  /** The priority (P0–P3) of the item behind the row, when there is one. */
  readonly priority?: string | null;
  readonly onClick: () => void;
}

const OTHER = "Other";
/** Queue order: finishing what's half done first, then quick calls, then longer work. */
const VERB_ORDER: Record<string, number> = {
  Retest: 0,
  Answer: 1,
  Approve: 1,
  "Needs you": 1,
  Decide: 2,
  Merge: 3,
  "Send back": 3,
  Close: 3,
  Blocked: 4,
  Review: 4,
  Read: 5,
  Test: 6,
  Do: 7,
};

/** What the Now tab lists: the chats, items, sheets and PRs to act on, and the version bumps left out. */
export interface NowInput {
  readonly nowMs: number;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly waiting: ReadonlyArray<DeskItem>;
  readonly prs: ReadonlyArray<DeskPr>;
  readonly appOf: (chat: CardChatState) => string | null;
  readonly apps: ReadonlyArray<string>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenSheet: (sheet: SheetSummary) => void;
  /** Chats' roles and `next` lines: what tells a finished turn that needs Rigo from one that doesn't. */
  readonly notes?: DeskNotes;
  /** Planners' open questions, each opening its planning session. */
  readonly decisions?: ReadonlyArray<PlannerDecision>;
  readonly onOpenDecision?: (decision: PlannerDecision) => void;
  /** Planners' open lines on Rigo, each opening its planning session. */
  readonly todos?: ReadonlyArray<PlannerTodo>;
  readonly onOpenTodo?: (todo: PlannerTodo) => void;
  /** Every Desk item: gives chats, sheets and to-dos their item's priority. */
  readonly items?: ReadonlyArray<DeskItem>;
}

/**
 * Fleet fork: the Now tab. One queue of what only Rigo can move, each row saying what he'll do
 * and about how long it takes; agents' work and finished turns fold away below it.
 */
export function NowView(
  props: NowInput & {
    /** The inbox and pinned chats, above the queue. */
    readonly pinned: ReactNode;
    /** What finished since he last caught up, below the queue. */
    readonly done?: ReactNode;
  },
) {
  const { entries: all, bumps } = useNowEntries(props);
  const [appFilter, setAppFilter] = useLocalStorage("t3-fleet:now-app", ANY, Schema.String);
  const [priorityFilter, setPriorityFilter] = useLocalStorage(
    "t3-fleet:now-priority",
    ANY,
    Schema.String,
  );
  // The app Rigo committed to: its rows go to the top of the queue, in their usual order.
  const [firstApp, setFirstApp] = useLocalStorage("t3-fleet:now-first-app", "", Schema.String);
  const priorityOf = (entry: Entry) => entry.priority ?? NO_PRIORITY;
  const entries = all
    .filter((entry) => appFilter === ANY || entry.app === appFilter)
    .filter((entry) => priorityFilter === ANY || priorityOf(entry) === priorityFilter)
    .toSorted((a, b) => Number(b.app === firstApp) - Number(a.app === firstApp));
  const queue = entries.filter((entry) => entry.mine);
  const agents = entries.filter((entry) => entry.fold === "agents");
  const older = entries.filter((entry) => entry.fold === "sheets");
  const mineAll = all.filter((entry) => entry.mine);
  const countBy = (key: (entry: Entry) => string, list: ReadonlyArray<Entry>) => {
    const counts = new Map<string, number>();
    for (const entry of list) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
    return counts;
  };
  // Counts follow the other filter, so each chip says what picking it would show.
  const appCounts = countBy(
    (entry) => entry.app,
    mineAll.filter((entry) => priorityFilter === ANY || priorityOf(entry) === priorityFilter),
  );
  const priorityCounts = countBy(
    priorityOf,
    mineAll.filter((entry) => appFilter === ANY || entry.app === appFilter),
  );
  const appChoices = [...appCounts.keys()]
    .filter((app) => app !== OTHER)
    .toSorted((a, b) => (appCounts.get(b) ?? 0) - (appCounts.get(a) ?? 0) || a.localeCompare(b));
  if (appFilter !== ANY && !appChoices.includes(appFilter)) appChoices.push(appFilter);
  if (appCounts.has(OTHER)) appChoices.push(OTHER);
  const minutes = queue.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0);
  const working = agents.filter((entry) => entry.lane === "working").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6 scrollbar-gutter-both">
      {props.pinned}
      <section aria-label="Your queue" className="mx-auto flex w-full max-w-4xl flex-col gap-2">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">
            {queue.length === 0
              ? "Nothing waits on you"
              : `Your queue · ${queue.length}${minutes > 0 ? ` · about ${minutes} min` : ""}`}
          </h2>
          <span className="text-xs text-muted-foreground">
            {queue.length > 0 ? "Work it top to bottom. " : ""}
            {agents.length > 0
              ? `Agents have ${agents.length} more (${working} working): nothing to do there.`
              : "No agent is busy."}
            {bumps > 0 ? ` ${bumps} version bumps not shown.` : ""}
          </span>
        </header>
        <QueueFilters
          apps={appChoices.map((app) => ({ value: app, count: appCounts.get(app) ?? 0 }))}
          priorities={PRIORITIES.map((priority) => ({
            value: priority,
            count: priorityCounts.get(priority) ?? 0,
          }))}
          app={appFilter}
          priority={priorityFilter}
          firstApp={firstApp}
          total={mineAll.length}
          onApp={setAppFilter}
          onPriority={setPriorityFilter}
          onFirstApp={setFirstApp}
        />
        {queue.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {queue.map((entry) => (
              <QueueRow key={entry.key} entry={entry} chats={props.chats} />
            ))}
          </ul>
        ) : null}
        <Fold
          label={`Agents on it · ${agents.length}`}
          hint="Working, waiting on a build, tests or a merge, or finished with nothing asked of you."
          entries={agents}
        />
        <Fold
          label={`Older sheets · ${older.length}`}
          hint={`Test sheets nobody touched or asked about in ${FRESH_SHEET_DAYS} days.`}
          entries={older}
        />
        {props.done}
      </section>
    </div>
  );
}

const ANY = "Any";
const NO_PRIORITY = "No priority";
const PRIORITIES = ["P0", "P1", "P2", "P3", NO_PRIORITY];

function Chip(props: {
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Button
      size="xs"
      variant={props.on ? "default" : "outline"}
      aria-pressed={props.on}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

/** Narrow the queue to one app or one priority, and put the app Rigo committed to first. */
function QueueFilters(props: {
  readonly apps: ReadonlyArray<{ readonly value: string; readonly count: number }>;
  readonly priorities: ReadonlyArray<{ readonly value: string; readonly count: number }>;
  readonly app: string;
  readonly priority: string;
  readonly firstApp: string;
  readonly total: number;
  readonly onApp: (app: string) => void;
  readonly onPriority: (priority: string) => void;
  readonly onFirstApp: (app: string) => void;
}) {
  const filtered = props.app !== ANY || props.priority !== ANY;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-14 shrink-0 text-2xs font-medium text-muted-foreground">App</span>
        <Chip on={props.app === ANY} onClick={() => props.onApp(ANY)}>
          All · {props.total}
        </Chip>
        {props.apps.map((app) => (
          <Chip key={app.value} on={props.app === app.value} onClick={() => props.onApp(app.value)}>
            {props.firstApp === app.value ? "★ " : ""}
            {app.value} · {app.count}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-14 shrink-0 text-2xs font-medium text-muted-foreground">Priority</span>
        <Chip on={props.priority === ANY} onClick={() => props.onPriority(ANY)}>
          Any
        </Chip>
        {props.priorities.map((priority) => (
          <Chip
            key={priority.value}
            on={props.priority === priority.value}
            onClick={() => props.onPriority(priority.value)}
          >
            {priority.value} · {priority.count}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        {props.firstApp ? (
          <>
            <span>
              ★ <b className="font-medium text-foreground">{props.firstApp}</b> goes first in the
              queue.
            </span>
            <Button size="xs" variant="ghost" onClick={() => props.onFirstApp("")}>
              Stop
            </Button>
          </>
        ) : null}
        {props.app !== ANY && props.app !== OTHER && props.firstApp !== props.app ? (
          <Button size="xs" variant="outline" onClick={() => props.onFirstApp(props.app)}>
            ★ Put {props.app} first
          </Button>
        ) : null}
        {filtered ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              props.onApp(ANY);
              props.onPriority(ANY);
            }}
          >
            Show everything
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function QueueRow(props: { readonly entry: Entry; readonly chats: ReadonlyArray<CardChatState> }) {
  const { entry } = props;
  const sendToChat = useSendToChat();
  const [handed, setHanded] = useState<"done" | "agent" | "yes" | "no" | null>(null);
  const decide = entry.badge === "Decide";
  const planner = entry.todo
    ? (props.chats.find((chat) => chat.threadId === entry.todo?.threadId) ?? null)
    : null;
  const todoText = entry.todo?.line.text ?? "";
  const done = () => {
    if (!entry.todo) return;
    savePlanLineDone(entry.todo.threadId, todoText);
    if (planner) void sendToChat(planner, `Done: ${todoText}`);
    setHanded("done");
  };
  // A planner's question written as a to-do: answer it from the row, and the line is settled.
  const answer = (choice: "yes" | "no") => {
    if (!entry.todo) return;
    savePlanLineDone(entry.todo.threadId, todoText);
    if (planner)
      void sendToChat(
        planner,
        `Decision on "${todoText}": ${choice === "yes" ? "yes, go ahead" : "no"}. Update the checklist; tell me only if it changes what I do.`,
      );
    setHanded(choice);
  };
  const toAgent = () => {
    if (!planner) return;
    void sendToChat(
      planner,
      `Not mine: "${todoText}". Have an agent do it, or wait until it's ready for me (then put it back with what I do and where). If only I can do it, tell me why in one line. Update the checklist either way.`,
    );
    setHanded("agent");
  };
  const meta = [
    entry.priority ?? null,
    entry.app === OTHER ? null : entry.app,
    entry.meta,
    entry.waiting ? `waiting ${entry.waiting}` : null,
    entry.minutes ? `~${entry.minutes} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2">
      <button
        type="button"
        onClick={entry.onClick}
        className="flex min-w-0 flex-[1_1_20rem] cursor-pointer items-start gap-2 text-left"
      >
        <Badge variant={entry.tone} size="sm" className="mt-0.5 w-20 shrink-0 justify-center">
          {entry.badge}
        </Badge>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-medium">{entry.title}</span>
          {entry.ask ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">{entry.ask}</span>
          ) : null}
          {meta ? <span className="text-2xs text-muted-foreground">{meta}</span> : null}
        </span>
      </button>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {entry.todo ? (
          handed ? (
            <span className="text-xs text-muted-foreground">
              {handed === "done"
                ? "Ticked, planner told"
                : handed === "agent"
                  ? "Handed to the planner"
                  : `Answered ${handed}, planner told`}
            </span>
          ) : (
            <>
              {decide ? (
                <>
                  <Button size="xs" onClick={() => answer("yes")}>
                    Yes
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => answer("no")}>
                    No
                  </Button>
                </>
              ) : (
                <Button size="xs" variant="outline" onClick={done}>
                  Done
                </Button>
              )}
              {planner ? (
                <Button size="xs" variant="ghost" onClick={toAgent}>
                  Not mine
                </Button>
              ) : null}
            </>
          )
        ) : null}
        <Button
          size="xs"
          variant={decide && entry.todo ? "ghost" : "default"}
          onClick={entry.onClick}
        >
          {entry.badge === "Sheet done" || (decide && entry.todo) ? "Open" : entry.badge}
        </Button>
      </span>
    </li>
  );
}

function Fold(props: {
  readonly label: string;
  readonly hint: string;
  readonly entries: ReadonlyArray<Entry>;
}) {
  if (props.entries.length === 0) return null;
  return (
    <details className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2">
        <span aria-hidden className="text-xs text-muted-foreground">
          ▸
        </span>
        <DeskHeading>{props.label}</DeskHeading>
        <span className="text-2xs text-muted-foreground">{props.hint}</span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {props.entries.map((entry) => (
          <li key={entry.key}>
            <button
              type="button"
              onClick={entry.onClick}
              className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 text-left text-sm hover:underline"
            >
              <Badge variant={entry.tone} size="sm" className="shrink-0">
                {entry.badge}
              </Badge>
              <span className="min-w-0 truncate">{entry.title}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                {[entry.app === OTHER ? null : entry.app, entry.ask ?? entry.meta]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Every row the Now tab shows, across apps, with the version bumps it leaves out. */
export function useNowEntries(props: NowInput): {
  readonly entries: ReadonlyArray<Entry>;
  readonly bumps: number;
} {
  const allSheets = useHubSheets();
  const sheets = sheetsToTest(allSheets, props.nowMs);
  const work = props.notes?.work ?? {};
  const appOfChat = (chat: CardChatState) => props.appOf(chat) ?? OTHER;
  const itemByUrl = new Map(
    (props.items ?? []).flatMap((item) => (item.url ? [[item.url, item] as const] : [])),
  );
  const priorityOfUrl = (url: string | null | undefined) =>
    (url ? itemByUrl.get(url)?.priority : null) ?? null;
  const chatPriority = (chat: CardChatState) =>
    priorityOfUrl(work[chat.threadId]?.items.findLast((span) => span.until === null)?.url);
  const sheetApp = (sheet: SheetSummary) => {
    const chat = props.chats.find((entry) => entry.threadId === sheet.thread?.threadId);
    if (chat) return appOfChat(chat);
    const title = sheet.title.toLowerCase();
    const named = props.apps.find((app) => title.includes(app.toLowerCase()));
    if (named) return named;
    // A repo named in the title: the app of that repo's items.
    const repoItem = (props.items ?? []).find((item) => {
      const repo = item.repo?.split("/").pop()?.toLowerCase();
      return item.app && repo && title.includes(repo);
    });
    return repoItem?.app ?? OTHER;
  };
  const chatEntry = (
    chat: CardChatState,
    lane: Lane,
    badge: string,
    tone: Tone,
    extra: Partial<Entry> & Pick<Entry, "mine">,
  ): Entry => ({
    key: `chat:${chat.environmentId}:${chat.threadId}`,
    lane,
    app: appOfChat(chat),
    badge,
    tone,
    title: chatTitle(chat.title),
    meta: ago(props.nowMs, chat.since),
    priority: chatPriority(chat),
    onClick: () => props.onOpenChat(chat),
    ...extra,
  });
  // A planner's to-do that points at a test sheet is the same work as the sheet's card: it shows
  // once, as the sheet with the ask on it, and opens where it's done.
  const sheetOf = (todo: PlannerTodo) =>
    allSheets.find((sheet) =>
      [...(todo.line.links ?? []), todo.line.how ?? "", todo.line.text].some((text) =>
        text.includes(sheet.id),
      ),
    ) ?? null;
  const asksBySheet = new Map<string, string[]>();
  const appBySheet = new Map<string, string>();
  const folded = new Set<PlannerTodo>();
  // A to-do about a sheet that's finished is likely done: say so instead of asking again.
  const finished = new Set<PlannerTodo>();
  for (const todo of props.todos ?? []) {
    const sheet = sheetOf(todo);
    if (!sheet) continue;
    if (uncheckedRows(sheet.counts) === 0) {
      finished.add(todo);
      continue;
    }
    if (!sheets.some((entry) => entry.id === sheet.id)) continue;
    asksBySheet.set(sheet.id, [...(asksBySheet.get(sheet.id) ?? []), todo.line.text]);
    if (todo.app) appBySheet.set(sheet.id, todo.app);
    folded.add(todo);
  }
  // A PR and its test sheet are one piece of work: Merge waits for the sheet, and a sheet whose PR
  // is being sent back waits for the fix.
  const prRef = (pr: DeskPr) => `${pr.repo.split("/").pop()}#${pr.number}`;
  const openPrs = props.prs.filter(
    (pr) => (pr.stage === "ready" || pr.stage === "fix") && !isDependencyUpdate(pr),
  );
  const prsBySheet = new Map<string, DeskPr[]>();
  const sheetsByPr = new Map<string, SheetSummary[]>();
  for (const pr of openPrs) {
    const tested = sheetsTestingPr(sheets, pr, sheetApp);
    sheetsByPr.set(pr.url, tested);
    for (const sheet of tested) prsBySheet.set(sheet.id, [...(prsBySheet.get(sheet.id) ?? []), pr]);
  }
  const entries: Entry[] = [
    ...props.chats
      .filter((chat) => chat.working)
      .map((chat) =>
        chatEntry(chat, "working", "Working", "info", {
          mine: false,
          fold: "agents",
          ...(work[chat.threadId]?.next ? { ask: work[chat.threadId]?.next ?? "" } : {}),
        }),
      ),
    ...props.chats
      .filter((chat) => chat.needsYou)
      .map((chat) =>
        chatEntry(
          chat,
          "review",
          chat.asking === "subagent approval" || chat.asking === "approval"
            ? "Approve"
            : chat.asking === "question"
              ? "Answer"
              : "Needs you",
          "warning",
          { mine: true, minutes: 2, waiting: ago(props.nowMs, chat.since) },
        ),
      ),
    // A finished turn is Rigo's only when the chat handed it to him ("next: Rigo: …"); otherwise
    // it's news, folded with the agents' work, its next step in view so there's no need to open it.
    ...props.chats
      .filter((chat) => !chat.needsYou && !chat.working && chat.column === "done")
      .map((chat) => {
        const next = work[chat.threadId]?.next ?? null;
        const planner = work[chat.threadId]?.role === "planner";
        // Its item shipped: whatever it last asked of Rigo is stale, and it wraps up on its own.
        const shipped =
          !planner && props.notes && props.items
            ? shippedFocus(props.notes, chat.threadId, props.items)
            : null;
        if (shipped)
          return chatEntry(chat, "review", "Merged", "secondary", {
            mine: false,
            fold: "agents",
            ask: `${deskRef(shipped) ?? "Its item"} shipped: ${next?.startsWith(WRAP_ASKED) ? "wrapping up" : "wrap-up next"}`,
          });
        return next && RIGO_NEXT.test(next) && !planner
          ? chatEntry(chat, "review", "Read", "success", {
              mine: true,
              ask: next.replace(RIGO_NEXT, ""),
              minutes: 2,
              waiting: ago(props.nowMs, chat.since),
            })
          : chatEntry(chat, "review", "Finished", "secondary", {
              mine: false,
              fold: "agents",
              ask: next ?? (planner ? "planner: its asks are on your queue" : "nothing asked"),
            });
      }),
    // A blocked item is Rigo's to unblock. One "In Review" with an open PR is really that PR:
    // shown once as its Merge row when it's ready, otherwise folded with what it waits on.
    ...props.waiting.flatMap((item): Entry[] => {
      const base = {
        key: `item:${item.itemId}`,
        lane: "review" as const,
        app: item.app ?? OTHER,
        title: deskTitle(item),
        meta: deskRef(item) ?? "",
        priority: item.priority,
        onClick: () => props.onOpenItem(item),
      };
      if (item.lane === "Blocked")
        return [{ ...base, badge: "Blocked", tone: "error", mine: true }];
      const urls = new Set(item.pullRequests.map((pr) => pr.url));
      const prs = props.prs.filter((pr) => urls.has(pr.url) || pr.item?.itemId === item.itemId);
      if (prs.some((pr) => pr.stage === "ready" || pr.stage === "fix" || pr.stage === "landed"))
        return [];
      const why = prs.flatMap((pr) => pr.reasons).join(", ");
      return [
        {
          ...base,
          badge: "In review",
          tone: "secondary",
          mine: false,
          fold: "agents",
          ask: why ? `PR waiting: ${why}` : "PR not seen yet",
        },
      ];
    }),
    ...sheets.map((sheet): Entry => {
      const { total, pass, fail, skip, blocked } = sheet.counts;
      const retest = sheet.counts.retest ?? 0;
      const left = uncheckedRows(sheet.counts);
      const noted = sheet.counts.noted ?? 0;
      const asks = asksBySheet.get(sheet.id) ?? [];
      const fresh = props.nowMs - Date.parse(sheet.updatedAt) < FRESH_SHEET_DAYS * DAY_MS;
      const turn = sheetTurn(sheet);
      const prs = prsBySheet.get(sheet.id) ?? [];
      const fixing = prs.find((pr) => pr.stage === "fix");
      const merging = prs.find((pr) => pr.stage === "ready");
      const common = {
        key: `sheet:${sheet.id}`,
        lane: "test" as const,
        app: appBySheet.get(sheet.id) ?? sheetApp(sheet),
        title: sheet.title,
        meta: `${pass + fail + skip + blocked + noted} of ${total} answered`,
        priority:
          (props.notes ? itemForSheet(sheet, props.items ?? [], props.notes)?.priority : null) ??
          null,
        onClick: () => props.onOpenSheet(sheet),
      };
      // Submitted: the chat has his results and notes; it comes back as re-tests when fixed.
      if (turn === "agent")
        return {
          ...common,
          badge: "Sent",
          tone: "secondary",
          ask: `You submitted ${ago(props.nowMs, sheet.submittedAt)} ago; the chat is acting on your ${fail + noted > 0 ? "notes" : "results"}`,
          mine: false,
          fold: "agents",
        };
      // Its chat is working (on feedback sent from the Test page, say): nothing to test until it's done.
      const busy = props.chats.find(
        (chat) => chat.threadId === sheet.thread?.threadId && (chat.working || chat.needsYou),
      );
      if (busy?.working && retest === 0)
        return {
          ...common,
          badge: "Test",
          tone: "secondary",
          ask: `${chatTitle(busy.title)} is working on it; test when it hands back`,
          mine: false,
          fold: "agents",
        };
      if (fixing && retest === 0)
        return {
          ...common,
          badge: "Test",
          tone: "secondary",
          ask: `Test once ${prRef(fixing)} is fixed (it's on Send back: ${fixing.reasons.join(", ")})`,
          mine: false,
          fold: "agents",
        };
      const then = merging ? `, then Merge ${prRef(merging)}` : "";
      const mine = retest > 0 || asks.length > 0 || fresh || turn === "issues" || !!merging;
      return {
        ...common,
        badge: retest > 0 ? "Retest" : "Test",
        tone: retest > 0 || fail > 0 ? "error" : "warning",
        ask:
          retest > 0
            ? `${retest} fixed ${retest === 1 ? "check" : "checks"} to re-test${then}`
            : turn === "issues"
              ? `Every check answered: press Submit so the chat gets your ${fail > 0 ? "failures and notes" : "notes"}`
              : asks[0]
                ? `Planner asks: ${asks[0]}${asks.length > 1 ? ` (+${asks.length - 1} more)` : ""}${then}`
                : `${left} ${left === 1 ? "check" : "checks"} left${then}`,
        mine,
        ...(mine ? { minutes: Math.max(2, retest > 0 ? retest : left) } : { fold: "sheets" }),
        waiting: ago(props.nowMs, sheet.updatedAt),
      } as Entry;
    }),
    ...props.prs
      .filter(
        (pr) =>
          (pr.stage === "ready" || pr.stage === "landed" || pr.stage === "fix") &&
          !isDependencyUpdate(pr),
      )
      // A ready PR whose test sheet is still Rigo's shows once, as that sheet ("…, then Merge").
      .filter(
        (pr) =>
          pr.stage !== "ready" ||
          !(sheetsByPr.get(pr.url) ?? []).some((sheet) => {
            const turn = sheetTurn(sheet);
            return turn === "rigo" || turn === "issues";
          }),
      )
      .map((pr): Entry => {
        const stage = PR_LABEL[pr.stage as keyof typeof PR_LABEL];
        const ref = `${pr.repo.split("/").pop()}#${pr.number}`;
        // GitHub can call a PR ready while its chats are still pushing to it: not Rigo's yet.
        const busy = pr.chats.filter((chat) => chat.working || chat.needsYou);
        // Its test results went back to the chat: Merge waits for the fixes and a re-test.
        const sent =
          pr.stage === "ready" &&
          (sheetsByPr.get(pr.url) ?? []).some((sheet) => sheetTurn(sheet) === "agent");
        if (sent && busy.length === 0)
          return {
            key: `pr:${pr.url}`,
            lane: "merge",
            app: pr.app ?? OTHER,
            badge: "Agents on it",
            tone: "info",
            title: pr.title && pr.title !== ref ? pr.title : (pr.item?.title ?? pr.title),
            meta: ref,
            priority: pr.item?.priority ?? null,
            ask: "Merge after the chat acts on your test results and you re-test",
            mine: false,
            fold: "agents",
            onClick: () => props.onOpenPr(pr),
          };
        const title = pr.title && pr.title !== ref ? pr.title : (pr.item?.title ?? pr.title);
        return busy.length > 0
          ? {
              key: `pr:${pr.url}`,
              lane: "merge",
              app: pr.app ?? OTHER,
              badge: "Agents on it",
              tone: "info",
              title,
              meta: ref,
              priority: pr.item?.priority ?? null,
              ask: `${stage.label} once ${busy.map((chat) => chatTitle(chat.title)).join(", ")} ${busy.length === 1 ? "finishes" : "finish"}`,
              mine: false,
              fold: "agents",
              onClick: () => props.onOpenPr(pr),
            }
          : {
              key: `pr:${pr.url}`,
              lane: "merge",
              app: pr.app ?? OTHER,
              badge: stage.label,
              tone: stage.tone,
              title,
              meta: ref,
              priority: pr.item?.priority ?? null,
              mine: true,
              minutes: 2,
              onClick: () => props.onOpenPr(pr),
            };
      }),
  ];
  const decisions = (props.decisions ?? []).map((decision): Entry => ({
    key: `decision:${decision.id}`,
    lane: "review",
    app: decision.app ?? OTHER,
    badge: "Decide",
    tone: "warning",
    title: decision.question,
    meta: "",
    ...(decision.recommended ? { ask: `Recommended: ${decision.recommended}` } : {}),
    mine: true,
    minutes: 1,
    onClick: () => props.onOpenDecision?.(decision),
  }));
  // A planner's line about an item or PR already listed shows once, as that row.
  const listed = new Set([
    ...props.waiting.flatMap((item) => [item.url, ...item.pullRequests.map((pr) => pr.url)]),
    ...props.prs.flatMap((pr) => [pr.url, pr.item?.url]),
  ]);
  const todos = (props.todos ?? [])
    .filter((todo) => !folded.has(todo))
    .filter((todo) => !todo.line.itemUrl || !listed.has(todo.line.itemUrl))
    .map((todo): Entry => {
      const decide = /^decide\b/i.test(todo.line.text);
      return {
        key: `todo:${todo.threadId}:${todo.line.text}`,
        lane: "review",
        app: todo.app ?? OTHER,
        badge: finished.has(todo) ? "Sheet done" : decide ? "Decide" : "Do",
        tone: finished.has(todo) ? "success" : "warning",
        title: todo.line.text,
        meta: "",
        priority: priorityOfUrl(todo.line.itemUrl),
        ask: finished.has(todo)
          ? "Its sheet is finished: press Done to tell the planner"
          : (todo.line.why ?? "from the planner"),
        mine: true,
        ...(decide ? { minutes: 1 } : {}),
        ...(todo.line.since ? { waiting: ago(props.nowMs, todo.line.since) } : {}),
        todo,
        onClick: () => props.onOpenTodo?.(todo),
      };
    });
  const bumps = props.prs.filter((pr) => pr.stage === "ready" && isDependencyUpdate(pr)).length;
  const order = (entry: Entry) => VERB_ORDER[entry.badge] ?? 8;
  return {
    entries: [...decisions, ...todos, ...entries].toSorted((a, b) => order(a) - order(b)),
    bumps,
  };
}
