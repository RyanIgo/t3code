/**
 * Fleet fork: where to look first across applications, for coming back after a break. One row
 * per app with what waits on you, what can merge, and what has stalled. Pure logic only.
 */
import type { DeskItem, DeskSprint } from "./desk.logic";
import { type DeskPr, isDependencyUpdate } from "./deskPrs.logic";

export interface AppFocus {
  readonly app: string;
  /** Chats and items waiting on you. */
  readonly needsYou: number;
  readonly prsToFix: number;
  /** Ready to merge, version bumps left out. */
  readonly prsReady: number;
  /** Now-lane items with no chat on them. */
  readonly noAgent: number;
  readonly blocked: number;
  readonly sprintDone: number;
  readonly sprintTotal: number;
}

const isOpen = (item: DeskItem) => item.state === "open" || item.state === "draft";

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
    const sprintItems = input.sprint
      ? items.filter((item) => item.sprint?.title === input.sprint?.title)
      : [];
    return {
      app,
      needsYou: input.needsYou(app),
      prsToFix: prs.filter((pr) => pr.stage === "fix").length,
      prsReady: prs.filter((pr) => pr.stage === "ready").length,
      noAgent: items.filter((item) => item.lane === "Now" && isOpen(item) && !input.hasChat(item))
        .length,
      blocked: items.filter((item) => item.lane === "Blocked" && isOpen(item)).length,
      sprintDone: sprintItems.filter((item) => !isOpen(item) || item.status === "Done").length,
      sprintTotal: sprintItems.length,
    };
  });
  const urgency = (row: AppFocus) =>
    row.needsYou * 3 + row.prsToFix * 2 + row.blocked * 2 + row.noAgent + row.prsReady;
  return rows
    .filter((row) => urgency(row) > 0 || row.sprintTotal > 0)
    .sort((a, b) => urgency(b) - urgency(a) || a.app.localeCompare(b.app));
}
