import { describe, expect, it } from "vite-plus/test";

import { collectReviewLinks, reviewAppTarget } from "./reviewItems.logic";

describe("collectReviewLinks", () => {
  it("lists each link once, newest message first, with markdown labels", () => {
    const links = collectReviewLinks([
      "Preview at http://localhost:5173/board.",
      "Done: [the dashboard](https://example.com/dash) and http://localhost:5173/board",
    ]);
    expect(links.map((link) => [link.url, link.label, link.embeddable])).toEqual([
      ["https://example.com/dash", "the dashboard", false],
      ["http://localhost:5173/board", "localhost:5173/board", true],
    ]);
  });

  it("trims trailing punctuation and unopened brackets", () => {
    const links = collectReviewLinks(["(see http://10.0.0.5:3000/a/b), then https://x.dev/c?d=1."]);
    expect(links.map((link) => link.url)).toEqual([
      "http://10.0.0.5:3000/a/b",
      "https://x.dev/c?d=1",
    ]);
    expect(links[0]?.embeddable).toBe(true);
  });

  it("skips excluded links such as pull requests", () => {
    const pr = "https://github.com/o/r/pull/12";
    expect(collectReviewLinks([`Opened ${pr}`], new Set([pr]))).toEqual([]);
  });

  it("treats Tailscale and private ranges as embeddable, public hosts as not", () => {
    const links = collectReviewLinks([
      "http://box.tail1234.ts.net:8080 http://192.168.1.9 http://172.40.0.1 https://github.com",
    ]);
    expect(links.map((link) => link.embeddable)).toEqual([true, true, false, false]);
  });

  it("names the repository for GitHub links written as bare numbers", () => {
    const links = collectReviewLinks([
      "[#2](https://github.com/o/hp-envy-ops/issues/2) and [the fix](https://github.com/o/r/pull/9) https://github.com/o/r/issues/4",
    ]);
    expect(links.map((link) => link.label)).toEqual(["hp-envy-ops#2", "the fix", "r#4"]);
  });

  it("picks the newest Tailscale link as the app to review", () => {
    const links = collectReviewLinks([
      "Old build at http://box.tail1.ts.net:5173",
      "New build at http://box.tail1.ts.net:5174/app and docs at https://example.com",
    ]);
    expect(reviewAppTarget(links)?.url).toBe("http://box.tail1.ts.net:5174/app");
    expect(reviewAppTarget(collectReviewLinks(["http://localhost:3000"]))).toBeNull();
  });
});
