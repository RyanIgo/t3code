import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useDelegatedUnderParent, useQuietThreadShells } from "../../state/entities";
import type { SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { filterSidebarV2VisibleThreads, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { minuteTickToMs, resolveFleetBoardCard } from "./fleetBoard.logic";

export type BoardThread = Omit<SidebarThreadSummary, "lastVisitedAt"> & {
  readonly lastVisitedAt: string | null | undefined;
};

/**
 * The threads the board shows: the sidebar's visible threads, without settled and
 * snoozed ones unless `showSettled`, with this device's last visit folded in.
 */
export function useFleetBoardThreads(showSettled: boolean): {
  readonly threads: BoardThread[];
  readonly nowMs: number;
} {
  const nowMs = minuteTickToMs(useNowMinute());
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById);
  // Render must stay pure, so snooze expiry is checked to the minute (the sidebar: to the ms).
  const nowIso = new Date(nowMs).toISOString();
  const boardThreads: BoardThread[] = filterSidebarV2VisibleThreads(
    threads,
    null,
    delegatedUnderParent,
  )
    .filter(
      (thread) =>
        showSettled ||
        (thread.settledOverride !== "settled" && !effectiveSnoozed(thread, { now: nowIso })),
    )
    .map((thread) => ({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAt[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
    }));
  return { threads: boardThreads, nowMs };
}

/** How many threads sit in the board's Needs me column, for badges outside the board. */
export function useFleetBoardNeedsCount(): number {
  const { threads } = useFleetBoardThreads(false);
  let count = 0;
  for (const thread of threads) {
    if (resolveFleetBoardCard(thread).column === "needs") count += 1;
  }
  return count;
}
