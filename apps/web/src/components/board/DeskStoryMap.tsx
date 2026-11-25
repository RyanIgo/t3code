/**
 * Fleet fork: the Stories tab's Map. "What to work on" in bullets, then each area with its
 * stories this sprint, next sprint and later, so the planner's map is visible and steerable.
 */
import { StarIcon } from "lucide-react";
import { useState } from "react";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

import { cn } from "../../lib/utils";
import type { DeskItem } from "./desk.logic";
import { AppDot } from "./deskLevels";
import { DeskHeading } from "./DeskParts";
import type { MapArea, MapColumn, MapInsight, MapStory } from "./storyMap.logic";

const PRIORITY_STYLE: Record<string, string> = {
  P0: "bg-destructive/14 text-destructive-foreground",
  P1: "bg-warning/16 text-warning-foreground",
  P2: "bg-muted text-foreground",
  P3: "bg-muted text-muted-foreground",
};
const SHOWN = 5;
const STAR_FOR: ReadonlyArray<readonly [string, number]> = [
  ["Until tomorrow", 1],
  ["For 3 days", 3],
  ["For a week", 7],
];

/** Star an area or app for a while, or take the star off. */
export function StarMenu(props: {
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

function StoryLine(props: { readonly story: MapStory; readonly onOpen: () => void }) {
  const { story } = props;
  return (
    <li>
      <button
        type="button"
        onClick={props.onOpen}
        className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent"
      >
        <span
          className={cn(
            "w-6 shrink-0 rounded-sm text-center text-2xs font-bold",
            PRIORITY_STYLE[story.priority ?? ""] ?? "text-muted-foreground",
          )}
        >
          {story.priority ?? "P?"}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">#{story.item.number} </span>
          {story.title}
        </span>
        {story.lead ? (
          <span
            role="img"
            aria-label={story.lead === "working" ? "Its lead is working" : "Has a lead (idle)"}
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              story.lead === "working" ? "bg-success" : "bg-muted-foreground/50",
            )}
          />
        ) : null}
      </button>
    </li>
  );
}

function Column(props: {
  readonly stories: ReadonlyArray<MapStory>;
  readonly folded: boolean;
  readonly onOpen: (item: DeskItem) => void;
}) {
  const [open, setOpen] = useState(!props.folded);
  const shown = open ? props.stories : props.stories.slice(0, SHOWN);
  if (props.stories.length === 0)
    return <p className="px-1 text-2xs text-muted-foreground">none</p>;
  return (
    <ul className="flex min-w-0 flex-col">
      {shown.map((story) => (
        <StoryLine key={story.item.itemId} story={story} onOpen={() => props.onOpen(story.item)} />
      ))}
      {shown.length < props.stories.length ? (
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer px-1 text-2xs text-muted-foreground hover:underline"
          >
            +{props.stories.length - shown.length} more
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function Insight(props: {
  readonly insight: MapInsight;
  readonly onOpen: (item: DeskItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const { insight } = props;
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            insight.tone === "you"
              ? "bg-warning"
              : insight.tone === "warn"
                ? "bg-destructive"
                : "bg-muted-foreground/50",
          )}
        />
        <span className={cn(insight.tone === "you" && "font-semibold")}>{insight.text}</span>
        {insight.items && insight.items.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:underline"
          >
            {open ? "hide" : "show"}
          </button>
        ) : null}
      </span>
      {open && insight.items ? (
        <ul className="ms-4 flex flex-col">
          {insight.items.map((item) => (
            <li key={item.itemId}>
              <button
                type="button"
                onClick={() => props.onOpen(item)}
                className="cursor-pointer text-left text-xs hover:underline"
              >
                #{item.number} {item.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function StoryMapView(props: {
  readonly areas: ReadonlyArray<MapArea>;
  readonly insights: ReadonlyArray<MapInsight>;
  readonly sprintNames: { readonly now: string | null; readonly next: string | null };
  readonly showApp: boolean;
  readonly onOpenItem: (item: DeskItem) => void;
  /** Stars an area for some days, or takes the star off (null). */
  readonly onStarArea: (area: MapArea, days: number | null) => void;
}) {
  const columns: ReadonlyArray<readonly [MapColumn, string]> = [
    ["now", props.sprintNames.now ? `This sprint · ${props.sprintNames.now}` : "This sprint"],
    ["next", props.sprintNames.next ? `Next · ${props.sprintNames.next}` : "Next sprint"],
    ["later", "Later · backlog"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="What to work on"
        className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2"
      >
        <DeskHeading>What to work on</DeskHeading>
        {props.insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing stands out: the map is in order.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {props.insights.map((insight) => (
              <Insight key={insight.text} insight={insight} onOpen={props.onOpenItem} />
            ))}
          </ul>
        )}
      </section>
      <div className="overflow-x-auto">
        <div className="flex min-w-[52rem] flex-col">
          <div className="grid grid-cols-[14rem_repeat(3,minmax(0,1fr))] gap-3 border-b border-border px-2 pb-1">
            <DeskHeading>Area</DeskHeading>
            {columns.map(([id, label]) => (
              <DeskHeading key={id}>{label}</DeskHeading>
            ))}
          </div>
          {props.areas.map((area) => {
            const total =
              area.columns.now.length + area.columns.next.length + area.columns.later.length;
            return (
              <section
                key={`${area.app}:${area.feature ?? "none"}`}
                aria-label={area.name}
                className={cn(
                  "grid grid-cols-[14rem_repeat(3,minmax(0,1fr))] gap-3 border-b border-border px-2 py-2",
                  area.star && "bg-warning/6",
                )}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <AppDot app={area.app} />
                    <span className="truncate">{area.name}</span>
                  </span>
                  {props.showApp ? (
                    <span className="text-2xs text-muted-foreground">{area.app}</span>
                  ) : null}
                  <span className="text-2xs text-muted-foreground">
                    {total} open · {area.columns.now.length} now · {area.columns.next.length} next
                  </span>
                  {area.feature ? (
                    <span className="text-2xs">
                      <StarMenu
                        starred={area.star !== null}
                        label={area.name}
                        onStar={(days) => props.onStarArea(area, days)}
                      />
                    </span>
                  ) : null}
                </div>
                {columns.map(([id]) => (
                  <Column
                    key={id}
                    stories={area.columns[id]}
                    folded={id === "later"}
                    onOpen={props.onOpenItem}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </div>
      <p className="text-2xs text-muted-foreground">
        Dots: green, its lead is working; grey, it has a lead. Click a story for its window. Move
        stories between sprints with the Sprint field there, or ask the planner.
      </p>
    </div>
  );
}
