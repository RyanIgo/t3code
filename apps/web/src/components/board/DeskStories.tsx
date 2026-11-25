/**
 * Fleet fork: the Stories tab. Every story at its stage (Proposed → Planned → Mockup → Build →
 * Test → Merge → Wrap up), quick fixes in their own lane, each card showing the one move that's
 * next: Rigo's (a verb in its color) or the agents'. Start review walks him through his moves.
 */
import { Schema } from "effect";
import { useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { StarIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import type { Star } from "./deskNotes.logic";
import { AppDot, appColor, LEVELS, LevelMark, VerbChip } from "./deskLevels";
import { DeskHeading } from "./DeskParts";
import { reviewQueue, STAGES, type StoryCard } from "./storyBoard.logic";

const ALL = "All";
/** Days left on a star, at least one, so editing its reason keeps its end date. */
const daysLeft = (star: Star) =>
  Math.max(1, Math.round((Date.parse(star.until) - Date.parse(star.updatedAt)) / 86_400_000));

const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const PRIORITY_STYLE: Record<string, string> = {
  P0: "bg-destructive/14 text-destructive-foreground",
  P1: "bg-warning/16 text-warning-foreground",
  P2: "bg-muted text-foreground",
  P3: "bg-muted text-muted-foreground",
};
const STAR_FOR: ReadonlyArray<readonly [string, number]> = [
  ["Until tomorrow", 1],
  ["For 3 days", 3],
  ["For a week", 7],
];
/** The area's name without its app ("Precon · Bid intake" → "Bid intake"). */
const areaName = (feature: string) => feature.split(" · ").slice(1).join(" · ") || feature;

/** Star an area or app for a while, or take the star off. */
function StarMenu(props: {
  readonly starred: boolean;
  readonly label: string;
  readonly onStar: (days: number | null) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={props.starred ? `${props.label} is starred` : `Star ${props.label}`}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 hover:bg-accent",
              props.starred ? "font-semibold text-warning-foreground" : "text-muted-foreground",
            )}
          />
        }
      >
        <StarIcon className={cn("size-3", props.starred && "fill-current")} aria-hidden />
        {props.label}
      </MenuTrigger>
      <MenuPopup align="start">
        {props.starred ? (
          <MenuItem onClick={() => props.onStar(null)}>Take the star off</MenuItem>
        ) : (
          STAR_FOR.map(([label, days]) => (
            <MenuItem key={label} onClick={() => props.onStar(days)}>
              ★ Star {props.label} {label.toLowerCase()}
            </MenuItem>
          ))
        )}
      </MenuPopup>
    </Menu>
  );
}

function Card(props: {
  readonly card: StoryCard;
  readonly onOpen: () => void;
  readonly current: boolean;
  readonly onPriority: (priority: string) => void;
  readonly onStar: (days: number | null) => void;
}) {
  const { card } = props;
  const level = card.kind === "proposal" ? "planner" : card.kind === "fix" ? "fix" : "lead";
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1.5 rounded-lg border border-s-4 border-border bg-card p-2.5",
        card.kind === "proposal" && "border-dashed",
        card.star && "bg-warning/6",
        props.current && "ring-2 ring-primary",
      )}
      style={{ borderInlineStartColor: appColor(card.app) }}
    >
      <span className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
        <LevelMark level={level} short />
        {card.item ? (
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Change priority"
                  className={cn(
                    "cursor-pointer rounded-sm px-1.5 py-px text-2xs font-bold",
                    PRIORITY_STYLE[card.priority ?? ""] ?? "bg-muted text-muted-foreground",
                  )}
                />
              }
            >
              {card.priority ?? "P?"}
            </MenuTrigger>
            <MenuPopup align="start">
              {PRIORITIES.map((priority) => (
                <MenuItem key={priority} onClick={() => props.onPriority(priority)}>
                  {priority === card.priority ? "✓ " : ""}
                  {priority}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <AppDot app={card.app} />
          {card.app}
        </span>
      </span>
      {card.feature || card.kind === "proposal" ? (
        <span className="text-2xs">
          <StarMenu
            starred={card.star !== null}
            label={card.feature ? areaName(card.feature) : (card.app ?? "this app")}
            onStar={props.onStar}
          />
          {card.star?.reason ? (
            <span className="text-muted-foreground"> · {card.star.reason}</span>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        onClick={props.onOpen}
        className="flex min-w-0 cursor-pointer flex-col gap-1.5 text-left"
      >
        <span className="line-clamp-3 text-sm leading-snug font-medium hover:underline">
          {card.title}
        </span>
        {card.ref ? <span className="text-2xs text-muted-foreground">{card.ref}</span> : null}
        {card.move.mine ? (
          <span className="flex items-start gap-1.5 rounded-md border border-warning/50 bg-warning/8 p-1.5 text-xs">
            <VerbChip verb={card.move.verb} className="w-auto" />
            <span className="min-w-0">{card.move.text}</span>
          </span>
        ) : (
          <span
            className={cn("rounded-md px-1.5 py-1 text-xs", LEVELS.lead.soft, LEVELS.lead.text)}
          >
            {card.move.text}
          </span>
        )}
      </button>
    </div>
  );
}

/** The areas and apps starred now, each with its reason (editable) and end date. */
function StarStrip(props: {
  readonly stars: ReadonlyArray<Star>;
  readonly onReason: (star: Star, reason: string) => void;
  readonly onRemove: (star: Star) => void;
}) {
  if (props.stars.length === 0) return null;
  return (
    <section
      aria-label="Starred"
      className="flex flex-col gap-1.5 rounded-lg border border-warning/50 bg-warning/6 px-3 py-2"
    >
      <span className="text-2xs text-muted-foreground">
        ★ Starred: these go first on Stories, Now and in Start review, and their planners do them
        first.
      </span>
      {props.stars.map((star) => (
        <div key={star.feature ?? star.app} className="flex flex-wrap items-center gap-2 text-sm">
          <b className="inline-flex items-center gap-1 font-semibold">
            <AppDot app={star.app} />★ {star.feature ? areaName(star.feature) : star.app}
          </b>
          <span className="text-xs text-muted-foreground">
            until{" "}
            {new Date(star.until).toLocaleDateString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <Input
            size="sm"
            className="max-w-sm min-w-40 flex-1"
            aria-label="Why it's starred"
            placeholder="Why? e.g. Austin levels Thursday"
            defaultValue={star.reason}
            onBlur={(event) => {
              if (event.target.value.trim() !== star.reason)
                props.onReason(star, event.target.value.trim());
            }}
          />
          <Button size="xs" variant="ghost" onClick={() => props.onRemove(star)}>
            Take the star off
          </Button>
        </div>
      ))}
    </section>
  );
}

export function StoriesView(props: {
  readonly cards: ReadonlyArray<StoryCard>;
  readonly onOpen: (card: StoryCard) => void;
  readonly stars: ReadonlyArray<Star>;
  readonly onPriority: (card: StoryCard, priority: string) => void;
  /** Stars a card's area (or its app) for some days; null takes it off. */
  readonly onStar: (star: Omit<Star, "until" | "updatedAt">, days: number | null) => void;
}) {
  const [app, setApp] = useLocalStorage("t3-fleet:stories-app", ALL, Schema.String);
  const [priority, setPriority] = useLocalStorage("t3-fleet:stories-priority", ALL, Schema.String);
  const [review, setReview] = useState<{
    readonly keys: ReadonlyArray<string>;
    readonly index: number;
  } | null>(null);
  const apps = [...new Set(props.cards.map((card) => card.app ?? "Other"))].toSorted();
  const shown = props.cards
    .filter((card) => app === ALL || (card.app ?? "Other") === app)
    .filter((card) => priority === ALL || card.priority === priority || card.kind === "proposal");
  const starOf = (card: StoryCard) => ({
    app: card.app ?? "Other",
    feature: card.feature,
    reason: card.star?.reason ?? "",
  });
  const cardProps = (card: StoryCard) => ({
    card,
    current: card.key === current?.key,
    onOpen: () => props.onOpen(card),
    onPriority: (value: string) => props.onPriority(card, value),
    onStar: (days: number | null) => props.onStar(starOf(card), days),
  });
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
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs font-medium text-muted-foreground">Priority</span>
        {[ALL, ...PRIORITIES].map((choice) => (
          <Button
            key={choice}
            size="xs"
            variant={priority === choice ? "default" : "outline"}
            onClick={() => setPriority(choice)}
          >
            {choice === ALL ? "Any" : choice}
          </Button>
        ))}
      </div>
      <StarStrip
        stars={props.stars}
        onReason={(star, reason) => props.onStar({ ...star, reason }, daysLeft(star))}
        onRemove={(star) => props.onStar(star, null)}
      />
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
                  <Card key={card.key} {...cardProps(card)} />
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
              <Card key={card.key} {...cardProps(card)} />
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
