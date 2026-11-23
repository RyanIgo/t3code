import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { CardChatState } from "./boardCards.logic";
import { chatStatus, chatTitle, type DeskItem, deskRef, deskTitle } from "./desk.logic";
import type { Catchup } from "./deskFocus.logic";
import { DeskHeading } from "./DeskParts";

const CATCHUP_SHOWN = 8;

/** Since the user last caught up: chats that finished or asked something, and closed items. */
export function CatchupSection(props: {
  readonly catchup: Catchup;
  readonly caughtUpAt: number;
  readonly onCaughtUp: () => void;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
  readonly repoOf: (chat: CardChatState) => string | null;
}) {
  const { chats, closed } = props.catchup;
  const total = chats.length + closed.length;
  const since = new Date(props.caughtUpAt).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <section
      aria-label="Since you last caught up"
      className="mx-4 flex shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <DeskHeading>
          Since {since} · {total === 0 ? "nothing new" : `${total} new`}
        </DeskHeading>
        {total > 0 ? (
          <Button variant="ghost" size="xs" onClick={props.onCaughtUp}>
            I'm caught up
          </Button>
        ) : null}
      </div>
      {total > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {chats.slice(0, CATCHUP_SHOWN).map((chat) => (
            <li key={`${chat.environmentId}:${chat.threadId}`} className="flex items-center gap-2">
              <Badge variant={chatStatus(chat).tone} size="sm">
                {chatStatus(chat).label}
              </Badge>
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate text-left hover:underline"
                onClick={() => props.onOpenChat(chat)}
              >
                {chatTitle(chat.title)}
              </button>
              {props.repoOf(chat) ? (
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {props.repoOf(chat)}
                </span>
              ) : null}
            </li>
          ))}
          {closed.slice(0, CATCHUP_SHOWN).map((item) => (
            <li key={item.itemId} className="flex items-center gap-2">
              <Badge variant="success" size="sm">
                Closed
              </Badge>
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate text-left hover:underline"
                onClick={() => props.onOpenItem(item)}
              >
                {deskTitle(item)}
              </button>
              <span className="shrink-0 text-2xs text-muted-foreground">{deskRef(item)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
