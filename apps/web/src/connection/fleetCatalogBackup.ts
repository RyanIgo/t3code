import * as Schema from "effect/Schema";

import { useLocalStorage, writeLocalStorageValue } from "../hooks/useLocalStorage";

/**
 * Fleet fork: keeps a copy of the browser's saved-connections catalog in a file
 * on disk, because Chrome can drop site storage. The desktop app stores the
 * catalog in OS secure storage and does not need this.
 */
const CATALOG_DATABASE = "t3code:connection-runtime";
const CATALOG_STORE = "catalog";
const CATALOG_KEY = "document";
const HANDLE_DATABASE = "t3-fleet:catalog-backup";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "file";
const STATUS_KEY = "t3-fleet:catalog-backup-status";

const BackupStatus = Schema.NullOr(
  Schema.Struct({ fileName: Schema.String, savedAt: Schema.NullOr(Schema.String) }),
);
type BackupStatus = typeof BackupStatus.Type;

type PermissionMode = { readonly mode: "readwrite" | "read" };
interface BackupFileHandle extends FileSystemFileHandle {
  queryPermission(descriptor: PermissionMode): Promise<PermissionState>;
  requestPermission(descriptor: PermissionMode): Promise<PermissionState>;
}
interface FilePickerWindow {
  showSaveFilePicker?: (options: object) => Promise<BackupFileHandle>;
  showOpenFilePicker?: (options: object) => Promise<BackupFileHandle[]>;
}

const PICKER_TYPES = [
  { description: "T3 connections backup", accept: { "application/json": [".json"] } },
];

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
}

function openDatabase(name: string, store?: string): Promise<IDBDatabase> {
  const req = store === undefined ? indexedDB.open(name) : indexedDB.open(name, 1);
  if (store !== undefined) {
    req.addEventListener("upgradeneeded", () => {
      if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
    });
  }
  return request(req);
}

async function withStore<T>(
  database: string,
  store: string,
  mode: IDBTransactionMode,
  use: (objects: IDBObjectStore) => IDBRequest<T>,
  createStore = false,
): Promise<T> {
  const db = await openDatabase(database, createStore ? store : undefined);
  try {
    return await request(use(db.transaction(store, mode).objectStore(store)));
  } finally {
    db.close();
  }
}

const readHandle = () =>
  withStore<BackupFileHandle | undefined>(
    HANDLE_DATABASE,
    HANDLE_STORE,
    "readonly",
    (store) => store.get(HANDLE_KEY),
    true,
  );

function writeStatus(status: BackupStatus) {
  writeLocalStorageValue(STATUS_KEY, status, null, BackupStatus);
}

async function writeFile(handle: BackupFileHandle, raw: string) {
  const writable = await handle.createWritable();
  await writable.write(raw);
  await writable.close();
  writeStatus({ fileName: handle.name, savedAt: new Date().toISOString() });
}

/** Called after every catalog save. Skips quietly when no file is set or access lapsed. */
export async function mirrorCatalogToBackup(raw: string): Promise<void> {
  try {
    const handle = await readHandle();
    if (!handle || (await handle.queryPermission({ mode: "readwrite" })) !== "granted") return;
    await writeFile(handle, raw);
  } catch {
    // A failed mirror must never fail the catalog save it follows.
  }
}

async function readCatalogRaw(): Promise<string | null> {
  const value = await withStore<unknown>(CATALOG_DATABASE, CATALOG_STORE, "readonly", (store) =>
    store.get(CATALOG_KEY),
  );
  return typeof value === "string" ? value : null;
}

export function supportsCatalogBackup(): boolean {
  const picker = window as FilePickerWindow;
  return (
    window.desktopBridge === undefined &&
    typeof picker.showSaveFilePicker === "function" &&
    typeof picker.showOpenFilePicker === "function"
  );
}

/** Picks the backup file (or re-grants access to the current one) and saves to it now. */
export async function saveCatalogBackup(): Promise<string> {
  const existing = await readHandle();
  let handle = existing;
  if (!handle || (await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
    handle = await (window as FilePickerWindow).showSaveFilePicker!({
      suggestedName: "t3-connections.json",
      types: PICKER_TYPES,
    });
    const chosen = handle;
    await withStore(HANDLE_DATABASE, HANDLE_STORE, "readwrite", (store) =>
      store.put(chosen, HANDLE_KEY),
    );
  }
  await writeFile(handle, (await readCatalogRaw()) ?? "");
  return handle.name;
}

/** Replaces this browser's saved connections with the backup's. Returns how many it holds. */
export async function restoreCatalogBackup(): Promise<number> {
  const [handle] = await (window as FilePickerWindow).showOpenFilePicker!({ types: PICKER_TYPES });
  if (!handle) return 0;
  const raw = await (await handle.getFile()).text();
  const parsed: unknown = JSON.parse(raw);
  const targets =
    typeof parsed === "object" && parsed !== null && "targets" in parsed ? parsed.targets : null;
  if (!Array.isArray(targets)) throw new Error("That file is not a T3 connections backup.");
  await withStore(CATALOG_DATABASE, CATALOG_STORE, "readwrite", (store) =>
    store.put(raw, CATALOG_KEY),
  );
  await withStore(
    HANDLE_DATABASE,
    HANDLE_STORE,
    "readwrite",
    (store) => store.put(handle, HANDLE_KEY),
    true,
  );
  writeStatus({ fileName: handle.name, savedAt: null });
  return targets.length;
}

export function useCatalogBackupStatus(): BackupStatus {
  return useLocalStorage<BackupStatus, BackupStatus>(STATUS_KEY, null, BackupStatus)[0];
}

/** Asks Chrome not to evict this site's storage under pressure. */
export function requestPersistentStorage(): void {
  void navigator.storage?.persist?.().catch(() => false);
}
