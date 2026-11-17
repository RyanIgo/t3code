#!/usr/bin/env node
// Dev Desk context for agents: `context [app or repo]` prints an application's notes for agents,
// its goal for the current sprint, the sprint's notes and its features; `note <app or repo> <text>`
// adds a dated line to its notes. The app defaults to this folder's git repo. Usage in SKILL.md.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hubUrl() {
  let configured = process.env.T3_FLEET_HUB_URL?.trim();
  if (!configured) {
    try {
      configured = NodeFS.readFileSync(
        NodePath.join(NodeOS.homedir(), ".config", "t3-fleet", "hub-url"),
        "utf8",
      ).trim();
    } catch {
      configured = "";
    }
  }
  if (!configured) fail("No fleet hub address (~/.config/t3-fleet/hub-url). Ask the user for it.");
  return new URL(configured).origin;
}

async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(`${hubUrl()}${path}`, {
      ...init,
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    fail(`Couldn't reach the fleet hub (${error.cause?.code ?? error.message}).`);
  }
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function currentRepo() {
  try {
    const remote = NodeChildProcess.execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return (
      remote
        .replace(/\.git$/, "")
        .split(/[/:]/)
        .pop() || null
    );
  } catch {
    return null;
  }
}

/** An app by name, or the app most of a repo's items belong to. */
function resolveApp(desk, given) {
  const wanted = (given ?? currentRepo() ?? "").trim();
  if (!wanted) fail("Say which app (or run inside its repo).");
  const apps = desk.apps ?? [];
  const byName = apps.find((app) => app.toLowerCase() === wanted.toLowerCase());
  if (byName) return byName;
  const counts = new Map();
  for (const item of desk.items) {
    if (item.app && item.repo?.split("/").pop().toLowerCase() === wanted.toLowerCase()) {
      counts.set(item.app, (counts.get(item.app) ?? 0) + 1);
    }
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) fail(`No app named or holding the repo "${wanted}". Apps: ${apps.join(", ")}`);
  return best;
}

function currentSprint(sprints) {
  const now = Date.now();
  const sorted = [...(sprints ?? [])].sort(
    (a, b) => Date.parse(a.startDate) - Date.parse(b.startDate),
  );
  return (
    sorted.find(
      (s) =>
        Date.parse(s.startDate) <= now && now < Date.parse(s.startDate) + s.duration * 86_400_000,
    ) ??
    sorted.find((s) => Date.parse(s.startDate) > now) ??
    null
  );
}

async function context(given) {
  const desk = (await call("/fleet/desk")).body;
  const notes = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
  const app = resolveApp(desk, given);
  const sprint = currentSprint(desk.sprints);
  const features = desk.items.filter(
    (item) => item.app === app && item.title.startsWith("Feature:") && item.workType === "Tracking",
  );
  const lines = [`# ${app}`];
  if (sprint) {
    const goal = notes.sprintGoals?.[sprint.title]?.[app]?.text;
    lines.push(`\n## ${sprint.title} (from ${sprint.startDate}, ${sprint.duration} days)`);
    lines.push(goal ? `Goal: ${goal}` : "Goal: not set.");
    const sprintNotes = notes.sprintNotes?.[sprint.title]?.text;
    if (sprintNotes) lines.push(`Sprint notes:\n${sprintNotes}`);
  }
  lines.push("\n## Notes for agents");
  lines.push(notes.apps?.[app]?.text || "None yet.");
  if (features.length > 0) {
    lines.push("\n## Features");
    for (const feature of features) {
      lines.push(
        `- ${feature.title.replace(/^Feature:\s*/, "")} (${feature.stage ?? "no stage"}): ${feature.url}`,
      );
    }
  }
  console.log(lines.join("\n"));
}

async function note(given, text) {
  if (!text?.trim())
    fail('Usage: node desk.mjs note <app or repo> "<what was decided or learned>"');
  const desk = (await call("/fleet/desk")).body;
  const app = resolveApp(desk, given);
  const thread = process.env.T3CODE_THREAD_ID
    ? ` (thread ${process.env.T3CODE_THREAD_ID.slice(0, 8)})`
    : "";
  const line = `- ${new Date().toISOString().slice(0, 10)} ${text.trim()}${thread}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = (await call("/fleet/desknotes")).body ?? { version: 0, document: null };
    const doc = record.document ? JSON.parse(record.document) : {};
    const current = doc.apps?.[app]?.text ?? "";
    doc.schemaVersion = 1;
    doc.apps = {
      ...doc.apps,
      [app]: {
        text: current ? `${current}\n${line}` : line,
        updatedAt: new Date().toISOString(),
        by: "agent",
      },
    };
    doc.sprintGoals ??= {};
    doc.sprintNotes ??= {};
    const saved = await call("/fleet/desknotes", {
      method: "PUT",
      body: JSON.stringify({ baseVersion: record.version, document: JSON.stringify(doc) }),
    });
    if (saved.status === 200) {
      console.log(`Added to ${app}'s notes: ${line}`);
      return;
    }
    if (saved.status !== 409) fail(`The hub answered ${saved.status}.`);
  }
  fail("The notes kept changing; try again.");
}

const [command, first, ...rest] = process.argv.slice(2);
if (command === "context") await context(first);
else if (command === "note") await note(first, rest.join(" "));
else fail('Usage: node desk.mjs context [app or repo] | note <app or repo> "<text>"');
