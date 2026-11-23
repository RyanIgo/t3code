/** Fleet fork: what changed since Rigo last caught up, shown on Now. Pure logic only. */
import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";

export interface Catchup {
  /** Chats that finished a turn or started asking you something since then. */
  readonly chats: ReadonlyArray<CardChatState>;
  /** Items closed since then. */
  readonly closed: ReadonlyArray<DeskItem>;
}

const after = (value: string | null | undefined, sinceMs: number) =>
  value ? Date.parse(value) > sinceMs : false;

/** What changed since the user last said they were caught up. */
export function changesSince(
  sinceMs: number,
  items: ReadonlyArray<DeskItem>,
  chats: ReadonlyArray<CardChatState>,
): Catchup {
  return {
    chats: chats
      .filter((chat) => (chat.needsYou || chat.column === "done") && after(chat.since, sinceMs))
      .toSorted((a, b) => Date.parse(b.since ?? "") - Date.parse(a.since ?? "")),
    closed: items.filter((item) => after(item.closedAt, sinceMs)),
  };
}
