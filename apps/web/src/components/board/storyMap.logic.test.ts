import { describe, expect, it } from "vite-plus/test";

import type { DeskItem, DeskSprint } from "./desk.logic";
import { EMPTY_DESK_NOTES, withStar } from "./deskNotes.logic";
import { buildStoryMap, nextSprint } from "./storyMap.logic";

const S1: DeskSprint = { title: "Sprint 1", startDate: "2026-11-16", duration: 14 };
const S2: DeskSprint = { title: "Sprint 2", startDate: "2026-11-30", duration: 14 };
const AT = "2026-11-24T10:00:00Z";
const item = (number: number, overrides: Partial<DeskItem> = {}): DeskItem => ({
  itemId: `i${number}`,
  kind: "issue",
  repo: "cfevans/app",
  number,
  title: `Story ${number}`,
  url: `https://github.com/cfevans/app/issues/${number}`,
  state: "open",
  updatedAt: null,
  closedAt: null,
  status: "Todo",
  priority: "P2",
  size: null,
  initiative: null,
  app: "Precon",
  feature: "Precon · Bid leveling",
  stage: null,
  workType: "Story",
  sprint: null,
  lane: null,
  pullRequests: [],
  plain: null,
  ...overrides,
});
const map = (items: DeskItem[], notes = EMPTY_DESK_NOTES) =>
  buildStoryMap({
    items,
    notes,
    chats: [],
    app: "Precon",
    current: S1,
    next: S2,
    nowMs: Date.parse(AT),
    moves: 2,
    appOfItem: () => null,
  });

describe("story map", () => {
  it("puts each area's stories in this sprint, next sprint or later", () => {
    const { areas } = map([
      item(1, { sprint: S1, feature: "Precon · Bid upload" }),
      item(2, { sprint: S2, priority: "P1" }),
      item(3, { sprint: S2, priority: "P0" }),
      item(4),
      item(5, { workType: "Tracking" }),
      item(6, { app: "BizDev Leads" }),
    ]);
    const leveling = areas.find((area) => area.name === "Bid leveling");
    expect(leveling?.columns.next.map((story) => story.item.number)).toEqual([3, 2]);
    expect(leveling?.columns.later.map((story) => story.item.number)).toEqual([4]);
    expect(areas.find((area) => area.name === "Bid upload")?.columns.now).toHaveLength(1);
    expect(
      areas.flatMap((area) => area.columns.later).some((story) => story.item.number === 5),
    ).toBe(false);
  });

  it("says what to work on: moves, next sprint, overload, missing priorities", () => {
    const heavy = Array.from({ length: 7 }, (_, index) => item(10 + index, { sprint: S2 }));
    const { insights } = map([
      ...heavy,
      item(30, { sprint: S2, priority: null, feature: "Precon · Bid upload" }),
    ]);
    const text = insights.map((insight) => insight.text).join("\n");
    expect(text).toContain("2 moves are yours now");
    expect(text).toContain("Sprint 2 (starts");
    expect(text).toContain("8 stories in 2 areas, 8 with no lead yet");
    expect(text).toContain("Bid leveling has 7 stories next sprint");
    expect(text).toContain("1 story this sprint or next has no priority");
  });

  it("puts a starred area first", () => {
    const notes = withStar(
      EMPTY_DESK_NOTES,
      { app: "Precon", feature: "Precon · Bid upload", reason: "Austin Thursday" },
      "2026-11-27T00:00:00Z",
      AT,
    );
    const { areas } = map(
      [
        item(1, { sprint: S2 }),
        item(2, { sprint: S2 }),
        item(3, { feature: "Precon · Bid upload" }),
      ],
      notes,
    );
    expect(areas[0]?.name).toBe("Bid upload");
    expect(nextSprint([S2, S1], S1)?.title).toBe("Sprint 2");
  });
});
