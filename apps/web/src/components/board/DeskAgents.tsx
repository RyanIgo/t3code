import { ArrowRightLeftIcon, PlusIcon, StarIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import type { CardChatState } from "./boardCards.logic";
import {
  chatStatus,
  chatTitle,
  type DeskItem,
  deskRef,
  type DeskSprint,
  deskTitle,
  type ItemSignals,
  needsWrapUp,
  sprintStatus,
  workKind,
} from "./desk.logic";
import {
  CHAT_ROLE_LABEL,
  CHAT_ROLES,
  type DeskNote,
  type DeskNotes,
  noteAt,
  goalOf,
  openDecisions,
  waitingReports,
  type PlannerDecision,
} from "./deskNotes.logic";
import { saveChatRole, saveDecisionAnswer, saveDeskNote, savePlanLineDone } from "./deskNotesStore";
import { useSendToChat } from "./deskSend";
import { type SheetSummary, useHubSheets } from "./deskSheets";
import { uploadPicture } from "./deskStore";
import ChatMarkdown from "../ChatMarkdown";
import { Sheet, SheetPopup } from "../ui/sheet";
import { Textarea } from "../ui/textarea";
import { commentsText, contextSections } from "./decisionFeedback.logic";
import { DeskNoteField } from "./DeskNoteField";
import { toastManager } from "../ui/toast";
import { cn } from "../../lib/utils";
import { useState } from "react";
import { DeskHeading, TypeTag } from "./DeskParts";
import { VerbChip } from "./deskLevels";
import { moveFocus } from "./DeskWork";
import { type DeskPr, isDependencyUpdate } from "./deskPrs.logic";
import { formatFleetBoardAge, minuteTickToMs } from "./fleetBoard.logic";
import { buildWorkSidebar, type WorkRow } from "./sidebarWork.logic";

const isOpenWork = (item: DeskItem) =>
  (item.state === "open" || item.state === "draft") &&
  item.status !== "Done" &&
  item.kind !== "pr" &&
  item.workType !== "Tracking";

/** The open items a chat can be put on: the app's sprint work first, then its other open work. */
function choicesFor(items: ReadonlyArray<DeskItem>, app: string, sprint: DeskSprint | null) {
  const open = items.filter((item) => item.app === app && isOpenWork(item));
  const inSprint = open.filter((item) => sprint && item.sprint?.title === sprint.title);
  return inSprint.length > 0 ? inSprint : open.slice(0, 20);
}

function ChatBadge(props: { readonly chat: CardChatState; readonly nowMs: number }) {
  const status = chatStatus(props.chat);
  const age = formatFleetBoardAge(props.chat.since, props.nowMs);
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Badge variant={status.tone} size="sm">
        {status.label}
      </Badge>
      {age ? <span className="text-2xs text-muted-foreground">{age}</span> : null}
    </span>
  );
}

/** Puts a chat on one of the app's open items (it gets a message saying so). */
function MoveMenu(props: {
  readonly chat: CardChatState;
  readonly choices: ReadonlyArray<DeskItem>;
  readonly label: string;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" />}>
        <ArrowRightLeftIcon />
        {props.label}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Put {chatTitle(props.chat.title)} on</MenuGroupLabel>
          {props.choices.map((item) => (
            <MenuItem key={item.itemId} onClick={() => moveFocus(item, props.chat)}>
              {deskRef(item)} {deskTitle(item)}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/** Sets a chat's level (or clears it back to what the Desk infers). */
function RoleMenu(props: { readonly row: WorkRow }) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" />}>
        {props.row.role ? CHAT_ROLE_LABEL[props.row.role] : "No role"}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>{chatTitle(props.row.chat.title)} is</MenuGroupLabel>
          {CHAT_ROLES.map((role) => (
            <MenuItem
              key={role}
              onClick={() =>
                saveChatRole(
                  props.row.chat.threadId,
                  role,
                  role === "planner" ? { app: props.row.app } : {},
                )
              }
            >
              {CHAT_ROLE_LABEL[role]}
              {role === props.row.role ? " ✓" : ""}
            </MenuItem>
          ))}
          <MenuItem onClick={() => saveChatRole(props.row.chat.threadId, null)}>
            Let the Desk decide
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/** Work rows with each helper right under the chat it helps. */
function withHelpersUnderParents(rows: ReadonlyArray<WorkRow>, notes: DeskNotes): WorkRow[] {
  const parentOf = (row: WorkRow) =>
    row.role === "helper" ? (notes.work[row.chat.threadId]?.parent ?? null) : null;
  const present = new Set(rows.map((row) => row.chat.threadId));
  const top = rows.filter((row) => {
    const parent = parentOf(row);
    return !parent || !present.has(parent);
  });
  return top.flatMap((row) => [
    row,
    ...rows.filter((other) => parentOf(other) === row.chat.threadId),
  ]);
}

/**
 * Fleet fork: the Agents tab, orchestration at a glance. The day's chat, then one band per app:
 * its planners on the left, and on the right each work chat with the item it's on, the sprint's
 * items no chat is on yet, and chats on no item. Now says what needs Rigo; this says who's doing what.
 */
export function AgentsView(props: {
  readonly chats: ReadonlyArray<CardChatState>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly notes: DeskNotes;
  readonly apps: ReadonlyArray<string>;
  /** The app the Board is filtered to, or null for all. */
  readonly app: string | null;
  readonly sprint: DeskSprint | null;
  readonly appOfRepo: (chat: CardChatState) => string | null;
  readonly repoOf: (chat: CardChatState) => string | null;
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onStartChat: (item: DeskItem) => void;
  readonly onStartPlanner: (app: string) => void;
}) {
  const nowMs = minuteTickToMs(useNowMinute());
  const view = buildWorkSidebar({
    chats: props.chats,
    items: props.items,
    notes: props.notes,
    apps: props.apps,
    appOfRepo: props.appOfRepo,
    repoOf: props.repoOf,
    nowMs,
  });
  const apps = (props.app ? [props.app] : props.apps).flatMap((app) => {
    const group = view.apps.find((entry) => entry.app === app);
    const waiting = view.needsYou.filter((row) => row.app === app);
    const planners = [
      ...(group?.planners ?? []),
      ...waiting.filter((row) => !row.item && !(group?.loose ?? []).includes(row)),
    ].filter((row, index, all) => all.findIndex((other) => other.chat === row.chat) === index);
    const plannerChats = new Set(planners.map((row) => row.chat));
    const work = [...waiting.filter((row) => row.item), ...(group?.work ?? [])].filter(
      (row) => !plannerChats.has(row.chat),
    );
    const unstaffed = props.items.filter(
      (item) =>
        item.app === app &&
        isOpenWork(item) &&
        props.sprint !== null &&
        item.sprint?.title === props.sprint.title &&
        props.chatsFor(item).length === 0,
    );
    const loose = group?.loose ?? [];
    if (planners.length + work.length + unstaffed.length + loose.length === 0) return [];
    return [{ app, planners, work, unstaffed, loose }];
  });
  const itemLabel = (item: DeskItem) => (
    <button
      type="button"
      onClick={() => props.onOpenItem(item)}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-sm hover:underline"
    >
      <TypeTag kind={workKind(item)} />
      <span className="shrink-0 text-xs text-muted-foreground">{deskRef(item)}</span>
      <span className="truncate">{deskTitle(item)}</span>
    </button>
  );
  const chatLabel = (row: WorkRow, planner = false) => (
    <button
      type="button"
      onClick={() => props.onOpenChat(row.chat)}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-sm font-medium hover:underline"
    >
      {planner ? (
        <StarIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      <span className="truncate">{chatTitle(row.chat.title)}</span>
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Who's doing what</h2>
        <span className="text-xs text-muted-foreground">
          Each app's planners, the chats on its items, and the sprint work no chat is on yet.
          {view.wrapUp.length > 0
            ? ` ${view.wrapUp.length} finished chats wait in the side panel's Wrap up.`
            : ""}
        </span>
      </header>
      {apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open chats or sprint work here.</p>
      ) : null}
      {apps.map((band) => {
        const choices = choicesFor(props.items, band.app, props.sprint);
        return (
          <section
            key={band.app}
            aria-label={band.app}
            className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-3 lg:grid-cols-[16rem_minmax(0,1fr)]"
          >
            <div className="flex min-w-0 flex-col gap-1.5 lg:border-e lg:border-border lg:pe-3">
              <DeskHeading>{band.app}</DeskHeading>
              {band.planners.length > 1 ? (
                <span className="text-xs text-warning-foreground">
                  {band.planners.length} planners: keep one, make the others helpers or settle them.
                </span>
              ) : null}
              {band.planners.length > 0 ? (
                band.planners.map((row) => (
                  <div key={row.chat.threadId} className="flex min-w-0 flex-col gap-0.5">
                    {chatLabel(row, true)}
                    <span className="flex items-center gap-1">
                      <ChatBadge chat={row.chat} nowMs={nowMs} />
                      <RoleMenu row={row} />
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-start gap-1.5">
                  <span className="text-xs text-muted-foreground">No planner yet</span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => props.onStartPlanner(band.app)}
                  >
                    <PlusIcon />
                    Start the planner
                  </Button>
                </div>
              )}
            </div>
            <ul className="flex min-w-0 flex-col divide-y divide-border">
              {withHelpersUnderParents(band.work, props.notes).map((row) => (
                <li
                  key={row.chat.threadId}
                  className="grid grid-cols-1 items-center gap-1.5 py-1.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {row.role === "helper" ? (
                      <span aria-hidden className="text-muted-foreground">
                        ↳
                      </span>
                    ) : null}
                    {chatLabel(row)}
                    <ChatBadge chat={row.chat} nowMs={nowMs} />
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className="text-muted-foreground max-md:hidden">
                      →
                    </span>
                    {row.item ? itemLabel(row.item) : null}
                  </span>
                  <span className="flex items-center gap-1">
                    <RoleMenu row={row} />
                    <MoveMenu chat={row.chat} choices={choices} label="Move" />
                  </span>
                </li>
              ))}
              {band.unstaffed.map((item) => (
                <li
                  key={item.itemId}
                  className="grid grid-cols-1 items-center gap-1.5 py-1.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]"
                >
                  <span className="text-sm text-muted-foreground">No chat</span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className="text-muted-foreground max-md:hidden">
                      →
                    </span>
                    {itemLabel(item)}
                    {item.priority ? (
                      <Badge variant="outline" size="sm">
                        {item.priority}
                      </Badge>
                    ) : null}
                  </span>
                  <Button size="xs" onClick={() => props.onStartChat(item)}>
                    Start a chat
                  </Button>
                </li>
              ))}
              {band.loose.length > 0 ? (
                <li className="py-1.5">
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Not on an item · {band.loose.length}
                    </summary>
                    <ul className="flex flex-col">
                      {band.loose.map((row) => (
                        <li
                          key={row.chat.threadId}
                          className="flex min-w-0 items-center gap-2 py-1"
                        >
                          {chatLabel(row)}
                          <ChatBadge chat={row.chat} nowMs={nowMs} />
                          <span className="ms-auto flex items-center gap-1">
                            <RoleMenu row={row} />
                            <MoveMenu chat={row.chat} choices={choices} label="Put on an item" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ) : null}
              {band.work.length + band.unstaffed.length + band.loose.length === 0 ? (
                <li className="py-1.5 text-sm text-muted-foreground">No work chats right now.</li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Answering a planner's question, or asking it for more, from anywhere on the Board. */
export function useDecisionActions(planner: CardChatState | null, app: string) {
  const sendToChat = useSendToChat();
  const send = (text: string): Promise<boolean> =>
    planner ? sendToChat(planner, text) : Promise.resolve(false);
  return {
    answer: (decision: PlannerDecision, choice: string, note: string | null) => {
      saveDecisionAnswer(decision.id, choice, note);
      // A proposed sprint goal: the first option takes it as written; a note is Rigo's own wording.
      const goal =
        note?.trim() || (choice === decision.options[0] ? goalOf(decision.question) : null);
      if (decision.goalFor && goal) {
        saveDeskNote({ kind: "sprintGoal", sprint: decision.goalFor, app }, goal);
      }
      void send(
        `Decision: ${decision.question} → ${choice}${note?.trim() ? `\n\n${note.trim()}` : ""}`,
      );
    },
    reply: (decision: PlannerDecision, note: string) =>
      send(
        `About "${decision.question}" (not answering yet). My comments:\n\n${note}\n\nRevise the proposal with these: update that decision (desk.mjs decide --id ${decision.id}) so its background, options and recommendation reflect them. Reply here in one line saying what changed.`,
      ),
    tellMore: (decision: PlannerDecision) =>
      void send(
        `Before I answer "${decision.question}": I need the full picture, not just the issues. Read the chats and threads involved (t3_thread_read on every chat that worked on the linked items, and their delegated tasks), the issues' comments and the PRs' descriptions. Then update that decision (desk.mjs decide --id ${decision.id}) with --context in plain words: what this is and why it's coming up now; what each chat found, did and decided, and what it left open; what the items and PRs change for the people who use the app; and what I'm agreeing to. Also --link everything it touches, an --effect for every option, and --final on any that can't be undone. Keep it on the card; reply here in one line when it's updated.`,
      ),
  };
}

/**
 * A decision opened from Now or Start review: its card in a side panel, never the chat that
 * asked it (Rigo, 2026-11-25: "I really don't want the Start Review to then open a New Chat").
 */
export function DecisionPanel(props: {
  readonly decision: PlannerDecision | null;
  /** The chat that asked it; answers and comments go there. */
  readonly asker: CardChatState | null;
  readonly items: ReadonlyArray<DeskItem>;
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly notes: DeskNotes;
  readonly nowMs: number;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onClose: () => void;
}) {
  const sheets = useHubSheets();
  const actions = useDecisionActions(props.asker, props.decision?.app ?? "");
  const { decision } = props;
  return (
    <Sheet open={decision !== null} onOpenChange={(open) => !open && props.onClose()}>
      <SheetPopup side="right" className="w-[min(94vw,40rem)] max-w-[40rem]">
        {decision ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
            <DeskHeading>Decide{decision.app ? ` · ${decision.app}` : ""}</DeskHeading>
            <DecisionCard
              key={decision.id}
              decision={decision}
              items={props.items}
              sheets={sheets}
              chatsFor={props.chatsFor}
              notes={props.notes}
              nowMs={props.nowMs}
              onOpenChat={props.onOpenChat}
              onAnswer={(entry, choice, note) => {
                actions.answer(entry, choice, note);
                props.onClose();
              }}
              onTellMore={() => actions.tellMore(decision)}
              onReply={actions.reply}
              voiceEnvironmentId={props.asker?.environmentId ?? null}
            />
            {props.asker ? (
              <Button
                size="xs"
                variant="ghost"
                className="self-start"
                onClick={() => props.asker && props.onOpenChat(props.asker)}
              >
                Open the chat that asked
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}

/** The time now, as "10:52 AM", for a sent message's confirmation. */
const clockNow = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * Fleet fork: the plan side of a planning session (a planner or sprint chat opened on its own).
 * What's waiting on Rigo first, then what's next in the sprint with the chat on each, then Done
 * folded. The conversation sits beside it; nothing here repeats in the chat.
 */
export function PlanPane(props: {
  readonly app: string;
  readonly sprint: DeskSprint;
  readonly goal: string | null;
  readonly nowMs: number;
  readonly items: ReadonlyArray<DeskItem>;
  /** The item's own chats (recorded on it, started from it, named after it). */
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly signalsFor: (item: DeskItem) => ItemSignals;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly onStartChat: (item: DeskItem) => void;
  /** The app's pull requests, for the ones waiting to be merged or sent back. */
  readonly prs: ReadonlyArray<DeskPr>;
  readonly onOpenPr: (pr: DeskPr) => void;
  /** The planner chat this session is with: its decisions, checklist and Rigo's answers. */
  readonly planner: CardChatState;
  /** Opens another chat (one that worked on an item a decision is about). */
  readonly onOpenChat: (chat: CardChatState) => void;
  /** Every chat that touched an item (its own, and those that only touched its PR or card). */
  readonly relatedChatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly notes: DeskNotes;
}) {
  const sendToChat = useSendToChat();
  const hubSheets = useHubSheets();
  const decisions = openDecisions(props.notes, props.app);
  const decided = Object.values(props.notes.decisions)
    .filter((entry) => entry.app === props.app && entry.answer !== null)
    .toSorted((a, b) => (b.answer?.at ?? "").localeCompare(a.answer?.at ?? ""))
    .slice(0, 5);
  const plannerWork = props.notes.work[props.planner.threadId];
  const checklist = plannerWork?.plan ?? [];
  const waitingUpdates =
    waitingReports(
      props.notes,
      (url) => props.items.find((item) => item.url === url)?.app ?? null,
    ).get(props.planner.threadId)?.length ?? 0;
  const { answer, tellMore, reply } = useDecisionActions(props.planner, props.app);
  const day = 86_400_000;
  const daysLeft = Math.max(
    0,
    Math.ceil(
      (Date.parse(props.sprint.startDate) + props.sprint.duration * day - props.nowMs) / day,
    ),
  );
  const inSprint = props.items.filter(
    (item) =>
      item.app === props.app &&
      item.sprint?.title === props.sprint.title &&
      item.kind !== "pr" &&
      item.workType !== "Tracking",
  );
  const status = (item: DeskItem) => sprintStatus(item, props.signalsFor(item));
  // What only Rigo can move: a question or result from the item's chat, a sheet to test, or urgent
  // work nobody has started. Wrapping up a finished story is its lead's job, not his.
  const ask = (item: DeskItem): { label: string; action: "open" | "start" } | null => {
    const chat = props.chatsFor(item)[0];
    const signals = props.signalsFor(item);
    if ((signals.sheet?.unchecked ?? 0) > 0 && isOpenWork(item))
      return { label: "Test", action: "open" };
    // Its sheet passed and a PR is still open: merging is the move (on the window's Merge tab).
    if (
      signals.sheet &&
      signals.sheet.unchecked === 0 &&
      signals.sheet.failed === 0 &&
      isOpenWork(item) &&
      item.pullRequests.some((pr) => pr.state === "open" || pr.state === "draft")
    )
      return { label: "Merge", action: "open" };
    if (needsWrapUp(item, signals)) return null;
    if (chat?.needsYou) return { label: "Answer", action: "open" };
    if (chat?.column === "done") return { label: "Review", action: "open" };
    if (!chat && isOpenWork(item) && (item.priority === "P0" || item.priority === "P1")) {
      return { label: "Start a chat", action: "start" };
    }
    return null;
  };
  const waiting = inSprint.filter((item) => ask(item) !== null);
  const wrappingUp = inSprint.filter((item) => needsWrapUp(item, props.signalsFor(item)));
  // A PR to send back that the plan already has an agent on isn't Rigo's: it shows in the plan.
  const agentsOn = new Set(
    checklist.flatMap((line) =>
      line.who !== "you" && !line.done && line.itemUrl ? [line.itemUrl] : [],
    ),
  );
  const prsWaiting = props.prs.filter(
    (pr) =>
      pr.app === props.app &&
      (pr.stage === "ready" || (pr.stage === "fix" && !agentsOn.has(pr.url))) &&
      !isDependencyUpdate(pr),
  );
  // The planner's checklist, split: Rigo's open lines join Waiting on you (folded into the row they
  // repeat when they name its item or PR), the rest show as the plan, done lines folded away.
  const shownUrls = new Set(
    [
      ...prsWaiting.flatMap((pr) => [pr.url, pr.item?.url]),
      ...waiting.flatMap((item) => [item.url, ...item.pullRequests.map((pr) => pr.url)]),
    ].filter(Boolean),
  );
  const youLines = checklist.filter((line) => line.who === "you" && !line.done);
  const ownTodos = youLines.filter((line) => !line.itemUrl || !shownUrls.has(line.itemUrl));
  const agentLines = checklist.filter((line) => line.who !== "you" && !line.done);
  const doneLines = checklist.filter((line) => line.done);
  const plannerSays = (urls: ReadonlyArray<string | null | undefined>) =>
    youLines
      .filter((line) => line.itemUrl && urls.includes(line.itemUrl))
      .map((line) => (
        <p key={line.text} className="pt-0.5 pl-1 text-xs text-muted-foreground">
          Planner: {line.text}
        </p>
      ));
  const todoDone = (text: string) => {
    savePlanLineDone(props.planner.threadId, text);
    void sendToChat(props.planner, `Done: ${text}`);
  };
  const todoAnswer = (text: string, choice: "yes" | "no") => {
    savePlanLineDone(props.planner.threadId, text);
    void sendToChat(
      props.planner,
      `Decision on "${text}": ${choice === "yes" ? "yes, go ahead" : "no"}. Update the checklist; tell me only if it changes what I do.`,
    );
  };
  const todoNotMine = (text: string) =>
    void sendToChat(
      props.planner,
      `Not mine: "${text}". Have an agent do it, or wait until it's ready for me (then put it back with what I do and where). If only I can do it, tell me why in one line. Update the checklist either way.`,
    );
  const todoAsk = (text: string) =>
    void sendToChat(
      props.planner,
      `About "${text}": what exactly do you need from me, and where do I do it? Answer in a line or two, with the link.`,
    );
  const order: Record<string, number> = { "In Review": 0, "In Progress": 1, Todo: 2 };
  const next = inSprint
    .filter((item) => isOpenWork(item) && ask(item) === null)
    .toSorted((a, b) => (order[status(a)] ?? 9) - (order[status(b)] ?? 9));
  const done = inSprint.filter((item) => !isOpenWork(item) && ask(item) === null);
  const row = (item: DeskItem, right: ReactNode) => (
    <li key={item.itemId} className="flex min-w-0 items-center gap-2 py-1.5">
      <button
        type="button"
        onClick={() => props.onOpenItem(item)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-sm hover:underline"
      >
        <TypeTag kind={workKind(item)} />
        <span className="truncate">{deskTitle(item)}</span>
      </button>
      {right}
    </li>
  );
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <header className="flex flex-col gap-1">
        <span className="text-sm font-semibold">
          {props.app} · {props.sprint.title} · {daysLeft} days left
        </span>
        {props.goal ? (
          <span className="text-xs text-muted-foreground">Goal: {props.goal}</span>
        ) : (
          <span className="text-xs text-muted-foreground">No sprint goal yet.</span>
        )}
      </header>
      {decisions.length > 0 || decided.length > 0 ? (
        <section className="flex flex-col gap-2">
          <DeskHeading>Decisions · {decisions.length}</DeskHeading>
          {decisions.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              items={props.items}
              sheets={hubSheets}
              chatsFor={props.relatedChatsFor}
              notes={props.notes}
              nowMs={props.nowMs}
              onOpenChat={props.onOpenChat}
              onAnswer={answer}
              onTellMore={() => tellMore(decision)}
              onReply={reply}
              voiceEnvironmentId={props.planner.environmentId}
            />
          ))}
          {decided.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Decided recently · {decided.length}
              </summary>
              <ul className="flex flex-col gap-1 pt-1 text-xs">
                {decided.map((entry) => (
                  <li key={entry.id}>
                    {entry.question} → <b>{entry.answer?.choice}</b>
                    {entry.answer?.note ? ` (${entry.answer.note})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
      <BigPicture
        app={props.app}
        sprint={props.sprint.title}
        note={noteAt(props.notes, { kind: "framing", sprint: props.sprint.title, app: props.app })}
        onSaved={(text) =>
          void sendToChat(
            props.planner,
            `I updated the big picture for ${props.app}, ${props.sprint.title}:\n\n${text}\n\nAdjust the plan and your open decisions to it, and tell me in a line what changes.`,
          )
        }
      />
      <section className="flex flex-col">
        <DeskHeading>
          Your moves in {props.app} · {waiting.length + prsWaiting.length + ownTodos.length}
        </DeskHeading>
        <p className="pb-1 text-2xs text-muted-foreground">
          The same moves are on Now. Each opens beside this window; nothing here is answered in the
          chat.
        </p>
        {waiting.length === 0 && prsWaiting.length === 0 && ownTodos.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">Nothing in this sprint waits on you.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {prsWaiting.map((pr) => (
              <li key={pr.url} className="flex flex-col py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => props.onOpenPr(pr)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-sm hover:underline"
                  >
                    <VerbChip verb={pr.stage === "ready" ? "Merge" : "Send back"} />
                    <span className="shrink-0 text-xs text-muted-foreground">PR #{pr.number}</span>
                    <span className="truncate">{pr.title}</span>
                  </button>
                  <Button size="xs" variant="outline" onClick={() => props.onOpenPr(pr)}>
                    {pr.stage === "ready" ? "Merge" : "Send back"}
                  </Button>
                </div>
                {plannerSays([pr.url, pr.item?.url])}
              </li>
            ))}
            {waiting.map((item) => {
              const needed = ask(item);
              return (
                <li key={item.itemId} className="flex flex-col py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => props.onOpenItem(item)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-sm hover:underline"
                    >
                      <VerbChip
                        verb={needed?.action === "start" ? "Do" : (needed?.label ?? "Do")}
                      />
                      <TypeTag kind={workKind(item)} />
                      <span className="truncate">{deskTitle(item)}</span>
                    </button>
                    <Button
                      size="xs"
                      variant={needed?.action === "start" ? "default" : "outline"}
                      onClick={() =>
                        needed?.action === "start"
                          ? props.onStartChat(item)
                          : props.onOpenItem(item)
                      }
                    >
                      {needed?.label}
                    </Button>
                  </div>
                  {plannerSays([item.url, ...item.pullRequests.map((pr) => pr.url)])}
                </li>
              );
            })}
            {ownTodos.map((line) => (
              <li key={line.text} className="flex min-w-0 items-start gap-2 py-1.5">
                <VerbChip
                  verb={/^decide\b/i.test(line.text) ? "Decide" : "Do"}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1 text-sm">
                  {line.text}
                  <span className="block text-2xs text-muted-foreground">
                    The planner can&apos;t do this one. Done when you have; Not mine sends it back.
                  </span>
                </span>
                {/^decide\b/i.test(line.text) ? (
                  <>
                    <Button size="xs" onClick={() => todoAnswer(line.text, "yes")}>
                      Yes
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => todoAnswer(line.text, "no")}>
                      No
                    </Button>
                  </>
                ) : (
                  <Button size="xs" variant="outline" onClick={() => todoDone(line.text)}>
                    Done
                  </Button>
                )}
                <Button size="xs" variant="ghost" onClick={() => todoNotMine(line.text)}>
                  Not mine
                </Button>
                <Button size="xs" variant="ghost" onClick={() => todoAsk(line.text)}>
                  Ask
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {wrappingUp.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Leads wrapping up · {wrappingUp.length} finished{" "}
            {wrappingUp.length === 1 ? "story" : "stories"} (closing PRs, ticking criteria): nothing
            for you
          </summary>
          <ul className="flex flex-col gap-0.5 pt-1 ps-4">
            {wrappingUp.map((item) => (
              <li key={item.itemId}>
                <button
                  type="button"
                  onClick={() => props.onOpenItem(item)}
                  className="cursor-pointer text-left hover:underline"
                >
                  {deskTitle(item)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <section className="flex flex-col">
        <DeskHeading>The planner's plan · {agentLines.length} under way</DeskHeading>
        <div className="flex items-center gap-2 pb-1 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">
            {plannerWork
              ? `Updated ${formatFleetBoardAge(plannerWork.planAt ?? plannerWork.updatedAt, props.nowMs) ?? "just now"} ago`
              : "No plan yet"}
            {waitingUpdates > 0
              ? ` · ${waitingUpdates} chat ${waitingUpdates === 1 ? "update" : "updates"} on the way`
              : ""}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void sendToChat(
                props.planner,
                "Catch up: check the chats you run (desk.mjs agents, and t3_thread_read on any that moved since your last checklist), rewrite your checklist with plan set, and tell me in three lines what moved.",
              )
            }
          >
            Catch up
          </Button>
        </div>
      </section>
      {agentLines.length > 0 || doneLines.length > 0 ? (
        <section className="flex flex-col">
          <ul className="flex flex-col">
            {agentLines.map((line) => (
              <li key={line.text} className="flex items-start gap-2 py-1 text-sm">
                <span aria-hidden className="w-4 shrink-0 text-muted-foreground">
                  ▶
                </span>
                <span className="min-w-0 flex-1">{line.text}</span>
                <span className="shrink-0 rounded border border-border px-1.5 text-2xs text-muted-foreground">
                  {line.who}
                </span>
              </li>
            ))}
          </ul>
          {doneLines.length > 0 ? (
            <details>
              <summary className="cursor-pointer py-1 text-xs text-muted-foreground">
                Done · {doneLines.length}
              </summary>
              <ul className="flex flex-col">
                {doneLines.map((line) => (
                  <li
                    key={line.text}
                    className="flex items-start gap-2 py-1 text-sm text-muted-foreground"
                  >
                    <span aria-hidden className="w-4 shrink-0">
                      ✓
                    </span>
                    <span className="min-w-0 flex-1">{line.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
      <section className="flex flex-col">
        <DeskHeading>Next up · {next.length}</DeskHeading>
        <ul className="flex flex-col divide-y divide-border">
          {next.map((item) => {
            const chat = props.chatsFor(item)[0];
            return row(
              item,
              chat ? (
                <ChatBadge chat={chat} nowMs={props.nowMs} />
              ) : (
                <Button size="xs" variant="ghost" onClick={() => props.onStartChat(item)}>
                  Start a chat
                </Button>
              ),
            );
          })}
        </ul>
        {next.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">Nothing else open in this sprint.</p>
        ) : null}
      </section>
      <details>
        <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Done this sprint · {done.length}
        </summary>
        <ul className="flex flex-col divide-y divide-border">
          {done.map((item) => row(item, null))}
        </ul>
      </details>
    </div>
  );
}

/**
 * Fleet fork: Rigo's big picture for an app's sprint, above the plan: what matters, what to leave
 * alone, who's waiting on whom. Markdown, with pictures pasted in; the planner works from it.
 */
export function BigPicture(props: {
  readonly app: string;
  readonly sprint: string;
  readonly note: DeskNote | null;
  readonly onSaved: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const text = props.note?.text ?? "";
  const attach = async (files: ReadonlyArray<File>) => {
    for (const file of files.filter((entry) => entry.type.startsWith("image/"))) {
      setUploading((count) => count + 1);
      try {
        const url = await uploadPicture(file);
        setDraft(
          (current) =>
            `${current ?? ""}${current && !current.endsWith("\n") ? "\n" : ""}![picture](${url})\n`,
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
    if (draft !== null && draft.trim() !== text.trim()) {
      saveDeskNote({ kind: "framing", sprint: props.sprint, app: props.app }, draft.trim());
      props.onSaved(draft.trim());
    }
    setDraft(null);
  };
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <DeskHeading>Big picture</DeskHeading>
        {draft === null ? (
          <Button size="xs" variant="ghost" className="ms-auto" onClick={() => setDraft(text)}>
            {text ? "Edit" : "Write it"}
          </Button>
        ) : null}
      </div>
      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label="Big picture"
            rows={6}
            placeholder="What matters most this sprint, what to leave alone, constraints, who's waiting on whom. Paste a picture to add it."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              const files = [...event.clipboardData.files];
              if (files.some((entry) => entry.type.startsWith("image/"))) {
                event.preventDefault();
                void attach(files);
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button size="xs" disabled={uploading > 0} onClick={save}>
              Save and tell the planner
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            {uploading > 0 ? (
              <span className="text-xs text-muted-foreground">Attaching {uploading}…</span>
            ) : null}
          </div>
        </div>
      ) : text ? (
        <div className="text-sm [&_img]:max-h-48 [&_img]:rounded-md">
          <ChatMarkdown text={text} cwd={undefined} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Frame the sprint for the planner: what matters most, what to leave alone, who's waiting on
          whom. It reads this every turn.
        </p>
      )}
    </section>
  );
}

/**
 * What a decision's link is, in plain words: an item's type, plain title and where it stands; a
 * PR's title and state; a test sheet's name and checks done.
 */
/** A plain name for a link the Desk doesn't know: "Claude page", "Hub page", or its site. */
function linkName(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "claude.ai") return "Claude page";
    if (parsed.pathname.startsWith("/a/")) return "Hub page";
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkedThing(props: {
  readonly url: string;
  readonly items: ReadonlyArray<DeskItem>;
  readonly sheets: ReadonlyArray<SheetSummary>;
  /** The chats that worked on the item, with their state and next step. */
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly notes: DeskNotes;
  readonly nowMs: number;
  readonly onOpenChat: (chat: CardChatState) => void;
  /** Opens the link in the page's own way (beside it, on the Do page) instead of a new tab. */
  readonly onOpen?: ((url: string) => void) | undefined;
  /** What a click does, shown on the card ("Opens beside", "Opens in your browser ↗"). */
  readonly opens?: string | undefined;
}) {
  const item = props.items.find((entry) => entry.url === props.url);
  const sheetId = props.url.match(/\/a\/([a-z0-9]{12})/)?.[1];
  const sheet = sheetId ? props.sheets.find((entry) => entry.id === sheetId) : undefined;
  let kind: ReactNode = null;
  let title: string;
  let detail: string | null = null;
  let state: string | null = null;
  if (item) {
    kind =
      item.kind === "pr" ? (
        <span className="text-2xs text-muted-foreground">PR</span>
      ) : (
        <TypeTag kind={workKind(item)} />
      );
    title = item.plain?.what ?? deskTitle(item);
    detail =
      item.plain?.where ?? (item.plain?.what && item.plain.what !== item.title ? item.title : null);
    state =
      item.kind === "pr"
        ? item.state
        : item.state === "closed" || item.status === "Done"
          ? "closed"
          : (item.status ?? "open");
  } else if (sheet) {
    kind = <span className="text-2xs text-muted-foreground">Test sheet</span>;
    title = sheet.title;
    const { total, pass, fail, skip, blocked } = sheet.counts;
    detail = `${pass + fail + skip + blocked} of ${total} checked${fail ? `, ${fail} failed` : ""}`;
  } else {
    const pull = props.url.match(/github\.com\/[^/]+\/([^/]+)\/(pull|issues)\/(\d+)/);
    title = pull ? `${pull[1]} ${pull[2] === "pull" ? "PR " : ""}#${pull[3]}` : linkName(props.url);
    detail = pull ? null : props.url.replace(/^https?:\/\//, "").slice(0, 80);
  }
  const ref = item ? deskRef(item) : null;
  const chats = item ? props.chatsFor(item) : [];
  return (
    <div className="flex min-w-0 flex-col rounded-md border border-border text-xs">
      <a
        href={props.url}
        target="_blank"
        rel="noopener"
        onClick={(event) => {
          if (!props.onOpen) return;
          event.preventDefault();
          props.onOpen(props.url);
        }}
        className="flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-accent"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {kind}
          <span className="min-w-0 flex-1 font-medium text-foreground">{title}</span>
          {props.opens ? (
            <span className="shrink-0 text-2xs text-muted-foreground">{props.opens}</span>
          ) : null}
          {state ? (
            <span
              className={cn(
                "shrink-0 font-medium",
                state === "closed" || state === "merged"
                  ? "text-success-foreground"
                  : "text-info-foreground",
              )}
            >
              {state}
            </span>
          ) : null}
        </span>
        {detail || ref ? (
          <span className="text-muted-foreground">{[ref, detail].filter(Boolean).join(" · ")}</span>
        ) : null}
      </a>
      {chats.length > 0 ? (
        <ul className="flex flex-col border-t border-border px-2 py-1">
          {chats.map((chat) => {
            const next = props.notes.work[chat.threadId]?.next ?? null;
            const age = formatFleetBoardAge(chat.since, props.nowMs);
            return (
              <li key={chat.threadId}>
                <button
                  type="button"
                  onClick={() => props.onOpenChat(chat)}
                  className="flex w-full min-w-0 cursor-pointer flex-col py-0.5 text-left hover:underline"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-muted-foreground">Chat</span>
                    <span className="min-w-0 flex-1 truncate">{chatTitle(chat.title)}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {chatStatus(chat).label}
                      {age ? ` · ${age} ago` : ""}
                    </span>
                  </span>
                  {next ? <span className="text-muted-foreground">Next: {next}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One of a planner's questions, with what Rigo needs to answer it: the items and PRs it's about
 * with their state now, what each option does and whether it can be undone, its options (the
 * recommended one marked) and a note. "Tell me more" asks the planner to explain it.
 */
export function DecisionCard(props: {
  readonly decision: PlannerDecision;
  readonly items: ReadonlyArray<DeskItem>;
  readonly sheets: ReadonlyArray<SheetSummary>;
  readonly chatsFor: (item: DeskItem) => ReadonlyArray<CardChatState>;
  readonly notes: DeskNotes;
  readonly nowMs: number;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onAnswer: (decision: PlannerDecision, choice: string, note: string | null) => void;
  readonly onTellMore: () => void;
  /** Sends the comments to the planner without answering yet; resolves whether it got them. */
  readonly onReply?: (decision: PlannerDecision, note: string) => Promise<boolean>;
  /** The planner's machine, which voice input runs through. */
  readonly voiceEnvironmentId?: string | null;
}) {
  const { decision } = props;
  const [note, setNote] = useState("");
  // Comments on each part of the proposal (a story, the quick fixes), sent together.
  const sections = decision.context ? contextSections(decision.context) : [];
  const [comments, setComments] = useState<Record<number, string>>({});
  const [commenting, setCommenting] = useState<ReadonlySet<number>>(new Set());
  const [sent, setSent] = useState<{ readonly ok: boolean; readonly at: string } | null>(null);
  const feedback = commentsText(sections, comments, note);
  const sendComments = async () => {
    if (!props.onReply || !feedback) return;
    const ok = await props.onReply(decision, feedback);
    setSent({ ok, at: clockNow() });
    if (ok) {
      setComments({});
      setCommenting(new Set());
      setNote("");
    }
  };
  const [asked, setAsked] = useState(false);
  // The recommended option starts picked; nothing is sent until Rigo presses Send.
  const [choice, setChoice] = useState<string | null>(
    decision.recommended && decision.options.includes(decision.recommended)
      ? decision.recommended
      : null,
  );
  const send = () => {
    if (choice) props.onAnswer(decision, choice, feedback || null);
  };
  const noteField = (
    id: string,
    value: string,
    onChange: (text: string) => void,
    placeholder: string,
    rows = 3,
  ) =>
    props.voiceEnvironmentId ? (
      <DeskNoteField
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        environmentId={props.voiceEnvironmentId}
      />
    ) : (
      <Textarea
        id={id}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  const links = [...new Set([...(decision.itemUrl ? [decision.itemUrl] : []), ...decision.links])];
  const outcomeOf = (option: string) =>
    decision.outcomes.find((entry) => entry.option === option) ?? null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
      {decision.goalFor ? (
        <span className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          Proposed goal for {decision.goalFor} · a note replaces it with your words
        </span>
      ) : null}
      <span className="text-sm font-medium">{decision.question}</span>
      {decision.why ? <span className="text-xs text-muted-foreground">{decision.why}</span> : null}
      {decision.context ? (
        <details open className="rounded-md bg-muted/50 px-2 py-1.5 text-xs">
          <summary className="cursor-pointer font-medium">
            Background{props.onReply && sections.length > 1 ? " · comment on any part" : ""}
          </summary>
          {props.onReply && sections.length > 1 ? (
            <div className="flex flex-col gap-2 pt-1">
              {sections.map((section, index) => (
                <div
                  key={section.body}
                  className="flex flex-col gap-1 border-b border-border/60 pb-2 last:border-b-0"
                >
                  <div className="[&_p]:mb-1">
                    <ChatMarkdown text={section.body} cwd={undefined} />
                  </div>
                  {commenting.has(index) || comments[index] ? (
                    noteField(
                      `decision-comment-${decision.id}-${index}`,
                      comments[index] ?? "",
                      (text) => setComments((current) => ({ ...current, [index]: text })),
                      `Your comment on "${section.title}"`,
                      2,
                    )
                  ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="self-start"
                      onClick={() => setCommenting((current) => new Set(current).add(index))}
                    >
                      Comment on this
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="pt-1 [&_p]:mb-1">
              <ChatMarkdown text={decision.context} cwd={undefined} />
            </div>
          )}
        </details>
      ) : null}
      {links.length > 0 ? (
        <div className="flex flex-col gap-1">
          {links.map((url) => (
            <LinkedThing
              key={url}
              url={url}
              items={props.items}
              sheets={props.sheets}
              chatsFor={props.chatsFor}
              notes={props.notes}
              nowMs={props.nowMs}
              onOpenChat={props.onOpenChat}
            />
          ))}
        </div>
      ) : null}
      <section aria-label="Your answer" className="flex flex-col gap-2 border-t border-border pt-3">
        <DeskHeading>Your answer</DeskHeading>
        <div role="radiogroup" aria-label={decision.question} className="flex flex-col gap-1.5">
          {decision.options.map((option) => {
            const outcome = outcomeOf(option);
            const picked = choice === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={picked}
                onClick={() => setChoice(option)}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-start",
                  picked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    picked ? "border-primary" : "border-muted-foreground/50",
                  )}
                >
                  {picked ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {option}
                    {option === decision.recommended ? (
                      <Badge variant="info" size="sm">
                        Recommended
                      </Badge>
                    ) : null}
                    {outcome?.undoable === false ? (
                      <Badge variant="error" size="sm">
                        Can't be undone
                      </Badge>
                    ) : null}
                  </span>
                  {outcome ? (
                    <span className="text-xs text-muted-foreground">{outcome.effect}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <label htmlFor={`decision-note-${decision.id}`} className="text-xs font-medium">
          {decision.goalFor
            ? "Your wording for the goal (optional)"
            : "Add context for the planner (optional)"}
        </label>
        {noteField(
          `decision-note-${decision.id}`,
          note,
          setNote,
          "Anything the planner should know: what you heard, the focus you want, what to watch out for. Use the microphone to talk it through.",
        )}
        {sent ? (
          <span
            role="status"
            className={cn(
              "text-xs",
              sent.ok ? "text-muted-foreground" : "text-destructive-foreground",
            )}
          >
            {sent.ok
              ? `Comments sent to the planner at ${sent.at}. It will revise this card and reply in its chat.`
              : "Couldn't reach the planner's chat (its machine may be off or asleep). Your comments are still here; try again."}
          </span>
        ) : null}
        {/* Stays in view at the bottom of a long card, so sending never needs a scroll. */}
        <div className="sticky bottom-0 -mx-2.5 -mb-2.5 flex flex-wrap items-center gap-2 rounded-b-lg border-t border-border bg-card px-2.5 py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={asked}
            onClick={() => {
              props.onTellMore();
              setAsked(true);
            }}
          >
            {asked ? "Asked for more" : "Tell me more first"}
          </Button>
          <span className="flex-1" />
          {props.onReply && feedback ? (
            <Button size="sm" variant="outline" onClick={() => void sendComments()}>
              Send comments, decide later
            </Button>
          ) : null}
          <Button size="sm" disabled={!choice} onClick={send}>
            {choice ? `Send: ${choice}` : "Pick an option"}
          </Button>
        </div>
      </section>
    </div>
  );
}
