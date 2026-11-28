import { describe, expect, it } from "vite-plus/test";

import {
  appRepos,
  buildBacklog,
  buildSprintBoard,
  chatsForApp,
  chatsForItem,
  ownChats,
  chatStatus,
  chatWaitsOnYou,
  type DeskItem,
  currentSprint,
  groupWork,
  itemByTitleRef,
  sprintOverview,
  chatTitle,
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

describe("sprint board and backlog", () => {
  const chat = (overrides: Partial<CardChatState>): CardChatState => ({
    environmentId: "env",
    threadId: "t",
    title: "Chat",
    projectKey: "p",
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
  const sprint1 = { title: "Sprint 1", startDate: "2026-11-16", duration: 14 };
  const sprint0 = { title: "Sprint 0", startDate: "2026-11-02", duration: 14 };

  it("puts sprint work in its Status column, moved on by its PRs and agents", () => {
    const board = buildSprintBoard(
      [
        item({ itemId: "todo", sprint: sprint1, status: null }),
        item({ itemId: "doing", sprint: sprint1, status: "In Progress", priority: "P0" }),
        item({ itemId: "review", sprint: sprint1, status: "In Review", pullRequests: [pr(5)] }),
        item({ itemId: "pr5", kind: "pr", url: pr(5).url, sprint: sprint1 }),
        item({ itemId: "closed", sprint: sprint1, state: "closed", status: "In Progress" }),
        item({ itemId: "other", sprint: sprint0 }),
        item({ itemId: "pr-open", sprint: sprint1, status: "Todo", pullRequests: [pr(7)] }),
        item({ itemId: "pr-draft", sprint: sprint1, pullRequests: [pr(8, "draft")] }),
        item({ itemId: "agent", sprint: sprint1, priority: "P3" }),
        item({ itemId: "result", sprint: sprint1, status: "Todo" }),
        item({ itemId: "sheet", sprint: sprint1, status: "In Progress" }),
        item({ itemId: "closed-pr-open", sprint: sprint1, state: "closed", pullRequests: [pr(9)] }),
        item({ itemId: "closed-asking", sprint: sprint1, state: "closed" }),
        item({
          itemId: "closed-unticked",
          sprint: sprint1,
          state: "closed",
          story: { text: "", criteria: [{ text: "a", done: false }] },
        }),
      ],
      sprint1,
      { app: null, query: "" },
      (entry) => ({
        chats:
          entry.itemId === "agent"
            ? [chat({ working: true })]
            : entry.itemId === "result"
              ? [chat({ column: "done" })]
              : entry.itemId === "closed-asking"
                ? [chat({ needsYou: true })]
                : [],
        focused: false,
        sheet: entry.itemId === "sheet" ? { unchecked: 3, failed: 0 } : null,
      }),
    );
    const ids = (status: keyof typeof board) => board[status].map((entry) => entry.itemId);
    expect(ids("Todo")).toEqual(["todo"]);
    expect(ids("In Progress")).toEqual(["doing", "pr-draft", "agent"]);
    expect(ids("In Review").toSorted()).toEqual([
      "closed-asking",
      "closed-pr-open",
      "closed-unticked",
      "pr-open",
      "result",
      "review",
      "sheet",
    ]);
    expect(ids("Done")).toEqual(["closed"]);
  });

  it("lists open work outside planned sprints by priority, filtered by app, kind and words", () => {
    const items = [
      item({ itemId: "planned", sprint: sprint1 }),
      item({ itemId: "carried", sprint: sprint0, priority: "P1" }),
      item({ itemId: "bug", workType: "Fix", priority: "P0" }),
      item({ itemId: "story", plain: { what: "Match Procore logins", why: null, where: null } }),
      item({ itemId: "materials", app: "Materials" }),
      item({ itemId: "header", workType: "Tracking" }),
      item({ itemId: "done", state: "closed" }),
    ];
    const planned = new Set(["Sprint 1"]);
    const ids = (filter: Parameters<typeof buildBacklog>[2]) =>
      buildBacklog(items, planned, filter).map((entry) => entry.itemId);
    expect(ids({ app: "Precon", query: "", kind: null })).toEqual(["bug", "carried", "story"]);
    expect(ids({ app: null, query: "", kind: "Bug" })).toEqual(["bug"]);
    expect(ids({ app: null, query: "procore", kind: null })).toEqual(["story"]);
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
  const titledChat = { ...chat("by-title", null), title: "#5 Compliance: prove it" };
  const otherRepo = { ...titledChat, threadId: "other-repo", projectKey: "q" };
  const more = chatsForItem(
    { ...target, number: 5, repo: "o/r" },
    [chat("other", null), titledChat, otherRepo, chat("focused", null)],
    new Map(),
    {
      focused: new Set(["focused"]),
      repoOf: (entry) => (entry.projectKey === "p" ? "r" : "elsewhere"),
    },
  );
  expect(more.map((entry) => entry.threadId)).toEqual(["focused", "by-title"]);
  const own = ownChats(
    { ...target, number: 5, repo: "o/r" },
    [chat("by-pr", pr(5).url), titledChat, chat("focused", null), chat("started", null)],
    {
      focused: new Set(["focused"]),
      linked: new Set(["env:started"]),
      repoOf: () => "r",
    },
  );
  expect(own.map((entry) => entry.threadId)).toEqual(["by-title", "focused", "started"]);
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
  expect(sprintOverview(items, sprint, ["Precon"], false)).toMatchObject({ total: 2, done: 1 });
});

it("reads chat titles without pasted links", () => {
  expect(chatTitle("PR #233 (https://github.com/cfevans/cfe-data-warehouse/pull/233)")).toBe(
    "PR #233",
  );
  expect(chatTitle("Review https://github.com/cfevans/app/issues/12 today")).toBe(
    "Review app#12 today",
  );
  expect(chatTitle("https://example.com/x")).toBe("https://example.com/x");
  expect(chatTitle("PR #233 (https://github.com/cfevans/cfe-data-wareh")).toBe("PR #233");
  expect(chatTitle("Permissions")).toBe("Permissions");
});

it("names a chat's status, needing the user first", () => {
  const chat = (overrides: Partial<CardChatState>): CardChatState => ({
    environmentId: "env",
    threadId: "t",
    title: "t",
    projectKey: "p",
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
  const failing = {
    url: "u",
    label: "",
    state: "open",
    checks: "failing",
    mergeability: null,
  } as const;
  expect(
    [
      chat({ column: "queued" }),
      chat({ working: true }),
      chat({ needsYou: true, column: "needs" }),
      chat({ column: "done" }),
      chat({ pullRequests: [failing] }),
      chat({}),
    ]
      .map(chatStatus)
      .sort((a, b) => a.rank - b.rank)
      .map((status) => status.label),
  ).toEqual(["Needs you", "Checks failing", "Turn done", "Working", "Idle", "Idle"]);
});

describe("itemByTitleRef", () => {
  const warehouse = item({
    itemId: "w",
    repo: "cfevans/cfe-data-warehouse",
    number: 145,
    url: "https://github.com/cfevans/cfe-data-warehouse/issues/145",
  });
  const bizdev = item({
    itemId: "b",
    repo: "cfevans/cfe-bizdev",
    number: 129,
    url: "https://github.com/cfevans/cfe-bizdev/issues/129",
    pullRequests: [{ ...pr(145), url: "https://github.com/cfevans/cfe-bizdev/pull/145" }],
  });

  it("matches the repo the title names, not another repo's same number", () => {
    const title = "Test sheet — PR cfe-bizdev #145 The whole site uses the light MUI frame";
    expect(itemByTitleRef(title, [warehouse, bizdev])?.itemId).toBe("b");
    expect(itemByTitleRef("cfe-data-warehouse#145 health", [bizdev, warehouse])?.itemId).toBe("w");
    expect(itemByTitleRef("cfe-bizdev #145", [warehouse])).toBeNull();
  });

  it("takes a bare number from any repo", () => {
    expect(itemByTitleRef("#145 health", [warehouse])?.itemId).toBe("w");
  });
});
