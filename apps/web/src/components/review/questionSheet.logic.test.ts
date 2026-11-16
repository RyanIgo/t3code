import { describe, expect, it } from "vite-plus/test";

import {
  extractQuestionSheets,
  formatSheetAnswers,
  parseQuestionSheet,
} from "./questionSheet.logic";

const SHEET = `Some intro.
## 1. Ship on Friday?
It touches billing.
- ( ) Yes
- ( ) No, next week
## Which checks matter?
- [ ] Lint
- [ ] Types
## Anything else?`;

describe("parseQuestionSheet", () => {
  it("reads questions, pick-one and pick-any options, and context", () => {
    const sheet = parseQuestionSheet(SHEET, "Release plan");
    expect(sheet?.title).toBe("Release plan");
    expect(sheet?.intro).toBe("Some intro.");
    expect(sheet?.questions.map((q) => [q.id, q.title, q.pick, q.options, q.body])).toEqual([
      ["1", "Ship on Friday?", "one", ["Yes", "No, next week"], "It touches billing."],
      ["2", "Which checks matter?", "any", ["Lint", "Types"], ""],
      ["3", "Anything else?", "one", [], ""],
    ]);
  });

  it("takes the title from a top heading and gives up without questions", () => {
    expect(parseQuestionSheet("# Plan\n## Go?")?.title).toBe("Plan");
    expect(parseQuestionSheet("just text")).toBeNull();
  });
});

describe("extractQuestionSheets", () => {
  it("finds closed questions fences only", () => {
    const text = `Hi\n\n\`\`\`questions Plan\n## Go?\n\`\`\`\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n\n\`\`\`questions\n## Open?`;
    expect(extractQuestionSheets(text).map((sheet) => sheet.title)).toEqual(["Plan"]);
  });
});

describe("formatSheetAnswers", () => {
  it("lists picks, notes and skipped questions", () => {
    const sheet = parseQuestionSheet(SHEET, "Release plan")!;
    const message = formatSheetAnswers(sheet, {
      "1": { picked: ["No, next week"], text: "Billing freeze" },
      "2": { picked: [], text: "" },
      "3": { picked: [], text: "Ping finance\nand ops" },
    });
    expect(message).toBe(
      [
        'Answers to "Release plan" (2 of 3 answered):',
        "",
        "1. Ship on Friday?",
        "   Picked: No, next week",
        "   Note: Billing freeze",
        "2. Which checks matter?",
        "   Skipped",
        "3. Anything else?",
        "   Answer: Ping finance",
        "   and ops",
      ].join("\n"),
    );
  });
});
