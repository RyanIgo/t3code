import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { toastManager } from "../components/ui/toast";
import { useLocalStorage, writeLocalStorageValue } from "../hooks/useLocalStorage";
import { isHostedStaticApp } from "../hostedPairing";
import { countTargets, hasRemoteAdditions, mergeCatalogDocuments } from "./fleetHubSync.logic";

/**
 * Fleet fork: on the fleet hub (a hosted build served by fleet/hub/server.mjs), the saved
 * connections live on the hub, so every device that opens it gets the same machines. The
 * browser copy stays as a cache for when the hub can't be reached.
 */
const CATALOG_PATH = "/fleet/catalog";
const STATUS_KEY = "t3-fleet:hub-sync-status";
const REQUEST_TIMEOUT_MS = 8000;

const HubSyncStatus = Schema.NullOr(
  Schema.Struct({
    state: Schema.Literals(["synced", "offline", "error"]),
    version: Schema.Number,
    at: Schema.String,
    message: Schema.NullOr(Schema.String),
  }),
);
type HubSyncStatus = typeof HubSyncStatus.Type;

interface HubRecord {
  readonly version: number;
  readonly document: string | null;
}

interface Backend<E> {
  readonly read: Effect.Effect<string | null, E>;
  readonly write: (raw: string) => Effect.Effect<void, E>;
  readonly quarantine?: (raw: string) => Effect.Effect<void, E>;
}

function setStatus(state: "synced" | "offline" | "error", version: number, message?: string) {
  writeLocalStorageValue(
    STATUS_KEY,
    { state, version, at: new Date().toISOString(), message: message ?? null },
    null,
    HubSyncStatus,
  );
}

const parse = (raw: string | null): Record<string, unknown> | null => {
  if (raw === null || raw.trim() === "") return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** The hub's record, `null` if this origin is not a hub, or "unreachable". */
async function fetchHub(): Promise<HubRecord | null | "unreachable"> {
  try {
    const response = await fetch(CATALOG_PATH, {
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
      document: typeof body.document === "string" ? body.document : null,
    };
  } catch {
    return "unreachable";
  }
}

function promptReload(message: string) {
  const id = toastManager.add({
    title: "Your connections changed on another device",
    description: message,
    timeout: 0,
    actionProps: { children: "Reload", onClick: () => window.location.reload() },
    data: {
      secondaryActionProps: { children: "Later", onClick: () => toastManager.close(id) },
      secondaryActionVariant: "ghost",
    },
  });
}

export function withFleetHubSync<E>(local: Backend<E>): Backend<E> {
  if (typeof window === "undefined" || !isHostedStaticApp()) return local;

  let enabled = false;
  let hubVersion = 0;
  let hubDocument: string | null = null;
  // The hub list this device's own list descends from; tells this device's deletions apart
  // from another device's additions.
  let lineage: string | null = null;
  let pending: string | null = null;
  let pushing = Promise.resolve();

  const pushOnce = async (raw: string): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const mine = parse(raw);
      if (mine === null) return;
      const theirs = parse(hubDocument);
      const merged = theirs === null ? mine : mergeCatalogDocuments(parse(lineage), mine, theirs);
      if (countTargets(merged) === 0 && countTargets(theirs) > 0) {
        setStatus("error", hubVersion, "Not saving an empty list over the hub's machines.");
        return;
      }
      const nextDocument = merged === mine ? raw : JSON.stringify(merged);
      let response: Response;
      try {
        response = await fetch(CATALOG_PATH, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseVersion: hubVersion, document: nextDocument }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        setStatus("offline", hubVersion, "Saved on this device; will sync when the hub answers.");
        return;
      }
      if (response.status === 409) {
        const latest = (await response.json().catch(() => null)) as HubRecord | null;
        if (latest === null) break;
        hubVersion = latest.version;
        hubDocument = latest.document;
        continue;
      }
      if (!response.ok) break;
      const saved = (await response.json()) as { version: number };
      hubVersion = saved.version;
      hubDocument = nextDocument;
      lineage = raw;
      pending = null;
      setStatus("synced", hubVersion);
      if (merged !== mine && hasRemoteAdditions(mine, merged)) {
        promptReload("Reload to see machines added elsewhere.");
      }
      return;
    }
    setStatus("error", hubVersion, "The hub refused the update. Reload and try again.");
  };

  const push = (raw: string) => {
    pending = raw;
    pushing = pushing.then(() => (pending === raw ? pushOnce(raw) : undefined));
    return pushing;
  };

  const checkForChanges = async () => {
    if (!enabled || document.visibilityState !== "visible") return;
    if (pending !== null) {
      await push(pending);
      return;
    }
    const hub = await fetchHub();
    if (hub === null || hub === "unreachable" || hub.version === hubVersion) return;
    hubVersion = hub.version;
    if (hub.document !== hubDocument) {
      hubDocument = hub.document;
      promptReload("Reload to use the latest list from the hub.");
    }
  };

  return {
    read: Effect.gen(function* () {
      const cached = yield* local.read;
      const hub = yield* Effect.promise(fetchHub);
      if (hub === null) return cached;
      enabled = true;
      document.addEventListener("visibilitychange", () => void checkForChanges());
      window.addEventListener("online", () => void checkForChanges());
      if (hub === "unreachable") {
        setStatus("offline", 0, "Using this device's copy; the hub isn't answering.");
        return cached;
      }
      hubVersion = hub.version;
      hubDocument = hub.document;
      if (hub.document === null) {
        // A new hub: this device's machines become the first list.
        if (cached !== null && countTargets(parse(cached)) > 0) void push(cached);
        else setStatus("synced", hub.version);
        return cached;
      }
      lineage = hub.document;
      setStatus("synced", hub.version);
      if (hub.document !== cached) yield* Effect.ignore(local.write(hub.document));
      return hub.document;
    }),
    write: (raw) =>
      local.write(raw).pipe(
        // The browser copy is saved first; the hub catches up without holding the save.
        Effect.tap(() => Effect.sync(() => (enabled ? void push(raw) : undefined))),
      ),
    ...(local.quarantine ? { quarantine: local.quarantine } : {}),
  };
}

export function useFleetHubSyncStatus(): HubSyncStatus {
  return useLocalStorage<HubSyncStatus, HubSyncStatus>(STATUS_KEY, null, HubSyncStatus)[0];
}
