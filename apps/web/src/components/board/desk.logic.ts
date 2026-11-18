/**
 * Fleet fork: the Dev Desk. Development work from the GitHub project the hub syncs: by
 * application and feature, in sprints by status, in plain words, beside the T3 chats doing it.
 * Features are issues titled "Feature: …" with Work type "Tracking"; their Stage is the
 * feature's (Experiment → Testing → Production). Pure logic only.
 */
import type { CardChatState } from "./boardCards.logic";

export type DeskLane = "Now" | "Next" | "Later" | "Blocked";

export interface DeskPlainWords {
  readonly what: string | null;
  readonly why: string | null;
  readonly where: string | null;
}

export interface DeskItem {
  readonly itemId: string;
  readonly kind: "issue" | "pr" | "draft";
  readonly repo: string | null;
  readonly number: number | null;
  readonly title: string;
  readonly url: string | null;
  readonly state: "open" | "draft" | "closed" | "merged";
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
  readonly status: string | null;
  readonly priority: string | null;
  readonly size: string | null;
  readonly initiative: string | null;
  readonly app: string | null;
  /** "<App> · <feature>", the project's Feature option. */
  readonly feature: string | null;
  readonly stage: DeskStage | null;
  readonly workType: string | null;
  readonly sprint: DeskSprint | null;
  readonly lane: DeskLane | null;
  readonly pullRequests: ReadonlyArray<{
    readonly number: number;
    readonly url: string;
    readonly state: string;
    readonly title?: string;
    readonly review?: string | null;
    readonly mergeable?: string | null;
    /** The branch it merges into, when that isn't the default branch. */
    readonly stackedOn?: string | null;
    /** True when the default branch already has all its commits. */
    readonly landed?: boolean | null;
  }>;
  /** For a PR item: its review decision and merge state, from the hub's sync. */
  readonly review?: string | null;
  readonly mergeable?: string | null;
  /** For a PR item: its checks, when the hub's token may read them. */
  readonly checks?: "passing" | "failing" | "pending" | "none" | null;
  readonly stackedOn?: string | null;
  readonly landed?: boolean | null;
  readonly plain: DeskPlainWords | null;
  /** A user story: who wants what and why, and the checklist that says it's done. */
  readonly story?: DeskStory | null;
}

export interface DeskStory {
  readonly text: string;
  readonly criteria: ReadonlyArray<{ readonly text: string; readonly done: boolean }>;
}

/** "2 of 6 criteria", or null when the item has no checklist. */
export function storyProgress(item: DeskItem): string | null {
  const criteria = item.story?.criteria ?? [];
  if (criteria.length === 0) return null;
  return `${criteria.filter((criterion) => criterion.done).length} of ${criteria.length} criteria`;
}

export type DeskStage = "Experiment" | "Testing" | "Production";
const DESK_STAGES: ReadonlyArray<DeskStage> = ["Experiment", "Testing", "Production"];

export interface DeskSprint {
  readonly title: string;
  readonly startDate: string;
  readonly duration: number;
}

export interface DeskView {
  readonly configured: boolean;
  readonly syncedAt: string | null;
  readonly error: string | null;
  readonly initiatives: ReadonlyArray<string>;
  readonly apps?: ReadonlyArray<string>;
  readonly sprints?: ReadonlyArray<DeskSprint>;
  /** Option names of the fields the Desk can change. */
  readonly options?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly items: ReadonlyArray<DeskItem>;
}

export interface DeskFilter {
  readonly app: string | null;
  readonly query: string;
}

/** The feature's own name, without its app: "Precon · Bid intake" → "Bid intake". */
export const featureName = (feature: string) =>
  feature.split(" · ").slice(1).join(" · ") || feature;

const isOpen = (item: DeskItem) => item.state === "open" || item.state === "draft";

/**
 * A chat title without pasted links: a GitHub link becomes "repo#number" and a link in
 * brackets after the name is dropped. Display only; the chat keeps its name.
 */
export function chatTitle(title: string): string {
  const cleaned = title
    .replace(/\(\s*https?:\/\/[^)\s]*\s*\)?/g, "")
    .replace(/https?:\/\/github\.com\/[^/\s]+\/([^/\s]+)\/(?:pull|issues)\/(\d+)\S*/g, "$1#$2")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || title;
}

/** What a person reads first: the plain "What", else the GitHub title. */
export const deskTitle = (item: DeskItem) => item.plain?.what ?? item.title;

/** `drawings#94`: the repo without its owner, and the number. */
export const deskRef = (item: DeskItem) =>
  item.repo && item.number !== null ? `${item.repo.split("/").pop()}#${item.number}` : null;

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);

/** Highest priority first, then most recently touched. */
function byPriority(a: DeskItem, b: DeskItem): number {
  return (
    (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9) ||
    time(b.updatedAt) - time(a.updatedAt)
  );
}

/** PRs that close an issue on the board show on that issue, not as their own card. */
/** Work to schedule: no feature records, initiative headers or reports (Work type Tracking). */
function visibleItems(items: ReadonlyArray<DeskItem>): DeskItem[] {
  const closing = new Set(items.flatMap((item) => item.pullRequests.map((pr) => pr.url)));
  return items.filter(
    (item) =>
      item.workType !== "Tracking" && !(item.kind === "pr" && item.url && closing.has(item.url)),
  );
}

function matches(item: DeskItem, filter: DeskFilter): boolean {
  if (filter.app !== null && item.app !== filter.app) return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  return [item.title, item.plain?.what, item.plain?.where, deskRef(item), item.feature, item.app]
    .filter(Boolean)
    .some((text) => String(text).toLowerCase().includes(query));
}

/** The kinds of work a card can be, from the project's Work type field. */
export type WorkKind = "Story" | "Bug" | "Maintenance" | "Research" | "Support";
const WORK_KINDS: ReadonlyArray<WorkKind> = ["Story", "Bug", "Maintenance", "Research", "Support"];

/** An item's kind; reads the field's former names ("Feature work", "Fix") from older syncs. */
export function workKind(item: Pick<DeskItem, "workType">): WorkKind | null {
  const name =
    item.workType === "Feature work" ? "Story" : item.workType === "Fix" ? "Bug" : item.workType;
  return WORK_KINDS.find((kind) => kind === name) ?? null;
}

/** The Sprint board's columns: the project's Status options. */
export const SPRINT_STATUSES = ["Todo", "In Progress", "In Review", "Done"] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

/**
 * Where an item sits on the Sprint board: its Status, moved forward by what's happening when the
 * field lags. An open PR means In Review; a draft PR or an active agent means In Progress.
 */
export function sprintStatus(item: DeskItem, agentActive = false): SprintStatus {
  if (!isOpen(item) || item.status === "Done") return "Done";
  const set = SPRINT_STATUSES.indexOf(
    item.status === "In Progress" || item.status === "In Review" ? item.status : "Todo",
  );
  const prs = item.pullRequests.filter((pr) => pr.state === "open" || pr.state === "draft");
  const seen = prs.some((pr) => pr.state === "open") ? 2 : prs.length > 0 || agentActive ? 1 : 0;
  return SPRINT_STATUSES[Math.max(set, seen)] ?? "Todo";
}

/** One sprint's work by Status, highest priority first in each column. */
export function buildSprintBoard(
  items: ReadonlyArray<DeskItem>,
  sprint: DeskSprint,
  filter: DeskFilter,
  agentActive: (item: DeskItem) => boolean = () => false,
): Record<SprintStatus, DeskItem[]> {
  const board: Record<SprintStatus, DeskItem[]> = {
    Todo: [],
    "In Progress": [],
    "In Review": [],
    Done: [],
  };
  for (const item of visibleItems(items)) {
    if (item.sprint?.title !== sprint.title || !matches(item, filter)) continue;
    board[sprintStatus(item, agentActive(item))].push(item);
  }
  for (const column of Object.values(board)) column.sort(byPriority);
  return board;
}

/**
 * Open work not planned into the current or a later sprint (work from an ended sprint comes
 * back here), highest priority first.
 */
export function buildBacklog(
  items: ReadonlyArray<DeskItem>,
  plannedSprints: ReadonlySet<string>,
  filter: DeskFilter & { readonly kind: WorkKind | null },
): DeskItem[] {
  return visibleItems(items)
    .filter(
      (item) =>
        isOpen(item) &&
        !(item.sprint && plannedSprints.has(item.sprint.title)) &&
        (filter.kind === null || workKind(item) === filter.kind) &&
        matches(item, filter),
    )
    .sort(byPriority);
}

/** The current sprint and the ones after it, for "planned" and "Add to sprint". */
export function plannedSprints(sprints: ReadonlyArray<DeskSprint>, now: number): DeskSprint[] {
  return [...sprints]
    .filter((sprint) => Date.parse(sprint.startDate) + sprint.duration * 86_400_000 > now)
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
}

export function chatsForItem(
  item: DeskItem,
  chats: ReadonlyArray<CardChatState>,
  linksByChat: ReadonlyMap<string, ReadonlyArray<string>>,
): CardChatState[] {
  const urls = new Set([item.url, ...item.pullRequests.map((pr) => pr.url)].filter(Boolean));
  return chats.filter(
    (chat) =>
      chat.pullRequests.some((pr) => urls.has(pr.url)) ||
      (linksByChat.get(`${chat.environmentId}:${chat.threadId}`) ?? []).some((url) =>
        urls.has(url),
      ),
  );
}

/** The sprint running on `now`, else the next one to start. */
export function currentSprint(sprints: ReadonlyArray<DeskSprint>, now: number): DeskSprint | null {
  const day = 86_400_000;
  const sorted = [...sprints].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  return (
    sorted.find(
      (sprint) =>
        Date.parse(sprint.startDate) <= now &&
        now < Date.parse(sprint.startDate) + sprint.duration * day,
    ) ??
    sorted.find((sprint) => Date.parse(sprint.startDate) > now) ??
    null
  );
}

export interface FeatureSummary {
  readonly feature: string;
  readonly name: string;
  readonly stage: DeskStage | null;
  readonly url: string | null;
  readonly open: number;
  readonly inSprint: number;
  readonly blocked: number;
}

/** How a sprint's open work splits against the 60 / 20 / 20 budget. */
export interface SprintMix {
  readonly feature: number;
  readonly maintenance: number;
  readonly other: number;
}

export interface AppSummary {
  readonly app: string;
  readonly features: FeatureSummary[];
  readonly open: number;
  readonly maintenance: number;
  readonly blocked: DeskItem[];
  readonly sprintItems: DeskItem[];
  readonly mix: SprintMix;
}

/** Each application's features by stage, this sprint's work and its budget split, and blockers. */
export function summarizeApps(
  items: ReadonlyArray<DeskItem>,
  apps: ReadonlyArray<string>,
  sprint: DeskSprint | null,
): AppSummary[] {
  const work = visibleItems(items).filter(isOpen);
  const records = items.filter(
    (item) => item.workType === "Tracking" && item.feature && item.title.startsWith("Feature:"),
  );
  const inSprint = (item: DeskItem) => sprint !== null && item.sprint?.title === sprint.title;
  return apps.flatMap((app) => {
    const mine = work.filter((item) => item.app === app);
    const featureKeys = [
      ...new Set([
        ...records.filter((record) => record.app === app).map((record) => record.feature as string),
        ...mine.flatMap((item) => (item.feature ? [item.feature] : [])),
      ]),
    ];
    if (mine.length === 0 && featureKeys.length === 0) return [];
    const stageRank = (stage: DeskStage | null) => (stage ? DESK_STAGES.indexOf(stage) : -1);
    const features = featureKeys
      .map((feature) => {
        const record = records.find((entry) => entry.feature === feature);
        const of = mine.filter((item) => item.feature === feature);
        return {
          feature,
          name: featureName(feature),
          stage: record?.stage ?? null,
          url: record?.url ?? null,
          open: of.length,
          inSprint: of.filter(inSprint).length,
          blocked: of.filter((item) => item.lane === "Blocked").length,
        };
      })
      .sort((a, b) => stageRank(b.stage) - stageRank(a.stage) || b.inSprint - a.inSprint);
    const sprintItems = mine.filter(inSprint).sort(byPriority);
    return [
      {
        app,
        features,
        open: mine.length,
        maintenance: mine.filter((item) => item.workType === "Maintenance").length,
        blocked: mine.filter((item) => item.lane === "Blocked").sort(byPriority),
        sprintItems,
        mix: {
          feature: sprintItems.filter((item) => workKind(item) === "Story").length,
          maintenance: sprintItems.filter((item) => workKind(item) === "Maintenance").length,
          other: sprintItems.filter(
            (item) => workKind(item) !== "Story" && workKind(item) !== "Maintenance",
          ).length,
        },
      },
    ];
  });
}

/**
 * Chats waiting on the user, by the sidebar's "Waiting on me" rule: a question or approval, an
 * unread result, or a PR whose checks fail.
 */
export function chatWaitsOnYou(chat: CardChatState): boolean {
  return (
    chat.needsYou ||
    chat.column === "done" ||
    chat.pullRequests.some((pr) => pr.state === "open" && pr.checks === "failing")
  );
}

/** Items waiting on the user outside chats: blocked ones, and PRs in review. */
export function waitingOnYou(items: ReadonlyArray<DeskItem>): DeskItem[] {
  return visibleItems(items)
    .filter(
      (item) =>
        isOpen(item) &&
        (item.lane === "Blocked" ||
          (item.status === "In Review" &&
            (item.kind === "pr" || item.pullRequests.some((pr) => pr.state === "open")))),
    )
    .sort(byPriority);
}

/** The repos an application's work lives in, by name without the owner. */
export function appRepos(items: ReadonlyArray<DeskItem>, app: string): Set<string> {
  return new Set(
    items.flatMap((item) =>
      item.app === app && item.repo ? [item.repo.split("/").pop() ?? ""] : [],
    ),
  );
}

/**
 * The T3 chats working on an application: chats in a project named after one of its repos
 * (with or without the owner). Waiting on you first, then working, then most recent.
 */
export function chatsForApp(
  chats: ReadonlyArray<CardChatState>,
  repos: ReadonlySet<string>,
  projectName: (projectKey: string) => string | null,
): CardChatState[] {
  const rank = (chat: CardChatState) => (chatWaitsOnYou(chat) ? 0 : chat.working ? 1 : 2);
  return chats
    .filter((chat) => {
      const name = chat.projectKey ? projectName(chat.projectKey) : null;
      return name !== null && repos.has(name.split("/").pop() ?? name);
    })
    .sort((a, b) => rank(a) - rank(b) || time(b.since) - time(a.since));
}

/** An item's full content, fetched from the hub when it's opened. */
export interface DeskDetail {
  readonly kind: string;
  readonly title: string;
  readonly url: string | null;
  readonly state: string;
  readonly body: string;
  readonly createdAt: string | null;
  readonly author: string | null;
  readonly labels: ReadonlyArray<string>;
  readonly comments: {
    readonly total: number;
    readonly recent: ReadonlyArray<{
      readonly author: string | null;
      readonly body: string;
      readonly createdAt: string;
      readonly url: string;
    }>;
  };
  readonly parent: DeskIssueRef | null;
  readonly subIssues: ReadonlyArray<DeskIssueRef>;
  /** What the hub's GitHub token couldn't read, e.g. "check results". */
  readonly unavailable?: ReadonlyArray<string>;
  readonly pullRequests: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly state: string;
    readonly review: string | null;
    readonly mergeable: string | null;
    readonly checks: string | null;
  }>;
}

export interface DeskIssueRef {
  readonly title: string;
  readonly number: number;
  readonly url: string;
  readonly state: string;
  readonly repo: string;
}

/** The feature's own record: its "Feature: …" issue with goal and stage. */
export function featureRecord(items: ReadonlyArray<DeskItem>, feature: string): DeskItem | null {
  return (
    items.find(
      (item) =>
        item.workType === "Tracking" &&
        item.feature === feature &&
        item.title.startsWith("Feature:"),
    ) ?? null
  );
}

export interface WorkGroups {
  readonly sprint: DeskItem[];
  readonly blocked: DeskItem[];
  readonly open: DeskItem[];
  readonly done: DeskItem[];
}

/**
 * Work matching `keep`, split for reading: in the given sprint, blocked, other open work, and
 * finished in the last two weeks.
 */
export function groupWork(
  items: ReadonlyArray<DeskItem>,
  keep: (item: DeskItem) => boolean,
  sprint: DeskSprint | null,
): WorkGroups {
  const groups: WorkGroups = { sprint: [], blocked: [], open: [], done: [] };
  for (const item of visibleItems(items)) {
    if (!keep(item)) continue;
    if (!isOpen(item)) groups.done.push(item);
    else if (sprint && item.sprint?.title === sprint.title) groups.sprint.push(item);
    else if (item.lane === "Blocked") groups.blocked.push(item);
    else groups.open.push(item);
  }
  groups.sprint.sort(byPriority);
  groups.blocked.sort(byPriority);
  groups.open.sort(byPriority);
  groups.done.sort((a, b) => time(b.closedAt) - time(a.closedAt));
  return groups;
}

export interface SprintAppWork {
  readonly app: string;
  readonly items: DeskItem[];
  readonly done: number;
}

export interface SprintOverview {
  readonly total: number;
  readonly done: number;
  readonly mix: SprintMix;
  readonly apps: SprintAppWork[];
}

/** Everything in a sprint, finished or not, by application, with progress and budget split. */
export function sprintOverview(
  items: ReadonlyArray<DeskItem>,
  sprint: DeskSprint,
  apps: ReadonlyArray<string>,
  /** Count items with no application; off when the Desk is filtered to one app. */
  withUnassigned = true,
): SprintOverview {
  const mine = visibleItems(items).filter(
    (item) =>
      item.sprint?.title === sprint.title &&
      (item.app === null ? withUnassigned : apps.includes(item.app)),
  );
  const finished = (item: DeskItem) => !isOpen(item) || item.status === "Done";
  const byApp = [...apps, null].flatMap((app) => {
    const of = mine.filter((item) => item.app === app);
    if (of.length === 0) return [];
    return [
      {
        app: app ?? "No application",
        items: of.sort((a, b) => Number(finished(a)) - Number(finished(b)) || byPriority(a, b)),
        done: of.filter(finished).length,
      },
    ];
  });
  const open = mine.filter((item) => !finished(item));
  return {
    total: mine.length,
    done: mine.filter(finished).length,
    mix: {
      feature: open.filter((item) => workKind(item) === "Story").length,
      maintenance: open.filter((item) => workKind(item) === "Maintenance").length,
      other: open.filter((item) => workKind(item) !== "Story" && workKind(item) !== "Maintenance")
        .length,
    },
    apps: byApp,
  };
}

export interface ChatStatus {
  readonly label: string;
  readonly tone: "warning" | "error" | "info" | "success" | "secondary";
  /** Lower sorts first: what needs the user, then what's moving, then what's quiet. */
  readonly rank: number;
}

/** A chat's state in a word, the way the sidebar sees it. */
export function chatStatus(chat: CardChatState): ChatStatus {
  if (chat.needsYou) return { label: "Needs you", tone: "warning", rank: 0 };
  if (chat.pullRequests.some((pr) => pr.state === "open" && pr.checks === "failing")) {
    return { label: "Checks failing", tone: "error", rank: 1 };
  }
  if (chat.column === "done") return { label: "Result ready", tone: "success", rank: 2 };
  if (chat.working) return { label: "Working", tone: "info", rank: 3 };
  // The board's "queued" column is idle chats plus starting ones, which count as working above.
  return { label: "Idle", tone: "secondary", rank: 4 };
}
