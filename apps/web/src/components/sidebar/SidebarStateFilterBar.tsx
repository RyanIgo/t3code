import { cn } from "../../lib/utils";
import {
  FLEET_THREAD_STATES,
  type FleetThreadState,
  useFleetThreadStateFilter,
} from "./fleetThreadState";

const ACTIVE_CHIP: Record<FleetThreadState, string> = {
  me: "border-warning/60 bg-warning/15 text-warning-foreground",
  active: "border-info/60 bg-info/15 text-info-foreground",
  code: "border-primary/50 bg-primary/12 text-primary",
  merged: "border-success/60 bg-success/15 text-success-foreground",
  inactive: "border-sidebar-foreground/40 bg-sidebar-row-hover text-sidebar-foreground",
};

const COUNT_DOT: Record<FleetThreadState, string> = {
  me: "bg-warning",
  active: "bg-info",
  code: "bg-primary",
  merged: "bg-success",
  inactive: "bg-sidebar-muted-foreground/50",
};

/** Fleet fork: one-click filter of the open chats by state, with counts. */
export function SidebarStateFilterBar({
  counts,
}: {
  readonly counts: Record<FleetThreadState, number>;
}) {
  const [filter, setFilter] = useFleetThreadStateFilter();
  return (
    <div
      role="toolbar"
      aria-label="Filter chats by state"
      className="mx-2 mb-1.5 flex flex-wrap items-center gap-1"
    >
      <button
        type="button"
        aria-pressed={filter === "all"}
        onClick={() => setFilter("all")}
        className={cn(
          "h-6 cursor-pointer rounded-full border px-2 text-2xs font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          filter === "all"
            ? "border-sidebar-foreground/40 bg-sidebar-row-hover text-sidebar-foreground"
            : "border-sidebar-border text-sidebar-muted-foreground hover:text-sidebar-foreground",
        )}
      >
        All
      </button>
      {FLEET_THREAD_STATES.map(({ id, label }) => {
        const selected = filter === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            aria-label={`${label}: ${counts[id]}`}
            onClick={() => setFilter(selected ? "all" : id)}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-2xs font-medium tabular-nums outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              selected
                ? ACTIVE_CHIP[id]
                : "border-sidebar-border text-sidebar-muted-foreground hover:text-sidebar-foreground",
              counts[id] === 0 && !selected && "opacity-60",
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", COUNT_DOT[id])} />
            {label}
            <span aria-hidden>{counts[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
