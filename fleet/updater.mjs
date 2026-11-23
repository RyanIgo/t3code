#!/usr/bin/env node
// Fleet updater (on a timer from install-client.sh): when the hub holds an update request this
// machine hasn't done, pull and refresh the agent skills. Never restarts T3; a changed web client
// is only reported. `node fleet/updater.mjs --now` updates without a request.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const repo = NodePath.resolve(NodePath.dirname(new URL(import.meta.url).pathname), "..");
const configDir = NodePath.join(NodeOS.homedir(), ".config", "t3-fleet");
const stateFile = NodePath.join(configDir, "updater.json");
const now = process.argv.includes("--now");

function hubUrl() {
  const configured =
    process.env.T3_FLEET_HUB_URL?.trim() ||
    (() => {
      try {
        return NodeFS.readFileSync(NodePath.join(configDir, "hub-url"), "utf8").trim();
      } catch {
        return "";
      }
    })();
  if (!configured) throw new Error(`No hub address in ${configDir}/hub-url`);
  return new URL(configured).origin;
}

const run = (command, args) =>
  NodeChildProcess.execFileSync(command, args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5 * 60_000,
  }).trim();
const git = (...args) => run("git", args);

function readState() {
  try {
    return JSON.parse(NodeFS.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function clientBehind() {
  let installed = "";
  try {
    installed = NodeFS.readFileSync(NodePath.join(configDir, "client-commit"), "utf8").trim();
  } catch {
    return true;
  }
  try {
    git("diff", "--quiet", installed, "HEAD", "--", "apps/web", "packages");
    return false;
  } catch {
    return true;
  }
}

/** Pulls and refreshes the skills; returns what happened in a line. */
function update() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  let upstream = "";
  try {
    upstream = git("rev-parse", "--abbrev-ref", "@{upstream}");
  } catch {
    return { ok: false, result: `Not pulled: ${branch} doesn't track a remote branch.` };
  }
  if (git("status", "--porcelain", "--untracked-files=no"))
    return { ok: false, result: "Not pulled: this checkout has local changes." };
  const before = git("rev-parse", "--short", "HEAD");
  git("pull", "--ff-only", "--quiet");
  const after = git("rev-parse", "--short", "HEAD");
  run("bash", [NodePath.join(repo, "fleet", "install-client.sh"), "--skills-only"]);
  return {
    ok: true,
    result:
      before === after
        ? `Already current with ${upstream} at ${after}; skills refreshed.`
        : `Pulled ${upstream}: ${before} → ${after}; skills refreshed.`,
  };
}

async function main() {
  const hub = hubUrl();
  const state = readState();
  const response = await fetch(`${hub}/fleet/updates`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`hub answered ${response.status}`);
  const { request } = await response.json();
  let outcome = { ok: state.ok ?? true, result: state.result ?? null };
  let updatedAt = state.updatedAt ?? null;
  const pending = request && request.id !== state.requestDone;
  if (now || pending) {
    try {
      outcome = update();
    } catch (error) {
      outcome = { ok: false, result: String(error.stderr || error.message).slice(0, 500) };
    }
    updatedAt = new Date().toISOString();
    if (request) state.requestDone = request.id;
    NodeFS.mkdirSync(configDir, { recursive: true });
    NodeFS.writeFileSync(stateFile, JSON.stringify({ ...state, ...outcome, updatedAt }, null, 2));
    console.log(outcome.result);
  }
  await fetch(`${hub}/fleet/updates/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      machine: NodeOS.hostname(),
      os: `${NodeOS.type()} ${NodeOS.release()}`,
      commit: git("rev-parse", "--short", "HEAD"),
      subject: git("log", "-1", "--format=%s"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      requestDone: state.requestDone ?? null,
      clientBehind: clientBehind(),
      updatedAt,
      ...outcome,
    }),
  });
}

main().catch((error) => {
  console.error(`fleet updater: ${error.message}`);
  process.exit(1);
});
