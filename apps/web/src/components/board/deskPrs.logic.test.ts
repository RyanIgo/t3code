import { describe, expect, it } from "vite-plus/test";

import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";
import { collectPrs, groupPrs } from "./deskPrs.logic";

const sprint = { title: "Sprint 1", startDate: "2026-11-16", duration: 14 };
const item = (overrides: Partial<DeskItem>): DeskItem => ({
  itemId: "i",
  kind: "issue",
  repo: "cfevans/app",
  number: 1,
  title: "Issue",
  url: "https://github.com/cfevans/app/issues/1",
  state: "open",
  updatedAt: null,
  closedAt: null,
  status: null,
  priority: null,
  size: null,
  initiative: null,
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
const chat = (threadId: string, prs: CardChatState["pullRequests"]): CardChatState => ({
  environmentId: "env",
  threadId,
  title: threadId,
  projectKey: "p",
  column: "running",
  needsYou: false,
  working: true,
  hasPullRequest: true,
  pullRequestNumber: null,
  pullRequests: prs,
  since: null,
  worktree: null,
  branch: null,
});
const pr = (n: number) => `https://github.com/cfevans/app/pull/${n}`;

describe("PR lens", () => {
  it("merges PRs from items, issues and chats, and says why each isn't ready", () => {
    const items = [
      item({
        itemId: "p1",
        kind: "pr",
        number: 1,
        title: "Ready one",
        url: pr(1),
        mergeable: "mergeable",
        sprint,
      }),
      item({ itemId: "p2", kind: "pr", number: 2, title: "Draft", url: pr(2), state: "draft" }),
      item({
        itemId: "issue",
        number: 9,
        sprint,
        pullRequests: [
          { number: 3, url: pr(3), state: "open", title: "Fixes 9", review: "CHANGES_REQUESTED" },
        ],
      }),
      item({ itemId: "closed", kind: "pr", number: 5, url: pr(5), state: "merged" }),
      item({
        itemId: "p8",
        kind: "pr",
        number: 8,
        url: pr(8),
        checks: "none",
        mergeable: "mergeable",
      }),
    ];
    const chats = [
      chat("a", [
        { url: pr(1), label: "app#1", state: "open", checks: "passing", mergeability: "mergeable" },
      ]),
      chat("b", [
        { url: pr(4), label: "app#4", state: "open", checks: "pending", mergeability: null },
      ]),
      chat("c", [
        { url: pr(1), label: "app#1", state: "open", checks: "failing", mergeability: null },
      ]),
      chat("d", [
        { url: pr(6), label: "app#6", state: "open", checks: "passing", mergeability: "mergeable" },
      ]),
      chat("e", [{ url: pr(7), label: "app#7", state: "open", checks: null, mergeability: null }]),
    ];
    const prs = collectPrs(items, chats);
    const view = Object.fromEntries(
      prs.map((entry) => [entry.number, [entry.stage, entry.reasons.join(", ")]]),
    );
    expect(view).toEqual({
      1: ["fix", "checks failing"],
      2: ["draft", "draft"],
      3: ["fix", "changes requested"],
      4: ["waiting", "checks running"],
      6: ["ready", ""],
      7: ["unverified", "checks not seen, merge state not computed"],
      8: ["ready", ""],
    });
    const three = prs.find((entry) => entry.number === 3);
    expect(three).toMatchObject({
      title: "Fixes 9",
      app: "Precon",
      sprint,
      item: { itemId: "issue" },
    });
    expect(prs.find((entry) => entry.number === 4)?.app).toBe("Precon");
  });

  it("groups by app, sprint or chat with ready PRs first", () => {
    const items = [
      item({ itemId: "p1", kind: "pr", number: 1, url: pr(1), mergeable: "mergeable", sprint }),
      item({ itemId: "p2", kind: "pr", number: 2, url: pr(2), mergeable: "conflicting" }),
    ];
    const prs = collectPrs(items, [
      chat("a", [{ url: pr(2), label: "app#2", state: "open", checks: null, mergeability: null }]),
    ]);
    expect(
      groupPrs(prs, "app").map((group) => [group.label, group.prs.map((entry) => entry.number)]),
    ).toEqual([["Precon", [2, 1]]]);
    expect(groupPrs(prs, "sprint").map((group) => group.label)).toEqual(["Sprint 1", "No sprint"]);
    expect(groupPrs(prs, "chat").map((group) => group.label)).toEqual(["a", "No chat"]);
  });
});
