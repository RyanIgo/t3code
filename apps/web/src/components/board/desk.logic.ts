/**
 * Fleet fork: the Dev Desk. Development work from the GitHub project the hub syncs: by
 * application and feature, in lanes and sprints, in plain words, beside the T3 chats doing it.
 * Features are issues titled "Feature: …" with Work type "Tracking"; their Stage is the
 * feature's (Experiment → Testing → Production). Pure logic only.
 */
import type { CardChatState } from "./boardCards.logic";

export type DeskLane = "Now" | "Next" | "Later" | "Blocked";
export const DESK_LANES: ReadonlyArray<DeskLane> = ["Now", "Next", "Later", "Blocked"];
/** More than this in Now and it stops meaning "now". */
export const NOW_LIMIT = 5;

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
  }>;
  readonly plain: DeskPlainWords | null;
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

export type DeskColumns = Record<DeskLane | "Unsorted", DeskItem[]>;

/** Open work by lane; "Unsorted" is open work with no lane yet, highest priority first. */
export function buildDeskColumns(items: ReadonlyArray<DeskItem>, filter: DeskFilter): DeskColumns {
  const columns: DeskColumns = { Now: [], Next: [], Later: [], Blocked: [], Unsorted: [] };
  for (const item of visibleItems(items)) {
    if (!isOpen(item) || !matches(item, filter)) continue;
    columns[item.lane ?? "Unsorted"].push(item);
  }
  for (const column of Object.values(columns)) column.sort(byPriority);
  return columns;
}

/** The T3 chats working on an item: linked through its PRs or a board card's links. */
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
          feature: sprintItems.filter((item) => item.workType === "Feature work").length,
          maintenance: sprintItems.filter((item) => item.workType === "Maintenance").length,
          other: sprintItems.filter(
            (item) => item.workType !== "Feature work" && item.workType !== "Maintenance",
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
