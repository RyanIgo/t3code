import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutDashboardIcon, MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { CardChatState } from "./boardCards.logic";
import { type DeskChatContext, contextLabel, deskFragment } from "./deskChat.logic";
import { useDeskNotes } from "./deskNotesStore";

/** A project a new chat can start in: a machine's copy of a repo. */
export interface DeskProjectChoice {
  readonly key: string;
  readonly label: string;
  readonly ref: ScopedProjectRef;
  /** The repo's name without its owner, to rank the app's own projects first. */
  readonly repo: string;
}

export function ChatAboutButton(props: { readonly onClick: () => void; readonly label?: string }) {
  return (
    <Button variant="outline" size="xs" onClick={props.onClick}>
      <MessageSquarePlusIcon />
      {props.label ?? "Chat about this"}
    </Button>
  );
}

/**
 * Starts a chat about part of the Desk, or links one that's already open. Either way the chat
 * gets an opening message with what Rigo is working on and how to build context; it lands in the
 * composer so it can be read and edited before sending.
 */
export function ChatLauncher(props: {
  readonly context: DeskChatContext;
  readonly projects: ReadonlyArray<DeskProjectChoice>;
  readonly appRepos: ReadonlySet<string>;
  readonly chats: ReadonlyArray<CardChatState>;
  readonly appChats: ReadonlySet<string>;
  readonly onStart: (project: DeskProjectChoice) => void;
  readonly onLink: (chat: CardChatState) => void;
  readonly onClose: () => void;
}) {
  const projects = [...props.projects].sort(
    (a, b) =>
      Number(props.appRepos.has(b.repo)) - Number(props.appRepos.has(a.repo)) ||
      a.label.localeCompare(b.label),
  );
  const chats = [...props.chats].sort(
    (a, b) =>
      Number(props.appChats.has(`${b.environmentId}:${b.threadId}`)) -
      Number(props.appChats.has(`${a.environmentId}:${a.threadId}`)),
  );
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [projectKey, setProjectKey] = useState<string | null>(projects[0]?.key ?? null);
  const [chatKey, setChatKey] = useState<string | null>(null);
  const project = projects.find((entry) => entry.key === projectKey) ?? null;
  const chat =
    chats.find((entry) => `${entry.environmentId}:${entry.threadId}` === chatKey) ?? null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1 pe-8">
            <DialogTitle>Chat about {contextLabel(props.context)}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              The chat gets an opening message with what you're working on, a snapshot of the work,
              and how to build its context. It goes into the message box so you can edit it first.
            </p>
          </div>
          <ToggleGroup
            aria-label="New or existing chat"
            value={[mode]}
            onValueChange={(value) => {
              if (value[0] === "new" || value[0] === "existing") setMode(value[0]);
            }}
          >
            <Toggle value="new">New chat</Toggle>
            <Toggle value="existing">Link an open chat</Toggle>
          </ToggleGroup>
          {mode === "new" ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Machine and project</span>
              <Select
                value={projectKey ?? ""}
                onValueChange={(value) => {
                  if (typeof value === "string") setProjectKey(value);
                }}
              >
                <SelectTrigger aria-label="Machine and project" size="sm">
                  <SelectValue>{project?.label ?? "Pick a project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((entry) => (
                    <SelectItem key={entry.key} value={entry.key}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {projects.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  No projects on your connected machines yet.
                </span>
              ) : null}
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Open chat</span>
              <Select
                value={chatKey ?? ""}
                onValueChange={(value) => {
                  if (typeof value === "string") setChatKey(value);
                }}
              >
                <SelectTrigger aria-label="Open chat" size="sm">
                  <SelectValue>{chat?.title ?? "Pick a chat"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {chats.map((entry) => (
                    <SelectItem
                      key={`${entry.environmentId}:${entry.threadId}`}
                      value={`${entry.environmentId}:${entry.threadId}`}
                    >
                      {entry.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              Cancel
            </Button>
            {mode === "new" ? (
              <Button
                size="sm"
                disabled={!project}
                onClick={() => project && props.onStart(project)}
              >
                Start chat
              </Button>
            ) : (
              <Button size="sm" disabled={!chat} onClick={() => chat && props.onLink(chat)}>
                Link and open
              </Button>
            )}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * In a chat's header: where on the Desk the chat came from ("Desk: Precon · Board"). Opens the
 * Desk there. Shown only for chats started or linked from the Desk, and not on the Desk itself.
 */
export function DeskLinkChip(props: { readonly threadRef: ScopedThreadRef }) {
  const notes = useDeskNotes();
  const navigate = useNavigate();
  const onBoard = useRouterState({ select: (state) => state.location.pathname === "/board" });
  const link = notes.notes.links[`${props.threadRef.environmentId}:${props.threadRef.threadId}`];
  if (!link || onBoard) return null;
  return (
    <Button
      variant="outline"
      size="xs"
      className="max-w-64 shrink-0"
      onClick={() => void navigate({ to: "/board", hash: deskFragment(link) })}
    >
      <LayoutDashboardIcon />
      <span className="truncate">Desk: {link.about}</span>
    </Button>
  );
}
