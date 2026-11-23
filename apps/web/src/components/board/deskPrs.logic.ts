/**
 * Fleet fork: the Desk's pull request lens. Every open PR the Desk knows about (PR items on the
 * project, PRs that close an issue there, and PRs the T3 chats are working on), with whether it
 * can merge and, if not, why. Checks and conflicts come from the chats (their machines see
 * more than the hub's token); reviews and drafts from the hub's GitHub sync. Pure logic only.
 */
import type { CardChatState } from "./boardCards.logic";
import type { DeskItem, DeskSprint } from "./desk.logic";

export type PrStage = "ready" | "landed" | "fix" | "waiting" | "unverified" | "draft";

export const PR_STAGES: ReadonlyArray<{ readonly id: PrStage; readonly label: string }> = [
  { id: "ready", label: "Ready to merge" },
  { id: "landed", label: "Already in main" },
  { id: "fix", label: "Needs fixing" },
  { id: "waiting", label: "Waiting" },
  { id: "unverified", label: "Not verified" },
  { id: "draft", label: "Draft" },
];

export interface DeskPr {
  readonly url: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly app: string | null;
  readonly feature: string | null;
  readonly sprint: DeskSprint | null;
  readonly draft: boolean;
  /** "none": the repo runs no checks on it; null: not seen. */
  readonly checks: "passing" | "failing" | "pending" | "none" | null;
  readonly mergeable: "mergeable" | "conflicting" | "unknown" | null;
  readonly review: string | null;
  /** The branch it merges into when that isn't the default branch (a stacked PR). */
  readonly stackedOn: string | null;
  /** The default branch already has all its commits: close it, there's nothing to merge. */
  readonly landed: boolean;
  /** The PR's own Desk item, or the issue it closes. */
  readonly item: DeskItem | null;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly stage: PrStage;
  /** Why it isn't ready, or what's still unknown, in a few words each. */
  readonly reasons: ReadonlyArray<string>;
}

const PR_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;
const isOpenState = (state: string) => state === "open" || state === "draft";
const CHECK_RANK = { failing: 4, pending: 3, passing: 2, none: 1 } as const;

function mergeState(value: string | null | undefined): DeskPr["mergeable"] {
  return value === "mergeable" || value === "conflicting" || value === "unknown" ? value : null;
}

/** The app most of a repo's Desk items belong to, by repo name without owner. */
function repoApps(items: ReadonlyArray<DeskItem>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const item of items) {
    if (!item.repo || !item.app) continue;
    const repo = item.repo.split("/").pop() ?? item.repo;
    const byApp = counts.get(repo) ?? new Map<string, number>();
    byApp.set(item.app, (byApp.get(item.app) ?? 0) + 1);
    counts.set(repo, byApp);
  }
  return new Map(
    [...counts].map(([repo, byApp]) => [
      repo,
      [...byApp].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    ]),
  );
}

function stageOf(pr: Omit<DeskPr, "stage" | "reasons">): { stage: PrStage; reasons: string[] } {
  if (pr.landed) return { stage: "landed", reasons: ["its changes are already in main"] };
  if (pr.draft) return { stage: "draft", reasons: ["draft"] };
  const fix = [
    pr.mergeable === "conflicting" ? "merge conflict" : null,
    pr.checks === "failing" ? "checks failing" : null,
    pr.review === "CHANGES_REQUESTED" ? "changes requested" : null,
  ].filter((reason): reason is string => reason !== null);
  if (fix.length > 0) return { stage: "fix", reasons: fix };
  const waiting = [
    pr.stackedOn ? `merges into ${pr.stackedOn}, not main` : null,
    pr.checks === "pending" ? "checks running" : null,
    pr.review === "REVIEW_REQUIRED" ? "needs review" : null,
  ].filter((reason): reason is string => reason !== null);
  if (waiting.length > 0) return { stage: "waiting", reasons: waiting };
  // Ready means seen ready: checks passed and GitHub says it merges. Otherwise nothing is
  // known to be wrong, but nobody has seen it pass yet.
  const unknown = [
    pr.checks === null ? "checks not seen" : null,
    pr.mergeable !== "mergeable" ? "merge state not computed" : null,
  ].filter((reason): reason is string => reason !== null);
  return unknown.length === 0
    ? { stage: "ready", reasons: [] }
    : { stage: "unverified", reasons: unknown };
}

/** Every open PR the Desk knows about, merged from project items, issues and chats. */
export function collectPrs(
  items: ReadonlyArray<DeskItem>,
  chats: ReadonlyArray<CardChatState>,
): DeskPr[] {
  type Draft = { -readonly [K in keyof Omit<DeskPr, "stage" | "reasons">]: DeskPr[K] } & {
    chats: CardChatState[];
  };
  const prs = new Map<string, Draft>();
  const appByRepo = repoApps(items);
  const base = (url: string): Draft | null => {
    const match = PR_URL.exec(url);
    if (!match) return null;
    const repo = match[1] as string;
    return {
      url,
      repo,
      number: Number(match[2]),
      title: `PR #${match[2]}`,
      app: appByRepo.get(repo.split("/").pop() ?? repo) ?? null,
      feature: null,
      sprint: null,
      draft: false,
      checks: null,
      mergeable: null,
      review: null,
      stackedOn: null,
      landed: false,
      item: null,
      chats: [],
    };
  };
  for (const item of items) {
    if (item.kind === "pr" && item.url && isOpenState(item.state)) {
      const pr = prs.get(item.url) ?? base(item.url);
      if (!pr) continue;
      Object.assign(pr, {
        title: item.title,
        app: item.app ?? pr.app,
        feature: item.feature,
        sprint: item.sprint,
        draft: item.state === "draft",
        mergeable: mergeState(item.mergeable) ?? pr.mergeable,
        checks: item.checks ?? pr.checks,
        review: item.review ?? pr.review,
        stackedOn: item.stackedOn ?? null,
        landed: item.landed === true,
        item,
      });
      prs.set(item.url, pr);
    }
  }
  for (const item of items) {
    if (item.kind === "pr") continue;
    for (const linked of item.pullRequests) {
      if (!isOpenState(linked.state)) continue;
      const pr = prs.get(linked.url) ?? base(linked.url);
      if (!pr) continue;
      if (!prs.has(linked.url)) {
        Object.assign(pr, {
          title: linked.title ?? `PR #${linked.number} for ${item.title}`,
          draft: linked.state === "draft",
          mergeable: mergeState(linked.mergeable),
          review: linked.review ?? null,
          stackedOn: linked.stackedOn ?? null,
          landed: linked.landed === true,
          item,
        });
      }
      pr.app ??= item.app;
      pr.feature ??= item.feature;
      pr.sprint ??= item.sprint;
      prs.set(linked.url, pr);
    }
  }
  for (const chat of chats) {
    for (const seen of chat.pullRequests) {
      if (seen.state !== "open" && seen.state !== "draft") continue;
      const pr = prs.get(seen.url) ?? base(seen.url);
      if (!pr) continue;
      if (!prs.has(seen.url)) {
        pr.title = seen.label;
        pr.draft = seen.state === "draft";
      }
      if (!pr.chats.includes(chat)) pr.chats.push(chat);
      // Chats see checks the hub's token may not; the worst one seen wins.
      if (seen.checks && (pr.checks === null || CHECK_RANK[seen.checks] > CHECK_RANK[pr.checks])) {
        pr.checks = seen.checks;
      }
      const merge = mergeState(seen.mergeability);
      if (merge && merge !== "unknown") pr.mergeable = merge;
      prs.set(seen.url, pr);
    }
  }
  return [...prs.values()].map((pr) => ({ ...pr, ...stageOf(pr) }));
}

/** A bot's version bump (Dependabot, Renovate): mergeable in bulk, so listed after real work. */
export const isDependencyUpdate = (pr: Pick<DeskPr, "title">) =>
  /^(bump |build\(deps|chore\(deps|update dependency )/i.test(pr.title);

export type PrGrouping = "app" | "sprint" | "chat";

export interface PrGroup {
  readonly key: string;
  readonly label: string;
  readonly prs: ReadonlyArray<DeskPr>;
}

const STAGE_RANK: Record<PrStage, number> = {
  ready: 0,
  landed: 1,
  fix: 2,
  waiting: 3,
  unverified: 4,
  draft: 5,
};

/** PRs grouped by app, sprint or chat; within a group, ready first. A PR shows under each of its chats. */
const readyWork = (prs: ReadonlyArray<DeskPr>) =>
  prs.filter((pr) => pr.stage === "ready" && !isDependencyUpdate(pr)).length;

export function groupPrs(prs: ReadonlyArray<DeskPr>, by: PrGrouping): PrGroup[] {
  const groups = new Map<string, { label: string; prs: DeskPr[] }>();
  const add = (key: string, label: string, pr: DeskPr) => {
    const group = groups.get(key) ?? { label, prs: [] };
    group.prs.push(pr);
    groups.set(key, group);
  };
  for (const pr of prs) {
    if (by === "app") add(pr.app ?? "", pr.app ?? "No application", pr);
    else if (by === "sprint") add(pr.sprint?.title ?? "", pr.sprint?.title ?? "No sprint", pr);
    else if (pr.chats.length === 0) add("", "No chat", pr);
    else {
      for (const chat of pr.chats) add(`${chat.environmentId}:${chat.threadId}`, chat.title, pr);
    }
  }
  return [...groups]
    .map(([key, group]) => ({
      key,
      label: group.label,
      prs: group.prs.sort(
        (a, b) =>
          Number(isDependencyUpdate(a)) - Number(isDependencyUpdate(b)) ||
          STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
          a.repo.localeCompare(b.repo) ||
          a.number - b.number,
      ),
    }))
    .sort(
      (a, b) =>
        Number(a.key === "") - Number(b.key === "") ||
        readyWork(b.prs) - readyWork(a.prs) ||
        a.label.localeCompare(b.label),
    );
}
