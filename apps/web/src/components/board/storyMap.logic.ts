/**
 * Fleet fork: the Map view of the Stories tab (Rigo, 2026-11-24: the board "doesn't provide
 * insight on what to work on"). Each area of an app with its stories in this sprint, next sprint
 * and later, plus the few facts that tell him what to do next, in bullets.
 */
import type { CardChatState } from "./boardCards.logic";
import { type DeskItem, type DeskSprint, deskTitle } from "./desk.logic";
import { type DeskNotes, focusedThreads, type Star, starOn } from "./deskNotes.logic";

export type MapColumn = "now" | "next" | "later";

export interface MapStory {
  readonly item: DeskItem;
  readonly title: string;
  readonly priority: string | null;
  /** A chat is on it, and whether it's working right now. */
  readonly lead: "working" | "idle" | null;
}

export interface MapArea {
  /** "<App> · <area>", or null for work with no area. */
  readonly feature: string | null;
  readonly app: string;
  readonly name: string;
  readonly star: Star | null;
  readonly columns: Readonly<Record<MapColumn, ReadonlyArray<MapStory>>>;
}

/** A line of the "What to work on" box, with the stories it's about when it's a list. */
export interface MapInsight {
  readonly tone: "you" | "warn" | "info";
  readonly text: string;
  readonly items?: ReadonlyArray<DeskItem>;
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const rank = (story: MapStory) => PRIORITY_RANK[story.priority ?? ""] ?? 4;
/** More than this many stories in one area for one sprint is more than one lead can carry. */
const HEAVY = 6;

const isOpen = (item: DeskItem) =>
  (item.state === "open" || item.state === "draft") && item.status !== "Done";

/** The sprint after the current one, by start date. */
export function nextSprint(
  sprints: ReadonlyArray<DeskSprint>,
  current: DeskSprint | null,
): DeskSprint | null {
  if (!current) return null;
  return (
    sprints
      .filter((sprint) => Date.parse(sprint.startDate) > Date.parse(current.startDate))
      .toSorted((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))[0] ?? null
  );
}

export function buildStoryMap(input: {
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly chats: ReadonlyArray<CardChatState>;
  /** Only this app's areas, or every app's when null. */
  readonly app: string | null;
  readonly current: DeskSprint | null;
  readonly next: DeskSprint | null;
  readonly nowMs: number;
  /** Rigo's moves on the board now, for the first bullet. */
  readonly moves: number;
  /** An item with no App field takes its repo's app. */
  readonly appOfItem: (item: DeskItem) => string | null;
}): { readonly areas: ReadonlyArray<MapArea>; readonly insights: ReadonlyArray<MapInsight> } {
  const byChat = new Map(input.chats.map((chat) => [chat.threadId, chat]));
  const groups = new Map<
    string,
    { app: string; feature: string | null; stories: Array<[MapColumn, MapStory]> }
  >();
  for (const item of input.items) {
    if (item.kind !== "issue" || !item.url || !isOpen(item)) continue;
    // Area records ("Feature: …", tracking headers) aren't work.
    if (item.workType === "Tracking") continue;
    const app = item.app ?? input.appOfItem(item);
    if (!app || (input.app !== null && app !== input.app)) continue;
    const leads = [...focusedThreads(input.notes, item.url)].flatMap((threadId) => {
      const chat = byChat.get(threadId);
      return chat ? [chat] : [];
    });
    const story: MapStory = {
      item,
      title: deskTitle(item),
      priority: item.priority,
      lead: leads.length === 0 ? null : leads.some((chat) => chat.working) ? "working" : "idle",
    };
    const sprint = item.sprint?.title ?? null;
    const column: MapColumn =
      sprint !== null && sprint === input.current?.title
        ? "now"
        : sprint !== null && sprint === input.next?.title
          ? "next"
          : // Work already moving counts as this sprint's, whatever its Sprint field says.
            story.lead || item.status === "In Progress" || item.status === "In Review"
            ? "now"
            : "later";
    const key = item.feature ?? `${app} · (no area)`;
    const group = groups.get(key) ?? { app, feature: item.feature, stories: [] };
    group.stories.push([column, story]);
    groups.set(key, group);
  }
  const areas: MapArea[] = [...groups.values()].map((group) => {
    const column = (id: MapColumn) =>
      group.stories
        .filter(([at]) => at === id)
        .map(([, story]) => story)
        .toSorted((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
    return {
      feature: group.feature,
      app: group.app,
      name: group.feature ? group.feature.split(" · ").slice(1).join(" · ") : "No area",
      star: starOn(input.notes, group.app, group.feature, input.nowMs),
      columns: { now: column("now"), next: column("next"), later: column("later") },
    };
  });
  // Starred first, then the areas with the most work coming soonest; "No area" last.
  const weight = (area: MapArea) => area.columns.now.length * 3 + area.columns.next.length * 2;
  const sorted = areas.toSorted(
    (a, b) =>
      Number(b.star !== null) - Number(a.star !== null) ||
      Number(a.feature === null) - Number(b.feature === null) ||
      weight(b) - weight(a) ||
      a.name.localeCompare(b.name),
  );

  const all = sorted.flatMap((area) => [
    ...area.columns.now,
    ...area.columns.next,
    ...area.columns.later,
  ]);
  const soon = sorted.flatMap((area) => [...area.columns.now, ...area.columns.next]);
  const insights: MapInsight[] = [];
  if (input.moves > 0)
    insights.push({
      tone: "you",
      text: `${input.moves} ${input.moves === 1 ? "move is" : "moves are"} yours now: press Start review`,
    });
  const starred = sorted.filter((area) => area.star);
  for (const area of starred)
    insights.push({
      tone: "info",
      text: `★ ${area.name}${area.star?.reason ? ` (${area.star.reason})` : ""}: ${area.columns.now.length + area.columns.next.length} stories this sprint and next go first`,
    });
  if (input.next) {
    const next = sorted.flatMap((area) => area.columns.next);
    const unled = next.filter((story) => !story.lead);
    // A sprint's start is a calendar date: read it at local noon so no time zone shifts the day.
    const start = new Date(`${input.next.startDate.slice(0, 10)}T12:00:00`).toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    insights.push({
      tone: next.length > 0 ? "info" : "warn",
      text:
        next.length > 0
          ? `${input.next.title} (starts ${start}): ${next.length} stories in ${sorted.filter((area) => area.columns.next.length > 0).length} areas, ${unled.length} with no lead yet`
          : `${input.next.title} (starts ${start}) has nothing planned yet: pick its stories`,
    });
  }
  for (const area of sorted) {
    if (area.columns.next.length > HEAVY)
      insights.push({
        tone: "warn",
        text: `${area.name} has ${area.columns.next.length} stories next sprint: more than one lead finishes in a sprint; star what matters or push some to later`,
        items: area.columns.next.map((story) => story.item),
      });
  }
  const unranked = soon.filter((story) => story.priority === null);
  if (unranked.length > 0)
    insights.push({
      tone: "warn",
      text: `${unranked.length} ${unranked.length === 1 ? "story" : "stories"} this sprint or next ${unranked.length === 1 ? "has" : "have"} no priority: set P0–P3 so the planner knows the order`,
      items: unranked.map((story) => story.item),
    });
  const noArea = all.filter((story) => story.item.feature === null);
  if (noArea.length > 0)
    insights.push({
      tone: "info",
      text: `${noArea.length} open ${noArea.length === 1 ? "item has" : "items have"} no area (mostly upkeep): fine as quick fixes, or give them an area`,
    });
  return { areas: sorted, insights };
}
