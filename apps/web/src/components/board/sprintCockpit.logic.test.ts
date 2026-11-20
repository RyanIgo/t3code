import { describe, expect, it } from "vite-plus/test";

import type { CardChatState } from "./boardCards.logic";
import type { DeskItem, ItemSignals } from "./desk.logic";
import { featureGroups, storySteps } from "./sprintCockpit.logic";

const sprint = { title: "Sprint 1", startDate: "2026-11-17", duration: 14 };

const item = (overrides: Partial<DeskItem> = {}): DeskItem => ({
  itemId: "i1",
  kind: "issue",
  repo: "cfevans/app",
  number: 1,
  title: "Issue",
  url: "https://github.com/cfevans/app/issues/1",
  state: "open",
  updatedAt: null,
  closedAt: null,
  status: "In Progress",
  priority: "P1",
  size: null,
  initiative: null,
  app: "Precon",
  feature: "Precon · Bid intake",
  stage: null,
  workType: "Story",
  sprint,
  lane: null,
  pullRequests: [],
  plain: null,
  story: { text: "As a PM…", criteria: [{ text: "Bids show", done: false }] },
  ...overrides,
});

const chat = (overrides: Partial<CardChatState>) => overrides as CardChatState;
const signals = (overrides: Partial<ItemSignals> = {}): ItemSignals => ({
  chats: [],
  focused: false,
  sheet: null,
  ...overrides,
});

describe("storySteps", () => {
  it("shows an agent building a defined story, the rest still to come", () => {
    expect(
      storySteps(item(), signals({ chats: [chat({ working: true })], focused: true }), null),
    ).toEqual(["done", "agent", "todo", "todo", "todo", "todo"]);
  });

  it("puts a story whose sheet waits on Rigo on him, and a chat asking him on him", () => {
    const withPr = item({
      pullRequests: [{ number: 5, url: "https://github.com/cfevans/app/pull/5", state: "open" }],
    });
    const sheet = { unchecked: 3, failed: 0 };
    expect(storySteps(withPr, signals({ sheet }), null)[3]).toBe("you");
    expect(storySteps(item(), signals({ chats: [chat({ needsYou: true })] }), null)[1]).toBe("you");
  });

  it("marks a story with no criteria as not defined and skips proving it", () => {
    const steps = storySteps(item({ story: null }), signals(), null);
    expect(steps[0]).toBe("todo");
    expect(steps[4]).toBe("skip");
  });

  it("finishes every step once the item is closed and wrapped up", () => {
    const closed = item({
      state: "closed",
      status: "Done",
      story: { text: "", criteria: [{ text: "x", done: true }] },
    });
    expect(storySteps(closed, signals(), null).every((step) => step === "done")).toBe(true);
  });
});

describe("featureGroups", () => {
  it("groups the app's sprint work by feature, items in no feature last, done apart", () => {
    const items = [
      item({ itemId: "a" }),
      item({
        itemId: "b",
        state: "closed",
        status: "Done",
        story: { text: "", criteria: [{ text: "x", done: true }] },
      }),
      item({ itemId: "c", feature: null }),
      item({ itemId: "d", app: "Materials" }),
      item({ itemId: "f", workType: "Tracking", title: "Feature: Bid intake", stage: "Testing" }),
    ];
    const groups = featureGroups(items, sprint, "Precon", () => signals());
    expect(groups.map((group) => group.name)).toEqual(["Bid intake", null]);
    expect(groups[0]?.stage).toBe("Testing");
    expect(groups[0]?.stories.map((entry) => entry.itemId)).toEqual(["a"]);
    expect(groups[0]?.done.map((entry) => entry.itemId)).toEqual(["b"]);
  });
});
