import type { ReactNode } from "react";

import { Button } from "../ui/button";
import type { DeskItem } from "./desk.logic";
import { DeskHeading } from "./DeskParts";

/**
 * Fleet fork: the Desk's first tab, for deciding and unblocking. What waits on you, pull requests
 * to merge or send back, and this week's work split by whether an agent is on it.
 */
export function TodayView(props: {
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
