/**
 * Fleet fork: feedback from visual-reply pages. A page posts
 * `{ type: "t3-page:send" | "t3-page:draft" | "t3-page:context", text, data? }` to its
 * parent, and the chat sends it, drafts it, or keeps it as a context line in the composer.
 */
export type PageFeedbackAction = "send" | "draft" | "context";

export interface PageFeedback {
  readonly action: PageFeedbackAction;
  readonly text: string;
  readonly data: unknown;
  readonly id: string | null;
}

const MAX_TEXT = 8_000;
const MAX_DATA = 16_000;

export function readPageFeedback(message: unknown): PageFeedback | undefined {
  if (typeof message !== "object" || message === null || !("type" in message)) return undefined;
  const action =
    message.type === "t3-page:send"
      ? "send"
      : message.type === "t3-page:draft"
        ? "draft"
        : message.type === "t3-page:context"
          ? "context"
          : null;
  if (action === null) return undefined;
  const text = "text" in message && typeof message.text === "string" ? message.text : "";
  const data = "data" in message ? message.data : undefined;
  const id = "id" in message && typeof message.id === "string" ? message.id : null;
  if (text.trim() === "" && data === undefined && action !== "context") return undefined;
  return { action, text: text.slice(0, MAX_TEXT), data, id };
}

function formatData(data: unknown): string | null {
  if (data === undefined) return null;
  let json: string;
  try {
    json = JSON.stringify(data, null, 2) ?? "null";
  } catch {
    return null;
  }
  if (json.length > MAX_DATA) json = `${json.slice(0, MAX_DATA)}\n… (truncated)`;
  return `\`\`\`json\n${json}\n\`\`\``;
}

/** The chat message for a page's send: who it is from, the text, then any data as JSON. */
export function formatPageFeedbackMessage(pageTitle: string, feedback: PageFeedback): string {
  const parts = [`[From page: ${oneLine(pageTitle)}]`];
  if (feedback.text.trim() !== "") parts.push(feedback.text.trim());
  const data = formatData(feedback.data);
  if (data !== null) parts.push(data);
  return parts.join("\n\n");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function oneLine(text: string): string {
  return collapse(text) || "Untitled page";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sets the page's context line in the composer text, replacing its previous line.
 * An empty note removes the line. Other text is left as the user wrote it.
 */
export function upsertPageContextLine(prompt: string, pageTitle: string, note: string): string {
  const label = `[Page: ${oneLine(pageTitle)}]`;
  const pattern = new RegExp(`^${escapeRegExp(label)}.*$\\n?`, "m");
  const without = prompt.replace(pattern, "").replace(/\n+$/, "");
  const line = collapse(note);
  if (line === "") return without;
  return without === "" ? `${label} ${line}` : `${without}\n${label} ${line}`;
}
