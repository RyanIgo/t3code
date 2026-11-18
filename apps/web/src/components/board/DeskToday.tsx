import type { ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus, chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import type { AppFocus, Catchup } from "./deskFocus.logic";
import { DeskHeading } from "./DeskParts";

/**
 * Fleet fork: the board's first tab, for deciding. Who's waiting for an answer, what result to
 * look at, what can merge, and what in this sprint isn't moving. Empty means nothing waits on you.
 */
export function TodayView(props: {
  /** The app the board is filtered to, or null for all of them. */
  readonly app: string | null;
  /** Across all apps: one row per app, the most urgent first. */
  readonly focus: ReadonlyArray<AppFocus>;
  readonly onPickApp: (app: string | null) => void;
  /** The chats pinned to Today (or to the app Today is filtered to). */
  readonly pinned: ReactNode;
  /** What finished or started asking since the user last caught up. */
  readonly catchup: Catchup;
  readonly caughtUpAt: number;
  readonly onCaughtUp: () => void;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly repoOf: (chat: CardChatState) => string | null;
  readonly answer: ReactNode;
  readonly review: ReactNode;
  readonly prs: ReactNode;
  /** Version bumps ready to merge, hidden unless asked for. */
  readonly bumps: number;
  readonly showBumps: boolean;
  readonly onToggleBumps: () => void;
  /** This sprint's unfinished work with no agent on it. */
  readonly stalled: ReadonlyArray<DeskItem>;
  readonly card: (item: DeskItem) => ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
        <h2 className="text-lg font-semibold">
          {props.app ? `Today in ${props.app}` : "Today across all applications"}
        </h2>
        <span className="text-xs text-muted-foreground">
          {props.app ? "Only this application." : "What needs your answer or your click."}
        </span>
        {props.app ? (
          <Button variant="ghost" size="xs" onClick={() => props.onPickApp(null)}>
            Show all applications
          </Button>
        ) : null}
      </header>
      <div className="px-4">{props.pinned}</div>
      <CatchupSection
        catchup={props.catchup}
        caughtUpAt={props.caughtUpAt}
        onCaughtUp={props.onCaughtUp}
        onOpenChat={props.onOpenChat}
        onOpenItem={props.onOpenItem}
        repoOf={props.repoOf}
      />
      {props.app === null && props.focus.length > 0 ? (
        <FocusTable rows={props.focus} onPick={props.onPickApp} />
      ) : null}
      <div className="grid grid-cols-1 gap-5 px-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          {props.answer}
          {props.review}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-label="Merge or send back" className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <DeskHeading>Merge or send back</DeskHeading>
              {props.bumps > 0 ? (
                <Button variant="ghost" size="xs" onClick={props.onToggleBumps}>
                  {props.showBumps ? "Hide" : "Show"} {props.bumps} version bump
                  {props.bumps === 1 ? "" : "s"}
                </Button>
              ) : null}
            </div>
            {props.prs}
          </section>
          <section aria-label="Stalled" className="flex flex-col gap-2">
            <DeskHeading>Stalled · {props.stalled.length}</DeskHeading>
            <p className="text-2xs text-muted-foreground">
              In this sprint, not done, and no agent on it.
            </p>
            {props.stalled.length === 0 ? (
              <p className="text-xs text-muted-foreground">Everything in the sprint is moving.</p>
            ) : (
              <ol className="flex flex-col gap-2">{props.stalled.map(props.card)}</ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const COUNTS: ReadonlyArray<{
  readonly key: "needsYou" | "prsToFix" | "prsReady" | "noAgent" | "blocked";
  readonly label: string;
  readonly tone: "warning" | "error" | "success" | "info";
}> = [
  { key: "needsYou", label: "Needs you", tone: "warning" },
  { key: "prsToFix", label: "PRs to fix", tone: "error" },
  { key: "prsReady", label: "Ready to merge", tone: "success" },
  { key: "noAgent", label: "No agent", tone: "info" },
  { key: "blocked", label: "Blocked", tone: "error" },
];

/** Where to look first: each application's counts, the most urgent first. Click to focus. */
function FocusTable(props: {
  readonly rows: ReadonlyArray<AppFocus>;
  readonly onPick: (app: string) => void;
}) {
  return (
    <section
      aria-label="Where to focus"
      className="mx-4 shrink-0 overflow-x-auto rounded-lg border border-border"
    >
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-2xs tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 font-semibold">Application</th>
            {COUNTS.map((count) => (
              <th key={count.key} className="px-2 py-2 text-center font-semibold">
                {count.label}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-semibold">Sprint</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.app} className="border-t border-border hover:bg-muted/40">
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  className="cursor-pointer text-left font-medium hover:underline"
                  onClick={() => props.onPick(row.app)}
                >
                  {row.app}
                </button>
              </td>
              {COUNTS.map((count) => (
                <td key={count.key} className="px-2 py-1.5 text-center tabular-nums">
                  {row[count.key] > 0 ? (
                    <Badge variant={count.tone} size="sm">
                      {row[count.key]}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                {row.sprintTotal > 0 ? `${row.sprintDone} of ${row.sprintTotal} done` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const CATCHUP_SHOWN = 8;

/** Since the user last caught up: chats that finished or asked something, and closed items. */
function CatchupSection(props: {
  readonly catchup: Catchup;
  readonly caughtUpAt: number;
  readonly onCaughtUp: () => void;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly repoOf: (chat: CardChatState) => string | null;
}) {
  const { chats, closed } = props.catchup;
  const total = chats.length + closed.length;
  const since = new Date(props.caughtUpAt).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <section
      aria-label="Since you last caught up"
      className="mx-4 flex shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <DeskHeading>
          Since {since} · {total === 0 ? "nothing new" : `${total} new`}
        </DeskHeading>
        {total > 0 ? (
          <Button variant="ghost" size="xs" onClick={props.onCaughtUp}>
            I'm caught up
          </Button>
        ) : null}
      </div>
      {total > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {chats.slice(0, CATCHUP_SHOWN).map((chat) => (
            <li key={`${chat.environmentId}:${chat.threadId}`} className="flex items-center gap-2">
              <Badge variant={chatStatus(chat).tone} size="sm">
                {chatStatus(chat).label}
              </Badge>
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate text-left hover:underline"
                onClick={() => props.onOpenChat(chat)}
              >
                {chatTitle(chat.title)}
              </button>
              {props.repoOf(chat) ? (
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {props.repoOf(chat)}
                </span>
              ) : null}
            </li>
          ))}
          {closed.slice(0, CATCHUP_SHOWN).map((item) => (
            <li key={item.itemId} className="flex items-center gap-2">
              <Badge variant="success" size="sm">
                Closed
              </Badge>
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate text-left hover:underline"
                onClick={() => props.onOpenItem(item)}
              >
                {deskTitle(item)}
              </button>
              <span className="shrink-0 text-2xs text-muted-foreground">{deskRef(item)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
