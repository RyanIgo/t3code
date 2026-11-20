/**
 * Fleet fork: the Sprint page for one app, its home. The planner chat beside what needs Rigo and
 * the work's progress by feature, under the goal and a schedule that folds to one line.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { type ReactNode, useState } from "react";

import ChatView from "../ChatView";
import { ChatEmbedContext } from "../chat/ChatEmbedContext";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import type { CardChatState } from "./boardCards.logic";
import {
  type DeskItem,
  type DeskSprint,
  deskRef,
  deskTitle,
  type ItemSignals,
  needsWrapUp,
  workKind,
} from "./desk.logic";
import { BigPicture, DecisionCard, useDecisionActions } from "./DeskAgents";
import { noteAt, openDecisions, type DeskNotes, waitingReports } from "./deskNotes.logic";
import { savePlanLineDone } from "./deskNotesStore";
import { DeskHeading, TypeTag } from "./DeskParts";
import { type DeskPr, isDependencyUpdate } from "./deskPrs.logic";
import { useSendToChat } from "./deskSend";
import { useHubSheets } from "./deskSheets";
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

type NeedKind = "test" | "decide" | "todo" | "wrap";
const NEED_KINDS: ReadonlyArray<{
  readonly id: NeedKind;
  readonly label: string;
  readonly hint: string;
}> = [
  { id: "test", label: "Test & merge", hint: "a chat finished and waits on you" },
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
  /** Opens under the row (a decision's card). */
  readonly detail?: ReactNode;
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
  return steps.find((step) => step !== "done" && step !== "skip") ?? "done";
}

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
}) {
  const [view, setView] = useState<"needs" | "progress">("needs");
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
  const working = moving.filter((item) =>
    props.signalsFor(item).chats.some((chat) => chat.working),
  ).length;
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
        <div role="group" aria-label="Sprint at a glance" className="flex flex-wrap gap-1.5">
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
    </div>
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
}

/** Everything that waits on Rigo in this app's sprint, each once, with its one action. */
function useNeedRows(input: NeedInput): Need[] {
  const sendToChat = useSendToChat();
  const [openDecision, setOpenDecision] = useState<string | null>(null);
  const sheets = useHubSheets();
  const featureOf = (item: DeskItem | null | undefined) =>
    (item ? featureName(item) : null) ?? GENERAL;
  const byUrl = (url: string | null) => input.items.find((item) => item.url === url) ?? null;
  const checklist = input.planner ? (input.notes.work[input.planner.threadId]?.plan ?? []) : [];
  const agentsOn = new Set(
    checklist.flatMap((line) =>
      line.who !== "you" && !line.done && line.itemUrl ? [line.itemUrl] : [],
    ),
  );
  const rows: Need[] = [];
  const shown = new Set<string>();
  const button = (label: string, onClick: () => void, primary = false) => (
    <Button size="xs" variant={primary ? "default" : "outline"} onClick={onClick}>
      {label}
    </Button>
  );

  for (const pr of input.prs) {
    if (pr.app !== input.app || isDependencyUpdate(pr)) continue;
    if (!(pr.stage === "ready" || (pr.stage === "fix" && !agentsOn.has(pr.url)))) continue;
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
      feature: featureOf(pr.item),
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
    const add = (kind: NeedKind, title: string, meta: string, action: ReactNode) => {
      if (item.url) shown.add(item.url);
      rows.push({
        key: `item:${item.itemId}`,
        kind,
        title,
        meta,
        feature: featureOf(item),
        action,
      });
    };
    if (needsWrapUp(item, signals)) {
      add(
        "wrap",
        label,
        "closed; something's still open",
        button("Wrap up", () => input.onOpenItem(item)),
      );
    } else if (chat?.needsYou) {
      add(
        "decide",
        label,
        "its chat is asking you",
        button("Answer", () => input.onOpenChat(chat), true),
      );
    } else if (signals.sheet && signals.sheet.unchecked > 0) {
      add(
        "test",
        `${label}: run the test sheet`,
        `${signals.sheet.unchecked} checks left`,
        button("Test", () => input.onOpenItem(item)),
      );
    } else if (chat?.column === "done") {
      add(
        "test",
        label,
        "its chat finished: read the result",
        button("Read result", () => input.onOpenChat(chat)),
      );
    } else if (!chat && isOpenWork(item) && (item.priority === "P0" || item.priority === "P1")) {
      add(
        "todo",
        label,
        `${item.priority} and no chat on it`,
        button("Start a chat", () => input.onStartChat(item), true),
      );
    }
  }
  const { answer, tellMore } = useDecisionActions(input.planner, input.app);
  if (input.planner) {
    const planner = input.planner;
    for (const decision of openDecisions(input.notes, input.app)) {
      const item = byUrl(decision.itemUrl ?? decision.links[0] ?? null);
      const open = openDecision === decision.id;
      rows.push({
        key: `decision:${decision.id}`,
        kind: "decide",
        title: decision.question,
        meta: decision.recommended ? `rec: ${decision.recommended}` : "from the planner",
        feature: featureOf(item),
        action: button(
          open ? "Close" : "Answer",
          () => setOpenDecision(open ? null : decision.id),
          !open,
        ),
        detail: open ? (
          <DecisionCard
            decision={decision}
            items={input.items}
            sheets={sheets}
            chatsFor={input.relatedChatsFor}
            notes={input.notes}
            nowMs={input.nowMs}
            onOpenChat={input.onOpenChat}
            onAnswer={(asked, choice, note) => {
              answer(asked, choice, note);
              setOpenDecision(null);
            }}
            onTellMore={() => tellMore(decision)}
          />
        ) : undefined,
      });
    }
    for (const line of checklist) {
      if (line.who !== "you" || line.done) continue;
      if (line.itemUrl && shown.has(line.itemUrl)) continue;
      rows.push({
        key: `todo:${line.text}`,
        kind: "todo",
        title: line.text,
        meta: "from the planner",
        feature: featureOf(byUrl(line.itemUrl)),
        action: (
          <span className="flex gap-1">
            {button("Done", () => {
              savePlanLineDone(planner.threadId, line.text);
              void sendToChat(planner, `Done: ${line.text}`);
            })}
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void sendToChat(
                  planner,
                  `About "${line.text}": what exactly do you need from me, and where do I do it? Answer in a line or two, with the link.`,
                )
              }
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
                      <span className="text-sm font-medium">{row.title}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 text-2xs font-semibold text-foreground">
                          {section.tag(row)}
                        </span>
                        {row.meta}
                      </span>
                    </div>
                    {row.action}
                  </div>
                  {row.detail}
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
}) {
  const sendToChat = useSendToChat();
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
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : item.itemId)}
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
                    {expanded ? (
                      <div className="flex flex-col gap-2 px-3 pb-3">
                        {item.story?.text ? <p className="text-xs">{item.story.text}</p> : null}
                        {criteria.length > 0 ? (
                          <ul className="rounded-md border border-border text-xs">
                            {criteria.map((entry) => (
                              <li
                                key={entry.text}
                                className="flex gap-2 border-t border-border px-2 py-1 first:border-t-0"
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
                        <span className="flex flex-wrap gap-1.5">
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => props.onOpenItem(item)}
                          >
                            Open item
                          </Button>
                          {pr ? (
                            <Button size="xs" variant="outline" onClick={() => props.onOpenPr(pr)}>
                              PR #{pr.number}
                            </Button>
                          ) : null}
                          {chat ? (
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => props.onOpenChat(chat)}
                            >
                              Open its chat
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    ) : null}
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
            <b className="font-semibold">{gaps.length} items need setting up:</b>{" "}
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
