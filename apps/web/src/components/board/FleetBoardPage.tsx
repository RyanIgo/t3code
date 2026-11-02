import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { cn } from "../../lib/utils";
import { useDelegatedUnderParent, useQuietThreadShells } from "../../state/entities";
import { environmentSummaries } from "../../state/presentation";
import type { SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { connectionPhaseDotClassName } from "../ConnectionStatusDot";
import { filterSidebarV2VisibleThreads, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  buildFleetBoard,
  FLEET_BOARD_COLUMNS,
  formatFleetBoardAge,
  minuteTickToMs,
  type FleetBoardCard,
  type FleetBoardTone,
} from "./fleetBoard.logic";

/** Needs me always shows everything; quieter columns fold after this many. */
const COLLAPSED_CARD_LIMIT = 3;

type BoardThread = Omit<SidebarThreadSummary, "lastVisitedAt"> & {
  readonly lastVisitedAt: string | null | undefined;
};

const TONE_BORDER: Record<FleetBoardTone, string> = {
  attention: "border-l-warning",
  failed: "border-l-destructive",
  working: "border-l-info",
  done: "border-l-success",
  quiet: "border-l-border",
};

const TONE_TEXT: Record<FleetBoardTone, string> = {
  attention: "text-warning-foreground",
  failed: "text-destructive-foreground",
  working: "text-info-foreground",
  done: "text-foreground",
  quiet: "text-muted-foreground",
};

const COLUMN_HEADER_TEXT: Record<(typeof FLEET_BOARD_COLUMNS)[number]["id"], string> = {
  needs: "text-warning-foreground",
  running: "text-info-foreground",
  queued: "text-muted-foreground",
  done: "text-muted-foreground",
};

export function FleetBoardPage() {
  const navigate = useNavigate();
  const nowMs = minuteTickToMs(useNowMinute());
  const [showSettled, setShowSettled] = useState(false);
  const [expandedCells, setExpandedCells] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCell = (cellKey: string) =>
    setExpandedCells((current) => {
      const next = new Set(current);
      if (!next.delete(cellKey)) next.add(cellKey);
      return next;
    });
  const groups = useSidebarProjectGroups();
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById);
  const environments = useAtomValue(environmentSummaries.environmentsAtom);

  const enabledEnvironments = environments.filter((environment) => environment.isEnabled);
  const labelById = new Map<EnvironmentId, string>(
    environments.map((environment) => [environment.environmentId, environment.environmentLabel]),
  );
  const showMachine = enabledEnvironments.length > 1;
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
  const { rows, totals } = buildFleetBoard(groups, boardThreads);

  const openThread = (thread: BoardThread) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.id },
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="shrink-0 text-sm font-medium">Board</h1>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {enabledEnvironments.map((environment) => (
              <Tooltip key={environment.environmentId}>
                <TooltipTrigger
                  render={
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground" />
                  }
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      connectionPhaseDotClassName(environment.connectionState),
                    )}
                  />
                  {environment.environmentLabel}
                </TooltipTrigger>
                <TooltipPopup side="bottom">
                  {environment.connectionError ?? environment.connectionState}
                </TooltipPopup>
              </Tooltip>
            ))}
          </div>
          <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground sm:flex">
            <span className={cn(totals.needs > 0 && COLUMN_HEADER_TEXT.needs)}>
              {totals.needs} need you
            </span>
            <span>{totals.running} running</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              id="fleet-board-show-settled"
              size="sm"
              checked={showSettled}
              onCheckedChange={setShowSettled}
            />
            <Label htmlFor="fleet-board-show-settled">Settled</Label>
          </div>
        </WorkspacePageHeader>

        {rows.length === 0 ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>Nothing on the board</EmptyTitle>
              <EmptyDescription>
                Threads from every connected environment show up here, grouped by project. Pair more
                machines in Settings → Connections.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-1 gap-x-3 px-4 pb-6 lg:grid-cols-[minmax(8rem,11rem)_repeat(4,minmax(0,1fr))]">
              <div className="sticky top-0 z-10 hidden bg-background lg:block" />
              {FLEET_BOARD_COLUMNS.map((column) => (
                <div
                  key={column.id}
                  className={cn(
                    "sticky top-0 z-10 hidden bg-background py-2 text-2xs font-semibold tracking-wide uppercase lg:block",
                    COLUMN_HEADER_TEXT[column.id],
                  )}
                >
                  {column.label}
                  <span className="ms-1.5 font-normal text-muted-foreground">
                    {totals[column.id]}
                  </span>
                </div>
              ))}

              {rows.map((row) => (
                <div key={row.group.projectKey} className="contents">
                  <div className="truncate border-t border-border pt-3 pb-1 text-sm font-medium lg:pb-3">
                    {row.group.displayName}
                  </div>
                  {FLEET_BOARD_COLUMNS.map((column) => {
                    const cards = row.columns[column.id];
                    const cellKey = `${row.group.projectKey}:${column.id}`;
                    const expanded = expandedCells.has(cellKey);
                    const hiddenCount = Math.max(0, cards.length - COLLAPSED_CARD_LIMIT);
                    const shownCards =
                      expanded || column.id === "needs"
                        ? cards
                        : cards.slice(0, COLLAPSED_CARD_LIMIT);
                    return (
                      <div
                        key={column.id}
                        className={cn(
                          "flex min-w-0 flex-col gap-1.5 lg:border-t lg:border-border lg:py-3",
                          cards.length === 0 && "hidden lg:flex",
                        )}
                      >
                        <span
                          className={cn(
                            "text-2xs font-semibold tracking-wide uppercase lg:hidden",
                            COLUMN_HEADER_TEXT[column.id],
                          )}
                        >
                          {column.label}
                        </span>
                        {shownCards.map((entry) => (
                          <FleetBoardCardView
                            key={scopedThreadKey(
                              scopeThreadRef(entry.thread.environmentId, entry.thread.id),
                            )}
                            entry={entry}
                            machineLabel={
                              showMachine
                                ? (labelById.get(entry.thread.environmentId) ?? null)
                                : null
                            }
                            nowMs={nowMs}
                            onOpen={() => openThread(entry.thread)}
                          />
                        ))}
                        {column.id !== "needs" && hiddenCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleCell(cellKey)}
                            className="cursor-pointer self-start rounded px-1 text-2xs text-muted-foreground hover:text-foreground"
                          >
                            {expanded ? "Show less" : `+${hiddenCount} more`}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </SidebarInset>
  );
}

function FleetBoardCardView(props: {
  readonly entry: FleetBoardCard<BoardThread>;
  readonly machineLabel: string | null;
  readonly nowMs: number;
  readonly onOpen: () => void;
}) {
  const { entry, machineLabel, nowMs, onOpen } = props;
  const age = formatFleetBoardAge(entry.since, nowMs);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-md border border-l-4 border-border bg-card px-2.5 py-1.5 text-left hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden",
        TONE_BORDER[entry.tone],
        entry.column === "done" && "opacity-85",
      )}
    >
      <span className="truncate text-sm font-medium">{entry.thread.title}</span>
      <span className={cn("line-clamp-2 text-xs", TONE_TEXT[entry.tone])}>{entry.nextStep}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        {entry.tone === "working" ? (
          <span className="size-1.5 shrink-0 rounded-full bg-info motion-safe:animate-status-pulse" />
        ) : null}
        {machineLabel ? (
          <span className="truncate rounded border border-border px-1 font-mono text-3xs">
            {machineLabel}
          </span>
        ) : null}
        {age ? <span className="shrink-0">{age}</span> : null}
      </span>
    </button>
  );
}
