import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CheckCheckIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { readLocalApi } from "../../localApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import type { CardChatState } from "./boardCards.logic";
import { chatTitle, type DeskItem, deskRef } from "./desk.logic";
import { DeskHeading, openExternal } from "./DeskParts";
import { setDeskField } from "./deskStore";

export interface StatusChange {
  readonly itemId: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Fleet fork: when GitHub's Status lags what the board shows (an open PR, a chat working, a closed
 * item), one bar lists the changes and makes them together once Rigo approves the list.
 */
export function StatusSyncBar(props: { readonly changes: ReadonlyArray<StatusChange> }) {
  const [busy, setBusy] = useState(false);
  const update = async () => {
    const list = props.changes.map((change) => `${change.label}: ${change.from} → ${change.to}`);
    const confirmed = await readLocalApi()?.dialogs.confirm(
      [`Update ${props.changes.length} statuses on GitHub?`, ...list.slice(0, 20)]
        .concat(list.length > 20 ? [`…and ${list.length - 20} more`] : [])
        .join("\n"),
    );
    if (!confirmed) return;
    setBusy(true);
    for (const change of props.changes) {
      await setDeskField(change.itemId, "Status", change.to);
    }
    setBusy(false);
    toastManager.add({ type: "success", title: `Updated ${props.changes.length} statuses` });
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      <RefreshCwIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        {props.changes.length} {props.changes.length === 1 ? "status is" : "statuses are"} behind
        the board on GitHub, so agents and the Claude connector see old states.
      </span>
      <Button size="xs" className="ms-auto" disabled={busy} onClick={() => void update()}>
        {busy ? "Updating…" : "Review and update"}
      </Button>
    </div>
  );
}

/**
 * Fleet fork: what stands between a closed item and Done, each with the step that clears it:
 * open the PR, read or settle the chat, finish the test sheet, tick the criteria on GitHub.
 */
export function WrapUpPanel(props: {
  readonly item: DeskItem;
  /** The item's chats that aren't settled. */
  readonly chats: ReadonlyArray<CardChatState>;
  readonly sheet: { readonly unchecked: number; readonly failed: number } | null;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onReview: () => void;
}) {
  const { settleThread } = useThreadActions();
  const openPrs = props.item.pullRequests.filter(
    (pr) => pr.state === "open" || pr.state === "draft",
  );
  const unticked = props.item.story?.criteria.filter((criterion) => !criterion.done).length ?? 0;
  const loose = props.chats.filter(
    (chat) => chat.needsYou || chat.working || chat.column === "done",
  );
  const settleable = props.chats.filter((chat) => !chat.working);
  const settle = async (chats: ReadonlyArray<CardChatState>) => {
    for (const chat of chats) {
      await settleThread(
        scopeThreadRef(chat.environmentId as EnvironmentId, chat.threadId as ThreadId),
      );
    }
  };
  return (
    <section
      aria-label="Wrap up"
      className="mx-3 mt-3 flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warning" size="sm">
          Done, needs wrap-up
        </Badge>
        <span className="text-muted-foreground">
          {deskRef(props.item) ?? "This item"} counts as Done once these are cleared.
        </span>
        {settleable.length > 0 ? (
          <Button
            size="xs"
            variant="outline"
            className="ms-auto"
            onClick={() => void settle(settleable)}
          >
            <CheckCheckIcon />
            Settle {settleable.length === 1 ? "its chat" : `its ${settleable.length} chats`}
          </Button>
        ) : null}
      </div>
      <DeskHeading>Left to do</DeskHeading>
      <ul className="flex flex-col gap-1.5">
        {props.item.state === "open" ? (
          <li className="flex flex-wrap items-center gap-2">
            <span>The issue is still open on GitHub.</span>
            {props.item.url ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => props.item.url && openExternal(props.item.url)}
              >
                Close it on GitHub
              </Button>
            ) : null}
          </li>
        ) : null}
        {openPrs.map((pr) => (
          <li key={pr.url} className="flex flex-wrap items-center gap-2">
            <span>PR #{pr.number} is still open: merge it or close it.</span>
            <Button size="xs" variant="ghost" onClick={() => openExternal(pr.url)}>
              Open PR
            </Button>
          </li>
        ))}
        {loose.map((chat) => (
          <li key={chat.threadId} className="flex flex-wrap items-center gap-2">
            <span>
              "{chatTitle(chat.title)}"{" "}
              {chat.needsYou
                ? "is waiting on you."
                : chat.working
                  ? "is still working."
                  : "has a result to read."}
            </span>
            <Button size="xs" variant="ghost" onClick={() => props.onOpenChat(chat)}>
              Open
            </Button>
            {chat.working ? null : (
              <Button size="xs" variant="ghost" onClick={() => void settle([chat])}>
                Settle
              </Button>
            )}
          </li>
        ))}
        {props.sheet && props.sheet.unchecked + props.sheet.failed > 0 ? (
          <li className="flex flex-wrap items-center gap-2">
            <span>
              The test sheet has{" "}
              {[
                props.sheet.unchecked ? `${props.sheet.unchecked} checks not done` : null,
                props.sheet.failed ? `${props.sheet.failed} failed or blocked` : null,
              ]
                .filter(Boolean)
                .join(" and ")}
              .
            </span>
            <Button size="xs" variant="ghost" onClick={props.onReview}>
              Go to Review
            </Button>
          </li>
        ) : null}
        {unticked > 0 ? (
          <li className="flex flex-wrap items-center gap-2">
            <span>
              {unticked} acceptance {unticked === 1 ? "criterion isn't" : "criteria aren't"} ticked.
              Tick the ones that hold on the issue, or move the rest to a new item.
            </span>
            {props.item.url ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => props.item.url && openExternal(props.item.url)}
              >
                Open on GitHub
              </Button>
            ) : null}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
