import { type ReactNode, useState } from "react";

import { Button } from "../ui/button";
import { type DeskItem, type DeskSprint, type WorkKind } from "./desk.logic";
import { DeskHeading, TypeTag } from "./DeskParts";

const KINDS: ReadonlyArray<WorkKind> = ["Story", "Bug", "Maintenance", "Research", "Support"];
const SHOWN = 40;

/**
 * Fleet fork: the Backlog, for choosing what's next. Open work not planned into a sprint,
 * highest priority first, with one click to put an item in the current or next sprint.
 */
export function BacklogView(props: {
  readonly items: ReadonlyArray<DeskItem>;
  readonly kind: WorkKind | null;
  readonly onKind: (kind: WorkKind | null) => void;
  /** The current sprint and the next one, offered as "Add to …". */
  readonly sprints: ReadonlyArray<DeskSprint>;
  readonly card: (
    item: DeskItem,
    draggable: boolean,
    sequence: ReadonlyArray<string>,
    action: ReactNode,
  ) => ReactNode;
  readonly onAddToSprint: (item: DeskItem, sprint: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? props.items : props.items.slice(0, SHOWN);
  const sequence = shown.map((item) => item.itemId);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-6">
      <header className="flex flex-wrap items-center gap-2">
        <DeskHeading>Backlog · {props.items.length}</DeskHeading>
        <span className="text-xs text-muted-foreground">
          Not in a sprint yet, highest priority first.
        </span>
        <span className="ms-auto flex flex-wrap items-center gap-1">
          <Button
            variant={props.kind === null ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={props.kind === null}
            onClick={() => props.onKind(null)}
          >
            All types
          </Button>
          {KINDS.map((kind) => (
            <Button
              key={kind}
              variant={props.kind === kind ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={props.kind === kind}
              onClick={() => props.onKind(props.kind === kind ? null : kind)}
            >
              <TypeTag kind={kind} />
            </Button>
          ))}
        </span>
      </header>
      {props.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting in the backlog.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {shown.map((item) =>
            props.card(
              item,
              false,
              sequence,
              props.sprints.length > 0 ? (
                <span className="flex gap-1">
                  {props.sprints.map((sprint) => (
                    <Button
                      key={sprint.title}
                      variant="outline"
                      size="xs"
                      onClick={() => props.onAddToSprint(item, sprint.title)}
                    >
                      Add to {sprint.title}
                    </Button>
                  ))}
                </span>
              ) : null,
            ),
          )}
        </ol>
      )}
      {props.items.length > SHOWN ? (
        <Button variant="ghost" size="xs" className="self-start" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show ${props.items.length - SHOWN} more`}
        </Button>
      ) : null}
    </div>
  );
}
