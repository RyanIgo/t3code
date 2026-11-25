#!/usr/bin/env node
// Fleet updater (on a timer): pulls and refreshes skills when the hub asks; never restarts T3
// unless the Board's Install names this machine, which runs the full install. `--now` updates.
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

const run = (command, args, timeout = 5 * 60_000) =>
  NodeChildProcess.execFileSync(command, args, {
    cwd: repo,
    env: { ...process.env, T3_FLEET_FROM_UPDATER: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  }).trim();
const git = (...args) => run("git", args);

function readState() {
  try {
    return JSON.parse(NodeFS.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

/** This machine's T3 environment id: how the Board matches its chats to this machine. */
function environmentId() {
  const home = process.env.T3CODE_HOME || NodePath.join(NodeOS.homedir(), ".t3");
  try {
    return NodeFS.readFileSync(NodePath.join(home, "userdata", "environment-id"), "utf8").trim();
  } catch {
    return null;
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

/** Pulls and refreshes the skills (or, with `full`, installs the T3 app); returns what happened. */
function update(full = false) {
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
  if (full) {
    run("bash", [NodePath.join(repo, "fleet", "install-client.sh")], 40 * 60_000);
    return { ok: true, result: `Installed the T3 app at ${after} and restarted T3.` };
  }
  run("bash", [NodePath.join(repo, "fleet", "install-client.sh"), "--skills-only"]);
  return {
    ok: true,
    result:
      before === after
        ? `Already current with ${upstream} at ${after}; skills refreshed.`
        : `Pulled ${upstream}: ${before} → ${after}; skills refreshed.`,
  };
}

async function report(hub, state, extra) {
  await fetch(`${hub}/fleet/updates/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      machine: NodeOS.hostname(),
      environmentId: environmentId(),
      os: `${NodeOS.type()} ${NodeOS.release()}`,
      commit: git("rev-parse", "--short", "HEAD"),
      subject: git("log", "-1", "--format=%s"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      requestDone: state.requestDone ?? null,
      installDone: state.installDone ?? null,
      clientBehind: clientBehind(),
      updatedAt: state.updatedAt ?? null,
      ...extra,
    }),
  });
}

async function main() {
  const hub = hubUrl();
  const state = readState();
  const response = await fetch(`${hub}/fleet/updates`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`hub answered ${response.status}`);
  const { request, install } = await response.json();
  let outcome = { ok: state.ok ?? true, result: state.result ?? null };
  let updatedAt = state.updatedAt ?? null;
  const pending = request && request.id !== state.requestDone;
  const installing =
    install && install.id !== state.installDone && install.machines?.includes(NodeOS.hostname());
  if (now || pending || installing) {
    // Say what it's doing before a long build, so the Board shows progress, not silence.
    await report(hub, state, {
      ...outcome,
      phase: installing ? "installing" : "updating",
      phaseAt: new Date().toISOString(),
    }).catch(() => undefined);
    try {
      outcome = update(Boolean(installing));
    } catch (error) {
      outcome = { ok: false, result: String(error.stderr || error.message).slice(0, 500) };
    }
    updatedAt = new Date().toISOString();
    if (request) state.requestDone = request.id;
    if (installing) state.installDone = install.id;
    NodeFS.mkdirSync(configDir, { recursive: true });
    NodeFS.writeFileSync(stateFile, JSON.stringify({ ...state, ...outcome, updatedAt }, null, 2));
    console.log(outcome.result);
  }
  await report(hub, state, { ...outcome, updatedAt, phase: null, phaseAt: null });
}

main().catch((error) => {
  // fetch() only says "fetch failed"; the cause names it (ENOTFOUND, ECONNREFUSED, a timeout).
  const cause = error.cause?.code ?? error.cause?.message ?? error.name;
  let hub = "(no hub address)";
  try {
    hub = hubUrl();
  } catch {}
  console.error(`fleet updater: ${error.message}${cause ? ` (${cause})` : ""} reaching ${hub}`);
  process.exit(1);
});
