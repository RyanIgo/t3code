import type { ThreadPullRequestLink } from "@t3tools/contracts";

import type { SidebarThreadStatus } from "../Sidebar.logic";

/**
 * Fleet fork: where a chat is between its first message and being settled, read from
 * what T3 already tracks (runs, the linked pull request, settlement).
 */
export type LifecycleStageId =
  | "started"
  | "working"
  | "pr"
  | "checks"
  | "review"
  | "merged"
  | "settled";
export type LifecycleStageState = "done" | "current" | "blocked" | "todo" | "skipped";

export interface LifecycleStage {
  readonly id: LifecycleStageId;
  readonly label: string;
  readonly state: LifecycleStageState;
  readonly detail: string | null;
  readonly at: string | null;
}

export interface ThreadLifecycle {
  readonly stages: ReadonlyArray<LifecycleStage>;
  /** What happens next, in one line. */
  readonly next: string;
  readonly merged: boolean;
}

type Snapshot = NonNullable<ThreadPullRequestLink["snapshot"]>;

/** The pull request the lifecycle follows: an open one first, else the latest merged or closed. */
function currentPullRequest(
  links: ReadonlyArray<ThreadPullRequestLink>,
): (ThreadPullRequestLink & { readonly snapshot: Snapshot }) | null {
  const withSnapshot = links.filter(
    (link): link is ThreadPullRequestLink & { readonly snapshot: Snapshot } =>
      link.source !== "stack-dismissed" && link.snapshot !== null,
  );
  const open = withSnapshot.find((link) => link.snapshot.state === "open");
  if (open) return open;
  return (
    withSnapshot.toSorted((a, b) =>
      (b.snapshot.mergedAt ?? b.snapshot.closedAt ?? "").localeCompare(
        a.snapshot.mergedAt ?? a.snapshot.closedAt ?? "",
      ),
    )[0] ?? null
  );
}

export function resolveThreadLifecycle(input: {
  readonly createdAt: string;
  readonly status: SidebarThreadStatus;
  readonly hasRun: boolean;
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly settledAt: string | null;
}): ThreadLifecycle {
  const pr = currentPullRequest(input.pullRequests);
  const snapshot = pr?.snapshot ?? null;
  const running = input.status === "working" || input.status === "waiting";
  const merged = snapshot?.state === "merged";
  const closed = snapshot?.state === "closed";
  const settled = input.settledAt !== null;

  const working: LifecycleStage = {
    id: "working",
    label: "Agent work",
    state: running ? "current" : input.hasRun ? "done" : "current",
    detail: running ? "Running now" : input.hasRun ? null : "Not started",
    at: null,
  };
  const prStage: LifecycleStage = pr
    ? {
        id: "pr",
        label: "Pull request",
        state: "done",
        detail: `#${pr.number}${snapshot?.isDraft ? " · draft" : ""} → ${snapshot?.baseBranch}`,
        at: pr.linkedAt,
      }
    : {
        id: "pr",
        label: "Pull request",
        state: input.hasRun && !running ? "current" : "todo",
        detail: input.hasRun && !running ? "None linked yet" : null,
        at: null,
      };
  const checks: LifecycleStage = {
    id: "checks",
    label: "Checks",
    state: !snapshot
      ? "todo"
      : merged
        ? "done"
        : snapshot.checksState === "failing"
          ? "blocked"
          : snapshot.checksState === "pending"
            ? "current"
            : snapshot.checksState === "passing"
              ? "done"
              : "skipped",
    detail: !snapshot
      ? null
      : merged
        ? null
        : snapshot.checksState === "failing"
          ? "Failing"
          : snapshot.checksState === "pending"
            ? "Running"
            : snapshot.checksState === "passing"
              ? "Passing"
              : "None reported",
    at: null,
  };
  const review: LifecycleStage = {
    id: "review",
    label: "Review",
    state: !snapshot
      ? "todo"
      : merged
        ? "done"
        : snapshot.reviewDecision === "approved"
          ? "done"
          : snapshot.reviewDecision === "changes-requested"
            ? "blocked"
            : snapshot.reviewDecision === "review-required"
              ? "current"
              : "skipped",
    detail: !snapshot
      ? null
      : merged
        ? null
        : snapshot.reviewDecision === "approved"
          ? "Approved"
          : snapshot.reviewDecision === "changes-requested"
            ? "Changes requested"
            : snapshot.reviewDecision === "review-required"
              ? "Waiting for review"
              : "Not required",
    at: null,
  };
  const mergedStage: LifecycleStage = {
    id: "merged",
    label: snapshot ? `Merged to ${snapshot.baseBranch}` : "Merged",
    state: merged ? "done" : closed ? "blocked" : snapshot ? "todo" : "todo",
    detail: merged ? null : closed ? "Closed without merging" : null,
    at: merged ? (snapshot?.mergedAt ?? null) : null,
  };
  const settledStage: LifecycleStage = {
    id: "settled",
    label: "Wrapped up",
    state: settled ? "done" : merged || closed ? "current" : "todo",
    detail: settled ? "Settled" : merged || closed ? "Not settled yet" : null,
    at: input.settledAt,
  };
  const stages: LifecycleStage[] = [
    { id: "started", label: "Started", state: "done", detail: null, at: input.createdAt },
    working,
    prStage,
    checks,
    review,
    mergedStage,
    settledStage,
  ];

  const next = settled
    ? "Done. Unsettle the chat to pick it back up."
    : merged
      ? `Merged to ${snapshot?.baseBranch}. Wrap up: confirm it shipped, close the linked issue, clean up the branch, then settle this chat.`
      : closed
        ? "The pull request closed without merging. Decide whether to reopen it or settle the chat."
        : running
          ? "The agent is working."
          : checks.state === "blocked"
            ? "Checks are failing. Ask the agent to fix them."
            : review.state === "blocked"
              ? "Changes were requested. Ask the agent to address the review."
              : checks.state === "current"
                ? "Waiting for checks to finish."
                : review.state === "current"
                  ? "Waiting for a review."
                  : snapshot
                    ? "Ready to merge."
                    : input.hasRun
                      ? "No pull request yet. Ask the agent to open one when the work is ready."
                      : "Send the first message to start.";
  return { stages, next, merged };
}

export const POST_MERGE_PROMPT = `The pull request for this chat has merged. Wrap up:
1. Confirm the change is on the base branch (pull it and check the commit).
2. Close or update the linked GitHub issue, with a one-line summary of what shipped.
3. Delete the merged branch and this chat's worktree if nothing else uses them.
4. Tell me anything left to do (follow-ups, deploys, docs), or say it's done so I can settle this chat.`;
