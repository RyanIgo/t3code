/**
 * Fleet fork: the Test page, made for the left half of the screen with the app on the right.
 * The test sheet fills it; under it, the work chat that made the sheet, to send feedback (with
 * screenshots) while testing. Submitting the sheet sends the results to that chat.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ImagePlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import ChatView from "../ChatView";
import { ChatEmbedContext, ChatPeekContext } from "../chat/ChatEmbedContext";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { cn } from "../../lib/utils";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus, chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import type { DeskNotes } from "./deskNotes.logic";
import { useSendToChat } from "./deskSend";
import { type SheetSummary, useSheetDetail } from "./deskSheets";
import { uploadPicture } from "./deskStore";

export function TestPage(props: {
  readonly sheetId: string;
  readonly sheet: SheetSummary | null;
  readonly item: DeskItem | null;
  /** The work chat that made the sheet (or the item's chat): where feedback goes. */
  readonly chat: CardChatState | null;
  readonly notes: DeskNotes;
  readonly onBack: () => void;
}) {
  const sendToChat = useSendToChat();
  const detail = useSheetDetail(props.sheetId);
  const frame = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [blocker, setBlocker] = useState(false);
  const [uploading, setUploading] = useState(0);
  const chat = props.chat;
  const title = props.sheet?.title ?? "Test sheet";
  const counts = props.sheet?.counts;
  const checked = counts ? counts.pass + counts.fail + counts.skip + counts.blocked : 0;
  // The chat's last turn, as plain text: links keep their words, emphasis marks go.
  const lastSaid = (chat ? props.notes.work[chat.threadId]?.report?.text : undefined)
    ?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#]+/g, "");

  // The sheet asks its host to send "Submit results" on to a chat; this page is that host, and
  // the work chat is where results go. Only the sheet in this page's frame is listened to.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- relays the embedded sheet's Submit to the work chat
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; id?: string; text?: string } | null;
      if (event.source !== frame.current?.contentWindow || message?.type !== "t3-page:send") return;
      const reply = (ok: boolean) =>
        frame.current?.contentWindow?.postMessage(
          { type: "t3-page:result", id: message.id, ok },
          "*",
        );
      if (!chat || typeof message.text !== "string") {
        reply(false);
        return;
      }
      void sendToChat(
        chat,
        `Rigo submitted the test sheet "${title}":\n\n${message.text}\n\nRead the full results and his notes (t3-artifacts), fix what failed, tick the acceptance criteria that passed, then hand it back for a re-check or wrap up.`,
      ).then(reply);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [chat, sendToChat, title]);

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
        description: "Its reply shows here; open the conversation with ▴.",
      });
    } else {
      toastManager.add({ type: "error", title: "Couldn't reach the chat" });
    }
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="ghost" onClick={props.onBack}>
            ← Board
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            Test: {props.item ? `${deskRef(props.item) ?? ""} ${deskTitle(props.item)}` : title}
          </span>
          {counts ? (
            <Badge variant={counts.fail > 0 ? "error" : "outline"} size="sm">
              {checked} of {counts.total} checked{counts.fail ? ` · ${counts.fail} failed` : ""}
            </Badge>
          ) : null}
        </div>
        {detail?.app ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <a
              href={detail.app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Open the app ↗
            </a>
            <span className="text-muted-foreground">put it on the right half of your screen</span>
            {detail.app.start ? (
              <>
                <span className="flex-1" />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(detail.app?.start ?? "")}
                >
                  Copy start command
                </Button>
                {chat ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      void sendToChat(
                        chat,
                        `The app for "${title}" isn't answering at ${detail.app?.url}. Start it again on ${detail.app?.machine ?? "its machine"} and tell me when it's up.`,
                      )
                    }
                  >
                    App down? Ask the chat
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </header>
      {/* The hub serves artifact pages under its own CSP sandbox; they save through its API. */}
      {/* oxlint-disable-next-line react/iframe-missing-sandbox -- the hub sandboxes /a/ pages itself */}
      <iframe
        ref={frame}
        key={props.sheetId}
        title={title}
        src={`/a/${props.sheetId}`}
        className={cn("min-h-0 w-full border-0 bg-background", open ? "h-2/5" : "flex-1")}
      />
      <section
        aria-label="Feedback to the work chat"
        className={cn(
          "flex shrink-0 flex-col border-t border-border bg-card",
          open && "min-h-0 flex-1",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs">
            {chat ? (
              <>
                <b className="font-semibold">Feedback to {chatTitle(chat.title)}</b>
                <span className="text-muted-foreground"> · {chatStatus(chat).label}</span>
              </>
            ) : (
              <span className="text-muted-foreground">
                No chat is recorded for this sheet: ask the planner which chat made it.
              </span>
            )}
          </span>
          {chat ? (
            <Button size="xs" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "▾ Hide the conversation" : "▴ Show the conversation"}
            </Button>
          ) : null}
        </div>
        {chat && open ? (
          <div className="relative flex min-h-0 flex-1 flex-col border-t border-border">
            <ChatEmbedContext value>
              <ChatPeekContext value>
                <ChatView
                  key={`${chat.environmentId}:${chat.threadId}`}
                  environmentId={chat.environmentId as EnvironmentId}
                  threadId={chat.threadId as ThreadId}
                  routeKind="server"
                  reserveTitleBarControlInset={false}
                />
              </ChatPeekContext>
            </ChatEmbedContext>
          </div>
        ) : chat ? (
          <div className="flex flex-col gap-1.5 px-3 pb-2">
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
          </div>
        ) : null}
      </section>
    </div>
  );
}
