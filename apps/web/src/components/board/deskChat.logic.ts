/**
 * Fleet fork: what a chat started from the Dev Desk is told. The opening message says what Rigo
 * is working on, gives a snapshot of the work so the chat is useful even without tools, and
 * tells the agent how to build more context from what it can reach. Pure logic only.
 */
import {
  type DeskItem,
  type DeskSprint,
  deskRef,
  deskTitle,
  featureName,
  groupWork,
  sprintOverview,
  waitingOnYou,
} from "./desk.logic";
import { ALL_APPS, type DeskChatLink, type DeskNotes, todayChatTitle } from "./deskNotes.logic";

export type DeskChatContext =
  | {
      readonly kind: "app";
      readonly app: string;
      readonly view: "overview" | "board" | "sprint" | "prs";
      readonly feature: string | null;
    }
  | { readonly kind: "sprint"; readonly sprint: DeskSprint; readonly app: string | null }
  | { readonly kind: "item"; readonly item: DeskItem }
  /** The day's planning chat: what to work on first, across every app. */
  | { readonly kind: "today"; readonly day: string }
  /** A triage chat that proposes where each inbox note goes. */
  | { readonly kind: "inbox"; readonly count: number };

const SNAPSHOT_LIMIT = 12;

/** One line naming what the chat is about, e.g. "Precon · Board" or "Sprint 1 · Precon". */
export function contextLabel(context: DeskChatContext): string {
  if (context.kind === "today") return todayChatTitle(context.day);
  if (context.kind === "inbox") return "Sort the inbox";
  if (context.kind === "item")
    return `${deskRef(context.item) ?? "Item"}: ${deskTitle(context.item)}`;
  if (context.kind === "sprint") {
    return context.app ? `${context.sprint.title} · ${context.app}` : context.sprint.title;
  }
  const view = { overview: "Overview", board: "Plan", sprint: "Sprint", prs: "PRs" }[context.view];
  return context.feature
    ? `${context.app} · ${featureName(context.feature)}`
    : `${context.app} · ${view}`;
}

/** The app a context belongs to, for picking a project and linking the chat. */
function contextApp(context: DeskChatContext): string | null {
  if (context.kind === "item") return context.item.app;
  if (context.kind === "today" || context.kind === "inbox") return null;
  return context.app;
}

export function contextLink(
  context: DeskChatContext,
  sprint: DeskSprint | null,
): Omit<DeskChatLink, "updatedAt"> {
  return {
    kind: context.kind === "inbox" ? "app" : context.kind,
    view: context.kind === "app" ? context.view : null,
    feature: context.kind === "app" ? context.feature : null,
    app: contextApp(context),
    sprint: context.kind === "sprint" ? context.sprint.title : (sprint?.title ?? null),
    itemUrl: context.kind === "item" ? context.item.url : null,
    about: contextLabel(context),
    ...(context.kind === "today" ? { day: context.day } : {}),
  };
}

const line = (item: DeskItem) =>
  `- ${deskRef(item) ?? "item"} ${deskTitle(item)}${item.lane ? ` [${item.lane}]` : ""}${
    item.status && item.status !== "Todo" ? ` (${item.status})` : ""
  }`;

function snapshot(title: string, list: ReadonlyArray<DeskItem>): string[] {
  if (list.length === 0) return [];
  const shown = list.slice(0, SNAPSHOT_LIMIT).map(line);
  if (list.length > shown.length) shown.push(`- …and ${list.length - shown.length} more`);
  return [`${title}:`, ...shown];
}

/** Where a Desk link points, as the `#desk=…` fragment the Desk opens on. */
export function deskFragment(
  link: Pick<DeskChatLink, "kind" | "view" | "feature" | "app" | "sprint" | "itemUrl">,
): string {
  const params = new URLSearchParams({ desk: link.kind });
  if (link.kind === "today") return params.toString();
  if (link.kind === "item" && link.itemUrl) params.set("url", link.itemUrl);
  if (link.app) params.set("app", link.app);
  if (link.kind === "app" && link.view) params.set("view", link.view);
  if (link.kind === "app" && link.feature) params.set("feature", link.feature);
  if (link.kind === "sprint" && link.sprint) params.set("sprint", link.sprint);
  return params.toString();
}

export type DeskTarget =
  | {
      readonly kind: "app";
      readonly app: string;
      readonly view: "overview" | "board" | "sprint" | "prs";
      readonly feature: string | null;
    }
  | { readonly kind: "sprint"; readonly sprint: string; readonly app: string | null }
  | {
      readonly kind: "item";
      readonly url: string;
      /** The item window's tab to open on, when the link names one. */
      readonly tab?: "details" | "chats" | "review";
    }
  | { readonly kind: "today" }
  /** The Test page for one hub test sheet. */
  | { readonly kind: "test"; readonly sheet: string };

/** Reads a `#desk=…` fragment back into the place on the Desk it names. */
export function readDeskFragment(fragment: string): DeskTarget | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const kind = params.get("desk");
  const app = params.get("app");
  if (kind === "today") return { kind };
  if (kind === "test") {
    const sheet = params.get("sheet");
    return sheet && /^[\w-]{6,40}$/.test(sheet) ? { kind, sheet } : null;
  }
  if (kind === "item") {
    const url = params.get("url");
    const tab = params.get("tab");
    if (!url || !url.startsWith("https://github.com/")) return null;
    return tab === "details" || tab === "chats" || tab === "review"
      ? { kind, url, tab }
      : { kind, url };
  }
  if (kind === "sprint") {
    const sprint = params.get("sprint");
    return sprint ? { kind, sprint, app } : null;
  }
  if (kind === "app" && app) {
    const view = params.get("view");
    return {
      kind,
      app,
      view: view === "board" || view === "sprint" || view === "prs" ? view : "overview",
      feature: params.get("feature"),
    };
  }
  return null;
}

/** The chat's opening message: what Rigo is on, a snapshot, and how to build context. */
const DIRECTION_SECTIONS = [
  ["direction", "Direction"],
  ["goals", "Goals"],
  ["questions", "Open questions"],
] as const;

/** The app's direction and how Rigo steers, as kept on the Board, for a chat's first message. */
function directionLines(notes: DeskNotes, app: string | null): string[] {
  const lines: string[] = [];
  const add = (label: string, text: string | undefined) => {
    if (text?.trim()) lines.push("", `## ${label}`, text.trim());
  };
  if (app) {
    for (const [id, label] of DIRECTION_SECTIONS) {
      add(`${app}: ${label}`, notes.directions[app]?.[id]?.text);
    }
  }
  add("How I steer (every application)", notes.directions[ALL_APPS]?.loop?.text);
  return lines;
}

export function buildChatPrompt(input: {
  readonly context: DeskChatContext;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly sprint: DeskSprint | null;
  /** The Desk's address, to link back to where the chat came from. */
  readonly deskUrl?: string;
}): string {
  const { context, items, notes, sprint } = input;
  const app = contextApp(context);
  const lines: string[] = [];
  const contextCommand = `node ~/.claude/skills/dev-desk/desk.mjs context ${JSON.stringify(app ?? "")}`;

  if (context.kind === "today") return todayPrompt(input, context.day);
  if (context.kind === "inbox") return inboxPrompt();

  if (context.kind === "item") {
    const item = context.item;
    lines.push(
      `I'm working on ${deskRef(item) ?? "this item"} from the Dev Desk: ${deskTitle(item)}.`,
      [
        app ? `App: ${app}` : null,
        item.feature ? `Feature: ${featureName(item.feature)}` : null,
        item.sprint ? `Sprint: ${item.sprint.title}` : null,
        item.status ? `Status: ${item.status}` : null,
        item.lane === "Blocked" ? "Blocked" : null,
        item.priority ? `Priority: ${item.priority}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    if (item.plain?.where) lines.push(`Where it stands: ${item.plain.where}`);
  } else if (context.kind === "sprint") {
    const overview = sprintOverview(
      items,
      context.sprint,
      context.app
        ? [context.app]
        : [...new Set(items.flatMap((item) => (item.app ? [item.app] : [])))],
      context.app === null,
    );
    const all = context.app
      ? (overview.apps[0]?.items ?? [])
      : items.filter(
          (item) => item.sprint?.title === context.sprint.title && item.workType !== "Tracking",
        );
    lines.push(
      `I'm working on ${context.sprint.title}${context.app ? ` for ${context.app}` : ""} from the Dev Desk (from ${context.sprint.startDate}, ${context.sprint.duration} days).`,
    );
    const notesText = notes.sprintNotes[context.sprint.title]?.text;
    if (notesText) lines.push(`Sprint notes: ${notesText}`);
    if (context.app) {
      const goal = notes.sprintGoals[context.sprint.title]?.[context.app]?.text;
      if (goal) lines.push(`Goal for ${context.app}: ${goal}`);
    }
    lines.push("", ...snapshot("In the sprint", all));
  } else {
    const work = groupWork(
      items,
      (item) =>
        item.app === context.app && (context.feature === null || item.feature === context.feature),
      sprint,
    );
    lines.push(`I'm working on ${contextLabel(context)} from the Dev Desk.`);
    const goal = sprint ? notes.sprintGoals[sprint.title]?.[context.app]?.text : null;
    if (goal) lines.push(`${sprint?.title} goal: ${goal}`);
    lines.push(
      "",
      ...snapshot(sprint ? `In ${sprint.title}` : "This sprint", work.sprint),
      ...snapshot("Blocked", work.blocked),
      ...snapshot(
        "Next up",
        work.open.filter((item) => item.lane === "Now" || item.lane === "Next"),
      ),
    );
  }

  lines.push(...directionLines(notes, app));
  lines.push(
    "",
    "Before anything else, build your context from what you can reach:",
    `1. Run \`${contextCommand}\` for the app's full direction, notes for agents, sprint goal and features (the dev-desk skill). If it isn't installed, use what's above.`,
    context.kind === "item" && context.item.repo && context.item.number !== null
      ? `2. Read the issue and its comments: \`gh issue view ${context.item.number} --repo ${context.item.repo} --comments\`, and any linked PRs.`
      : "2. Read the issues above that matter most (`gh issue view <n> --repo <owner/repo> --comments`).",
    "3. Search other T3 chats for these issue numbers before starting, so we don't duplicate work in progress.",
    "4. Follow the app's direction, its notes for agents and how I steer; say so in one line if what I ask conflicts with them.",
    "",
    "Then tell me in three short lines where this stands, and ask what I want to do first. Record decisions with `desk.mjs note`.",
  );
  if (input.deskUrl) {
    lines.push(
      "",
      `From the Dev Desk: [${contextLabel(context)}](${input.deskUrl}#${deskFragment(contextLink(context, sprint))})`,
    );
  }
  return lines.join("\n");
}

/** The triage chat's opening message: propose a route for each new inbox note, file nothing. */
function inboxPrompt(): string {
  const desk = "node ~/.claude/skills/dev-desk/desk.mjs";
  return [
    "Sort my Dev Desk inbox: quick notes I took from email, meetings and hallway asks.",
    "",
    `1. Run \`${desk} inbox\` to list the notes waiting for triage.`,
    `2. For each note, find where it belongs. Read the app's direction and open work (\`${desk} context <app>\`) and search existing issues (\`gh issue list --repo <owner/repo> --search "<words>" --state all\`) so nothing is filed twice.`,
    "3. Propose one route per note, then move on. Don't file, comment or change anything on GitHub yourself: I approve each one on the Board.",
    `   - Adds to an existing item: \`${desk} propose <id> comment --item <issue or PR url> --reason "<why>"\``,
    `   - A new item: \`${desk} propose <id> new --repo <owner/repo> --app "<app>" --type Bug|Story|Maintenance|Research|Support --priority P0|P1|P2|P3 --title "<plain title, what changes for the people who use it>" --feature "<one of the app's features>" --story "As <who>, I can <what>, so that <why>." --criteria "<checkable outcome>|<another>" --reason "<why>"\``,
    "     Give every new item its feature (the app's features are listed by context), and every Story a user story and acceptance criteria a test sheet can check, so it lands ready to build.",
    `   - Bigger than one item (a goal, a change of direction): \`${desk} propose <id> planner --app "<app>" --reason "<why>"\``,
    `   - Not development work: \`${desk} propose <id> dismiss --reason "<why>"\``,
    "4. Priority follows the app's direction and goals: P0 only for something broken for people now or blocking a goal date.",
    '5. Notes from a "User session" (what a user said while using the app) go first: they steer work under way, so propose them at P1 or higher, with the item they change, and say "expedite" in the reason.',
    "",
    "Then give me a short table: note · route · why, and flag any note you weren't sure about.",
  ].join("\n");
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1 };

/** The Today chat's opening message: help Rigo pick what to work on today, across every app. */
function todayPrompt(input: Parameters<typeof buildChatPrompt>[0], day: string): string {
  const { items, notes, sprint } = input;
  const open = items.filter(
    (item) => (item.state === "open" || item.state === "draft") && item.status !== "Done",
  );
  const urgent = open
    .filter(
      (item) =>
        item.kind !== "pr" &&
        item.priority !== null &&
        item.priority in PRIORITY_RANK &&
        (sprint === null || item.sprint?.title === sprint.title || item.sprint === null),
    )
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9) ||
        (a.app ?? "").localeCompare(b.app ?? ""),
    );
  const appLine = (item: DeskItem) =>
    `- ${item.app ?? "(no app)"} · ${deskRef(item) ?? "item"} ${deskTitle(item)}${
      item.priority ? ` [${item.priority}]` : ""
    }${item.status && item.status !== "Todo" ? ` (${item.status})` : ""}`;
  const section = (title: string, list: ReadonlyArray<DeskItem>) => {
    if (list.length === 0) return [];
    const shown = list.slice(0, SNAPSHOT_LIMIT * 2).map(appLine);
    if (list.length > shown.length) shown.push(`- …and ${list.length - shown.length} more`);
    return ["", `${title}:`, ...shown];
  };
  const add = (label: string, text: string | undefined) =>
    text?.trim() ? ["", `## ${label}`, text.trim()] : [];
  const lines = [
    `This is my Today chat for ${todayChatTitle(day).replace("Today · ", "")}. Help me decide what to work on today, across every application, and keep me on it.`,
    ...(sprint
      ? [`Current sprint: ${sprint.title} (from ${sprint.startDate}, ${sprint.duration} days).`]
      : []),
    ...section("Waiting on me (blocked, or PRs in review)", waitingOnYou(items)),
    ...section(`P0 and P1 work${sprint ? ` in ${sprint.title} or unplanned` : ""}`, urgent),
    ...add("Where the portfolio is going", notes.directions[ALL_APPS]?.arc?.text),
    ...add("How I steer (every application)", notes.directions[ALL_APPS]?.loop?.text),
    "",
    "Before answering, build your context from what you can reach:",
    "1. Run `node ~/.claude/skills/dev-desk/desk.mjs context \"\"` for every app's direction and goals (the dev-desk skill). If it isn't installed, use what's above.",
    "2. List the T3 chats on my machines that are waiting on me (a question, an approval, a finished turn to review) with `t3_thread_list`, if you have it.",
    "3. If you can reach my Outlook and calendar, check today's meetings and anything asked of me since yesterday about these applications.",
    "",
    "Then give me:",
    "- **Top 3 for today**: the calls only I can make, most urgent first, each with why now and what happens if it waits.",
    "- **Then**: up to five more, in order.",
    "- **Not today**: what can safely wait, in one line each.",
    "Use plain words, name items as app + repo#number, and flag anything that conflicts with an app's direction or goal dates. Through the day I'll tell you what I finished or what came up; keep the list current and tell me what's next. Record decisions with `desk.mjs note`.",
  ];
  if (input.deskUrl) {
    lines.push(
      "",
      `From the Dev Desk: [${todayChatTitle(day)}](${input.deskUrl}#${deskFragment({ kind: "today", view: null, feature: null, app: null, sprint: null, itemUrl: null })})`,
    );
  }
  return lines.join("\n");
}

const VIEW_LABEL = { overview: "Overview", board: "Plan", sprint: "Sprint", prs: "PRs" } as const;

export interface DeskPlace {
  /** The sprint step ("Sprint 1"), when the chat belongs to one. */
  readonly sprint: { readonly label: string; readonly fragment: string } | null;
  /** The rest: the app and view, the feature, or the item. */
  readonly info: { readonly label: string; readonly fragment: string };
}

/** A linked chat's place on the Desk as breadcrumb steps: sprint, then app / feature / item. */
export function deskPlace(link: DeskChatLink): DeskPlace {
  const sprint = link.sprint
    ? {
        label: link.sprint,
        fragment: deskFragment({
          kind: "sprint",
          view: null,
          feature: null,
          app: link.app,
          sprint: link.sprint,
          itemUrl: null,
        }),
      }
    : null;
  const info =
    link.kind === "today"
      ? link.about
      : link.kind === "item"
        ? (link.about.split(":")[0] ?? link.about)
        : link.kind === "sprint"
          ? (link.app ?? "All apps")
          : link.feature
            ? featureName(link.feature)
            : `${link.app ?? "App"} · ${VIEW_LABEL[link.view ?? "overview"]}`;
  return { sprint, info: { label: info, fragment: deskFragment(link) } };
}
