import { expect, it } from "vite-plus/test";

import { sheetProblems } from "./sheetForm.mjs";

const card = {
  id: "c1",
  title: "Inbox lists Farmington Round 2",
  type: "verify",
  goTo: "https://admins-mac-mini.tail0392d7.ts.net:5173/bids/intake",
  steps: ["Pick Farmington Round 2"],
  pass: "9 bids show, 2 marked Missing",
};

it("passes a sheet on the check-card form and names what's missing otherwise", () => {
  expect(sheetProblems({ where: { env: "dev", why: "test build" }, rows: [card] })).toEqual([]);
  const problems = sheetProblems({ rows: [{ id: "c1", title: "Look around" }] }).join(" ");
  expect(problems).toMatch(/"where"/);
  expect(problems).toMatch(/"type"/);
  expect(problems).toMatch(/"goTo"/);
  expect(problems).toMatch(/"steps"/);
  expect(problems).toMatch(/"pass"/);
});
