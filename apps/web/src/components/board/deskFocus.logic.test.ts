import { describe, expect, it } from "vite-plus/test";

import type { DeskItem } from "./desk.logic";
import type { CardChatState } from "./boardCards.logic";
import {
  arrivals,
  backAgain,
  changesSince,
  handledLast,
  QUEUE_MEMORY_MS,
  stamp,
} from "./deskFocus.logic";

const item = (overrides: Partial<DeskItem>): DeskItem => ({
  itemId: "i",
  kind: "issue",
  repo: "cfevans/app",
  number: 1,
  title: "Issue",
  url: null,
  state: "open",
  updatedAt: null,
  closedAt: null,
  status: null,
  priority: null,
  size: null,
  initiative: null,
  app: "Precon",
  feature: null,
  stage: null,
  workType: "Feature work",
  sprint: null,
  lane: null,
  pullRequests: [],
  plain: null,
  ...overrides,
});

describe("catching up", () => {
  it("lists what finished or started asking since the user caught up", () => {
    const chat = (threadId: string, overrides: Partial<CardChatState>): CardChatState => ({
      environmentId: "env",
      threadId,
      title: threadId,
      projectKey: null,
      column: "running",
      needsYou: false,
      working: false,
      hasPullRequest: false,
      pullRequestNumber: null,
      pullRequests: [],
      since: null,
      worktree: null,
      branch: null,
      ...overrides,
    });
    const since = Date.parse("2026-11-17T12:00:00Z");
    const changes = changesSince(
      since,
      [
        item({ itemId: "old", closedAt: "2026-11-17T11:00:00Z", state: "closed" }),
        item({ itemId: "new", closedAt: "2026-11-17T13:00:00Z", state: "closed" }),
      ],
      [
        chat("done-after", { column: "done", since: "2026-11-17T12:30:00Z" }),
        chat("asking-after", { needsYou: true, since: "2026-11-17T12:45:00Z" }),
        chat("done-before", { column: "done", since: "2026-11-17T11:30:00Z" }),
        chat("running-after", { since: "2026-11-17T12:50:00Z" }),
      ],
    );
    expect(changes.chats.map((entry) => entry.threadId)).toEqual(["asking-after", "done-after"]);
    expect(changes.closed.map((entry) => entry.itemId)).toEqual(["new"]);
  });
});

describe("handledLast", () => {
  it("keeps unopened rows in order above opened ones, longest-ago opened first", () => {
    const rows = ["a", "b", "c", "d"].map((key) => ({ key }));
    expect(handledLast(rows, { a: 20, c: 10 }).map((row) => row.key)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("backAgain", () => {
  it("sinks only rows that changed after he opened them", () => {
    const rows = [
      { key: "answered", sinceMs: 30 },
      { key: "looked", sinceMs: 5 },
      { key: "untouched", sinceMs: 30 },
      { key: "pr", sinceMs: null },
    ];
    expect(backAgain(rows, { answered: 10, looked: 10, pr: 10 })).toEqual({ answered: 10 });
  });
});

describe("arrivals", () => {
  it("names rows never seen, and rows back again after he last saw the queue", () => {
    const rows = [
      { key: "old", sinceMs: 50 },
      { key: "back", sinceMs: 50 },
      { key: "backSeen", sinceMs: 50 },
      { key: "new", sinceMs: null },
    ];
    const seen = { old: 40, back: 40, backSeen: 60 };
    expect(arrivals(rows, seen, { back: 10, backSeen: 10 })).toEqual(["back", "new"]);
  });
});

describe("stamp", () => {
  it("stamps keys and forgets what's older than a week", () => {
    expect(stamp({ old: 0, kept: QUEUE_MEMORY_MS }, ["x"], QUEUE_MEMORY_MS + 1)).toEqual({
      kept: QUEUE_MEMORY_MS,
      x: QUEUE_MEMORY_MS + 1,
    });
  });
});
