#!/usr/bin/env node
// Dev Desk context for agents: `context [app or repo]` prints an application's notes for agents,
// its goal for the current sprint, the sprint's notes and its features; `note <app or repo> <text>`
// adds a dated line to its notes. The app defaults to this folder's git repo. Usage in SKILL.md.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { doFormProblems, ONLY_YOU } from "./doForm.mjs";

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

/** A contract refusal: counted on the hub (Health tab's "bounced"), then the same as fail. */
async function bounce(message) {
  try {
    await fetch(`${hubUrl()}/fleet/desk/measure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "bounced" }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Counting is best effort; the refusal still stands.
  }
  fail(message);
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
  const verb = value?.match(/^Rigo:\s*([A-Za-z-]+)/)?.[1]?.toLowerCase();
  if (verb && !["review", "test", "merge", "do"].includes(verb)) {
    await bounce(
      `"Rigo: ${verb}" isn't one of his verbs. Use review (a mockup), test (a sheet), merge, or do (a step only he can take), e.g. next "Rigo: do pick the rotation evening on the planner's card". Anything he only needs to know goes on a sheet or a decide card.`,
    );
  }
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

/**
 * Rigo reads a card's background as a manager: headings and short bullets. Returns what's wrong
 * with it, or null. His own words (`> ` lines) are exempt.
 */
function proseProblems(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bullet = /^([-*•]|\d+[.)])\s/;
  const heading = (line) =>
    /^(#+\s|\*\*[^*]+\*\*:?$)/.test(line) || (line.length <= 40 && line.endsWith(":"));
  const prose = lines.filter(
    (line, index) =>
      !line.startsWith(">") &&
      !bullet.test(line) &&
      !heading(line) &&
      !(index === 0 && line.length <= 140),
  );
  const long = lines.filter((line) => !line.startsWith(">") && line.length > 200);
  if (!prose.length && !long.length) return null;
  return [
    'The background must be headings and short bullets for a manager (see SKILL: "Write the background on the card for a manager"):',
    ...prose.slice(0, 3).map((line) => `  not a bullet: "${line.slice(0, 80)}…"`),
    ...long.slice(0, 3).map((line) => `  over 200 characters: "${line.slice(0, 80)}…"`),
    "Rewrite it under **What it is** / **Why now** / **If you approve** / **Risk** / **Done so far**, outcomes not mechanics.",
  ].join("\n");
}

async function decide(question, options) {
  // A flag where the question goes (`decide --help`) would be filed as a question to Rigo.
  if (!question?.trim() || question.trim().startsWith("-")) {
    fail(
      'Usage: node desk.mjs decide "<question>" --options "Yes|No" [--rec Yes] [--why "<reason>"] [--item <url>] [--link <url|repo#n>]… [--effect "<option>=><what happens>"]… [--final "<option>"]… [--context "<background>" | --context-file <file|->] [--id <id to update>] [--app "<app>"] [--goal (the question is a proposed sprint goal)] --fallback "<by when>: <what happens if no answer>"',
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
  const deskItems = (await call("/fleet/desk")).body?.items ?? [];
  const links = many(options, "link").map((ref) => linkUrl(ref, deskItems, "--link"));
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
  const problems = context?.trim() ? proseProblems(context) : null;
  if (problems) await bounce(problems);
  // The Decide form (Board contract): every option says what happens, the card links what it's
  // about, and says what happens if he doesn't answer by when. New cards only; goals are exempt.
  if (!given.id && !goalFor) {
    const missing = [];
    const unexplained = choices.filter((name) => !outcomes.some((entry) => entry.option === name));
    if (unexplained.length > 0)
      missing.push(
        `--effect for ${unexplained.map((name) => `"${name}"`).join(", ")} (what happens if he picks it)`,
      );
    if (links.length === 0 && !given.item)
      missing.push("--link or --item (what the card is about)");
    if (!given.fallback?.trim())
      missing.push('--fallback "<by when>: <what happens if he doesn\'t answer>"');
    if (missing.length > 0)
      await bounce(`This card isn't on the Decide form. Add:\n- ${missing.join("\n- ")}`);
  }
  const id = given.id ?? Math.random().toString(36).slice(2, 12);
  // Never ask twice: point at a waiting or recently answered decision about the same items.
  if (!given.id) {
    const touched = new Set([...(given.item ? [given.item] : []), ...links]);
    const recent = Date.now() - 14 * 86_400_000;
    const earlier = Object.values(doc.decisions ?? {}).filter(
      (entry) =>
        entry.app === appName &&
        (!entry.answer || Date.parse(entry.answer.at) > recent) &&
        [entry.itemUrl, ...(entry.links ?? [])].some((url) => url && touched.has(url)),
    );
    for (const entry of earlier) {
      console.log(
        `Already ${entry.answer ? `answered: "${entry.question}" → ${entry.answer.choice}${entry.answer.note ? ` (${entry.answer.note})` : ""}` : `waiting: "${entry.question}" (${entry.id})`}. Act on it, or update it with --id ${entry.id}; ask anew only if something changed, and say what in --why.`,
      );
    }
  }
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
      ...(given.fallback?.trim() ? { fallback: given.fallback.trim().slice(0, 300) } : {}),
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
      "Add --context (or --context-file -): **What it is** / **Why now** / **If you approve** / **Risk** / **Done so far**, short bullets for a manager.",
    );
  }
  if (outcomes.length < choices.length) {
    console.log("Explain every option with --effect so Rigo can decide without asking.");
  }
}

/** `decisions [app]`: questions still waiting, and recent answers. */
/** `retire <decision id> "<what happened>"`: takes a card events overtook off Rigo's queue. */
async function retire(id, words) {
  const why = words.join(" ").trim();
  if (!id || id.startsWith("-") || !why)
    fail(
      'Usage: node desk.mjs retire <decision id> "<what overtook it, e.g. PR #282 merged Nov 24>"',
    );
  let found = null;
  await changeNotes((doc, at) => {
    const decision = doc.decisions?.[id];
    if (!decision) fail(`No decision ${id}. List them with: node desk.mjs decisions "<app>"`);
    found = decision;
    if (decision.answer) return;
    doc.decisions[id] = {
      ...decision,
      answer: { choice: "Overtaken", note: why.slice(0, 1000), at },
      updatedAt: at,
    };
  });
  console.log(
    found?.answer
      ? `Already answered: ${found.question} → ${found.answer.choice}`
      : `Retired: ${found.question} (Overtaken: ${why})`,
  );
}

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

/** A link as given: a URL, or repo#n / owner/repo#n resolved to the Desk item's URL. */
function linkUrl(ref, deskItems, what) {
  if (/^https:\/\//.test(ref)) return ref;
  const match = ref.match(/^(?:([\w.-]+)\/)?([\w.-]+)#(\d+)$/);
  const item = match
    ? deskItems.find(
        (entry) =>
          entry.number === Number(match[3]) &&
          (entry.repo === `${match[1]}/${match[2]}` || entry.repo?.split("/")[1] === match[2]),
      )
    : null;
  if (!item?.url) fail(`${what} ${ref} isn't a URL or an item on the Desk.`);
  return item.url;
}

/**
 * `plan set <file.json | ->`: this planner's checklist, replaced whole, as JSON lines
 * [{ "text", "who": "you|agents|<person>", "done", "item", "why", "how", "links": [] }].
 * Rigo's lines ("you") carry why, how (markdown steps) and links. `plan show` prints it.
 */
async function plan(action, rest) {
  // A to-do's helper (a side chat of the planner) works on its planner's lines: --planner <id>.
  const threadId = flags(rest).planner || thisThread();
  if (action === "show") {
    const doc = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
    const lines = doc.work?.[threadId]?.plan ?? [];
    for (const line of lines) {
      console.log(`${line.done ? "✓" : "☐"} ${line.text} (${line.who})`);
      for (const entry of line.qa ?? []) {
        console.log(`    Rigo asked: ${entry.q}`);
        console.log(
          entry.a ? `    You answered: ${entry.a}` : "    (waiting for your answer: plan answer)",
        );
      }
    }
    if (!lines.length) console.log("No checklist yet.");
    return;
  }
  if (action === "answer") {
    // `plan answer "<the line, or a distinctive part of it>" "<answer>" [--how "<steps>"] [--why "<why>"] [--planner <id>]`
    const [which, answer, ...more] = rest;
    if (!which || !answer?.trim()) {
      fail(
        'Usage: node desk.mjs plan answer "<the line (or part of it)>" "<your answer>" [--how "<steps>"] [--why "<why>"]',
      );
    }
    const extra = flags(more);
    let answered = null;
    await changeNotes((doc, at) => {
      const mine = doc.work[threadId];
      const lines = mine?.plan ?? [];
      const matches = lines.filter((line) => line.text === which || line.text.includes(which));
      if (matches.length !== 1) return;
      const line = matches[0];
      const qa = [...(line.qa ?? [])];
      const open = qa.findLastIndex((entry) => !entry.a);
      // An answer with no question open is still kept, as the planner's note on the line.
      if (open === -1)
        qa.push({ q: "(no question)", at, a: answer.trim().slice(0, 4000), answeredAt: at });
      else qa[open] = { ...qa[open], a: answer.trim().slice(0, 4000), answeredAt: at };
      answered = line.text;
      doc.work[threadId] = {
        ...mine,
        plan: lines.map((entry) =>
          entry === line
            ? {
                ...entry,
                qa,
                ...(extra.how ? { how: extra.how.slice(0, 3000) } : {}),
                ...(extra.why ? { why: extra.why.slice(0, 600) } : {}),
              }
            : entry,
        ),
        updatedAt: at,
      };
    });
    if (!answered)
      fail(
        `No single line of your checklist matches "${which}": use more of its text (plan show lists them).`,
      );
    console.log(`Answered on "${answered}". Rigo sees it in that to-do on the Sprint page.`);
    return;
  }
  if (action !== "set" || !rest[0])
    fail(
      'Usage: node desk.mjs plan set <file.json | -> | plan show | plan answer "<line>" "<answer>"',
    );
  const raw =
    rest[0] === "-" ? NodeFS.readFileSync(0, "utf8") : NodeFS.readFileSync(rest[0], "utf8");
  let lines;
  try {
    lines = JSON.parse(raw);
  } catch (error) {
    fail(`The checklist isn't JSON: ${error.message}`);
  }
  if (!Array.isArray(lines)) fail("The checklist is a JSON array of { text, who, done, item }.");
  const needsDesk = lines.some(
    (line) =>
      (typeof line?.item === "string" && !/^https:/.test(line.item)) ||
      (Array.isArray(line?.links) && line.links.some((link) => !/^https:/.test(link))),
  );
  const deskItems = needsDesk ? ((await call("/fleet/desk")).body?.items ?? []) : [];
  const clean = lines
    .filter((line) => line && typeof line.text === "string" && line.text.trim())
    .slice(0, 40)
    .map((line) => ({
      text: line.text.trim().slice(0, 300),
      who:
        typeof line.who === "string" && line.who.trim() ? line.who.trim().slice(0, 40) : "agents",
      done: line.done === true,
      itemUrl:
        typeof line.item === "string"
          ? linkUrl(line.item, deskItems, '"item"')
          : (line.itemUrl ?? null),
      // Rigo's lines say why, how and where, so he can do them without asking.
      why: typeof line.why === "string" && line.why.trim() ? line.why.trim().slice(0, 600) : null,
      how: typeof line.how === "string" && line.how.trim() ? line.how.trim().slice(0, 3000) : null,
      links: (Array.isArray(line.links) ? line.links : [])
        .filter((link) => typeof link === "string")
        .slice(0, 8)
        .map((link) => linkUrl(link, deskItems, '"links"')),
      // The Do form (Board contract): what it unblocks, why only he can, the steps, the minutes.
      ...(typeof line.unblocks === "string" && line.unblocks.trim()
        ? { unblocks: line.unblocks.trim().slice(0, 300) }
        : {}),
      ...(ONLY_YOU.includes(line.onlyYou) ? { onlyYou: line.onlyYou } : {}),
      ...(Array.isArray(line.steps)
        ? {
            steps: line.steps.slice(0, 12).map((step) => ({
              text: typeof step?.text === "string" ? step.text.trim().slice(0, 300) : "",
              goTo:
                typeof step?.goTo === "string" && step.goTo.trim()
                  ? linkUrl(step.goTo.trim(), deskItems, '"goTo"')
                  : null,
              doneWhen:
                typeof step?.doneWhen === "string" && step.doneWhen.trim()
                  ? step.doneWhen.trim().slice(0, 300)
                  : null,
            })),
          }
        : {}),
      ...(Number.isFinite(line.minutes) && line.minutes > 0
        ? { minutes: Math.min(Math.round(line.minutes), 600) }
        : {}),
    }));
  // New to-dos for Rigo must be on the Do form; lines already on the list keep working as they are.
  const previous = new Set(
    (
      JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}").work?.[threadId]?.plan ??
      []
    ).map((line) => line.text),
  );
  const formProblems = clean
    .filter((line) => line.who === "you" && !line.done && !previous.has(line.text))
    .flatMap((line) => doFormProblems(line).map((problem) => `"${line.text}": ${problem}`));
  if (formProblems.length > 0) {
    await bounce(
      `Rigo's new to-dos aren't on the Do form (dev-desk SKILL, "Rigo's lines are his to-do list"):\n- ${formProblems.join("\n- ")}`,
    );
  }
  // His lines open their links beside the to-do; claude.ai pages refuse to show inside another page.
  const claudePages = clean.filter(
    (line) => line.who === "you" && line.links.some((link) => /claude\.ai\/.*artifact/.test(link)),
  );
  if (claudePages.length > 0) {
    await bounce(
      `Rigo's lines link claude.ai pages: ${claudePages.map((line) => `"${line.text}"`).join(", ")}. They can't open beside his to-do. Publish the page on the hub instead (t3-artifacts; a test sheet hands over as next "Rigo: test …"), then link the hub page.`,
    );
  }
  // Finished lines bury the open ones: keep the latest few (the sprint notes hold the rest).
  const doneLines = clean.filter((line) => line.done);
  if (doneLines.length > DONE_KEPT) {
    const dropped = new Set(doneLines.slice(DONE_KEPT));
    clean.splice(0, clean.length, ...clean.filter((line) => !dropped.has(line)));
    console.log(
      `Kept the first ${DONE_KEPT} done lines and dropped ${dropped.size} older ones; put anything worth keeping in the sprint notes.`,
    );
  }
  const thin = clean.filter(
    (line) => line.who === "you" && !line.done && !line.steps?.length && (!line.why || !line.how),
  );
  if (thin.length > 0) {
    console.log(
      `Rigo's lines not yet on the Do form: ${thin.map((line) => `"${line.text}"`).join(", ")}. Rewrite them on it (SKILL, "Rigo's lines are his to-do list") so he can do each without asking.`,
    );
  }
  await changeNotes((doc, at) => {
    const mine = doc.work[threadId] ?? { items: [], next: null };
    // Rigo's questions and when a line first appeared stay with it across rewrites (by its text).
    const before = new Map((mine.plan ?? []).map((line) => [line.text, line]));
    const plan = clean.map((line) => {
      const old = before.get(line.text);
      return {
        ...line,
        since: old?.since ?? (old ? (mine.planAt ?? at) : at),
        ...(old?.qa?.length ? { qa: old.qa } : {}),
        ...(old?.helper ? { helper: old.helper } : {}),
      };
    });
    doc.work[threadId] = { ...mine, plan, planAt: at, updatedAt: at };
  });
  console.log(
    `Checklist saved: ${clean.length} lines, ${clean.filter((line) => !line.done).length} open.`,
  );
  // What the audit finds on this app, every time: the checks no prompt has to carry.
  const app = (await call("/fleet/desknotes").then((r) => JSON.parse(r.body?.document ?? "{}")))
    .work?.[threadId]?.app;
  if (app) await audit(app, { quiet: true });
}

/**
 * `audit [app]`: what's off on the Desk against these rules (the hub's checks, also on the
 * Board's Health tab): items, planners, Rigo's to-dos, story leads, helpers and decisions.
 */
async function audit(given, { quiet = false } = {}) {
  const result = (await call("/fleet/desk/audit")).body ?? {};
  const desk = given ? (await call("/fleet/desk")).body : null;
  const app = given ? resolveApp(desk, given) : null;
  const findings = (result.findings ?? []).filter((entry) => !app || entry.app === app);
  if (findings.length === 0) {
    if (!quiet) console.log(app ? `Audit: nothing off on ${app}.` : "Audit: nothing off.");
    return;
  }
  console.log(
    `Audit${app ? ` of ${app}` : ""}: ${findings.length} to fix (also on the Board's Health tab).`,
  );
  const byKind = new Map();
  for (const entry of findings) byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry]);
  for (const [kind, entries] of byKind) {
    console.log(`## ${kind} (${entries.length})`);
    for (const entry of entries.slice(0, quiet ? 8 : 200)) {
      const where = entry.url?.match(/\/([^/]+)\/(?:issues|pull)\/(\d+)/);
      console.log(
        `- ${where ? `${where[1]}#${where[2]} ` : ""}${entry.rule}${entry.detail ? `: ${entry.detail.slice(0, 90)}` : ""} → ${entry.fix}${!app && entry.app ? ` [${entry.app}]` : ""}`,
      );
    }
    if (quiet && entries.length > 8)
      console.log(`- … ${entries.length - 8} more: node desk.mjs audit "${app}"`);
  }
}

/**
 * `option Feature "<App> · <feature>" [--description "<one line>"]`: adds a Feature to the
 * project. The hub keeps every existing option's id, so no item loses its Feature.
 */
async function option(field, rest) {
  const [name, ...more] = rest;
  if (field !== "Feature" || !name?.trim())
    fail('Usage: node desk.mjs option Feature "<App> · <feature>" [--description "<one line>"]');
  if (!name.includes(" · "))
    fail('Name a Feature "<App> · <feature>", e.g. "Precon · Daily reporting".');
  const { status, body } = await call(`/fleet/desk/fields/${encodeURIComponent(field)}/options`, {
    method: "POST",
    body: JSON.stringify({ name: name.trim(), description: flags(more).description ?? "" }),
  });
  if (status !== 200) fail(body?.error ?? `The hub said ${status}.`);
  console.log(
    body.added
      ? `Added Feature "${body.option}". File items under it with: node desk.mjs field <repo#n> Feature "${body.option}"`
      : `Feature "${body.option}" already exists.`,
  );
}

/** `field <issue url | repo#n> <Field> "<value>"`: sets one of an item's project fields. */
async function field(ref, rest) {
  const [name, ...words] = rest;
  const value = words.join(" ").trim();
  if (!ref || !name || !value)
    fail(
      'Usage: node desk.mjs field <issue url | repo#n> <App|Status|Priority|Stage|Work type|Feature|Sprint> "<value>"',
    );
  const items = (await call("/fleet/desk")).body?.items ?? [];
  const url = linkUrl(ref, items, "Item");
  const item = items.find((entry) => entry.url === url);
  if (!item?.itemId) fail(`${ref} isn't on the project.`);
  const { status, body } = await call(`/fleet/desk/items/${item.itemId}/fields`, {
    method: "POST",
    body: JSON.stringify({ field: name, value }),
  });
  if (status !== 200) fail(body?.error ?? `The hub said ${status}.`);
  console.log(`${ref}: ${name} is now "${value}".`);
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

/**
 * `feedback`: Rigo's Board feedback still waiting for a fix batch, oldest first.
 * `feedback done <id> "<what changed>"`: record how one was handled, so it leaves the list.
 */
async function feedback(sub, rest) {
  const waiting = (note) =>
    note.source === "Board feedback" && note.result?.label?.startsWith("Kept for");
  if (sub === "done") {
    const [id, ...words] = rest;
    const what = words.join(" ").trim();
    if (!id || !what) fail('Usage: node desk.mjs feedback done <id> "<what changed>"');
    await changeNotes((doc, at) => {
      const note = doc.inbox?.[id];
      if (!note || note.source !== "Board feedback") fail(`No Board feedback ${id}.`);
      doc.inbox[id] = { ...note, result: { url: null, label: what.slice(0, 300) }, updatedAt: at };
    });
    console.log(`Recorded: ${id} → ${what}`);
    return;
  }
  const doc = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
  const notes = Object.values(doc.inbox ?? {})
    .filter(waiting)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (notes.length === 0) {
    console.log("No Board feedback waiting.");
    return;
  }
  for (const note of notes) {
    console.log(`## ${note.id} · ${note.createdAt.slice(0, 16)}`);
    console.log(note.text);
    console.log("");
  }
}

/**
 * `propose <id> <comment|new|planner|dismiss> [--item url] [--repo o/r] [--app a] [--type t]
 * [--priority p] [--title t] [--sprint s] [--feature f] [--story "As …"] [--criteria "a|b|c"] --reason r`
 */
async function propose(id, action, options) {
  const actions = ["comment", "new", "planner", "dismiss"];
  if (!id || !actions.includes(action)) {
    fail(
      `Usage: node desk.mjs propose <note id> <${actions.join("|")}> [--item <url>] [--repo <owner/repo>] [--app "<app>"] [--type <type>] [--priority <P0-P3>] [--title "<title>"] [--sprint "<sprint>"] [--feature "<feature>"] [--story "As <who>, I can <what>, so that <why>."] [--criteria "<one>|<two>"] --reason "<why>"`,
    );
  }
  const given = flags(options);
  if (action === "comment" && !/^https:\/\/github\.com\//.test(given.item ?? ""))
    fail("comment needs --item <issue or PR url>.");
  if (action === "new" && (!given.repo || !given.title)) fail("new needs --repo and --title.");
  const criteria = (given.criteria ?? "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (action === "new" && given.feature) {
    // Check the feature against the project's options, so filing doesn't drop it.
    const desk = (await call("/fleet/desk")).body ?? {};
    const app = given.app ?? null;
    const known = (desk.options?.Feature ?? []).filter(
      (name) => !app || name.startsWith(`${app} · `),
    );
    const full = given.feature.includes(" · ") ? given.feature : `${app} · ${given.feature}`;
    if (known.length && !known.includes(full)) {
      console.log(
        `"${full}" isn't a Feature on the project yet; the item will be filed without it. Known for ${app ?? "this app"}: ${known.map((name) => name.split(" · ").slice(1).join(" · ")).join(", ")}.`,
      );
    }
  }
  if (action === "new" && given.type === "Story" && criteria.length === 0) {
    console.log("A Story needs --criteria a test sheet can check, so it lands ready to build.");
  }
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
        feature: given.feature ?? null,
        story: given.story ?? null,
        criteria,
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
/** Done lines a checklist keeps; older ones go (the sprint notes hold what matters). */
const DONE_KEPT = 10;

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

/** How long a planner gets between automatic updates; reports in between wait and go together. */
const UPDATE_EVERY_MS = 3 * 60_000;

/** The planner a chat reports to: a helper's parent, else its app's planner. */
function plannerOf(doc, desk, threadId) {
  const work = doc.work?.[threadId];
  if (!work) return null;
  if (work.role === "helper" && work.parent) {
    const parent = doc.work?.[work.parent];
    if (parent?.role === "planner") return work.parent;
    return parent ? plannerOf(doc, desk, work.parent) : null;
  }
  const open = (work.items ?? []).findLast((span) => span.until === null);
  const app = work.app ?? desk.items?.find((item) => item.url === open?.url)?.app ?? null;
  if (!app) return null;
  const planners = Object.entries(doc.work ?? {})
    .filter(([, entry]) => entry.role === "planner" && entry.app === app)
    .sort(([, a], [, b]) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return planners[0]?.[0] ?? null;
}

/** The last thing the chat said, from the hook's input or the end of its transcript. */
function lastMessage(input) {
  if (typeof input.last_assistant_message === "string") return input.last_assistant_message;
  try {
    const raw = NodeFS.readFileSync(input.transcript_path, "utf8").slice(-400_000);
    for (const line of raw.trim().split("\n").reverse()) {
      try {
        const entry = JSON.parse(line);
        const content = entry.message?.content;
        if (entry.type !== "assistant" || !Array.isArray(content)) continue;
        const text = content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        if (text.trim()) return text;
      } catch {}
    }
  } catch {}
  return "";
}

/** One planner's waiting reports as one message. */
function digestFor(doc, desk, plannerId) {
  const byUrl = new Map((desk.items ?? []).map((item) => [item.url, item]));
  const waiting = Object.entries(doc.work ?? {}).filter(
    ([threadId, work]) =>
      work.report && !work.report.sentAt && plannerOf(doc, desk, threadId) === plannerId,
  );
  if (waiting.length === 0) return null;
  const parts = waiting.map(([threadId, work]) => {
    const open = (work.items ?? []).findLast((span) => span.until === null);
    const item = open ? byUrl.get(open.url) : null;
    const name = item
      ? `${item.repo?.split("/").pop()}#${item.number} ${item.title}`
      : `chat ${threadId}`;
    return [
      `### ${name} (${work.role ?? "work"} chat ${threadId}, ${work.report.at.slice(11, 16)} UTC)`,
      `Next: ${work.next ?? "not set"}`,
      `Said: ${work.report.text}`,
    ].join("\n");
  });
  return {
    threadIds: waiting.map(([threadId]) => threadId),
    message: [
      `[Desk update] ${waiting.length === 1 ? "A chat you run" : `${waiting.length} chats you run`} finished a turn:`,
      "",
      parts.join("\n\n"),
      "",
      "Update your checklist (plan set) if the picture changed, and act on anything that needs you. Don't reply to the chat unless it needs something. Reply here in one line, or not at all.",
    ].join("\n"),
  };
}

/**
 * `report --hook`: the Stop hook every Claude chat on a fleet machine runs at the end of a turn
 * (install-client.sh adds it). A work chat or helper's turn is recorded on the Desk for its
 * planner and sent to it, so the planner hears without the chat remembering to tell it. Returns
 * at once; the work happens in a detached process. Never fails the turn.
 */
async function reportHook() {
  if (!process.env.T3CODE_THREAD_ID) return;
  let input = {};
  try {
    input = JSON.parse(NodeFS.readFileSync(0, "utf8") || "{}");
  } catch {}
  if (input.stop_hook_active) return;
  const file = NodePath.join(NodeOS.tmpdir(), `desk-report-${process.pid}-${Date.now()}.json`);
  NodeFS.writeFileSync(file, JSON.stringify({ message: lastMessage(input) }));
  NodeChildProcess.spawn(process.execPath, [process.argv[1], "report", "--from", file], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  }).unref();
}

/** `report --from <file>` (from the hook) or `report deliver`: record this turn, then deliver. */
async function report(options) {
  const given = flags(options);
  const threadId = thisThread();
  let said = "";
  if (given.from) {
    try {
      said = JSON.parse(NodeFS.readFileSync(given.from, "utf8")).message ?? "";
      NodeFS.rmSync(given.from, { force: true });
    } catch {}
  }
  // Only chats on the Desk as work chats or helpers report; everything else stops here, cheaply.
  const before = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
  const role = before.work?.[threadId]?.role;
  if (role !== "work" && role !== "helper") return;
  const desk = (await call("/fleet/desk")).body ?? {};
  const plannerId = plannerOf(before, desk, threadId);
  if (!plannerId) return;
  const text = said.replace(/\s+/g, " ").trim().slice(0, 700) || "(no message)";
  await changeNotes((doc, at) => {
    // updatedAt moves too: the Board merges each chat's entry by it and would keep a stale copy.
    if (doc.work[threadId])
      doc.work[threadId] = {
        ...doc.work[threadId],
        report: { at, text, sentAt: null },
        updatedAt: at,
      };
  });
  const doc = JSON.parse((await call("/fleet/desknotes")).body?.document ?? "{}");
  const last = Date.parse(doc.work?.[plannerId]?.updatesSentAt ?? "") || 0;
  if (Date.now() - last < UPDATE_EVERY_MS) return; // the next turn, or the Board, sends it
  const digest = digestFor(doc, desk, plannerId);
  if (!digest) return;
  const sent = NodeChildProcess.spawnSync("t3", ["thread", "send", plannerId, "-"], {
    input: digest.message,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PATH: `${process.env.PATH}:${NodeOS.homedir()}/.local/bin` },
  });
  // A planner on another machine isn't reachable from here: the Board delivers it instead.
  if (sent.status !== 0) return;
  await changeNotes((next, at) => {
    for (const id of digest.threadIds) {
      if (next.work[id]?.report)
        next.work[id] = {
          ...next.work[id],
          report: { ...next.work[id].report, sentAt: at },
          updatedAt: at,
        };
    }
    if (next.work[plannerId])
      next.work[plannerId] = { ...next.work[plannerId], updatesSentAt: at, updatedAt: at };
  });
}

const [command, first, ...rest] = process.argv.slice(2);
if (command === "context") await context(first);
else if (command === "note") await note(first, rest.join(" "));
else if (command === "focus") await focus(first, rest);
else if (command === "next") await nextStep([first, ...rest].join(" "));
else if (command === "inbox") await inbox();
else if (command === "feedback") await feedback(first, rest);
else if (command === "role") await role(first, rest);
else if (command === "decide") await decide(first, rest);
else if (command === "decisions") await decisions(first);
else if (command === "retire") await retire(first, rest);
else if (command === "plan") await plan(first, rest);
else if (command === "option") await option(first, rest);
else if (command === "field") await field(first, rest);
else if (command === "agents") await agents(first);
else if (command === "audit") await audit(first);
else if (command === "propose") await propose(first, rest[0], rest.slice(1));
else if (command === "capture") await capture(first, rest);
else if (command === "report" && first === "--hook") await reportHook().catch(() => {});
else if (command === "report") await report([first, ...rest]);
else
  fail(
    'Usage: node desk.mjs context [app or repo] | note <app or repo> "<text>" | focus <item> [--thread <id>] | next "<text>" | inbox | feedback [done <id> "<what>"] | propose <id> <action> … | capture "<text>" | role <level> … | agents [app] | audit [app] | decide "<question>" … | decisions [app] | retire <id> "<why>" | plan set|show',
  );
