import { describe, expect, it } from "vite-plus/test";

import type { DeskItem } from "./desk.logic";
import type { CardChatState } from "./boardCards.logic";
import { changesSince } from "./deskFocus.logic";

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
