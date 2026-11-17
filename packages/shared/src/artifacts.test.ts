import { describe, expect, it } from "vite-plus/test";

import { artifactSheetHtml, artifactThemeHead, extractArtifactLinks } from "./artifacts.ts";

const HUB = "https://t3-hub.tail0.ts.net";

describe("extractArtifactLinks", () => {
  it("finds hub artifact links once each, titled by their markdown label", () => {
    const text = [
      `Fill in [Login checks](${HUB}/a/0123456789ab).`,
      `Same one: ${HUB}/a/0123456789ab, and ${HUB}/a/ffffffffffff`,
    ].join("\n");
    expect(extractArtifactLinks(text)).toEqual([
      { id: "0123456789ab", url: `${HUB}/a/0123456789ab`, title: "Login checks" },
      { id: "ffffffffffff", url: `${HUB}/a/ffffffffffff`, title: "Artifact" },
    ]);
  });

  it.each([
    ["plain http", "http://t3-hub.tail0.ts.net/a/0123456789ab"],
    ["a host off the tailnet", "https://example.com/a/0123456789ab"],
    ["a longer path", `${HUB}/a/0123456789ab/extra`],
    ["a short id", `${HUB}/a/0123`],
    ["another hub path", `${HUB}/fleet/catalog`],
  ])("ignores %s", (_name, url) => {
    expect(extractArtifactLinks(`see ${url}`)).toEqual([]);
  });
});

it("builds the hub's sheet page and theme from T3's page bootstrap", () => {
  expect(artifactSheetHtml()).toContain('id="t3-theme"');
  expect(artifactThemeHead()).toMatch(/^<meta[^]*<style id="t3-theme">[^]*<\/script>$/);
});
