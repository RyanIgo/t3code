/**
 * Fleet fork: the Sprint page as an app's home. A story's progress from requirement to merged,
 * the sprint's work grouped by feature, and the schedule's bars. Pure logic only.
 */
import {
  type DeskItem,
  type DeskSprint,
  type DeskStage,
  type ItemSignals,
  needsWrapUp,
} from "./desk.logic";
import type { DeskNotes } from "./deskNotes.logic";
import type { DeskPr } from "./deskPrs.logic";

/** done · an agent is on it · waiting on Rigo · still to come · doesn't apply to this item. */
export type StepState = "done" | "agent" | "you" | "todo" | "skip";

export const STORY_STEPS = [
  "Defined",
  "Built",
  "Checks green",
  "Tested",
  "Criteria proven",
  "Merged & settled",
] as const;

export const isOpenWork = (item: DeskItem) =>
  (item.state === "open" || item.state === "draft") && item.status !== "Done";

/** The feature's name without its app ("Precon · Bid intake" → "Bid intake"). */
export function featureName(item: Pick<DeskItem, "feature">): string | null {
  const parts = item.feature?.split(" · ") ?? [];
  return parts.length > 1 ? parts.slice(1).join(" · ") : (item.feature ?? null);
}

/**
 * Where an item stands on the six steps. The first step still open shows who it waits on: Rigo
 * when its chat asks him, a sheet waits for him or its PR is ready to merge; else an agent when a
 * chat is on it.
 */
export function storySteps(
  item: DeskItem,
  signals: ItemSignals,
  pr: DeskPr | null,
): ReadonlyArray<StepState> {
  if (!isOpenWork(item) && !needsWrapUp(item, signals)) return STORY_STEPS.map(() => "done");
  // A chat on the item or on its PR (fixing a merge conflict) counts as an agent on it.
  const working =
    signals.chats.some((chat) => chat.working) || (pr?.chats.some((chat) => chat.working) ?? false);
  const onIt = working || signals.focused;
  const asks = signals.chats.some((chat) => chat.needsYou);
  const criteria = item.story?.criteria ?? [];
  const hasPr = pr !== null || item.pullRequests.length > 0;
  const merged =
    item.state === "merged" ||
    (item.pullRequests.length > 0 && item.pullRequests.every((link) => link.state === "merged"));
  const closed = !isOpenWork(item);

  const defined: StepState =
    criteria.length > 0 || (item.workType !== "Story" && item.plain) ? "done" : "todo";
  const built: StepState = hasPr || closed ? "done" : onIt ? "agent" : "todo";
  const checks: StepState = merged
    ? "done"
    : !hasPr
      ? closed
        ? "skip"
        : "todo"
      : pr === null
        ? "todo"
        : pr.stage === "ready" ||
            pr.stage === "landed" ||
            pr.checks === "passing" ||
            pr.checks === "none"
          ? "done"
          : "agent";
  const tested: StepState =
    signals.sheet === null
      ? closed
        ? "skip"
        : "todo"
      : signals.sheet.failed > 0
        ? "agent"
        : signals.sheet.unchecked > 0
          ? "you"
          : "done";
  const proven: StepState =
    criteria.length === 0
      ? "skip"
      : criteria.every((criterion) => criterion.done)
        ? "done"
        : tested === "done"
          ? "agent"
          : "todo";
  const prBusy = pr?.chats.some((chat) => chat.working) ?? false;
  const landed: StepState = closed
    ? needsWrapUp(item, signals)
      ? "you"
      : "done"
    : prBusy
      ? "agent"
      : pr?.stage === "ready" || pr?.stage === "landed"
        ? "you"
        : "todo";

  const steps: StepState[] = [defined, built, checks, tested, proven, landed];
  // The first open step says who has it now.
  const current = steps.findIndex((step) => step !== "done" && step !== "skip");
  if (current !== -1 && steps[current] === "todo") {
    steps[current] = asks ? "you" : onIt ? "agent" : "todo";
  } else if (current !== -1 && asks) {
    steps[current] = "you";
  } else if (current !== -1 && working && steps[current] === "you") {
    // Rigo's turn was next, but he sent a chat back to work on it: it's the agent's now.
    steps[current] = "agent";
  }
  return steps;
}

export interface FeatureGroup {
  /** null: the sprint's items in no feature. */
  readonly name: string | null;
  readonly stage: DeskStage | null;
  /** Still moving, or done but not wrapped up. */
  readonly stories: ReadonlyArray<DeskItem>;
  readonly done: ReadonlyArray<DeskItem>;
}

/** The sprint's work for one app by feature: busiest first, items in no feature last. */
export function featureGroups(
  items: ReadonlyArray<DeskItem>,
  sprint: DeskSprint,
  app: string,
  signalsFor: (item: DeskItem) => ItemSignals,
): FeatureGroup[] {
  const inSprint = items.filter(
    (item) =>
      item.app === app &&
      item.sprint?.title === sprint.title &&
      item.kind !== "pr" &&
      item.workType !== "Tracking",
  );
  const stageOf = (name: string) =>
    items.find(
      (item) =>
        item.app === app &&
        item.workType === "Tracking" &&
        item.title.replace(/^Feature:\s*/, "").trim() === name,
    )?.stage ?? null;
  const names = [...new Set(inSprint.map(featureName))];
  return names
    .map((name) => {
      const mine = inSprint.filter((item) => featureName(item) === name);
      const moving = (item: DeskItem) => isOpenWork(item) || needsWrapUp(item, signalsFor(item));
      return {
        name,
        stage: name ? stageOf(name) : null,
        stories: mine.filter(moving),
        done: mine.filter((item) => !moving(item)),
      };
    })
    .toSorted(
      (a, b) =>
        Number(a.name === null) - Number(b.name === null) ||
        b.stories.length - a.stories.length ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );
}

/** What keeps an item from fitting the flow: no feature, or a story with nothing to check. */
export function setupGaps(item: DeskItem): string[] {
  const gaps: string[] = [];
  if (!item.feature) gaps.push("no feature");
  if (item.workType === "Story" && (item.story?.criteria ?? []).length === 0) {
    gaps.push("no acceptance criteria");
  }
  return gaps;
}

export interface ScheduleBar {
  readonly item: DeskItem;
  /** Where it starts and ends across the sprint, 0 to 1. */
  readonly from: number;
  readonly to: number;
  /** Nobody has started it: drawn dashed from today. */
  readonly unstarted: boolean;
}

/** Each sprint item's bar: from when a chat first took it (or today) to when it closed or the sprint ends. */
export function scheduleBars(
  stories: ReadonlyArray<DeskItem>,
  sprint: DeskSprint,
  notes: DeskNotes,
  nowMs: number,
): ScheduleBar[] {
  const start = Date.parse(sprint.startDate);
  const span = sprint.duration * 86_400_000;
  const at = (ms: number) => Math.min(1, Math.max(0, (ms - start) / span));
  const firstTaken = new Map<string, number>();
  for (const work of Object.values(notes.work)) {
    for (const entry of work.items) {
      const ms = Date.parse(entry.from);
      const seen = firstTaken.get(entry.url);
      if (!Number.isNaN(ms) && (seen === undefined || ms < seen)) firstTaken.set(entry.url, ms);
    }
  }
  return stories.map((item) => {
    const taken = item.url ? firstTaken.get(item.url) : undefined;
    const closed = item.closedAt ? Date.parse(item.closedAt) : Number.NaN;
    const from = taken === undefined ? at(nowMs) : at(taken);
    const to = Number.isNaN(closed) ? 1 : Math.max(at(closed), from + 0.02);
    return { item, from, to: Math.min(1, to), unstarted: taken === undefined };
  });
}

/** Where today falls across the sprint, 0 to 1, and its days ("Nov 17" …). */
export function sprintDays(sprint: DeskSprint, nowMs: number) {
  const start = Date.parse(sprint.startDate);
  const days = Array.from({ length: sprint.duration }, (_, index) => {
    const date = new Date(start + index * 86_400_000);
    return {
      iso: date.toISOString().slice(0, 10),
      label: String(date.getUTCDate()),
      weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
    };
  });
  const today = Math.min(1, Math.max(0, (nowMs - start) / (sprint.duration * 86_400_000)));
  return { days, today, end: new Date(start + (sprint.duration - 1) * 86_400_000) };
}
