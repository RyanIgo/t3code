// The check-card form a test sheet must be on (Board contract, 2026-11-28).

const CHECK_TYPES = ["verify", "workflow", "data", "reconcile"];

/**
 * A test sheet Rigo runs (Board contract, 2026-11-28): Dev or Live with why, and every check a
 * card: its type, where to go, short steps, what passing looks like. No narrative checks.
 */
export function sheetProblems(spec) {
  const problems = [];
  if (spec.where?.env !== "dev" && spec.where?.env !== "live")
    problems.push('add "where": { "env": "dev" | "live", "why": "<one line>" }');
  else if (!spec.where.why) problems.push('add "where.why" (why Dev or why Live)');
  spec.rows.forEach((row, index) => {
    const n = `check ${index + 1}${row?.title ? ` ("${String(row.title).slice(0, 40)}")` : ""}`;
    if (!CHECK_TYPES.includes(row?.type))
      problems.push(`${n} needs "type": ${CHECK_TYPES.join(", ")}`);
    if (typeof row?.goTo !== "string" || !/^https:\/\//.test(row.goTo))
      problems.push(`${n} needs "goTo": the https page it starts on`);
    if (!Array.isArray(row?.steps) || row.steps.length === 0)
      problems.push(`${n} needs "steps": short actions, one per line`);
    if (typeof row?.pass !== "string" || !row.pass.trim())
      problems.push(`${n} needs "pass": what he sees when it passes`);
  });
  return problems;
}
