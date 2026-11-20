import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import type { CardChatState } from "./boardCards.logic";
import { chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import { isDependencyUpdate, type DeskPr } from "./deskPrs.logic";
import { DeskHeading } from "./DeskParts";
import { type SheetSummary, uncheckedRows, useHubSheets } from "./deskSheets";
import type { PlannerDecision } from "./deskNotes.logic";

const SHEET_DAYS = 14;

/** Test sheets on the hub with unchecked rows, changed in the last two weeks, newest first. */
function useSheetsToTest(nowMs: number): SheetSummary[] {
  return useHubSheets()
    .filter(
      (sheet) =>
        uncheckedRows(sheet.counts) > 0 &&
        nowMs - Date.parse(sheet.updatedAt) < SHEET_DAYS * 86_400_000,
    )
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function ago(nowMs: number, iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

const PR_LABEL = {
  ready: { label: "Merge", tone: "success" },
  landed: { label: "Close", tone: "secondary" },
  fix: { label: "Send back", tone: "error" },
} as const;

type Tone = "success" | "error" | "warning" | "info" | "outline" | "secondary";
export type Lane = "working" | "review" | "test" | "merge";
const LANES: ReadonlyArray<{ readonly id: Lane; readonly label: string; readonly hint: string }> = [
  { id: "working", label: "Working", hint: "Agents running now" },
  { id: "review", label: "Review", hint: "Questions, approvals, results" },
  { id: "test", label: "Test", hint: "Sheets with checks to do" },
  { id: "merge", label: "Merge", hint: "Merge, close or send back" },
];

export interface Entry {
  readonly key: string;
  readonly lane: Lane;
  readonly app: string;
  readonly badge: string;
  readonly tone: Tone;
  readonly title: string;
  readonly meta: string;
  readonly onClick: () => void;
}

const OTHER = "Other";
/** How much an app needs Rigo: reviews first, then merges, tests, and running work last. */
const WEIGHT: Record<Lane, number> = { review: 100, merge: 10, test: 3, working: 1 };

/**
 * Fleet fork: the Now tab, every application at once. One band per app that has something going
 * on, the one that needs Rigo most first; across each band, what's working and what waits on him
 * to review, test or merge. Each row is one click to act on.
 */
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
  /** Planners' open questions, each opening its planning session. */
  readonly decisions?: ReadonlyArray<PlannerDecision>;
  readonly onOpenDecision?: (decision: PlannerDecision) => void;
}

export function NowView(props: {
  readonly nowMs: number;
  readonly chats: ReadonlyArray<CardChatState>;
  /** Items waiting on Rigo outside chats (blocked, PRs in review). */
  readonly waiting: ReadonlyArray<DeskItem>;
  readonly prs: ReadonlyArray<DeskPr>;
  readonly appOf: (chat: CardChatState) => string | null;
  readonly apps: ReadonlyArray<string>;
  readonly pinned: ReactNode;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
  /** Opens a test sheet in its item's Review tab, or on its own when no item matches. */
  readonly onOpenSheet: (sheet: SheetSummary) => void;
  readonly decisions?: ReadonlyArray<PlannerDecision>;
  readonly onOpenDecision?: (decision: PlannerDecision) => void;
}) {
  const { entries, bumps } = useNowEntries(props);
  const count = (lane: Lane, of: ReadonlyArray<Entry> = entries) =>
    of.filter((entry) => entry.lane === lane).length;
  const bands = [...new Set(entries.map((entry) => entry.app))]
    .map((app) => ({ app, entries: entries.filter((entry) => entry.app === app) }))
    .map((band) => ({
      ...band,
      weight: LANES.reduce((sum, lane) => sum + WEIGHT[lane.id] * count(lane.id, band.entries), 0),
    }))
    .toSorted(
      (a, b) =>
        Number(a.app === OTHER) - Number(b.app === OTHER) ||
        b.weight - a.weight ||
        a.app.localeCompare(b.app),
    );
  const needsYou = count("review") + count("test") + count("merge");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">
          {needsYou === 0 ? "Nothing needs you right now" : `${needsYou} things need you`}
        </h2>
        <span className="text-xs text-muted-foreground">
          {count("review")} to review · {count("test")} to test · {count("merge")} to merge or send
          back · {count("working")} {count("working") === 1 ? "agent" : "agents"} working
          {bumps > 0 ? ` · ${bumps} version bumps not shown` : ""}
        </span>
      </header>
      {props.pinned}
      <div className="hidden grid-cols-[12rem_repeat(4,minmax(0,1fr))] gap-3 px-3 lg:grid">
        <span />
        {LANES.map((lane) => (
          <span key={lane.id} className="flex flex-col">
            <DeskHeading>
              {lane.label} · {count(lane.id)}
            </DeskHeading>
            <span className="text-2xs text-muted-foreground">{lane.hint}</span>
          </span>
        ))}
      </div>
      {bands.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agent is running and nothing waits on you.
        </p>
      ) : (
        bands.map((band) => (
          <section
            key={band.app}
            aria-label={band.app}
            className={cn(
              "grid grid-cols-1 gap-3 rounded-lg border bg-muted/40 p-3 lg:grid-cols-[12rem_repeat(4,minmax(0,1fr))]",
              count("review", band.entries) > 0 ? "border-warning/60" : "border-border",
            )}
          >
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">{band.app}</h3>
              <span className="flex flex-wrap gap-1">
                {LANES.filter(
                  (lane) => lane.id !== "working" && count(lane.id, band.entries) > 0,
                ).map((lane) => (
                  <Badge
                    key={lane.id}
                    variant={lane.id === "review" ? "warning" : "outline"}
                    size="sm"
                  >
                    {count(lane.id, band.entries)} to {lane.label.toLowerCase()}
                  </Badge>
                ))}
                {count("working", band.entries) > 0 ? (
                  <Badge variant="info" size="sm">
                    {count("working", band.entries)} working
                  </Badge>
                ) : null}
              </span>
            </header>
            {LANES.map((lane) => {
              const cell = band.entries.filter((entry) => entry.lane === lane.id);
              return (
                <div key={lane.id} className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase lg:hidden">
                    {lane.label}
                  </span>
                  {cell.length === 0 ? (
                    <span className="hidden text-xs text-muted-foreground lg:block">·</span>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {cell.map((entry) => (
                        <Row
                          key={entry.key}
                          badge={entry.badge}
                          tone={entry.tone}
                          title={entry.title}
                          meta={entry.meta}
                          onClick={entry.onClick}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}

/** Every row the Now tab shows, across apps, with the version bumps it leaves out. */
export function useNowEntries(props: NowInput): {
  readonly entries: ReadonlyArray<Entry>;
  readonly bumps: number;
} {
  const sheets = useSheetsToTest(props.nowMs);
  const appOfChat = (chat: CardChatState) => props.appOf(chat) ?? OTHER;
  const sheetApp = (sheet: SheetSummary) => {
    const chat = props.chats.find((entry) => entry.threadId === sheet.thread?.threadId);
    if (chat) return appOfChat(chat);
    const title = sheet.title.toLowerCase();
    return props.apps.find((app) => title.includes(app.toLowerCase())) ?? OTHER;
  };
  const chatEntry = (chat: CardChatState, lane: Lane, badge: string, tone: Tone): Entry => ({
    key: `chat:${chat.environmentId}:${chat.threadId}`,
    lane,
    app: appOfChat(chat),
    badge,
    tone,
    title: chatTitle(chat.title),
    meta: ago(props.nowMs, chat.since),
    onClick: () => props.onOpenChat(chat),
  });
  const entries: Entry[] = [
    ...props.chats
      .filter((chat) => chat.working)
      .map((chat) => chatEntry(chat, "working", "Working", "info")),
    ...props.chats
      .filter((chat) => chat.needsYou)
      .map((chat) =>
        chatEntry(
          chat,
          "review",
          chat.asking === "subagent approval"
            ? "Subagent approval"
            : chat.asking === "approval"
              ? "Approve"
              : chat.asking === "question"
                ? "Answer"
                : "Needs you",
          "warning",
        ),
      ),
    ...props.chats
      .filter((chat) => !chat.needsYou && chat.column === "done")
      .map((chat) => chatEntry(chat, "review", "Result", "success")),
    ...props.waiting.map((item): Entry => ({
      key: `item:${item.itemId}`,
      lane: "review",
      app: item.app ?? OTHER,
      badge: item.lane === "Blocked" ? "Blocked" : "Review",
      tone: item.lane === "Blocked" ? "error" : "info",
      title: deskTitle(item),
      meta: deskRef(item) ?? "",
      onClick: () => props.onOpenItem(item),
    })),
    ...sheets.map((sheet): Entry => {
      const { total, pass, fail, skip, blocked } = sheet.counts;
      return {
        key: `sheet:${sheet.id}`,
        lane: "test",
        app: sheetApp(sheet),
        badge: `${pass + fail + skip + blocked} of ${total}`,
        tone: fail > 0 ? "error" : "outline",
        title: sheet.title,
        meta: ago(props.nowMs, sheet.updatedAt),
        onClick: () => props.onOpenSheet(sheet),
      };
    }),
    ...props.prs
      .filter(
        (pr) =>
          (pr.stage === "ready" || pr.stage === "landed" || pr.stage === "fix") &&
          !isDependencyUpdate(pr),
      )
      .map((pr): Entry => {
        const stage = PR_LABEL[pr.stage as keyof typeof PR_LABEL];
        return {
          key: `pr:${pr.url}`,
          lane: "merge",
          app: pr.app ?? OTHER,
          badge: stage.label,
          tone: stage.tone,
          title: pr.title,
          meta: `${pr.repo.split("/").pop()}#${pr.number}`,
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
    title: `${decision.app ?? "Planner"}: ${decision.question}`,
    meta: decision.recommended ? `rec: ${decision.recommended}` : "",
    onClick: () => props.onOpenDecision?.(decision),
  }));
  const bumps = props.prs.filter((pr) => pr.stage === "ready" && isDependencyUpdate(pr)).length;
  return { entries: [...decisions, ...entries], bumps };
}

function Row(props: {
  readonly badge: string;
  readonly tone: Tone;
  readonly title: string;
  readonly meta: string;
  readonly onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={props.onClick}
        className="flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-2 text-left hover:border-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Badge variant={props.tone} size="sm">
            {props.badge}
          </Badge>
          <span className="truncate text-2xs text-muted-foreground">{props.meta}</span>
        </span>
        <span className="line-clamp-2 text-sm">{props.title}</span>
      </button>
    </li>
  );
}
