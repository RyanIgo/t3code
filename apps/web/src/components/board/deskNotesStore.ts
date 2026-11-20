import { useSyncExternalStore } from "react";

import { isHostedStaticApp } from "../../hostedPairing";
import { toastManager } from "../ui/toast";
import {
  type DeskNotes,
  type DeskNoteTarget,
  EMPTY_DESK_NOTES,
  mergeDeskNotes,
  parseDeskNotes,
  type DeskChatLink,
  type PinPlace,
  type PinRole,
  withLink,
  withNote,
  withPin,
  withFocus,
  type InboxNote,
  withInboxNote,
  withNextStep,
  withDecisionAnswer,
  withPlanLineDone,
  withReportsSent,
  type ChatRole,
  withRole,
  withSheet,
} from "./deskNotes.logic";
import { type DeskItem, deskRef, deskTitle } from "./desk.logic";

/**
 * Fleet fork: the Desk's notes (per-app notes for agents, sprint goals and notes), one document
 * on the fleet hub (`/fleet/desknotes`). Saves merge with whatever changed on the hub meanwhile.
 */
const HUB_PATH = "/fleet/desknotes";
const POLL_MS = 30_000;

interface NotesSnapshot {
  readonly notes: DeskNotes;
  readonly version: number;
  readonly loaded: boolean;
}

let snapshot: NotesSnapshot = { notes: EMPTY_DESK_NOTES, version: 0, loaded: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let saving: Promise<void> = Promise.resolve();

function publish(next: NotesSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function fetchNotes(): Promise<{ version: number; notes: DeskNotes } | null> {
  if (!isHostedStaticApp()) return null;
  const response = await fetch(HUB_PATH, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const record = (await response.json()) as { version: number; document: string | null };
  return { version: record.version, notes: parseDeskNotes(record.document) };
}

async function load() {
  try {
    const fetched = await fetchNotes();
    if (fetched && fetched.version !== snapshot.version) {
      publish({ notes: fetched.notes, version: fetched.version, loaded: true });
    } else if (!snapshot.loaded) {
      publish({ ...snapshot, loaded: true });
    }
  } catch {
    // Offline: keep what we have; the next poll retries.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void load();
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useDeskNotes(): NotesSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

async function push(notes: DeskNotes): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(HUB_PATH, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseVersion: snapshot.version, document: JSON.stringify(notes) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const saved = (await response.json()) as { version: number };
      publish({ notes, version: saved.version, loaded: true });
      return;
    }
    if (response.status !== 409) throw new Error(`The hub answered ${response.status}.`);
    const current = (await response.json()) as { version: number; document: string | null };
    notes = mergeDeskNotes(notes, parseDeskNotes(current.document));
    snapshot = { ...snapshot, version: current.version };
  }
  throw new Error("Someone else kept saving at the same time.");
}

/** Sets one note (an app's notes, a sprint goal, or sprint notes) and saves it to the hub. */
export function saveDeskNote(target: DeskNoteTarget, text: string) {
  const next = withNote(snapshot.notes, target, text, new Date().toISOString(), null);
  publish({ ...snapshot, notes: next });
  saving = saving
    .then(() => push(next))
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Couldn't save the note",
        description: error instanceof Error ? error.message : String(error),
      });
    });
}

/** Links a chat ("<environmentId>:<threadId>") to part of the Desk and saves it to the hub. */
export function saveDeskLink(chatKey: string, link: Omit<DeskChatLink, "updatedAt">) {
  const next = withLink(snapshot.notes, chatKey, { ...link, updatedAt: new Date().toISOString() });
  publish({ ...snapshot, notes: next });
  saving = saving
    .then(() => push(next))
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Couldn't link the chat",
        description: error instanceof Error ? error.message : String(error),
      });
    });
}

/** Pins a chat ("<environmentId>:<threadId>") to a place on the Board, or unpins it. */
export function saveDeskPin(place: PinPlace, chatKey: string, pinned: boolean, role?: PinRole) {
  const next = withPin(snapshot.notes, place, chatKey, pinned, new Date().toISOString(), role);
  publish({ ...snapshot, notes: next });
  saving = saving
    .then(() => push(next))
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: pinned ? "Couldn't pin the chat" : "Couldn't unpin the chat",
        description: error instanceof Error ? error.message : String(error),
      });
    });
}

function save(next: DeskNotes, failure: string) {
  publish({ ...snapshot, notes: next });
  saving = saving
    .then(() => push(next))
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: failure,
        description: error instanceof Error ? error.message : String(error),
      });
    });
}

/** Adds or updates an inbox note (a quick note from email, a meeting or a hallway ask). */
export function saveInboxNote(note: InboxNote) {
  save(withInboxNote(snapshot.notes, note), "Couldn't save the note");
}

/** Puts a chat (thread id) on an item, leaving whatever it was on; null takes the item's chat off. */
export function saveDeskFocus(itemUrl: string, threadId: string | null) {
  save(
    withFocus(snapshot.notes, itemUrl, threadId, new Date().toISOString()),
    "Couldn't move the chat",
  );
}

/** Records Rigo's answer to a planner's question. */
export function saveDecisionAnswer(id: string, choice: string, note: string | null) {
  save(
    withDecisionAnswer(snapshot.notes, id, choice, note, new Date().toISOString()),
    "Couldn't save the answer",
  );
}

/** Records that a planner got its chats' waiting reports. */
export function saveReportsSent(plannerId: string, threadIds: ReadonlyArray<string>) {
  save(
    withReportsSent(snapshot.notes, plannerId, threadIds, new Date().toISOString()),
    "Couldn't record the update",
  );
}

/** Ticks one of a planner's checklist lines done. */
export function savePlanLineDone(threadId: string, text: string) {
  save(
    withPlanLineDone(snapshot.notes, threadId, text, new Date().toISOString()),
    "Couldn't tick the line",
  );
}

/** Records a chat's (thread id's) level; null clears it back to what the Desk infers. */
export function saveChatRole(
  threadId: string,
  role: ChatRole | null,
  extra: { readonly app?: string | null; readonly parent?: string | null } = {},
) {
  save(
    withRole(snapshot.notes, threadId, role, new Date().toISOString(), extra),
    "Couldn't set the chat's role",
  );
}

/** Sets the next step a chat's (thread id's) panel shows. */
export function saveNextStep(threadId: string, next: string | null) {
  save(
    withNextStep(snapshot.notes, threadId, next, new Date().toISOString()),
    "Couldn't save the next step",
  );
}

/**
 * Publishes a hub test sheet with one row per acceptance criterion of a story, remembers it for
 * the item, and returns its id. Makes it again (same id) when the criteria changed.
 */
export async function publishStorySheet(item: DeskItem): Promise<string> {
  if (!item.url || !item.story || item.story.criteria.length === 0) {
    throw new Error("This item has no acceptance criteria.");
  }
  const existing = snapshot.notes.sheets[item.url];
  const response = await fetch(existing ? `/fleet/artifacts/${existing.id}` : "/fleet/artifacts", {
    method: existing ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "sheet",
      checklist: true,
      title: `Story check: ${deskTitle(item)} (${deskRef(item)})`,
      intro: item.story.text || undefined,
      rows: item.story.criteria.map((criterion, index) => ({
        id: `c${index + 1}`,
        title: criterion.text,
        links: [{ url: item.url, label: deskRef(item) }],
      })),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`The hub answered ${response.status}.`);
  const { id } = (await response.json()) as { id: string };
  const next = withSheet(snapshot.notes, item.url, { id, updatedAt: new Date().toISOString() });
  publish({ ...snapshot, notes: next });
  saving = saving.then(() => push(next)).catch(() => undefined);
  return id;
}
