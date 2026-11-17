import { describe, expect, it } from "vite-plus/test";

import { artifactSheetHtml, readArtifactReference } from "./artifacts.ts";
import { artifactFromToolItem } from "./toolOutput.ts";

const ref = {
  id: "0123456789ab",
  url: "https://hub.example.ts.net/a/0123456789ab",
  title: "Login checks",
  kind: "sheet",
  version: 2,
};

describe("readArtifactReference", () => {
  it.each([
    ["the hub's artifact page", ref, true],
    ["another path on the hub", { ...ref, url: "https://hub.example.ts.net/fleet/catalog" }, false],
    [
      "another artifact's page",
      { ...ref, url: "https://hub.example.ts.net/a/ffffffffffff" },
      false,
    ],
    ["a script URL", { ...ref, url: "javascript:alert(1)//a/0123456789ab" }, false],
    ["a malformed id", { ...ref, id: "../catalog" }, false],
    ["an unknown kind", { ...ref, kind: "app" }, false],
  ])("%s", (_name, value, accepted) => {
    expect(readArtifactReference(value) !== undefined).toBe(accepted);
  });
});

describe("artifactFromToolItem", () => {
  it("reads only artifact_publish results that succeeded", () => {
    const output = { artifact: ref, message: "Shown" };
    expect(artifactFromToolItem({ toolName: "mcp__t3-code__artifact_publish", output })).toEqual(
      ref,
    );
    expect(artifactFromToolItem({ toolName: "mcp__t3-code__html_render", output })).toBe(undefined);
    expect(
      artifactFromToolItem({
        toolName: "mcp__t3-code__artifact_publish",
        output: { content: [{ type: "text", text: JSON.stringify(output) }], isError: true },
      }),
    ).toBe(undefined);
  });
});

it("escapes the sheet title", () => {
  expect(artifactSheetHtml({ title: "<img src=x onerror=1>" })).not.toContain("<img src=x");
});
