import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useComposerDraftStore } from "../../composerDraftStore";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { CardChatState } from "./boardCards.logic";
import { DeskHeading, openExternal } from "./DeskParts";
import { type DeskPr, PR_STAGES, type PrStage } from "./deskPrs.logic";

const STAGE_TONE: Record<PrStage, "success" | "error" | "info" | "outline" | "secondary"> = {
  ready: "success",
  landed: "secondary",
  fix: "error",
  waiting: "info",
  unverified: "secondary",
  draft: "outline",
};
const CHECKS = {
  passing: { label: "checks passing", tone: "success" },
  failing: { label: "checks failing", tone: "error" },
  pending: { label: "checks running", tone: "info" },
  none: { label: "no checks", tone: "secondary" },
} as const;

function PrIcon(props: { readonly pr: DeskPr }) {
  const Icon = props.pr.draft
    ? PullRequestGlyph.draft
    : props.pr.mergeable === "conflicting"
      ? PullRequestGlyph.conflicting
      : PullRequestGlyph.pullRequest;
  return <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
}

/** Puts a request in a chat's composer (not sent), for the user to read and send. */
function askChat(chat: CardChatState, text: string) {
  const ref = scopeThreadRef(chat.environmentId as EnvironmentId, chat.threadId as ThreadId);
  const store = useComposerDraftStore.getState();
  const existing = store.getComposerDraft(ref)?.prompt ?? "";
  store.setPrompt(ref, existing.trim() ? `${existing}\n\n${text}` : text);
}

/**
 * Fleet fork: one pull request in the work window: whether it can merge and why not, with the
 * next step one click away (merge on GitHub, look at files or checks, or ask its chat to fix).
 */
export function PrPanel(props: {
  readonly pr: DeskPr;
  /** The chat shown beside it; "Ask the chat" writes there. */
  readonly chat: CardChatState | null;
}) {
  const { pr } = props;
  const stageLabel = PR_STAGES.find((stage) => stage.id === pr.stage)?.label;
  const ref = `${pr.repo.split("/").pop()}#${pr.number}`;
  const fixRequest = `Please get ${ref} (${pr.url}) ready to merge: ${pr.reasons.join(", ") || "check what blocks it"}. Push the fix to its branch and tell me when the checks pass.`;
  return (
    <section
      aria-label="Pull request"
      className="mx-4 mt-4 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      <div className="flex items-center gap-2">
        <PrIcon pr={pr} />
        <DeskHeading>Pull request · {ref}</DeskHeading>
      </div>
      <p className="text-sm font-medium">{pr.title}</p>
      <span className="flex flex-wrap items-center gap-1">
        <Badge variant={STAGE_TONE[pr.stage]} size="sm">
          {stageLabel}
        </Badge>
        {pr.checks ? (
          <Badge variant={CHECKS[pr.checks].tone} size="sm">
            {CHECKS[pr.checks].label}
          </Badge>
        ) : null}
        {pr.mergeable === "conflicting" ? (
          <Badge variant="error" size="sm">
            merge conflict
          </Badge>
        ) : null}
      </span>
      {pr.reasons.length > 0 ? (
        <p className="text-xs text-muted-foreground">Not ready because: {pr.reasons.join(" · ")}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {pr.stage === "ready" ? (
          <Button size="xs" onClick={() => openExternal(pr.url)}>
            Merge on GitHub
          </Button>
        ) : pr.stage === "landed" ? (
          <Button size="xs" onClick={() => openExternal(pr.url)}>
            Close on GitHub
          </Button>
        ) : props.chat ? (
          <Button size="xs" onClick={() => props.chat && askChat(props.chat, fixRequest)}>
            Ask the chat to fix it
          </Button>
        ) : null}
        <Button size="xs" variant="outline" onClick={() => openExternal(`${pr.url}/files`)}>
          Files changed
        </Button>
        <Button size="xs" variant="outline" onClick={() => openExternal(`${pr.url}/checks`)}>
          Checks
        </Button>
        {pr.stage !== "ready" ? (
          <Button size="xs" variant="ghost" onClick={() => openExternal(pr.url)}>
            Open on GitHub
          </Button>
        ) : null}
      </div>
      {pr.stage !== "ready" && props.chat ? (
        <p className="text-2xs text-muted-foreground">
          "Ask the chat to fix it" writes the request in the chat's message box; you send it.
        </p>
      ) : null}
    </section>
  );
}
