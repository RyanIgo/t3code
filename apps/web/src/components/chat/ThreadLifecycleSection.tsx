import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CheckIcon, CircleAlertIcon, CircleDotIcon, CircleIcon, MinusIcon } from "lucide-react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { formatFleetBoardAge, minuteTickToMs } from "../board/fleetBoard.logic";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  type LifecycleStageState,
  POST_MERGE_PROMPT,
  resolveThreadLifecycle,
} from "./threadLifecycle.logic";

const STAGE_ICON: Record<LifecycleStageState, typeof CheckIcon> = {
  done: CheckIcon,
  current: CircleDotIcon,
  blocked: CircleAlertIcon,
  todo: CircleIcon,
  skipped: MinusIcon,
};

const STAGE_TONE: Record<LifecycleStageState, string> = {
  done: "text-success-foreground",
  current: "text-info-foreground",
  blocked: "text-warning-foreground",
  todo: "text-muted-foreground/60",
  skipped: "text-muted-foreground/60",
};

/** Fleet fork: the chat's path from first message to settled, and what to do next. */
export function ThreadLifecycleSection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly compact: boolean;
}) {
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const thread = useQuietThreadShell(threadRef);
  const nowMs = minuteTickToMs(useNowMinute());
  const { settleThread } = useThreadActions();
  if (thread === null) return null;

  const lifecycle = resolveThreadLifecycle({
    createdAt: thread.createdAt,
    status: resolveSidebarThreadStatus(thread),
    hasRun: thread.latestRun != null,
    pullRequests: thread.pullRequests,
    settledAt: thread.settledOverride === "settled" ? (thread.settledAt ?? thread.updatedAt) : null,
  });
  const settled = thread.settledOverride === "settled";
  const fillWrapUpPrompt = () => {
    const store = useComposerDraftStore.getState();
    const prompt = store.getComposerDraft(threadRef)?.prompt ?? "";
    store.setPrompt(
      threadRef,
      prompt.trim() === "" ? POST_MERGE_PROMPT : `${prompt}\n\n${POST_MERGE_PROMPT}`,
    );
  };

  return (
    <ThreadDetailsSection headingId="thread-details-lifecycle-heading" title="Lifecycle">
      <div className="flex flex-col gap-2 px-2.5">
        {props.compact ? null : (
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {lifecycle.stages.map((stage) => {
              const Icon = STAGE_ICON[stage.state];
              const age = stage.at ? formatFleetBoardAge(stage.at, nowMs) : null;
              return (
                <li key={stage.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <Icon aria-hidden className={cn("size-3.5 shrink-0", STAGE_TONE[stage.state])} />
                  <span
                    className={cn(
                      "shrink-0",
                      stage.state === "todo" || stage.state === "skipped"
                        ? "text-muted-foreground"
                        : "text-foreground",
                      stage.state === "current" && "font-medium",
                    )}
                  >
                    {stage.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-end text-muted-foreground">
                    {[stage.detail, age ? `${age} ago` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <p
          className={cn(
            "m-0 rounded-md px-2 py-1.5 text-xs",
            lifecycle.merged && !settled
              ? "border border-success/40 bg-success/10 text-foreground"
              : "bg-muted/60 text-muted-foreground",
          )}
        >
          <span className="font-medium text-foreground">Next: </span>
          {lifecycle.next}
        </p>
        {lifecycle.merged && !settled ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" onClick={fillWrapUpPrompt}>
              Post-merge wrap-up
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void settleThread(threadRef)}>
              Settle chat
            </Button>
          </div>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}
