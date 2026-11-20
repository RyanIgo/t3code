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
import { CHAT_ROLE_LABEL, CHAT_ROLES, type DeskNotes } from "./deskNotes.logic";
import { saveChatRole } from "./deskNotesStore";
import { DeskHeading, TypeTag } from "./DeskParts";
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
  readonly today: ReactNode;
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
      {props.today}
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
}) {
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
  // What only Rigo can move: a question or result from the item's chat, a wrap-up, or urgent
  // work nobody has started.
  const ask = (item: DeskItem): { label: string; action: "open" | "start" } | null => {
    const chat = props.chatsFor(item)[0];
    if (needsWrapUp(item, props.signalsFor(item))) return { label: "Wrap up", action: "open" };
    if (chat?.needsYou) return { label: "Answer", action: "open" };
    if (chat?.column === "done") return { label: "Read result", action: "open" };
    if (!chat && isOpenWork(item) && (item.priority === "P0" || item.priority === "P1")) {
      return { label: "Start a chat", action: "start" };
    }
    return null;
  };
  const waiting = inSprint.filter((item) => ask(item) !== null);
  const prsWaiting = props.prs.filter(
    (pr) =>
      pr.app === props.app &&
      (pr.stage === "ready" || pr.stage === "fix") &&
      !isDependencyUpdate(pr),
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
      <section className="flex flex-col">
        <DeskHeading>Waiting on you · {waiting.length + prsWaiting.length}</DeskHeading>
        {prsWaiting.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {prsWaiting.map((pr) => (
              <li key={pr.url} className="flex min-w-0 items-center gap-2 py-1.5">
                <button
                  type="button"
                  onClick={() => props.onOpenPr(pr)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-sm hover:underline"
                >
                  <span className="shrink-0 text-xs text-muted-foreground">PR #{pr.number}</span>
                  <span className="truncate">{pr.title}</span>
                </button>
                <Button size="xs" variant="outline" onClick={() => props.onOpenPr(pr)}>
                  {pr.stage === "ready" ? "Merge" : "Send back"}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {waiting.length === 0 && prsWaiting.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">Nothing in this sprint waits on you.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {waiting.map((item) => {
              const needed = ask(item);
              return row(
                item,
                <Button
                  size="xs"
                  variant={needed?.action === "start" ? "default" : "outline"}
                  onClick={() =>
                    needed?.action === "start" ? props.onStartChat(item) : props.onOpenItem(item)
                  }
                >
                  {needed?.label}
                </Button>,
              );
            })}
          </ul>
        )}
      </section>
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
