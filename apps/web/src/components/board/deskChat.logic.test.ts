import { describe, expect, it } from "vite-plus/test";

import {
  buildChatPrompt,
  contextLabel,
  contextLink,
  deskFragment,
  readDeskFragment,
} from "./deskChat.logic";
import type { DeskItem } from "./desk.logic";
import {
  EMPTY_DESK_NOTES,
  mergeDeskNotes,
  parseDeskNotes,
  withLink,
  withNote,
} from "./deskNotes.logic";

const sprint = { title: "Sprint 1", startDate: "2026-11-16", duration: 14 };
const item = (overrides: Partial<DeskItem> = {}): DeskItem => ({
  itemId: "i1",
  kind: "issue",
  repo: "cfevans/cfe-drawings",
  number: 183,
  title: "Restart AI reads safely",
  url: "https://github.com/cfevans/cfe-drawings/issues/183",
  state: "open",
  updatedAt: "2026-11-16T10:00:00.000Z",
  closedAt: null,
  status: "Todo",
  priority: "P0",
  size: null,
  initiative: null,
  app: "Precon",
  feature: "Precon · AI reading pipeline",
  stage: null,
  workType: "Feature work",
  sprint,
  lane: "Now",
  pullRequests: [],
  plain: null,
  ...overrides,
});

describe("chat context", () => {
  it("tells an item's chat what it's on and how to build context", () => {
    const prompt = buildChatPrompt({
      context: { kind: "item", item: item() },
      items: [item()],
      notes: EMPTY_DESK_NOTES,
      sprint,
    });
    expect(prompt).toContain("cfe-drawings#183 from the Dev Desk: Restart AI reads safely");
    expect(prompt).toContain("Feature: AI reading pipeline · Sprint: Sprint 1 · Lane: Now");
    expect(prompt).toContain('desk.mjs context "Precon"');
    expect(prompt).toContain("gh issue view 183 --repo cfevans/cfe-drawings --comments");
  });

  it("gives an app's chat its sprint goal and a snapshot of the work", () => {
    const notes = withNote(
      EMPTY_DESK_NOTES,
      { kind: "sprintGoal", sprint: "Sprint 1", app: "Precon" },
      "Estimators level bids on one screen",
      "2026-11-17T10:00:00Z",
      null,
    );
    const prompt = buildChatPrompt({
      context: { kind: "app", app: "Precon", view: "board", feature: null },
      items: [
        item(),
        item({ itemId: "b", number: 9, title: "Waiting on vendor", lane: "Blocked", sprint: null }),
      ],
      notes,
      sprint,
    });
    expect(prompt).toContain("I'm working on Precon · Board from the Dev Desk.");
    expect(prompt).toContain("Sprint 1 goal: Estimators level bids on one screen");
    expect(prompt).toContain("In Sprint 1:\n- cfe-drawings#183 Restart AI reads safely [Now]");
    expect(prompt).toContain("Blocked:\n- cfe-drawings#9 Waiting on vendor [Blocked]");
  });

  it("labels and links contexts, and keeps the newer link when two devices save", () => {
    expect(contextLabel({ kind: "sprint", sprint, app: null })).toBe("Sprint 1");
    const link = {
      ...contextLink({ kind: "item", item: item() }, sprint),
      updatedAt: "2026-11-17T10:00:00Z",
    };
    expect(link).toMatchObject({ app: "Precon", sprint: "Sprint 1", itemUrl: item().url });
    const older = withLink(EMPTY_DESK_NOTES, "env:t1", {
      ...link,
      about: "old",
      updatedAt: "2026-11-17T09:00:00Z",
    });
    const newer = withLink(EMPTY_DESK_NOTES, "env:t1", link);
    expect(mergeDeskNotes(older, newer).links["env:t1"]?.about).toBe(link.about);
    expect(parseDeskNotes(JSON.stringify(newer)).links["env:t1"]?.itemUrl).toBe(item().url);
    expect(
      parseDeskNotes(
        JSON.stringify({ apps: {}, links: { "env:t2": { ...link, itemUrl: "javascript:x" } } }),
      ).links["env:t2"]?.itemUrl,
    ).toBeNull();
  });
});

describe("desk links back", () => {
  it("round-trips each place on the Desk through its fragment", () => {
    const item = {
      kind: "item",
      view: null,
      feature: null,
      app: "Precon",
      sprint: null,
      itemUrl: "https://github.com/cfevans/cfe-drawings/issues/183",
    } as const;
    expect(readDeskFragment(deskFragment(item))).toEqual({ kind: "item", url: item.itemUrl });
    const app = {
      kind: "app",
      view: "board",
      feature: "Precon · Bid intake",
      app: "Precon",
      sprint: "Sprint 1",
      itemUrl: null,
    } as const;
    expect(readDeskFragment(deskFragment(app))).toEqual({
      kind: "app",
      app: "Precon",
      view: "board",
      feature: "Precon · Bid intake",
    });
    const sprintLink = {
      kind: "sprint",
      view: null,
      feature: null,
      app: null,
      sprint: "Sprint 2",
      itemUrl: null,
    } as const;
    expect(readDeskFragment(deskFragment(sprintLink))).toEqual({
      kind: "sprint",
      sprint: "Sprint 2",
      app: null,
    });
    expect(readDeskFragment("#desk=item&url=javascript:alert(1)")).toBeNull();
    expect(readDeskFragment("#something-else")).toBeNull();
  });
});
