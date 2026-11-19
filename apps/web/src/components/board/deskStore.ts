import { useSyncExternalStore } from "react";

import { isHostedStaticApp } from "../../hostedPairing";
import { toastManager } from "../ui/toast";
import type { DeskDetail, DeskView } from "./desk.logic";

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

export type DeskField =
  | "Status"
  | "Lane"
  | "Priority"
  | "Stage"
  | "Sprint"
  | "Work type"
  | "Feature";

const FIELD_KEY = {
  Status: "status",
  Lane: "lane",
  Priority: "priority",
  Stage: "stage",
  "Work type": "workType",
  Feature: "feature",
} as const;

/** Changes one field on GitHub (null clears it), showing the change at once. */
export async function setDeskField(itemId: string, field: DeskField, value: string | null) {
  const before = snapshot.view;
  if (before === null) return;
  const sprint =
    field === "Sprint" ? (before.sprints?.find((entry) => entry.title === value) ?? null) : null;
  publish({
    view: {
      ...before,
      items: before.items.map((item) =>
        item.itemId !== itemId
          ? item
          : field === "Sprint"
            ? { ...item, sprint }
            : { ...item, [FIELD_KEY[field]]: value },
      ),
    },
  });
  try {
    await call(`/fleet/desk/items/${encodeURIComponent(itemId)}/fields`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
  } catch (error) {
    publish({ view: before });
    toastManager.add({
      type: "error",
      title: `Couldn't change ${field.toLowerCase()}`,
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/** An item's description, comments, PRs and family, from the hub. */
export async function fetchDeskDetail(itemId: string): Promise<DeskDetail> {
  const response = await fetch(`/fleet/desk/items/${encodeURIComponent(itemId)}/detail`, {
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => null)) as
    | (DeskDetail & { error?: string })
    | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `The hub answered ${response.status}.`);
  return body;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const result = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || result === null) {
    throw new Error(result?.error ?? `The hub answered ${response.status}.`);
  }
  return result;
}

/** Files a new issue on the project with its fields, then refreshes the Desk. */
export async function createDeskItem(input: {
  readonly repo: string;
  readonly title: string;
  readonly body: string;
  readonly fields: Readonly<Record<string, string>>;
}): Promise<{ readonly url: string; readonly number: number }> {
  const { item } = await post<{ item: { url: string; number: number } }>(
    "/fleet/desk/items",
    input,
  );
  void load();
  return item;
}

/** Adds a comment to an issue or PR, by its URL. */
export async function commentOnDeskItem(
  url: string,
  body: string,
): Promise<{ readonly url: string }> {
  return post<{ url: string }>("/fleet/desk/comment", { url, body });
}

/** Uploads a picture to the hub and returns its address, for a note's markdown. */
export async function uploadPicture(file: Blob): Promise<string> {
  const response = await fetch("/fleet/files", {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
    signal: AbortSignal.timeout(60_000),
  });
  const result = (await response.json().catch(() => null)) as {
    path?: string;
    error?: string;
  } | null;
  if (!response.ok || !result?.path)
    throw new Error(result?.error ?? `The hub answered ${response.status}.`);
  return new URL(result.path, window.location.origin).toString();
}
