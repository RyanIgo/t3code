import type { ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { DeskItem } from "./desk.logic";
import type { AppFocus } from "./deskFocus.logic";
import { DeskHeading } from "./DeskParts";

/**
 * Fleet fork: the Desk's first tab, for deciding and unblocking. What waits on you, pull requests
 * to merge or send back, and this week's work split by whether an agent is on it.
 */
export function TodayView(props: {
  /** The app the Desk is filtered to, or null for all of them. */
  readonly app: string | null;
  /** Across all apps: one row per app, the most urgent first. */
  readonly focus: ReadonlyArray<AppFocus>;
  readonly onPickApp: (app: string | null) => void;
  readonly needsYou: ReactNode;
  readonly prs: ReactNode;
  /** Version bumps ready to merge, kept off Today and listed on the PRs tab. */
  readonly bumps: number;
  readonly now: ReadonlyArray<DeskItem>;
  readonly hasChat: (item: DeskItem) => boolean;
  readonly card: (item: DeskItem) => ReactNode;
  readonly onPrs: () => void;
  readonly onPlan: () => void;
}) {
  const moving = props.now.filter(props.hasChat);
  const idle = props.now.filter((item) => !props.hasChat(item));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
        <h2 className="text-lg font-semibold">
          {props.app ? `Today in ${props.app}` : "Today across all applications"}
        </h2>
        <span className="text-xs text-muted-foreground">
          {props.app
            ? "Only this application. "
            : "Start with the top row: it has the most waiting on you. "}
        </span>
        {props.app ? (
          <Button variant="ghost" size="xs" onClick={() => props.onPickApp(null)}>
            Show all applications
          </Button>
        ) : null}
      </header>
      {props.app === null && props.focus.length > 0 ? (
        <FocusTable rows={props.focus} onPick={props.onPickApp} />
      ) : null}
      {props.needsYou}
      <section aria-label="Merge or send back" className="flex flex-col gap-2 px-4">
        <div className="flex items-center gap-2">
          <DeskHeading>Merge or send back</DeskHeading>
          {props.bumps > 0 ? (
            <Button variant="ghost" size="xs" onClick={props.onPrs}>
              {props.bumps} version bump{props.bumps === 1 ? "" : "s"} also ready
            </Button>
          ) : null}
        </div>
        {props.prs}
      </section>
      <section aria-label="This week" className="flex flex-col gap-2 px-4">
        <div className="flex items-center gap-2">
          <DeskHeading>This week (Now lane) · {props.now.length}</DeskHeading>
          <Button variant="ghost" size="xs" onClick={props.onPlan}>
            Change the plan
          </Button>
        </div>
        {props.now.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing is in Now. Drag the week's work into Now on the Plan tab.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Column
              title="No agent on it"
              hint="Start a chat from the card, or move it out of Now"
              items={idle}
              card={props.card}
            />
            <Column
              title="Agents working"
              hint="Has a chat; its status shows on the card"
              items={moving}
              card={props.card}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function Column(props: {
  readonly title: string;
  readonly hint: string;
  readonly items: ReadonlyArray<DeskItem>;
  readonly card: (item: DeskItem) => ReactNode;
}) {
  return (
    <section
      aria-label={props.title}
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2"
    >
      <header className="px-1">
        <DeskHeading>
          {props.title} · {props.items.length}
        </DeskHeading>
        <p className="text-2xs text-muted-foreground">{props.hint}</p>
      </header>
      {props.items.length === 0 ? (
        <p className="px-1 pb-1 text-xs text-muted-foreground">None.</p>
      ) : (
        <ol className="flex flex-col gap-2">{props.items.map(props.card)}</ol>
      )}
    </section>
  );
}

const COUNTS: ReadonlyArray<{
  readonly key: "needsYou" | "prsToFix" | "prsReady" | "noAgent" | "blocked";
  readonly label: string;
  readonly tone: "warning" | "error" | "success" | "info";
}> = [
  { key: "needsYou", label: "Needs you", tone: "warning" },
  { key: "prsToFix", label: "PRs to fix", tone: "error" },
  { key: "prsReady", label: "Ready to merge", tone: "success" },
  { key: "noAgent", label: "No agent", tone: "info" },
  { key: "blocked", label: "Blocked", tone: "error" },
];

/** Where to look first: each application's counts, the most urgent first. Click to focus. */
function FocusTable(props: {
  readonly rows: ReadonlyArray<AppFocus>;
  readonly onPick: (app: string) => void;
}) {
  return (
    <section
      aria-label="Where to focus"
      className="mx-4 shrink-0 overflow-x-auto rounded-lg border border-border"
    >
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-2xs tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 font-semibold">Application</th>
            {COUNTS.map((count) => (
              <th key={count.key} className="px-2 py-2 text-center font-semibold">
                {count.label}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-semibold">Sprint</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.app} className="border-t border-border hover:bg-muted/40">
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  className="cursor-pointer text-left font-medium hover:underline"
                  onClick={() => props.onPick(row.app)}
                >
                  {row.app}
                </button>
              </td>
              {COUNTS.map((count) => (
                <td key={count.key} className="px-2 py-1.5 text-center tabular-nums">
                  {row[count.key] > 0 ? (
                    <Badge variant={count.tone} size="sm">
                      {row[count.key]}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                {row.sprintTotal > 0 ? `${row.sprintDone} of ${row.sprintTotal} done` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
