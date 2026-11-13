import { describe, expect, it } from "vite-plus/test";

import {
  formatPageFeedbackMessage,
  readPageFeedback,
  upsertPageContextLine,
} from "./pageFeedback.logic";

describe("readPageFeedback", () => {
  it("reads the three actions and ignores other messages", () => {
    expect(readPageFeedback({ type: "t3-page:send", text: "ok", id: "1" })).toEqual({
      action: "send",
      text: "ok",
      data: undefined,
      id: "1",
    });
    expect(readPageFeedback({ type: "t3-page:draft", data: { a: 1 } })?.action).toBe("draft");
    expect(readPageFeedback({ type: "t3-page:context", text: "" })?.action).toBe("context");
    expect(readPageFeedback({ type: "t3-page:send", text: "  " })).toBeUndefined();
    expect(readPageFeedback({ type: "other" })).toBeUndefined();
    expect(readPageFeedback("t3-page:send")).toBeUndefined();
  });
});

describe("formatPageFeedbackMessage", () => {
  it("labels the page and appends data as JSON", () => {
    const feedback = readPageFeedback({
      type: "t3-page:send",
      text: "Approved",
      data: { approve: [12] },
    })!;
    expect(formatPageFeedbackMessage("Priorities\nboard", feedback)).toBe(
      '[From page: Priorities board]\n\nApproved\n\n```json\n{\n  "approve": [\n    12\n  ]\n}\n```',
    );
  });
});

describe("upsertPageContextLine", () => {
  it("adds, replaces and removes the page's line, keeping the user's text", () => {
    const first = upsertPageContextLine("Ship it", "Board", "filter: open");
    expect(first).toBe("Ship it\n[Page: Board] filter: open");
    const second = upsertPageContextLine(first, "Board", "filter: all");
    expect(second).toBe("Ship it\n[Page: Board] filter: all");
    expect(upsertPageContextLine(second, "Other (v2)", "x")).toBe(
      "Ship it\n[Page: Board] filter: all\n[Page: Other (v2)] x",
    );
    expect(upsertPageContextLine(second, "Board", "")).toBe("Ship it");
    expect(upsertPageContextLine("", "Board", "a")).toBe("[Page: Board] a");
  });
});
