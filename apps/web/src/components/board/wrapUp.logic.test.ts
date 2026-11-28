import { describe, expect, it } from "vite-plus/test";

import type { DeskItem } from "./desk.logic";
import { type DeskChatWork, type DeskNotes, EMPTY_DESK_NOTES } from "./deskNotes.logic";
import { chatsToSettle, chatsToWrapUp, isShipped, isStaleAsk, WRAP_ASKED } from "./wrapUp.logic";

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
  readonly wrapAsked?: string;
  readonly parent?: string;
  readonly updatedAt?: string;
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
  it("doesn't ask again once the lead's next step moved on (asked from another device)", () => {
    const notes = notesWith({ role: "work", next: "Agents: closing #273", wrapAsked: URL });
    expect(chatsToWrapUp(notes, [chat], shipped)).toEqual([]);
  });
});

describe("isStaleAsk", () => {
  const shipped = [item({ state: "closed" })];
  const asking = { ...chat, needsYou: true, asking: "question" as const };
  it("drops a question or failure on shipped work, never a blocking approval", () => {
    expect(isStaleAsk(asking, notesWith({ next: null }), shipped)).toBe(true);
    expect(isStaleAsk({ ...asking, asking: null }, notesWith({ next: null }), shipped)).toBe(true);
    expect(isStaleAsk({ ...asking, asking: "approval" }, notesWith({ next: null }), shipped)).toBe(
      false,
    );
    expect(isStaleAsk(asking, notesWith({ next: null }), [item()])).toBe(false);
    expect(isStaleAsk(chat, notesWith({ next: null }), shipped)).toBe(false);
  });
});

describe("chatsToSettle", () => {
  const shipped = [item({ state: "closed" })];
  const NOW = Date.parse("2026-11-28T12:00:00Z");
  it("settles a lead that shipped and finished wrapping up, nothing busy or unfinished", () => {
    expect(chatsToSettle(notesWith({ role: "work", next: null }), [chat], shipped, NOW)).toEqual([
      chat,
    ]);
    expect(chatsToSettle(notesWith({ role: "work", next: "x" }), [chat], shipped, NOW)).toEqual([]);
    expect(chatsToSettle(notesWith({ role: "work", next: null }), [chat], [item()], NOW)).toEqual(
      [],
    );
    expect(
      chatsToSettle(
        notesWith({ role: "work", next: null }),
        [{ ...chat, working: true }],
        shipped,
        NOW,
      ),
    ).toEqual([]);
    expect(
      chatsToSettle(
        notesWith({ role: "work", next: null }),
        [{ ...chat, needsYou: true, asking: "approval" }],
        shipped,
        NOW,
      ),
    ).toEqual([]);
    expect(chatsToSettle(notesWith({ role: "planner", next: null }), [chat], shipped, NOW)).toEqual(
      [],
    );
  });
  it("settles a helper after three quiet days", () => {
    const quiet = notesWith({ role: "helper", next: null, updatedAt: "2026-11-24T00:00:00Z" });
    const fresh = notesWith({ role: "helper", next: null, updatedAt: "2026-11-27T00:00:00Z" });
    expect(chatsToSettle(quiet, [chat], [item()], NOW)).toEqual([chat]);
    expect(chatsToSettle(fresh, [chat], [item()], NOW)).toEqual([]);
  });
});
