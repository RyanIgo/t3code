import { describe, expect, it } from "vite-plus/test";

import {
  type BoardCard,
  type CardChatState,
  buildProjectLists,
  mergeBoards,
  orderAt,
  parseBoardDocument,
  placeCard,
  stageFromChats,
} from "./boardCards.logic";

const chat = (overrides: Partial<CardChatState> = {}): CardChatState => ({
  environmentId: "env",
  threadId: "t1",
  title: "Chat",
  projectKey: "p",
  column: "done",
  needsYou: false,
  working: false,
  hasPullRequest: false,
  pullRequestNumber: null,
  since: "2026-11-16T10:00:00.000Z",
  ...overrides,
});

const card = (overrides: Partial<BoardCard> = {}): BoardCard => ({
  id: "c1",
  projectKey: "p",
  title: "Card",
  notes: "",
  stage: "planned",
  stageSetAt: "2026-11-16T09:00:00.000Z",
  category: null,
  order: 1000,
  chats: [{ environmentId: "env", threadId: "t1" }],
  testing: null,
  createdAt: "2026-11-16T08:00:00.000Z",
  updatedAt: "2026-11-16T09:00:00.000Z",
  ...overrides,
});

describe("stageFromChats", () => {
  it.each([
    ["no chats", [], null, null],
    ["a chat is working", [chat({ working: true })], null, "progress"],
    ["a chat needs you", [chat({ needsYou: true })], "passed", "progress"],
    ["settled, not tested", [chat()], null, "testing"],
    ["passed without a PR", [chat()], "passed", "testing"],
    ["passed with a PR", [chat({ hasPullRequest: true })], "passed", "ready"],
  ] as const)("%s", (_name, chats, testing, expected) => {
    expect(stageFromChats(chats, testing)).toBe(expected);
  });
});

describe("placeCard", () => {
  it("follows its chat when the chat changed after the card was moved by hand", () => {
    expect(placeCard(card(), [chat({ working: true })]).stage).toBe("progress");
  });

  it("keeps a hand-set stage when nothing changed since", () => {
    const moved = card({ stage: "ideas", stageSetAt: "2026-11-16T11:00:00.000Z" });
    expect(placeCard(moved, [chat({ working: true })]).stage).toBe("ideas");
  });

  it("never pulls a card out of Done", () => {
    expect(placeCard(card({ stage: "done" }), [chat({ working: true })]).stage).toBe("done");
  });
});

describe("buildProjectLists", () => {
  it("shows chats no card owns, but not idle ones, and not owned ones twice", () => {
    const lists = buildProjectLists(
      { schemaVersion: 1, cards: [card()], removed: [] },
      "p",
      [
        chat(),
        chat({ threadId: "t2", working: true, column: "running" }),
        chat({ threadId: "t3", column: "queued" }),
      ],
      { includeLooseChats: true },
    );
    const ids = Object.values(lists).flatMap((list) => list.map((placed) => placed.card.id));
    expect(ids.toSorted()).toEqual(["c1", "chat:env:t2"]);
  });
});

describe("mergeBoards", () => {
  it("keeps the newer edit, both sides' additions, and removals", () => {
    const merged = mergeBoards(
      {
        schemaVersion: 1,
        cards: [card({ title: "mine", updatedAt: "2026-11-16T12:00:00.000Z" }), card({ id: "a" })],
        removed: ["gone"],
      },
      {
        schemaVersion: 1,
        cards: [card({ title: "theirs" }), card({ id: "b" }), card({ id: "gone" })],
        removed: [],
      },
    );
    expect(merged.cards.map((entry) => `${entry.id}:${entry.title}`).toSorted()).toEqual([
      "a:Card",
      "b:Card",
      "c1:mine",
    ]);
  });
});

describe("orderAt", () => {
  const list = [{ card: card({ order: 1000 }) }, { card: card({ order: 2000 }) }];
  it.each([
    [0, 0],
    [1, 1500],
    [2, 3000],
  ])("index %i → %i", (index, expected) => {
    expect(orderAt(list, index)).toBe(expected);
  });
});

describe("parseBoardDocument", () => {
  it("drops malformed cards and unknown values instead of failing", () => {
    const parsed = parseBoardDocument(
      JSON.stringify({
        cards: [
          { ...card(), category: "urgent", testing: "maybe" },
          { id: "x", title: "no project", stage: "ideas" },
        ],
      }),
    );
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]).toMatchObject({ category: null, testing: null });
    expect(parseBoardDocument("not json").cards).toEqual([]);
  });
});
