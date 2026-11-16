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

export interface BoardCard {
  readonly id: string;
  readonly projectKey: string;
  readonly title: string;
  readonly notes: string;
  readonly stage: CardStage;
  /** When `stage` was last set by hand; a chat change after this moves the card again. */
  readonly stageSetAt: string;
  readonly category: CardCategory | null;
  /** Cross-repo theme the card belongs to, e.g. "Dev workflow"; free text, shared by name. */
  readonly initiative: string | null;
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
  readonly working: boolean;
  readonly hasPullRequest: boolean;
  readonly pullRequestNumber: number | null;
  /** When the chat last changed state. */
  readonly since: string | null;
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
  /** A chat that isn't on any card yet, shown so nothing on the machines is hidden. */
  readonly loose: boolean;
  readonly needsYou: boolean;
  readonly working: boolean;
}

/**
 * Where each card sits: its hand-set stage, unless one of its chats changed state after that,
 * then where the chats point. Done is never undone by a chat.
 */
export function placeCard(card: BoardCard, chats: ReadonlyArray<CardChatState>): PlacedCard {
  const own = card.chats.flatMap((ref) => {
    const found = chats.find(
      (chat) => chat.environmentId === ref.environmentId && chat.threadId === ref.threadId,
    );
    return found ? [found] : [];
  });
  const derived = stageFromChats(own, card.testing);
  const latestChange = Math.max(0, ...own.map((chat) => ms(chat.since)));
  const useDerived =
    derived !== null && card.stage !== "done" && latestChange > ms(card.stageSetAt);
  return {
    card,
    stage: useDerived ? derived : card.stage,
    chats: own,
    loose: false,
    needsYou: own.some((chat) => chat.needsYou),
    working: own.some((chat) => chat.working),
  };
}

/** A temporary card for a chat that no card owns yet. */
export function looseCard(chat: CardChatState): PlacedCard {
  const at = chat.since ?? new Date(0).toISOString();
  const card: BoardCard = {
    id: `chat:${chat.environmentId}:${chat.threadId}`,
    projectKey: chat.projectKey ?? "",
    title: chat.title,
    notes: "",
    stage: "progress",
    stageSetAt: new Date(0).toISOString(),
    category: null,
    initiative: null,
    order: Number.MAX_SAFE_INTEGER - ms(at),
    chats: [{ environmentId: chat.environmentId, threadId: chat.threadId }],
    testing: null,
    createdAt: at,
    updatedAt: at,
  };
  const stage = stageFromChats([chat], null) ?? "progress";
  return {
    card,
    stage,
    chats: [chat],
    loose: true,
    needsYou: chat.needsYou,
    working: chat.working,
  };
}

/** Which cards a board shows: one repo's (plus its chats no card owns), or one initiative's. */
export type BoardScope =
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
  const owned = new Set<string>();
  for (const card of document.cards) {
    for (const ref of card.chats) owned.add(chatKey(ref));
    const inScope =
      scope.kind === "project"
        ? card.projectKey === scope.projectKey
        : sameInitiative(card.initiative, scope.initiative);
    if (!inScope) continue;
    const placed = placeCard(card, chats);
    lists[placed.stage].push(placed);
  }
  if (scope.kind === "project") {
    for (const chat of chats) {
      if (chat.projectKey !== scope.projectKey || owned.has(chatKey(chat))) continue;
      // Idle chats nobody looked at in a while are noise on a planning board.
      if (chat.column === "queued" && !chat.working) continue;
      const placed = looseCard(chat);
      lists[placed.stage].push(placed);
    }
  }
  for (const list of Object.values(lists)) list.sort((a, b) => a.card.order - b.card.order);
  return lists;
}

const normalizeInitiative = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function sameInitiative(name: string | null, wanted: string): boolean {
  return name !== null && normalizeInitiative(name) === normalizeInitiative(wanted);
}

/** Initiative names in use, spelled as first written, alphabetically. */
export function listInitiatives(document: BoardDocument): string[] {
  const byKey = new Map<string, string>();
  for (const card of document.cards) {
    const name = card.initiative?.trim();
    if (name && !byKey.has(normalizeInitiative(name))) byKey.set(normalizeInitiative(name), name);
  }
  return [...byKey.values()].toSorted((a, b) => a.localeCompare(b));
}

/** Cards across every project, grouped by category, for the at-a-glance views. */
export function buildCategoryView(
  document: BoardDocument,
  chats: ReadonlyArray<CardChatState>,
): Record<CardCategory | "none", PlacedCard[]> {
  const view: Record<CardCategory | "none", PlacedCard[]> = {
    critical: [],
    short: [],
    long: [],
    maintenance: [],
    experiment: [],
    none: [],
  };
  const stageRank = new Map(CARD_STAGES.map((stage, index) => [stage.id, index]));
  for (const card of document.cards) {
    const placed = placeCard(card, chats);
    view[card.category ?? "none"].push(placed);
  }
  for (const list of Object.values(view)) {
    list.sort(
      (a, b) =>
        Number(b.needsYou) - Number(a.needsYou) ||
        (stageRank.get(a.stage) ?? 0) - (stageRank.get(b.stage) ?? 0) ||
        a.card.order - b.card.order,
    );
  }
  return view;
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
        initiative:
          typeof card.initiative === "string" && card.initiative.trim() !== ""
            ? card.initiative.trim()
            : null,
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
