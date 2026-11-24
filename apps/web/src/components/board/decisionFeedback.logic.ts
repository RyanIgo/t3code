/**
 * Fleet fork: comments on a planner's decision card, part by part (each proposed story, the quick
 * fixes, the planner's own notes), sent together so the planner can revise the card.
 */

export interface ContextSection {
  /** The section's first line, plain, for the comment's label. */
  readonly title: string;
  /** The section as written (markdown). */
  readonly body: string;
}

/** A line that opens a part of a proposal: "Story 2 —", "**Story 1:**", "QUICK FIXES", "Planner:". */
const HEADING =
  /^\s*(?:#+\s*)?(?:\*\*)?\s*(story\s*\d+|quick\s*fix(?:es)?|planner|where things stand|what this is|note|lead|your part)\b/i;

const plain = (line: string) =>
  line
    .replace(/^\s*#+\s*/, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Splits a card's background into its parts. A proposal's headed parts ("Story 1", "Quick
 * fixes") each take the paragraphs and bullets under them; without headings, each paragraph is
 * its own part.
 */
export function contextSections(context: string): ContextSection[] {
  const blocks = context
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const headed = blocks.some((block) => HEADING.test(block.split("\n")[0] ?? ""));
  const sections: Array<{ title: string; lines: string[] }> = [];
  for (const block of blocks) {
    const first = block.split("\n")[0] ?? "";
    if (!headed || HEADING.test(first) || sections.length === 0) {
      sections.push({ title: plain(first), lines: [block] });
    } else {
      sections.at(-1)?.lines.push(block);
    }
  }
  return sections.map((section) => ({
    title: section.title.length > 90 ? `${section.title.slice(0, 87)}…` : section.title,
    body: section.lines.join("\n\n"),
  }));
}

/** The comments, one line per part plus the overall note, as Rigo's message to the planner. */
export function commentsText(
  sections: ReadonlyArray<ContextSection>,
  comments: Readonly<Record<number, string>>,
  overall: string,
): string {
  const lines = sections.flatMap((section, index) => {
    const text = comments[index]?.trim();
    return text ? [`- On "${section.title}": ${text}`] : [];
  });
  if (overall.trim()) lines.push(`- Overall: ${overall.trim()}`);
  return lines.join("\n");
}
