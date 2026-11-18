import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { DraftId } from "../../composerDraftStore";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PlusIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import ChatMarkdown from "../ChatMarkdown";
import ChatView from "../ChatView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { CardChatState } from "./boardCards.logic";
import {
  type DeskDetail,
  type DeskItem,
  type DeskSprint,
  type DeskView,
  deskRef,
  deskTitle,
  featureName,
  featureRecord,
  groupWork,
  sprintOverview,
} from "./desk.logic";
import { type DeskNotes, noteAt } from "./deskNotes.logic";
import { saveDeskNote } from "./deskNotesStore";
import {
  DeskHeading,
  formatDay,
  NoteEditor,
  openExternal,
  STAGE_VARIANT,
  ThreadList,
} from "./DeskParts";
import { type DeskField, fetchDeskDetail, setDeskField } from "./deskStore";
import { ChatAboutButton } from "./DeskChat";
import { PrPanel } from "./DeskPrs";
import type { DeskPr } from "./deskPrs.logic";
import { StorySection } from "./DeskStory";

const NONE = "__none__";
const STAGE_RANK: Record<string, number> = { Production: 3, Testing: 2, Experiment: 1, "": 0 };
const DAY = 86_400_000;

/** A field as a small labelled menu that saves to GitHub on change. */
function FieldMenu(props: {
  readonly label: string;
  readonly field: DeskField;
  readonly item: DeskItem;
  readonly value: string | null;
  readonly options: ReadonlyArray<string>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-2xs text-muted-foreground">{props.label}</span>
      <Select
        value={props.value ?? NONE}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          const value = next === NONE ? null : next;
          if (value !== props.value) void setDeskField(props.item.itemId, props.field, value);
        }}
      >
        <SelectTrigger aria-label={props.label} size="sm">
          <SelectValue>{props.value ?? "None"}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {props.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <SelectItem value={NONE}>None</SelectItem>
        </SelectPopup>
      </Select>
    </label>
  );
}

const CHECKS: Record<string, { label: string; variant: "success" | "error" | "info" | "outline" }> =
  {
    SUCCESS: { label: "checks passing", variant: "success" },
    FAILURE: { label: "checks failing", variant: "error" },
    ERROR: { label: "checks failing", variant: "error" },
    PENDING: { label: "checks running", variant: "info" },
    EXPECTED: { label: "checks waiting", variant: "outline" },
  };
const REVIEW: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  REVIEW_REQUIRED: "needs review",
};

function when(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** One work item, read and changed in T3: fields, plain words, description, PRs, family, chats. */
function ItemDetails(props: {
  readonly item: DeskItem;
  readonly view: DeskView;
  readonly onOpenItem: (item: DeskItem) => void;
}) {
  const { item, view } = props;
  const [detail, setDetail] = useState<DeskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the item's full text from the hub when the dialog opens
  useEffect(() => {
    let live = true;
    fetchDeskDetail(item.itemId).then(
      (loaded) => live && setDetail(loaded),
      (cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      live = false;
    };
  }, [item.itemId]);
  const options = view.options ?? {};
  const byUrl = new Map(view.items.flatMap((entry) => (entry.url ? [[entry.url, entry]] : [])));
  const openRef = (url: string) => {
    const found = byUrl.get(url);
    if (found) props.onOpenItem(found);
    else openExternal(url);
  };
  const isFeature = item.workType === "Tracking" && item.title.startsWith("Feature:");
  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          {[item.app, item.feature ? featureName(item.feature) : null, deskRef(item)]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <h2 className="text-base font-semibold">{deskTitle(item)}</h2>
        {item.plain?.what && item.plain.what !== item.title ? (
          <span className="text-xs text-muted-foreground">On GitHub: {item.title}</span>
        ) : null}
      </header>

      <StorySection item={item} />

      <div className="grid grid-cols-2 gap-3">
        {isFeature ? (
          <FieldMenu
            label="Stage"
            field="Stage"
            item={item}
            value={item.stage}
            options={options.Stage ?? []}
          />
        ) : (
          <>
            <FieldMenu
              label="Sprint"
              field="Sprint"
              item={item}
              value={item.sprint?.title ?? null}
              options={(view.sprints ?? []).map((sprint) => sprint.title)}
            />
            <FieldMenu
              label="Lane"
              field="Lane"
              item={item}
              value={item.lane}
              options={options.Lane ?? []}
            />
          </>
        )}
        <FieldMenu
          label="Priority"
          field="Priority"
          item={item}
          value={item.priority}
          options={options.Priority ?? []}
        />
        <FieldMenu
          label="Work type"
          field="Work type"
          item={item}
          value={item.workType}
          options={options["Work type"] ?? []}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Status: {item.status ?? "none"} · Size: {item.size ?? "none"} · {item.state}
        {detail?.author ? ` · opened by ${detail.author} ${when(detail.createdAt)}` : ""}
      </p>

      {item.plain ? (
        <section className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <DeskHeading>In plain words</DeskHeading>
          {item.plain.what ? <p>{item.plain.what}</p> : null}
          {item.plain.why ? <p className="text-muted-foreground">Why: {item.plain.why}</p> : null}
          {item.plain.where ? (
            <p className="text-muted-foreground">Now: {item.plain.where}</p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive">Couldn't load the details: {error}</p>
      ) : null}
      {detail?.unavailable && detail.unavailable.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Not shown: {detail.unavailable.join(", ")} (the hub's GitHub token can't read them).
        </p>
      ) : null}
      {!detail && !error ? <p className="text-sm text-muted-foreground">Loading details…</p> : null}

      {detail && detail.pullRequests.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <DeskHeading>Pull requests</DeskHeading>
          <ul className="flex flex-col gap-1 text-sm">
            {detail.pullRequests.map((pr) => (
              <li key={pr.url} className="flex flex-wrap items-center gap-1.5">
                <Badge variant={pr.state === "merged" ? "success" : "outline"} size="sm">
                  #{pr.number} {pr.state}
                </Badge>
                {pr.checks && CHECKS[pr.checks] ? (
                  <Badge variant={CHECKS[pr.checks]?.variant} size="sm">
                    {CHECKS[pr.checks]?.label}
                  </Badge>
                ) : null}
                {pr.review && REVIEW[pr.review] ? (
                  <Badge variant="secondary" size="sm">
                    {REVIEW[pr.review]}
                  </Badge>
                ) : null}
                {pr.mergeable === "CONFLICTING" ? (
                  <Badge variant="error" size="sm">
                    can't merge
                  </Badge>
                ) : null}
                <span className="min-w-0 truncate">{pr.title}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail && (detail.parent || detail.subIssues.length > 0) ? (
        <section className="flex flex-col gap-1.5">
          <DeskHeading>Related</DeskHeading>
          <ul className="flex flex-col gap-1 text-sm">
            {detail.parent ? (
              <li>
                <span className="text-muted-foreground">Part of </span>
                <button
                  type="button"
                  className="cursor-pointer text-left hover:underline"
                  onClick={() => detail.parent && openRef(detail.parent.url)}
                >
                  {detail.parent.title}
                </button>
              </li>
            ) : null}
            {detail.subIssues.map((sub) => (
              <li key={sub.url} className="flex items-center gap-1.5">
                <Badge variant={sub.state === "closed" ? "success" : "outline"} size="sm">
                  {sub.state === "closed" ? "done" : "open"}
                </Badge>
                <button
                  type="button"
                  className="min-w-0 cursor-pointer truncate text-left hover:underline"
                  onClick={() => openRef(sub.url)}
                >
                  {sub.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail ? (
        <section className="flex flex-col gap-1.5">
          <DeskHeading>Description</DeskHeading>
          {detail.body.trim() ? (
            <div className="text-sm">
              <ChatMarkdown text={detail.body} cwd={undefined} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No description.</p>
          )}
        </section>
      ) : null}

      {detail && detail.comments.recent.length > 0 ? (
        <section className="flex flex-col gap-2">
          <DeskHeading>
            Comments · {detail.comments.total}
            {detail.comments.total > detail.comments.recent.length
              ? ` (latest ${detail.comments.recent.length})`
              : ""}
          </DeskHeading>
          {detail.comments.recent.map((comment) => (
            <article key={comment.url} className="rounded-md border border-border p-3 text-sm">
              <p className="mb-1 text-2xs text-muted-foreground">
                {comment.author ?? "someone"} · {when(comment.createdAt)}
              </p>
              <ChatMarkdown text={comment.body} cwd={undefined} />
            </article>
          ))}
        </section>
      ) : null}
      {item.url ? (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          onClick={() => item.url && openExternal(item.url)}
        >
          <ExternalLinkIcon />
          Open on GitHub
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The Desk's work window, like the Board's card window: an item's details on the left and its
 * live T3 chat on the right, over the Desk so you keep your place. Opened on a chat alone, the
 * chat fills it. Alt+← / Alt+→ step through the list it was opened from.
 */
export function DeskModal(props: {
  readonly item: DeskItem | null;
  /** Opened from a pull request: it shows first, with its merge state and next steps. */
  readonly pr?: DeskPr | null;
  readonly chat: CardChatState | null;
  readonly chats: ReadonlyArray<CardChatState>;
  /** A new chat started from the Desk, not sent yet: shown as a draft until it is. */
  readonly draft: {
    readonly draftId: DraftId;
    readonly threadId: ThreadId;
    readonly environmentId: EnvironmentId;
  } | null;
  readonly view: DeskView;
  readonly sequence: ReadonlyArray<string>;
  readonly onNavigate: (itemId: string) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onClose: () => void;
  readonly onChat: (item: DeskItem) => void;
}) {
  const { item } = props;
  const [chosen, setChosen] = useState<CardChatState | null>(props.chat);
  const [showDraft, setShowDraft] = useState(props.draft !== null);
  const shown =
    (chosen && props.chats.find((chat) => chatKeyOf(chat) === chatKeyOf(chosen))) ??
    chosen ??
    props.chats[0] ??
    null;
  const [pane, setPane] = useState<"details" | "chat">(item || props.pr ? "details" : "chat");
  const index = item ? props.sequence.indexOf(item.itemId) : -1;
  const previous = index > 0 ? props.sequence[index - 1] : undefined;
  const next = index !== -1 ? props.sequence[index + 1] : undefined;
  const draft = showDraft ? props.draft : null;
  const title = item ? deskTitle(item) : draft ? "New chat" : (shown?.title ?? "Chat");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup
        showCloseButton={false}
        className="flex h-[92dvh] flex-col sm:max-w-[min(96vw,96rem)]"
        onKeyDown={(event) => {
          if (!event.altKey) return;
          if (event.key === "ArrowLeft" && previous) {
            event.preventDefault();
            props.onNavigate(previous);
          } else if (event.key === "ArrowRight" && next) {
            event.preventDefault();
            props.onNavigate(next);
          }
        }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border py-2 ps-3 pe-3 sm:pe-36">
          {item && props.sequence.length > 1 ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous item (Alt+←)"
                disabled={!previous}
                onClick={() => previous && props.onNavigate(previous)}
              >
                <ChevronLeftIcon />
              </Button>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {index === -1 ? "" : `${index + 1} of ${props.sequence.length}`}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next item (Alt+→)"
                disabled={!next}
                onClick={() => next && props.onNavigate(next)}
              >
                <ChevronRightIcon />
              </Button>
            </>
          ) : null}
          <div className="min-w-0 flex-1">
            <DialogTitle>
              <span className="block truncate text-sm">
                {item?.app ? <span className="text-muted-foreground">{item.app} · </span> : null}
                {title}
              </span>
            </DialogTitle>
          </div>
          {item ? (
            <ToggleGroup
              aria-label="Show"
              className="sm:hidden"
              value={[pane]}
              onValueChange={(value) => {
                if (value[0] === "details" || value[0] === "chat") setPane(value[0]);
              }}
            >
              <Toggle value="details">Item</Toggle>
              <Toggle value="chat">Chat</Toggle>
            </ToggleGroup>
          ) : null}
          {item && props.chats.length === 0 && !props.draft ? (
            <ChatAboutButton onClick={() => props.onChat(item)} />
          ) : null}
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </header>
        <div className="flex min-h-0 flex-1">
          {item || props.pr ? (
            <aside
              className={
                pane === "details"
                  ? "flex min-h-0 w-full flex-col overflow-y-auto border-border sm:w-[30rem] sm:shrink-0 sm:border-e"
                  : "hidden min-h-0 w-[30rem] shrink-0 flex-col overflow-y-auto border-e border-border sm:flex"
              }
            >
              {props.pr ? <PrPanel pr={props.pr} chat={shown ?? null} /> : null}
              {item ? (
                <ItemDetails
                  key={item.itemId}
                  item={item}
                  view={props.view}
                  onOpenItem={props.onOpenItem}
                />
              ) : null}
            </aside>
          ) : null}
          <section
            className={
              !item || pane === "chat"
                ? "relative flex min-h-0 min-w-0 flex-1 flex-col"
                : "relative hidden min-h-0 min-w-0 flex-1 flex-col sm:flex"
            }
          >
            {props.chats.length + (props.draft ? 1 : 0) > 1 ||
            (item !== null && props.chats.length > 0) ? (
              <nav
                aria-label="Chats"
                className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-1.5"
              >
                {props.draft ? (
                  <Button
                    variant={draft ? "secondary" : "ghost"}
                    size="xs"
                    onClick={() => setShowDraft(true)}
                  >
                    New chat
                  </Button>
                ) : null}
                {props.chats.map((chat) => (
                  <Button
                    key={chatKeyOf(chat)}
                    variant={
                      !draft && shown && chatKeyOf(shown) === chatKeyOf(chat)
                        ? "secondary"
                        : "ghost"
                    }
                    size="xs"
                    onClick={() => {
                      setShowDraft(false);
                      setChosen(chat);
                    }}
                  >
                    <span className="max-w-56 truncate">{chat.title}</span>
                  </Button>
                ))}
                {item ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="ms-auto"
                    onClick={() => props.onChat(item)}
                  >
                    <PlusIcon />
                    New chat
                  </Button>
                ) : null}
              </nav>
            ) : null}
            {draft ? (
              <ChatView
                key={draft.draftId}
                environmentId={draft.environmentId}
                threadId={draft.threadId}
                routeKind="draft"
                draftId={draft.draftId}
                reserveTitleBarControlInset={false}
              />
            ) : shown ? (
              <ChatView
                key={chatKeyOf(shown)}
                environmentId={shown.environmentId as EnvironmentId}
                threadId={shown.threadId as ThreadId}
                routeKind="server"
                reserveTitleBarControlInset={false}
              />
            ) : (
              <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
                No T3 chat is working on this yet.
                {item ? (
                  <ChatAboutButton
                    onClick={() => props.onChat(item)}
                    label="Start or link a chat"
                  />
                ) : null}
              </div>
            )}
          </section>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

const chatKeyOf = (chat: CardChatState) => `${chat.environmentId}:${chat.threadId}`;

function WorkList(props: {
  readonly title: string;
  readonly items: ReadonlyArray<DeskItem>;
  readonly card: (item: DeskItem) => ReactNode;
  readonly empty?: string;
  readonly limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (props.items.length === 0 && !props.empty) return null;
  const limit = props.limit ?? 12;
  const shown = all ? props.items : props.items.slice(0, limit);
  return (
    <section className="flex flex-col gap-1.5">
      <DeskHeading>
        {props.title} · {props.items.length}
      </DeskHeading>
      {props.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{props.empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">{shown.map(props.card)}</ol>
      )}
      {props.items.length > limit ? (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          onClick={() => setAll((value) => !value)}
        >
          {all ? "Show fewer" : `Show ${props.items.length - limit} more`}
        </Button>
      ) : null}
    </section>
  );
}

/** One application: sprint goal, notes, features by stage (each opening its own view), work and chats. */
export function AppView(props: {
  readonly app: string;
  readonly feature: string | null;
  readonly onChat: () => void;
  readonly items: ReadonlyArray<DeskItem>;
  readonly sprint: DeskSprint | null;
  readonly notes: DeskNotes;
  readonly threads: ReadonlyArray<CardChatState>;
  readonly card: (item: DeskItem) => ReactNode;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onFeature: (feature: string | null) => void;
}) {
  const { app, items, sprint } = props;
  const features = [
    ...new Set(items.flatMap((item) => (item.app === app && item.feature ? [item.feature] : []))),
  ]
    .map((feature) => ({ feature, record: featureRecord(items, feature) }))
    .sort(
      (a, b) => (STAGE_RANK[b.record?.stage ?? ""] ?? 0) - (STAGE_RANK[a.record?.stage ?? ""] ?? 0),
    );
  const feature = props.feature;
  const record = feature ? featureRecord(items, feature) : null;
  const work = groupWork(
    items,
    (item) => item.app === app && (feature === null || item.feature === feature),
    sprint,
  );
  const goalTarget = sprint ? ({ kind: "sprintGoal", sprint: sprint.title, app } as const) : null;
  const tabs = (
    <nav className="flex flex-wrap items-center gap-2 text-sm">
      {feature ? (
        <Button variant="ghost" size="xs" onClick={() => props.onFeature(null)}>
          <ArrowLeftIcon />
          {app}
        </Button>
      ) : null}
      <ChatAboutButton onClick={props.onChat} />
    </nav>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6">
      {tabs}
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{feature ? featureName(feature) : app}</h2>
        {record ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {record.stage ? (
              <Badge variant={STAGE_VARIANT[record.stage]} size="sm">
                {record.stage}
              </Badge>
            ) : null}
            <span className="text-muted-foreground">{record.plain?.what ?? ""}</span>
            <Button variant="ghost" size="xs" onClick={() => props.onOpenItem(record)}>
              Change stage or details
            </Button>
          </div>
        ) : null}
      </header>

      {!feature ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            {goalTarget ? (
              <NoteEditor
                label={`${sprint?.title} goal`}
                hint="One line: what this app should reach this sprint."
                placeholder="e.g. Estimators level bids on one screen, in Testing with two of them."
                note={noteAt(props.notes, goalTarget)}
                rows={2}
                onSave={(text) => saveDeskNote(goalTarget, text)}
              />
            ) : null}
            <NoteEditor
              label="Notes for agents"
              hint="Goals, decisions, conventions, what not to touch. Agents read this before working here."
              placeholder="- Who uses it and what they need&#10;- Decisions made&#10;- What not to touch"
              note={props.notes.apps[app] ?? null}
              rows={5}
              onSave={(text) => saveDeskNote({ kind: "app", app }, text)}
            />
          </div>
          <div className="flex flex-col gap-3">
            <section className="flex flex-col gap-1.5">
              <DeskHeading>Features · {features.length}</DeskHeading>
              <ul className="flex flex-col gap-1 text-sm">
                {features.map(({ feature: key, record: entry }) => {
                  const open = items.filter(
                    (item) =>
                      item.feature === key &&
                      item.workType !== "Tracking" &&
                      (item.state === "open" || item.state === "draft"),
                  ).length;
                  return (
                    <li key={key} className="flex items-center gap-2">
                      <span className="w-24 shrink-0">
                        {entry?.stage ? (
                          <Badge variant={STAGE_VARIANT[entry.stage]} size="sm">
                            {entry.stage}
                          </Badge>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline"
                        onClick={() => props.onFeature(key)}
                      >
                        {featureName(key)}
                      </button>
                      <span className="text-2xs text-muted-foreground tabular-nums">
                        {open} open
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="flex flex-col gap-1.5">
              <DeskHeading>Threads · {props.threads.length}</DeskHeading>
              <ThreadList
                threads={props.threads}
                onOpenChat={props.onOpenChat}
                empty="No open T3 chats in this app's repos."
              />
            </section>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorkList
          title={sprint ? `In ${sprint.title}` : "This sprint"}
          items={work.sprint}
          card={props.card}
          empty="Nothing in this sprint."
        />
        <WorkList title="Blocked" items={work.blocked} card={props.card} />
        <WorkList title="Other open work" items={work.open} card={props.card} empty="None." />
        <WorkList title="Done in the last 2 weeks" items={work.done} card={props.card} limit={8} />
      </div>
    </div>
  );
}

/** One sprint across applications: dates, progress, budget split, notes and each app's goal and work. */
export function SprintView(props: {
  readonly view: DeskView;
  readonly sprint: DeskSprint;
  readonly nowMs: number;
  readonly notes: DeskNotes;
  readonly app: string | null;
  readonly card: (item: DeskItem) => ReactNode;
  readonly onSprint: (title: string) => void;
  readonly onChat: () => void;
  readonly linkedChats: ReadonlyArray<CardChatState>;
  readonly prsPanel: ReactNode;
  readonly onOpenChat: (chat: CardChatState) => void;
}) {
  const { sprint, view } = props;
  const apps = props.app ? [props.app] : (view.apps ?? []);
  const overview = sprintOverview(view.items, sprint, apps, props.app === null);
  const start = Date.parse(`${sprint.startDate}T00:00:00`);
  const end = start + sprint.duration * DAY;
  const daysLeft = Math.max(0, Math.ceil((end - props.nowMs) / DAY));
  const started = props.nowMs >= start;
  const open = overview.mix.feature + overview.mix.maintenance + overview.mix.other;
  const percent = (value: number) => (open === 0 ? 0 : Math.round((value / open) * 100));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="w-40">
          <Select
            value={sprint.title}
            onValueChange={(value) => {
              if (typeof value === "string") props.onSprint(value);
            }}
          >
            <SelectTrigger aria-label="Sprint" size="sm">
              <SelectValue>{sprint.title}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {(view.sprints ?? []).map((entry) => (
                <SelectItem key={entry.title} value={entry.title}>
                  {entry.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <span className="text-sm">
          {formatDay(sprint.startDate)} – {formatDay(sprint.startDate, sprint.duration - 1)}
        </span>
        <span className="text-sm text-muted-foreground">
          {!started ? "Not started" : daysLeft === 0 ? "Ended" : `${daysLeft} days left`}
        </span>
        <span className="text-sm text-muted-foreground">
          {overview.done} of {overview.total} done
        </span>
        <ChatAboutButton onClick={props.onChat} label="Chat about this sprint" />
      </header>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Sprint progress"
        aria-valuemin={0}
        aria-valuemax={overview.total}
        aria-valuenow={overview.done}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${overview.total === 0 ? 0 : (overview.done / overview.total) * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Open work: {percent(overview.mix.feature)}% features · {percent(overview.mix.maintenance)}%
        maintenance · {percent(overview.mix.other)}% fixes, research & support (budget 60 / 20 /
        20). Add work to a sprint from any item's Sprint menu.
      </p>
      <section className="flex flex-col gap-1.5">
        <DeskHeading>Pull requests in this sprint</DeskHeading>
        {props.prsPanel}
      </section>
      <section className="flex flex-col gap-1.5">
        <DeskHeading>Threads on this sprint · {props.linkedChats.length}</DeskHeading>
        <ThreadList
          threads={props.linkedChats}
          onOpenChat={props.onOpenChat}
          empty="No threads on this sprint's work yet. Use Chat about this sprint to start one."
        />
      </section>
      <NoteEditor
        label={`${sprint.title} notes`}
        hint="What this sprint is for and what feedback said. Agents read it."
        placeholder="Goal for the sprint, then testers' feedback as it comes in."
        note={noteAt(props.notes, { kind: "sprintNotes", sprint: sprint.title })}
        rows={3}
        onSave={(text) => saveDeskNote({ kind: "sprintNotes", sprint: sprint.title }, text)}
      />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {apps.map((app) => {
          const work = overview.apps.find((entry) => entry.app === app);
          const goalTarget = { kind: "sprintGoal", sprint: sprint.title, app } as const;
          return (
            <section
              key={app}
              aria-label={app}
              className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
            >
              <header className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold">{app}</h2>
                <span className="text-xs text-muted-foreground">
                  {work ? `${work.done} of ${work.items.length} done` : "Nothing planned"}
                </span>
              </header>
              <NoteEditor
                label="Goal"
                hint="One line: what this app should reach this sprint."
                placeholder="What this app should reach by the end of the sprint."
                note={noteAt(props.notes, goalTarget)}
                rows={1}
                onSave={(text) => saveDeskNote(goalTarget, text)}
              />
              {work ? <ol className="flex flex-col gap-2">{work.items.map(props.card)}</ol> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
