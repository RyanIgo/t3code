// The Do form (Board contract, 2026-11-28): the fields a to-do for Rigo must carry.

export const ONLY_YOU = ["sign-in", "phone", "person", "judgement"];

/**
 * The Do form's three gates, as far as a form can check them: self-contained (why, what it
 * unblocks, steps that each say where and when it's done), truly his (why only he can), current
 * (on an item). Returns what's missing, in words an agent can act on.
 */
export function doFormProblems(line) {
  const problems = [];
  if (!line.why) problems.push('add "why" (one sentence: why it matters now)');
  if (!line.unblocks) problems.push('add "unblocks" (what finishing it lets happen)');
  if (!ONLY_YOU.includes(line.onlyYou))
    problems.push(
      `add "onlyYou": one of ${ONLY_YOU.join(", ")} (no agent can do it). If an agent could, it isn't his to-do.`,
    );
  if (!line.itemUrl)
    problems.push('add "item" (the repo#n it belongs to, so it drops off when that ships)');
  if (!line.minutes) problems.push('add "minutes" (about how long it takes him)');
  if (/\b(test sheet|re-?test)\b/i.test(line.text))
    problems.push(
      'a test is not a to-do: publish a hub test sheet and hand it over with next "Rigo: test …"',
    );
  const steps = line.steps ?? [];
  if (steps.length === 0)
    problems.push('add "steps": [{ "text", "goTo": "<https link>", "doneWhen" }], one per action');
  const texts = new Set();
  steps.forEach((step, index) => {
    const n = index + 1;
    if (!step.text) problems.push(`step ${n} needs "text"`);
    if (texts.has(step.text)) problems.push(`step ${n} repeats an earlier step`);
    texts.add(step.text);
    if (!step.doneWhen) problems.push(`step ${n} needs "doneWhen" (what he sees when it worked)`);
    if (step.goTo && /github\.com\/[^/]+\/[^/]+\/issues\//.test(step.goTo))
      problems.push(
        `step ${n} links a GitHub issue: issues are for agents; link the page he acts on`,
      );
    if (step.goTo && /claude\.ai\//.test(step.goTo))
      problems.push(`step ${n} links a claude.ai page: publish it on the hub (t3-artifacts)`);
  });
  if (steps.length > 0 && !steps.some((step) => step.goTo))
    problems.push('at least one step needs "goTo": the page he acts on');
  return problems;
}
