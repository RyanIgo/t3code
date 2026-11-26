/**
 * Fleet fork: the Do page, one T3 page for doing a planner's to-do, laid out like the Test page.
 * Left: the to-do (why, steps, links, Done, Ask). Right: the planner chat's browser, which the
 * to-do's links open in as tabs; sign-in sites (a passkey can't reach a headless browser) open
 * in his own browser instead.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { type ReactNode, useState } from "react";

import { selectThreadTerminalUiState, useTerminalUiStateStore } from "~/terminalUiStateStore";
import ChatView from "../ChatView";
import { ChatPeekContext, ChatWorkbenchContext } from "../chat/ChatEmbedContext";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";
import type { DeskPr } from "./deskPrs.logic";
import type { DeskNotes, PlannerTodo } from "./deskNotes.logic";
import { TodoBody } from "./DeskSprintCockpit";
import { isDevAddress, useThreadBrowser } from "./DeskTest";

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
  const openBeside = useThreadBrowser(threadRef);
  const terminal = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef),
  );
  const showTerminal = (open: boolean) => {
    if (threadRef) useTerminalUiStateStore.getState().setTerminalOpen(threadRef, open);
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
      {threadRef ? (
        <Button size="xs" variant="ghost" onClick={() => showTerminal(!terminal.terminalOpen)}>
          {terminal.terminalOpen ? "Hide terminal" : "Terminal"}
        </Button>
      ) : null}
      {planner ? (
        <Button size="xs" variant="outline" onClick={() => setConversation(!conversation)}>
          {conversation ? "Back to the to-do" : "Planner chat"}
        </Button>
      ) : null}
    </div>
  );

  const body: ReactNode = (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
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
          onOpenLink={(url) => void openBeside(url)}
          opensLabel={(url) =>
            threadRef && isDevAddress(url) ? "Opens beside" : "Opens in your browser ↗"
          }
        />
      </div>
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
