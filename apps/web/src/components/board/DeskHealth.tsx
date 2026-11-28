/**
 * Fleet fork: the Health tab. The hub's audit of the Desk (items, planners, his to-dos, story
 * leads, helpers, decisions) against the dev-desk rules, plus what only the Board can see: chats
 * left open on finished work, which it settles in one go.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import type { CardChatState } from "./boardCards.logic";
import { chatTitle, type DeskItem } from "./desk.logic";
import { chatFocus, type DeskNotes } from "./deskNotes.logic";
import { DeskHeading, openExternal } from "./DeskParts";

interface AuditFinding {
  readonly kind: string;
  readonly app: string | null;
  readonly rule: string;
  readonly detail: string;
  readonly fix: string;
  readonly url?: string;
  readonly threadId?: string;
}

interface AuditResult {
  readonly findings: ReadonlyArray<AuditFinding>;
  readonly tidy: {
    readonly at: string | null;
    readonly changes: ReadonlyArray<{ field: string; value: string }>;
  };
}

const GROUP_TITLE: Record<string, string> = {
  "To-do": "Your to-dos",
  Decision: "Your decision cards",
  Item: "Items",
};
const GROUP_NOTE: Record<string, string> = {
  "To-do": "Your to-dos the planner needs to fix (steps missing, a page that can't open beside).",
  Decision: "Answer them, or the planner retires the ones overtaken.",
  Planner: "Planner problems. The ones about a missing planner are your call.",
};

const KINDS = ["To-do", "Decision", "Planner", "Story lead", "Quick fix", "Helper", "Item"];

function useAudit(): AuditResult | null {
  const [result, setResult] = useState<AuditResult | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the hub's audit while the tab is open
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/fleet/desk/audit", { signal: AbortSignal.timeout(15_000) })
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (body: AuditResult | null) => {
            if (live && body) setResult(body);
          },
          () => undefined,
        );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return result;
}

function refOf(url: string | undefined): string | null {
  const match = url?.match(/github\.com\/[^/]+\/([^/]+)\/(?:issues|pull)\/(\d+)/);
  return match ? `${match[1]}#${match[2]}` : null;
}

export function HealthView(props: {
  readonly chats: ReadonlyArray<CardChatState>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly app: string | null;
  readonly nowMs: number;
  readonly onOpenChat: (chat: CardChatState) => void;
  /** Opens one of his to-dos (by its planner and text) on the Do page. */
  readonly onOpenTodo: (threadId: string, text: string) => void;
}) {
  const audit = useAudit();
  const { settleThread } = useThreadActions();
  const [settling, setSettling] = useState(false);
  const byUrl = new Map(props.items.map((item) => [item.url, item]));
  const chatById = new Map(props.chats.map((chat) => [chat.threadId, chat]));

  // Chats still open on an item that's closed or Done (the wrap-up nobody did), and helpers
  // quiet for three days or whose parent's item is finished.
  const isFinished = (url: string | null) => {
    const item = url ? byUrl.get(url) : undefined;
    return item !== undefined && (item.state !== "open" || item.status === "Done");
  };
  const finished = props.chats.filter((chat) => {
    if (chat.working || chat.needsYou) return false;
    const work = props.notes.work[chat.threadId];
    if (work?.role === "helper") {
      if (props.app && work.app !== props.app) return false;
      const quiet = props.nowMs - Date.parse(work.updatedAt) > 3 * 86_400_000;
      const parentDone = work.parent ? isFinished(chatFocus(props.notes, work.parent)) : false;
      return quiet || parentDone;
    }
    const url = chatFocus(props.notes, chat.threadId);
    const item = url ? byUrl.get(url) : undefined;
    if (!item || (props.app && item.app !== props.app)) return false;
    return item.state !== "open" || item.status === "Done";
  });
  const settleAll = async () => {
    setSettling(true);
    let done = 0;
    for (const chat of finished) {
      try {
        await settleThread(
          scopeThreadRef(chat.environmentId as EnvironmentId, chat.threadId as ThreadId),
        );
        done += 1;
      } catch {
        // A machine that's off: the chat stays for the next pass.
      }
    }
    setSettling(false);
    toastManager.add({
      type: done === finished.length ? "success" : "warning",
      title: `Settled ${done} of ${finished.length} chats`,
      description: "They're under Settled chats if you need one back.",
    });
  };

  const findings = (audit?.findings ?? []).filter(
    (finding) => !props.app || finding.app === props.app,
  );
  const groups = KINDS.map((kind) => ({
    kind,
    entries: findings.filter((finding) => finding.kind === kind),
  })).filter((group) => group.entries.length > 0);
  const tidied = audit?.tidy.changes.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3 pb-6 scrollbar-gutter-both">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <section className="flex flex-col gap-1">
          <p className="text-base font-semibold">
            {audit === null
              ? "Checking the Desk…"
              : findings.length + finished.length === 0
                ? "Everything matches the rules."
                : `${findings.length + finished.length} things off${props.app ? ` on ${props.app}` : ""}`}
          </p>
          <p className="text-xs text-muted-foreground">
            The same checks run for every planner at each checklist update, so agents fix their own.
            {tidied > 0 && audit?.tidy.at
              ? ` The hub fixed ${tidied} fields itself at ${new Date(audit.tidy.at).toLocaleTimeString()} (apps from repos, statuses).`
              : ""}
          </p>
        </section>

        {finished.length > 0 ? (
          <section className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Your move</span>
              <span className="text-sm">
                {finished.length} chats still open on finished work, or helpers gone quiet.
              </span>
              <Button size="sm" disabled={settling} onClick={() => void settleAll()}>
                {settling ? "Settling…" : `Settle these ${finished.length} →`}
              </Button>
            </div>
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {finished.map((chat) => (
                <li key={chat.threadId}>
                  <button
                    type="button"
                    className="cursor-pointer hover:underline"
                    onClick={() => props.onOpenChat(chat)}
                  >
                    {chatTitle(chat.title)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {groups.map((group) => (
          <section key={group.kind} className="flex flex-col gap-1">
            <DeskHeading>
              {GROUP_TITLE[group.kind] ?? group.kind} · {group.entries.length}
            </DeskHeading>
            <p className="text-xs text-muted-foreground">
              {GROUP_NOTE[group.kind] ?? "Agents fix these at their next checklist update."}
            </p>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {group.entries.slice(0, 60).map((finding) => {
                const ref = refOf(finding.url);
                const chat = finding.threadId ? chatById.get(finding.threadId) : undefined;
                if (group.kind === "To-do" && finding.threadId) {
                  const threadId = finding.threadId;
                  return (
                    <li
                      key={`${threadId}:${finding.detail}:${finding.rule}`}
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{finding.detail}</span>
                      {!props.app && finding.app ? (
                        <Badge variant="outline" size="sm">
                          {finding.app}
                        </Badge>
                      ) : null}
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => props.onOpenTodo(threadId, finding.detail)}
                      >
                        Do it →
                      </Button>
                      <span className="w-full text-xs text-muted-foreground">
                        {finding.rule.toLowerCase().startsWith("waiting")
                          ? `${finding.rule}${ref ? ` · ${ref}` : ""}`
                          : `${finding.rule}: the planner fixes this`}
                      </span>
                    </li>
                  );
                }
                return (
                  <li
                    key={`${finding.rule}:${finding.url ?? ""}:${finding.threadId ?? ""}:${finding.detail}`}
                    className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-sm"
                  >
                    <span className="font-medium">{finding.rule}</span>
                    {ref ? (
                      <button
                        type="button"
                        className="cursor-pointer text-xs text-primary hover:underline"
                        onClick={() => finding.url && openExternal(finding.url)}
                      >
                        {ref}
                      </button>
                    ) : null}
                    {finding.detail ? (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {finding.detail}
                      </span>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {!props.app && finding.app ? (
                      <Badge variant="outline" size="sm">
                        {finding.app}
                      </Badge>
                    ) : null}
                    <span className="w-full text-xs text-muted-foreground">
                      → {finding.fix}
                      {chat ? (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className="cursor-pointer text-primary hover:underline"
                            onClick={() => props.onOpenChat(chat)}
                          >
                            open the chat
                          </button>
                        </>
                      ) : null}
                    </span>
                  </li>
                );
              })}
              {group.entries.length > 60 ? (
                <li className="px-3 py-1.5 text-xs text-muted-foreground">
                  … {group.entries.length - 60} more. Pick an app above to narrow it.
                </li>
              ) : null}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
