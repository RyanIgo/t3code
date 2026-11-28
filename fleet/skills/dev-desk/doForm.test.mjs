import { describe, expect, it } from "vite-plus/test";

import { doFormProblems } from "./doForm.mjs";

const good = {
  text: "Add the bid-intake routine to Precon's Claude library",
  why: "The Set up bid intake panel reads it.",
  unblocks: "#312 closing",
  onlyYou: "sign-in",
  itemUrl: "https://github.com/cfevans/cfe-drawings/issues/312",
  minutes: 5,
  steps: [
    {
      text: "Open Claude, Other documents, Add",
      goTo: "https://precon.cfevans.com/#/claude",
      doneWhen: "the add form is open",
    },
    { text: "Paste and save", goTo: null, doneWhen: "it shows as version 1" },
  ],
};

describe("doFormProblems", () => {
  it("passes a complete to-do", () => {
    expect(doFormProblems(good)).toEqual([]);
  });
  it("names each missing field", () => {
    const problems = doFormProblems({ text: "Do the thing", steps: [] });
    expect(problems.join(" ")).toMatch(/why/);
    expect(problems.join(" ")).toMatch(/unblocks/);
    expect(problems.join(" ")).toMatch(/onlyYou/);
    expect(problems.join(" ")).toMatch(/item/);
    expect(problems.join(" ")).toMatch(/minutes/);
    expect(problems.join(" ")).toMatch(/steps/);
  });
  it("refuses tests, issue links, claude.ai pages, steps with no done-when or no link at all", () => {
    expect(doFormProblems({ ...good, text: "Run the PR #253 test sheet" }).join(" ")).toMatch(
      /hub test sheet/,
    );
    const steps = [
      { text: "a", goTo: "https://github.com/cfevans/x/issues/9", doneWhen: "x" },
      { text: "b", goTo: "https://claude.ai/artifact/abc", doneWhen: null },
    ];
    const problems = doFormProblems({ ...good, steps }).join(" ");
    expect(problems).toMatch(/step 1 links a GitHub issue/);
    expect(problems).toMatch(/step 2 links a claude\.ai page/);
    expect(problems).toMatch(/step 2 needs "doneWhen"/);
    expect(
      doFormProblems({ ...good, steps: [{ text: "a", goTo: null, doneWhen: "x" }] }).join(" "),
    ).toMatch(/at least one step needs "goTo"/);
  });
});
