/**
 * Fleet fork: the Trello-style board. A card is a piece of work in one project. It is planned
 * first, then owns the chats that do it. Cards live in one shared document (on the fleet hub when
 * the UI runs from it), so every device sees the same board. Pure logic only.
 */
import type { FleetBoardColumn } from "./fleetBoard.logic";

export type CardStage = "ideas" | "planned" | "progress" | "testing" | "ready" | "done";
export type CardCategory = "critical" | "short" | "long" | "maintenance" | "experiment";
export type CardTesting = "passed" | "failed";

export const CARD_STAGES: ReadonlyArray<{ readonly id: CardStage; readonly label: string }> = [
  { id: "ideas", label: "Ideas" },
  { id: "planned", label: "Planned" },
  { id: "progress", label: "In progress" },
  { id: "testing", label: "Needs testing" },
  { id: "ready", label: "Ready to merge" },
  { id: "done", label: "Done" },
];

export const CARD_CATEGORIES: ReadonlyArray<{
  readonly id: CardCategory;
  readonly label: string;
}> = [
  { id: "critical", label: "Critical" },
  { id: "short", label: "Short term" },
  { id: "long", label: "Long term" },
  { id: "maintenance", label: "Maintenance" },
  { id: "experiment", label: "Experiments" },
];

export interface CardChatRef {
  readonly environmentId: string;
  readonly threadId: string;
}

export interface CardLink {
  readonly url: string;
  /** "repo#12" for GitHub issues and PRs. */
  readonly label: string;
  /** Picked up from a chat, so removing it would only bring it back; added by hand otherwise. */
  readonly fromChat?: boolean;
}

export type CardPullRequestState = "open" | "draft" | "merged" | "closed" | "unknown";

/** A pull request linked to one of the card's chats, as its machine last synced it. */
export interface CardPullRequest {
  readonly url: string;
  readonly label: string;
  readonly state: CardPullRequestState;
  readonly checks: "passing" | "failing" | "pending" | null;
  readonly mergeability: "mergeable" | "conflicting" | "unknown" | null;
}

export interface BoardCard {
  readonly id: string;
  readonly projectKey: string;
  readonly title: string;
  readonly notes: string;
  readonly stage: CardStage;
  /** When `stage` was last set by hand; a chat change after this moves the card again. */
  readonly stageSetAt: string;
  readonly category: CardCategory | null;
  /** Cross-repo themes the card belongs to, e.g. "Dev workflow"; free text, shared by name. */
  readonly initiatives: ReadonlyArray<string>;
  /** GitHub issues and PRs this work touches: added by hand or picked up from its chats. */
  readonly links: ReadonlyArray<CardLink>;
  /** Position inside its list; lower first. */
  readonly order: number;
  readonly chats: ReadonlyArray<CardChatRef>;
  readonly testing: CardTesting | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BoardDocument {
  readonly schemaVersion: 1;
  readonly cards: ReadonlyArray<BoardCard>;
  /** Ids of cards removed, so a device that still has them doesn't bring them back. */
  readonly removed: ReadonlyArray<string>;
}

export const EMPTY_BOARD: BoardDocument = { schemaVersion: 1, cards: [], removed: [] };

/** What the board needs to know about a chat to place its card. */
export interface CardChatState {
  readonly environmentId: string;
  readonly threadId: string;
  readonly title: string;
  readonly projectKey: string | null;
  /** The chat's column on the "needs me" board (fleetBoard.logic). */
  readonly column: FleetBoardColumn;
  readonly needsYou: boolean;
  /** What the chat (or one of its subagents) asks for, when it waits on the user. */
  readonly asking?: "approval" | "question" | "subagent approval" | null;
  readonly working: boolean;
  readonly hasPullRequest: boolean;
  readonly pullRequestNumber: number | null;
  readonly pullRequests: ReadonlyArray<CardPullRequest>;
  /** When the chat last changed state. */
  readonly since: string | null;
  /** The git worktree the chat works in; null for the project's main checkout. */
  readonly worktree: string | null;
  readonly branch: string | null;
}

/** One git worktree on one machine. A card does its work in at most one. */
export interface CardWorktree {
  readonly key: string;
  readonly path: string;
  readonly branch: string | null;
}

export function worktreeOf(chat: CardChatState): CardWorktree | null {
  return chat.worktree
    ? { key: `${chat.environmentId}:${chat.worktree}`, path: chat.worktree, branch: chat.branch }
    : null;
}

const ms = (value: string | null | undefined): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const chatKey = (ref: CardChatRef): string => `${ref.environmentId}:${ref.threadId}`;

/** The stage a card's chats point to, or null when they say nothing (no chats yet). */
export function stageFromChats(
  chats: ReadonlyArray<CardChatState>,
  testing: CardTesting | null,
): CardStage | null {
  if (chats.length === 0) return null;
  if (chats.some((chat) => chat.working || chat.needsYou)) return "progress";
  const hasPullRequest = chats.some((chat) => chat.hasPullRequest);
  if (testing === "passed") return hasPullRequest ? "ready" : "testing";
  // Settled work, with or without a PR, waits on you to try it.
  return "testing";
}

export interface PlacedCard {
  readonly card: BoardCard;
  readonly stage: CardStage;
  readonly chats: ReadonlyArray<CardChatState>;
  /** Chats no card owns yet (one, or every chat in one worktree), shown so nothing is hidden. */
  readonly loose: boolean;
  /** The worktree the card's chats work in; new chats there join the card. */
  readonly worktree: CardWorktree | null;
  readonly needsYou: boolean;
  readonly working: boolean;
}

/**
 * Where each card sits: its hand-set stage, unless one of its chats changed state after that,
 * then where the chats point. Done is never undone by a chat.
 */
export function placeCard(
  card: BoardCard,
  chats: ReadonlyArray<CardChatState>,
  /** Chats saved on any card; those stay with their card instead of joining by worktree. */
  claimed: ReadonlySet<string> = new Set(),
): PlacedCard {
  const stored = card.chats.flatMap((ref) => {
    const found = chats.find((chat) => chatKey(chat) === chatKey(ref));
    return found ? [found] : [];
  });
  const worktree = stored.map(worktreeOf).find((entry) => entry !== null) ?? null;
  // Done work keeps its chats; a new chat in a reused worktree is new work.
  const joined =
    worktree && card.stage !== "done"
      ? chats.filter(
          (chat) =>
            worktreeOf(chat)?.key === worktree.key &&
            !claimed.has(chatKey(chat)) &&
            !stored.includes(chat),
        )
      : [];
  const own = [...stored, ...joined];
  const derived = stageFromChats(own, card.testing);
  const latestChange = Math.max(0, ...own.map((chat) => ms(chat.since)));
  const useDerived =
    derived !== null && card.stage !== "done" && latestChange > ms(card.stageSetAt);
  // Merged is final: once every PR on the card's chats merged, the work is done.
  const pullRequests = own.flatMap((chat) => chat.pullRequests);
  const allMerged = pullRequests.length > 0 && pullRequests.every((pr) => pr.state === "merged");
  return {
    card:
      joined.length === 0
        ? card
        : {
            ...card,
            chats: [
              ...card.chats,
              ...joined.map((chat) => ({
                environmentId: chat.environmentId,
                threadId: chat.threadId,
              })),
            ],
          },
    stage: allMerged ? "done" : useDerived ? derived : card.stage,
    chats: own,
    loose: false,
    worktree,
    needsYou: own.some((chat) => chat.needsYou),
    working: own.some((chat) => chat.working),
  };
}

/** Every card placed, with chats saved on one card kept off the others. */
export function placeCards(
  document: BoardDocument,
  chats: ReadonlyArray<CardChatState>,
): PlacedCard[] {
  const claimed = new Set(document.cards.flatMap((card) => card.chats.map(chatKey)));
  return document.cards.map((card) => {
    const placed = placeCard(card, chats, claimed);
    // Two cards in one worktree: a new chat there joins the first only.
    for (const ref of placed.card.chats) claimed.add(chatKey(ref));
    return placed;
  });
}

/** Chats no card owns: one temporary card per worktree, or per chat in a main checkout. */
export function looseCards(
  placed: ReadonlyArray<PlacedCard>,
  chats: ReadonlyArray<CardChatState>,
): PlacedCard[] {
  const owned = new Set(placed.flatMap((entry) => entry.card.chats.map(chatKey)));
  const groups = new Map<string, CardChatState[]>();
  for (const chat of chats) {
    if (chat.projectKey === null || owned.has(chatKey(chat))) continue;
    const key = worktreeOf(chat)?.key ?? `chat:${chatKey(chat)}`;
    const group = groups.get(key);
    if (group) group.push(chat);
    else groups.set(key, [chat]);
  }
  return [...groups.values()].map(looseCard);
}

/** A temporary card for chats no card owns yet: one chat, or all of one worktree's. */
function looseCard(chats: ReadonlyArray<CardChatState>): PlacedCard {
  const first = chats[0] as CardChatState;
  const worktree = worktreeOf(first);
  const latest = Math.max(0, ...chats.map((chat) => ms(chat.since)));
  const at = new Date(latest).toISOString();
  const card: BoardCard = {
    id: worktree ? `tree:${worktree.key}` : `chat:${chatKey(first)}`,
    projectKey: first.projectKey ?? "",
    title: chats.length > 1 ? (worktree?.branch ?? first.title) : first.title,
    notes: "",
    stage: "progress",
    stageSetAt: new Date(0).toISOString(),
    category: null,
    initiatives: [],
    links: [],
    order: Number.MAX_SAFE_INTEGER - latest,
    chats: chats.map((chat) => ({ environmentId: chat.environmentId, threadId: chat.threadId })),
    testing: null,
    createdAt: at,
    updatedAt: at,
  };
  return {
    card,
    stage: looseStage(chats),
    chats,
    loose: true,
    worktree,
    needsYou: chats.some((chat) => chat.needsYou),
    working: chats.some((chat) => chat.working),
  };
}

/**
 * Where chats with no card sit. Idle chats you've already seen are unfinished work, not
 * something to test, unless they have a PR to try.
 */
function looseStage(chats: ReadonlyArray<CardChatState>): CardStage {
  if (chats.some((chat) => chat.working || chat.needsYou)) return "progress";
  const pullRequests = chats.flatMap((chat) => chat.pullRequests);
  if (pullRequests.length > 0 && pullRequests.every((pr) => pr.state === "merged")) return "done";
  if (
    chats.some((chat) => chat.column === "done") ||
    pullRequests.some((pr) => pr.state === "open")
  ) {
    return "testing";
  }
  return "progress";
}

/** Which cards a board shows: one repo's (plus its chats no card owns), or one initiative's. */
export type BoardScope =
  | { readonly kind: "all" }
  | { readonly kind: "project"; readonly projectKey: string }
  | { readonly kind: "initiative"; readonly initiative: string };

export function buildBoardLists(
  document: BoardDocument,
  scope: BoardScope,
  chats: ReadonlyArray<CardChatState>,
): Record<CardStage, PlacedCard[]> {
  const lists: Record<CardStage, PlacedCard[]> = {
    ideas: [],
    planned: [],
    progress: [],
    testing: [],
    ready: [],
    done: [],
  };
  const placedCards = placeCards(document, chats);
  for (const placed of placedCards) {
    const card = placed.card;
    const inScope =
      scope.kind === "all" ||
      (scope.kind === "project"
        ? card.projectKey === scope.projectKey
        : card.initiatives.some((name) => sameInitiative(name, scope.initiative)));
    if (inScope) lists[placed.stage].push(placed);
  }
  if (scope.kind !== "initiative") {
    for (const placed of looseCards(placedCards, chats)) {
      if (scope.kind === "project" && placed.card.projectKey !== scope.projectKey) continue;
      lists[placed.stage].push(placed);
    }
  }
  for (const list of Object.values(lists)) list.sort((a, b) => a.card.order - b.card.order);
  return lists;
}

const normalizeInitiative = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function sameInitiative(name: string, wanted: string): boolean {
  return normalizeInitiative(name) === normalizeInitiative(wanted);
}

/** Adds initiative names, skipping ones already there under another spelling. */
export function addInitiatives(
  current: ReadonlyArray<string>,
  names: ReadonlyArray<string>,
): string[] {
  const next = [...current];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name && !next.some((existing) => sameInitiative(existing, name))) next.push(name);
  }
  return next;
}

/** Initiative names in use, spelled as first written, alphabetically. */
export function listInitiatives(document: BoardDocument): string[] {
  const byKey = new Map<string, string>();
  for (const card of document.cards) {
    for (const name of card.initiatives) {
      if (!byKey.has(normalizeInitiative(name))) byKey.set(normalizeInitiative(name), name);
    }
  }
  return [...byKey.values()].toSorted((a, b) => a.localeCompare(b));
}

/** The order value that puts a card at `index` in a list (between its new neighbours). */
export function orderAt(list: ReadonlyArray<{ readonly card: BoardCard }>, index: number): number {
  const before = list[index - 1]?.card.order;
  const after = list[index]?.card.order;
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return (after as number) - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

/**
 * Three-way merge of two devices' boards: the newer edit of a card wins, a removal wins over an
 * edit made before it, and cards added on either side are kept.
 */
export function mergeBoards(local: BoardDocument, remote: BoardDocument): BoardDocument {
  const removed = new Set([...local.removed, ...remote.removed]);
  const byId = new Map<string, BoardCard>();
  for (const card of [...remote.cards, ...local.cards]) {
    if (removed.has(card.id)) continue;
    const existing = byId.get(card.id);
    if (!existing || ms(card.updatedAt) >= ms(existing.updatedAt)) byId.set(card.id, card);
  }
  return {
    schemaVersion: 1,
    cards: [...byId.values()],
    // Keep the most recent removals only; old ids can't come back from any live device.
    removed: [...removed].slice(-500),
  };
}

const STAGE_IDS = new Set<string>(CARD_STAGES.map((stage) => stage.id));
const CATEGORY_IDS = new Set<string>(CARD_CATEGORIES.map((category) => category.id));

/** Reads a stored board, dropping anything malformed instead of failing the page. */
export function parseBoardDocument(raw: string | null): BoardDocument {
  if (!raw) return EMPTY_BOARD;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_BOARD;
  }
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const cards = (Array.isArray(record.cards) ? record.cards : []).flatMap((entry): BoardCard[] => {
    const card = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    if (typeof card.id !== "string" || typeof card.projectKey !== "string") return [];
    if (typeof card.title !== "string" || !STAGE_IDS.has(String(card.stage))) return [];
    const chats = (Array.isArray(card.chats) ? card.chats : []).flatMap((ref): CardChatRef[] => {
      const chat = (typeof ref === "object" && ref !== null ? ref : {}) as Record<string, unknown>;
      return typeof chat.environmentId === "string" && typeof chat.threadId === "string"
        ? [{ environmentId: chat.environmentId, threadId: chat.threadId }]
        : [];
    });
    const now = new Date(0).toISOString();
    return [
      {
        id: card.id,
        projectKey: card.projectKey,
        title: card.title,
        notes: typeof card.notes === "string" ? card.notes : "",
        stage: card.stage as CardStage,
        stageSetAt: typeof card.stageSetAt === "string" ? card.stageSetAt : now,
        category: CATEGORY_IDS.has(String(card.category)) ? (card.category as CardCategory) : null,
        initiatives: addInitiatives(
          [],
          [
            ...(Array.isArray(card.initiatives) ? card.initiatives : []),
            // Cards saved before initiatives became tags.
            card.initiative,
          ].filter((name): name is string => typeof name === "string"),
        ),
        links: (Array.isArray(card.links) ? card.links : []).flatMap((entry): CardLink[] => {
          const link = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
            string,
            unknown
          >;
          return typeof link.url === "string" &&
            /^https?:\/\//.test(link.url) &&
            typeof link.label === "string"
            ? [
                {
                  url: link.url,
                  label: link.label,
                  ...(link.fromChat === true ? { fromChat: true } : {}),
                },
              ]
            : [];
        }),
        order: typeof card.order === "number" && Number.isFinite(card.order) ? card.order : 0,
        chats,
        testing: card.testing === "passed" || card.testing === "failed" ? card.testing : null,
        createdAt: typeof card.createdAt === "string" ? card.createdAt : now,
        updatedAt: typeof card.updatedAt === "string" ? card.updatedAt : now,
      },
    ];
  });
  const removed = (Array.isArray(record.removed) ? record.removed : []).filter(
    (id): id is string => typeof id === "string",
  );
  return { schemaVersion: 1, cards, removed };
}

const GITHUB_ITEM_URL =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/i;
const GITHUB_SHORTHAND = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;
/** A GitHub Projects item, e.g. `...projects/3?pane=issue&issue=owner%7Crepo%7C12`. */
const GITHUB_PROJECT_ITEM = /[?&]issue=([\w.-]+)(?:%7C|\|)([\w.-]+)(?:%7C|\|)(\d+)/i;

/**
 * A GitHub issue or PR as a card link, or null for anything else. Takes issue and PR URLs, an
 * issue opened from a GitHub Project, and `owner/repo#12`.
 */
export function githubCardLink(raw: string): CardLink | null {
  const text = raw.trim();
  const direct = GITHUB_ITEM_URL.exec(text);
  if (direct) {
    const [, owner, repo, kind, number] = direct;
    return {
      url: `https://github.com/${owner}/${repo}/${kind?.toLowerCase()}/${number}`,
      label: `${repo}#${number}`,
    };
  }
  const item =
    GITHUB_SHORTHAND.exec(text) ??
    (/github\.com\//i.test(text) ? GITHUB_PROJECT_ITEM.exec(text) : null);
  if (!item) return null;
  const [, owner, repo, number] = item;
  return {
    url: `https://github.com/${owner}/${repo}/issues/${number}`,
    label: `${repo}#${number}`,
  };
}

/** `current` plus any of `found` it lacks, by URL. */
export function addLinks(
  current: ReadonlyArray<CardLink>,
  found: ReadonlyArray<CardLink>,
): CardLink[] {
  const urls = new Set(current.map((link) => link.url));
  return [...current, ...found.filter((link) => !urls.has(link.url) && urls.add(link.url))];
}
