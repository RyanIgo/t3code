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

/** How long the queue remembers that Rigo opened a row, or that a row was on it. */
export const QUEUE_MEMORY_MS = 7 * 86_400_000;

/**
 * Rows Rigo already opened go below the ones he hasn't, longest-ago opened first, so what he
 * just answered and comes back with its next ask lands at the bottom, not the top.
 */
export function handledLast<T extends { readonly key: string }>(
  rows: ReadonlyArray<T>,
  handled: Readonly<Record<string, number>>,
): T[] {
  return rows.toSorted((a, b) => {
    const left = handled[a.key];
    const right = handled[b.key];
    if (left === undefined || right === undefined)
      return Number(left !== undefined) - Number(right !== undefined);
    return left - right;
  });
}

/** A row as the queue remembers it: its key, and when it last changed (null when unknown). */
export interface QueueMark {
  readonly key: string;
  readonly sinceMs: number | null;
}

/**
 * Rows Rigo opened that changed since: he answered them and they came back with a new ask. Only
 * those sink, so a row he opened and left alone keeps its place.
 */
export function backAgain(
  rows: ReadonlyArray<QueueMark>,
  opened: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    rows.flatMap((row) => {
      const at = opened[row.key];
      return at !== undefined && row.sinceMs !== null && row.sinceMs > at ? [[row.key, at]] : [];
    }),
  );
}

/** What arrived since he last saw the queue: rows never on it, and rows back again since. */
export function arrivals(
  rows: ReadonlyArray<QueueMark>,
  seen: Readonly<Record<string, number>>,
  back: Readonly<Record<string, number>>,
): string[] {
  return rows
    .filter((row) => {
      const at = seen[row.key];
      if (at === undefined) return true;
      return back[row.key] !== undefined && row.sinceMs !== null && row.sinceMs > at;
    })
    .map((row) => row.key);
}

/** Stamps a map of key → time, dropping what's older than the queue remembers. */
export function stamp(
  map: Readonly<Record<string, number>>,
  keys: ReadonlyArray<string>,
  nowMs: number,
): Record<string, number> {
  const kept = Object.fromEntries(
    Object.entries(map).filter(([, at]) => nowMs - at < QUEUE_MEMORY_MS),
  );
  for (const key of keys) kept[key] = nowMs;
  return kept;
}
