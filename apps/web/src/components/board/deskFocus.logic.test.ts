import { describe, expect, it } from "vite-plus/test";

import type { DeskItem } from "./desk.logic";
import { focusByApp } from "./deskFocus.logic";
import type { DeskPr } from "./deskPrs.logic";

const sprint = { title: "Sprint 1", startDate: "2026-11-16", duration: 14 };
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
const pr = (overrides: Partial<DeskPr>): DeskPr => ({
  url: "https://github.com/cfevans/app/pull/1",
  repo: "cfevans/app",
  number: 1,
  title: "Real work",
  app: "Precon",
  feature: null,
  sprint: null,
  draft: false,
  checks: "passing",
  mergeable: "mergeable",
  review: null,
  item: null,
  chats: [],
  stage: "ready",
  reasons: [],
  ...overrides,
});

describe("focus by app", () => {
  it("counts what to act on per app and puts the most urgent first", () => {
    const rows = focusByApp({
      apps: ["Precon", "Materials", "Quiet"],
      items: [
        item({ itemId: "a", lane: "Now" }),
        item({ itemId: "b", lane: "Now" }),
        item({ itemId: "c", lane: "Now", state: "closed" }),
        item({ itemId: "d", lane: "Blocked", app: "Materials" }),
        item({ itemId: "e", sprint, status: "Done" }),
        item({ itemId: "f", sprint }),
      ],
      prs: [pr({}), pr({ title: "Bump zod from 3 to 4" }), pr({ app: "Materials", stage: "fix" })],
      sprint,
      needsYou: (app) => (app === "Materials" ? 1 : 0),
      hasChat: (entry) => entry.itemId === "b",
    });
    expect(rows.map((row) => row.app)).toEqual(["Materials", "Precon"]);
    expect(rows[1]).toMatchObject({
      prsReady: 1,
      noAgent: 1,
      sprintDone: 1,
      sprintTotal: 2,
    });
    expect(rows[0]).toMatchObject({ needsYou: 1, prsToFix: 1, blocked: 1 });
  });
});
