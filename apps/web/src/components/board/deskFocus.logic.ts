/**
 * Fleet fork: where to look first across applications, for coming back after a break. One row
 * per app with what waits on you, what can merge, and what has stalled. Pure logic only.
 */
import type { CardChatState } from "./boardCards.logic";
import { type DeskItem, type DeskSprint, sprintOverview, sprintStatus } from "./desk.logic";
import { type DeskPr, isDependencyUpdate } from "./deskPrs.logic";

export interface AppFocus {
  readonly app: string;
  /** Chats and items waiting on you. */
  readonly needsYou: number;
  readonly prsToFix: number;
  /** Ready to merge, version bumps left out. */
  readonly prsReady: number;
  /** This sprint's unfinished work (To do or In progress) with no chat on it. */
  readonly noAgent: number;
  readonly blocked: number;
  readonly sprintDone: number;
  readonly sprintTotal: number;
}

const isOpen = (item: DeskItem) => item.state === "open" || item.state === "draft";

/** This sprint's To do and In progress work with no agent on it. */
export function stalledItems(
  items: ReadonlyArray<DeskItem>,
  sprint: DeskSprint | null,
  hasChat: (item: DeskItem) => boolean,
): DeskItem[] {
  if (!sprint) return [];
  return items.filter(
    (item) =>
      item.sprint?.title === sprint.title &&
      item.workType !== "Tracking" &&
      (sprintStatus(item) === "Todo" || sprintStatus(item) === "In Progress") &&
      !hasChat(item),
  );
}

/** One row per app that has anything to act on, the most urgent first. */
export function focusByApp(input: {
  readonly apps: ReadonlyArray<string>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly prs: ReadonlyArray<DeskPr>;
  readonly sprint: DeskSprint | null;
  readonly needsYou: (app: string) => number;
  readonly hasChat: (item: DeskItem) => boolean;
}): AppFocus[] {
  const rows = input.apps.map((app): AppFocus => {
    const items = input.items.filter((item) => item.app === app);
    const prs = input.prs.filter((pr) => pr.app === app && !isDependencyUpdate(pr));
    const progress = input.sprint
      ? sprintOverview(input.items, input.sprint, [app], false)
      : { done: 0, total: 0 };
    return {
      app,
      needsYou: input.needsYou(app),
      prsToFix: prs.filter((pr) => pr.stage === "fix").length,
      prsReady: prs.filter((pr) => pr.stage === "ready").length,
      noAgent: stalledItems(items, input.sprint, input.hasChat).length,
      blocked: items.filter((item) => item.lane === "Blocked" && isOpen(item)).length,
      sprintDone: progress.done,
      sprintTotal: progress.total,
    };
  });
  const urgency = (row: AppFocus) =>
    row.needsYou * 3 + row.prsToFix * 2 + row.blocked * 2 + row.noAgent + row.prsReady;
  return rows
    .filter((row) => urgency(row) > 0 || row.sprintTotal > 0)
    .sort((a, b) => urgency(b) - urgency(a) || a.app.localeCompare(b.app));
}

export interface Catchup {
  /** Chats that finished a turn or started asking you something since then. */
  readonly chats: ReadonlyArray<CardChatState>;
  /** Items closed since then. */
  readonly closed: ReadonlyArray<DeskItem>;
}

const after = (value: string | null | undefined, sinceMs: number) =>
  value ? Date.parse(value) > sinceMs : false;

/** What changed since the user last said they were caught up. */
export function changesSince(
  sinceMs: number,
  items: ReadonlyArray<DeskItem>,
  chats: ReadonlyArray<CardChatState>,
): Catchup {
  return {
    chats: chats
      .filter((chat) => (chat.needsYou || chat.column === "done") && after(chat.since, sinceMs))
      .toSorted((a, b) => Date.parse(b.since ?? "") - Date.parse(a.since ?? "")),
    closed: items.filter((item) => after(item.closedAt, sinceMs)),
  };
}
