#!/usr/bin/env node
// Screenshot a page of the live review server (fleet/dev-review.sh) in a browser profile that
// persists between runs, so dismissed notices and machine pairings stay put.
//
//   node fleet/dev-look.mjs <path or url> <out.png> [--click "<button or link name>"]... [--wait <text>]
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const [target, out] = args;
if (!target || !out) {
  console.error(
    'Usage: node fleet/dev-look.mjs <path or url> <out.png> [--click "<name>"]... [--wait <text>]',
  );
  process.exit(1);
}
const state = NodePath.join(
  process.env.XDG_CACHE_HOME ?? NodePath.join(NodeOS.homedir(), ".cache"),
  "t3-fleet-dev",
);
const base = NodeFS.existsSync(NodePath.join(state, "url"))
  ? NodeFS.readFileSync(NodePath.join(state, "url"), "utf8").trim()
  : "http://localhost:5740";
const url = /^https?:/.test(target) ? target : new URL(target, base).toString();

const context = await chromium.launchPersistentContext(NodePath.join(state, "browser"), {
  headless: true,
  viewport: { width: 1440, height: 900 },
});
try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let failure = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    for (let i = 2; i < args.length; i += 2) {
      const [flag, value] = [args[i], args[i + 1]];
      if (flag === "--wait") await page.getByText(value).first().waitFor({ timeout: 60_000 });
      if (flag === "--click") {
        const named = page
          .getByRole("button", { name: value })
          .or(page.getByRole("link", { name: value }));
        await named.first().click({ timeout: 30_000 });
        await page.waitForTimeout(500);
      }
    }
  } catch (error) {
    failure = error.message.split("\n")[0];
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: out });
  console.log(`Saved ${out}${errors.length ? `\nPage errors:\n${errors.join("\n")}` : ""}`);
  if (failure) {
    console.error(`Failed: ${failure}`);
    process.exitCode = 1;
  }
} finally {
  await context.close();
}
