import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_DESK_NOTES,
  mergeDeskNotes,
  noteAt,
  parseDeskNotes,
  pinnedChats,
  chatFocus,
  openDecisions,
  withDecisionAnswer,
  chatRoleOf,
  withRole,
  focusedChat,
  untitledTodayChats,
  plannerTodos,
  goalOf,
  waitingReports,
  withReportsSent,
  withPlanLineDone,
  withPlanLineHelper,
  withPlanLineQuestion,
  withFocus,
  withNote,
  withPin,
  pushedUntil,
  withPushBack,
  starOn,
  withStar,
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
        inbox: {
          note1: {
            text: "Maddy: leads missing addresses",
            source: "In person",
            createdAt: "x",
            updatedAt: "x",
            state: "proposed",
            proposal: { action: "comment", itemUrl: "https://evil.example/1", reason: "r" },
          },
          bad: { text: "", createdAt: "x", updatedAt: "x" },
        },
        links: {
          "env:a": { kind: "today", day: "2026-11-19", about: "Today", updatedAt: "x" },
          "env:b": { kind: "today", day: "Nov 19", titled: "yes", about: "Today", updatedAt: "x" },
        },
      }),
    );
    expect(notes.links["env:a"]).toMatchObject({ kind: "today", day: "2026-11-19" });
    expect(Object.keys(notes.inbox)).toEqual(["note1"]);
    expect(notes.inbox.note1?.proposal).toMatchObject({ action: "comment", itemUrl: null });
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
    expect(untitledTodayChats(notes)).toEqual([
      { key: "env:first", title: "Today · Thu, Nov 19" },
      { key: "env:second", title: "Today · Thu, Nov 19" },
    ]);
  });

  it("lists planners' open lines on Rigo and ticks one done", () => {
    const at = "2026-11-20T10:00:00Z";
    const notes = {
      ...EMPTY_DESK_NOTES,
      work: {
        "planner-one": {
          items: [],
          next: null,
          role: "planner" as const,
          app: "Precon",
          plan: [
            { text: "Test the sheet", who: "you", done: false, itemUrl: null },
            { text: "Build it", who: "agents", done: false, itemUrl: null },
            { text: "Old", who: "you", done: true, itemUrl: null },
          ],
          updatedAt: at,
        },
        "work-chat-1": {
          items: [],
          next: null,
          role: "work" as const,
          plan: [{ text: "Not a planner", who: "you", done: false, itemUrl: null }],
          updatedAt: at,
        },
      },
    };
    expect(plannerTodos(notes).map((todo) => todo.line.text)).toEqual(["Test the sheet"]);
    expect(plannerTodos(notes, "Materials")).toEqual([]);
    const ticked = withPlanLineDone(notes, "planner-one", "Test the sheet", at);
    expect(plannerTodos(ticked)).toEqual([]);
    expect(withPlanLineDone(notes, "planner-one", "Missing", at)).toBe(notes);
    const asked = withPlanLineQuestion(
      notes,
      "planner-one",
      "Test the sheet",
      "  Which sheet?  ",
      at,
    );
    expect(asked.work["planner-one"]?.plan?.[0]?.qa).toEqual([
      { q: "Which sheet?", at, a: null, answeredAt: null },
    ]);
    // Read back from the saved document, the thread survives.
    const reread = parseDeskNotes(JSON.stringify(asked));
    expect(reread.work["planner-one"]?.plan?.[0]?.qa?.[0]?.q).toBe("Which sheet?");
    const helped = withPlanLineHelper(asked, "planner-one", "Test the sheet", "side-1", at);
    expect(parseDeskNotes(JSON.stringify(helped)).work["planner-one"]?.plan?.[0]?.helper).toBe(
      "side-1",
    );
  });

  it("routes chats' turn reports to their planner until they're sent", () => {
    const at = "2026-11-20T10:00:00Z";
    const report = { at, text: "PR opened", sentAt: null };
    const notes = {
      ...EMPTY_DESK_NOTES,
      work: {
        "planner-one": {
          items: [],
          next: null,
          role: "planner" as const,
          app: "Precon",
          updatedAt: at,
        },
        "work-chat-1": {
          items: [{ url: "https://github.com/o/r/issues/1", from: at, until: null }],
          next: null,
          role: "work" as const,
          report,
          updatedAt: at,
        },
        "helper-chat": {
          items: [],
          next: null,
          role: "helper" as const,
          parent: "work-chat-1",
          report,
          updatedAt: at,
        },
        "work-other-app": {
          items: [],
          next: null,
          role: "work" as const,
          app: "Materials",
          report,
          updatedAt: at,
        },
      },
    };
    const appOfUrl = (url: string) => (url.endsWith("/1") ? "Precon" : null);
    const waiting = waitingReports(notes, appOfUrl);
    expect(waiting.get("planner-one")?.map((entry) => entry.threadId)).toEqual([
      "work-chat-1",
      "helper-chat",
    ]);
    expect(waiting.size).toBe(1);
    const sent = withReportsSent(notes, "planner-one", ["work-chat-1", "helper-chat"], at);
    expect(waitingReports(sent, appOfUrl).size).toBe(0);
    expect(sent.work["planner-one"]?.updatesSentAt).toBe(at);
  });

  it("keeps the why, steps and links on a planner's line for Rigo", () => {
    const notes = parseDeskNotes(
      JSON.stringify({
        schemaVersion: 1,
        work: {
          "planner-one": {
            items: [],
            next: null,
            role: "planner",
            updatedAt: "2026-11-20T10:00:00Z",
            plan: [
              {
                text: "Remove the marks",
                who: "you",
                why: "It unblocks the release.",
                how: "1. Open Admin.",
                links: ["https://example.com/admin", "not a url"],
              },
            ],
          },
        },
      }),
    );
    expect(notes.work["planner-one"]?.plan?.[0]).toMatchObject({
      why: "It unblocks the release.",
      how: "1. Open Admin.",
      links: ["https://example.com/admin"],
    });
  });

  it("keeps a triage proposal's feature, user story and criteria", () => {
    const at = "2026-11-20T10:00:00Z";
    const notes = parseDeskNotes(
      JSON.stringify({
        schemaVersion: 1,
        inbox: {
          note1: {
            id: "note1",
            text: "Estimators want bids sorted by trade",
            source: "In person",
            who: "Austin",
            app: "Precon",
            createdAt: at,
            updatedAt: at,
            state: "proposed",
            result: null,
            proposal: {
              action: "new",
              repo: "cfevans/cfe-drawings",
              app: "Precon",
              type: "Story",
              priority: "P2",
              title: "Bids sorted by trade",
              feature: "Bid intake",
              story: "As an estimator, I can sort bids by trade.",
              criteria: ["Bids group by trade", "", 4],
              reason: "Asked in person",
            },
          },
        },
      }),
    );
    expect(notes.inbox.note1?.proposal).toMatchObject({
      feature: "Bid intake",
      story: "As an estimator, I can sort bids by trade.",
      criteria: ["Bids group by trade"],
    });
  });

  it("takes the goal out of a planner's wrapped question", () => {
    expect(goalOf("Set Sprint 1's goal for the warehouse: 'Everyone sees who has what.'")).toBe(
      "Everyone sees who has what.",
    );
    expect(goalOf("Everyone sees who has what.")).toBe("Everyone sees who has what.");
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

  it("records a chat's level, infers one when none is recorded, and focus makes a work chat", () => {
    const chat = { environmentId: "env", threadId: "planner-chat-1" };
    let notes = withRole(EMPTY_DESK_NOTES, chat.threadId, "planner", "2026-11-20T10:00:00Z", {
      app: "Precon",
    });
    expect(chatRoleOf(notes, chat)).toBe("planner");
    expect(notes.work[chat.threadId]?.app).toBe("Precon");
    expect(parseDeskNotes(JSON.stringify(notes)).work[chat.threadId]?.role).toBe("planner");

    notes = withRole(notes, chat.threadId, null, "2026-11-20T10:05:00Z");
    expect(chatRoleOf(notes, chat)).toBeNull();

    const worker = { environmentId: "env", threadId: "work-chat-22" };
    notes = withFocus(
      notes,
      "https://github.com/o/r/issues/7",
      worker.threadId,
      "2026-11-20T11:00:00Z",
    );
    expect(chatRoleOf(notes, worker)).toBe("work");
    notes = withRole(notes, worker.threadId, "helper", "2026-11-20T11:05:00Z", {
      parent: chat.threadId,
    });
    notes = withFocus(
      notes,
      "https://github.com/o/r/issues/8",
      worker.threadId,
      "2026-11-20T11:10:00Z",
    );
    expect(chatRoleOf(notes, worker)).toBe("helper");
    expect(notes.work[worker.threadId]?.parent).toBe(chat.threadId);
  });
  it("keeps levels for chats another chat started, whose ids contain ':' and '%'", () => {
    const launched = "mcp:launch:c9ba14397afaa6ec6462ca1f15bc044897650cb7f649e56d5e48d4fb844391ab";
    const delegated =
      "thread:delegated-task:command%3Amcp%3A5fefea5a-81d8-4222-89cc-063ea08f6eac%3Adelegate-task%3A9cc97245-c630-4988-91ae-e827a3d6e7c7";
    let notes = withRole(EMPTY_DESK_NOTES, launched, "helper", "2026-11-20T12:00:00Z", {
      parent: delegated,
    });
    notes = withFocus(notes, "https://github.com/o/r/issues/9", delegated, "2026-11-20T12:05:00Z");
    const parsed = parseDeskNotes(JSON.stringify(notes));
    expect(parsed.work[launched]?.role).toBe("helper");
    expect(parsed.work[launched]?.parent).toBe(delegated);
    expect(chatRoleOf(parsed, { environmentId: "env", threadId: delegated })).toBe("work");
  });

  it("keeps planners' decisions until answered, the big picture per sprint, and a planner's checklist", () => {
    const notes = parseDeskNotes(
      JSON.stringify({
        decisions: {
          dec1: {
            threadId: "planner-thread-1",
            app: "Precon",
            question: "Settle the finished chats?",
            options: ["Yes", "No", 7],
            recommended: "Yes",
            createdAt: "2026-11-20T10:00:00Z",
            updatedAt: "2026-11-20T10:00:00Z",
          },
          bad: { question: "No thread", createdAt: "x", updatedAt: "x" },
        },
        framing: { "Sprint 1": { Precon: { text: "Leveling first.", updatedAt: "x" } } },
        work: {
          "planner-thread-1": {
            updatedAt: "x",
            items: [],
            plan: [{ text: "Sign off", who: "you" }, { text: "" }, { text: "Done", done: true }],
          },
        },
      }),
    );
    expect(Object.keys(notes.decisions)).toEqual(["dec1"]);
    expect(notes.decisions.dec1?.options).toEqual(["Yes", "No"]);
    expect(openDecisions(notes, "Precon").map((entry) => entry.id)).toEqual(["dec1"]);
    const answered = withDecisionAnswer(
      notes,
      "dec1",
      "Yes",
      " after Friday ",
      "2026-11-20T11:00:00Z",
    );
    expect(openDecisions(answered, "Precon")).toEqual([]);
    expect(answered.decisions.dec1?.answer).toEqual({
      choice: "Yes",
      note: "after Friday",
      at: "2026-11-20T11:00:00Z",
    });
    expect(notes.framing["Sprint 1"]?.Precon?.text).toBe("Leveling first.");
    expect(
      notes.work["planner-thread-1"]?.plan?.map((line) => [line.text, line.who, line.done]),
    ).toEqual([
      ["Sign off", "you", false],
      ["Done", "agents", true],
    ]);
  });
});

describe("push back", () => {
  it("keeps a row pushed until its date, survives a round trip, and brings it back", () => {
    const at = "2026-11-24T15:00:00.000Z";
    const pushed = withPushBack(EMPTY_DESK_NOTES, "pr:x", "2026-11-30T13:00:00.000Z", "PR", at);
    const read = parseDeskNotes(JSON.stringify(pushed));
    expect(pushedUntil(read, "pr:x", Date.parse(at))).toBe("2026-11-30T13:00:00.000Z");
    expect(pushedUntil(read, "pr:x", Date.parse("2026-12-01T00:00:00Z"))).toBeNull();
    const back = withPushBack(read, "pr:x", null, "PR", "2026-11-25T09:00:00.000Z");
    expect(pushedUntil(back, "pr:x", Date.parse("2026-11-25T10:00:00Z"))).toBeNull();
  });
});

describe("stars", () => {
  it("finds a star on the item's area or its whole app, until it ends", () => {
    const at = "2026-11-24T15:00:00.000Z";
    const notes = withStar(
      EMPTY_DESK_NOTES,
      { app: "Precon", feature: "Precon · Leveling", reason: "Austin levels Thursday" },
      "2026-11-27T00:00:00.000Z",
      at,
    );
    const now = Date.parse(at);
    expect(starOn(notes, "Precon", "Precon · Leveling", now)?.reason).toBe(
      "Austin levels Thursday",
    );
    expect(starOn(notes, "Precon", "Precon · Bids", now)).toBeNull();
    expect(
      starOn(notes, "Precon", "Precon · Leveling", Date.parse("2026-11-28T00:00:00Z")),
    ).toBeNull();
    const whole = withStar(
      notes,
      { app: "Precon", feature: null, reason: "" },
      "2026-11-27T00:00:00.000Z",
      at,
    );
    expect(starOn(whole, "Precon", "Precon · Bids", now)?.feature).toBeNull();
    const off = withStar(whole, { app: "Precon", feature: null, reason: "" }, null, at);
    expect(starOn(parseDeskNotes(JSON.stringify(off)), "Precon", "Precon · Bids", now)).toBeNull();
  });
});
