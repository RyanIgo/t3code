import { InboxIcon, NotebookPenIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { type DeskItem, deskRef, deskTitle } from "./desk.logic";
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
import { commentOnDeskItem, createDeskItem } from "./deskStore";

const NONE = "__none__";
const TYPES = ["Bug", "Story", "Maintenance", "Research", "Support"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const ACTION_LABEL: Record<InboxAction, string> = {
  comment: "Add to an item",
  new: "New item",
  planner: "Send to the app's planner",
  dismiss: "Not development work",
};

const newId = () => Math.random().toString(36).slice(2, 12);
const day = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/** Fleet fork: a quick note from an email, a meeting or a hallway ask, kept until it's sorted. */
export function QuickNoteButton(props: { readonly apps: ReadonlyArray<string> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [source, setSource] = useState<InboxSource>("In person");
  const [who, setWho] = useState("");
  const [app, setApp] = useState<string | null>(null);
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
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <NotebookPenIcon />
        Note
      </Button>
      {open ? (
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
                placeholder="What was asked or reported, in your words"
                rows={4}
                autoFocus
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
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
                It waits in the inbox on Now. A triage agent proposes where it goes; nothing is
                filed until you approve.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!text.trim()}>
                  Save to inbox
                </Button>
              </div>
            </form>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}

function describe(proposal: InboxProposal, items: ReadonlyArray<DeskItem>): string {
  if (proposal.action === "comment") {
    const item = items.find((entry) => entry.url === proposal.itemUrl);
    return `Add to ${item ? `${deskRef(item)}: ${deskTitle(item)}` : (proposal.itemUrl ?? "an item")}`;
  }
  if (proposal.action === "new") {
    return `New ${proposal.type ?? "item"} in ${proposal.app ?? "?"}${proposal.priority ? ` (${proposal.priority})` : ""}: ${proposal.title ?? ""}`;
  }
  if (proposal.action === "planner") return `Send to ${proposal.app ?? "the app"}'s planner`;
  return "Not development work: dismiss";
}

const from = (note: InboxNote) =>
  [note.who, note.source, day(note.createdAt)].filter(Boolean).join(" · ");

/** Files an approved note: a comment, a new issue, a hand-off to a planner, or nothing. */
async function file(note: InboxNote, proposal: InboxProposal): Promise<InboxNote> {
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
            <InboxCard key={note.id} note={note} items={props.items} apps={props.apps} />
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
                <span className="min-w-0 flex-1 truncate">{note.text}</span>
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

function InboxCard(props: {
  readonly note: InboxNote;
  readonly items: ReadonlyArray<DeskItem>;
  readonly apps: ReadonlyArray<string>;
}) {
  const { note } = props;
  const [editing, setEditing] = useState<InboxProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (proposal: InboxProposal) => {
    setBusy(true);
    try {
      saveInboxNote(await file(note, proposal));
      setEditing(null);
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
      <p className="whitespace-pre-wrap">{note.text}</p>
      {editing ? (
        <ProposalEditor
          value={editing}
          items={props.items}
          apps={props.apps}
          onChange={setEditing}
        />
      ) : note.proposal ? (
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/60 px-2 py-1.5">
          <span className="font-medium">{describe(note.proposal, props.items)}</span>
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
                    title: note.text.split("\n")[0]?.slice(0, 120) ?? "",
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
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-2 sm:grid-cols-2">
      {menu(
        "What to do",
        value.action,
        ["comment", "new", "planner", "dismiss"],
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
        </>
      ) : null}
    </div>
  );
}
