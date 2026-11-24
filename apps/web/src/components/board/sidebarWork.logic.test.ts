import { describe, expect, it } from "vite-plus/test";

import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";
import { EMPTY_DESK_NOTES, withFocus } from "./deskNotes.logic";
import { buildWorkSidebar } from "./sidebarWork.logic";

const item = (number: number, overrides: Partial<DeskItem> = {}): DeskItem => ({
  itemId: `i${number}`,
  kind: "issue",
  repo: "cfevans/app",
  number,
  title: `Issue ${number}`,
  url: `https://github.com/cfevans/app/issues/${number}`,
  state: "open",
  updatedAt: "2026-11-19T10:00:00.000Z",
  closedAt: null,
  status: "Todo",
  priority: "P2",
  size: null,
  initiative: null,
  app: "Precon",
  feature: null,
  stage: null,
  workType: "Story",
  sprint: null,
  lane: null,
  pullRequests: [],
  plain: null,
  ...overrides,
});

const chat = (threadId: string, overrides: Partial<CardChatState> = {}): CardChatState => ({
  environmentId: "env",
  threadId,
  title: threadId,
  projectKey: "p",
  column: "running",
  needsYou: false,
  working: false,
  hasPullRequest: false,
  pullRequestNumber: null,
  pullRequests: [],
  since: "2026-11-19T09:00:00.000Z",
  worktree: null,
  branch: null,
  ...overrides,
});

const link = (kind: "app" | "today", day?: string) => ({
  kind,
  view: null,
  feature: null,
  app: "Precon",
  sprint: null,
  itemUrl: null,
  about: "",
  ...(day ? { day } : {}),
  updatedAt: "2026-11-19T08:00:00.000Z",
});

describe("sidebar work view", () => {
  it("names chats by their item and groups them like the Board", () => {
    const notes = {
      ...withFocus(EMPTY_DESK_NOTES, item(1).url ?? "", "focused-chat", "2026-11-19T08:00:00Z"),
      links: {
        "env:planner-chat": link("app"),
        "env:today-chat": link("today", "2026-11-19"),
        "env:old-today": link("today", "2026-11-18"),
      },
    };
    const view = buildWorkSidebar({
      chats: [
        chat("focused-chat", { working: true }),
        chat("titled-chat", { title: "#2 Something" }),
        chat("asking-chat", { title: "#3 Asks", needsYou: true }),
        chat("planner-chat"),
        chat("today-chat"),
        chat("old-today"),
        chat("loose-chat"),
        chat("done-item-chat", { title: "#4 Finished" }),
        chat("merged-chat", {
          pullRequests: [
            { url: "x", label: "x", state: "merged", checks: null, mergeability: null },
          ],
        }),
      ],
      items: [item(1), item(2), item(3), item(4, { state: "closed", status: "Done" })],
      notes,
      apps: ["Precon"],
      appOfRepo: () => "Precon",
      repoOf: () => "app",
      nowMs: Date.parse("2026-11-19T15:00:00"),
    });
    const ids = (rows: ReadonlyArray<{ chat: CardChatState }>) =>
      rows.map((row) => row.chat.threadId);
    expect(view.today?.chat.threadId).toBe("today-chat");
    // A chat that needs Rigo stays in its app's block, first there.
    expect(ids(view.needsYou)).toEqual([]);
    expect(view.apps.map((group) => group.app)).toEqual(["Precon"]);
    expect(ids(view.apps[0]?.planners ?? [])).toEqual(["planner-chat"]);
    expect(ids(view.apps[0]?.work ?? [])).toEqual(["asking-chat", "focused-chat", "titled-chat"]);
    expect(ids(view.apps[0]?.loose ?? [])).toEqual(["loose-chat"]);
    expect(ids(view.wrapUp).toSorted()).toEqual(["done-item-chat", "merged-chat", "old-today"]);
  });

  it("puts each helper right under its story lead", () => {
    const at = "2026-11-19T08:00:00Z";
    const notes = {
      ...withFocus(EMPTY_DESK_NOTES, item(1).url ?? "", "lead-chat", at),
      work: {
        ...withFocus(EMPTY_DESK_NOTES, item(1).url ?? "", "lead-chat", at).work,
        "helper-chat": {
          items: [],
          next: null,
          role: "helper" as const,
          parent: "lead-chat",
          updatedAt: at,
        },
      },
    };
    const view = buildWorkSidebar({
      chats: [chat("helper-chat"), chat("other-chat", { title: "#2 Other" }), chat("lead-chat")],
      items: [item(1), item(2)],
      notes,
      apps: ["Precon"],
      appOfRepo: () => "Precon",
      repoOf: () => "app",
      nowMs: Date.parse("2026-11-19T15:00:00"),
    });
    const work = (view.apps[0]?.work ?? []).map((row) => row.chat.threadId);
    expect(work.indexOf("helper-chat")).toBe(work.indexOf("lead-chat") + 1);
  });
});
