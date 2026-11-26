/**
 * Fleet fork: the Do page, one T3 page for doing a planner's to-do, laid out like the Test page.
 * Left: the to-do (why, steps, links, Done, Ask). Right: the planner chat's browser, which the
 * to-do's links open in as tabs; sign-in sites (a passkey can't reach a headless browser) open
 * in his own browser instead.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { type ReactNode, useState } from "react";

import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { useThreadRunningTerminalIds } from "~/state/terminalSessions";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "~/terminalUiStateStore";
import { DEFAULT_THREAD_TERMINAL_HEIGHT } from "~/types";
import ChatView from "../ChatView";
import { ChatPeekContext, ChatWorkbenchContext } from "../chat/ChatEmbedContext";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";
import type { DeskPr } from "./deskPrs.logic";
import type { DeskNotes, PlannerTodo } from "./deskNotes.logic";
import { TodoBody } from "./DeskSprintCockpit";
import { isDevAddress, useThreadBrowser } from "./DeskTest";

/** A page the hub serves (/a/<id>), shown inside the Do page rather than in a browser. */
function isHubPage(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/a/");
  } catch {
    return false;
  }
}

export function DoPage(props: {
  readonly todo: PlannerTodo;
  readonly planner: CardChatState | null;
  readonly items: ReadonlyArray<DeskItem>;
  readonly prs: ReadonlyArray<DeskPr>;
  readonly notes: DeskNotes;
  readonly nowMs: number;
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onBack: () => void;
}) {
  const { planner } = props;
  const [conversation, setConversation] = useState(false);
  const threadRef = planner
    ? scopeThreadRef(planner.environmentId as EnvironmentId, planner.threadId as ThreadId)
    : null;
  const openInBrowser = useThreadBrowser(threadRef);
  // Hub pages (draft text, maps, sheets) show inside this page, in his own browser, so their
  // Copy buttons reach his clipboard; the chat's browser runs on another machine.
  const [page, setPage] = useState<string | null>(
    () => (props.todo.line.links ?? []).find(isHubPage) ?? null,
  );
  // Too narrow for a page beside the to-do (the lg breakpoint hides it): a new tab instead.
  const showPage = (url: string) => {
    if (window.innerWidth < 1024) window.open(url, "_blank", "noopener,noreferrer");
    else setPage(url);
  };
  const open = (url: string) => {
    if (isHubPage(url)) showPage(url);
    else void openInBrowser(url);
  };
  const terminal = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef),
  );
  // Commands still running in the chat's terminals (a dev server, a build), as T3's sidebar shows.
  const running = useThreadRunningTerminalIds({
    environmentId: threadRef?.environmentId ?? null,
    threadId: threadRef?.threadId ?? null,
  }).length;
  const runningLabel = running > 0 ? ` · ${running} running` : "";
  const showTerminal = (open: boolean) => {
    if (threadRef) useTerminalUiStateStore.getState().setTerminalOpen(threadRef, open);
  };
  const terminalBig = terminal.terminalHeight > DEFAULT_THREAD_TERMINAL_HEIGHT * 1.5;
  const sizeTerminal = () => {
    if (!threadRef) return;
    useTerminalUiStateStore
      .getState()
      .setTerminalHeight(
        threadRef,
        terminalBig ? DEFAULT_THREAD_TERMINAL_HEIGHT : Math.floor(window.innerHeight * 0.75),
      );
  };
  const panelOpen = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).isOpen,
  );
  // The planner chat's right panel: its browser tabs, files and terminals, as on the Test page.
  const showPanel = (open: boolean) => {
    if (!threadRef) return;
    if (open) useRightPanelStore.getState().openBrowser(threadRef, null);
    else useRightPanelStore.getState().close(threadRef);
  };

  const bar = (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <Button size="xs" variant="ghost" onClick={props.onBack}>
        ← Board
      </Button>
      <Badge variant="warning" size="sm">
        Do
      </Badge>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{props.todo.line.text}</span>
      {props.todo.app ? (
        <span className="shrink-0 text-xs text-muted-foreground max-md:hidden">
          {props.todo.app}
        </span>
      ) : null}
      {threadRef && terminal.terminalOpen ? (
        <>
          <Button size="xs" variant="outline" onClick={sizeTerminal}>
            {terminalBig ? "Shrink terminal" : "Expand terminal"}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => showTerminal(false)}>
            Hide terminal{runningLabel}
          </Button>
        </>
      ) : threadRef ? (
        <Button
          size="xs"
          variant={running > 0 ? "outline" : "ghost"}
          onClick={() => showTerminal(true)}
        >
          Terminal{runningLabel}
        </Button>
      ) : null}
      {threadRef ? (
        <Button size="xs" variant="ghost" onClick={() => showPanel(!panelOpen)}>
          {panelOpen ? "Hide side panel" : "Side panel"}
        </Button>
      ) : null}
      {planner ? (
        <Button size="xs" variant="outline" onClick={() => setConversation(!conversation)}>
          {conversation ? "Back to the to-do" : "Planner chat"}
        </Button>
      ) : null}
    </div>
  );

  const brief: ReactNode = (
    <div
      className={cn(
        "min-h-0 overflow-y-auto scrollbar-gutter-both",
        page ? "w-[min(36rem,45%)] shrink-0 max-lg:w-full" : "flex-1",
      )}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        <TodoBody
          todo={props.todo}
          planner={planner}
          items={props.items}
          prs={props.prs}
          notes={props.notes}
          nowMs={props.nowMs}
          chatsFor={props.chatsFor}
          onOpenChat={props.onOpenChat}
          onOpenPr={props.onOpenPr}
          onOpenItem={props.onOpenItem}
          onClose={props.onBack}
          threadRef={threadRef ?? undefined}
          onOpenLink={open}
          opensLabel={(url) =>
            isHubPage(url)
              ? url === page
                ? "Showing beside"
                : "Opens beside"
              : threadRef && isDevAddress(url)
                ? "Opens in the browser panel"
                : "Opens in your browser ↗"
          }
        />
      </div>
    </div>
  );
  const body: ReactNode = (
    <div
      className="flex min-h-0 flex-1"
      // Links in the steps and answers: hub pages show beside, not in the chat's browser.
      onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (!anchor?.href || !isHubPage(anchor.href)) return;
        event.preventDefault();
        event.stopPropagation();
        showPage(anchor.href);
      }}
    >
      {brief}
      {page ? (
        <section
          aria-label="Page beside the to-do"
          className="flex min-h-0 min-w-0 flex-1 flex-col border-s border-border max-lg:hidden"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{page}</span>
            <a href={page} target="_blank" rel="noopener" className="hover:underline">
              New tab ↗
            </a>
            <Button size="xs" variant="ghost" onClick={() => setPage(null)}>
              Close
            </Button>
          </div>
          {/* oxlint-disable-next-line react/iframe-missing-sandbox -- the hub sandboxes /a/ pages itself */}
          <iframe
            key={page}
            title="Page beside the to-do"
            src={page}
            allow="clipboard-write"
            className="min-h-0 w-full flex-1 border-0 bg-background"
          />
        </section>
      ) : null}
    </div>
  );

  if (!planner) {
    return (
      <div className="flex h-dvh min-h-0 flex-col bg-background">
        <div className="flex shrink-0 border-b border-border px-3 py-2">{bar}</div>
        {body}
      </div>
    );
  }
  // The planner's own T3 page with the to-do in place of the conversation: its browser (the
  // to-do's links, as tabs) and terminal stay where T3 puts them.
  return (
    <ChatPeekContext value>
      <ChatWorkbenchContext value={{ bar, content: conversation ? null : body }}>
        <ChatView
          key={`${planner.environmentId}:${planner.threadId}`}
          environmentId={planner.environmentId as EnvironmentId}
          threadId={planner.threadId as ThreadId}
          routeKind="server"
          reserveTitleBarControlInset={false}
        />
      </ChatWorkbenchContext>
    </ChatPeekContext>
  );
}
