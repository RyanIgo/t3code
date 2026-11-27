/**
 * Fleet hub: the Desk audit. Checks every item, planner, to-do and decision against the dev-desk
 * rules, and works out the tidying the hub does itself so no agent has to remember it.
 * Pure: takes the Desk view and the desk notes, returns findings and changes.
 */

const DAY = 86_400_000;
const RIGO_VERBS = new Set(["review", "test", "merge", "do"]);
const QUICK_FIX = new Set(["Bug", "Maintenance"]);
const TESTY = /\b(test sheet|re-?test)\b/i;

function days(at, now) {
  const ms = Date.parse(at ?? "");
  return Number.isFinite(ms) ? (now - ms) / DAY : null;
}

export function refOf(url) {
  const match = String(url ?? "").match(/github\.com\/[^/]+\/([^/]+)\/(?:issues|pull)\/(\d+)/);
  return match ? `${match[1]}#${match[2]}` : null;
}

function openSpan(work) {
  return (work.items ?? []).findLast((span) => span.until === null)?.url ?? null;
}

/** The app each repo's items carry, when (nearly) all of them agree: for items with none set. */
export function repoApps(items) {
  const counts = new Map();
  for (const item of items) {
    if (!item.app || !item.repo) continue;
    const byApp = counts.get(item.repo) ?? new Map();
    byApp.set(item.app, (byApp.get(item.app) ?? 0) + 1);
    counts.set(item.repo, byApp);
  }
  const apps = new Map();
  for (const [repo, byApp] of counts) {
    const total = [...byApp.values()].reduce((sum, count) => sum + count, 0);
    const [app, count] = [...byApp].toSorted((a, b) => b[1] - a[1])[0];
    if (count / total >= 0.9) apps.set(repo, app);
  }
  return apps;
}

/** Field changes the hub makes itself: an app from the repo, In Progress once a chat leads it. */
export function tidyChanges(view, notes) {
  const items = view.items ?? [];
  const apps = repoApps(items);
  const led = new Set(
    Object.values(notes?.work ?? {})
      .filter((work) => work.role !== "planner" && work.role !== "helper")
      .map(openSpan)
      .filter(Boolean),
  );
  const changes = [];
  for (const item of items) {
    if (item.state !== "open") {
      if (item.status && item.status !== "Done") {
        changes.push({ itemId: item.itemId, field: "Status", value: "Done", url: item.url });
      }
      continue;
    }
    if (!item.app && apps.has(item.repo)) {
      changes.push({
        itemId: item.itemId,
        field: "App",
        value: apps.get(item.repo),
        url: item.url,
      });
    }
    if (item.status === "Todo" && led.has(item.url)) {
      changes.push({ itemId: item.itemId, field: "Status", value: "In Progress", url: item.url });
    }
  }
  return changes;
}

/**
 * Every rule break, as { kind, app, rule, detail, url?, threadId?, fix }. `kind` is the type
 * audited (Item, Planner, To-do, Story lead, Quick fix, Helper, Decision); `fix` says who fixes it.
 */
export function auditDesk(view, notes, now = Date.now()) {
  const items = view.items ?? [];
  const byUrl = new Map(items.map((item) => [item.url, item]));
  const work = notes?.work ?? {};
  const findings = [];
  const add = (finding) => findings.push({ app: null, detail: "", ...finding });

  const sprints = (view.sprints ?? []).map((sprint) => ({
    ...sprint,
    end: Date.parse(sprint.startDate) + sprint.duration * DAY,
  }));
  const current = sprints.find((sprint) => Date.parse(sprint.startDate) <= now && now < sprint.end);
  const upcoming = sprints
    .filter((sprint) => Date.parse(sprint.startDate) > now)
    .toSorted((a, b) => a.end - b.end)[0];
  const live = new Set([current?.title, upcoming?.title].filter(Boolean));

  // Planners: one per app that has sprint work.
  const planners = new Map();
  for (const [threadId, entry] of Object.entries(work)) {
    if (entry.role !== "planner") continue;
    planners.set(entry.app, [...(planners.get(entry.app) ?? []), threadId]);
  }
  const sprintApps = new Set(
    items
      .filter((item) => item.state === "open" && live.has(item.sprint?.title) && item.app)
      .map((item) => item.app),
  );
  for (const app of [...sprintApps].toSorted()) {
    if (!planners.has(app)) {
      add({
        kind: "Planner",
        app,
        rule: "No planner for an app with sprint work",
        fix: "Rigo: start a planner for it, or hand it to another app's planner",
      });
    }
  }
  for (const [app, ids] of planners) {
    if (ids.length > 1) {
      add({
        kind: "Planner",
        app,
        rule: `${ids.length} planners for one app`,
        threadId: ids[0],
        fix: "Keep one; make the others helpers",
      });
    }
  }

  const ledBy = new Map();
  for (const [threadId, entry] of Object.entries(work)) {
    const url = openSpan(entry);
    const item = url ? byUrl.get(url) : null;
    const app = entry.app ?? item?.app ?? null;
    const next = typeof entry.next === "string" ? entry.next : null;

    if (entry.role === "planner") {
      const plan = entry.plan ?? [];
      if (plan.length === 0) {
        add({
          kind: "Planner",
          app,
          threadId,
          rule: "No checklist",
          fix: "Planner: plan set",
        });
      } else if ((days(entry.planAt ?? entry.updatedAt, now) ?? 0) > 2) {
        add({
          kind: "Planner",
          app,
          threadId,
          rule: `Checklist not updated in ${Math.floor(days(entry.planAt ?? entry.updatedAt, now))} days`,
          fix: "Planner: plan set",
        });
      }
      if (next && /^waiting\b/i.test(next)) {
        add({
          kind: "Planner",
          app,
          threadId,
          rule: "Parked on waiting",
          detail: next,
          fix: "Planner: chase it or say whose move it is",
        });
      }
      for (const line of plan) {
        if (line.done || line.who !== "you") continue;
        const base = {
          kind: "To-do",
          app,
          threadId,
          detail: line.text,
          url: line.itemUrl ?? undefined,
        };
        if (!line.why || !line.how) {
          add({ ...base, rule: "No why or no steps", fix: "Planner: add why and how" });
        }
        if ((line.links ?? []).some((link) => /claude\.ai\//.test(link))) {
          add({
            ...base,
            rule: "Links a claude.ai page",
            fix: "Planner: publish it on the hub (t3-artifacts)",
          });
        }
        if (TESTY.test(line.text)) {
          add({
            ...base,
            rule: "A test sent as a to-do",
            fix: 'Planner: hub test sheet and next "Rigo: test …"',
          });
        }
        const waited = days(line.since, now);
        if (waited !== null && waited > 2) {
          add({
            ...base,
            rule: `Waiting ${Math.floor(waited)} days`,
            fix: "Planner: is it unclear, not ready, or not his?",
          });
        }
      }
      continue;
    }

    if (entry.role === "helper") {
      if (!entry.parent || !work[entry.parent]) {
        add({
          kind: "Helper",
          app,
          threadId,
          rule: "Helper with no parent chat",
          fix: "Settle it",
        });
      }
      continue;
    }

    if (!url || !item) continue;
    ledBy.set(url, [...(ledBy.get(url) ?? []), threadId]);
    if (item.state !== "open" || item.status === "Done") continue;
    const kind = QUICK_FIX.has(item.workType ?? "") ? "Quick fix" : "Story lead";
    const base = { kind, app, threadId, url, detail: item.title };
    if (!next) {
      add({
        ...base,
        rule: "No whose-move line",
        fix: 'Lead: next "Rigo: <verb> …" or what agents are on',
      });
    } else if (/^Rigo:/.test(next)) {
      const verb = next
        .slice(5)
        .trim()
        .split(/\s/)[0]
        ?.toLowerCase()
        .replace(/[^a-z-]/g, "");
      if (!RIGO_VERBS.has(verb)) {
        add({
          ...base,
          rule: `"Rigo: ${verb}" isn't review, test, merge or do`,
          detail: next,
          fix: "Lead: rewrite the next line",
        });
      }
    }
    const quiet = days(entry.updatedAt, now);
    if (quiet !== null && quiet > 3) {
      add({
        ...base,
        rule: `Quiet ${Math.floor(quiet)} days on an open item`,
        fix: "Planner: nudge or settle",
      });
    }
  }
  for (const [url, ids] of ledBy) {
    const item = byUrl.get(url);
    if (ids.length > 1 && item?.state === "open" && item.status !== "Done") {
      add({
        kind: "Story lead",
        app: item.app,
        url,
        threadId: ids[0],
        rule: `${ids.length} chats leading one item`,
        detail: item.title,
        fix: "Keep one lead; settle the others",
      });
    }
  }

  // Items.
  const apps = repoApps(items);
  for (const item of items) {
    const base = { kind: "Item", app: item.app, url: item.url, detail: item.title };
    if (item.state !== "open") {
      if (item.status && item.status !== "Done") {
        add({ ...base, rule: `Closed on GitHub but ${item.status}`, fix: "Hub marks it Done" });
      }
      continue;
    }
    if (!item.app && !apps.has(item.repo)) {
      add({ ...base, rule: "No app (its repo spans apps)", fix: "Rigo or planner: pick the app" });
    }
    if (item.status === "Done") {
      add({
        ...base,
        rule: "Done but still open on GitHub",
        fix: "Lead: close it, or move it back",
      });
    }
    const sprint = item.sprint?.title;
    if (!live.has(sprint) || item.kind !== "issue") continue;
    if (!item.feature)
      add({ ...base, rule: `${sprint}: no Feature`, fix: "Planner: desk.mjs field" });
    if (!item.priority)
      add({ ...base, rule: `${sprint}: no priority`, fix: "Planner: desk.mjs field" });
    if (!item.plain)
      add({ ...base, rule: `${sprint}: no plain words`, fix: "Planner: plain words" });
    if (
      current &&
      sprint === current.title &&
      current.end - now < 3 * DAY &&
      item.status !== "Done"
    ) {
      add({
        ...base,
        rule: `${sprint} ends ${new Date(current.end).toISOString().slice(0, 10)}, not done`,
        fix: "Planner: one carry-over card for Rigo (carry or drop)",
      });
    }
  }

  // Decisions.
  for (const [id, decision] of Object.entries(notes?.decisions ?? {})) {
    if (decision.answer) continue;
    const base = {
      kind: "Decision",
      app: decision.app,
      detail: decision.question,
      url: decision.itemUrl ?? undefined,
      threadId: decision.threadId,
    };
    const waited = days(decision.createdAt, now);
    if (waited !== null && waited > 2) {
      add({
        ...base,
        rule: `Unanswered ${Math.floor(waited)} days`,
        fix: `Rigo: answer, or planner: retire ${id}`,
      });
    }
    if (!decision.context)
      add({ ...base, rule: "No background", fix: "Planner: decide --id with context" });
    const item = decision.itemUrl ? byUrl.get(decision.itemUrl) : null;
    if (item && item.state !== "open") {
      add({ ...base, rule: "About an item already closed", fix: `Planner: retire ${id}` });
    }
  }
  return findings;
}
