import { describe, expect, it } from "vite-plus/test";

import {
  type BoardCard,
  type CardChatState,
  buildBoardLists,
  githubCardLink,
  listInitiatives,
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
  pullRequests: [],
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
  initiatives: [],
  links: [],
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

  it("moves to Done once every PR on its chats merged, and not before", () => {
    const pr = (state: "open" | "merged") => ({
      url: `https://github.com/o/r/pull/${state === "open" ? 1 : 2}`,
      label: "r#1",
      state,
      checks: null,
      mergeability: null,
    });
    const placedWith = (states: Array<"open" | "merged">) =>
      placeCard(card({ stage: "ready" }), [chat({ pullRequests: states.map(pr) })]).stage;
    expect(placedWith(["merged"])).toBe("done");
    expect(placedWith(["merged", "open"])).not.toBe("done");
  });

  it("never pulls a card out of Done", () => {
    expect(placeCard(card({ stage: "done" }), [chat({ working: true })]).stage).toBe("done");
  });
});

describe("buildBoardLists", () => {
  it("shows chats no card owns, but not idle ones, and not owned ones twice", () => {
    const lists = buildBoardLists(
      { schemaVersion: 1, cards: [card()], removed: [] },
      { kind: "project", projectKey: "p" },
      [
        chat(),
        chat({ threadId: "t2", working: true, column: "running" }),
        chat({ threadId: "t3", column: "queued" }),
      ],
    );
    const ids = Object.values(lists).flatMap((list) => list.map((placed) => placed.card.id));
    expect(ids.toSorted()).toEqual(["c1", "chat:env:t2"]);
  });

  it("shows an initiative's cards from every repo, matched loosely by name, without chats", () => {
    const document = {
      schemaVersion: 1 as const,
      cards: [
        card({ id: "a", projectKey: "p", initiatives: ["Dev workflow"] }),
        card({ id: "b", projectKey: "q", initiatives: ["Other", " dev  Workflow"], chats: [] }),
        card({ id: "c", projectKey: "q", initiatives: ["Other"], chats: [] }),
      ],
      removed: [],
    };
    const lists = buildBoardLists(document, { kind: "initiative", initiative: "dev workflow" }, [
      chat({ threadId: "loose", working: true }),
    ]);
    const ids = Object.values(lists).flatMap((list) => list.map((placed) => placed.card.id));
    expect(ids.toSorted()).toEqual(["a", "b"]);
    expect(listInitiatives(document)).toEqual(["Dev workflow", "Other"]);
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

describe("githubCardLink", () => {
  it.each([
    ["https://github.com/cfevans/claude-setup/issues/76", "claude-setup#76"],
    ["https://github.com/o/r/pull/12/files", "r#12"],
    ["https://gitlab.com/o/r/issues/1", null],
  ])("%s", (url, label) => {
    expect(githubCardLink(url)?.label ?? null).toBe(label);
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
    expect(
      parseBoardDocument(
        JSON.stringify({
          cards: [
            {
              ...card(),
              initiatives: undefined,
              initiative: "Legacy",
              links: [{ url: "javascript:alert(1)", label: "x" }],
            },
          ],
        }),
      ).cards[0],
    ).toMatchObject({ initiatives: ["Legacy"], links: [] });
    expect(parseBoardDocument("not json").cards).toEqual([]);
  });
});
