import { describe, expect, it } from "vite-plus/test";

import type { DeskItem } from "./desk.logic";
import { type DeskChatWork, type DeskNotes, EMPTY_DESK_NOTES } from "./deskNotes.logic";
import { chatsToWrapUp, isShipped, WRAP_ASKED } from "./wrapUp.logic";

const URL = "https://github.com/cfevans/app/issues/273";
const item = (overrides: Partial<DeskItem> = {}): DeskItem => ({
  itemId: "i1",
  kind: "issue",
  repo: "cfevans/app",
  number: 273,
  title: "New tools keep their grants",
  url: URL,
  state: "open",
  updatedAt: null,
  closedAt: null,
  status: "In Review",
  priority: "P1",
  size: null,
  initiative: null,
  app: "Warehouse",
  feature: null,
  stage: null,
  workType: "Story",
  sprint: null,
  lane: null,
  pullRequests: [],
  plain: null,
  ...overrides,
});
const pr = (number: number, state: string) => ({
  number,
  url: `https://github.com/cfevans/app/pull/${number}`,
  state,
});
const notesWith = (work: {
  readonly next: string | null;
  readonly role?: NonNullable<DeskChatWork["role"]>;
}): DeskNotes => ({
  ...EMPTY_DESK_NOTES,
  work: {
    t1: {
      items: [{ url: URL, from: "2026-11-24T03:00:00Z", until: null }],
      updatedAt: "2026-11-24T03:00:00Z",
      ...work,
    },
  },
});
const chat = { threadId: "t1", working: false, needsYou: false };

describe("isShipped", () => {
  it("is shipped when closed, or when every PR settled with one merged", () => {
    expect(isShipped(item({ state: "closed" }))).toBe(true);
    expect(isShipped(item({ pullRequests: [pr(282, "merged"), pr(283, "closed")] }))).toBe(true);
    expect(isShipped(item({ pullRequests: [pr(282, "merged"), pr(283, "open")] }))).toBe(false);
    expect(isShipped(item({ pullRequests: [pr(283, "closed")] }))).toBe(false);
    expect(isShipped(item())).toBe(false);
  });
});

describe("chatsToWrapUp", () => {
  const shipped = [item({ state: "closed", pullRequests: [pr(282, "merged")] })];
  it("asks an idle lead whose item shipped but still has a next step", () => {
    const notes = notesWith({ role: "work", next: "Rigo: answer the PR #282 merge ask" });
    expect(chatsToWrapUp(notes, [chat], shipped)).toHaveLength(1);
  });
  it("asks once, never a busy chat, a planner, or one that already wrapped up", () => {
    expect(chatsToWrapUp(notesWith({ next: `${WRAP_ASKED} of #273` }), [chat], shipped)).toEqual(
      [],
    );
    expect(chatsToWrapUp(notesWith({ next: "" }), [chat], shipped)).toEqual([]);
    expect(chatsToWrapUp(notesWith({ role: "planner", next: "x" }), [chat], shipped)).toEqual([]);
    expect(chatsToWrapUp(notesWith({ next: "x" }), [{ ...chat, working: true }], shipped)).toEqual(
      [],
    );
    expect(chatsToWrapUp(notesWith({ next: "x" }), [chat], [item()])).toEqual([]);
  });
});
