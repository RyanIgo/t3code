import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { isOrchestratorTitle } from "../command/fleetOrchestrator";
import type { CardChatState, CardPullRequestState } from "./boardCards.logic";
import { resolveFleetBoardCard } from "./fleetBoard.logic";
import { useFleetBoardThreads } from "./useFleetBoardThreads";

function pullRequestState(
  snapshot: { state: string; isDraft: boolean; mergedAt?: string | null | undefined } | null,
): CardPullRequestState {
  if (snapshot === null) return "unknown";
  if (snapshot.mergedAt || snapshot.state === "merged") return "merged";
  if (snapshot.state === "open") return snapshot.isDraft ? "draft" : "open";
  return "closed";
}

/** Every chat the board can place, with the project (sidebar group) it belongs to. */
export function useCardChats(includeSettled: boolean): CardChatState[] {
  const groups = useSidebarProjectGroups();
  const { threads } = useFleetBoardThreads(includeSettled);
  const projectKeyByRef = new Map<string, string>();
  for (const group of groups) {
    for (const ref of group.memberProjectRefs) {
      projectKeyByRef.set(`${ref.environmentId}:${ref.projectId}`, group.projectKey);
    }
  }
  return threads
    .filter((thread) => !isOrchestratorTitle(thread.title))
    .map((thread) => {
      const resolved = resolveFleetBoardCard(thread);
      return {
        environmentId: thread.environmentId,
        threadId: thread.id,
        title: thread.title,
        projectKey: projectKeyByRef.get(`${thread.environmentId}:${thread.projectId}`) ?? null,
        column: resolved.column,
        needsYou: resolved.column === "needs",
        asking:
          resolved.column !== "needs"
            ? null
            : thread.hasPendingApprovals
              ? "approval"
              : thread.pendingSubagentRequest === "approval"
                ? "subagent approval"
                : thread.hasPendingUserInput
                  ? "question"
                  : null,
        working: resolved.tone === "working",
        hasPullRequest: Boolean(thread.linkedPullRequest),
        pullRequestNumber: thread.linkedPullRequest?.number ?? null,
        pullRequests: (thread.pullRequests ?? [])
          .filter((link) => link.source !== "stack-dismissed")
          .map((link) => ({
            url: link.url,
            label: `${link.repository.split("/").pop() ?? link.repository}#${link.number}`,
            state: pullRequestState(link.snapshot),
            checks: link.snapshot?.checksState ?? null,
            mergeability: link.snapshot?.mergeability ?? null,
          })),
        since: resolved.since ?? thread.updatedAt,
        worktree: thread.worktreePath ?? null,
        branch: thread.branch ?? null,
      };
    });
}
