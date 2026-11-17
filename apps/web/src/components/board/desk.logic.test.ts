import { describe, expect, it } from "vite-plus/test";

import {
  appRepos,
  buildDeskColumns,
  chatsForApp,
  chatsForItem,
  chatWaitsOnYou,
  type DeskItem,
  currentSprint,
  groupWork,
  sprintOverview,
  summarizeApps,
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
  app: "Precon",
  feature: "Precon · Bid intake",
  stage: null,
  workType: "Feature work",
  sprint: null,
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
      { app: null, query: "" },
    );
    const ids = (lane: keyof typeof columns) => columns[lane].map((entry) => entry.itemId);
    expect(ids("Now")).toEqual(["now"]);
    expect(ids("Unsorted")).toEqual(["high", "lone-pr", "low"]);
  });

  it("filters by application and by words in the plain summary, and hides tracking items", () => {
    const items = [
      item({ itemId: "a", plain: { what: "Match Procore logins", why: null, where: null } }),
      item({ itemId: "b", app: "Materials" }),
      item({ itemId: "header", workType: "Tracking" }),
    ];
    expect(buildDeskColumns(items, { app: "Materials", query: "" }).Unsorted).toHaveLength(1);
    expect(
      buildDeskColumns(items, { app: null, query: "procore" }).Unsorted.map((i) => i.itemId),
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

it("finds the running sprint, else the next one", () => {
  const sprints = [
    { title: "Sprint 1", startDate: "2026-11-16", duration: 14 },
    { title: "Sprint 2", startDate: "2026-11-30", duration: 14 },
  ];
  expect(currentSprint(sprints, Date.parse("2026-11-29T12:00:00Z"))?.title).toBe("Sprint 1");
  expect(currentSprint(sprints, Date.parse("2026-11-30T12:00:00Z"))?.title).toBe("Sprint 2");
  expect(currentSprint(sprints, Date.parse("2026-11-01T12:00:00Z"))?.title).toBe("Sprint 1");
});

it("scores an app: features by stage, this sprint's split, blockers; and what waits on the user", () => {
  const sprint = { title: "Sprint 1", startDate: "2026-11-16", duration: 14 };
  const items = [
    item({
      itemId: "f",
      title: "Feature: Bid intake",
      workType: "Tracking",
      stage: "Testing",
      url: "https://github.com/cfevans/app/issues/9",
    }),
    item({ itemId: "s1", sprint, lane: "Now" }),
    item({ itemId: "s2", sprint, workType: "Maintenance", feature: null }),
    item({ itemId: "b", lane: "Blocked", priority: "P1" }),
    item({ itemId: "r", status: "In Review", pullRequests: [pr(7)] }),
    item({ itemId: "other", app: "Materials" }),
  ];
  const [summary] = summarizeApps(items, ["Precon"], sprint);
  expect(summary?.features).toEqual([
    {
      feature: "Precon · Bid intake",
      name: "Bid intake",
      stage: "Testing",
      url: "https://github.com/cfevans/app/issues/9",
      open: 3,
      inSprint: 1,
      blocked: 1,
    },
  ]);
  expect(summary?.sprintItems.map((entry) => entry.itemId)).toEqual(["s1", "s2"]);
  expect(summary?.mix).toEqual({ feature: 1, maintenance: 1, other: 0 });
  expect(summary?.maintenance).toBe(1);
  expect(waitingOnYou(items).map((entry) => entry.itemId)).toEqual(["b", "r"]);
});

it("lists an app's chats by repo, waiting ones first", () => {
  const chat = (threadId: string, projectKey: string, needsYou: boolean): CardChatState => ({
    environmentId: "env",
    threadId,
    title: threadId,
    projectKey,
    column: needsYou ? "needs" : "running",
    needsYou,
    working: !needsYou,
    hasPullRequest: false,
    pullRequestNumber: null,
    pullRequests: [],
    since: null,
    worktree: null,
    branch: null,
  });
  const names: Record<string, string> = { a: "cfevans/app", b: "app", c: "other" };
  const repos = appRepos(
    [item({ repo: "cfevans/app" }), item({ app: "Materials", repo: "cfevans/x" })],
    "Precon",
  );
  expect([...repos]).toEqual(["app"]);
  const found = chatsForApp(
    [chat("working", "a", false), chat("waiting", "b", true), chat("elsewhere", "c", true)],
    repos,
    (key) => names[key] ?? null,
  );
  expect(found.map((entry) => entry.threadId)).toEqual(["waiting", "working"]);
});

it("groups an app's work by sprint, blocked, open and recently done, and sums a sprint", () => {
  const sprint = { title: "Sprint 1", startDate: "2026-11-16", duration: 14 };
  const items = [
    item({ itemId: "s", sprint }),
    item({ itemId: "s-done", sprint, state: "closed", closedAt: "2026-11-17T00:00:00Z" }),
    item({ itemId: "b", lane: "Blocked" }),
    item({ itemId: "o" }),
    item({ itemId: "d", state: "closed", closedAt: "2026-11-15T00:00:00Z" }),
    item({ itemId: "m", sprint, workType: "Maintenance", app: "Materials" }),
    item({ itemId: "t", sprint, workType: "Tracking" }),
  ];
  const work = groupWork(items, (entry) => entry.app === "Precon", sprint);
  expect({
    sprint: work.sprint.map((entry) => entry.itemId),
    blocked: work.blocked.map((entry) => entry.itemId),
    open: work.open.map((entry) => entry.itemId),
    done: work.done.map((entry) => entry.itemId),
  }).toEqual({ sprint: ["s"], blocked: ["b"], open: ["o"], done: ["s-done", "d"] });
  const overview = sprintOverview(items, sprint, ["Precon", "Materials"]);
  expect(overview).toMatchObject({
    total: 3,
    done: 1,
    mix: { feature: 1, maintenance: 1, other: 0 },
  });
  expect(overview.apps.map((entry) => [entry.app, entry.items.length, entry.done])).toEqual([
    ["Precon", 2, 1],
    ["Materials", 1, 0],
  ]);
});
