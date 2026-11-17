import { useSyncExternalStore } from "react";

import { isHostedStaticApp } from "../../hostedPairing";
import { toastManager } from "../ui/toast";
import type { DeskLane, DeskView } from "./desk.logic";

/**
 * Fleet fork: the Dev Desk's data, from the fleet hub (`/fleet/desk`), which keeps a synced copy
 * of the GitHub project. Polled while the Desk is open; lane changes write through the hub.
 */
interface DeskSnapshot {
  readonly view: DeskView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onHub: boolean;
}

const POLL_MS = 60_000;
let snapshot: DeskSnapshot = { view: null, loading: false, error: null, onHub: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function publish(next: Partial<DeskSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

async function call(path: string, init?: RequestInit): Promise<DeskView> {
  const response = await fetch(path, { ...init, signal: AbortSignal.timeout(60_000) });
  const body = (await response.json().catch(() => null)) as
    | (DeskView & { error?: string })
    | { error?: string }
    | null;
  if (!response.ok) throw new Error(body?.error ?? `The hub answered ${response.status}.`);
  return body as DeskView;
}

async function load(path = "/fleet/desk", init?: RequestInit) {
  if (!isHostedStaticApp()) {
    publish({ onHub: false });
    return;
  }
  publish({ loading: true, onHub: true });
  try {
    publish({ view: await call(path, init), loading: false, error: null });
  } catch (error) {
    publish({ loading: false, error: error instanceof Error ? error.message : String(error) });
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

export function useDesk(): DeskSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

/** Asks the hub to sync from GitHub now. */
export function refreshDesk() {
  return load("/fleet/desk/refresh", { method: "POST" });
}

/** Moves an item to a lane (null: no lane) on GitHub, showing it at once. */
export async function setDeskLane(itemId: string, lane: DeskLane | null) {
  const before = snapshot.view;
  if (before === null) return;
  publish({
    view: {
      ...before,
      items: before.items.map((item) => (item.itemId === itemId ? { ...item, lane } : item)),
    },
  });
  try {
    await call(`/fleet/desk/items/${encodeURIComponent(itemId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lane }),
    });
  } catch (error) {
    publish({ view: before });
    toastManager.add({
      type: "error",
      title: "Couldn't move it",
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
