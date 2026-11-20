import { ImagePlusIcon, InboxIcon, NotebookPenIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import ChatMarkdown from "../ChatMarkdown";
import { cn } from "../../lib/utils";
import type { CardChatState } from "./boardCards.logic";
import { chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import { draftToChat } from "./DeskWork";
import {
  type DeskNotes,
  INBOX_SOURCES,
  type InboxAction,
  type InboxNote,
  type InboxProposal,
  type InboxSource,
  inboxToSort,
} from "./deskNotes.logic";
import { saveInboxNote } from "./deskNotesStore";
import { DeskHeading, openExternal } from "./DeskParts";
import { commentOnDeskItem, createDeskItem, findDeskItem, uploadPicture } from "./deskStore";

const NONE = "__none__";
const TYPES = ["Bug", "Story", "Maintenance", "Research", "Support"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const ACTION_LABEL: Record<InboxAction, string> = {
  comment: "Add to an item",
  new: "New item (Backlog or a sprint)",
  planner: "Send to the app's planner",
  chat: "Send to a chat only",
  dismiss: "Not development work",
};
const BACKLOG = "Backlog";
const NONE_CHAT = "__no_chat__";
const chatKeyOf = (chat: CardChatState) => `${chat.environmentId}:${chat.threadId}`;

const newId = () => Math.random().toString(36).slice(2, 12);
const day = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/** Fleet fork: a quick note from an email, a meeting or a hallway ask, kept until it's sorted. */
export function QuickNoteButton(props: { readonly apps: ReadonlyArray<string> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <NotebookPenIcon />
        Note
      </Button>
      {open ? <QuickNoteDialog apps={props.apps} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The quick-note box itself, for the header button and the phone's bottom bar. */
export function QuickNoteDialog(props: {
  readonly apps: ReadonlyArray<string>;
  readonly onClose: () => void;
}) {
  const setOpen = (next: boolean) => {
    if (!next) props.onClose();
  };
  const [text, setText] = useState("");
  const [source, setSource] = useState<InboxSource>("In person");
  const [who, setWho] = useState("");
  const [app, setApp] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  // Pictures go to the hub and into the note as markdown, so they travel with it when it's filed.
  const attach = async (files: ReadonlyArray<File>) => {
    const images = files.filter((entry) => entry.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading((count) => count + images.length);
    for (const image of images) {
      try {
        const url = await uploadPicture(image);
        setText(
          (current) =>
            `${current}${current && !current.endsWith("\n") ? "\n" : ""}![${image.name || "picture"}](${url})\n`,
        );
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Couldn't attach the picture",
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };
  const save = () => {
    if (!text.trim()) return;
    const at = new Date().toISOString();
    saveInboxNote({
      id: newId(),
      text: text.trim(),
      source,
      who: who.trim() || null,
      app,
      createdAt: at,
      updatedAt: at,
      state: "new",
      proposal: null,
      result: null,
    });
    toastManager.add({ type: "success", title: "Saved to the inbox" });
    setText("");
    setWho("");
    setApp(null);
    setOpen(false);
  };
  return (
    <>
      <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
        <DialogPopup className="sm:max-w-lg">
          <form
            className="flex flex-col gap-3 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <DialogTitle>Quick note</DialogTitle>
            <Textarea
              aria-label="What was asked or reported"
              placeholder="What was asked or reported, in your words. Paste or drop a picture to attach it."
              rows={5}
              autoFocus
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
            />
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                <ImagePlusIcon className="size-3.5" aria-hidden />
                Add picture
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
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Select
                value={source}
                onValueChange={(value) => {
                  const found = INBOX_SOURCES.find((entry) => entry === value);
                  if (found) setSource(found);
                }}
              >
                <SelectTrigger aria-label="Where it came from" size="sm">
                  <SelectValue>{source}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {INBOX_SOURCES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Input
                aria-label="Who"
                size="sm"
                placeholder="Who"
                value={who}
                onChange={(event) => setWho(event.target.value)}
              />
              <Select
                value={app ?? NONE}
                onValueChange={(value) =>
                  setApp(typeof value === "string" && value !== NONE ? value : null)
                }
              >
                <SelectTrigger aria-label="App" size="sm">
                  <SelectValue>{app ?? "App (optional)"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={NONE}>Not sure</SelectItem>
                  {props.apps.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              It waits in the inbox on Now. A triage agent proposes where it goes; nothing is filed
              until you approve.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!text.trim() || uploading > 0}>
                Save to inbox
              </Button>
            </div>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function describe(
  proposal: InboxProposal,
  items: ReadonlyArray<DeskItem>,
  chats: ReadonlyArray<CardChatState>,
): string {
  const chat = proposal.chat ? chats.find((entry) => chatKeyOf(entry) === proposal.chat) : null;
  const toChat = chat ? `"${chatTitle(chat.title)}"` : "a chat";
  let main: string;
  if (proposal.action === "comment") {
    const item = items.find((entry) => entry.url === proposal.itemUrl);
    main = `Add to ${item ? `${deskRef(item)}: ${deskTitle(item)}` : (proposal.itemUrl ?? "an item")}`;
  } else if (proposal.action === "new") {
    main = `New ${proposal.type ?? "item"} in ${proposal.app ?? "?"}${proposal.priority ? ` (${proposal.priority})` : ""}, in ${proposal.sprint ?? BACKLOG}: ${proposal.title ?? ""}`;
  } else if (proposal.action === "planner") {
    main = `Send to ${proposal.app ?? "the app"}'s planner`;
  } else if (proposal.action === "chat") {
    return `Send to ${toChat}`;
  } else {
    return "Not development work: dismiss";
  }
  return proposal.chat ? `${main}, and send to ${toChat}` : main;
}

/** A first guess at a title: the first real sentence, skipping greetings and picture lines. */
export function suggestTitle(text: string): string {
  const line =
    text
      .split("\n")
      .map((entry) => entry.trim())
      .find(
        (entry) =>
          entry.split(/\s+/).length >= 5 &&
          !entry.startsWith("![") &&
          !/^(hi|hello|hey|dear)\b/i.test(entry),
      ) ?? text.trim();
  const sentence = line.split(/(?<=[.!?])\s/)[0] ?? line;
  return sentence.slice(0, 120);
}

const from = (note: InboxNote) =>
  [note.who, note.source, day(note.createdAt)].filter(Boolean).join(" · ");

/** Files an approved note: a comment, a new issue, a hand-off to a planner, or nothing. */
async function file(
  note: InboxNote,
  proposal: InboxProposal,
  chats: ReadonlyArray<CardChatState>,
  onOpenChat: (chat: CardChatState) => void,
): Promise<InboxNote> {
  const filed = await fileOnGitHub(note, proposal);
  const chat = proposal.chat ? chats.find((entry) => chatKeyOf(entry) === proposal.chat) : null;
  if (chat) {
    draftToChat(
      chat,
      [
        `From my inbox (${from(note)}):`,
        "",
        note.text,
        ...(filed.result?.url ? ["", `Filed as ${filed.result.url}`] : []),
      ].join("\n"),
    );
    onOpenChat(chat);
    if (proposal.action === "chat") {
      return {
        ...filed,
        state: "filed",
        result: { url: null, label: `Sent to ${chatTitle(chat.title)}` },
      };
    }
  }
  return filed;
}

async function fileOnGitHub(note: InboxNote, proposal: InboxProposal): Promise<InboxNote> {
  const at = new Date().toISOString();
  const credit = `Raised by ${note.who ?? "someone"} (${note.source.toLowerCase()}, ${day(note.createdAt)}).`;
  if (proposal.action === "comment" && proposal.itemUrl) {
    const comment = await commentOnDeskItem(
      proposal.itemUrl,
      `**From Rigo's inbox.** ${credit}\n\n${note.text}`,
    );
    return {
      ...note,
      state: "filed",
      proposal,
      result: { url: comment.url, label: "Comment added" },
      updatedAt: at,
    };
  }
  if (proposal.action === "new" && proposal.repo && proposal.title) {
    const item = await createDeskItem({
      repo: proposal.repo,
      title: proposal.title,
      body: [
        "## In plain words",
        "",
        `**What:** ${proposal.title}`,
        `**Why it matters:** ${credit}`,
        "**Where it stands:** Filed from Rigo's inbox; not started.",
        "",
        "## The note",
        "",
        note.text,
      ].join("\n"),
      fields: Object.fromEntries(
        [
          ["App", proposal.app],
          ["Work type", proposal.type],
          ["Priority", proposal.priority],
          ["Sprint", proposal.sprint ?? null],
        ].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
    });
    return {
      ...note,
      state: "filed",
      proposal,
      result: { url: item.url, label: `${proposal.repo.split("/").pop()}#${item.number}` },
      updatedAt: at,
    };
  }
  if (proposal.action === "planner") {
    return {
      ...note,
      state: "planner",
      proposal,
      result: { url: null, label: `${proposal.app ?? "App"} planner` },
      updatedAt: at,
    };
  }
  if (proposal.action === "chat") return { ...note, proposal, updatedAt: at };
  return { ...note, state: "dismissed", proposal, result: null, updatedAt: at };
}

/**
 * Fleet fork: the inbox on Now. Notes waiting to be sorted, each with the triage agent's proposal
 * to approve, change or dismiss, and the last few sorted ones with what they became.
 */
export function InboxStrip(props: {
  readonly notes: DeskNotes;
  readonly items: ReadonlyArray<DeskItem>;
  readonly apps: ReadonlyArray<string>;
  /** Sprint names a new item can go into (else it waits in the Backlog). */
  readonly sprints: ReadonlyArray<string>;
  /** Open chats a note can also be sent to. */
  readonly chats: ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  /** Starts a new chat on an item (the launcher asks for the machine). */
  readonly onStartChat: (item: DeskItem) => void;
  /** The sprint running now, for Expedite. */
  readonly currentSprint: string | null;
  /** Starts a triage chat that proposes a route for each new note. */
  readonly onSort: () => void;
}) {
  const toSort = inboxToSort(props.notes);
  const sorted = Object.values(props.notes.inbox)
    .filter((note) => note.state === "filed" || note.state === "planner")
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  if (toSort.length === 0 && sorted.length === 0) return null;
  const waiting = toSort.filter((note) => note.state === "new").length;
  return (
    <section
      aria-label="Inbox"
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <InboxIcon className="size-4 text-muted-foreground" aria-hidden />
        <DeskHeading>Inbox · {toSort.length} to sort</DeskHeading>
        {waiting > 0 ? (
          <Button size="xs" className="ms-auto" onClick={props.onSort}>
            Sort {waiting} with an agent
          </Button>
        ) : null}
      </div>
      {toSort.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {toSort.map((note) => (
            <InboxCard
              key={note.id}
              note={note}
              items={props.items}
              apps={props.apps}
              sprints={props.sprints}
              chats={props.chats}
              onOpenChat={props.onOpenChat}
              onStartChat={props.onStartChat}
              currentSprint={props.currentSprint}
            />
          ))}
        </ul>
      ) : null}
      {sorted.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Sorted recently · {sorted.length}
          </summary>
          <ul className="mt-1 flex flex-col gap-1 text-xs">
            {sorted.map((note) => (
              <li key={note.id} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {note.text.replace(/!\[[^\]]*\]\([^)]*\)/g, "[picture]")}
                </span>
                {note.result?.url ? (
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer underline-offset-2 hover:underline"
                    onClick={() => note.result?.url && openExternal(note.result.url)}
                  >
                    {note.result.label}
                  </button>
                ) : (
                  <span className="shrink-0 text-muted-foreground">{note.result?.label}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function InboxCard(props: {
  readonly note: InboxNote;
  readonly items: ReadonlyArray<DeskItem>;
  readonly apps: ReadonlyArray<string>;
  readonly sprints: ReadonlyArray<string>;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onStartChat: (item: DeskItem) => void;
  readonly currentSprint: string | null;
}) {
  const { note } = props;
  const [editing, setEditing] = useState<InboxProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const long = note.text.length > 400 || note.text.split("\n").length > 6;
  const run = async (proposal: InboxProposal, startChat = false) => {
    setBusy(true);
    try {
      const filed = await file(note, proposal, props.chats, props.onOpenChat);
      saveInboxNote(filed);
      setEditing(null);
      if (startChat) {
        // The item it was filed as (or added to), so a new chat can start on it right away.
        const url = proposal.action === "comment" ? proposal.itemUrl : filed.result?.url;
        const item = url
          ? (findDeskItem(url) ?? props.items.find((entry) => entry.url === url) ?? null)
          : null;
        if (item) props.onStartChat(item);
        else
          toastManager.add({
            type: "warning",
            title: "Filed. Refresh the Board to start a chat on it.",
          });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Couldn't file the note",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () =>
    void run({
      action: "dismiss",
      itemUrl: null,
      repo: null,
      app: null,
      type: null,
      priority: null,
      title: null,
      reason: "Dismissed by Rigo.",
    });
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 text-sm">
      <span className="text-2xs text-muted-foreground">
        {from(note)}
        {note.app ? ` · ${note.app}` : ""}
      </span>
      <div
        className={cn(
          "relative text-sm [&_img]:max-h-64 [&_img]:rounded-md",
          long && !expanded && "max-h-32 overflow-hidden",
        )}
      >
        <ChatMarkdown text={note.text} cwd={undefined} />
      </div>
      {long ? (
        <button
          type="button"
          className="self-start cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show all"}
        </button>
      ) : null}
      {editing ? (
        <ProposalEditor
          value={editing}
          items={props.items}
          apps={props.apps}
          sprints={props.sprints}
          chats={props.chats}
          onChange={setEditing}
        />
      ) : note.proposal ? (
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/60 px-2 py-1.5">
          <span className="font-medium">{describe(note.proposal, props.items, props.chats)}</span>
          {note.proposal.reason ? (
            <span className="text-xs text-muted-foreground">{note.proposal.reason}</span>
          ) : null}
        </div>
      ) : (
        <span className="self-start">
          <Badge variant="outline" size="sm">
            Waiting for triage
          </Badge>
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {editing ? (
          <>
            <Button size="xs" disabled={busy} onClick={() => void run(editing)}>
              {busy ? "Filing…" : "File it"}
            </Button>
            {editing.action === "new" || editing.action === "comment" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void run(editing, true)}
              >
                File and start a chat
              </Button>
            ) : null}
            {editing.action === "new" && props.currentSprint ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setEditing({ ...editing, sprint: props.currentSprint, priority: "P1" })
                }
              >
                Expedite ({props.currentSprint}, P1)
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {note.proposal ? (
              <Button
                size="xs"
                disabled={busy}
                onClick={() => note.proposal && void run(note.proposal)}
              >
                {busy ? "Filing…" : "Approve"}
              </Button>
            ) : null}
            {note.proposal &&
            (note.proposal.action === "new" || note.proposal.action === "comment") ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => note.proposal && void run(note.proposal, true)}
              >
                Approve and start a chat
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setEditing(
                  note.proposal ?? {
                    action: "new",
                    itemUrl: null,
                    repo: null,
                    app: note.app,
                    type: "Bug",
                    priority: "P2",
                    title: suggestTitle(note.text),
                    reason: "Sorted by Rigo.",
                  },
                )
              }
            >
              {note.proposal ? "Change" : "Sort it myself"}
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} onClick={dismiss}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function ProposalEditor(props: {
  readonly value: InboxProposal;
  readonly items: ReadonlyArray<DeskItem>;
  readonly apps: ReadonlyArray<string>;
  readonly sprints: ReadonlyArray<string>;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly onChange: (value: InboxProposal) => void;
}) {
  const { value } = props;
  const set = (patch: Partial<InboxProposal>) => props.onChange({ ...value, ...patch });
  const appItems = props.items.filter(
    (item) =>
      (item.state === "open" || item.state === "draft") &&
      item.kind !== "pr" &&
      (value.app === null || item.app === value.app),
  );
  const repos = [
    ...new Set(
      props.items
        .filter((item) => value.app === null || item.app === value.app)
        .flatMap((item) => (item.repo ? [item.repo] : [])),
    ),
  ].toSorted();
  const menu = (
    label: string,
    current: string | null,
    options: ReadonlyArray<string>,
    onPick: (next: string | null) => void,
    render: (option: string) => string = (option) => option,
  ) => (
    <Select
      value={current ?? NONE}
      onValueChange={(next) => onPick(typeof next === "string" && next !== NONE ? next : null)}
    >
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue>{current ? render(current) : label}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {render(option)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
  const byUrl = new Map(appItems.flatMap((item) => (item.url ? [[item.url, item]] : [])));
  const chatName = new Map(props.chats.map((chat) => [chatKeyOf(chat), chatTitle(chat.title)]));
  const chatKeys = [...chatName.keys()];
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-2 sm:grid-cols-2">
      {menu(
        "What to do",
        value.action,
        ["comment", "new", "planner", "chat", "dismiss"],
        (next) => set({ action: (next as InboxAction | null) ?? "new" }),
        (option) => ACTION_LABEL[option as InboxAction],
      )}
      {menu("App", value.app, props.apps, (next) => set({ app: next, repo: null, itemUrl: null }))}
      {value.action === "comment"
        ? menu(
            "Item",
            value.itemUrl,
            [...byUrl.keys()],
            (next) => set({ itemUrl: next }),
            (url) => {
              const item = byUrl.get(url);
              return item ? `${deskRef(item)} ${deskTitle(item)}` : url;
            },
          )
        : null}
      {value.action === "new" ? (
        <>
          {menu("Repo", value.repo, repos, (next) => set({ repo: next }))}
          {menu("Type", value.type, TYPES, (next) => set({ type: next }))}
          {menu("Priority", value.priority, PRIORITIES, (next) => set({ priority: next }))}
          <Input
            aria-label="Title"
            size="sm"
            className="sm:col-span-2"
            placeholder="Plain title"
            value={value.title ?? ""}
            onChange={(event) => set({ title: event.target.value })}
          />
          {menu("Sprint", value.sprint ?? BACKLOG, [BACKLOG, ...props.sprints], (next) =>
            set({ sprint: next === BACKLOG ? null : next }),
          )}
        </>
      ) : null}
      {value.action === "dismiss"
        ? null
        : menu(
            value.action === "chat" ? "Chat" : "Also send to a chat",
            value.chat ?? null,
            [...(value.action === "chat" ? [] : [NONE_CHAT]), ...chatKeys],
            (next) => set({ chat: next === NONE_CHAT ? null : next }),
            (key) => (key === NONE_CHAT ? "No chat" : (chatName.get(key) ?? key)),
          )}
    </div>
  );
}
