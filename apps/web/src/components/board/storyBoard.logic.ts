/**
 * Fleet fork: the Stories tab (agreed with Rigo, 2026-11-24). Every story and quick fix in play,
 * at its stage of the journey, with the one move that's next: Rigo's (with what to do) or the
 * agents'. A planner's grouping card waits in Proposed until he answers it.
 */
import type { CardChatState } from "./boardCards.logic";
import { type DeskItem, deskRef, deskTitle } from "./desk.logic";
import {
  type DeskNotes,
  focusedThreads,
  type PlannerDecision,
  type Star,
  starOn,
} from "./deskNotes.logic";
import type { DeskPr } from "./deskPrs.logic";
import { type SheetSummary, sheetsTestingPr, sheetTurn, uncheckedRows } from "./deskSheets";
import { isShipped } from "./wrapUp.logic";

export const STAGES = [
  { id: "proposed", label: "Proposed" },
  { id: "planned", label: "Planned" },
  { id: "mockup", label: "Mockup" },
  { id: "build", label: "Build" },
  { id: "test", label: "Test" },
  { id: "merge", label: "Merge" },
  { id: "wrapup", label: "Wrap up" },
] as const;
export type StoryStage = (typeof STAGES)[number]["id"];

export interface StoryCard {
  readonly key: string;
  readonly stage: StoryStage;
  readonly app: string | null;
  readonly title: string;
  readonly ref: string | null;
  /** A story, or a quick fix (bugs and maintenance), or a planner's grouping proposal. */
  readonly kind: "story" | "fix" | "proposal";
  /** What happens next: Rigo's move (a verb and what to do) or what the agents are doing. */
  readonly move: { readonly mine: boolean; readonly verb: string; readonly text: string };
  readonly item: DeskItem | null;
  readonly decision: PlannerDecision | null;
  readonly sheet: SheetSummary | null;
  readonly pr: DeskPr | null;
  readonly lead: CardChatState | null;
  /** P0–P3 from the item, when set. */
  readonly priority: string | null;
  /** The area ("<App> · <feature>") the story belongs to. */
  readonly feature: string | null;
  /** Rigo's star on its area or app, while it's on: it goes first. */
  readonly star: Star | null;
  /** What the agents last did: "Working now", or "Updated 25m ago: <its report's first line>". */
  readonly activity: string | null;
}

const ago = (nowMs: number, iso: string) => {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

/** A report's gist: its first real line, without markdown or the "Goal:" header. */
export function reportGist(text: string): string {
  const line =
    text
      .split("\n")
      .map((entry) =>
        entry
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/^\s*#+\s*/, "")
          .replace(/[*_`>]/g, "")
          .replace(/^\s*[-•]\s*/, "")
          .trim(),
      )
      .find((entry) => entry && !/^goal:/i.test(entry) && !/^(done|needs you):?$/i.test(entry)) ??
    "";
  return line.length > 110 ? `${line.slice(0, 107)}…` : line;
}

/** What a chat is doing, in a few words: working now, or its last update and when. */
function chatActivity(
  chat: CardChatState | null | undefined,
  notes: DeskNotes,
  nowMs: number,
): string | null {
  if (!chat) return null;
  if (chat.working) return "Working now";
  const report = notes.work[chat.threadId]?.report;
  if (report) {
    const gist = reportGist(report.text);
    return `Updated ${ago(nowMs, report.at)} ago${gist ? `: ${gist}` : ""}`;
  }
  return chat.since ? `Idle ${ago(nowMs, chat.since)}` : null;
}

/** What's moving across the agents: how many work now, and the latest updates, newest first. */
export function recentActivity(
  notes: DeskNotes,
  chats: ReadonlyArray<CardChatState>,
  nowMs: number,
): {
  readonly working: number;
  readonly lastAt: string | null;
  readonly recent: ReadonlyArray<{
    readonly at: string;
    readonly who: string;
    readonly line: string;
  }>;
} {
  const byThread = new Map(chats.map((chat) => [chat.threadId, chat]));
  const recent = Object.entries(notes.work)
    .flatMap(([threadId, work]) => {
      const report = work.report;
      if (!report || nowMs - Date.parse(report.at) > 6 * 3_600_000) return [];
      const chat = byThread.get(threadId);
      const role = work.role === "planner" ? "Planner" : work.role === "helper" ? "Helper" : "Lead";
      const who = chat?.title ?? [role, work.app].filter(Boolean).join(" · ");
      return [{ at: report.at, who, line: reportGist(report.text) }];
    })
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  return {
    working: chats.filter((chat) => chat.working).length,
    lastAt: recent[0]?.at ?? null,
    recent,
  };
}

const QUICK_FIX_TYPES = new Set(["Bug", "Maintenance"]);
const isOpen = (item: DeskItem) => item.state === "open" || item.state === "draft";

/** Every story and quick fix in play, each at its stage, with grouping proposals first. */
export function buildStoryBoard(input: {
  readonly items: ReadonlyArray<DeskItem>;
  readonly prs: ReadonlyArray<DeskPr>;
  readonly sheets: ReadonlyArray<SheetSummary>;
  readonly notes: DeskNotes;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly decisions: ReadonlyArray<PlannerDecision>;
  /** Decisions Rigo answered recently: an approved grouping stays in view while it's set up. */
  readonly answered?: ReadonlyArray<PlannerDecision>;
  /** The current sprint's title: its items are in play even before a chat is on them. */
  readonly sprint: string | null;
  readonly appOfSheet: (sheet: SheetSummary) => string;
  readonly nowMs: number;
}): StoryCard[] {
  const cards: StoryCard[] = [];
  for (const decision of input.decisions) {
    // A planner's grouping or story map ("Group …", "… as 6 areas …: approve this map?").
    if (!/^\s*group\b|\bmap\b|\bstories\b/i.test(decision.question)) continue;
    const planner = input.chats.find((chat) => chat.threadId === decision.threadId);
    cards.push({
      key: `decision:${decision.id}`,
      stage: "proposed",
      app: decision.app,
      title: decision.question,
      ref: null,
      kind: "proposal",
      // While its planner works (often on Rigo's comments), the card isn't his yet.
      move: planner?.working
        ? { mine: false, verb: "Agents", text: "Planner is revising this with your comments" }
        : { mine: true, verb: "Decide", text: "Approve, comment or change the grouping" },
      item: null,
      decision,
      sheet: null,
      pr: null,
      lead: null,
      priority: null,
      feature: null,
      star: starOn(input.notes, decision.app, null, input.nowMs),
      activity: chatActivity(planner, input.notes, input.nowMs),
    });
  }
  // An answered grouping stays a few hours, so the hand-off to the planner is visible.
  for (const decision of input.answered ?? []) {
    if (!decision.answer || !/^\s*group\b|\bmap\b|\bstories\b/i.test(decision.question)) continue;
    if (input.nowMs - Date.parse(decision.answer.at) > 4 * 3_600_000) continue;
    const planner = input.chats.find((chat) => chat.threadId === decision.threadId);
    cards.push({
      key: `decision:${decision.id}`,
      stage: "proposed",
      app: decision.app,
      title: decision.question,
      ref: null,
      kind: "proposal",
      move: {
        mine: false,
        verb: "Agents",
        text: `✓ You answered "${decision.answer.choice}" ${ago(input.nowMs, decision.answer.at)} ago · ${planner?.working ? "planner is setting up the stories" : "planner has set them up; see them by area and sprint on Map"}`,
      },
      item: null,
      decision,
      sheet: null,
      pr: null,
      lead: null,
      priority: null,
      feature: null,
      star: null,
      activity: chatActivity(planner, input.notes, input.nowMs),
    });
  }
  for (const item of input.items) {
    if (item.kind !== "issue" || !item.url || item.workType === "Tracking") continue;
    const leads = focusedThreads(input.notes, item.url);
    const lead = input.chats.find((chat) => leads.has(chat.threadId)) ?? null;
    const leadWork = lead ? input.notes.work[lead.threadId] : undefined;
    const shipped = isShipped(item);
    // In play: open and in the sprint or worked on, or shipped with its wrap-up not done yet.
    const inPlay = shipped
      ? lead !== null && Boolean(leadWork?.next?.trim())
      : isOpen(item) && (item.sprint?.title === input.sprint || lead !== null);
    if (!inPlay) continue;
    const urls = new Set(item.pullRequests.map((pr) => pr.url));
    const prs = input.prs.filter((pr) => urls.has(pr.url) || pr.item?.itemId === item.itemId);
    const sheets = [
      ...new Map(
        [
          ...(item.number !== null && item.repo
            ? sheetsTestingPr(
                input.sheets,
                { repo: item.repo, number: item.number, app: item.app },
                input.appOfSheet,
              )
            : []),
          ...prs.flatMap((pr) => sheetsTestingPr(input.sheets, pr, input.appOfSheet)),
        ].map((sheet) => [sheet.id, sheet] as const),
      ).values(),
    ];
    const openSheet = sheets.find((sheet) => sheetTurn(sheet) !== "clean") ?? null;
    const mockup =
      input.decisions.find(
        (decision) =>
          /mock/i.test(decision.question) &&
          (decision.itemUrl === item.url || decision.links.includes(item.url ?? "")),
      ) ?? null;
    const ready = prs.find((pr) => pr.stage === "ready") ?? null;
    const fixing = prs.find((pr) => pr.stage === "fix") ?? null;
    const base = {
      key: `item:${item.itemId}`,
      app: item.app,
      title: deskTitle(item),
      ref: deskRef(item),
      kind: QUICK_FIX_TYPES.has(item.workType ?? "") ? ("fix" as const) : ("story" as const),
      item,
      decision: null,
      sheet: openSheet,
      pr: ready ?? fixing ?? prs[0] ?? null,
      lead,
      priority: item.priority,
      feature: item.feature,
      star: starOn(input.notes, item.app, item.feature, input.nowMs),
      activity: chatActivity(lead, input.notes, input.nowMs),
    };
    const agents = (text: string) => ({ mine: false, verb: "Agents", text });
    const leadState = lead ? (lead.working ? "lead working" : "lead idle") : "no lead yet";
    if (shipped) {
      cards.push({ ...base, stage: "wrapup", move: agents("Lead is closing it out") });
    } else if (mockup) {
      cards.push({
        ...base,
        stage: "mockup",
        decision: mockup,
        move: { mine: true, verb: "Decide", text: "Confirm the mockup level" },
      });
    } else if (openSheet && sheetTurn(openSheet) !== "agent" && !fixing) {
      const retest = openSheet.counts.retest ?? 0;
      const left = uncheckedRows(openSheet.counts);
      cards.push({
        ...base,
        stage: "test",
        move: {
          mine: true,
          verb: retest > 0 ? "Retest" : "Test",
          text:
            retest > 0
              ? `Re-test ${retest} fixed ${retest === 1 ? "check" : "checks"}`
              : left > 0
                ? `Test ${left} ${left === 1 ? "check" : "checks"} (~${Math.max(2, left)} min)`
                : "Every check answered: press Submit",
        },
      });
    } else if (openSheet) {
      cards.push({ ...base, stage: "test", move: agents("Fixing what your test found") });
    } else if (ready) {
      cards.push({
        ...base,
        stage: "merge",
        move: { mine: true, verb: "Merge", text: `Merge PR #${ready.number}` },
      });
    } else if (fixing) {
      cards.push({
        ...base,
        stage: "build",
        move: agents(`Fixing PR #${fixing.number}: ${fixing.reasons.join(", ")}`),
      });
    } else if (lead || prs.length > 0 || item.status === "In Progress") {
      cards.push({ ...base, stage: "build", move: agents(`Building · ${leadState}`) });
    } else {
      cards.push({
        ...base,
        stage: "planned",
        move: agents("Waiting for its planner to start a lead"),
      });
    }
  }
  const stage = new Map(STAGES.map((entry, index) => [entry.id, index]));
  return cards.toSorted(
    (a, b) => (stage.get(a.stage) ?? 0) - (stage.get(b.stage) ?? 0) || byFocus(a, b),
  );
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Starred first, then by priority (P0 first, none last); otherwise as found. */
function byFocus(
  a: { readonly star: Star | null; readonly priority: string | null },
  b: { readonly star: Star | null; readonly priority: string | null },
): number {
  return (
    Number(b.star !== null) - Number(a.star !== null) ||
    (PRIORITY_RANK[a.priority ?? ""] ?? 4) - (PRIORITY_RANK[b.priority ?? ""] ?? 4)
  );
}

/** Rigo's moves on the board, in stage order: what Start review walks through. */
export function reviewQueue(cards: ReadonlyArray<StoryCard>): StoryCard[] {
  const order = new Map(STAGES.map((stage, index) => [stage.id, index]));
  // Starred areas first across the whole session, then stage order, then priority.
  return cards
    .filter((card) => card.move.mine)
    .toSorted(
      (a, b) =>
        Number(b.star !== null) - Number(a.star !== null) ||
        (order.get(a.stage) ?? 0) - (order.get(b.stage) ?? 0) ||
        byFocus(a, b),
    );
}
