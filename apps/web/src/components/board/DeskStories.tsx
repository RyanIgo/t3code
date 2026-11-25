/**
 * Fleet fork: the Stories tab. Every story at its stage (Proposed → Planned → Mockup → Build →
 * Test → Merge → Wrap up), quick fixes in their own lane, each card showing the one move that's
 * next: Rigo's (a verb in its color) or the agents'. Start review walks him through his moves.
 */
import { Schema } from "effect";
import { useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { AppDot, appColor, LEVELS, LevelMark, VerbChip } from "./deskLevels";
import { DeskHeading } from "./DeskParts";
import { reviewQueue, STAGES, type StoryCard } from "./storyBoard.logic";

const ALL = "All";

function Card(props: {
  readonly card: StoryCard;
  readonly onOpen: () => void;
  readonly current: boolean;
}) {
  const { card } = props;
  const level = card.kind === "proposal" ? "planner" : card.kind === "fix" ? "fix" : "lead";
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className={cn(
        "flex w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border border-s-4 border-border bg-card p-2.5 text-left hover:bg-accent/40",
        card.kind === "proposal" && "border-dashed",
        props.current && "ring-2 ring-primary",
      )}
      style={{ borderInlineStartColor: appColor(card.app) }}
    >
      <span className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
        <LevelMark level={level} short />
        <span className="inline-flex items-center gap-1">
          <AppDot app={card.app} />
          {card.app}
        </span>
      </span>
      <span className="line-clamp-3 text-sm leading-snug font-medium">{card.title}</span>
      {card.ref ? <span className="text-2xs text-muted-foreground">{card.ref}</span> : null}
      {card.move.mine ? (
        <span className="flex items-start gap-1.5 rounded-md border border-warning/50 bg-warning/8 p-1.5 text-xs">
          <VerbChip verb={card.move.verb} className="w-auto" />
          <span className="min-w-0">{card.move.text}</span>
        </span>
      ) : (
        <span className={cn("rounded-md px-1.5 py-1 text-xs", LEVELS.lead.soft, LEVELS.lead.text)}>
          {card.move.text}
        </span>
      )}
    </button>
  );
}

export function StoriesView(props: {
  readonly cards: ReadonlyArray<StoryCard>;
  readonly onOpen: (card: StoryCard) => void;
}) {
  const [app, setApp] = useLocalStorage("t3-fleet:stories-app", ALL, Schema.String);
  const [review, setReview] = useState<{
    readonly keys: ReadonlyArray<string>;
    readonly index: number;
  } | null>(null);
  const apps = [...new Set(props.cards.map((card) => card.app ?? "Other"))].toSorted();
  const shown = props.cards.filter((card) => app === ALL || (card.app ?? "Other") === app);
  const stories = shown.filter((card) => card.kind !== "fix");
  const fixes = shown.filter((card) => card.kind === "fix");
  const moves = reviewQueue(shown);
  const byKey = new Map(props.cards.map((card) => [card.key, card]));
  const current = review ? byKey.get(review.keys[review.index] ?? "") : undefined;
  const step = (index: number) => {
    if (!review) return;
    const card = byKey.get(review.keys[index] ?? "");
    setReview({ ...review, index });
    if (card) props.onOpen(card);
  };
  const start = () => {
    const keys = moves.map((card) => card.key);
    const first = moves[0];
    if (!first) return;
    setReview({ keys, index: 0 });
    props.onOpen(first);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-6">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Stories</h2>
        <span className="text-xs text-muted-foreground">
          {stories.length} stories · {fixes.length} quick fixes · {moves.length}{" "}
          {moves.length === 1 ? "move is" : "moves are"} yours
        </span>
        <span className="ms-auto flex flex-wrap items-center gap-1.5">
          {[ALL, ...apps].map((choice) => (
            <Button
              key={choice}
              size="xs"
              variant={app === choice ? "default" : "outline"}
              onClick={() => setApp(choice)}
            >
              {choice === ALL ? null : <AppDot app={choice} />}
              {choice}
            </Button>
          ))}
          <Button size="sm" disabled={moves.length === 0} onClick={start}>
            Start review · {moves.length}
          </Button>
        </span>
      </header>
      {review && current ? (
        <div
          role="status"
          className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-warning/50 bg-card px-3 py-2 text-sm shadow-sm"
        >
          <b className="font-semibold">
            Review · {review.index + 1} of {review.keys.length}
          </b>
          <VerbChip verb={current.move.verb} className="w-auto" />
          <span className="min-w-0 flex-1 truncate">
            {current.title} · {current.move.text}
          </span>
          <Button size="xs" variant="outline" onClick={() => props.onOpen(current)}>
            Open again
          </Button>
          {review.index + 1 < review.keys.length ? (
            <Button size="xs" onClick={() => step(review.index + 1)}>
              Next ›
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">That was the last one.</span>
          )}
          <Button size="xs" variant="ghost" onClick={() => setReview(null)}>
            End
          </Button>
        </div>
      ) : null}
      <div className="shrink-0 overflow-x-auto pb-1">
        <div className="grid min-w-[72rem] grid-cols-7 gap-2.5">
          {STAGES.map((stage) => {
            const column = stories.filter((card) => card.stage === stage.id);
            return (
              <section
                key={stage.id}
                aria-label={stage.label}
                className="flex min-w-0 flex-col gap-2"
              >
                <div className="flex items-baseline justify-between px-0.5">
                  <DeskHeading>{stage.label}</DeskHeading>
                  <span className="text-2xs text-muted-foreground">{column.length}</span>
                </div>
                {column.map((card) => (
                  <Card
                    key={card.key}
                    card={card}
                    current={card.key === current?.key}
                    onOpen={() => props.onOpen(card)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </div>
      {fixes.length > 0 ? (
        <section
          aria-label="Quick fixes"
          className="flex flex-col gap-2 border-t border-border pt-3"
        >
          <DeskHeading>Quick fixes · {fixes.length}</DeskHeading>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5">
            {fixes.map((card) => (
              <Card
                key={card.key}
                card={card}
                current={card.key === current?.key}
                onOpen={() => props.onOpen(card)}
              />
            ))}
          </div>
        </section>
      ) : null}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No stories in play yet. Approve your planners' grouping cards on Now, and their stories
          show up here.
        </p>
      ) : null}
    </div>
  );
}
