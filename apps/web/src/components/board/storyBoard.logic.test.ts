import { describe, expect, it } from "vite-plus/test";

import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";
import {
  type DeskNotes,
  EMPTY_DESK_NOTES,
  type PlannerDecision,
  withFocus,
} from "./deskNotes.logic";
import type { DeskPr } from "./deskPrs.logic";
import type { SheetSummary } from "./deskSheets";
import { buildStoryBoard, reviewQueue } from "./storyBoard.logic";

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
  priority: "P1",
  size: null,
  initiative: null,
  app: "Precon",
  feature: null,
  stage: null,
  workType: "Story",
  sprint: { title: "Sprint 1", startDate: "2026-11-16", duration: 14 },
  lane: null,
  pullRequests: [],
  plain: null,
  ...overrides,
});
const chat = (threadId: string, working = false) =>
  ({ threadId, environmentId: "env", working, needsYou: false, title: threadId }) as CardChatState;
const pr = (number: number, stage: DeskPr["stage"], of: DeskItem) =>
  ({
    url: `https://github.com/cfevans/app/pull/${number}`,
    repo: "cfevans/app",
    number,
    stage,
    reasons: [],
    item: of,
    app: "Precon",
  }) as unknown as DeskPr;
const sheet = (title: string, counts: Partial<SheetSummary["counts"]>): SheetSummary => ({
  id: title,
  title,
  updatedAt: AT,
  thread: null,
  counts: { total: 4, pass: 0, fail: 0, skip: 0, blocked: 0, ...counts },
});
const decision = (question: string, itemUrl: string | null = null) =>
  ({
    id: question,
    question,
    itemUrl,
    links: [],
    app: "Precon",
    threadId: "planner",
    answer: null,
    createdAt: AT,
  }) as unknown as PlannerDecision;
const lead = (notes: DeskNotes, of: DeskItem, threadId: string) =>
  withFocus(notes, of.url ?? "", threadId, AT);

const board = (input: {
  items: DeskItem[];
  prs?: DeskPr[];
  sheets?: SheetSummary[];
  notes?: DeskNotes;
  chats?: CardChatState[];
  decisions?: PlannerDecision[];
}) =>
  buildStoryBoard({
    items: input.items,
    prs: input.prs ?? [],
    sheets: input.sheets ?? [],
    notes: input.notes ?? EMPTY_DESK_NOTES,
    chats: input.chats ?? [],
    decisions: input.decisions ?? [],
    sprint: "Sprint 1",
    appOfSheet: () => "Precon",
  });

describe("story board", () => {
  it("puts each story at its stage with the next move", () => {
    const building = item(1);
    const testing = item(2);
    const merging = item(3);
    const planned = item(4);
    const fix = item(5, { workType: "Bug" });
    let notes = lead(EMPTY_DESK_NOTES, building, "lead-1");
    notes = lead(notes, testing, "lead-2");
    const cards = board({
      items: [building, testing, merging, planned, fix],
      prs: [pr(30, "ready", merging)],
      sheets: [sheet("Test sheet — app #2", { pass: 1 })],
      notes,
      chats: [chat("lead-1", true), chat("lead-2")],
      decisions: [decision("Group Precon's work into 3 stories?")],
    });
    const at = (key: string) => cards.find((card) => card.key === key);
    expect(cards[0]?.stage).toBe("proposed");
    expect(at("item:i1")?.stage).toBe("build");
    expect(at("item:i1")?.move.mine).toBe(false);
    expect(at("item:i2")?.stage).toBe("test");
    expect(at("item:i2")?.move.text).toBe("Test 3 checks (~3 min)");
    expect(at("item:i3")?.move).toEqual({ mine: true, verb: "Merge", text: "Merge PR #30" });
    expect(at("item:i4")?.stage).toBe("planned");
    expect(at("item:i5")?.kind).toBe("fix");
    expect(reviewQueue(cards).map((card) => card.stage)).toEqual(["proposed", "test", "merge"]);
  });

  it("asks for the mockup level first, and keeps shipped stories until wrap-up clears", () => {
    const mocked = item(6);
    const shipped = item(7, { state: "closed" });
    const notes = lead(EMPTY_DESK_NOTES, shipped, "lead-7");
    const leadWork = notes.work["lead-7"];
    const withNext: DeskNotes = leadWork
      ? { ...notes, work: { ...notes.work, "lead-7": { ...leadWork, next: "Rigo: merge" } } }
      : notes;
    const cards = board({
      items: [mocked, shipped, item(8, { sprint: null })],
      notes: withNext,
      chats: [chat("lead-7")],
      decisions: [decision("Mockup for #6: Clickable?", mocked.url)],
    });
    expect(cards.find((card) => card.key === "item:i6")?.stage).toBe("mockup");
    expect(cards.find((card) => card.key === "item:i7")?.stage).toBe("wrapup");
    expect(cards.some((card) => card.key === "item:i8")).toBe(false);
  });
});
