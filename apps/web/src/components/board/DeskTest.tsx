/**
 * Fleet fork: the Test page, one T3 page for testing an item. Left: the test sheet with the work
 * chat that made it (feedback with screenshots, or the whole conversation) and that chat's
 * integrated terminal. Right: the chat's integrated browser with the app, which every link
 * clicked on the left opens in. Submitting the sheet sends the results to the work chat.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { ImagePlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { openUrlInPreview } from "~/browser/openFileInPreview";
import { readThreadPreviewState } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import ChatView from "../ChatView";
import { ChatPeekContext, ChatWorkbenchContext } from "../chat/ChatEmbedContext";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus, chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import type { DeskNotes } from "./deskNotes.logic";
import { useSendToChat } from "./deskSend";
import { type SheetSummary, useSheetDetail, useSheetRelay } from "./deskSheets";
import { openChatTerminal, ReviewAppCard } from "./DeskWork";
import { uploadPicture } from "./deskStore";

/** Sheets whose app was opened in the browser already, so a re-render doesn't open it again. */
const openedApps = new Set<string>();

function sessionUrl(snapshot: { readonly navStatus: { readonly _tag: string } }): string | null {
  return "url" in snapshot.navStatus && typeof snapshot.navStatus.url === "string"
    ? snapshot.navStatus.url
    : null;
}

/** Opens a URL in the chat's integrated browser (its tab for that URL if it has one). */
function useThreadBrowser(threadRef: ScopedThreadRef | null) {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  return async (url: string) => {
    if (!threadRef) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const existing = Object.values(readThreadPreviewState(threadRef).sessions).find(
      (session) => sessionUrl(session) === url,
    );
    if (existing) {
      useRightPanelStore.getState().openBrowser(threadRef, existing.tabId);
      return;
    }
    const result = await openUrlInPreview({ threadRef, url, openPreview });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not open it in the browser",
        description: "Check that the chat's machine can reach the address, then try again.",
      });
    }
  };
}

export function TestPage(props: {
  readonly sheetId: string;
  readonly sheet: SheetSummary | null;
  readonly item: DeskItem | null;
  /** The work chat that made the sheet (or the item's chat): where feedback goes. */
  readonly chat: CardChatState | null;
  /** Chats to fall back on when the sheet's own chat isn't known (a subagent published it). */
  readonly chats: ReadonlyArray<CardChatState>;
  /** Last resort: the app's planner, which can start the app and pass feedback on. */
  readonly planner: CardChatState | null;
  readonly notes: DeskNotes;
  readonly onBack: () => void;
}) {
  const sendToChat = useSendToChat();
  const detail = useSheetDetail(props.sheetId);
  const frame = useRef<HTMLIFrameElement>(null);
  const [conversation, setConversation] = useState(false);
  const [text, setText] = useState("");
  const [blocker, setBlocker] = useState(false);
  const [uploading, setUploading] = useState(0);
  // A sheet published by a subagent names a thread that isn't a chat; the chat working in the
  // folder the app starts from is the one that can fix it, on the machine its terminal opens on.
  const start = detail?.app?.start ?? "";
  const workChat =
    props.chat ??
    props.chats.find((entry) => entry.worktree && start.includes(entry.worktree)) ??
    null;
  const chat = workChat ?? props.planner;
  const threadRef = chat
    ? scopeThreadRef(chat.environmentId as EnvironmentId, chat.threadId as ThreadId)
    : null;
  const openInBrowser = useThreadBrowser(threadRef);
  const title = props.sheet?.title ?? "Test sheet";
  const counts = props.sheet?.counts;
  const checked = counts ? counts.pass + counts.fail + counts.skip + counts.blocked : 0;
  // The chat's last turn, as plain text: links keep their words, emphasis marks go.
  const lastSaid = (chat ? props.notes.work[chat.threadId]?.report?.text : undefined)
    ?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#]+/g, "");
  const appUrl = detail?.app?.url ?? null;

  useSheetRelay(frame, chat, title, (url) => void openInBrowser(url));

  const openApp = useEffectEvent((url: string) => void openInBrowser(url));
  // The app under test opens in the browser once, when the page first shows this sheet.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the app in the chat's browser once per sheet
  useEffect(() => {
    if (!appUrl || !chat || openedApps.has(props.sheetId)) return;
    openedApps.add(props.sheetId);
    openApp(appUrl);
  }, [appUrl, chat, props.sheetId]);

  // Screenshots go to the hub and into the message as markdown, so the chat can open them.
  const attach = async (files: ReadonlyArray<File>) => {
    const images = files.filter((entry) => entry.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading((count) => count + images.length);
    for (const image of images) {
      try {
        const url = await uploadPicture(image);
        setText(
          (current) =>
            `${current}${current && !current.endsWith("\n") ? "\n" : ""}![${image.name || "screenshot"}](${url})\n`,
        );
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Couldn't attach the screenshot",
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };
  const send = async () => {
    if (!chat || !text.trim()) return;
    const ok = await sendToChat(
      chat,
      [
        blocker
          ? `BLOCKER from testing "${title}": stop what you're doing and fix this first.`
          : `Feedback from testing "${title}":`,
        "",
        text.trim(),
        ...(text.includes("](http")
          ? ["", "It has screenshots: download each link (curl -o) and look at it."]
          : []),
      ].join("\n"),
    );
    if (ok) {
      setText("");
      setBlocker(false);
      toastManager.add({
        type: "success",
        title: "Sent to the chat",
        description: "Open the conversation to follow its reply.",
      });
    } else {
      toastManager.add({ type: "error", title: "Couldn't reach the chat" });
    }
  };

  // One row: in the chat's header when there's a chat, on its own otherwise.
  const bar = (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <Button size="xs" variant="ghost" onClick={props.onBack}>
        ← Board
      </Button>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {props.item
          ? `${deskRef(props.item) ?? ""} ${deskTitle(props.item)}`
          : title.replace(/^(?:test sheet|review)\s*[—–-]\s*/i, "")}
      </span>
      {counts ? (
        <Badge variant={counts.fail > 0 ? "error" : "outline"} size="sm">
          {checked} of {counts.total} checked{counts.fail ? ` · ${counts.fail} failed` : ""}
        </Badge>
      ) : null}
      {counts?.retest ? (
        <Badge variant="info" size="sm">
          ↻ {counts.retest} to re-test
        </Badge>
      ) : null}
      {chat ? (
        <Button size="xs" variant="outline" onClick={() => setConversation(!conversation)}>
          {conversation ? "Back to the sheet" : "Conversation"}
        </Button>
      ) : null}
    </div>
  );

  const sheet: ReactNode = (
    <>
      {detail?.app ? (
        <div className="shrink-0 px-3 pt-3">
          <ReviewAppCard
            app={detail.app}
            sheetTitle={title}
            done={false}
            chat={chat}
            onOpenApp={(url) => void openInBrowser(url)}
            onOpenChat={() => setConversation(true)}
            onOpenTerminal={(target) => openChatTerminal(target)}
            onAsk={(message) => {
              if (!chat) return;
              void sendToChat(chat, message).then((ok) =>
                toastManager.add(
                  ok
                    ? { type: "success", title: "Asked the chat to start the app" }
                    : { type: "error", title: "Couldn't reach the chat" },
                ),
              );
            }}
          />
        </div>
      ) : null}
      {/* The hub serves artifact pages under its own CSP sandbox; they save through its API. */}
      {/* oxlint-disable-next-line react/iframe-missing-sandbox -- the hub sandboxes /a/ pages itself */}
      <iframe
        ref={frame}
        key={props.sheetId}
        title={title}
        src={`/a/${props.sheetId}`}
        onLoad={() =>
          frame.current?.contentWindow?.postMessage({ type: "t3-host:opens-links" }, "*")
        }
        className="mt-2 min-h-0 w-full flex-1 border-0 border-t border-border bg-background"
      />
      <section
        aria-label="Feedback to the work chat"
        className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-card px-3 py-2"
      >
        {chat ? (
          <>
            <span className="truncate text-xs">
              <b className="font-semibold">
                Feedback to {workChat ? chatTitle(chat.title) : "the planner"}
              </b>
              {workChat ? null : (
                <span className="text-muted-foreground">
                  {" · "}No work chat is recorded for this sheet, so this goes to the planner, which
                  passes it on.
                </span>
              )}
              <span className="text-muted-foreground"> · {chatStatus(chat).label}</span>
            </span>
            {lastSaid ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">Last said: {lastSaid}</p>
            ) : null}
            <Textarea
              aria-label="Feedback for the chat"
              rows={2}
              placeholder="What's wrong or missing? Paste or drop a screenshot to show it."
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                if (files.some((entry) => entry.type.startsWith("image/"))) {
                  event.preventDefault();
                  void attach(files);
                }
              }}
              onDrop={(event) => {
                const files = [...event.dataTransfer.files];
                if (files.length > 0) {
                  event.preventDefault();
                  void attach(files);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <Checkbox checked={blocker} onCheckedChange={(next) => setBlocker(next === true)} />
                Blocker: fix this first
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                <ImagePlusIcon className="size-3.5" aria-hidden />
                Add screenshot
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    void attach([...(event.target.files ?? [])]);
                    event.target.value = "";
                  }}
                />
              </label>
              {uploading > 0 ? (
                <span className="text-xs text-muted-foreground">Attaching {uploading}…</span>
              ) : null}
              <span className="flex-1" />
              <Button
                size="sm"
                variant={blocker ? "destructive" : "default"}
                disabled={!text.trim() || uploading > 0}
                onClick={() => void send()}
              >
                {blocker ? "Send blocker" : "Send feedback"}
              </Button>
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            No chat is recorded for this sheet: ask the planner which chat made it.
          </span>
        )}
      </section>
    </>
  );

  if (!chat) {
    return (
      <div className="flex h-dvh min-h-0 flex-col bg-background">
        <div className="flex shrink-0 border-b border-border px-3 py-2">{bar}</div>
        {sheet}
      </div>
    );
  }
  // The work chat's own T3 page, with the sheet in place of the conversation: its terminal and
  // its integrated browser (the app) stay where T3 puts them.
  return (
    <ChatPeekContext value>
      <ChatWorkbenchContext value={{ bar, content: conversation ? null : sheet }}>
        <ChatView
          key={`${chat.environmentId}:${chat.threadId}`}
          environmentId={chat.environmentId as EnvironmentId}
          threadId={chat.threadId as ThreadId}
          routeKind="server"
          reserveTitleBarControlInset={false}
        />
      </ChatWorkbenchContext>
    </ChatPeekContext>
  );
}
