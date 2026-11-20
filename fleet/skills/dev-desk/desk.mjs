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
  const section = (key, label, source) => {
    const text = source?.[key]?.text?.trim();
    if (text) lines.push(`\n## ${label}\n${text}`);
  };
  // The direction Rigo keeps on the app's page: read it before planning or building.
  const direction = notes.directions?.[app];
  section("direction", "Direction", direction);
  section("arc", "The arc (now, next, later)", direction);
  section("goals", "Goals", direction);
  section("decisions", "Decisions", direction);
  section("questions", "Open questions", direction);
  const portfolio = notes.directions?.["*"];
  section("principles", "Design principles (every application)", portfolio);
  section("loop", "How Rigo steers (every application)", portfolio);
  if (sprint) {
    const goal = notes.sprintGoals?.[sprint.title]?.[app]?.text;
    lines.push(`\n## ${sprint.title} (from ${sprint.startDate}, ${sprint.duration} days)`);
    lines.push(goal ? `Goal: ${goal}` : "Goal: not set.");
    const sprintNotes = notes.sprintNotes?.[sprint.title]?.text;
    if (sprintNotes) lines.push(`Sprint notes:\n${sprintNotes}`);
  }
  lines.push("\n## Notes for agents");
  lines.push(notes.apps?.[app]?.text || "None yet.");
  const forPlanner = Object.values(notes.inbox ?? {}).filter(
    (entry) => entry.state === "planner" && (entry.proposal?.app ?? entry.app) === app,
  );
  if (forPlanner.length > 0) {
    lines.push("\n## From Rigo's inbox, for this app's planner");
    for (const entry of forPlanner) {
      lines.push(
        `- ${[entry.who, entry.source, entry.createdAt.slice(0, 10)].filter(Boolean).join(" · ")}: ${entry.text.replace(/\s+/g, " ")}`,
      );
    }
  }
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

/** Reads the desk notes, changes them, and saves them, retrying when someone saved meanwhile. */
async function changeNotes(change) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = (await call("/fleet/desknotes")).body ?? { version: 0, document: null };
    const doc = record.document ? JSON.parse(record.document) : {};
    doc.schemaVersion = 1;
    doc.sprintGoals ??= {};
    doc.sprintNotes ??= {};
    doc.work ??= {};
    change(doc, new Date().toISOString());
    const saved = await call("/fleet/desknotes", {
      method: "PUT",
      body: JSON.stringify({ baseVersion: record.version, document: JSON.stringify(doc) }),
    });
    if (saved.status === 200) return;
    if (saved.status !== 409) fail(`The hub answered ${saved.status}.`);
  }
  fail("The notes kept changing; try again.");
}

function thisThread() {
  const threadId = process.env.T3CODE_THREAD_ID;
  if (!threadId) fail("This only works inside a T3 chat (T3CODE_THREAD_ID isn't set).");
  return threadId;
}

/**
 * `focus <issue or PR url | owner/repo#n | repo#n> [--thread <id>]`: this chat (or, for a planner,
 * a chat it started) is now on that item.
 */
async function focus(given, options) {
  if (!given)
    fail("Usage: node desk.mjs focus <issue url | owner/repo#n | repo#n> [--thread <thread id>]");
  const flag = options.indexOf("--thread");
  const threadId = flag === -1 ? thisThread() : options[flag + 1];
  if (!threadId || !/^[\w-]{8,64}$/.test(threadId)) fail("--thread needs the chat's thread id.");
  const desk = (await call("/fleet/desk")).body;
  const match = given.match(/^(?:([\w.-]+)\/)?([\w.-]+)#(\d+)$/);
  const item = (desk?.items ?? []).find((entry) =>
    match
      ? entry.number === Number(match[3]) &&
        (entry.repo === `${match[1]}/${match[2]}` || entry.repo?.split("/")[1] === match[2])
      : entry.url === given,
  );
  if (!item?.url) fail(`${given} isn't on the Dev Desk.`);
  await changeNotes((doc, at) => {
    for (const [key, work] of Object.entries(doc.work)) {
      const closeAll = key === threadId;
      const items = (work.items ?? []).map((span) =>
        span.until === null && (closeAll || span.url === item.url) ? { ...span, until: at } : span,
      );
      doc.work[key] = { ...work, items, updatedAt: at };
    }
    const mine = doc.work[threadId] ?? { items: [], next: null };
    doc.work[threadId] = {
      ...mine,
      items: [...mine.items, { url: item.url, from: at, until: null }].slice(-50),
      role: mine.role === "helper" ? "helper" : "work",
      ...(item.app ? { app: item.app } : {}),
      updatedAt: at,
    };
  });
  console.log(
    `${flag === -1 ? "This chat" : `Chat ${threadId.slice(0, 8)}`} is now on ${item.repo}#${item.number}: ${item.title}`,
  );
}

/** `next "<text>"`: the one line this chat's panel shows as its next step. */
async function nextStep(text) {
  const threadId = thisThread();
  const value = text?.trim() ? text.trim().slice(0, 500) : null;
  await changeNotes((doc, at) => {
    const mine = doc.work[threadId] ?? { items: [] };
    doc.work[threadId] = { ...mine, next: value, updatedAt: at };
  });
  console.log(value ? `Next step: ${value}` : "Next step cleared.");
}

/** Reads `--name value` flags after the positional arguments. */
function flags(list) {
  const out = {};
  for (let index = 0; index < list.length; index += 1) {
    if (list[index]?.startsWith("--")) out[list[index].slice(2)] = list[index + 1] ?? "";
  }
  return out;
}

/** `inbox`: the notes waiting to be sorted (new ones first), with their ids. */
async function inbox() {
  const doc = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
  const notes = Object.values(doc.inbox ?? {})
    .filter((note) => note.state === "new" || note.state === "proposed")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (notes.length === 0) {
    console.log("The inbox is empty.");
    return;
  }
  for (const note of notes) {
    console.log(
      `## ${note.id} (${note.state}) · ${[note.who, note.source, note.createdAt.slice(0, 10), note.app].filter(Boolean).join(" · ")}`,
    );
    console.log(note.text);
    if (note.proposal)
      console.log(
        `Proposed: ${note.proposal.action} ${note.proposal.itemUrl ?? note.proposal.title ?? ""} (${note.proposal.reason})`,
      );
    console.log("");
  }
}

/** `propose <id> <comment|new|planner|dismiss> [--item url] [--repo o/r] [--app a] [--type t] [--priority p] [--title t] --reason r` */
async function propose(id, action, options) {
  const actions = ["comment", "new", "planner", "dismiss"];
  if (!id || !actions.includes(action)) {
    fail(
      `Usage: node desk.mjs propose <note id> <${actions.join("|")}> [--item <url>] [--repo <owner/repo>] [--app "<app>"] [--type <type>] [--priority <P0-P3>] [--title "<title>"] --reason "<why>"`,
    );
  }
  const given = flags(options);
  if (action === "comment" && !/^https:\/\/github\.com\//.test(given.item ?? ""))
    fail("comment needs --item <issue or PR url>.");
  if (action === "new" && (!given.repo || !given.title)) fail("new needs --repo and --title.");
  let found = false;
  await changeNotes((doc, at) => {
    const note = doc.inbox?.[id];
    if (!note) return;
    found = true;
    doc.inbox[id] = {
      ...note,
      state: "proposed",
      proposal: {
        action,
        itemUrl: given.item ?? null,
        repo: given.repo ?? null,
        app: given.app ?? note.app ?? null,
        type: given.type ?? null,
        priority: given.priority ?? null,
        title: given.title ?? null,
        sprint: given.sprint ?? null,
        reason: given.reason ?? "",
      },
      updatedAt: at,
    };
  });
  if (!found) fail(`No inbox note ${id}.`);
  console.log(`Proposed for ${id}: ${action}. Rigo approves it on the Board (Now → Inbox).`);
}

/** `capture "<text>" [--who name] [--source "In person|Email|Teams|Call|Other"] [--app "<app>"]`: a new inbox note. */
async function capture(text, options) {
  if (!text?.trim())
    fail(
      'Usage: node desk.mjs capture "<what was asked or reported>" [--who <name>] [--source Email] [--app "<app>"]',
    );
  const given = flags(options);
  const id = Math.random().toString(36).slice(2, 12);
  await changeNotes((doc, at) => {
    doc.inbox ??= {};
    doc.inbox[id] = {
      id,
      text: text.trim().slice(0, 4000),
      source: ["In person", "Email", "Teams", "Call", "Other"].includes(given.source)
        ? given.source
        : "Other",
      who: given.who ?? null,
      app: given.app ?? null,
      createdAt: at,
      updatedAt: at,
      state: "new",
      proposal: null,
      result: null,
    };
  });
  console.log(`Saved to Rigo's inbox as ${id}.`);
}

const ROLES = ["today", "planner", "work", "helper"];

/** `role <today|planner|work|helper> [--app "<app>"] [--parent <thread id>] [--thread <id>]` */
async function role(value, options) {
  if (!ROLES.includes(value)) {
    fail(
      'Usage: node desk.mjs role <planner|work|helper|today> [--app "<app>"] [--parent <thread id>] [--thread <thread id>]',
    );
  }
  const given = flags(options);
  const threadId = given.thread ?? thisThread();
  if (!/^[\w-]{8,64}$/.test(threadId)) fail("--thread needs a chat's thread id.");
  if (value === "planner" && !given.app) fail("A planner needs --app: the application it plans.");
  if (value === "helper" && !given.parent && !given.thread) {
    fail("A helper names its parent chat: --parent <thread id>.");
  }
  let app = given.app ?? null;
  if (app) app = resolveApp((await call("/fleet/desk")).body, app);
  await changeNotes((doc, at) => {
    const current = doc.work[threadId] ?? { items: [], next: null };
    doc.work[threadId] = {
      ...current,
      role: value,
      ...(app ? { app } : {}),
      ...(given.parent ? { parent: given.parent } : {}),
      updatedAt: at,
    };
  });
  console.log(
    `${given.thread ? `Chat ${threadId.slice(0, 8)}` : "This chat"} is now a ${value}${app ? ` for ${app}` : ""}.`,
  );
}

/**
 * \`agents [app]\`: the chats the Desk has a record of, by app and level, with what's off: no
 * planner or two, work chats on no open item, helpers with no parent. Pair it with t3_thread_list
 * to find the chats that have no record yet.
 */
async function agents(given) {
  const desk = (await call("/fleet/desk")).body;
  const doc = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
  const only = given ? resolveApp(desk, given) : null;
  const byUrl = new Map((desk.items ?? []).map((item) => [item.url, item]));
  const rows = Object.entries(doc.work ?? {}).map(([threadId, work]) => {
    const open = (work.items ?? []).findLast((span) => span.until === null);
    const item = open ? byUrl.get(open.url) : undefined;
    return {
      threadId,
      role: work.role ?? null,
      app: work.app ?? item?.app ?? null,
      item,
      parent: work.parent ?? null,
      next: work.next ?? null,
    };
  });
  const apps = only ? [only] : [...new Set(rows.map((row) => row.app).filter(Boolean))].sort();
  for (const app of apps) {
    const mine = rows.filter((row) => row.app === app);
    console.log(`## ${app}`);
    const planners = mine.filter((row) => row.role === "planner");
    if (planners.length === 0) console.log("! No planner recorded.");
    if (planners.length > 1)
      console.log(
        `! ${planners.length} planners: keep one; make the others helpers (role helper --parent <planner>) or settle them.`,
      );
    for (const row of mine) {
      const issues = [];
      if (row.role === "work" && !row.item) issues.push("work chat on no open item");
      if (
        row.role === "work" &&
        row.item &&
        (row.item.state !== "open" || row.item.status === "Done")
      )
        issues.push("its item is done: wrap up and settle");
      if (row.role === "helper" && !row.parent) issues.push("helper with no parent");
      if (!row.role) issues.push("no role recorded");
      console.log(
        `- ${row.threadId.slice(0, 8)} ${row.role ?? "?"}${row.item ? ` on ${row.item.repo}#${row.item.number} ${row.item.title}` : ""}${row.parent ? ` (helps ${row.parent.slice(0, 8)})` : ""}${row.next ? ` · next: ${row.next}` : ""}${issues.length ? `  ! ${issues.join("; ")}` : ""}`,
      );
    }
    console.log("");
  }
  console.log(
    "Chats with no record don't show here: list them with t3_thread_list and give each a role.",
  );
}

const [command, first, ...rest] = process.argv.slice(2);
if (command === "context") await context(first);
else if (command === "note") await note(first, rest.join(" "));
else if (command === "focus") await focus(first, rest);
else if (command === "next") await nextStep([first, ...rest].join(" "));
else if (command === "inbox") await inbox();
else if (command === "role") await role(first, rest);
else if (command === "agents") await agents(first);
else if (command === "propose") await propose(first, rest[0], rest.slice(1));
else if (command === "capture") await capture(first, rest);
else
  fail(
    'Usage: node desk.mjs context [app or repo] | note <app or repo> "<text>" | focus <item> [--thread <id>] | next "<text>" | inbox | propose <id> <action> … | capture "<text>" | role <level> … | agents [app]',
  );
