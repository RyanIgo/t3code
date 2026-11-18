import { useState } from "react";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus } from "./desk.logic";
import { DeskHeading } from "./DeskParts";
import {
  type DeskPr,
  groupPrs,
  PR_STAGES,
  type PrGrouping,
  type PrStage,
  prFeature,
} from "./deskPrs.logic";

const STAGE_TONE: Record<PrStage, "success" | "error" | "info" | "outline" | "secondary"> = {
  ready: "success",
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
const GROUPS_SHOWN = 12;

/**
 * Fleet fork: the PR lens. Open pull requests and whether each can merge (and if not, why),
 * grouped by app, sprint or chat with what's ready first. Clicking a PR opens it in the work
 * window; its chats open there too.
 */
export function PrLens(props: {
  readonly prs: ReadonlyArray<DeskPr>;
  /** Fixed grouping (e.g. by sprint on an app page); otherwise the reader picks. */
  readonly grouping?: PrGrouping;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly compact?: boolean;
}) {
  const [grouping, setGrouping] = useState<PrGrouping>(props.grouping ?? "app");
  const [only, setOnly] = useState<PrStage | null>(null);
  const [allGroups, setAllGroups] = useState(false);
  const counts = Object.fromEntries(
    PR_STAGES.map((stage) => [stage.id, props.prs.filter((pr) => pr.stage === stage.id).length]),
  ) as Record<PrStage, number>;
  const shown = only ? props.prs.filter((pr) => pr.stage === only) : props.prs;
  const groups = groupPrs(shown, props.grouping ?? grouping);
  const visibleGroups = allGroups ? groups : groups.slice(0, GROUPS_SHOWN);
  if (props.prs.length === 0) {
    return <p className="text-xs text-muted-foreground">No open pull requests.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {PR_STAGES.filter((stage) => counts[stage.id] > 0 || only === stage.id).map((stage) => (
          <Button
            key={stage.id}
            variant={only === stage.id ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={only === stage.id}
            onClick={() => setOnly(only === stage.id ? null : stage.id)}
          >
            <Badge variant={STAGE_TONE[stage.id]} size="sm">
              {counts[stage.id]}
            </Badge>
            {stage.label}
          </Button>
        ))}
        {props.grouping ? null : (
          <ToggleGroup
            aria-label="Group pull requests by"
            className="ms-auto"
            value={[grouping]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "app" || next === "sprint" || next === "chat") setGrouping(next);
            }}
          >
            <Toggle value="app">By app</Toggle>
            <Toggle value="sprint">By sprint</Toggle>
            <Toggle value="chat">By chat</Toggle>
          </ToggleGroup>
        )}
      </div>
      {visibleGroups.map((group) => (
        <section
          key={group.key || group.label}
          aria-label={group.label}
          className="flex flex-col gap-1.5"
        >
          <DeskHeading>
            {group.label} · {group.prs.filter((pr) => pr.stage === "ready").length} ready of{" "}
            {group.prs.length}
          </DeskHeading>
          <ul className="flex flex-col gap-1.5">
            {group.prs.map((pr) => (
              <PrRow
                key={`${group.key}:${pr.url}`}
                pr={pr}
                compact={props.compact === true}
                onOpenPr={props.onOpenPr}
                onOpenChat={props.onOpenChat}
              />
            ))}
          </ul>
        </section>
      ))}
      {groups.length > GROUPS_SHOWN ? (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          onClick={() => setAllGroups((value) => !value)}
        >
          {allGroups ? "Show fewer" : `Show ${groups.length - GROUPS_SHOWN} more groups`}
        </Button>
      ) : null}
    </div>
  );
}

function PrRow(props: {
  readonly pr: DeskPr;
  readonly compact: boolean;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenChat: (chat: CardChatState) => void;
}) {
  const { pr } = props;
  const context = [pr.app, prFeature(pr), pr.sprint?.title].filter(Boolean).join(" · ");
  const stageLabel = PR_STAGES.find((stage) => stage.id === pr.stage)?.label;
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-2">
      <button
        type="button"
        className="flex min-w-0 cursor-pointer items-start gap-2 text-left"
        onClick={() => props.onOpenPr(pr)}
      >
        <PrIcon pr={pr} />
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-2 text-sm">{pr.title}</span>
          <span className="truncate text-2xs text-muted-foreground">
            {pr.repo.split("/").pop()}#{pr.number}
            {context && !props.compact ? ` · ${context}` : ""}
          </span>
        </span>
      </button>
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
        {pr.review === "APPROVED" ? (
          <Badge variant="success" size="sm">
            approved
          </Badge>
        ) : pr.review === "CHANGES_REQUESTED" ? (
          <Badge variant="error" size="sm">
            changes requested
          </Badge>
        ) : pr.review === "REVIEW_REQUIRED" ? (
          <Badge variant="info" size="sm">
            needs review
          </Badge>
        ) : null}
        {pr.stage === "unverified" && pr.reasons.length > 0 ? (
          <span className="text-2xs text-muted-foreground">{pr.reasons.join(" · ")}</span>
        ) : null}
        {pr.chats.map((chat) => (
          <button
            key={`${chat.environmentId}:${chat.threadId}`}
            type="button"
            className="max-w-56 cursor-pointer"
            onClick={() => props.onOpenChat(chat)}
          >
            <Badge variant={chatStatus(chat).tone} size="sm">
              <span className="truncate">
                {chatStatus(chat).label} · {chat.title}
              </span>
            </Badge>
          </button>
        ))}
      </span>
    </li>
  );
}

function PrIcon(props: { readonly pr: DeskPr }) {
  const Icon = props.pr.draft
    ? PullRequestGlyph.draft
    : props.pr.mergeable === "conflicting"
      ? PullRequestGlyph.conflicting
      : PullRequestGlyph.pullRequest;
  return <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
}
