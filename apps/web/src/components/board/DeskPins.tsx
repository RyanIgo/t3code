import { CalendarCheckIcon, PinIcon, XIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuTrigger,
} from "../ui/menu";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus, chatTitle } from "./desk.logic";
import {
  type DeskNotes,
  PIN_ROLE_LABEL,
  PIN_ROLES,
  pinAt,
  type PinPlace,
  pinnedChats,
  pinPlace,
  todayChatFor,
  todayChatTitle,
} from "./deskNotes.logic";
import { saveDeskPin } from "./deskNotesStore";
import { DeskHeading } from "./DeskParts";

export interface PinChoice {
  readonly place: PinPlace;
  readonly label: string;
}

const chatKey = (chat: Pick<CardChatState, "environmentId" | "threadId">) =>
  `${chat.environmentId}:${chat.threadId}`;

/** Fleet fork: pins a chat to places on the Board (Today, an app, a sprint, an item). */
export function PinMenu(props: {
  readonly chatKey: string;
  readonly choices: ReadonlyArray<PinChoice>;
  readonly notes: DeskNotes;
}) {
  const pinnedHere = (place: PinPlace) =>
    props.notes.pins[pinPlace(place)]?.[props.chatKey]?.pinned === true;
  const count = props.choices.filter((choice) => pinnedHere(choice.place)).length;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant={count > 0 ? "secondary" : "ghost"}
            size="xs"
            aria-label="Pin this chat on the Board"
          />
        }
      >
        <PinIcon />
        {count > 0 ? `Pinned (${count})` : "Pin"}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Pin this chat to</MenuGroupLabel>
          {props.choices.map((choice) => (
            <MenuCheckboxItem
              key={pinPlace(choice.place)}
              checked={pinnedHere(choice.place)}
              onCheckedChange={(checked) => saveDeskPin(choice.place, props.chatKey, checked)}
            >
              {choice.label}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * Fleet fork: the chats pinned to one place, as chips with their live status and what each is
 * for (planner, development, bug fixes, feature). A chat that's settled or gone drops off.
 */
export function PinnedStrip(props: {
  readonly place: PinPlace;
  readonly notes: DeskNotes;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  /** Shown when nothing is pinned; omit to hide the strip instead. */
  readonly empty?: string;
  /** The heading; defaults to "Pinned chats". */
  readonly title?: string;
  /** One line under the heading on what this group is for. */
  readonly hint?: string;
  /** Set apart in its own box, for a page that shows more than one group. */
  readonly framed?: boolean;
}) {
  const byKey = new Map(props.chats.map((chat) => [chatKey(chat), chat]));
  const pinned = pinnedChats(props.notes, props.place).flatMap((key) => {
    const chat = byKey.get(key);
    return chat ? [chat] : [];
  });
  if (pinned.length === 0 && !props.empty) return null;
  return (
    <section
      aria-label={props.title ?? "Pinned chats"}
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        props.framed && "rounded-lg border border-border bg-muted/40 p-3",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <DeskHeading>
          {props.title ?? "Pinned chats"} · {pinned.length}
        </DeskHeading>
        {props.hint ? <span className="text-2xs text-muted-foreground">{props.hint}</span> : null}
      </div>
      {pinned.length === 0 ? (
        <p className="text-xs text-muted-foreground">{props.empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {pinned.map((chat) => {
            const status = chatStatus(chat);
            const role = pinAt(props.notes, props.place, chatKey(chat))?.role ?? null;
            return (
              <li
                key={chatKey(chat)}
                className="flex max-w-96 min-w-0 items-center gap-1.5 rounded-md border border-border bg-card py-1 ps-1 pe-1"
              >
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        variant={role ? "secondary" : "ghost"}
                        size="xs"
                        aria-label={`What ${chatTitle(chat.title)} is for`}
                      />
                    }
                  >
                    {role ? PIN_ROLE_LABEL[role] : "Role"}
                  </MenuTrigger>
                  <MenuPopup align="start">
                    <MenuGroup>
                      <MenuGroupLabel>This chat is for</MenuGroupLabel>
                      {PIN_ROLES.map((entry) => (
                        <MenuCheckboxItem
                          key={entry}
                          checked={role === entry}
                          onCheckedChange={() =>
                            saveDeskPin(props.place, chatKey(chat), true, entry)
                          }
                        >
                          {PIN_ROLE_LABEL[entry]}
                        </MenuCheckboxItem>
                      ))}
                    </MenuGroup>
                  </MenuPopup>
                </Menu>
                <button
                  type="button"
                  className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-sm"
                  onClick={() => props.onOpenChat(chat)}
                >
                  <Badge variant={status.tone} size="sm">
                    {status.label}
                  </Badge>
                  <span className="truncate">{chatTitle(chat.title)}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Unpin ${chatTitle(chat.title)}`}
                  onClick={() => saveDeskPin(props.place, chatKey(chat), false)}
                >
                  <XIcon />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Fleet fork: the day's planning chat, titled with the day it was started. Opens it when it's
 * running; otherwise offers to start one (yesterday's stays in the sidebar under its own date).
 */
export function TodayChatBar(props: {
  readonly day: string;
  readonly notes: DeskNotes;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onStart: () => void;
}) {
  const key = todayChatFor(props.notes, props.day);
  const chat = key ? props.chats.find((entry) => chatKey(entry) === key) : undefined;
  const title = todayChatTitle(props.day);
  const status = chat ? chatStatus(chat) : null;
  return (
    <section
      aria-label="Today's chat"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <CalendarCheckIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {chat && status ? (
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-center gap-2 text-left text-sm font-medium"
          onClick={() => props.onOpenChat(chat)}
        >
          <span className="truncate">{chatTitle(chat.title)}</span>
          <Badge variant={status.tone} size="sm">
            {status.label}
          </Badge>
        </button>
      ) : (
        <>
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">
            No chat for today yet. It helps you pick what to work on first, across every app.
          </span>
        </>
      )}
      <Button
        variant={chat ? "ghost" : "default"}
        size="xs"
        className="ms-auto"
        onClick={chat ? () => props.onOpenChat(chat) : props.onStart}
      >
        {chat ? "Open" : "Plan today"}
      </Button>
    </section>
  );
}
