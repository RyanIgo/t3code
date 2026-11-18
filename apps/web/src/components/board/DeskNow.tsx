import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "../ui/badge";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus, chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import { isDependencyUpdate, type DeskPr } from "./deskPrs.logic";
import { DeskHeading, openExternal } from "./DeskParts";

/** A hub test sheet with checks still to do. */
interface SheetSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  /** The chat that published it, when it was published from one. */
  readonly thread: { readonly threadId: string } | null;
  readonly counts: {
    readonly total: number;
    readonly pass: number;
    readonly fail: number;
    readonly skip: number;
    readonly blocked: number;
  };
}

const SHEET_DAYS = 14;
const SHEET_POLL_MS = 60_000;

/** Test sheets on the hub with unchecked rows, changed in the last two weeks, newest first. */
function useSheetsToTest(nowMs: number): SheetSummary[] {
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the hub's artifact list for test sheets while Now is open
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/fleet/artifacts", { signal: AbortSignal.timeout(10_000) })
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (body: { artifacts?: Array<SheetSummary & { kind: string }> } | null) => {
            if (live && body?.artifacts) {
              setSheets(body.artifacts.filter((artifact) => artifact.kind === "sheet"));
            }
          },
          () => undefined,
        );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, SHEET_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return sheets
    .filter((sheet) => {
      const { total, pass, fail, skip, blocked } = sheet.counts;
      return (
        total > pass + fail + skip + blocked &&
        nowMs - Date.parse(sheet.updatedAt) < SHEET_DAYS * 86_400_000
      );
    })
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function ago(nowMs: number, iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

const PR_LABEL = {
  ready: { label: "Merge", tone: "success" },
  landed: { label: "Close", tone: "secondary" },
  fix: { label: "Send back", tone: "error" },
} as const;

/**
 * Fleet fork: the Now tab. At a glance, what agents are working on and where Rigo is needed:
 * to review (questions, approvals, results), to test (sheets with checks to do) and to merge.
 */
export function NowView(props: {
  readonly app: string | null;
  readonly nowMs: number;
  readonly chats: ReadonlyArray<CardChatState>;
  /** Items waiting on Rigo outside chats (blocked, PRs in review). */
  readonly waiting: ReadonlyArray<DeskItem>;
  readonly prs: ReadonlyArray<DeskPr>;
  readonly appOf: (chat: CardChatState) => string | null;
  readonly pinned: ReactNode;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
}) {
  // With an app chosen: sheets published from that app's chats, or naming the app.
  const sheets = useSheetsToTest(props.nowMs).filter(
    (sheet) =>
      props.app === null ||
      props.chats.some((chat) => chat.threadId === sheet.thread?.threadId) ||
      sheet.title.toLowerCase().includes(props.app.toLowerCase()),
  );
  const working = props.chats
    .filter((chat) => chat.working)
    .toSorted((a, b) => Date.parse(a.since ?? "") - Date.parse(b.since ?? ""));
  const asking = props.chats.filter((chat) => chat.needsYou);
  const results = props.chats.filter((chat) => !chat.needsYou && chat.column === "done");
  const prs = props.prs.filter(
    (pr) =>
      (pr.stage === "ready" || pr.stage === "landed" || pr.stage === "fix") &&
      !isDependencyUpdate(pr),
  );
  const bumps = props.prs.filter((pr) => pr.stage === "ready" && isDependencyUpdate(pr)).length;
  const reviewCount = asking.length + results.length + props.waiting.length;
  const chatRow = (
    chat: CardChatState,
    label: string,
    tone: ReturnType<typeof chatStatus>["tone"],
  ) => (
    <Row
      key={`${chat.environmentId}:${chat.threadId}`}
      badge={label}
      tone={tone}
      title={chatTitle(chat.title)}
      meta={[props.appOf(chat), ago(props.nowMs, chat.since)].filter(Boolean).join(" · ")}
      onClick={() => props.onOpenChat(chat)}
    />
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{props.app ? `Now in ${props.app}` : "Now"}</h2>
        <span className="text-xs text-muted-foreground">
          {working.length} working · {reviewCount} to review · {sheets.length} to test ·{" "}
          {prs.length} to merge or send back
        </span>
      </header>
      {props.pinned}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Column
          title="Working"
          count={working.length}
          hint="Agents running right now"
          empty="No agent is running."
        >
          {working.map((chat) => chatRow(chat, "Working", "info"))}
        </Column>
        <Column
          title="Review"
          count={reviewCount}
          hint="Questions, approvals and results"
          empty="Nothing waiting for your review."
        >
          {asking.map((chat) =>
            chatRow(
              chat,
              chat.asking === "subagent approval"
                ? "Subagent approval"
                : chat.asking === "approval"
                  ? "Approve"
                  : chat.asking === "question"
                    ? "Answer"
                    : "Needs you",
              "warning",
            ),
          )}
          {results.map((chat) => chatRow(chat, "Result", "success"))}
          {props.waiting.map((item) => (
            <Row
              key={item.itemId}
              badge={item.lane === "Blocked" ? "Blocked" : "Review"}
              tone={item.lane === "Blocked" ? "error" : "info"}
              title={deskTitle(item)}
              meta={[item.app, deskRef(item)].filter(Boolean).join(" · ")}
              onClick={() => props.onOpenItem(item)}
            />
          ))}
        </Column>
        <Column
          title="Test"
          count={sheets.length}
          hint="Test sheets with checks to do"
          empty="No test sheets waiting."
        >
          {sheets.map((sheet) => {
            const { total, pass, fail, skip, blocked } = sheet.counts;
            return (
              <Row
                key={sheet.id}
                badge={`${pass + fail + skip + blocked} of ${total}`}
                tone={fail > 0 ? "error" : "outline"}
                title={sheet.title}
                meta={ago(props.nowMs, sheet.updatedAt)}
                onClick={() =>
                  openExternal(new URL(`/a/${sheet.id}`, window.location.origin).toString())
                }
              />
            );
          })}
        </Column>
        <Column
          title="Merge"
          count={prs.length}
          hint={
            bumps > 0
              ? `PRs to merge, close or send back · plus ${bumps} version bumps`
              : "PRs to merge, close or send back"
          }
          empty="No pull request waiting on you."
        >
          {prs.map((pr) => {
            const stage = PR_LABEL[pr.stage as keyof typeof PR_LABEL];
            return (
              <Row
                key={pr.url}
                badge={stage.label}
                tone={stage.tone}
                title={pr.title}
                meta={[pr.app, `${pr.repo.split("/").pop()}#${pr.number}`]
                  .filter(Boolean)
                  .join(" · ")}
                onClick={() => props.onOpenPr(pr)}
              />
            );
          })}
        </Column>
      </div>
    </div>
  );
}

function Column(props: {
  readonly title: string;
  readonly count: number;
  readonly hint: string;
  readonly empty: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={props.title}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2"
    >
      <header className="px-1 pt-1">
        <DeskHeading>
          {props.title} · {props.count}
        </DeskHeading>
        <p className="text-2xs text-muted-foreground">{props.hint}</p>
      </header>
      {props.count === 0 ? (
        <p className="px-1 pb-1 text-xs text-muted-foreground">{props.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">{props.children}</ul>
      )}
    </section>
  );
}

function Row(props: {
  readonly badge: string;
  readonly tone: "success" | "error" | "warning" | "info" | "outline" | "secondary";
  readonly title: string;
  readonly meta: string;
  readonly onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={props.onClick}
        className="flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-2 text-left hover:border-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Badge variant={props.tone} size="sm">
            {props.badge}
          </Badge>
          <span className="truncate text-2xs text-muted-foreground">{props.meta}</span>
        </span>
        <span className="line-clamp-2 text-sm">{props.title}</span>
      </button>
    </li>
  );
}
