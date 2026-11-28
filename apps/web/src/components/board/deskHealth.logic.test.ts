import { expect, it } from "vite-plus/test";

import { measureTotals } from "./deskHealth.logic";

it("adds up the last 7 days and today, ignoring older days", () => {
  const now = Date.parse("2026-11-28T15:00:00Z");
  const totals = measureTotals(
    {
      "2026-11-20": { later: 9 },
      "2026-11-22": { later: 1, bounced: 2 },
      "2026-11-28": { later: 3, sentBack: 1 },
    },
    now,
  );
  expect(totals.later).toEqual({ today: 3, week: 4 });
  expect(totals.sentBack).toEqual({ today: 1, week: 1 });
  expect(totals.bounced).toEqual({ today: 0, week: 2 });
});
