import type { EnvironmentId } from "@t3tools/contracts";

import { isLatestRunSettled } from "../../session-logic";
import type { SidebarThreadSummary } from "../../types";
import { hasUnseenCompletion, resolveSidebarThreadStatus } from "../Sidebar.logic";

/**
 * Fleet board: every thread from every paired environment, one row per project
 * group, one column per "what does this need from me". Pure logic only, so the
 * page stays a thin view over the sidebar's own status rules.
 */
export type FleetBoardColumn = "needs" | "running" | "queued" | "done";

export const FLEET_BOARD_COLUMNS: ReadonlyArray<{
  readonly id: FleetBoardColumn;
  readonly label: string;
}> = [
  { id: "needs", label: "Needs me" },
  { id: "running", label: "Running" },
  { id: "queued", label: "Queued · idle" },
  { id: "done", label: "Done · unreviewed" },
];

export type FleetBoardTone = "attention" | "failed" | "working" | "done" | "quiet";

export type FleetBoardThreadInput = Pick<
  SidebarThreadSummary,
  | "environmentId"
  | "id"
  | "projectId"
  | "title"
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "interactionMode"
  | "latestRun"
  | "runtime"
  | "blockedOnThreadWait"
  | "updatedAt"
  | "linkedPullRequest"
> & {
  readonly lastVisitedAt?: string | null | undefined;
};

export interface FleetBoardCard<T extends FleetBoardThreadInput = FleetBoardThreadInput> {
  readonly thread: T;
  readonly column: FleetBoardColumn;
  readonly tone: FleetBoardTone;
  /** One short line: what happens next, or what you need to do. */
  readonly nextStep: string;
  /** When the card's current state began, for "12m" style ages. */
  readonly since: string | null;
}

const MAX_ERROR_LENGTH = 90;

function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}…`;
}

/**
 * Follows the sidebar row's status: a failed runtime stays in Needs me until it
 * runs again. "Woke" and background-task "Waiting" show as Idle. Needs me ages
 * count from the last update; summaries carry no request timestamp.
 */
export function resolveFleetBoardCard<T extends FleetBoardThreadInput>(
  thread: T,
): FleetBoardCard<T> {
  const status = resolveSidebarThreadStatus(thread);
  const runtimeStatus = thread.runtime?.status ?? null;
  const activitySince = thread.runtime?.activityStartedAt ?? thread.latestRun?.startedAt ?? null;
  const settledSince = thread.latestRun?.completedAt ?? thread.updatedAt;
  const pr = thread.linkedPullRequest ?? null;

  switch (status) {
    case "approval":
      return card(thread, "needs", "attention", "Approve a pending request", thread.updatedAt);
    case "input":
      return card(thread, "needs", "attention", "Answer a question", thread.updatedAt);
    case "request": {
      const count = thread.pendingGuestMessageCount ?? 0;
      return card(
        thread,
        "needs",
        "attention",
        `Review ${count} guest message${count === 1 ? "" : "s"}`,
        thread.updatedAt,
      );
    }
    case "limited":
      return card(thread, "needs", "failed", "Usage limit reached", settledSince);
    case "failed": {
      const error = thread.runtime?.lastError;
      return card(
        thread,
        "needs",
        "failed",
        error ? `Failed: ${truncate(error, MAX_ERROR_LENGTH)}` : "Failed",
        settledSince,
      );
    }
    case "working":
      if (
        runtimeStatus === "queued" ||
        runtimeStatus === "preparing" ||
        runtimeStatus === "starting"
      ) {
        return card(thread, "queued", "working", "Starting…", activitySince);
      }
      return card(thread, "running", "working", "Working", activitySince);
    case "waiting":
      if (runtimeStatus === "running") {
        return card(thread, "running", "quiet", "Waiting on another thread", activitySince);
      }
      break;
    case "ready":
      break;
  }

  // Same condition as the sidebar's "Plan Ready" pill; the raw flag outlives a mode switch.
  const hasPlanReadyPrompt =
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestRunSettled(thread.latestRun, thread.runtime) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return card(thread, "needs", "attention", "Plan ready to review", settledSince);
  }
  // Same unread rule as the sidebar's Done dot, so the two never disagree.
  if (hasUnseenCompletion(thread)) {
    return card(
      thread,
      "done",
      "done",
      pr ? `Review result · PR #${pr.number}` : "Review result",
      settledSince,
    );
  }
  return card(thread, "queued", "quiet", pr ? `Idle · PR #${pr.number}` : "Idle", settledSince);
}

function card<T extends FleetBoardThreadInput>(
  thread: T,
  column: FleetBoardColumn,
  tone: FleetBoardTone,
  nextStep: string,
  since: string | null,
): FleetBoardCard<T> {
  return { thread, column, tone, nextStep, since };
}

export interface FleetBoardGroupInput {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjectRefs: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: string;
  }>;
}

export interface FleetBoardRow<
  G extends FleetBoardGroupInput = FleetBoardGroupInput,
  T extends FleetBoardThreadInput = FleetBoardThreadInput,
> {
  readonly group: G;
  readonly columns: Readonly<Record<FleetBoardColumn, ReadonlyArray<FleetBoardCard<T>>>>;
  readonly total: number;
}

export interface FleetBoardTotals {
  readonly needs: number;
  readonly running: number;
  readonly queued: number;
  readonly done: number;
}

const ROW_URGENCY: ReadonlyArray<FleetBoardColumn> = ["needs", "running", "done", "queued"];

function timestampMs(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Buckets threads into project rows and status columns. Rows with something
 * that needs you sort first, then rows with running work; empty rows drop out.
 * Within a column the newest state change comes first, except Needs me, where
 * the oldest comes first.
 */
export function buildFleetBoard<G extends FleetBoardGroupInput, T extends FleetBoardThreadInput>(
  groups: ReadonlyArray<G>,
  threads: ReadonlyArray<T>,
): { rows: FleetBoardRow<G, T>[]; totals: FleetBoardTotals } {
  const rowByProject = new Map<string, { group: G; cards: FleetBoardCard<T>[] }>();
  const rows: { group: G; cards: FleetBoardCard<T>[] }[] = [];
  for (const group of groups) {
    const row = { group, cards: [] as FleetBoardCard<T>[] };
    rows.push(row);
    for (const ref of group.memberProjectRefs) {
      rowByProject.set(`${ref.environmentId}:${ref.projectId}`, row);
    }
  }
  const totals = { needs: 0, running: 0, queued: 0, done: 0 };
  for (const thread of threads) {
    const row = rowByProject.get(`${thread.environmentId}:${thread.projectId}`);
    if (!row) continue;
    const resolved = resolveFleetBoardCard(thread);
    row.cards.push(resolved);
    totals[resolved.column] += 1;
  }

  const built = rows
    .filter((row) => row.cards.length > 0)
    .map((row): FleetBoardRow<G, T> => {
      const columns: Record<FleetBoardColumn, FleetBoardCard<T>[]> = {
        needs: [],
        running: [],
        queued: [],
        done: [],
      };
      for (const entry of row.cards) columns[entry.column].push(entry);
      columns.needs.sort((a, b) => timestampMs(a.since) - timestampMs(b.since));
      for (const column of ["running", "queued", "done"] as const) {
        columns[column].sort((a, b) => timestampMs(b.since) - timestampMs(a.since));
      }
      return { group: row.group, columns, total: row.cards.length };
    });

  const urgencyKey = (row: FleetBoardRow<G, T>) => {
    const index = ROW_URGENCY.findIndex((column) => row.columns[column].length > 0);
    return index === -1 ? ROW_URGENCY.length : index;
  };
  // Stable sort keeps the sidebar's own group order inside each urgency tier.
  built.sort((a, b) => urgencyKey(a) - urgencyKey(b));
  return { rows: built, totals };
}

/**
 * `minuteTick` snapshots are UTC ISO strings cut to the minute ("2026-11-01T11:05")
 * with no zone suffix, which `Date.parse` would read as local time.
 */
export function minuteTickToMs(minute: string): number {
  return Date.parse(`${minute}:00.000Z`);
}

/** "45s", "12m", "3h", "2d": compact enough for a card footer. */
export function formatFleetBoardAge(since: string | null, nowMs: number): string | null {
  if (!since) return null;
  const startedMs = Date.parse(since);
  if (Number.isNaN(startedMs)) return null;
  const seconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
