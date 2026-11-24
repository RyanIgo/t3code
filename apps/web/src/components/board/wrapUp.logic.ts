/**
 * Fleet fork: wrap-up after merge (agreed with Rigo, 2026-11-24). Once a story lead's item has
 * shipped, its "Rigo: …" line is stale and the lead wraps up without asking him.
 */
import { type DeskItem, deskRef } from "./desk.logic";
import { chatFocus, type DeskNotes } from "./deskNotes.logic";

/** Written as the chat's `next` when the Board asks it to wrap up, so it's asked once. */
export const WRAP_ASKED = "Wrap-up asked after merge";

/** Closed, or every PR settled with at least one merged. */
export function isShipped(item: DeskItem): boolean {
  if (item.state === "closed" || item.state === "merged") return true;
  const prs = item.pullRequests;
  return (
    prs.length > 0 &&
    prs.every((pr) => pr.state === "merged" || pr.state === "closed") &&
    prs.some((pr) => pr.state === "merged")
  );
}

/** The item a chat is on, when it has shipped. */
export function shippedFocus(
  notes: DeskNotes,
  threadId: string,
  items: ReadonlyArray<DeskItem>,
): DeskItem | null {
  const url = chatFocus(notes, threadId);
  const item = url ? items.find((entry) => entry.url === url) : undefined;
  return item && isShipped(item) ? item : null;
}

interface ChatLike {
  readonly threadId: string;
  readonly working: boolean;
  readonly needsYou: boolean;
}

/** Idle story leads whose item shipped and that haven't wrapped up or been asked to. */
export function chatsToWrapUp<C extends ChatLike>(
  notes: DeskNotes,
  chats: ReadonlyArray<C>,
  items: ReadonlyArray<DeskItem>,
): Array<{ readonly chat: C; readonly item: DeskItem }> {
  return chats.flatMap((chat) => {
    const work = notes.work[chat.threadId];
    if (!work || (work.role !== undefined && work.role !== "work")) return [];
    if (chat.working || chat.needsYou) return [];
    // A cleared `next` means it has wrapped up already.
    const next = work.next?.trim();
    if (!next || next.startsWith(WRAP_ASKED)) return [];
    const item = shippedFocus(notes, chat.threadId, items);
    return item ? [{ chat, item }] : [];
  });
}

/** The message that asks a story lead to wrap up. */
export function wrapUpMessage(item: DeskItem): string {
  const ref = deskRef(item) ?? item.title;
  const merged = item.pullRequests
    .filter((pr) => pr.state === "merged")
    .map((pr) => `#${pr.number}`);
  const what = [
    merged.length ? `PR ${merged.join(", ")} merged` : null,
    item.state === "closed" ? "issue closed" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `${ref} has shipped (${what}). Wrap it up now without asking Rigo, per dev-desk "Wrapping up": tick the acceptance criteria that held (move any that didn't to a new issue), close PRs that won't merge, finish the test sheet, close the issue and its pieces, settle your helpers, then clear your next step (desk.mjs next ""). Reply in one line with what you closed.`;
}
