import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { type DeskItem, deskRef, deskTitle } from "./desk.logic";
import type { Catchup } from "./deskFocus.logic";
import { DeskHeading } from "./DeskParts";
import { isDependencyUpdate } from "./deskPrs.logic";

/** Since the user last caught up: work that finished (closed or merged). News, never a task. */
export function CatchupSection(props: {
  readonly catchup: Catchup;
  readonly caughtUpAt: number;
  readonly onCaughtUp: () => void;
  readonly onOpenItem: (item: DeskItem) => void;
}) {
  const closed = props.catchup.closed.filter((item) => !isDependencyUpdate({ title: item.title }));
  const since = new Date(props.caughtUpAt).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  if (closed.length === 0) return null;
  return (
    <details
      aria-label="Done since you last caught up"
      className="rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2">
        <span aria-hidden className="text-xs text-muted-foreground">
          ▸
        </span>
        <DeskHeading>
          Done since {since} · {closed.length}
        </DeskHeading>
        <span className="text-2xs text-muted-foreground">
          Finished work, nothing to do. Open one only if it surprises you.
        </span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {closed.map((item) => (
          <li key={item.itemId} className="flex items-center gap-2">
            <Badge variant="success" size="sm">
              Done
            </Badge>
            <button
              type="button"
              className="min-w-0 cursor-pointer truncate text-left hover:underline"
              onClick={() => props.onOpenItem(item)}
            >
              {deskTitle(item)}
            </button>
            <span className="shrink-0 text-2xs text-muted-foreground">{deskRef(item)}</span>
          </li>
        ))}
      </ul>
      <Button className="mt-2" variant="outline" size="xs" onClick={props.onCaughtUp}>
        I'm caught up
      </Button>
    </details>
  );
}
