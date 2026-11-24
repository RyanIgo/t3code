import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { CalendarCheckIcon, CheckCheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useThreadActions } from "../../hooks/useThreadActions";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { environmentSummaries } from "../../state/presentation";
import { Badge } from "../ui/badge";
import { AppDot, deskLevel, LEVELS, LevelIcon, VerbChip } from "./deskLevels";
import { Button } from "../ui/button";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus, chatTitle, deskTitle } from "./desk.logic";
import { deskFragment } from "./deskChat.logic";
import { useOpenDesk } from "./DeskChat";
import { useDeskNotes } from "./deskNotesStore";
import { CHAT_ROLE_LABEL } from "./deskNotes.logic";
import { useDesk } from "./deskStore";
import { formatFleetBoardAge, minuteTickToMs } from "./fleetBoard.logic";
import { buildWorkSidebar, type WorkRow } from "./sidebarWork.logic";
import { useCardChats } from "./useCardChats";

/**
 * Fleet fork: the sidebar's Work view. Open chats grouped like the Board (the day's chat, what
 * waits on Rigo, each app's planners and work, chats on no item, finished chats to settle), each
 * named by the item it's on. A row with an item opens that item's window; any other row the chat.
 */
export function SidebarWork() {
  const chats = useCardChats(false);
  const desk = useDesk();
  const notes = useDeskNotes().notes;
  const groups = useSidebarProjectGroups();
  const environments = useAtomValue(environmentSummaries.environmentsAtom);
  const nowMs = minuteTickToMs(useNowMinute());
  const navigate = useNavigate();
  const openDesk = useOpenDesk();
  const activeThread = useRouterState({
    select: (state) => {
      const params = state.matches.at(-1)?.params as { threadId?: string } | undefined;
      return params?.threadId ?? null;
    },
  });
  const { settleThread } = useThreadActions();
  const items = desk.view?.items ?? [];
  const machine = new Map(
    environments.map((environment) => [environment.environmentId, environment.environmentLabel]),
  );
  const repoName = new Map(
    groups.map((group) => [group.projectKey, group.displayName.split("/").pop() ?? ""]),
  );
  const repoOf = (chat: CardChatState) =>
    chat.projectKey ? (repoName.get(chat.projectKey) ?? null) : null;
  // A repo belongs to the app that owns most of its items.
  const counts = new Map<string, Map<string, number>>();
  for (const item of items) {
    const repo = item.repo?.split("/").pop();
    if (!repo || !item.app) continue;
    const byApp = counts.get(repo) ?? new Map<string, number>();
    byApp.set(item.app, (byApp.get(item.app) ?? 0) + 1);
    counts.set(repo, byApp);
  }
  const appOfRepo = (chat: CardChatState) => {
    const repo = repoOf(chat);
    const byApp = repo ? counts.get(repo) : undefined;
    return byApp ? ([...byApp].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null;
  };
  const view = buildWorkSidebar({
    chats,
    items,
    notes,
    apps: desk.view?.apps ?? [],
    appOfRepo,
    repoOf,
    nowMs,
  });

  const open = (row: WorkRow) => {
    if (row.item?.url) {
      const fragment = deskFragment({
        kind: "item",
        view: null,
        feature: null,
        app: row.item.app,
        sprint: null,
        itemUrl: row.item.url,
      });
      openDesk(fragment);
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: row.chat.environmentId, threadId: row.chat.threadId },
    });
  };
  const settleAll = async () => {
    const confirmed = await readLocalApi()?.dialogs.confirm(
      `Settle ${view.wrapUp.length} finished chats? They leave this list; you can still find them in search and unsettle them.`,
    );
    if (!confirmed) return;
    for (const row of view.wrapUp) {
      await settleThread(
        scopeThreadRef(row.chat.environmentId as EnvironmentId, row.chat.threadId as ThreadId),
      );
    }
  };

  const row = (entry: WorkRow, options: { readonly showApp?: boolean } = {}) => {
    const status = chatStatus(entry.chat);
    const age = formatFleetBoardAge(entry.chat.since, nowMs);
    const level = deskLevel(entry.role, entry.item);
    return (
      <li key={`${entry.chat.environmentId}:${entry.chat.threadId}`}>
        <button
          type="button"
          onClick={() => open(entry)}
          className={cn(
            "flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border-s-2 border-transparent px-2 py-1.5 text-left hover:bg-accent",
            level && LEVELS[level].edge,
            entry.parent && "ms-4",
            activeThread === entry.chat.threadId && "bg-accent",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            {level ? <LevelIcon level={level} /> : null}
            <span className="min-w-0 flex-1 truncate">
              {entry.item
                ? `${entry.item.number !== null ? `#${entry.item.number} ` : ""}${deskTitle(entry.item)}`
                : chatTitle(entry.chat.title)}
            </span>
            <span className="shrink-0">
              {entry.chat.needsYou ? (
                <VerbChip verb="Needs you" className="w-auto" />
              ) : (
                <Badge variant={status.tone} size="sm">
                  {status.label}
                </Badge>
              )}
            </span>
          </span>
          <span className="truncate text-2xs text-muted-foreground">
            {[
              level ? LEVELS[level].label : entry.role ? CHAT_ROLE_LABEL[entry.role] : "No role",
              options.showApp ? entry.app : null,
              entry.item ? chatTitle(entry.chat.title) : null,
              machine.get(entry.chat.environmentId as EnvironmentId) ?? null,
              age ? `${age} ago` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
      </li>
    );
  };
  const section = (
    title: string,
    count: number,
    children: ReactNode,
    action?: ReactNode,
    app?: string,
  ) => (
    <section key={title} className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 px-2 pt-3 pb-1">
        {app ? <AppDot app={app} /> : null}
        <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title} · {count}
        </h3>
        {action ? <span className="ms-auto">{action}</span> : null}
      </div>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );

  if (!desk.view && desk.loading) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading your work…</p>;
  }
  return (
    <div className="flex flex-col px-1 pb-4">
      {view.today ? (
        <div className="px-1 pt-2">
          <button
            type="button"
            onClick={() =>
              view.today &&
              void navigate({
                to: "/$environmentId/$threadId",
                params: {
                  environmentId: view.today.chat.environmentId,
                  threadId: view.today.chat.threadId,
                },
              })
            }
            className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <CalendarCheckIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{chatTitle(view.today.chat.title)}</span>
            <Badge variant={chatStatus(view.today.chat).tone} size="sm">
              {chatStatus(view.today.chat).label}
            </Badge>
          </button>
        </div>
      ) : null}
      {view.needsYou.length > 0
        ? section(
            "Needs you",
            view.needsYou.length,
            view.needsYou.map((entry) => row(entry, { showApp: true })),
          )
        : null}
      {view.apps.map((group) =>
        section(
          group.app,
          group.planners.length + group.work.length + group.loose.length,
          <>
            {group.planners.map((entry) => row(entry))}
            {group.work.map((entry) => row(entry))}
            {group.loose.length > 0 ? (
              <li>
                <details>
                  <summary className="cursor-pointer px-2 py-1 text-xs text-muted-foreground">
                    Not on an item · {group.loose.length}
                  </summary>
                  <ul className="flex flex-col">{group.loose.map((entry) => row(entry))}</ul>
                </details>
              </li>
            ) : null}
          </>,
          undefined,
          group.app,
        ),
      )}
      {view.wrapUp.length > 0 ? (
        <details className="mt-2">
          <summary className="flex cursor-pointer items-center gap-2 px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            Wrap up · {view.wrapUp.length}
          </summary>
          <p className="px-2 pb-1 text-2xs text-muted-foreground">
            Their item is done or their PRs merged. Settle them to clear this list.
          </p>
          <div className="px-2 pb-1">
            <Button size="xs" variant="outline" onClick={() => void settleAll()}>
              <CheckCheckIcon />
              Settle all
            </Button>
          </div>
          <ul className="flex flex-col">
            {view.wrapUp.map((entry) => row(entry, { showApp: true }))}
          </ul>
        </details>
      ) : null}
      {chats.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No open chats.</p>
      ) : null}
    </div>
  );
}
