import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  type BoardDocument,
  type CardChatState,
  type CardStage,
  type PlacedCard,
  buildProjectLists,
  CARD_CATEGORIES,
  CARD_STAGES,
  orderAt,
} from "./boardCards.logic";
import { addCard, updateCard } from "./boardStore";

const STAGE_HINT: Partial<Record<CardStage, string>> = {
  testing: "Try these and mark them passed",
  ready: "Tested; the PR can merge",
};

/** A project's board: one list per work stage. Planning mode adds, edits and shows Ideas. */
export function ProjectBoard(props: {
  readonly projectKey: string;
  readonly document: BoardDocument;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly planning: boolean;
  readonly machineLabel: (environmentId: string) => string | null;
  readonly onEdit: (cardId: string) => void;
}) {
  const navigate = useNavigate();
  const lists = buildProjectLists(props.document, props.projectKey, props.chats, {
    includeLooseChats: true,
  });
  const stages = props.planning ? CARD_STAGES : CARD_STAGES.filter((stage) => stage.id !== "ideas");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const placedById = new Map(
    Object.values(lists).flatMap((list) => list.map((placed) => [placed.card.id, placed] as const)),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const placed = placedById.get(String(event.active.id));
    const stage = event.over?.data.current?.stage as CardStage | undefined;
    if (!placed || !stage) return;
    const target = lists[stage].filter((entry) => entry.card.id !== placed.card.id);
    const overIndex = target.findIndex((entry) => entry.card.id === event.over?.id);
    const order = orderAt(target, overIndex === -1 ? target.length : overIndex);
    if (placed.loose) {
      addCard({
        projectKey: props.projectKey,
        title: placed.card.title,
        stage,
        order,
        chats: placed.card.chats,
      });
      return;
    }
    updateCard(placed.card.id, stage === placed.stage ? { order } : { stage, order });
  };

  const open = (placed: PlacedCard) => {
    const chat = placed.card.chats[0];
    if (!props.planning && chat) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: chat.environmentId, threadId: chat.threadId },
      });
      return;
    }
    if (placed.loose) {
      const created = addCard({
        projectKey: props.projectKey,
        title: placed.card.title,
        stage: placed.stage,
        order: orderAt(lists[placed.stage], lists[placed.stage].length),
        chats: placed.card.chats,
      });
      props.onEdit(created.id);
      return;
    }
    props.onEdit(placed.card.id);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-4 pb-4">
        {stages.map((stage) => (
          <BoardList
            key={stage.id}
            stage={stage.id}
            label={stage.label}
            cards={lists[stage.id]}
            planning={props.planning}
            projectKey={props.projectKey}
            machineLabel={props.machineLabel}
            onOpen={open}
          />
        ))}
      </div>
    </DndContext>
  );
}

function BoardList(props: {
  readonly stage: CardStage;
  readonly label: string;
  readonly cards: ReadonlyArray<PlacedCard>;
  readonly planning: boolean;
  readonly projectKey: string;
  readonly machineLabel: (environmentId: string) => string | null;
  readonly onOpen: (placed: PlacedCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `list:${props.stage}`,
    data: { stage: props.stage },
  });
  const [draft, setDraft] = useState<string | null>(null);
  const hint = STAGE_HINT[props.stage];
  const needsYou = props.cards.filter((placed) => placed.needsYou).length;

  const submit = () => {
    const title = draft?.trim();
    if (title) {
      addCard({
        projectKey: props.projectKey,
        title,
        stage: props.stage,
        order: orderAt(props.cards, props.cards.length),
      });
    }
    setDraft(title ? "" : null);
  };

  return (
    <section
      ref={setNodeRef}
      aria-label={props.label}
      className={cn(
        "flex max-h-full w-72 max-w-[85vw] shrink-0 flex-col rounded-lg border border-border bg-muted/40",
        isOver && "border-ring",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {props.label}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{props.cards.length}</span>
        {needsYou > 0 ? (
          <Badge variant="warning" size="sm" className="ms-auto">
            {needsYou} need{needsYou === 1 ? "s" : ""} you
          </Badge>
        ) : null}
      </header>
      {hint && props.cards.length > 0 ? (
        <p className="px-3 pb-1.5 text-2xs text-muted-foreground">{hint}</p>
      ) : null}
      <SortableContext
        items={props.cards.map((placed) => placed.card.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="flex min-h-8 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {props.cards.map((placed) => (
            <BoardCardTile
              key={placed.card.id}
              placed={placed}
              stage={props.stage}
              machineLabel={props.machineLabel}
              onOpen={() => props.onOpen(placed)}
            />
          ))}
        </ol>
      </SortableContext>
      {props.planning ? (
        draft === null ? (
          <Button
            variant="ghost"
            size="xs"
            className="mx-2 mb-2 justify-start"
            onClick={() => setDraft("")}
          >
            <PlusIcon />
            Add a card
          </Button>
        ) : (
          <form
            className="flex flex-col gap-1.5 px-2 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Input
              id={`board-add-${props.stage}`}
              autoFocus
              size="sm"
              placeholder="What needs doing?"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setDraft(null);
              }}
            />
            <div className="flex gap-1.5">
              <Button type="submit" size="xs">
                Add card
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )
      ) : null}
    </section>
  );
}

const CATEGORY_LABEL = new Map(CARD_CATEGORIES.map((category) => [category.id, category.label]));

export function BoardCardTile(props: {
  readonly placed: PlacedCard;
  readonly stage: CardStage;
  readonly machineLabel: (environmentId: string) => string | null;
  readonly onOpen: () => void;
  readonly projectLabel?: string | undefined;
  readonly showStage?: boolean | undefined;
}) {
  const { placed } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: placed.card.id,
    data: { stage: props.stage },
  });
  const pullRequests = placed.chats.flatMap((chat) =>
    chat.pullRequestNumber === null ? [] : [chat.pullRequestNumber],
  );
  const machines = [
    ...new Set(placed.card.chats.flatMap((ref) => props.machineLabel(ref.environmentId) ?? [])),
  ];
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("list-none", isDragging && "relative z-10 opacity-80")}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={props.onOpen}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-left shadow-xs hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden",
          placed.loose && "border-dashed",
        )}
      >
        {props.projectLabel ? (
          <span className="truncate text-2xs text-muted-foreground">{props.projectLabel}</span>
        ) : null}
        <span className="line-clamp-3 text-sm">{placed.card.title}</span>
        <span className="flex flex-wrap items-center gap-1">
          {placed.card.category ? (
            <Badge variant={placed.card.category === "critical" ? "error" : "secondary"} size="sm">
              {CATEGORY_LABEL.get(placed.card.category)}
            </Badge>
          ) : null}
          {props.showStage ? (
            <Badge variant="outline" size="sm">
              {CARD_STAGES.find((stage) => stage.id === placed.stage)?.label}
            </Badge>
          ) : null}
          {placed.needsYou ? (
            <Badge variant="warning" size="sm">
              Needs you
            </Badge>
          ) : placed.working ? (
            <Badge variant="info" size="sm">
              Working
            </Badge>
          ) : null}
          {placed.card.testing === "passed" ? (
            <Badge variant="success" size="sm">
              Passed
            </Badge>
          ) : placed.card.testing === "failed" ? (
            <Badge variant="error" size="sm">
              Failed testing
            </Badge>
          ) : placed.stage === "testing" ? (
            <Badge variant="warning" size="sm">
              Waiting on testing
            </Badge>
          ) : null}
          {pullRequests.map((number) => (
            <Badge key={number} variant="outline" size="sm">
              PR #{number}
            </Badge>
          ))}
          {machines.map((label) => (
            <span
              key={label}
              className="truncate rounded border border-border px-1 font-mono text-3xs text-muted-foreground"
            >
              {label}
            </span>
          ))}
          {placed.loose ? (
            <span className="text-2xs text-muted-foreground">Chat · not on the board yet</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
