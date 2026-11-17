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
} from "./desk.logic";
import type { DeskChatLink, DeskNotes } from "./deskNotes.logic";

export type DeskChatContext =
  | {
      readonly kind: "app";
      readonly app: string;
      readonly view: "overview" | "board" | "sprint";
      readonly feature: string | null;
    }
  | { readonly kind: "sprint"; readonly sprint: DeskSprint; readonly app: string | null }
  | { readonly kind: "item"; readonly item: DeskItem };

const SNAPSHOT_LIMIT = 12;

/** One line naming what the chat is about, e.g. "Precon · Board" or "Sprint 1 · Precon". */
export function contextLabel(context: DeskChatContext): string {
  if (context.kind === "item")
    return `${deskRef(context.item) ?? "Item"}: ${deskTitle(context.item)}`;
  if (context.kind === "sprint") {
    return context.app ? `${context.sprint.title} · ${context.app}` : context.sprint.title;
  }
  const view = { overview: "Overview", board: "Board", sprint: "Sprint" }[context.view];
  return context.feature
    ? `${context.app} · ${featureName(context.feature)}`
    : `${context.app} · ${view}`;
}

/** The app a context belongs to, for picking a project and linking the chat. */
function contextApp(context: DeskChatContext): string | null {
  if (context.kind === "item") return context.item.app;
  return context.app;
}

export function contextLink(
  context: DeskChatContext,
  sprint: DeskSprint | null,
): Omit<DeskChatLink, "updatedAt"> {
  return {
    app: contextApp(context),
    sprint: context.kind === "sprint" ? context.sprint.title : (sprint?.title ?? null),
    itemUrl: context.kind === "item" ? context.item.url : null,
    about: contextLabel(context),
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

/** The chat's opening message: what Rigo is on, a snapshot, and how to build context. */
export function buildChatPrompt(input: {
  readonly context: DeskChatContext;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly sprint: DeskSprint | null;
}): string {
  const { context, items, notes, sprint } = input;
  const app = contextApp(context);
  const lines: string[] = [];
  const contextCommand = `node ~/.claude/skills/dev-desk/desk.mjs context ${JSON.stringify(app ?? "")}`;

  if (context.kind === "item") {
    const item = context.item;
    lines.push(
      `I'm working on ${deskRef(item) ?? "this item"} from the Dev Desk: ${deskTitle(item)}.`,
      [
        app ? `App: ${app}` : null,
        item.feature ? `Feature: ${featureName(item.feature)}` : null,
        item.sprint ? `Sprint: ${item.sprint.title}` : null,
        item.lane ? `Lane: ${item.lane}` : null,
        item.priority ? `Priority: ${item.priority}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    if (item.plain?.where) lines.push(`Where it stands: ${item.plain.where}`);
  } else if (context.kind === "sprint") {
    const overview = sprintOverview(items, context.sprint, context.app ? [context.app] : []);
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

  lines.push(
    "",
    "Before anything else, build your context from what you can reach:",
    `1. Run \`${contextCommand}\` for the app's notes for agents, sprint goal and features (the dev-desk skill). If it isn't installed, use the snapshot above.`,
    context.kind === "item" && context.item.repo && context.item.number !== null
      ? `2. Read the issue and its comments: \`gh issue view ${context.item.number} --repo ${context.item.repo} --comments\`, and any linked PRs.`
      : "2. Read the issues above that matter most (`gh issue view <n> --repo <owner/repo> --comments`).",
    "3. Search other T3 chats for these issue numbers before starting, so we don't duplicate work in progress.",
    "4. Follow the notes for agents and stay inside the sprint goal; say so in one line if what I ask conflicts with them.",
    "",
    "Then tell me in three short lines where this stands, and ask what I want to do first. Record decisions with `desk.mjs note`.",
  );
  return lines.join("\n");
}
