import { PinIcon, XIcon } from "lucide-react";

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
import { type DeskNotes, type PinPlace, pinnedChats, pinPlace } from "./deskNotes.logic";
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
 * Fleet fork: the chats pinned to one place, as chips with their live status. A chat that's
 * settled or gone drops off; unpin with the x.
 */
export function PinnedStrip(props: {
  readonly place: PinPlace;
  readonly notes: DeskNotes;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  /** Shown when nothing is pinned; omit to hide the strip instead. */
  readonly empty?: string;
}) {
  const byKey = new Map(props.chats.map((chat) => [chatKey(chat), chat]));
  const pinned = pinnedChats(props.notes, props.place).flatMap((key) => {
    const chat = byKey.get(key);
    return chat ? [chat] : [];
  });
  if (pinned.length === 0 && !props.empty) return null;
  return (
    <section aria-label="Pinned chats" className="flex flex-col gap-1.5">
      <DeskHeading>Pinned chats · {pinned.length}</DeskHeading>
      {pinned.length === 0 ? (
        <p className="text-xs text-muted-foreground">{props.empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {pinned.map((chat) => {
            const status = chatStatus(chat);
            return (
              <li
                key={chatKey(chat)}
                className="flex max-w-80 min-w-0 items-center gap-1.5 rounded-md border border-border bg-card py-1 ps-2 pe-1"
              >
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
