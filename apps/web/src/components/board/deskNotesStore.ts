import { useSyncExternalStore } from "react";

import { isHostedStaticApp } from "../../hostedPairing";
import { toastManager } from "../ui/toast";
import {
  type DeskNotes,
  type DeskNoteTarget,
  EMPTY_DESK_NOTES,
  mergeDeskNotes,
  parseDeskNotes,
  withNote,
} from "./deskNotes.logic";

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
