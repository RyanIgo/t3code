/**
 * Fleet fork: the sidebar's Work view. Every open chat once, named by the item it's on and grouped
 * like the Board: the day's chat, what waits on Rigo, each app's planners and work chats, chats on
 * no item, and chats whose work is finished (to settle). Pure logic only.
 */
import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";
import { chatFocus, type ChatRole, chatRoleOf, dayKey, type DeskNotes } from "./deskNotes.logic";

export interface WorkRow {
  readonly chat: CardChatState;
  /** The chat's level, recorded or inferred; null when the Desk can't tell. */
  readonly role: ChatRole | null;
  /** The item the chat is on, when the Desk knows it. */
  readonly item: DeskItem | null;
  readonly app: string | null;
}

export interface WorkApp {
  readonly app: string;
  /** Whole-app chats: planners, sprint and app chats. */
  readonly planners: ReadonlyArray<WorkRow>;
  /** Chats on an item that's still open. */
  readonly work: ReadonlyArray<WorkRow>;
  /** Chats on no item. */
  readonly loose: ReadonlyArray<WorkRow>;
}

export interface WorkSidebar {
  readonly today: WorkRow | null;
  readonly needsYou: ReadonlyArray<WorkRow>;
  readonly apps: ReadonlyArray<WorkApp>;
  /** Chats whose item is done, or whose PRs all merged with no open item: ready to settle. */
  readonly wrapUp: ReadonlyArray<WorkRow>;
}

const key = (chat: CardChatState) => `${chat.environmentId}:${chat.threadId}`;
const isOpenItem = (item: DeskItem) =>
  (item.state === "open" || item.state === "draft") && item.status !== "Done";

export function buildWorkSidebar(input: {
  /** Chats that aren't settled. */
  readonly chats: ReadonlyArray<CardChatState>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  /** App names in the Board's order. */
  readonly apps: ReadonlyArray<string>;
  /** The app a chat belongs to by its repo, when nothing else says. */
  readonly appOfRepo: (chat: CardChatState) => string | null;
  readonly repoOf: (chat: CardChatState) => string | null;
  readonly nowMs: number;
}): WorkSidebar {
  const byUrl = new Map(input.items.flatMap((item) => (item.url ? [[item.url, item]] : [])));
  const byPr = new Map(
    input.items.flatMap((item) => item.pullRequests.map((pr) => [pr.url, item] as const)),
  );
  const today = dayKey(input.nowMs);
  const itemFor = (chat: CardChatState): DeskItem | null => {
    const focus = chatFocus(input.notes, chat.threadId);
    if (focus && byUrl.has(focus)) return byUrl.get(focus) ?? null;
    const linked = input.notes.links[key(chat)]?.itemUrl;
    if (linked && byUrl.has(linked)) return byUrl.get(linked) ?? null;
    for (const pr of chat.pullRequests) {
      const found = byPr.get(pr.url) ?? byUrl.get(pr.url);
      if (found) return found;
    }
    const number = chat.title.match(/^#(\d+)\b/)?.[1];
    const repo = input.repoOf(chat);
    if (number && repo) {
      return (
        input.items.find(
          (item) => String(item.number) === number && item.repo?.split("/").pop() === repo,
        ) ?? null
      );
    }
    return null;
  };

  let todayRow: WorkRow | null = null;
  const needsYou: WorkRow[] = [];
  const wrapUp: WorkRow[] = [];
  const groups = new Map<string, { planners: WorkRow[]; work: WorkRow[]; loose: WorkRow[] }>();
  const group = (app: string) => {
    const existing = groups.get(app);
    if (existing) return existing;
    const created = { planners: [], work: [], loose: [] };
    groups.set(app, created);
    return created;
  };
  for (const chat of input.chats) {
    const link = input.notes.links[key(chat)];
    const role = chatRoleOf(input.notes, chat);
    const item = role === "planner" ? null : itemFor(chat);
    const app =
      item?.app ?? input.notes.work[chat.threadId]?.app ?? link?.app ?? input.appOfRepo(chat);
    const row: WorkRow = { chat, role, item, app };
    const busy = chat.working || chat.needsYou;
    if (link?.kind === "today") {
      if (link.day === today) todayRow = row;
      else if (!busy) wrapUp.push(row);
      else needsYou.push(row);
      continue;
    }
    const finished =
      (item !== null && !isOpenItem(item)) ||
      (item === null &&
        chat.pullRequests.length > 0 &&
        chat.pullRequests.every((pr) => pr.state === "merged" || pr.state === "closed"));
    if (finished && !busy) {
      wrapUp.push(row);
      continue;
    }
    if (chat.needsYou || chat.column === "done") {
      needsYou.push(row);
      continue;
    }
    const target = group(app ?? "Other");
    if (role === "planner") target.planners.push(row);
    else if (item) target.work.push(row);
    else target.loose.push(row);
  }
  const order = (app: string) => {
    const index = input.apps.indexOf(app);
    return index === -1 ? input.apps.length + (app === "Other" ? 1 : 0) : index;
  };
  const newest = (a: WorkRow, b: WorkRow) =>
    Date.parse(b.chat.since ?? "") - Date.parse(a.chat.since ?? "");
  return {
    today: todayRow,
    needsYou: needsYou.toSorted(
      (a, b) => Number(b.chat.needsYou) - Number(a.chat.needsYou) || newest(a, b),
    ),
    apps: [...groups]
      .toSorted(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
      .map(([app, rows]) => ({
        app,
        planners: rows.planners.toSorted(newest),
        work: rows.work.toSorted(
          (a, b) => Number(b.chat.working) - Number(a.chat.working) || newest(a, b),
        ),
        loose: rows.loose.toSorted(newest),
      })),
    wrapUp: wrapUp.toSorted(newest),
  };
}
