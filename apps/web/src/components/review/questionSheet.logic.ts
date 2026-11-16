/**
 * Fleet fork: question sheets, a ```questions fence whose `## headings` are questions, with
 * `( )` pick-one or `[ ]` pick-any options. Format: fleet/skills/t3-questions/SKILL.md.
 */
export const QUESTIONS_FENCE_LANGUAGE = "questions";

export interface SheetQuestion {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly options: ReadonlyArray<string>;
  readonly pick: "one" | "any";
}

export interface QuestionSheet {
  readonly key: string;
  readonly title: string;
  readonly intro: string;
  readonly questions: ReadonlyArray<SheetQuestion>;
}

export interface SheetAnswer {
  readonly picked: ReadonlyArray<string>;
  readonly text: string;
}

export type SheetAnswers = Readonly<Record<string, SheetAnswer>>;

const OPTION_LINE = /^\s*[-*]\s+(\(\s?\)|\[\s?\])\s+(.+?)\s*$/;
const QUESTION_HEADING = /^##\s+(.+?)\s*$/;

/** A short stable key, so answers in progress survive reloads and re-renders. */
function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function parseQuestionSheet(code: string, fenceTitle?: string | null): QuestionSheet | null {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  let title = fenceTitle?.trim() ?? "";
  const intro: string[] = [];
  const questions: { title: string; body: string[]; options: string[]; pick: "one" | "any" }[] = [];
  for (const line of lines) {
    const heading = QUESTION_HEADING.exec(line);
    if (heading?.[1]) {
      questions.push({
        title: heading[1].replace(/^\d+[.)]\s*/, ""),
        body: [],
        options: [],
        pick: "one",
      });
      continue;
    }
    const current = questions.at(-1);
    if (current === undefined) {
      const top = /^#\s+(.+?)\s*$/.exec(line);
      if (top?.[1] && title === "") title = top[1];
      else intro.push(line);
      continue;
    }
    const option = OPTION_LINE.exec(line);
    if (option?.[1] && option[2]) {
      if (option[1].startsWith("[")) current.pick = "any";
      current.options.push(option[2]);
      continue;
    }
    current.body.push(line);
  }
  if (questions.length === 0) return null;
  return {
    key: hashText(code),
    title: title || "Questions",
    intro: intro.join("\n").trim(),
    questions: questions.map((question, index) => ({
      id: String(index + 1),
      title: question.title,
      body: question.body.join("\n").trim(),
      options: question.options,
      pick: question.pick,
    })),
  };
}

const FENCE = /^(`{3,}|~{3,})questions(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n\1[ \t]*$/gm;

/** Every closed question sheet in one message, in order. */
export function extractQuestionSheets(markdown: string): QuestionSheet[] {
  const sheets: QuestionSheet[] = [];
  for (const match of markdown.matchAll(FENCE)) {
    const sheet = parseQuestionSheet(match[3] ?? "", match[2] ?? null);
    if (sheet) sheets.push(sheet);
  }
  return sheets;
}

function isAnswered(answer: SheetAnswer | undefined): boolean {
  return answer !== undefined && (answer.picked.length > 0 || answer.text.trim() !== "");
}

export function countAnswered(sheet: QuestionSheet, answers: SheetAnswers): number {
  return sheet.questions.filter((question) => isAnswered(answers[question.id])).length;
}

/** The chat message that carries the answers back to the agent. */
export function formatSheetAnswers(sheet: QuestionSheet, answers: SheetAnswers): string {
  const answered = countAnswered(sheet, answers);
  const lines = [
    `Answers to "${sheet.title}" (${answered} of ${sheet.questions.length} answered):`,
    "",
  ];
  for (const question of sheet.questions) {
    const answer = answers[question.id];
    lines.push(`${question.id}. ${question.title}`);
    if (!isAnswered(answer)) {
      lines.push("   Skipped");
      continue;
    }
    if (answer && answer.picked.length > 0) lines.push(`   Picked: ${answer.picked.join("; ")}`);
    const text = answer?.text.trim() ?? "";
    if (text !== "") {
      const [first = "", ...rest] = text.split("\n");
      lines.push(`   ${answer && answer.picked.length > 0 ? "Note" : "Answer"}: ${first}`);
      for (const line of rest) lines.push(`   ${line}`);
    }
  }
  return lines.join("\n");
}
