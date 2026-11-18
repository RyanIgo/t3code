import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import type { CardChatState } from "./boardCards.logic";
import {
  chatStatus,
  chatTitle,
  type DeskItem,
  deskRef,
  deskTitle,
  featureName,
  sprintStatus,
  storyProgress,
  type WorkKind,
  workKind,
} from "./desk.logic";
import type { DeskNote } from "./deskNotes.logic";
import type { DeskPr } from "./deskPrs.logic";

/** Fleet fork: pieces the Dev Desk's views share (cards, notes, threads, small helpers). */
export function openExternal(url: string) {
  const api = readLocalApi();
  if (window.desktopBridge && api) void api.shell.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export const STAGE_VARIANT = {
  Experiment: "outline",
  Testing: "warning",
  Production: "success",
} as const;

export function formatDay(date: string, plusDays = 0): string {
  const day = new Date(`${date}T12:00:00`);
  day.setDate(day.getDate() + plusDays);
  return day.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A note that edits in place and saves when you leave the box. */
export function NoteEditor(props: {
  readonly label: string;
  readonly hint: string;
  readonly placeholder: string;
  readonly note: DeskNote | null;
  readonly rows: number;
  readonly onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const saved = props.note?.text ?? "";
  return (
    <label className="flex flex-col gap-1">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          {props.label}
        </span>
        <span className="text-2xs text-muted-foreground">
          {props.note
            ? `Updated ${new Date(props.note.updatedAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })} by ${props.note.by ?? "you"}`
            : props.hint}
        </span>
      </span>
      <Textarea
        rows={props.rows}
        placeholder={props.placeholder}
        value={draft ?? saved}
        onFocus={() => setDraft(saved)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== saved) props.onSave(draft);
          setDraft(null);
        }}
      />
    </label>
  );
}

const THREADS_SHOWN = 5;

/** T3 chats as a list: waiting ones marked, each opens its chat. */
export function ThreadList(props: {
  readonly threads: ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly empty: string;
}) {
  const [all, setAll] = useState(false);
  if (props.threads.length === 0) {
    return <p className="text-xs text-muted-foreground">{props.empty}</p>;
  }
  const sorted = [...props.threads].sort((a, b) => chatStatus(a).rank - chatStatus(b).rank);
  const shown = all ? sorted : sorted.slice(0, THREADS_SHOWN);
  return (
    <>
      <ul className="flex flex-col gap-1 text-sm">
        {shown.map((chat) => (
          <li key={`${chat.environmentId}:${chat.threadId}`} className="flex items-center gap-2">
            <Badge variant={chatStatus(chat).tone} size="sm" className="shrink-0">
              {chatStatus(chat).label}
            </Badge>
            <button
              type="button"
              className="min-w-0 cursor-pointer truncate text-left hover:underline"
              onClick={() => props.onOpenChat(chat)}
            >
              {chatTitle(chat.title)}
            </button>
          </li>
        ))}
      </ul>
      {props.threads.length > THREADS_SHOWN ? (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          onClick={() => setAll((value) => !value)}
        >
          {all ? "Show fewer" : `Show ${props.threads.length - THREADS_SHOWN} more`}
        </Button>
      ) : null}
    </>
  );
}

/** A section heading in the Desk's small caps style. */
export function DeskHeading(props: { readonly children: ReactNode }) {
  return (
    <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
      {props.children}
    </h3>
  );
}

const TAG_CLASS: Record<WorkKind, string> = {
  Story: "bg-violet-600 text-white",
  Bug: "bg-red-600 text-white",
  Maintenance: "bg-sky-700 text-white",
  Research: "bg-amber-600 text-white",
  Support: "bg-zinc-500 text-white",
};

/** The card's type, as a solid colored tag (Work type on GitHub). */
export function TypeTag(props: { readonly kind: WorkKind | null }) {
  if (!props.kind) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-px text-2xs leading-4 font-semibold",
        TAG_CLASS[props.kind],
      )}
    >
      {props.kind}
    </span>
  );
}

/** What the item's agent is doing; PR trouble shows on the PR badge instead. */
function agentState(chat: CardChatState): "asking" | "result" | "working" | "idle" {
  if (chat.needsYou) return "asking";
  if (chat.column === "done") return "result";
  return chat.working ? "working" : "idle";
}

const AGENT_BADGE = {
  asking: { label: "Agent needs you", variant: "warning" },
  result: { label: "Agent: result ready", variant: "success" },
  working: { label: "Agent working", variant: "info" },
  idle: { label: "Agent idle", variant: "secondary" },
} as const;

const PR_BADGE = {
  ready: { label: "PR ready to merge", variant: "success" },
  landed: { label: "PR already in main: close it", variant: "secondary" },
  fix: { label: "PR needs a fix", variant: "error" },
  waiting: { label: "PR checks running", variant: "info" },
  unverified: { label: "PR open", variant: "outline" },
  draft: { label: "Draft PR", variant: "outline" },
} as const;

/**
 * Fleet fork: one work item. Its type, where it belongs, its plain title, and badges only for
 * what's worth knowing: criteria, its PR, its agent, blocked. The column it sits in is its status.
 */
export function DeskCard(props: {
  readonly item: DeskItem;
  readonly chats: ReadonlyArray<CardChatState>;
  /** The item's open pull request, when it has one. */
  readonly pr?: DeskPr | null;
  readonly draggable: boolean;
  readonly showApp: boolean;
  readonly currentSprint: string | null;
  /** A button under the card (e.g. Add to sprint, Start a chat). */
  readonly action?: ReactNode;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpen: (item: DeskItem) => void;
}) {
  const { item } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.itemId,
    disabled: !props.draggable,
  });
  const agent = props.chats.toSorted((a, b) => chatStatus(a).rank - chatStatus(b).rank)[0];
  const inCurrentSprint = item.sprint !== null && item.sprint.title === props.currentSprint;
  const unfinished = sprintStatus(item) === "Todo" || sprintStatus(item) === "In Progress";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("list-none", isDragging && "relative z-10 opacity-80")}
    >
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 shadow-xs">
        <button
          type="button"
          {...(props.draggable ? { ...attributes, ...listeners } : {})}
          onClick={() => props.onOpen(item)}
          className="flex cursor-pointer flex-col gap-1 text-left outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <TypeTag kind={workKind(item)} />
            <span className="truncate">
              {[
                props.showApp ? item.app : null,
                item.feature ? featureName(item.feature) : null,
                deskRef(item),
                item.priority,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <span className="line-clamp-3 text-sm">{deskTitle(item)}</span>
        </button>
        <span className="flex flex-wrap items-center gap-1">
          {storyProgress(item) ? (
            <Badge
              variant={
                item.story?.criteria.every((criterion) => criterion.done) ? "success" : "info"
              }
              size="sm"
            >
              {storyProgress(item)}
            </Badge>
          ) : null}
          {props.pr ? (
            <Badge variant={PR_BADGE[props.pr.stage].variant} size="sm">
              {PR_BADGE[props.pr.stage].label}
            </Badge>
          ) : null}
          {agent ? (
            <button
              type="button"
              className="cursor-pointer"
              onClick={() => props.onOpenChat(agent)}
            >
              <Badge variant={AGENT_BADGE[agentState(agent)].variant} size="sm">
                {agent.asking === "subagent approval"
                  ? "Subagent needs approval"
                  : AGENT_BADGE[agentState(agent)].label}
              </Badge>
            </button>
          ) : inCurrentSprint && unfinished ? (
            <Badge variant="outline" size="sm">
              No agent yet
            </Badge>
          ) : null}
          {item.lane === "Blocked" ? (
            <Badge variant="error" size="sm">
              Blocked
            </Badge>
          ) : null}
          {item.sprint && !inCurrentSprint ? (
            <Badge variant="outline" size="sm">
              {item.sprint.title}
            </Badge>
          ) : null}
          {props.action ? <span className="ms-auto">{props.action}</span> : null}
        </span>
      </div>
    </li>
  );
}
