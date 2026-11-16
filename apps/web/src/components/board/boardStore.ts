import { useSyncExternalStore } from "react";

import { isHostedStaticApp } from "../../hostedPairing";
import { randomUUID } from "../../lib/utils";
import {
  type BoardCard,
  type BoardDocument,
  EMPTY_BOARD,
  mergeBoards,
  parseBoardDocument,
} from "./boardCards.logic";

/**
 * Fleet fork: the board's cards. On the fleet hub they live in the hub's `board` document, so
 * every device shares one board; elsewhere they stay in this browser. Saves apply at once and
 * reach the hub in the background, merging with edits made on other devices.
 */
const HUB_PATH = "/fleet/board";
const LOCAL_KEY = "t3-fleet:board";
const REQUEST_TIMEOUT_MS = 8000;
const POLL_MS = 20_000;

export type BoardStorage = "loading" | "hub" | "browser";
export interface BoardSnapshot {
  readonly document: BoardDocument;
  readonly storage: BoardStorage;
  readonly error: string | null;
}

let snapshot: BoardSnapshot = { document: EMPTY_BOARD, storage: "loading", error: null };
let hubVersion = 0;
let started = false;
let saving: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function publish(next: Partial<BoardSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function readLocal(): BoardDocument {
  try {
    return parseBoardDocument(window.localStorage.getItem(LOCAL_KEY));
  } catch {
    return EMPTY_BOARD;
  }
}

function writeLocal(document: BoardDocument) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(document));
  } catch {
    // A full or blocked storage keeps the board for this visit only.
  }
}

async function fetchHub(): Promise<{ version: number; document: BoardDocument } | null> {
  const response = await fetch(HUB_PATH, {
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  const body = (await response.json()) as { version?: unknown; document?: unknown };
  if (typeof body.version !== "number") return null;
  return {
    version: body.version,
    document: parseBoardDocument(typeof body.document === "string" ? body.document : null),
  };
}

async function pushToHub(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const document = snapshot.document;
    let response: Response;
    try {
      response = await fetch(HUB_PATH, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseVersion: hubVersion, document: JSON.stringify(document) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      publish({ error: "Saved on this device; the hub isn't answering." });
      return;
    }
    if (response.status === 409) {
      const latest = (await response.json().catch(() => null)) as {
        version?: number;
        document?: string | null;
      } | null;
      if (typeof latest?.version !== "number") break;
      hubVersion = latest.version;
      publish({
        document: mergeBoards(snapshot.document, parseBoardDocument(latest.document ?? null)),
      });
      continue;
    }
    if (!response.ok) break;
    hubVersion = ((await response.json()) as { version: number }).version;
    publish({ error: null });
    return;
  }
  publish({ error: "The hub refused the board update. Reload and try again." });
}

async function refresh() {
  if (snapshot.storage !== "hub" || document.visibilityState !== "visible") return;
  const hub = await fetchHub().catch(() => null);
  if (hub === null || hub.version === hubVersion) return;
  hubVersion = hub.version;
  const merged = mergeBoards(snapshot.document, hub.document);
  writeLocal(merged);
  publish({ document: merged });
}

async function start() {
  const cached = readLocal();
  if (!isHostedStaticApp()) {
    publish({ document: cached, storage: "browser" });
    return;
  }
  const hub = await fetchHub().catch(() => "unreachable" as const);
  if (hub === null) {
    publish({ document: cached, storage: "browser" });
    return;
  }
  if (hub === "unreachable") {
    publish({ document: cached, storage: "hub", error: "Showing this device's copy." });
  } else {
    hubVersion = hub.version;
    const merged = mergeBoards(cached, hub.document);
    writeLocal(merged);
    publish({ document: merged, storage: "hub", error: null });
    if (merged.cards.length !== hub.document.cards.length) saving = saving.then(pushToHub);
  }
  window.setInterval(() => void refresh(), POLL_MS);
  document.addEventListener("visibilitychange", () => void refresh());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    void start();
  }
  return () => listeners.delete(listener);
}

export function useBoard(): BoardSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

function save(document: BoardDocument) {
  writeLocal(document);
  publish({ document });
  if (snapshot.storage === "hub") saving = saving.then(pushToHub);
}

const nowIso = () => new Date().toISOString();

export function addCard(
  fields: Pick<BoardCard, "projectKey" | "title" | "stage" | "order"> & Partial<BoardCard>,
): BoardCard {
  const at = nowIso();
  const card: BoardCard = {
    notes: "",
    category: null,
    initiative: null,
    chats: [],
    testing: null,
    ...fields,
    id: randomUUID(),
    stageSetAt: at,
    createdAt: at,
    updatedAt: at,
  };
  save({ ...snapshot.document, cards: [...snapshot.document.cards, card] });
  return card;
}

export function updateCard(id: string, changes: Partial<Omit<BoardCard, "id" | "createdAt">>) {
  const at = nowIso();
  save({
    ...snapshot.document,
    cards: snapshot.document.cards.map((card) =>
      card.id === id
        ? { ...card, ...changes, ...(changes.stage ? { stageSetAt: at } : {}), updatedAt: at }
        : card,
    ),
  });
}

export function removeCard(id: string) {
  save({
    ...snapshot.document,
    cards: snapshot.document.cards.filter((card) => card.id !== id),
    removed: [...snapshot.document.removed, id],
  });
}
