import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import type { ThreadPullRequestLink } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { parseTimestampDate } from "../../timestampFormat";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  type SidebarThreadStatus,
} from "../Sidebar.logic";

/**
 * Fleet fork: the states the sidebar badges, counts and filters by. "me" covers anything
 * waiting on the user, including finished work they have not opened yet; "merged" is
 * work whose pull request merged with nothing new since.
 */
export type FleetThreadState = "me" | "active" | "code" | "merged" | "inactive";

export const FLEET_THREAD_STATES: ReadonlyArray<{
  readonly id: FleetThreadState;
  readonly label: string;
}> = [
  { id: "me", label: "Waiting on me" },
  { id: "active", label: "Active" },
  { id: "code", label: "Waiting on code" },
  { id: "merged", label: "Merged" },
  { id: "inactive", label: "Inactive" },
];

export function resolveFleetThreadState(input: {
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
  readonly pullRequest?: PullRequestPhase | null;
}): FleetThreadState {
  const { status } = input;
  if (
    status === "approval" ||
    status === "input" ||
    status === "request" ||
    status === "failed" ||
    status === "limited" ||
    input.isWoke ||
    input.isUnread
  ) {
    return "me";
  }
  if (status === "working") return "active";
  if (status === "waiting" || input.pullRequest === "checks-pending") return "code";
  if (input.pullRequest === "checks-failing") return "me";
  if (input.pullRequest === "merged") return "merged";
  return "inactive";
}

export type PullRequestPhase = "open" | "checks-pending" | "checks-failing" | "merged";

/** Open pull requests outrank merged ones: merged means every linked one is done. */
export function pullRequestPhase(
  links: ReadonlyArray<ThreadPullRequestLink>,
): PullRequestPhase | null {
  const snapshots = links.flatMap((link) =>
    link.source !== "stack-dismissed" && link.snapshot !== null ? [link.snapshot] : [],
  );
  const open = snapshots.filter((snapshot) => snapshot.state === "open");
  if (open.some((snapshot) => snapshot.checksState === "failing")) return "checks-failing";
  if (open.some((snapshot) => snapshot.checksState === "pending")) return "checks-pending";
  if (open.length > 0) return "open";
  return snapshots.some((snapshot) => snapshot.state === "merged") ? "merged" : null;
}

/** The same state a row shows, from a shell and this device's last visit. */
export function fleetThreadStateOf(
  thread: EnvironmentThreadShell,
  localLastVisitedAtById: Readonly<Record<string, string>>,
  nowIso: string,
): FleetThreadState {
  const lastVisitedAt = resolveThreadLastVisitedAt(
    thread.lastVisitedAt,
    localLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
  );
  const wokeAt = threadWokeAt(thread, { now: nowIso });
  const wokeAtDate = wokeAt === null ? null : parseTimestampDate(wokeAt);
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  return resolveFleetThreadState({
    status: resolveSidebarThreadStatus(thread),
    isUnread: hasUnseenCompletion({ ...thread, lastVisitedAt }),
    isWoke:
      wokeAtDate !== null &&
      (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
      thread.settledOverride !== "settled",
    pullRequest: pullRequestPhase(thread.pullRequests),
  });
}

export function countFleetThreadStates(
  states: ReadonlyArray<FleetThreadState>,
): Record<FleetThreadState, number> {
  const counts = { me: 0, active: 0, code: 0, merged: 0, inactive: 0 };
  for (const state of states) counts[state] += 1;
  return counts;
}

const FleetThreadStateFilter = Schema.Literals([
  "all",
  "me",
  "active",
  "code",
  "merged",
  "inactive",
]);
export type FleetThreadStateFilter = typeof FleetThreadStateFilter.Type;

export function useFleetThreadStateFilter() {
  return useLocalStorage<FleetThreadStateFilter, FleetThreadStateFilter>(
    "t3-fleet:sidebar-state-filter",
    "all",
    FleetThreadStateFilter,
  );
}
