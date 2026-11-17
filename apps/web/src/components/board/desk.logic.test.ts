import { describe, expect, it } from "vite-plus/test";

import {
  buildDeskColumns,
  chatsForItem,
  chatWaitsOnYou,
  type DeskItem,
  summarizeInitiatives,
  waitingOnYou,
} from "./desk.logic";
import type { CardChatState } from "./boardCards.logic";

const item = (overrides: Partial<DeskItem> = {}): DeskItem => ({
  itemId: "i1",
  kind: "issue",
  repo: "cfevans/app",
  number: 1,
  title: "Issue",
  url: "https://github.com/cfevans/app/issues/1",
  state: "open",
  updatedAt: "2026-11-16T10:00:00.000Z",
  closedAt: null,
  status: "Todo",
  priority: "P2",
  size: null,
  initiative: "A",
  lane: null,
  pullRequests: [],
  plain: null,
  ...overrides,
});

const pr = (number: number, state = "open") => ({
  number,
  url: `https://github.com/cfevans/app/pull/${number}`,
  state,
});

describe("buildDeskColumns", () => {
  it("puts open work in its lane, unsorted work by priority, and folds PRs into their issue", () => {
    const columns = buildDeskColumns(
      [
        item({ itemId: "now", lane: "Now" }),
        item({ itemId: "low", priority: "P3" }),
        item({ itemId: "high", priority: "P0", pullRequests: [pr(5)] }),
        item({ itemId: "pr5", kind: "pr", url: pr(5).url }),
        item({ itemId: "lone-pr", kind: "pr", url: pr(6).url }),
        item({ itemId: "closed", state: "closed", lane: "Now" }),
      ],
      { initiative: null, query: "" },
    );
    const ids = (lane: keyof typeof columns) => columns[lane].map((entry) => entry.itemId);
    expect(ids("Now")).toEqual(["now"]);
    expect(ids("Unsorted")).toEqual(["high", "lone-pr", "low"]);
  });

  it("filters by initiative and by words in the plain summary", () => {
    const items = [
      item({ itemId: "a", plain: { what: "Match Procore logins", why: null, where: null } }),
      item({ itemId: "b", initiative: "B" }),
    ];
    expect(buildDeskColumns(items, { initiative: "B", query: "" }).Unsorted).toHaveLength(1);
    expect(
      buildDeskColumns(items, { initiative: null, query: "procore" }).Unsorted.map((i) => i.itemId),
    ).toEqual(["a"]);
  });
});

it("finds an item's chats through its PRs or a board card's links", () => {
  const chat = (threadId: string, prUrl: string | null): CardChatState => ({
    environmentId: "env",
    threadId,
    title: threadId,
    projectKey: "p",
    column: "running",
    needsYou: false,
    working: true,
    hasPullRequest: prUrl !== null,
    pullRequestNumber: null,
    pullRequests: prUrl
      ? [{ url: prUrl, label: "", state: "open", checks: null, mergeability: null }]
      : [],
    since: null,
    worktree: null,
    branch: null,
  });
  const target = item({ pullRequests: [pr(5)] });
  const found = chatsForItem(
    target,
    [chat("by-pr", pr(5).url), chat("by-card", null), chat("other", pr(9).url)],
    new Map([["env:by-card", [target.url as string]]]),
  );
  expect(found.map((entry) => entry.threadId)).toEqual(["by-pr", "by-card"]);
});

it("counts a chat as waiting like the sidebar: a question, an unread result, failing checks", () => {
  const base = {
    environmentId: "env",
    threadId: "t",
    title: "t",
    projectKey: "p",
    needsYou: false,
    working: false,
    hasPullRequest: false,
    pullRequestNumber: null,
    pullRequests: [],
    since: null,
    worktree: null,
    branch: null,
  } satisfies Omit<CardChatState, "column">;
  const failing = {
    url: "u",
    label: "",
    state: "open",
    checks: "failing",
    mergeability: null,
  } as const;
  expect(chatWaitsOnYou({ ...base, column: "needs", needsYou: true })).toBe(true);
  expect(chatWaitsOnYou({ ...base, column: "done" })).toBe(true);
  expect(chatWaitsOnYou({ ...base, column: "queued", pullRequests: [failing] })).toBe(true);
  expect(chatWaitsOnYou({ ...base, column: "running", working: true })).toBe(false);
});

it("summarizes initiatives and lists what waits on the user", () => {
  const items = [
    item({ itemId: "n", lane: "Now" }),
    item({ itemId: "b", lane: "Blocked", priority: "P1" }),
    item({ itemId: "r", status: "In Review", pullRequests: [pr(7)] }),
    item({ itemId: "d", state: "closed" }),
  ];
  const [summary] = summarizeInitiatives(items, ["A"]);
  expect(summary?.counts).toMatchObject({ Now: 1, Blocked: 1, Unsorted: 1 });
  expect(summary?.doneRecently).toBe(1);
  expect(waitingOnYou(items).map((entry) => entry.itemId)).toEqual(["b", "r"]);
});
