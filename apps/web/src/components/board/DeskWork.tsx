import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ArrowRightLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  PlayIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useTerminalUiStateStore } from "../../terminalUiStateStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus, chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import { type DeskNotes, focusedChat } from "./deskNotes.logic";
import { saveDeskFocus, saveNextStep } from "./deskNotesStore";
import { DeskHeading, openExternal } from "./DeskParts";
import { sheetIsIncomplete, type SheetSummary, uncheckedRows, useSheetDetail } from "./deskSheets";
import { formatFleetBoardAge, minuteTickToMs } from "./fleetBoard.logic";

const chatKeyOf = (chat: Pick<CardChatState, "environmentId" | "threadId">) =>
  `${chat.environmentId}:${chat.threadId}`;

const refOf = (chat: CardChatState) =>
  scopeThreadRef(chat.environmentId as EnvironmentId, chat.threadId as ThreadId);

/** Puts text in a chat's message box (after anything already there), for Rigo to read and send. */
function draftToChat(chat: CardChatState, text: string) {
  const store = useComposerDraftStore.getState();
  const ref = refOf(chat);
  const existing = store.getComposerDraft(ref)?.prompt ?? "";
  store.setPrompt(ref, existing.trim() ? `${existing}\n\n${text}` : text);
}

/** Opens T3's terminal under a chat, in that chat's folder on its machine. */
function openChatTerminal(chat: CardChatState) {
  useTerminalUiStateStore.getState().setTerminalOpen(refOf(chat), true);
}

const itemLine = (item: DeskItem) => `${deskRef(item) ?? "this item"}: ${deskTitle(item)}`;

/** Moves an item to a chat (and tells that chat in its message box). */
function moveFocus(item: DeskItem, chat: CardChatState) {
  if (!item.url) return;
  saveDeskFocus(item.url, chat.threadId);
  draftToChat(
    chat,
    `You're now on ${itemLine(item)} (${item.url}). Finish or park what you were doing first, then tell me where it stands.`,
  );
}

function since(nowMs: number, iso: string | null) {
  const age = formatFleetBoardAge(iso, nowMs);
  return age ? `active ${age} ago` : null;
}

/**
 * Fleet fork: who is on an item. The focused chat when one is recorded; otherwise the chat the
 * Desk guesses from links and branches, offered as a suggestion rather than claimed.
 */
export function OnItRow(props: {
  readonly item: DeskItem;
  readonly notes: DeskNotes;
  /** Every chat (settled ones too), to find the focused one. */
  readonly allChats: ReadonlyArray<CardChatState>;
  /** The chats the Desk links to this item, best guess first. */
  readonly related: ReadonlyArray<CardChatState>;
  readonly shown: CardChatState | null;
  readonly onShow: (chat: CardChatState) => void;
}) {
  const nowMs = minuteTickToMs(useNowMinute());
  const focusId = props.item.url ? focusedChat(props.notes, props.item.url) : null;
  const focused = focusId
    ? (props.allChats.find((chat) => chat.threadId === focusId) ?? null)
    : null;
  const suggestion = focused ? null : (props.related[0] ?? null);
  const candidates = uniqueChats([
    ...(focused ? [focused] : []),
    ...props.related,
    ...props.allChats.filter((chat) => !chat.column || chat.column !== "done"),
  ]).slice(0, 12);
  const chat = focused ?? suggestion;
  const status = chat ? chatStatus(chat) : null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      <Badge variant={focused ? "info" : "outline"} size="sm">
        {focused ? "On it" : suggestion ? "Suggested" : "No chat on it"}
      </Badge>
      {chat && status ? (
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-center gap-2 text-left text-sm"
          onClick={() => props.onShow(chat)}
        >
          <span className="truncate font-medium">{chatTitle(chat.title)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{since(nowMs, chat.since)}</span>
          <Badge variant={status.tone} size="sm">
            {status.label}
          </Badge>
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">
          Start a chat on it, or put an open chat on it.
        </span>
      )}
      <span className="ms-auto flex shrink-0 items-center gap-1">
        {suggestion ? (
          <Button size="xs" variant="secondary" onClick={() => moveFocus(props.item, suggestion)}>
            Put on this item
          </Button>
        ) : null}
        {props.item.url ? (
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="xs" />}>
              <ArrowRightLeftIcon />
              {focused ? "Move focus" : "Choose a chat"}
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuGroup>
                <MenuGroupLabel>Who's on {deskRef(props.item) ?? "this item"}?</MenuGroupLabel>
                {candidates.map((entry) => (
                  <MenuCheckboxItem
                    key={chatKeyOf(entry)}
                    checked={focused !== null && chatKeyOf(entry) === chatKeyOf(focused)}
                    onCheckedChange={(checked) => {
                      if (checked) moveFocus(props.item, entry);
                      else if (props.item.url) saveDeskFocus(props.item.url, null);
                    }}
                  >
                    {chatTitle(entry.title)}
                  </MenuCheckboxItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        ) : null}
      </span>
    </div>
  );
}

function uniqueChats(chats: ReadonlyArray<CardChatState>): CardChatState[] {
  const seen = new Set<string>();
  return chats.filter((chat) => {
    const key = chatKeyOf(chat);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const spanDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * Fleet fork: what a chat has worked on and what's left, from records rather than its memory:
 * the items it was put on, its PRs, the sheets it handed over, and its next step. One line until
 * opened, so the conversation keeps the window's width.
 */
export function WorkPanel(props: {
  readonly chat: CardChatState;
  readonly notes: DeskNotes;
  readonly items: ReadonlyArray<DeskItem>;
  readonly sheets: ReadonlyArray<SheetSummary>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const key = props.chat.threadId;
  const work = props.notes.work[key];
  const byUrl = new Map(props.items.flatMap((item) => (item.url ? [[item.url, item]] : [])));
  const spans = work?.items ?? [];
  const current = spans.findLast((span) => span.until === null);
  const currentItem = current ? (byUrl.get(current.url) ?? null) : null;
  const sheets = props.sheets.filter((sheet) => sheet.thread?.threadId === props.chat.threadId);
  const openCriteria = currentItem?.story?.criteria.filter((criterion) => !criterion.done) ?? [];
  const merged = props.chat.pullRequests.filter((pr) => pr.state === "merged").length;
  const openPrs = props.chat.pullRequests.filter((pr) => pr.state === "open").length;
  const summary = [
    currentItem ? (deskRef(currentItem) ?? "item") : "Not on an item",
    props.chat.branch ? `⎇ ${props.chat.branch}` : null,
    props.chat.pullRequests.length > 0
      ? [openPrs ? `${openPrs} PR open` : null, merged ? `${merged} merged` : null]
          .filter(Boolean)
          .join(", ")
      : null,
    sheets[0] ? `sheet ${sheets[0].counts.pass} of ${sheets[0].counts.total} passed` : null,
    work?.next ? `next: ${work.next}` : null,
  ].filter(Boolean);
  const still: string[] = [
    ...(props.chat.asking ? [`Waits on you: a ${props.chat.asking}.`] : []),
    ...sheets.flatMap((sheet) => {
      const { fail, blocked } = sheet.counts;
      const left = uncheckedRows(sheet.counts);
      return [
        ...(fail + blocked > 0
          ? [`${sheet.title}: ${fail} failed, ${blocked} blocked (the chat fixes these).`]
          : []),
        ...(left > 0 ? [`${sheet.title}: ${left} checks for you to do.`] : []),
      ];
    }),
    ...openCriteria.map((criterion) => `Not done yet: ${criterion.text}`),
    ...props.chat.pullRequests
      .filter((pr) => pr.state === "open" && pr.checks === "failing")
      .map((pr) => `${pr.label}: checks failing.`),
  ];
  return (
    <section
      aria-label="Worked on and still to do"
      className="rounded-lg border border-border bg-muted/40 text-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDownIcon className="size-3.5 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{summary.join(" · ")}</span>
        {still.length > 0 ? (
          <Badge variant="warning" size="sm" className="ms-auto shrink-0">
            {still.length} to do
          </Badge>
        ) : null}
      </button>
      {open ? (
        <div className="grid grid-cols-1 gap-4 border-t border-border p-3 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <DeskHeading>Worked on</DeskHeading>
            {spans.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing recorded yet. Put the chat on an item to start its record.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {spans.toReversed().map((span) => {
                  const item = byUrl.get(span.url);
                  return (
                    <li key={`${span.url}:${span.from}`} className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate">
                        {item ? itemLine(item) : span.url.replace("https://github.com/", "")}
                      </span>
                      <span className="ms-auto shrink-0 text-2xs text-muted-foreground">
                        {spanDate(span.from)}
                        {span.until ? ` – ${spanDate(span.until)}` : " – now"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {props.chat.pullRequests.length > 0 ? (
              <>
                <DeskHeading>Pull requests</DeskHeading>
                <ul className="flex flex-col gap-1">
                  {props.chat.pullRequests.map((pr) => (
                    <li key={pr.url} className="flex items-center gap-2">
                      <button
                        type="button"
                        className="min-w-0 cursor-pointer truncate text-left hover:underline"
                        onClick={() => openExternal(pr.url)}
                      >
                        {pr.label}
                      </button>
                      <Badge
                        variant={pr.state === "merged" ? "success" : "outline"}
                        size="sm"
                        className="ms-auto"
                      >
                        {pr.state}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {sheets.length > 0 ? (
              <>
                <DeskHeading>Test sheets</DeskHeading>
                <ul className="flex flex-col gap-1">
                  {sheets.map((sheet) => (
                    <li key={sheet.id} className="flex items-center gap-2">
                      <span className="min-w-0 truncate">{sheet.title}</span>
                      <span className="ms-auto shrink-0 text-2xs text-muted-foreground">
                        {sheet.counts.pass} of {sheet.counts.total} passed
                        {sheet.counts.fail ? `, ${sheet.counts.fail} failed` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <DeskHeading>Still to do</DeskHeading>
            {still.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing recorded as left.</p>
            ) : (
              <ul className="flex list-disc flex-col gap-1 ps-4">
                {still.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <DeskHeading>Next step</DeskHeading>
            {editing === null ? (
              <div className="flex items-baseline gap-2">
                <p className={work?.next ? "" : "text-xs text-muted-foreground"}>
                  {work?.next ?? "Not written down yet. The chat sets it with desk.mjs next."}
                </p>
                <Button
                  variant="ghost"
                  size="xs"
                  className="ms-auto"
                  onClick={() => setEditing(work?.next ?? "")}
                >
                  Edit
                </Button>
              </div>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveNextStep(key, editing);
                  setEditing(null);
                }}
              >
                <Input
                  aria-label="Next step"
                  size="sm"
                  value={editing}
                  onChange={(event) => setEditing(event.target.value)}
                />
                <Button size="xs" type="submit">
                  Save
                </Button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Fleet fork: an item's review. The newest sheet that reviews it, with the running app's address,
 * its start command and the way back to the machine (the chat, its terminal), then the checks.
 */
export function ReviewTab(props: {
  readonly item: DeskItem;
  readonly sheets: ReadonlyArray<SheetSummary>;
  readonly allChats: ReadonlyArray<CardChatState>;
  /** The chat to ask for a sheet when there isn't one. */
  readonly onChat: CardChatState | null;
  readonly onOpenChat: (chat: CardChatState) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const sheet = props.sheets.find((entry) => entry.id === chosen) ?? props.sheets[0] ?? null;
  const detail = useSheetDetail(sheet?.id ?? null);
  const done = props.item.status === "Done" || props.item.state !== "open";
  const sheetChat = sheet?.thread
    ? (props.allChats.find((chat) => chat.threadId === sheet.thread?.threadId) ?? null)
    : null;
  const chat = sheetChat ?? props.onChat;
  const ask = (text: string) => {
    if (!chat) return;
    draftToChat(chat, text);
    props.onOpenChat(chat);
  };
  if (!sheet) {
    return (
      <div className="m-auto flex max-w-md flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
        No test sheet for this yet. When the chat hands it over for testing, its sheet and the
        running app show here.
        {chat && !done ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              ask(
                `Hand ${itemLine(props.item)} over for testing: start the app on this machine's Tailscale address and publish a hub test sheet (t3-app-review skill) with the app block (url, start command, machine) and a link on every check.`,
              )
            }
          >
            Ask the chat for a test sheet
          </Button>
        ) : null}
      </div>
    );
  }
  const incomplete = detail ? sheetIsIncomplete(detail) : false;
  const app = detail?.app ?? null;
  const pageUrl = new URL(`/a/${sheet.id}`, window.location.origin).toString();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {props.sheets.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          {props.sheets.map((entry) => (
            <Button
              key={entry.id}
              size="xs"
              variant={entry.id === sheet.id ? "secondary" : "ghost"}
              onClick={() => setChosen(entry.id)}
            >
              <span className="max-w-64 truncate">{entry.title}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {incomplete ? (
        <section className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p>
            <b>Incomplete sheet.</b>{" "}
            {app?.url
              ? "Its checks have no links to open."
              : "It has no app address or start command, so there's no way back to the running app."}
          </p>
          <div className="flex flex-wrap gap-2">
            {chat && !done ? (
              <Button
                size="xs"
                onClick={() =>
                  ask(
                    `The test sheet ${pageUrl} is incomplete. Republish it with the same id (t3-artifacts skill): add the app block (url on this machine's Tailscale address, the one-line start command, machine) and a url or links on every check. Start the app first if it isn't running.`,
                  )
                }
              >
                Send back to the chat
              </Button>
            ) : null}
            {chat ? (
              <Button size="xs" variant="outline" onClick={() => props.onOpenChat(chat)}>
                Open chat
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
      {app ? (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">App</span>
            <button
              type="button"
              className="min-w-0 cursor-pointer truncate text-left text-info-foreground underline-offset-2 hover:underline"
              onClick={() => openExternal(app.url)}
            >
              {app.url}
            </button>
            <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </div>
          {app.machine || app.start ? (
            <p className="text-xs text-muted-foreground">
              {app.machine ? `On ${app.machine}. ` : ""}
              {app.start && !done ? "If it's down, start it with:" : ""}
            </p>
          ) : null}
          {app.start && !done ? (
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-2 py-1 text-xs whitespace-nowrap">
                {app.start}
              </code>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(app.start ?? "").then(
                    () => toastManager.add({ type: "success", title: "Start command copied" }),
                    () => undefined,
                  );
                }}
              >
                <CopyIcon />
                Copy
              </Button>
            </div>
          ) : null}
          {chat && !done ? (
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={() => props.onOpenChat(chat)}>
                <MessageSquareIcon />
                Open chat
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  openChatTerminal(chat);
                  props.onOpenChat(chat);
                }}
              >
                <SquareTerminalIcon />
                Open terminal
              </Button>
              <Button
                size="xs"
                onClick={() =>
                  ask(
                    `The app for "${sheet.title}" isn't answering at ${app.url}. Start it again${app.start ? ` (${app.start})` : ""}, check it answers, then tell me.`,
                  )
                }
              >
                <PlayIcon />
                Ask the chat to start it
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {sheet.counts.pass} of {sheet.counts.total} passed
        {sheet.counts.fail ? ` · ${sheet.counts.fail} failed` : ""}
        {sheet.counts.blocked ? ` · ${sheet.counts.blocked} blocked` : ""}
        {uncheckedRows(sheet.counts) ? ` · ${uncheckedRows(sheet.counts)} to check` : ""}
        {" · "}
        <button
          type="button"
          className="cursor-pointer underline-offset-2 hover:underline"
          onClick={() => openExternal(pageUrl)}
        >
          Open in its own tab
        </button>
      </p>
      {/* The hub serves artifact pages under its own CSP sandbox; they save through its API. */}
      {/* oxlint-disable-next-line react/iframe-missing-sandbox -- the hub sandboxes /a/ pages itself */}
      <iframe
        key={sheet.id}
        title={sheet.title}
        src={`/a/${sheet.id}`}
        className="min-h-[32rem] w-full flex-1 rounded-lg border border-border bg-background"
      />
    </div>
  );
}
