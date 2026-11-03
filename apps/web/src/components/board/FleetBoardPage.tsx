import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { cn } from "../../lib/utils";
import { environmentSummaries } from "../../state/presentation";
import { connectionPhaseDotClassName } from "../ConnectionStatusDot";
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
  type FleetBoardCard,
  type FleetBoardTone,
} from "./fleetBoard.logic";
import { type BoardThread, useFleetBoardThreads } from "./useFleetBoardThreads";

/** Chats that need you, run, or finished always show; idle chats fold after this many per project. */
const COLLAPSED_IDLE_LIMIT = 3;

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
  const [showSettled, setShowSettled] = useState(false);
  const [expandedIdle, setExpandedIdle] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set());
  const toggleIn =
    (setter: typeof setExpandedIdle) =>
    (key: string): void =>
      setter((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      });
  const toggleIdle = toggleIn(setExpandedIdle);
  const toggleProject = toggleIn(setCollapsedProjects);
  const groups = useSidebarProjectGroups();
  const { threads: boardThreads, nowMs } = useFleetBoardThreads(showSettled);
  const environments = useAtomValue(environmentSummaries.environmentsAtom);

  const enabledEnvironments = environments.filter((environment) => environment.isEnabled);
  const labelById = new Map<EnvironmentId, string>(
    environments.map((environment) => [environment.environmentId, environment.environmentLabel]),
  );
  const showMachine = enabledEnvironments.length > 1;
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
            <div className="grid grid-cols-1 gap-x-3 px-4 pb-6 lg:grid-cols-[minmax(10rem,16rem)_repeat(4,minmax(0,1fr))]">
              <div className="sticky top-0 z-10 hidden bg-background py-2 text-2xs font-semibold tracking-wide text-muted-foreground uppercase lg:block">
                Project › chat
              </div>
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

              {rows.map((row) => {
                const projectKey = row.group.projectKey;
                const collapsed = collapsedProjects.has(projectKey);
                const idleExpanded = expandedIdle.has(projectKey);
                const idleChats = row.columns.queued.filter((entry) => entry.tone === "quiet");
                const hiddenIdle = idleExpanded
                  ? []
                  : idleChats.slice(COLLAPSED_IDLE_LIMIT).map((entry) => entry.thread.id);
                const shownChats = row.chats.filter(
                  (entry) => !hiddenIdle.includes(entry.thread.id),
                );
                return (
                  <div key={projectKey} className="contents">
                    <button
                      type="button"
                      onClick={() => toggleProject(projectKey)}
                      aria-expanded={!collapsed}
                      className="col-span-full flex min-w-0 cursor-pointer items-center gap-1.5 border-t border-border pt-3 pb-2 text-left text-sm font-medium hover:text-foreground"
                    >
                      <ChevronRightIcon
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          !collapsed && "rotate-90",
                        )}
                      />
                      <span className="truncate">{row.group.displayName}</span>
                      <span className="flex shrink-0 items-center gap-2 text-2xs font-normal text-muted-foreground">
                        <span>
                          {row.total} chat{row.total === 1 ? "" : "s"}
                        </span>
                        {row.columns.needs.length > 0 ? (
                          <span className={COLUMN_HEADER_TEXT.needs}>
                            {row.columns.needs.length} need you
                          </span>
                        ) : null}
                        {row.columns.running.length > 0 ? (
                          <span>{row.columns.running.length} running</span>
                        ) : null}
                      </span>
                    </button>
                    {collapsed
                      ? null
                      : shownChats.map((entry) => (
                          <FleetBoardChatRow
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
                    {!collapsed && (hiddenIdle.length > 0 || idleExpanded) ? (
                      <button
                        type="button"
                        onClick={() => toggleIdle(projectKey)}
                        className="col-span-full cursor-pointer justify-self-start rounded px-1 pb-2 text-2xs text-muted-foreground hover:text-foreground lg:ps-5"
                      >
                        {idleExpanded ? "Show fewer idle chats" : `+${hiddenIdle.length} idle`}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </SidebarInset>
  );
}

/** One chat: its name in the first column, its card under its status column. */
function FleetBoardChatRow(props: {
  readonly entry: FleetBoardCard<BoardThread>;
  readonly machineLabel: string | null;
  readonly nowMs: number;
  readonly onOpen: () => void;
}) {
  const { entry } = props;
  return (
    <>
      <button
        type="button"
        onClick={props.onOpen}
        className="hidden min-w-0 cursor-pointer truncate py-1 ps-5 text-left text-sm text-muted-foreground hover:text-foreground lg:block"
      >
        {entry.thread.title}
      </button>
      {FLEET_BOARD_COLUMNS.map((column) =>
        column.id === entry.column ? (
          <div key={column.id} className="min-w-0 py-1">
            <FleetBoardCardView {...props} />
          </div>
        ) : (
          <div key={column.id} aria-hidden className="hidden lg:block" />
        ),
      )}
    </>
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
      <span className="truncate text-sm font-medium lg:hidden">{entry.thread.title}</span>
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
        <span className="truncate lg:hidden">
          · {FLEET_BOARD_COLUMNS.find((column) => column.id === entry.column)?.label}
        </span>
      </span>
    </button>
  );
}
