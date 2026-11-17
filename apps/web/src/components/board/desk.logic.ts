/**
 * Fleet fork: the Dev Desk. Development work from the GitHub project the hub syncs, sorted into
 * lanes (Now / Next / Later / Blocked) and shown in plain words, beside the T3 chats doing it.
 * Pure logic only.
 */
import type { CardChatState } from "./boardCards.logic";

export type DeskLane = "Now" | "Next" | "Later" | "Blocked";
export const DESK_LANES: ReadonlyArray<DeskLane> = ["Now", "Next", "Later", "Blocked"];
/** More than this in Now and it stops meaning "now". */
export const NOW_LIMIT = 5;

export interface DeskPlainWords {
  readonly what: string | null;
  readonly why: string | null;
  readonly where: string | null;
}

export interface DeskItem {
  readonly itemId: string;
  readonly kind: "issue" | "pr" | "draft";
  readonly repo: string | null;
  readonly number: number | null;
  readonly title: string;
  readonly url: string | null;
  readonly state: "open" | "draft" | "closed" | "merged";
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
  readonly status: string | null;
  readonly priority: string | null;
  readonly size: string | null;
  readonly initiative: string | null;
  readonly lane: DeskLane | null;
  readonly pullRequests: ReadonlyArray<{
    readonly number: number;
    readonly url: string;
    readonly state: string;
  }>;
  readonly plain: DeskPlainWords | null;
}

export interface DeskView {
  readonly configured: boolean;
  readonly syncedAt: string | null;
  readonly error: string | null;
  readonly initiatives: ReadonlyArray<string>;
  readonly items: ReadonlyArray<DeskItem>;
}

export interface DeskFilter {
  readonly initiative: string | null;
  readonly query: string;
}

const isOpen = (item: DeskItem) => item.state === "open" || item.state === "draft";

/** What a person reads first: the plain "What", else the GitHub title. */
export const deskTitle = (item: DeskItem) => item.plain?.what ?? item.title;

/** `drawings#94`: the repo without its owner, and the number. */
export const deskRef = (item: DeskItem) =>
  item.repo && item.number !== null ? `${item.repo.split("/").pop()}#${item.number}` : null;

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);

/** Highest priority first, then most recently touched. */
function byPriority(a: DeskItem, b: DeskItem): number {
  return (
    (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9) ||
    time(b.updatedAt) - time(a.updatedAt)
  );
}

/** PRs that close an issue on the board show on that issue, not as their own card. */
function visibleItems(items: ReadonlyArray<DeskItem>): DeskItem[] {
  const closing = new Set(items.flatMap((item) => item.pullRequests.map((pr) => pr.url)));
  return items.filter((item) => !(item.kind === "pr" && item.url && closing.has(item.url)));
}

function matches(item: DeskItem, filter: DeskFilter): boolean {
  if (filter.initiative !== null && item.initiative !== filter.initiative) return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  return [item.title, item.plain?.what, item.plain?.where, deskRef(item), item.initiative]
    .filter(Boolean)
    .some((text) => String(text).toLowerCase().includes(query));
}

export type DeskColumns = Record<DeskLane | "Unsorted", DeskItem[]>;

/** Open work by lane; "Unsorted" is open work with no lane yet, highest priority first. */
export function buildDeskColumns(items: ReadonlyArray<DeskItem>, filter: DeskFilter): DeskColumns {
  const columns: DeskColumns = { Now: [], Next: [], Later: [], Blocked: [], Unsorted: [] };
  for (const item of visibleItems(items)) {
    if (!isOpen(item) || !matches(item, filter)) continue;
    columns[item.lane ?? "Unsorted"].push(item);
  }
  for (const column of Object.values(columns)) column.sort(byPriority);
  return columns;
}

/** The T3 chats working on an item: linked through its PRs or a board card's links. */
export function chatsForItem(
  item: DeskItem,
  chats: ReadonlyArray<CardChatState>,
  linksByChat: ReadonlyMap<string, ReadonlyArray<string>>,
): CardChatState[] {
  const urls = new Set([item.url, ...item.pullRequests.map((pr) => pr.url)].filter(Boolean));
  return chats.filter(
    (chat) =>
      chat.pullRequests.some((pr) => urls.has(pr.url)) ||
      (linksByChat.get(`${chat.environmentId}:${chat.threadId}`) ?? []).some((url) =>
        urls.has(url),
      ),
  );
}

export interface InitiativeSummary {
  readonly name: string;
  readonly counts: Record<DeskLane | "Unsorted", number>;
  readonly doneRecently: number;
  readonly focus: DeskItem[];
}

/** Each initiative's open work by lane, what closed in the last two weeks, and its Now/Next items. */
export function summarizeInitiatives(
  items: ReadonlyArray<DeskItem>,
  initiatives: ReadonlyArray<string>,
): InitiativeSummary[] {
  const visible = visibleItems(items);
  return [...initiatives, null].flatMap((name) => {
    const mine = visible.filter((item) => item.initiative === name);
    if (mine.length === 0) return [];
    const columns = buildDeskColumns(mine, { initiative: null, query: "" });
    return [
      {
        name: name ?? "No initiative",
        counts: {
          Now: columns.Now.length,
          Next: columns.Next.length,
          Later: columns.Later.length,
          Blocked: columns.Blocked.length,
          Unsorted: columns.Unsorted.length,
        },
        doneRecently: mine.filter((item) => !isOpen(item) && item.kind === "issue").length,
        focus: [...columns.Now, ...columns.Blocked, ...columns.Next],
      },
    ];
  });
}

/**
 * Chats waiting on the user, by the sidebar's "Waiting on me" rule: a question or approval, an
 * unread result, or a PR whose checks fail.
 */
export function chatWaitsOnYou(chat: CardChatState): boolean {
  return (
    chat.needsYou ||
    chat.column === "done" ||
    chat.pullRequests.some((pr) => pr.state === "open" && pr.checks === "failing")
  );
}

/** Items waiting on the user outside chats: blocked ones, and PRs in review. */
export function waitingOnYou(items: ReadonlyArray<DeskItem>): DeskItem[] {
  return visibleItems(items)
    .filter(
      (item) =>
        isOpen(item) &&
        (item.lane === "Blocked" ||
          (item.status === "In Review" &&
            (item.kind === "pr" || item.pullRequests.some((pr) => pr.state === "open")))),
    )
    .sort(byPriority);
}
