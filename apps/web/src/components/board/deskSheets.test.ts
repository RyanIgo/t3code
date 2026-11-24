import { describe, expect, it } from "vite-plus/test";

import { type SheetSummary, sheetsTestingPr, sheetTurn, uncheckedRows } from "./deskSheets";

const sheet = (
  title: string,
  counts: Partial<SheetSummary["counts"]>,
  extra: Partial<SheetSummary> = {},
): SheetSummary => ({
  id: title,
  title,
  updatedAt: "2026-11-24T03:00:00.000Z",
  thread: null,
  counts: { total: 4, pass: 0, fail: 0, skip: 0, blocked: 0, ...counts },
  ...extra,
});

describe("sheetTurn", () => {
  it("counts a note without pass or fail as answered", () => {
    expect(uncheckedRows(sheet("a", { pass: 3, noted: 1 }).counts)).toBe(0);
  });
  it("is the chat's turn once submitted with notes, until it republishes", () => {
    const sent = sheet("a", { pass: 3, noted: 1 }, { submittedAt: "2026-11-24T11:00:00.000Z" });
    expect(sheetTurn(sent)).toBe("agent");
    expect(sheetTurn({ ...sent, updatedAt: "2026-11-24T12:00:00.000Z" })).toBe("issues");
  });
  it("is the chat's turn after a submit even with checks left", () => {
    expect(sheetTurn(sheet("a", { pass: 1 }, { submittedAt: "2026-11-24T11:00:00.000Z" }))).toBe(
      "agent",
    );
  });
  it("asks for Submit when every check is answered with notes", () => {
    expect(sheetTurn(sheet("a", { pass: 2, fail: 1, noted: 1 }))).toBe("issues");
  });
  it("is clean when all passed or skipped, and Rigo's with re-tests", () => {
    expect(sheetTurn(sheet("a", { pass: 3, skip: 1 }))).toBe("clean");
    expect(sheetTurn(sheet("a", { pass: 3, retest: 1 }))).toBe("rigo");
  });
});

describe("sheetsTestingPr", () => {
  const sheets = [
    sheet("Test sheet — PR cfe-bizdev #151 Step 3", {}),
    sheet("Review — PR cfe-drawings #151 Other repo", {}),
    sheet("#151 no repo named", {}),
  ];
  const pr = { repo: "cfevans/cfe-bizdev", number: 151, app: "BizDev Leads" };
  it("matches the repo and number, or the number alone within the app", () => {
    const titles = sheetsTestingPr(sheets, pr, () => "BizDev Leads").map((entry) => entry.title);
    expect(titles).toEqual(["Test sheet — PR cfe-bizdev #151 Step 3", "#151 no repo named"]);
  });
  it("ignores a bare number from another app", () => {
    expect(sheetsTestingPr(sheets, pr, () => "Precon")).toHaveLength(1);
  });
});
