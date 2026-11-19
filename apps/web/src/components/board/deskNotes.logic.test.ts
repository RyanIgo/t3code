import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_DESK_NOTES,
  mergeDeskNotes,
  noteAt,
  parseDeskNotes,
  pinnedChats,
  chatFocus,
  focusedChat,
  todayChatFor,
  untitledTodayChats,
  withFocus,
  withNote,
  withPin,
} from "./deskNotes.logic";

describe("desk notes", () => {
  it("keeps each note's newer edit when two devices save", () => {
    const mine = withNote(
      withNote(
        EMPTY_DESK_NOTES,
        { kind: "app", app: "Precon" },
        "mine",
        "2026-11-17T10:00:00Z",
        null,
      ),
      { kind: "sprintGoal", sprint: "Sprint 1", app: "Precon" },
      "goal",
      "2026-11-17T09:00:00Z",
      null,
    );
    const theirs = withNote(
      withNote(
        EMPTY_DESK_NOTES,
        { kind: "app", app: "Precon" },
        "older",
        "2026-11-17T08:00:00Z",
        "agent",
      ),
      { kind: "sprintNotes", sprint: "Sprint 1" },
      "feedback",
      "2026-11-17T11:00:00Z",
      "agent",
    );
    const merged = mergeDeskNotes(mine, theirs);
    expect(noteAt(merged, { kind: "app", app: "Precon" })?.text).toBe("mine");
    expect(noteAt(merged, { kind: "sprintGoal", sprint: "Sprint 1", app: "Precon" })?.text).toBe(
      "goal",
    );
    expect(noteAt(merged, { kind: "sprintNotes", sprint: "Sprint 1" })?.by).toBe("agent");
  });

  it("keeps each direction section's newer edit, per application", () => {
    const base = withNote(
      EMPTY_DESK_NOTES,
      { kind: "direction", app: "Precon", section: "arc" },
      "old arc",
      "2026-11-18T10:00:00Z",
      null,
    );
    const mine = withNote(
      base,
      { kind: "direction", app: "Precon", section: "arc" },
      "new arc",
      "2026-11-18T12:00:00Z",
      null,
    );
    const theirs = withNote(
      base,
      { kind: "direction", app: "Precon", section: "goals" },
      "goals",
      "2026-11-18T11:00:00Z",
      "agent",
    );
    const merged = parseDeskNotes(JSON.stringify(mergeDeskNotes(mine, theirs)));
    expect(noteAt(merged, { kind: "direction", app: "Precon", section: "arc" })?.text).toBe(
      "new arc",
    );
    expect(noteAt(merged, { kind: "direction", app: "Precon", section: "goals" })?.by).toBe(
      "agent",
    );
  });

  it("pins chats to places, newest first, and an unpin on one device wins over an older pin", () => {
    const precon = { kind: "app", app: "Precon" } as const;
    const pinned = withPin(
      withPin(EMPTY_DESK_NOTES, precon, "env:a", true, "2026-11-18T10:00:00Z"),
      precon,
      "env:b",
      true,
      "2026-11-18T11:00:00Z",
    );
    expect(pinnedChats(pinned, precon)).toEqual(["env:b", "env:a"]);
    const unpinnedElsewhere = withPin(pinned, precon, "env:a", false, "2026-11-18T12:00:00Z");
    const merged = parseDeskNotes(JSON.stringify(mergeDeskNotes(pinned, unpinnedElsewhere)));
    expect(pinnedChats(merged, precon)).toEqual(["env:b"]);
    const withPlanner = withPin(merged, precon, "env:c", true, "2026-11-18T13:00:00Z");
    const roles = withPin(withPlanner, precon, "env:b", true, "2026-11-18T09:00:00Z", "planner");
    expect(pinnedChats(parseDeskNotes(JSON.stringify(roles)), precon)).toEqual(["env:b", "env:c"]);
    const sprintPrecon = { kind: "sprint", sprint: "Sprint 1", app: "Precon" } as const;
    const sprint = withPin(roles, sprintPrecon, "env:d", true, "2026-11-18T13:00:00Z");
    expect(pinnedChats(sprint, sprintPrecon)).toEqual(["env:d"]);
    expect(pinnedChats(sprint, { kind: "sprint", sprint: "Sprint 1" })).toEqual([]);
    expect(pinnedChats(merged, { kind: "today" })).toEqual([]);
    expect(
      parseDeskNotes(
        JSON.stringify({
          pins: { "item:javascript:x": { "env:c": { pinned: true, updatedAt: "x" } } },
        }),
      ).pins,
    ).toEqual({});
  });

  it("reads a stored document, dropping malformed notes", () => {
    const notes = parseDeskNotes(
      JSON.stringify({
        apps: { Precon: { text: "ok", updatedAt: "2026-11-17T10:00:00Z" }, Bad: { text: 1 } },
        sprintGoals: { "Sprint 1": { Precon: { text: "g", updatedAt: "x", by: "agent" } } },
        sheets: {
          "https://github.com/o/r/issues/1": { id: "5c33d70fbd29", updatedAt: "x" },
          "https://github.com/o/r/issues/2": { id: "../../etc", updatedAt: "x" },
          "https://evil.example/1": { id: "5c33d70fbd29", updatedAt: "x" },
        },
        links: {
          "env:a": { kind: "today", day: "2026-11-19", about: "Today", updatedAt: "x" },
          "env:b": { kind: "today", day: "Nov 19", titled: "yes", about: "Today", updatedAt: "x" },
        },
      }),
    );
    expect(notes.links["env:a"]).toMatchObject({ kind: "today", day: "2026-11-19" });
    expect(notes.links["env:b"]?.day).toBeUndefined();
    expect(notes.links["env:b"]?.titled).toBeUndefined();
    expect(Object.keys(notes.apps)).toEqual(["Precon"]);
    expect(Object.keys(notes.sheets)).toEqual(["https://github.com/o/r/issues/1"]);
    expect(notes.sprintGoals["Sprint 1"]?.Precon?.by).toBe("agent");
    expect(parseDeskNotes("not json")).toEqual(EMPTY_DESK_NOTES);
  });

  it("finds a day's Today chat, the newest when started twice, and titles it once", () => {
    const link = (day: string, updatedAt: string, titled?: boolean) => ({
      kind: "today" as const,
      view: null,
      feature: null,
      app: null,
      sprint: null,
      itemUrl: null,
      about: "Today",
      day,
      updatedAt,
      ...(titled ? { titled } : {}),
    });
    const notes = {
      ...EMPTY_DESK_NOTES,
      links: {
        "env:old": link("2026-11-18", "2026-11-18T13:00:00Z", true),
        "env:first": link("2026-11-19", "2026-11-19T12:00:00Z"),
        "env:second": link("2026-11-19", "2026-11-19T13:00:00Z"),
      },
    };
    expect(todayChatFor(notes, "2026-11-19")).toBe("env:second");
    expect(todayChatFor(notes, "2026-11-20")).toBeNull();
    expect(untitledTodayChats(notes)).toEqual([
      { key: "env:first", title: "Today · Thu, Nov 19" },
      { key: "env:second", title: "Today · Thu, Nov 19" },
    ]);
  });

  it("keeps one chat on an item and one item per chat, with a dated record of each move", () => {
    const a = "https://github.com/o/r/issues/1";
    const b = "https://github.com/o/r/issues/2";
    let notes = withFocus(EMPTY_DESK_NOTES, a, "chat-one-1", "2026-11-19T10:00:00Z");
    notes = withFocus(notes, a, "chat-two-22", "2026-11-19T11:00:00Z");
    expect(focusedChat(notes, a)).toBe("chat-two-22");
    expect(chatFocus(notes, "chat-one-1")).toBeNull();
    expect(notes.work["chat-one-1"]?.items).toEqual([
      { url: a, from: "2026-11-19T10:00:00Z", until: "2026-11-19T11:00:00Z" },
    ]);

    notes = withFocus(notes, b, "chat-two-22", "2026-11-19T12:00:00Z");
    expect(focusedChat(notes, a)).toBeNull();
    expect(chatFocus(notes, "chat-two-22")).toBe(b);
    expect(notes.work["chat-two-22"]?.items.map((span) => span.until)).toEqual([
      "2026-11-19T12:00:00Z",
      null,
    ]);

    notes = withFocus(notes, b, null, "2026-11-19T13:00:00Z");
    expect(focusedChat(notes, b)).toBeNull();
    expect(parseDeskNotes(JSON.stringify(notes)).work).toEqual(notes.work);
  });
});
