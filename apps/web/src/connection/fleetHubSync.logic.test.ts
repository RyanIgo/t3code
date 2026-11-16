import { describe, expect, it } from "vite-plus/test";

import { hasRemoteAdditions, mergeCatalogDocuments } from "./fleetHubSync.logic";

const target = (id: string, label = id) => ({ connectionId: id, label });
const credential = (id: string, token = `t-${id}`) => ({ connectionId: id, credential: token });
const doc = (ids: string[], extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  targets: ids.map((id) => target(id)),
  credentials: ids.map((id) => credential(id)),
  disabledEnvironmentIds: [],
  ...extra,
});
const ids = (document: Record<string, unknown>) =>
  (document.targets as { connectionId: string }[]).map((entry) => entry.connectionId);

describe("mergeCatalogDocuments", () => {
  it("keeps machines added on either device", () => {
    const merged = mergeCatalogDocuments(doc(["a"]), doc(["a", "here"]), doc(["a", "there"]));
    expect(ids(merged)).toEqual(["a", "here", "there"]);
    expect((merged.credentials as unknown[]).length).toBe(3);
  });

  it("honours removals on either device", () => {
    expect(ids(mergeCatalogDocuments(doc(["a", "b"]), doc(["a"]), doc(["a", "b"])))).toEqual(["a"]);
    expect(ids(mergeCatalogDocuments(doc(["a", "b"]), doc(["a", "b"]), doc(["a"])))).toEqual(["a"]);
  });

  it("keeps an entry this device changed even if the hub removed it", () => {
    const local = { ...doc(["a"]), targets: [target("a", "renamed")] };
    expect(ids(mergeCatalogDocuments(doc(["a"]), local, doc([])))).toEqual(["a"]);
  });

  it("prefers this device's version of an entry both changed", () => {
    const local = { ...doc(["a"]), credentials: [credential("a", "new-here")] };
    const remote = { ...doc(["a"]), credentials: [credential("a", "new-there")] };
    expect(mergeCatalogDocuments(doc(["a"]), local, remote).credentials).toEqual([
      credential("a", "new-here"),
    ]);
  });

  it("merges disabled machines as a set and adopts everything on a first sync", () => {
    const merged = mergeCatalogDocuments(
      null,
      doc(["a"], { disabledEnvironmentIds: ["x"] }),
      doc(["b"], { disabledEnvironmentIds: ["y"] }),
    );
    expect(ids(merged)).toEqual(["a", "b"]);
    expect(merged.disabledEnvironmentIds).toEqual(["x", "y"]);
  });
});

describe("hasRemoteAdditions", () => {
  it("is true only when the merge brought in entries this device lacks", () => {
    expect(hasRemoteAdditions(doc(["a"]), doc(["a", "b"]))).toBe(true);
    expect(hasRemoteAdditions(doc(["a", "b"]), doc(["a"]))).toBe(false);
  });
});
