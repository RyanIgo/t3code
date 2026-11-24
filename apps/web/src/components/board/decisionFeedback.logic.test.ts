import { describe, expect, it } from "vite-plus/test";

import { commentsText, contextSections } from "./decisionFeedback.logic";

const PROPOSAL = `Where things stand: BizDev has two planner chats.

STORY 1 — "Marketing builds a county's lead pipeline in four steps."
- Built and in test: #131, #133, #134.

- Still to build: #157, #158.

**Story 2:** "Each of the five businesses decides on leads for itself." (#95)
- Left: #108.

QUICK FIXES (each its own small lead chat)
- #61 security alerts`;

describe("contextSections", () => {
  it("gives each proposed story its paragraphs and bullets", () => {
    const sections = contextSections(PROPOSAL);
    expect(sections.map((section) => section.title)).toEqual([
      "Where things stand: BizDev has two planner chats.",
      'STORY 1 — "Marketing builds a county\'s lead pipeline in four steps."',
      'Story 2: "Each of the five businesses decides on leads for itself." (#95)',
      "QUICK FIXES (each its own small lead chat)",
    ]);
    expect(sections[1]?.body).toContain("Still to build");
  });
  it("makes each paragraph a part when nothing is headed", () => {
    expect(contextSections("First thing.\n\nSecond thing.")).toHaveLength(2);
  });
});

describe("commentsText", () => {
  it("lists only the parts commented on, then the overall note", () => {
    const sections = contextSections(PROPOSAL);
    expect(commentsText(sections, { 2: "Keep #108 out until Dec" }, "Good direction")).toBe(
      '- On "Story 2: "Each of the five businesses decides on leads for itself." (#95)": Keep #108 out until Dec\n- Overall: Good direction',
    );
    expect(commentsText(sections, {}, "  ")).toBe("");
  });
});
