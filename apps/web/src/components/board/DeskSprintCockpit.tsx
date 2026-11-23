/**
 * Fleet fork: the Sprint page for one app, its home. The planner chat beside what needs Rigo and
 * the work's progress by feature, under the goal and a schedule that folds to one line.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ImagePlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import ChatView from "../ChatView";
import { ChatEmbedContext } from "../chat/ChatEmbedContext";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { InboxCard, QuickNoteForm } from "./DeskInbox";
import { ActNow } from "./DeskMobile";
import { cn } from "../../lib/utils";
import type { CardChatState } from "./boardCards.logic";
import {
  chatStatus,
  chatTitle,
  type DeskItem,
  type DeskSprint,
  deskRef,
  deskTitle,
  type ItemSignals,
  needsWrapUp,
  workKind,
  wrapUpLeft,
} from "./desk.logic";
import { BigPicture, DecisionCard, LinkedThing, useDecisionActions } from "./DeskAgents";
import ChatMarkdown from "../ChatMarkdown";
import {
  noteAt,
  openDecisions,
  type DeskNotes,
  type InboxNote,
  type PlanLine,
  waitingReports,
} from "./deskNotes.logic";
import { savePlanLineDone, savePlanLineQuestion } from "./deskNotesStore";
import { uploadPicture } from "./deskStore";
import { DeskHeading, TypeTag } from "./DeskParts";
import { type DeskPr, isDependencyUpdate, PR_STAGES } from "./deskPrs.logic";
import { useSendToChat } from "./deskSend";
import { type SheetSummary, sheetsForItem, useHubSheets } from "./deskSheets";
import { formatFleetBoardAge } from "./fleetBoard.logic";
import {
  featureGroups,
  featureName,
  isOpenWork,
  scheduleBars,
  setupGaps,
  sprintDays,
  STORY_STEPS,
  type StepState,
  storySteps,
} from "./sprintCockpit.logic";

const DAY = 86_400_000;
const GENERAL = "General";

type NeedKind = "test" | "triage" | "decide" | "todo" | "wrap";
const NEED_KINDS: ReadonlyArray<{
  readonly id: NeedKind;
  readonly label: string;
  readonly hint: string;
}> = [
  { id: "test", label: "Test & merge", hint: "a chat finished and waits on you" },
  { id: "triage", label: "Sort & file", hint: "notes you took: approve where each goes" },
  { id: "decide", label: "Decide & answer", hint: "the planner or a chat needs your call" },
  { id: "todo", label: "To do", hint: "only you can do these" },
  { id: "wrap", label: "Wrap up", hint: "closed, but something's still open" },
];

interface Need {
  readonly key: string;
  readonly kind: NeedKind;
  readonly title: string;
  readonly meta: string;
  readonly feature: string;
  readonly action: ReactNode;
  /** The pop-up behind the row's title: why it's here and what's behind it. */
  readonly info?: ReactNode;
  /** A decision: its card opens in a dialog, from the title or the Answer button. */
  readonly dialog?: {
    readonly title: string;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  };
}

/** What's behind a row in Needs you: the item, its PR and the chat that worked on it. */
interface NeedContext {
  readonly why: string;
  readonly item: DeskItem | null;
  readonly pr: DeskPr | null;
  readonly chat: CardChatState | null;
}

/** A planner's line for Rigo: what to do, why, the steps and the links, and what's behind it. */
function TodoDetails(props: {
  readonly line: PlanLine;
  readonly context: NeedContext;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly sheets: ReadonlyArray<SheetSummary>;
  readonly nowMs: number;
  readonly relatedChatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onDone: () => void;
  /** Puts Rigo's question on the line and sends it to the planner; the answer comes back here. */
  readonly onQuestion: (question: string) => void;
  /** The planner chat's state, for while an answer is pending. */
  readonly plannerState: string | null;
  /** Opened from the row's Ask: start in the question box. */
  readonly focusQuestion: boolean;
}) {
  const { line } = props;
  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(0);
  // Screenshots go to the hub and into the question as markdown, so the planner can open them.
  const attach = async (files: ReadonlyArray<File>) => {
    const images = files.filter((entry) => entry.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading((count) => count + images.length);
    for (const image of images) {
      try {
        const url = await uploadPicture(image);
        setQuestion(
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
  const links = [...new Set([...(line.links ?? []), ...(line.itemUrl ? [line.itemUrl] : [])])];
  const thin = !line.why || !line.how;
  const ask = (text: string) => {
    if (!text.trim()) return;
    props.onQuestion(text.trim());
    setQuestion("");
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-base font-medium">{line.text}</p>
      <section className="flex flex-col gap-1">
        <DeskHeading>Why</DeskHeading>
        {line.why ? (
          <p>{line.why}</p>
        ) : (
          <p className="text-muted-foreground">The planner didn't say why.</p>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <DeskHeading>How</DeskHeading>
        {line.how ? (
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <ChatMarkdown text={line.how} cwd={undefined} />
          </div>
        ) : (
          <p className="text-muted-foreground">No steps yet.</p>
        )}
      </section>
      {links.length > 0 ? (
        <section className="flex flex-col gap-1">
          <DeskHeading>Links</DeskHeading>
          {links.map((url) => (
            <LinkedThing
              key={url}
              url={url}
              items={props.items}
              sheets={props.sheets}
              chatsFor={props.relatedChatsFor}
              notes={props.notes}
              nowMs={props.nowMs}
              onOpenChat={props.onOpenChat}
            />
          ))}
        </section>
      ) : null}
      {props.context.item || props.context.pr || props.context.chat ? (
        <NeedInfo
          inline
          context={props.context}
          notes={props.notes}
          sheets={props.sheets}
          nowMs={props.nowMs}
          onOpenChat={props.onOpenChat}
          onOpenPr={props.onOpenPr}
          onOpenItem={props.onOpenItem}
        />
      ) : null}
      <section aria-label="Questions" className="flex flex-col gap-2 border-t border-border pt-3">
        <DeskHeading>Questions for the planner</DeskHeading>
        {(line.qa ?? []).length > 0 ? (
          <ol className="flex flex-col gap-2">
            {(line.qa ?? []).map((entry) => (
              <li key={entry.at} className="flex flex-col gap-1">
                <div className="max-w-[85%] self-end rounded-xl bg-muted px-3 py-1.5 text-sm [&_img]:max-h-60 [&_img]:rounded-md">
                  <ChatMarkdown text={entry.q} cwd={undefined} />
                </div>
                {entry.a ? (
                  <div className="rounded-xl border border-border px-3 py-1.5">
                    <span className="text-2xs font-semibold text-muted-foreground">Planner</span>
                    <ChatMarkdown text={entry.a} cwd={undefined} />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Waiting for the planner's answer
                    {props.plannerState ? ` (its chat: ${props.plannerState.toLowerCase()})` : ""}.
                    It shows here when it's in.
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">
            Not clear what to do, or why? Ask here. The planner answers on this to-do.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {[
            ...(thin ? ["Add the why and the exact steps, please."] : []),
            "What does done look like, and how do I check it?",
            "Can an agent do this instead of me?",
          ].map((preset) => (
            <Button key={preset} size="xs" variant="outline" onClick={() => ask(preset)}>
              {preset}
            </Button>
          ))}
        </div>
        <label htmlFor={`todo-question-${line.text.length}`} className="sr-only">
          Your question
        </label>
        <Textarea
          id={`todo-question-${line.text.length}`}
          rows={2}
          autoFocus={props.focusQuestion}
          placeholder="Ask about this to-do: what's unclear, what you'd need, what you'd change. Paste or drop a screenshot to show it."
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
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
              ask(question);
            }
          }}
        />
      </section>
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-popover pt-3">
        <Button size="sm" onClick={props.onDone}>
          Done
        </Button>
        <span className="flex-1" />
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
        <Button
          size="sm"
          variant="outline"
          disabled={!question.trim() || uploading > 0}
          onClick={() => ask(question)}
        >
          Ask the planner
        </Button>
      </div>
    </div>
  );
}

function NeedInfo(props: {
  readonly context: NeedContext;
  /** Laid out in the page (an opened story) rather than in a pop-up. */
  readonly inline?: boolean;
  readonly notes: DeskNotes;
  readonly sheets: ReadonlyArray<SheetSummary>;
  readonly nowMs: number;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenItem: (item: DeskItem) => void;
}) {
  const { item, pr, chat, why } = props.context;
  const work = chat ? props.notes.work[chat.threadId] : undefined;
  const sheet = item ? (sheetsForItem(props.sheets, item, props.notes)[0] ?? null) : null;
  const checked = sheet
    ? sheet.counts.pass + sheet.counts.fail + sheet.counts.skip + sheet.counts.blocked
    : 0;
  const part = (title: string, body: ReactNode) => (
    <section className="flex flex-col gap-1 border-t border-border pt-2">
      <DeskHeading>{title}</DeskHeading>
      {body}
    </section>
  );
  return (
    <div
      className={cn(
        "flex flex-col gap-2 text-sm",
        !props.inline && "max-h-[70vh] w-96 max-w-full overflow-y-auto",
      )}
    >
      {why ? <p>{why}</p> : null}
      {item?.plain && (item.plain.what || item.plain.where)
        ? part(
            "In plain words",
            <dl className="flex flex-col gap-0.5 text-xs">
              {item.plain.what ? <dd>{item.plain.what}</dd> : null}
              {item.plain.why ? (
                <dd className="text-muted-foreground">Why: {item.plain.why}</dd>
              ) : null}
              {item.plain.where ? (
                <dd className="text-muted-foreground">Where it stands: {item.plain.where}</dd>
              ) : null}
            </dl>,
          )
        : null}
      {chat
        ? part(
            "The chat on it",
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium">
                {chatTitle(chat.title)} · {chatStatus(chat).label}
                {chat.since ? ` · ${formatFleetBoardAge(chat.since, props.nowMs) ?? ""} ago` : ""}
              </span>
              {work?.next ? <span>Next: {work.next}</span> : null}
              {work?.report?.text ? (
                <span className="text-muted-foreground">Last said: {work.report.text}</span>
              ) : null}
              <Button
                size="xs"
                variant="outline"
                className="self-start"
                onClick={() => props.onOpenChat(chat)}
              >
                Open the chat
              </Button>
            </div>,
          )
        : null}
      {pr
        ? part(
            `PR #${pr.number}`,
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{pr.title}</span>
              <span>
                {PR_STAGES.find((stage) => stage.id === pr.stage)?.label ?? pr.stage}
                {pr.checks ? ` · checks ${pr.checks}` : ""}
                {pr.mergeable === "conflicting" ? " · merge conflicts" : ""}
              </span>
              {pr.reasons.length > 0 ? (
                <ul className="list-disc ps-4 text-muted-foreground">
                  {pr.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              <Button
                size="xs"
                variant="outline"
                className="self-start"
                onClick={() => props.onOpenPr(pr)}
              >
                Open the PR
              </Button>
            </div>,
          )
        : null}
      {sheet
        ? part(
            "Test sheet",
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{sheet.title}</span>
              <span>
                {checked} of {sheet.counts.total} checked
                {sheet.counts.fail ? ` · ${sheet.counts.fail} failed` : ""}
              </span>
              <span className="flex gap-1.5">
                <a
                  href={`/a/${sheet.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Open the sheet ↗
                </a>
                {item ? (
                  <button
                    type="button"
                    className="cursor-pointer text-primary hover:underline"
                    onClick={() => props.onOpenItem(item)}
                  >
                    Review it with the app
                  </button>
                ) : null}
              </span>
            </div>,
          )
        : null}
      {item ? (
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          onClick={() => props.onOpenItem(item)}
        >
          Open {deskRef(item) ?? "the item"}
        </Button>
      ) : null}
    </div>
  );
}

const STEP_CLASS: Record<StepState, string> = {
  done: "bg-success",
  agent: "bg-info",
  you: "bg-warning",
  todo: "bg-border",
  skip: "bg-muted",
};

/** Who an item waits on now: the first open step's state. */
function waitingOn(steps: ReadonlyArray<StepState>): StepState {
  // Anything waiting on Rigo (a sheet to run, a merge) is his, whatever an agent is also doing.
  if (steps.includes("you")) return "you";
  return steps.find((step) => step !== "done" && step !== "skip") ?? "done";
}

const STEP_LABEL: Record<StepState, string> = {
  done: "Done",
  agent: "Agent on it",
  you: "Waiting on you",
  todo: "Still to come",
  skip: "Doesn't apply",
};

const WHO_LABEL: Record<StepState, string> = {
  done: "Done",
  agent: "Agent on it",
  you: "Waiting on you",
  todo: "Not started",
  skip: "",
};

const WHO_CLASS: Record<StepState, string> = {
  done: "bg-success/10 text-success-foreground",
  agent: "bg-info/10 text-info-foreground",
  you: "bg-warning/10 text-warning-foreground",
  todo: "bg-muted text-muted-foreground",
  skip: "",
};

export function SprintCockpit(props: {
  readonly app: string;
  readonly sprint: DeskSprint;
  readonly nowMs: number;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly prs: ReadonlyArray<DeskPr>;
  readonly signalsFor: (item: DeskItem) => ItemSignals;
  /** The item's own chats. */
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  /** Every chat that touched an item, for a decision's background. */
  readonly relatedChatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  /** The app's planner for this sprint, when there is one. */
  readonly planner: CardChatState | null;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onStartChat: (item: DeskItem) => void;
  readonly onStartPlanner: () => void;
  /** The status board this page replaces, for when Rigo wants the columns. */
  readonly onShowBoard: () => void;
  /** For the inbox's notes on this app: where they can be filed, and the chats to send them to. */
  readonly apps: ReadonlyArray<string>;
  readonly sprints: ReadonlyArray<string>;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly plannerFor: (app: string) => CardChatState | null;
  /** Starts the triage chat that proposes where each note goes. */
  readonly onSortInbox: () => void;
}) {
  const [view, setView] = useState<"needs" | "progress">("needs");
  const [requesting, setRequesting] = useState(false);
  const [groupBy, setGroupBy] = useState<"kind" | "feature">("kind");
  const groups = featureGroups(props.items, props.sprint, props.app, props.signalsFor);
  const moving = groups.flatMap((group) => group.stories);
  const done = groups.flatMap((group) => group.done);
  const prFor = (item: DeskItem) =>
    props.prs.find(
      (pr) =>
        pr.item?.itemId === item.itemId || item.pullRequests.some((link) => link.url === pr.url),
    ) ?? null;
  const stepsOf = (item: DeskItem) => storySteps(item, props.signalsFor(item), prFor(item));
  const needRows = useNeedRows({ ...props, moving });
  const needCount = needRows.length;
  // Every chat working on this app's sprint: on its items, or on their PRs (fixing a conflict).
  const working = new Set(
    [
      ...moving.flatMap((item) => props.signalsFor(item).chats),
      ...props.prs.filter((pr) => pr.app === props.app).flatMap((pr) => pr.chats),
    ]
      .filter((chat) => chat.working)
      .map((chat) => `${chat.environmentId}:${chat.threadId}`),
  ).size;
  const unstarted = moving.filter(
    (item) => props.signalsFor(item).chats.length === 0 && !props.signalsFor(item).focused,
  ).length;
  const goal = props.notes.sprintGoals[props.sprint.title]?.[props.app]?.text ?? null;
  const daysLeft = Math.max(
    0,
    Math.ceil(
      (Date.parse(props.sprint.startDate) + props.sprint.duration * DAY - props.nowMs) / DAY,
    ),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4 lg:overflow-hidden">
      <section aria-label="Sprint" className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-[999_1_32rem] flex-col gap-1">
          <span className="text-sm font-semibold">
            {props.sprint.title}
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              {daysLeft} days left
            </span>
          </span>
          <p className="text-base font-medium">
            <span className="me-2 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
              Goal
            </span>
            {goal ?? "No sprint goal yet: the planner proposes one as a decision."}
          </p>
        </div>
        <div
          role="group"
          aria-label="Sprint at a glance"
          className="flex flex-wrap items-center gap-1.5"
        >
          <Button size="sm" variant="outline" onClick={() => setRequesting(true)}>
            + Request
          </Button>
          <Pulse value={needCount} label="need you" tone="you" />
          <Pulse value={working} label="agents working" tone="agent" />
          <Pulse value={unstarted} label="not started" tone="todo" />
          <Pulse value={done.length} label="done" tone="done" />
        </div>
      </section>
      <Schedule {...props} moving={moving} stepsOf={stepsOf} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            role="tablist"
            aria-label="Sprint views"
            className="flex shrink-0 items-end gap-1 border-b border-border"
          >
            <ViewTab selected={view === "needs"} onClick={() => setView("needs")}>
              Needs you
              <span className="rounded-full bg-warning/10 px-1.5 text-2xs font-semibold text-warning-foreground">
                {needCount}
              </span>
            </ViewTab>
            <ViewTab selected={view === "progress"} onClick={() => setView("progress")}>
              Progress by feature
              <span className="rounded-full bg-muted px-1.5 text-2xs text-muted-foreground">
                {groups.filter((group) => group.name).length} features
              </span>
            </ViewTab>
            <span className="flex-1" />
            {view === "needs" ? (
              <div
                className="mb-1 flex gap-0.5 rounded-md bg-muted p-0.5"
                role="group"
                aria-label="Group by"
              >
                {(["kind", "feature"] as const).map((by) => (
                  <Button
                    key={by}
                    size="xs"
                    variant={groupBy === by ? "outline" : "ghost"}
                    aria-pressed={groupBy === by}
                    onClick={() => setGroupBy(by)}
                  >
                    {by === "kind" ? "By kind" : "By feature"}
                  </Button>
                ))}
              </div>
            ) : (
              <Button size="xs" variant="ghost" className="mb-1" onClick={props.onShowBoard}>
                Status board
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pt-3">
            {view === "needs" ? (
              <NeedsList rows={needRows} groupBy={groupBy} />
            ) : (
              <ProgressByFeature
                {...props}
                groups={groups}
                stepsOf={stepsOf}
                prFor={prFor}
                needsByFeature={() => {
                  setGroupBy("feature");
                  setView("needs");
                }}
              />
            )}
          </div>
        </div>
        <PlannerPane {...props} />
      </div>
      {requesting ? (
        <RequestDialog
          app={props.app}
          apps={props.apps}
          items={props.items}
          sprint={props.sprint}
          onClose={() => setRequesting(false)}
          onStartChat={props.onStartChat}
          onSortInbox={props.onSortInbox}
        />
      ) : null}
    </div>
  );
}

/**
 * A request for this app: a note in the inbox first, then either started right away (filed as P1
 * in this sprint with a chat on it) or left for triage.
 */
function RequestDialog(props: {
  readonly app: string;
  readonly apps: ReadonlyArray<string>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly sprint: DeskSprint;
  readonly onClose: () => void;
  readonly onStartChat: (item: DeskItem) => void;
  readonly onSortInbox: () => void;
}) {
  const [saved, setSaved] = useState<InboxNote | null>(null);
  return (
    <Dialog open onOpenChange={(next) => !next && props.onClose()}>
      <DialogPopup className="sm:max-w-lg">
        {saved ? (
          <>
            <DialogHeader>
              <DialogTitle>Saved to the inbox</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <div className="flex flex-col gap-3 text-sm">
                <p>
                  It's in your inbox for {props.app}. Start it now, or leave it for triage to file
                  in the right feature with criteria.
                </p>
                <ActNow
                  note={saved}
                  apps={[props.app]}
                  items={props.items}
                  currentSprint={props.sprint.title}
                  onStarted={(item) => {
                    props.onClose();
                    props.onStartChat(item);
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={props.onClose}>
                    Leave it for triage
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      props.onClose();
                      props.onSortInbox();
                    }}
                  >
                    Sort the inbox now
                  </Button>
                </div>
              </div>
            </DialogPanel>
          </>
        ) : (
          <QuickNoteForm
            apps={props.apps}
            defaultApp={props.app}
            onClose={props.onClose}
            onSaved={setSaved}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function Pulse(props: {
  readonly value: number;
  readonly label: string;
  readonly tone: StepState;
}) {
  return (
    <div className={cn("min-w-20 rounded-lg px-3 py-1.5", WHO_CLASS[props.tone])}>
      <div className="text-lg leading-tight font-bold tabular-nums">{props.value}</div>
      <div className="text-2xs">{props.label}</div>
    </div>
  );
}

function ViewTab(props: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.selected}
      onClick={props.onClick}
      className={cn(
        "-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
        props.selected
          ? "border-foreground font-semibold text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {props.children}
    </button>
  );
}

/** The sprint's days, folded to one line until opened. */
function Schedule(props: {
  readonly sprint: DeskSprint;
  readonly nowMs: number;
  readonly notes: DeskNotes;
  readonly moving: ReadonlyArray<DeskItem>;
  readonly stepsOf: (item: DeskItem) => ReadonlyArray<StepState>;
  readonly onOpenItem: (item: DeskItem) => void;
}) {
  const { days, today, end } = sprintDays(props.sprint, props.nowMs);
  const half = new Date(
    Date.parse(props.sprint.startDate) + Math.floor(props.sprint.duration / 2) * DAY,
  );
  const day = (date: Date) =>
    date.toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
  const bars = scheduleBars(props.moving, props.sprint, props.notes, props.nowMs);
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
  return (
    <details className="shrink-0 rounded-lg border border-border bg-card px-3 py-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
        <DeskHeading>Schedule</DeskHeading>
        <span className="relative flex h-2 min-w-48 flex-[1_1_20rem] overflow-hidden rounded-full">
          <span className="flex-1 bg-info/20" />
          <span className="flex-1 bg-warning/20" />
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-primary"
            style={{ left: pct(today) }}
          />
        </span>
        <span className="text-xs text-muted-foreground">
          {today < 0.5 ? "Building" : "Feedback & fixes"} · feedback from {day(half)} · review{" "}
          {day(end)}
        </span>
      </summary>
      <div className="overflow-x-auto pt-3">
        <div className="flex min-w-[52rem] flex-col gap-1">
          <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-2">
            <span />
            <div
              className="grid text-center text-2xs text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            >
              {days.map((entry) => (
                <span key={entry.iso} className={cn(entry.weekend && "opacity-50")}>
                  {entry.label}
                </span>
              ))}
            </div>
          </div>
          {bars.map((bar) => {
            const who = waitingOn(props.stepsOf(bar.item));
            return (
              <div
                key={bar.item.itemId}
                className="grid grid-cols-[14rem_minmax(0,1fr)] items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => props.onOpenItem(bar.item)}
                  className="cursor-pointer truncate text-start text-xs hover:underline"
                >
                  {deskRef(bar.item)} {deskTitle(bar.item)}
                </button>
                <div className="relative h-5 rounded bg-muted/40">
                  <span
                    className={cn(
                      "absolute inset-y-0.5 flex items-center overflow-hidden rounded px-1.5 text-2xs font-medium whitespace-nowrap",
                      WHO_CLASS[who],
                      bar.unstarted && "border border-dashed border-muted-foreground/50",
                    )}
                    style={{ left: pct(bar.from), width: pct(Math.max(0.03, bar.to - bar.from)) }}
                  >
                    {WHO_LABEL[who]}
                  </span>
                  <span
                    aria-hidden
                    className="absolute -inset-y-0.5 w-0.5 bg-primary"
                    style={{ left: pct(today) }}
                  />
                </div>
              </div>
            );
          })}
          <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-2 pt-1 text-2xs">
            <DeskHeading>Milestones</DeskHeading>
            <div className="relative h-4">
              <span
                className="absolute whitespace-nowrap text-warning-foreground"
                style={{ left: "50%" }}
              >
                ◆ Feedback starts
              </span>
              <span className="absolute end-0 whitespace-nowrap">Sprint review ◆</span>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

interface NeedInput {
  readonly app: string;
  readonly nowMs: number;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly prs: ReadonlyArray<DeskPr>;
  readonly signalsFor: (item: DeskItem) => ItemSignals;
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly relatedChatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly planner: CardChatState | null;
  readonly moving: ReadonlyArray<DeskItem>;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onStartChat: (item: DeskItem) => void;
  readonly sprint: DeskSprint;
  readonly apps: ReadonlyArray<string>;
  readonly sprints: ReadonlyArray<string>;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly plannerFor: (app: string) => CardChatState | null;
  readonly onSortInbox: () => void;
}

/** Everything that waits on Rigo in this app's sprint, each once, with its one action. */
function useNeedRows(input: NeedInput): Need[] {
  const sendToChat = useSendToChat();
  const [openDecision, setOpenDecision] = useState<string | null>(null);
  // A to-do opened from its Ask button starts in the question box.
  const [askFocus, setAskFocus] = useState<string | null>(null);
  // Asking closes the window: the answer arrives in the planner chat beside the list.
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const askedPlanner = (key: string) => {
    setOpenDecision(null);
    setAsked((current) => new Set([...current, key]));
    toastManager.add({
      type: "info",
      title: "Asked the planner",
      description: "Its answer comes in the planner chat on the right.",
    });
  };
  const sheets = useHubSheets();
  const featureOf = (item: DeskItem | null | undefined) =>
    (item ? featureName(item) : null) ?? GENERAL;
  const byUrl = (url: string | null) => input.items.find((item) => item.url === url) ?? null;
  // A link may be an issue, or a PR whose issue (or own Feature field) names the feature.
  const featureOfUrls = (urls: ReadonlyArray<string | null>) => {
    for (const url of urls) {
      const item = byUrl(url);
      if (item && featureName(item)) return featureName(item) ?? GENERAL;
      const pr = input.prs.find((entry) => entry.url === url);
      const fromPr = pr ? ((pr.item ? featureName(pr.item) : null) ?? featureName(pr)) : null;
      if (fromPr) return fromPr;
    }
    return GENERAL;
  };
  const checklist = input.planner ? (input.notes.work[input.planner.threadId]?.plan ?? []) : [];
  const agentsOn = new Set(
    checklist.flatMap((line) =>
      line.who !== "you" && !line.done && line.itemUrl ? [line.itemUrl] : [],
    ),
  );
  const rows: Need[] = [];
  const shown = new Set<string>();
  const prOf = (item: DeskItem | null) =>
    item
      ? (input.prs.find(
          (pr) =>
            pr.item?.itemId === item.itemId ||
            item.pullRequests.some((link) => link.url === pr.url),
        ) ?? null)
      : null;
  const info = (context: NeedContext) => (
    <NeedInfo
      context={context}
      notes={input.notes}
      sheets={sheets}
      nowMs={input.nowMs}
      onOpenChat={input.onOpenChat}
      onOpenPr={input.onOpenPr}
      onOpenItem={input.onOpenItem}
    />
  );
  const button = (label: string, onClick: () => void, primary = false) => (
    <Button size="xs" variant={primary ? "default" : "outline"} onClick={onClick}>
      {label}
    </Button>
  );

  // A PR the planner put to Rigo as a decision shows once, as that decision.
  const decided = new Set(
    openDecisions(input.notes, input.app).flatMap((decision) => [
      decision.itemUrl,
      ...decision.links,
    ]),
  );
  for (const pr of input.prs) {
    if (pr.app !== input.app || isDependencyUpdate(pr) || decided.has(pr.url)) continue;
    if (!(pr.stage === "ready" || (pr.stage === "fix" && !agentsOn.has(pr.url)))) continue;
    // A chat already on it (fixing a conflict, re-running checks) has it, not Rigo.
    const busy =
      pr.chats.some((chat) => chat.working) ||
      (pr.item !== null && input.signalsFor(pr.item).chats.some((chat) => chat.working));
    if (busy) continue;
    const sheet = pr.item ? input.signalsFor(pr.item).sheet : null;
    const toTest = sheet !== null && sheet.unchecked > 0;
    shown.add(pr.url);
    if (pr.item?.url) shown.add(pr.item.url);
    rows.push({
      key: `pr:${pr.url}`,
      kind: "test",
      title: `PR #${pr.number}: ${toTest ? "run the test sheet, then merge" : pr.stage === "ready" ? "ready to merge" : "send back"} · ${pr.title}`,
      meta: [
        sheet
          ? `sheet ${sheet.unchecked} left${sheet.failed ? `, ${sheet.failed} failed` : ""}`
          : null,
        pr.reasons[0] ?? null,
      ]
        .filter(Boolean)
        .join(" · "),
      feature: featureOfUrls([pr.item?.url ?? null, pr.url]),
      info: info({
        why: toTest
          ? "Its chat finished and made a test sheet. Run the sheet; if it passes, merge."
          : pr.stage === "ready"
            ? "Checks passed and it can merge. Merging can't be undone."
            : `It can't merge as it is${pr.reasons.length ? `: ${pr.reasons.join("; ")}` : ""}. Send it back to its chat to fix.`,
        item: pr.item,
        pr,
        chat: pr.chats[0] ?? (pr.item ? (input.chatsFor(pr.item)[0] ?? null) : null),
      }),
      action: button(
        toTest ? "Test" : pr.stage === "ready" ? "Merge" : "Send back",
        () => input.onOpenPr(pr),
        pr.stage === "ready",
      ),
    });
  }
  for (const item of input.moving) {
    if (item.url && shown.has(item.url)) continue;
    const signals = input.signalsFor(item);
    const chat = input.chatsFor(item)[0];
    const label = `${deskRef(item) ?? ""} ${deskTitle(item)}`.trim();
    const add = (kind: NeedKind, title: string, meta: string, action: ReactNode, why: string) => {
      if (item.url) shown.add(item.url);
      rows.push({
        key: `item:${item.itemId}`,
        kind,
        title,
        meta,
        feature: featureOf(item),
        action,
        info: info({ why, item, pr: prOf(item), chat: chat ?? null }),
      });
    };
    if (needsWrapUp(item, signals)) {
      add(
        "wrap",
        label,
        "closed; something's still open",
        button("Wrap up", () => input.onOpenItem(item)),
        `The issue is closed, but something isn't finished: ${wrapUpLeft(item, signals).join("; ") || "see the item"}.`,
      );
    } else if (chat?.needsYou) {
      add(
        "decide",
        label,
        "its chat is asking you",
        button("Answer", () => input.onOpenChat(chat), true),
        "Its chat stopped to ask you something. Open it to answer.",
      );
    } else if (signals.sheet && signals.sheet.unchecked > 0) {
      add(
        "test",
        `Run the test sheet: ${label}`,
        `${signals.sheet.unchecked} checks left`,
        button("Test", () => input.onOpenItem(item)),
        "A test sheet is ready with checks only you can do.",
      );
    } else if (chat?.column === "done") {
      add(
        "test",
        label,
        "its chat finished: read the result",
        button("Read result", () => input.onOpenChat(chat)),
        "Its chat finished a turn with a result for you to read.",
      );
    } else if (!chat && isOpenWork(item) && (item.priority === "P0" || item.priority === "P1")) {
      add(
        "todo",
        label,
        `${item.priority} and no chat on it`,
        button("Start a chat", () => input.onStartChat(item), true),
        `It's ${item.priority} in this sprint and no chat is on it yet.`,
      );
    }
  }
  const { answer, tellMore, reply } = useDecisionActions(input.planner, input.app);
  // Notes Rigo took about this app: sort them, or approve where triage says they go.
  for (const note of Object.values(input.notes.inbox)) {
    if (note.state !== "new" && note.state !== "proposed") continue;
    if ((note.proposal?.app ?? note.app) !== input.app) continue;
    const key = `note:${note.id}`;
    const proposal = note.proposal;
    const where = !proposal
      ? "not sorted yet"
      : proposal.action === "new"
        ? `proposed: new ${proposal.type ?? "item"}${proposal.priority ? ` ${proposal.priority}` : ""}${proposal.title ? `, "${proposal.title}"` : ""}`
        : proposal.action === "comment"
          ? "proposed: add to an existing item"
          : proposal.action === "planner"
            ? "proposed: hand to the planner"
            : proposal.action === "chat"
              ? "proposed: send to a chat"
              : "proposed: dismiss";
    rows.push({
      key,
      kind: "triage",
      title: (note.text.split("\n")[0] ?? note.text).slice(0, 160),
      meta: [note.who, note.source, where].filter(Boolean).join(" · "),
      feature: proposal?.feature ?? GENERAL,
      ...(proposal
        ? {
            dialog: {
              title: "Where this note goes",
              open: openDecision === key,
              onOpenChange: (next: boolean) => setOpenDecision(next ? key : null),
            },
            info: (
              <ul className="flex flex-col">
                <InboxCard
                  note={note}
                  items={input.items}
                  apps={input.apps}
                  sprints={input.sprints}
                  chats={input.chats}
                  onOpenChat={(chat) => {
                    setOpenDecision(null);
                    input.onOpenChat(chat);
                  }}
                  onStartChat={(item) => {
                    setOpenDecision(null);
                    input.onStartChat(item);
                  }}
                  currentSprint={input.sprint.title}
                  plannerFor={input.plannerFor}
                />
              </ul>
            ),
          }
        : {}),
      action: proposal
        ? button("Review", () => setOpenDecision(key), true)
        : button("Sort", input.onSortInbox),
    });
  }
  if (input.planner) {
    const planner = input.planner;
    for (const decision of openDecisions(input.notes, input.app)) {
      const open = openDecision === decision.id;
      rows.push({
        key: `decision:${decision.id}`,
        kind: "decide",
        title: decision.question,
        meta: asked.has(decision.id)
          ? "Asked for more: the planner is updating this card"
          : decision.recommended
            ? `rec: ${decision.recommended}`
            : "from the planner",
        feature: featureOfUrls([decision.itemUrl, ...decision.links]),
        action: button("Answer", () => setOpenDecision(decision.id), true),
        dialog: {
          title: "Your call",
          open,
          onOpenChange: (next) => setOpenDecision(next ? decision.id : null),
        },
        info: (
          <DecisionCard
            decision={decision}
            items={input.items}
            sheets={sheets}
            chatsFor={input.relatedChatsFor}
            notes={input.notes}
            nowMs={input.nowMs}
            onOpenChat={(chat) => {
              setOpenDecision(null);
              input.onOpenChat(chat);
            }}
            onAnswer={(asked, choice, note) => {
              answer(asked, choice, note);
              setOpenDecision(null);
            }}
            onTellMore={() => {
              tellMore(decision);
              askedPlanner(decision.id);
            }}
            onReply={(asked, note) => {
              reply(asked, note);
              askedPlanner(decision.id);
            }}
          />
        ),
      });
    }
    for (const line of checklist) {
      if (line.who !== "you" || line.done) continue;
      if (line.itemUrl && shown.has(line.itemUrl)) continue;
      const item = byUrl(line.itemUrl);
      const key = `todo:${line.text}`;
      const done = () => {
        savePlanLineDone(planner.threadId, line.text);
        void sendToChat(planner, `Done: ${line.text}`);
        setOpenDecision(null);
      };
      const question = (text: string) => {
        savePlanLineQuestion(planner.threadId, line.text, text);
        void sendToChat(
          planner,
          `Rigo asks about your line "${line.text}": ${text}\n\nAnswer him on the line, so he reads it in the to-do: node ~/.claude/skills/dev-desk/desk.mjs plan answer "${line.text}" "<your answer>" (add --how "<steps>" if the steps change). Short and concrete, with links.${text.includes("](http") ? " His question has screenshots: download each link (curl -o) and look at it before answering." : ""}`,
        );
        toastManager.add({
          type: "info",
          title: "Asked the planner",
          description: "Its answer shows in this to-do when it's in.",
        });
      };
      const last = line.qa?.at(-1);
      rows.push({
        key,
        kind: "todo",
        title: line.text,
        meta:
          last && !last.a
            ? "Asked: waiting for the planner's answer"
            : last?.a
              ? `Planner answered: ${last.a.replace(/\s+/g, " ").slice(0, 100)}`
              : (line.why ?? "from the planner"),
        feature: featureOfUrls([line.itemUrl]),
        dialog: {
          title: "Your to-do",
          open: openDecision === key,
          onOpenChange: (next) => setOpenDecision(next ? key : null),
        },
        info: (
          <TodoDetails
            line={line}
            context={{
              why: "",
              item,
              pr: input.prs.find((pr) => pr.url === line.itemUrl) ?? prOf(item),
              chat: item ? (input.chatsFor(item)[0] ?? null) : null,
            }}
            items={input.items}
            notes={input.notes}
            sheets={sheets}
            nowMs={input.nowMs}
            relatedChatsFor={input.relatedChatsFor}
            onOpenChat={(chat) => {
              setOpenDecision(null);
              input.onOpenChat(chat);
            }}
            onOpenPr={input.onOpenPr}
            onOpenItem={input.onOpenItem}
            onDone={done}
            onQuestion={question}
            plannerState={chatStatus(planner).label}
            focusQuestion={askFocus === key}
          />
        ),
        action: (
          <span className="flex gap-1">
            {button("Done", done)}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setAskFocus(key);
                setOpenDecision(key);
              }}
            >
              Ask
            </Button>
          </span>
        ),
      });
    }
  }
  return rows;
}

function NeedsList(props: {
  readonly rows: ReadonlyArray<Need>;
  readonly groupBy: "kind" | "feature";
}) {
  const { rows } = props;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing in this sprint waits on you.</p>;
  }
  const features = [...new Set(rows.map((row) => row.feature))].toSorted(
    (a, b) => Number(a === GENERAL) - Number(b === GENERAL) || a.localeCompare(b),
  );
  const sections =
    props.groupBy === "kind"
      ? NEED_KINDS.map((kind) => ({
          key: kind.id,
          title: kind.label,
          hint: kind.hint,
          rows: rows.filter((row) => row.kind === kind.id),
          tag: (row: Need) => row.feature,
        }))
      : features.map((feature) => ({
          key: feature,
          title: feature,
          hint:
            feature === GENERAL
              ? "not tied to a feature"
              : `${rows.filter((row) => row.feature === feature).length} waiting on you`,
          rows: rows.filter((row) => row.feature === feature),
          tag: (row: Need) => NEED_KINDS.find((kind) => kind.id === row.kind)?.label ?? "",
        }));
  return (
    <div className="flex flex-col gap-3">
      {sections
        .filter((section) => section.rows.length > 0)
        .map((section) => (
          <section
            key={section.key}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <header className="flex items-baseline gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
              <span className="text-2xs font-semibold tracking-wide uppercase">
                {section.title}
              </span>
              <span className="text-2xs text-muted-foreground">{section.hint}</span>
            </header>
            <ul className="flex flex-col divide-y divide-border">
              {section.rows.map((row) => (
                <li key={row.key} className="flex flex-col gap-2 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                      {row.dialog ? (
                        <>
                          <button
                            type="button"
                            onClick={() => row.dialog?.onOpenChange(true)}
                            className="cursor-pointer text-start text-sm font-medium hover:underline"
                          >
                            {row.title}
                          </button>
                          <Dialog open={row.dialog.open} onOpenChange={row.dialog.onOpenChange}>
                            <DialogPopup className="sm:max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>{row.dialog.title}</DialogTitle>
                              </DialogHeader>
                              <DialogPanel>{row.info}</DialogPanel>
                            </DialogPopup>
                          </Dialog>
                        </>
                      ) : row.info ? (
                        <Popover>
                          <PopoverTrigger
                            render={
                              <button
                                type="button"
                                className="cursor-pointer text-start text-sm font-medium hover:underline"
                              />
                            }
                          >
                            {row.title}
                          </PopoverTrigger>
                          <PopoverPopup align="start" aria-label={row.title}>
                            {row.info}
                          </PopoverPopup>
                        </Popover>
                      ) : (
                        <span className="text-sm font-medium">{row.title}</span>
                      )}
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 text-2xs font-semibold text-foreground">
                          {section.tag(row)}
                        </span>
                        {row.meta}
                      </span>
                    </div>
                    {row.action}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function ProgressByFeature(props: {
  readonly app: string;
  readonly groups: ReturnType<typeof featureGroups>;
  readonly stepsOf: (item: DeskItem) => ReadonlyArray<StepState>;
  readonly prFor: (item: DeskItem) => DeskPr | null;
  readonly signalsFor: (item: DeskItem) => ItemSignals;
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly planner: CardChatState | null;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onOpenPr: (pr: DeskPr) => void;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly needsByFeature: () => void;
  readonly notes: DeskNotes;
  readonly nowMs: number;
}) {
  const sendToChat = useSendToChat();
  const sheets = useHubSheets();
  const [open, setOpen] = useState<string | null>(null);
  const gaps = props.groups
    .flatMap((group) => [...group.stories])
    .flatMap((item) => {
      const found = setupGaps(item);
      return found.length > 0 ? [{ item, found }] : [];
    });
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap gap-x-2 text-2xs text-muted-foreground">
        Each bar: {STORY_STEPS.join(" › ")}.
        <span className="text-success-foreground">Green done</span>
        <span className="text-info-foreground">blue agent</span>
        <span className="text-warning-foreground">amber you</span>
      </p>
      {props.groups.map((group) => {
        const total = group.stories.length + group.done.length;
        const yours = group.stories.filter(
          (item) => waitingOn(props.stepsOf(item)) === "you",
        ).length;
        return (
          <section
            key={group.name ?? "none"}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
              <span className="text-sm font-semibold">{group.name ?? "Not in a feature"}</span>
              {group.stage ? (
                <span className="rounded-full bg-muted px-2 text-2xs font-semibold">
                  Stage: {group.stage}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {group.done.length} of {total} done
              </span>
              <span
                className="relative h-1.5 w-28 overflow-hidden rounded-sm bg-border"
                aria-hidden
              >
                <span
                  className="absolute inset-y-0 start-0 bg-success"
                  style={{ width: `${total ? (group.done.length / total) * 100 : 0}%` }}
                />
              </span>
              {yours > 0 ? (
                <button
                  type="button"
                  onClick={props.needsByFeature}
                  className="cursor-pointer rounded-full bg-warning/10 px-2 text-2xs font-semibold text-warning-foreground"
                >
                  {yours} waiting on you
                </button>
              ) : null}
            </header>
            <ul className="flex flex-col divide-y divide-border">
              {group.stories.map((item) => {
                const steps = props.stepsOf(item);
                const who = waitingOn(steps);
                const criteria = item.story?.criteria ?? [];
                const pr = props.prFor(item);
                const sheet = props.signalsFor(item).sheet;
                const chat = props.chatsFor(item)[0];
                const expanded = open === item.itemId;
                const itemGaps = setupGaps(item);
                return (
                  <li key={item.itemId}>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setOpen(item.itemId)}
                      className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-start hover:bg-muted/40"
                    >
                      <TypeTag kind={workKind(item)} />
                      <span className="flex min-w-0 flex-[1_1_16rem] flex-col">
                        <span className="text-sm font-medium">
                          {deskRef(item)} {deskTitle(item)}
                        </span>
                        <span className="flex flex-wrap gap-x-2 text-2xs text-muted-foreground">
                          <span>
                            criteria{" "}
                            {criteria.length > 0
                              ? `${criteria.filter((entry) => entry.done).length} of ${criteria.length} proven`
                              : "none yet"}
                          </span>
                          <span>
                            {pr
                              ? `PR #${pr.number} · ${pr.stage}`
                              : item.pullRequests.length
                                ? `PR #${item.pullRequests[0]?.number}`
                                : "no PR"}
                          </span>
                          <span>{sheet ? `sheet ${sheet.unchecked} left` : "no sheet"}</span>
                          {itemGaps.length > 0 ? (
                            <span className="font-semibold text-destructive-foreground">
                              {itemGaps.join(", ")}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span
                        role="img"
                        className="flex w-36 gap-0.5"
                        aria-label={STORY_STEPS.map(
                          (name, index) => `${name}: ${steps[index]}`,
                        ).join(", ")}
                      >
                        {STORY_STEPS.map((name, index) => (
                          <span
                            key={name}
                            className={cn(
                              "h-2 flex-1 rounded-sm",
                              STEP_CLASS[steps[index] ?? "todo"],
                            )}
                          />
                        ))}
                      </span>
                      <span
                        className={cn(
                          "w-28 rounded px-1.5 text-center text-2xs font-medium",
                          WHO_CLASS[who],
                        )}
                      >
                        {WHO_LABEL[who]}
                      </span>
                    </button>
                    <Dialog
                      open={expanded}
                      onOpenChange={(next) => setOpen(next ? item.itemId : null)}
                    >
                      <DialogPopup className="sm:max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>
                            {deskRef(item)} {deskTitle(item)}
                          </DialogTitle>
                        </DialogHeader>
                        <DialogPanel>
                          <div className="flex flex-col gap-3 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <TypeTag kind={workKind(item)} />
                              <span
                                className={cn("rounded px-1.5 text-xs font-medium", WHO_CLASS[who])}
                              >
                                {WHO_LABEL[who]}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {featureName(item) ?? "Not in a feature"}
                                {item.priority ? ` · ${item.priority}` : ""}
                              </span>
                            </div>
                            <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                              {STORY_STEPS.map((name, index) => (
                                <li key={name} className="flex items-center gap-2 text-xs">
                                  <span
                                    className={cn(
                                      "h-2 w-6 shrink-0 rounded-sm",
                                      STEP_CLASS[steps[index] ?? "todo"],
                                    )}
                                  />
                                  <span className="flex flex-col">
                                    <span className="font-medium">{name}</span>
                                    <span className="text-muted-foreground">
                                      {STEP_LABEL[steps[index] ?? "todo"]}
                                    </span>
                                  </span>
                                </li>
                              ))}
                            </ol>
                            {itemGaps.length > 0 ? (
                              <p className="text-xs font-semibold text-destructive-foreground">
                                Needs setting up: {itemGaps.join(", ")}
                              </p>
                            ) : null}
                            {item.story?.text ? (
                              <section className="flex flex-col gap-1">
                                <DeskHeading>User story</DeskHeading>
                                <p>{item.story.text}</p>
                              </section>
                            ) : null}
                            <section className="flex flex-col gap-1">
                              <DeskHeading>Acceptance criteria</DeskHeading>
                              {criteria.length > 0 ? (
                                <ul className="rounded-md border border-border text-xs">
                                  {criteria.map((entry) => (
                                    <li
                                      key={entry.text}
                                      className="flex gap-2 border-t border-border px-2 py-1.5 first:border-t-0"
                                    >
                                      <span aria-hidden className="text-muted-foreground">
                                        {entry.done ? "☑" : "☐"}
                                      </span>
                                      <span className="flex-1">{entry.text}</span>
                                      <span
                                        className={cn(
                                          "rounded px-1.5 text-2xs",
                                          entry.done ? WHO_CLASS.done : WHO_CLASS.todo,
                                        )}
                                      >
                                        {entry.done ? "Proven" : "Not yet"}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  No acceptance criteria yet.
                                </p>
                              )}
                            </section>
                            <NeedInfo
                              inline
                              context={{ why: "", item, pr, chat: chat ?? null }}
                              notes={props.notes}
                              sheets={sheets}
                              nowMs={props.nowMs}
                              onOpenChat={(next) => {
                                setOpen(null);
                                props.onOpenChat(next);
                              }}
                              onOpenPr={(next) => {
                                setOpen(null);
                                props.onOpenPr(next);
                              }}
                              onOpenItem={(next) => {
                                setOpen(null);
                                props.onOpenItem(next);
                              }}
                            />
                          </div>
                        </DialogPanel>
                      </DialogPopup>
                    </Dialog>
                  </li>
                );
              })}
            </ul>
            {group.done.length > 0 ? (
              <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                Done:{" "}
                {group.done
                  .map((item) => `${deskRef(item) ?? ""} ${deskTitle(item)}`.trim())
                  .join(" · ")}
              </p>
            ) : null}
          </section>
        );
      })}
      {gaps.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-3 py-2">
          <span className="min-w-0 flex-[1_1_18rem] text-sm">
            <b className="font-semibold">
              {gaps.length === 1 ? "1 item needs" : `${gaps.length} items need`} setting up:
            </b>{" "}
            {gaps
              .map(({ item, found }) => `${deskRef(item) ?? deskTitle(item)} (${found.join(", ")})`)
              .join(" · ")}
          </span>
          {props.planner ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                void sendToChat(
                  props.planner as CardChatState,
                  `Align these items with the flow (App → Feature → Story with acceptance criteria → PR → test sheet): ${gaps
                    .map(
                      ({ item, found }) =>
                        `${deskRef(item) ?? deskTitle(item)}: ${found.join(", ")}`,
                    )
                    .join(
                      "; ",
                    )}. Propose a feature for each item without one, and write acceptance criteria a test sheet can check for each story without them. Ask me with decide before changing a feature's Stage.`,
                )
              }
            >
              Ask the planner to align them
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PlannerPane(props: {
  readonly app: string;
  readonly sprint: DeskSprint;
  readonly nowMs: number;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly planner: CardChatState | null;
  readonly onStartPlanner: () => void;
}) {
  const sendToChat = useSendToChat();
  const planner = props.planner;
  const work = planner ? props.notes.work[planner.threadId] : undefined;
  const updates = planner
    ? (waitingReports(
        props.notes,
        (url) => props.items.find((item) => item.url === url)?.app ?? null,
      ).get(planner.threadId)?.length ?? 0)
    : 0;
  const age = formatFleetBoardAge(work?.planAt ?? work?.updatedAt ?? null, props.nowMs);
  return (
    <section
      aria-label="Planner chat"
      className="flex min-h-[36rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:min-h-0 lg:w-[30rem] lg:shrink-0"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{props.app} planner</span>
          <span className="text-2xs text-muted-foreground">
            {planner
              ? `${props.sprint.title}${age ? ` · plan updated ${age} ago` : ""}${updates > 0 ? ` · ${updates} chat ${updates === 1 ? "update" : "updates"} on the way` : ""}`
              : "No planner for this sprint yet"}
          </span>
        </div>
        {planner ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void sendToChat(
                planner,
                "Catch up: check the chats you run (desk.mjs agents, and t3_thread_read on any that moved since your last checklist), rewrite your checklist with plan set, and tell me in three lines what moved.",
              )
            }
          >
            Catch up
          </Button>
        ) : null}
      </header>
      {planner ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ChatEmbedContext value>
            <ChatView
              key={`${planner.environmentId}:${planner.threadId}`}
              environmentId={planner.environmentId as EnvironmentId}
              threadId={planner.threadId as ThreadId}
              routeKind="server"
              reserveTitleBarControlInset={false}
            />
          </ChatEmbedContext>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-start gap-2 p-4 text-sm">
          <p>
            Each sprint gets its own planner chat. It plans the work, asks you decisions and tells
            you what's waiting on you.
          </p>
          <BigPicture
            app={props.app}
            sprint={props.sprint.title}
            note={noteAt(props.notes, {
              kind: "framing",
              sprint: props.sprint.title,
              app: props.app,
            })}
            onSaved={() => undefined}
          />
          <Button size="sm" onClick={props.onStartPlanner}>
            Start {props.sprint.title}'s planner
          </Button>
        </div>
      )}
    </section>
  );
}
