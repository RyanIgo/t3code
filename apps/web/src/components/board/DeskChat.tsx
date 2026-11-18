import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutDashboardIcon, MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { CardChatState } from "./boardCards.logic";
import { type DeskChatContext, contextLabel, deskFragment, deskPlace } from "./deskChat.logic";
import { chatTitle } from "./desk.logic";
import type { DeskChatLink } from "./deskNotes.logic";
import { useDeskNotes } from "./deskNotesStore";
import { type PinChoice, PinMenu } from "./DeskPins";
import { isHostedStaticApp } from "../../hostedPairing";
import { ALL_APPS } from "./deskNotes.logic";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";

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
                      {chatTitle(entry.title)}
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

/** The Desk link for a chat (or a new chat's draft), when it was started or linked from the Desk. */
function useDeskLink(threadRef: ScopedThreadRef): DeskChatLink | null {
  const notes = useDeskNotes();
  return notes.notes.links[`${threadRef.environmentId}:${threadRef.threadId}`] ?? null;
}

function useOpenDesk() {
  const navigate = useNavigate();
  const onBoard = useRouterState({ select: (state) => state.location.pathname === "/board" });
  return (fragment: string) => {
    if (onBoard) window.location.hash = fragment;
    else void navigate({ to: "/board", hash: fragment });
  };
}

/** Breadcrumb steps after the repo for a chat from the Desk: "Sprint 1 / Precon · Plan". */
export function DeskBreadcrumb(props: { readonly threadRef: ScopedThreadRef }) {
  const link = useDeskLink(props.threadRef);
  const openDesk = useOpenDesk();
  if (!link) return null;
  const place = deskPlace(link);
  const steps = [place.sprint, place.info].filter((step) => step !== null);
  return (
    <>
      {steps.map((step) => (
        <span key={step.fragment} className="contents">
          <WorkspaceBreadcrumbItem className="shrink">
            <button
              type="button"
              aria-label={`Open ${step.label} on the Desk`}
              onClick={() => openDesk(step.fragment)}
              className="inline-flex min-w-0 max-w-full cursor-pointer items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <WorkspaceBreadcrumbText className="max-w-48">{step.label}</WorkspaceBreadcrumbText>
            </button>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator>
            <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbSeparator>
        </span>
      ))}
    </>
  );
}

/** In the chat's details panel: what this chat is on, from the Desk, with a way back there. */
export function DeskDetailsSection(props: { readonly threadRef: ScopedThreadRef }) {
  const notes = useDeskNotes();
  const link = useDeskLink(props.threadRef);
  const openDesk = useOpenDesk();
  if (!link) return null;
  const goal =
    link.sprint && link.app ? notes.notes.sprintGoals[link.sprint]?.[link.app]?.text : undefined;
  const rows: Array<readonly [string, string]> = [
    ["App", link.app ?? "All apps"],
    ...(link.sprint ? [["Sprint", link.sprint] as const] : []),
    ...(goal ? [["Sprint goal", goal] as const] : []),
    ...(link.feature ? [["Feature", link.feature.split(" · ").slice(1).join(" · ")] as const] : []),
    ["On", link.about],
  ];
  return (
    <ThreadDetailsSection headingId="thread-details-desk-heading" title="Board">
      <div className="flex flex-col gap-2 px-2.5 text-xs">
        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <Button
          variant="outline"
          size="xs"
          className="self-start"
          onClick={() => openDesk(deskFragment(link))}
        >
          <LayoutDashboardIcon />
          Open on the Desk
        </Button>
      </div>
    </ThreadDetailsSection>
  );
}

/**
 * In a chat's header: where on the Desk the chat came from ("Board: Precon · Plan"). Opens the
 * Desk there. Shown only for chats started or linked from the Desk, and not on the Desk itself.
 */
export function DeskLinkChip(props: { readonly threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const onBoard = useRouterState({ select: (state) => state.location.pathname === "/board" });
  const link = useDeskLink(props.threadRef);
  if (!link || onBoard) return null;
  return (
    <Button
      variant="outline"
      size="xs"
      className="max-w-64 shrink-0"
      onClick={() => void navigate({ to: "/board", hash: deskFragment(link) })}
    >
      <LayoutDashboardIcon />
      <span className="truncate">Board: {link.about}</span>
    </Button>
  );
}

/**
 * In a chat's header (outside the Board, which has its own): pin this chat to Today, an app, its
 * sprint or its item, so it's found on the Board instead of the chat list. Only on the fleet hub.
 */
export function DeskPinButton(props: { readonly threadRef: ScopedThreadRef }) {
  const onBoard = useRouterState({ select: (state) => state.location.pathname === "/board" });
  const notes = useDeskNotes();
  const link = useDeskLink(props.threadRef);
  // App names come from the small notes document (every app has a direction there), so an
  // open chat never loads the Board's whole item list.
  const apps = Object.keys(notes.notes.directions)
    .filter((app) => app !== ALL_APPS)
    .toSorted();
  if (onBoard || !isHostedStaticApp() || apps.length === 0) return null;
  const choices: PinChoice[] = [{ place: { kind: "today" }, label: "Today" }];
  if (link?.itemUrl)
    choices.push({ place: { kind: "item", url: link.itemUrl }, label: `Its item (${link.about})` });
  if (link?.sprint)
    choices.push({
      place: { kind: "sprint", sprint: link.sprint, app: link.app },
      label: `${link.sprint}${link.app ? ` · ${link.app}` : ""}`,
    });
  for (const app of apps) choices.push({ place: { kind: "app", app }, label: app });
  return (
    <PinMenu
      chatKey={`${props.threadRef.environmentId}:${props.threadRef.threadId}`}
      notes={notes.notes}
      choices={choices}
    />
  );
}
