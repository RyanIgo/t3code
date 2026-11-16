import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  type BoardCard,
  type CardCategory,
  type CardChatState,
  type CardStage,
  type CardTesting,
  CARD_CATEGORIES,
  CARD_STAGES,
  chatKey,
} from "./boardCards.logic";
import { removeCard, updateCard } from "./boardStore";

const TESTING_OPTIONS: ReadonlyArray<{
  readonly id: CardTesting | "none";
  readonly label: string;
}> = [
  { id: "none", label: "Not tested" },
  { id: "passed", label: "Passed" },
  { id: "failed", label: "Failed" },
];

export function CardEditorDialog(props: {
  readonly card: BoardCard;
  readonly stage: CardStage;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly projectLabel: string;
  readonly onClose: () => void;
}) {
  const { card } = props;
  const navigate = useNavigate();
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const chatByKey = new Map(props.chats.map((chat) => [chatKey(chat), chat]));

  const save = () => {
    const trimmed = title.trim();
    if (trimmed && (trimmed !== card.title || notes !== card.notes)) {
      updateCard(card.id, { title: trimmed, notes });
    }
    props.onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) save();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Card</DialogTitle>
          <DialogDescription>{props.projectLabel}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span>Title</span>
              <Input
                id="card-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span>Notes</span>
              <Textarea
                id="card-notes"
                rows={5}
                placeholder="What done looks like, links, decisions…"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <div className="flex flex-col gap-1.5 text-sm">
              <span id="card-category-label">Category</span>
              <ToggleGroup
                aria-labelledby="card-category-label"
                className="flex-wrap"
                value={card.category ? [card.category] : []}
                onValueChange={(next) =>
                  updateCard(card.id, { category: (next[0] as CardCategory | undefined) ?? null })
                }
              >
                {CARD_CATEGORIES.map((category) => (
                  <Toggle key={category.id} value={category.id}>
                    {category.label}
                  </Toggle>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <span id="card-stage-label">List</span>
              <ToggleGroup
                aria-labelledby="card-stage-label"
                className="flex-wrap"
                value={[props.stage]}
                onValueChange={(next) => {
                  const stage = next[0] as CardStage | undefined;
                  if (stage) updateCard(card.id, { stage });
                }}
              >
                {CARD_STAGES.map((stage) => (
                  <Toggle key={stage.id} value={stage.id}>
                    {stage.label}
                  </Toggle>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <span id="card-testing-label">Testing</span>
              <ToggleGroup
                aria-labelledby="card-testing-label"
                value={[card.testing ?? "none"]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value)
                    updateCard(card.id, {
                      testing: value === "none" ? null : (value as CardTesting),
                    });
                }}
              >
                {TESTING_OPTIONS.map((option) => (
                  <Toggle key={option.id} value={option.id}>
                    {option.label}
                  </Toggle>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <span>Chats</span>
              {card.chats.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No chat yet. Drag a chat's card onto this project's board, or start one from the
                  project and add it here.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {card.chats.map((ref) => {
                    const chat = chatByKey.get(chatKey(ref));
                    return (
                      <li key={chatKey(ref)} className="flex items-center gap-2">
                        <Button
                          variant="link"
                          size="xs"
                          className="min-w-0 justify-start"
                          onClick={() => {
                            save();
                            void navigate({
                              to: "/$environmentId/$threadId",
                              params: { environmentId: ref.environmentId, threadId: ref.threadId },
                            });
                          }}
                        >
                          {chat?.title ?? "Chat not loaded"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="ms-auto"
                          onClick={() =>
                            updateCard(card.id, {
                              chats: card.chats.filter((entry) => chatKey(entry) !== chatKey(ref)),
                            })
                          }
                        >
                          Unlink
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          {confirmingRemove ? (
            <>
              <span className="me-auto text-sm text-destructive-foreground">
                Remove this card? Its chats stay on their machines.
              </span>
              <Button variant="ghost" onClick={() => setConfirmingRemove(false)}>
                Keep
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  removeCard(card.id);
                  props.onClose();
                }}
              >
                Remove card
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="me-auto" onClick={() => setConfirmingRemove(true)}>
                Remove…
              </Button>
              <Button onClick={save}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
