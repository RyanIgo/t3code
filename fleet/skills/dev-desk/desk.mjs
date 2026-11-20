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
  if (sprint) {
    const framing = notes.framing?.[sprint.title]?.[app]?.text;
    lines.push(`\n## Rigo's big picture for ${sprint.title}`);
    lines.push(framing || "Not written yet.");
  }
  const decisionsFor = Object.values(notes.decisions ?? {}).filter((entry) => entry.app === app);
  const answered = decisionsFor.filter((entry) => entry.answer).slice(-10);
  const pending = decisionsFor.filter((entry) => !entry.answer);
  if (pending.length || answered.length) {
    lines.push("\n## Decisions");
    for (const entry of pending) lines.push(`- (waiting) ${entry.question}`);
    for (const entry of answered) {
      lines.push(
        `- ${entry.question} → ${entry.answer.choice}${entry.answer.note ? ` (${entry.answer.note})` : ""}`,
      );
    }
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
  if (!threadId || !THREAD_ID.test(threadId)) fail("--thread needs the chat's thread id.");
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

/**
 * `decide "<question>" --options "Yes|No|…" [--rec Yes] [--why "<reason>"] [--item <url>] [--app "<app>"]`:
 * a question for Rigo, shown in the planning session's Decisions, on Now and on his phone. His
 * answer comes back to this chat as a message ("Decision: … → Yes").
 */
/** Every value of a repeatable `--name value` flag. */
function many(list, name) {
  const out = [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === `--${name}` && list[index + 1] !== undefined) out.push(list[index + 1]);
  }
  return out;
}

async function decide(question, options) {
  if (!question?.trim()) {
    fail(
      'Usage: node desk.mjs decide "<question>" --options "Yes|No" [--rec Yes] [--why "<reason>"] [--item <url>] [--link <url|repo#n>]… [--effect "<option>=><what happens>"]… [--final "<option>"]… [--context "<background>" | --context-file <file|->] [--id <id to update>] [--app "<app>"] [--goal (the question is a proposed sprint goal)]',
    );
  }
  const threadId = thisThread();
  const given = flags(options);
  const doc = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
  const appName = given.app
    ? resolveApp((await call("/fleet/desk")).body, given.app)
    : (doc.work?.[threadId]?.app ?? null);
  if (!appName)
    fail('Which app is this for? Add --app "<app>" (or record this chat: role planner --app …).');
  // --goal: the question is a proposed sprint goal; the first option takes it as written.
  const goalFor =
    given.goal !== undefined
      ? currentSprint((await call("/fleet/desk")).body?.sprints)?.title
      : null;
  if (given.goal !== undefined && !goalFor) fail("There's no current sprint to set a goal for.");
  const choices = (given.options ?? (goalFor ? "Use this goal|Not yet" : "Yes|No"))
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (given.rec && !choices.includes(given.rec))
    fail(`--rec must be one of: ${choices.join(", ")}`);
  // Links: URLs, or repo#n / owner/repo#n resolved to the Desk item's URL.
  const deskItems = (await call("/fleet/desk")).body?.items ?? [];
  const links = many(options, "link").map((ref) => {
    if (/^https:\/\//.test(ref)) return ref;
    const match = ref.match(/^(?:([\w.-]+)\/)?([\w.-]+)#(\d+)$/);
    const item = match
      ? deskItems.find(
          (entry) =>
            entry.number === Number(match[3]) &&
            (entry.repo === `${match[1]}/${match[2]}` || entry.repo?.split("/")[1] === match[2]),
        )
      : null;
    if (!item?.url) fail(`--link ${ref} isn't a URL or an item on the Desk.`);
    return item.url;
  });
  const finals = new Set(many(options, "final"));
  const outcomes = many(options, "effect").map((entry) => {
    const [option, ...rest] = entry.split("=>");
    const name = option.trim();
    if (!choices.includes(name) || !rest.join("=>").trim()) {
      fail(`--effect takes "<option>=><what happens>", with an option from: ${choices.join(", ")}`);
    }
    return {
      option: name,
      effect: rest.join("=>").trim().slice(0, 500),
      undoable: !finals.has(name),
    };
  });
  for (const name of finals) {
    if (!outcomes.some((entry) => entry.option === name)) {
      fail(`--final "${name}" needs an --effect for it, saying what can't be undone.`);
    }
  }
  const context = given["context-file"]
    ? NodeFS.readFileSync(given["context-file"] === "-" ? 0 : given["context-file"], "utf8")
    : (given.context ?? null);
  const id = given.id ?? Math.random().toString(36).slice(2, 12);
  await changeNotes((next, at) => {
    next.decisions ??= {};
    if (given.id && !next.decisions[given.id]) fail(`No decision ${given.id} to update.`);
    next.decisions[id] = {
      id,
      threadId,
      app: appName,
      question: question.trim().slice(0, 500),
      why: given.why?.trim() ? given.why.trim().slice(0, 1000) : null,
      options: choices,
      links,
      outcomes,
      context: context?.trim() ? context.trim().slice(0, 4000) : null,
      recommended: given.rec ?? null,
      itemUrl: given.item ?? null,
      goalFor: goalFor ?? null,
      createdAt: at,
      updatedAt: at,
      answer: null,
    };
  });
  console.log(
    `${given.id ? "Updated" : "Asked Rigo"} (${id}): ${context ? "background, " : "no background, "}${links.length} links, ${outcomes.length} of ${choices.length} options explained. It's in his plan, on Now and on his phone; his answer comes back here as a message.`,
  );
  if (!context?.trim()) {
    console.log(
      "Add --context (or --context-file -): what this is, why now, what he's agreeing to, in plain words.",
    );
  }
  if (outcomes.length < choices.length) {
    console.log("Explain every option with --effect so Rigo can decide without asking.");
  }
}

/** `decisions [app]`: questions still waiting, and recent answers. */
async function decisions(given) {
  const doc = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
  const app = given ? resolveApp((await call("/fleet/desk")).body, given) : null;
  const all = Object.values(doc.decisions ?? {}).filter((entry) => !app || entry.app === app);
  for (const entry of all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    console.log(
      `- ${entry.id} ${entry.answer ? `answered ${entry.answer.choice}${entry.answer.note ? ` (${entry.answer.note})` : ""}` : "waiting"}: ${entry.question}`,
    );
  }
  if (all.length === 0) console.log("No decisions.");
}

/**
 * `plan set <file.json | ->`: this planner's checklist, replaced whole, as JSON lines
 * [{ "text": "...", "who": "you|agents|<person>", "done": false, "item": "<url>" }]. `plan show` prints it.
 */
async function plan(action, rest) {
  const threadId = thisThread();
  if (action === "show") {
    const doc = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
    const lines = doc.work?.[threadId]?.plan ?? [];
    for (const line of lines) console.log(`${line.done ? "✓" : "☐"} ${line.text} (${line.who})`);
    if (!lines.length) console.log("No checklist yet.");
    return;
  }
  if (action !== "set" || !rest[0])
    fail("Usage: node desk.mjs plan set <file.json | -> | plan show");
  const raw =
    rest[0] === "-" ? NodeFS.readFileSync(0, "utf8") : NodeFS.readFileSync(rest[0], "utf8");
  let lines;
  try {
    lines = JSON.parse(raw);
  } catch (error) {
    fail(`The checklist isn't JSON: ${error.message}`);
  }
  if (!Array.isArray(lines)) fail("The checklist is a JSON array of { text, who, done, item }.");
  const clean = lines
    .filter((line) => line && typeof line.text === "string" && line.text.trim())
    .slice(0, 40)
    .map((line) => ({
      text: line.text.trim().slice(0, 300),
      who:
        typeof line.who === "string" && line.who.trim() ? line.who.trim().slice(0, 40) : "agents",
      done: line.done === true,
      itemUrl: typeof line.item === "string" ? line.item : (line.itemUrl ?? null),
    }));
  await changeNotes((doc, at) => {
    const mine = doc.work[threadId] ?? { items: [], next: null };
    doc.work[threadId] = { ...mine, plan: clean, updatedAt: at };
  });
  console.log(
    `Checklist saved: ${clean.length} lines, ${clean.filter((line) => !line.done).length} open.`,
  );
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

/** `capture "<text>" [--who name] [--source "In person|User session|Email|Teams|Call|Other"] [--app "<app>"]`: a new inbox note. */
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
      source: ["In person", "User session", "Email", "Teams", "Call", "Other"].includes(
        given.source,
      )
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

// T3 thread ids: a UUID for chats started from the sidebar, longer ids with ":" and "%" for chats
// another chat started (mcp:launch:…, thread:delegated-task:…). The Board reads the same pattern.
const THREAD_ID = /^[\w:%.-]{8,200}$/;

/** A Board chat key is `<environment id>:<thread id>`; the thread id may itself contain ":". */
const threadOfKey = (key) => key.slice(key.indexOf(":") + 1);

/** `role <today|planner|work|helper> [--app "<app>"] [--parent <thread id>] [--thread <id>]` */
async function role(value, options) {
  if (!ROLES.includes(value)) {
    fail(
      'Usage: node desk.mjs role <planner|work|helper|today> [--app "<app>"] [--parent <thread id>] [--thread <thread id>]',
    );
  }
  const given = flags(options);
  const threadId = given.thread ?? thisThread();
  if (!THREAD_ID.test(threadId)) fail("--thread needs a chat's thread id.");
  if (given.parent && !THREAD_ID.test(given.parent)) fail("--parent needs a chat's thread id.");
  if (value === "planner" && !given.app) fail("A planner needs --app: the application it plans.");
  if (value === "helper" && !given.parent && !given.thread) {
    fail("A helper names its parent chat: --parent <thread id>.");
  }
  let app = given.app ?? null;
  const desk = app || value === "planner" ? (await call("/fleet/desk")).body : null;
  if (app) app = resolveApp(desk, app);
  // One planner per app per sprint: a new planner takes over the app's earlier one, carrying its
  // open lines over, and the earlier one becomes its helper (it hands over and stops).
  const sprint = value === "planner" ? (currentSprint(desk?.sprints)?.title ?? null) : null;
  const handedOver = [];
  await changeNotes((doc, at) => {
    const current = doc.work[threadId] ?? { items: [], next: null };
    const carried = [];
    if (value === "planner") {
      for (const [other, work] of Object.entries(doc.work)) {
        if (other === threadId || work.role !== "planner" || work.app !== app) continue;
        carried.push(...(work.plan ?? []).filter((line) => !line.done));
        doc.work[other] = { ...work, role: "helper", parent: threadId, updatedAt: at };
        handedOver.push({ threadId: other, sprint: work.sprint ?? null });
      }
    }
    doc.work[threadId] = {
      ...current,
      role: value,
      ...(app ? { app } : {}),
      ...(given.parent ? { parent: given.parent } : {}),
      ...(sprint ? { sprint } : {}),
      ...(carried.length && !current.plan?.length ? { plan: carried.slice(0, 40) } : {}),
      updatedAt: at,
    };
  });
  console.log(
    `${given.thread ? `Chat ${threadId.slice(0, 8)}` : "This chat"} is now a ${value}${app ? ` for ${app}` : ""}${sprint ? ` (${sprint})` : ""}.`,
  );
  for (const old of handedOver) {
    console.log(
      `Took over from the earlier planner ${old.threadId}${old.sprint ? ` (${old.sprint})` : ""}: its open checklist lines are now yours (plan show), and it's now your helper. Send it one queued message (t3_thread_send) asking it to hand over what isn't on the Desk and stop; read its last turns (t3_thread_read) first.`,
    );
  }
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
  // Chats the Board knows only from how they were started or pinned: started about an app or a
  // sprint, or pinned as an app's planner, count as planners; started from an item, as work.
  const recorded = new Set(rows.map((row) => row.threadId));
  const inferred = new Map();
  for (const [key, link] of Object.entries(doc.links ?? {})) {
    const threadId = threadOfKey(key);
    if (!threadId || recorded.has(threadId)) continue;
    if (link.kind === "app" || link.kind === "sprint") {
      inferred.set(threadId, { role: "planner", app: link.app ?? null, about: link.about });
    } else if (link.kind === "item" && link.itemUrl) {
      const item = byUrl.get(link.itemUrl);
      inferred.set(threadId, {
        role: "work",
        app: item?.app ?? link.app ?? null,
        about: link.about,
        item,
      });
    }
  }
  for (const [place, pins] of Object.entries(doc.pins ?? {})) {
    if (!place.startsWith("app:")) continue;
    for (const [key, pin] of Object.entries(pins)) {
      const threadId = threadOfKey(key);
      if (!threadId || recorded.has(threadId) || !pin.pinned || pin.role !== "planner") continue;
      inferred.set(threadId, { ...inferred.get(threadId), role: "planner", app: place.slice(4) });
    }
  }
  for (const [threadId, guess] of inferred) {
    rows.push({
      threadId,
      role: guess.role,
      app: guess.app,
      item: guess.item,
      parent: null,
      next: null,
      inferred: true,
      about: guess.about,
    });
  }
  const apps = only ? [only] : [...new Set(rows.map((row) => row.app).filter(Boolean))].sort();
  for (const app of apps) {
    const mine = rows.filter((row) => row.app === app);
    console.log(`## ${app}`);
    const planners = mine.filter((row) => row.role === "planner");
    // Sprint chats and app chats both read as planners until reconciled.
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
      if (row.inferred) issues.push("record it with role … --thread " + row.threadId);
      console.log(
        `- ${row.threadId.slice(0, 8)} ${row.role ?? "?"}${row.inferred ? " (inferred, not recorded)" : ""}${row.about ? ` "${row.about.slice(0, 60)}"` : ""}${row.item ? ` on ${row.item.repo}#${row.item.number} ${row.item.title}` : ""}${row.parent ? ` (helps ${row.parent.slice(0, 8)})` : ""}${row.next ? ` · next: ${row.next}` : ""}${issues.length ? `  ! ${issues.join("; ")}` : ""}`,
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
else if (command === "decide") await decide(first, rest);
else if (command === "decisions") await decisions(first);
else if (command === "plan") await plan(first, rest);
else if (command === "agents") await agents(first);
else if (command === "propose") await propose(first, rest[0], rest.slice(1));
else if (command === "capture") await capture(first, rest);
else
  fail(
    'Usage: node desk.mjs context [app or repo] | note <app or repo> "<text>" | focus <item> [--thread <id>] | next "<text>" | inbox | propose <id> <action> … | capture "<text>" | role <level> … | agents [app] | decide "<question>" … | decisions [app] | plan set|show',
  );
