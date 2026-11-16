/**
 * Fleet fork: three-way merge of connection catalogs shared through the hub. `base` is what
 * this device last synced, `local` its new list, `remote` the hub's current list. Changes on
 * either side survive; for the same entry, this device wins.
 */
type CatalogDocument = Record<string, unknown>;

const KEYED_LISTS: Record<string, (entry: Record<string, unknown>) => string> = {
  targets: (entry) => String(entry.connectionId),
  profiles: (entry) => String(entry.connectionId),
  credentials: (entry) => String(entry.connectionId),
  remoteDpopTokens: (entry) => String(entry.environmentId),
  githubRoutingPermissions: (entry) =>
    `${String(entry.environmentId)}\u0000${String(entry.connectionKey)}`,
};
const VALUE_LISTS = ["disabledEnvironmentIds"];

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function mergeList<T>(
  base: ReadonlyArray<T>,
  local: ReadonlyArray<T>,
  remote: ReadonlyArray<T>,
  keyOf: (entry: T) => string,
): T[] {
  const baseByKey = new Map(base.map((entry) => [keyOf(entry), entry] as const));
  const remoteByKey = new Map(remote.map((entry) => [keyOf(entry), entry] as const));
  const localKeys = new Set(local.map(keyOf));
  const merged: T[] = [];
  for (const entry of local) {
    const key = keyOf(entry);
    // Deleted on the hub and untouched here: the deletion stands.
    if (!remoteByKey.has(key) && baseByKey.has(key) && same(baseByKey.get(key), entry)) continue;
    merged.push(entry);
  }
  for (const entry of remote) {
    const key = keyOf(entry);
    if (localKeys.has(key)) continue;
    // Missing here but known before: deleted on this device.
    if (baseByKey.has(key)) continue;
    merged.push(entry);
  }
  return merged;
}

const listOf = (document: CatalogDocument | null, field: string): unknown[] => {
  const value = document?.[field];
  return Array.isArray(value) ? value : [];
};

export function mergeCatalogDocuments(
  base: CatalogDocument | null,
  local: CatalogDocument,
  remote: CatalogDocument,
): CatalogDocument {
  const merged: CatalogDocument = { ...remote, ...local };
  for (const [field, keyOf] of Object.entries(KEYED_LISTS)) {
    if (!(field in local) && !(field in remote)) continue;
    merged[field] = mergeList(
      listOf(base, field) as Record<string, unknown>[],
      listOf(local, field) as Record<string, unknown>[],
      listOf(remote, field) as Record<string, unknown>[],
      keyOf,
    );
  }
  for (const field of VALUE_LISTS) {
    merged[field] = mergeList(
      listOf(base, field),
      listOf(local, field),
      listOf(remote, field),
      (value) => String(value),
    );
  }
  return merged;
}

export function countTargets(document: CatalogDocument | null): number {
  return listOf(document, "targets").length;
}

/** Whether `merged` holds anything this device's own list lacks, so a reload would show more. */
export function hasRemoteAdditions(local: CatalogDocument, merged: CatalogDocument): boolean {
  return Object.entries(KEYED_LISTS).some(([field, keyOf]) => {
    const localKeys = new Set((listOf(local, field) as Record<string, unknown>[]).map(keyOf));
    return (listOf(merged, field) as Record<string, unknown>[]).some(
      (entry) => !localKeys.has(keyOf(entry)),
    );
  });
}
