import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import type { CardChatState } from "./boardCards.logic";
import {
  chatStatus,
  chatWaitsOnYou,
  DESK_LANES,
  type DeskItem,
  type DeskLane,
  deskRef,
  deskTitle,
  featureName,
  storyProgress,
} from "./desk.logic";
import type { DeskNote } from "./deskNotes.logic";
import { setDeskLane } from "./deskStore";

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
              {chat.title}
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

export function DeskCard(props: {
  readonly item: DeskItem;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly draggable: boolean;
  readonly showApp: boolean;
  readonly currentSprint: string | null;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpen: (item: DeskItem) => void;
}) {
  const { item } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.itemId,
    disabled: !props.draggable,
  });
  const ref = deskRef(item);
  const needsYou = props.chats.some(chatWaitsOnYou);
  const working = props.chats.some((chat) => chat.working);
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
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span className="truncate">
              {[
                props.showApp ? item.app : null,
                item.feature ? featureName(item.feature) : null,
                ref,
                item.priority,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {item.kind === "pr" ? <span>· PR</span> : null}
          </span>
          <span className="line-clamp-3 text-sm">{deskTitle(item)}</span>
          {item.plain?.where ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">{item.plain.where}</span>
          ) : null}
        </button>
        <span className="flex flex-wrap items-center gap-1">
          {item.sprint && item.sprint.title === props.currentSprint ? (
            <Badge variant="info" size="sm">
              This sprint
            </Badge>
          ) : item.sprint ? (
            <Badge variant="outline" size="sm">
              {item.sprint.title}
            </Badge>
          ) : null}
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
          {item.workType && item.workType !== "Feature work" ? (
            <Badge variant="secondary" size="sm">
              {item.workType}
            </Badge>
          ) : null}
          {item.status && item.status !== "Todo" ? (
            <Badge variant="outline" size="sm">
              {item.status}
            </Badge>
          ) : null}
          {item.pullRequests.map((pr) => (
            <Badge
              key={pr.url}
              variant={
                pr.state === "merged" ? "success" : pr.state === "closed" ? "secondary" : "outline"
              }
              size="sm"
            >
              PR #{pr.number}
              {pr.state === "open" ? "" : ` · ${pr.state}`}
            </Badge>
          ))}
          {props.chats.length > 0 ? (
            <button
              type="button"
              className="cursor-pointer"
              onClick={() => props.onOpenChat(props.chats[0] as CardChatState)}
            >
              <Badge variant={needsYou ? "warning" : working ? "info" : "secondary"} size="sm">
                {props.chats.length} chat{props.chats.length === 1 ? "" : "s"}
                {needsYou ? " · needs you" : working ? " · working" : ""}
              </Badge>
            </button>
          ) : null}
          <span className="ms-auto">
            <Select
              value={item.lane ?? "none"}
              onValueChange={(value) => {
                if (typeof value !== "string") return;
                const lane = value === "none" ? null : (value as DeskLane);
                if (lane !== item.lane) void setDeskLane(item.itemId, lane);
              }}
            >
              <SelectTrigger aria-label={`Lane for ${deskTitle(item)}`} size="sm">
                <SelectValue>{item.lane ?? "No lane"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {DESK_LANES.map((lane) => (
                  <SelectItem key={lane} value={lane}>
                    {lane}
                  </SelectItem>
                ))}
                <SelectItem value="none">No lane</SelectItem>
              </SelectPopup>
            </Select>
          </span>
        </span>
      </div>
    </li>
  );
}
