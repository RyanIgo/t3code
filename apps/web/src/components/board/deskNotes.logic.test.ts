import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_DESK_NOTES,
  mergeDeskNotes,
  noteAt,
  parseDeskNotes,
  withNote,
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

  it("reads a stored document, dropping malformed notes", () => {
    const notes = parseDeskNotes(
      JSON.stringify({
        apps: { Precon: { text: "ok", updatedAt: "2026-11-17T10:00:00Z" }, Bad: { text: 1 } },
        sprintGoals: { "Sprint 1": { Precon: { text: "g", updatedAt: "x", by: "agent" } } },
      }),
    );
    expect(Object.keys(notes.apps)).toEqual(["Precon"]);
    expect(notes.sprintGoals["Sprint 1"]?.Precon?.by).toBe("agent");
    expect(parseDeskNotes("not json")).toEqual(EMPTY_DESK_NOTES);
  });
});
