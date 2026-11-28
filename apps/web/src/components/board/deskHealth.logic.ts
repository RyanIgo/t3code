/** Fleet fork: the Health tab's measures (Board contract, 2026-11-28). Pure logic only. */

export const MEASURES = [
  { kind: "later", label: "Pushed to later", note: "rows on Now you didn't want yet" },
  { kind: "sentBack", label: "To-dos sent back", note: "Not mine, or a question on a to-do" },
  { kind: "bounced", label: "Handoffs bounced", note: "the desk tool refused an agent's work" },
] as const;

/** Totals for the last 7 days and today, from the hub's per-day counts. */
export function measureTotals(
  days: Readonly<Record<string, Readonly<Record<string, number>>>>,
  nowMs: number,
): Record<string, { readonly today: number; readonly week: number }> {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const weekStart = new Date(nowMs - 6 * 86_400_000).toISOString().slice(0, 10);
  return Object.fromEntries(
    MEASURES.map(({ kind }) => {
      let week = 0;
      for (const [day, counts] of Object.entries(days)) {
        if (day >= weekStart && day <= today) week += counts[kind] ?? 0;
      }
      return [kind, { today: days[today]?.[kind] ?? 0, week }];
    }),
  );
}
