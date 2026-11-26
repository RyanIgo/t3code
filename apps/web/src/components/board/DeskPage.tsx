import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as Schema from "effect/Schema";
import { RefreshCwIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage, writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import type { CardChatState } from "./boardCards.logic";
import { useBoard } from "./boardStore";
import {
  appRepos,
  type AppSummary,
  buildBacklog,
  buildSprintBoard,
  chatsForApp,
  chatsForItem,
  chatStatus,
  currentSprint,
  chatTitle,
  type DeskItem,
  deskRef,
  deskTitle,
  groupWork,
  type ItemSignals,
  ownChats,
  needsWrapUp,
  plannedSprints,
  SPRINT_STATUSES,
  type SprintStatus,
  sprintOverview,
  sprintStatus,
  summarizeApps,
  waitingOnYou,
  type WorkKind,
  wrapUpLeft,
} from "./desk.logic";
import { refreshDesk, setDeskField, useDesk } from "./deskStore";
import {
  ALL_APPS,
  focusedThreads,
  openDecisions,
  plannerTodos,
  type PlannerDecision,
  type PlannerTodo,
  type DeskNotes,
  noteAt,
  type PinPlace,
  PORTFOLIO_DIRECTION,
  type Star,
  starKey,
  untitledTodayChats,
  PUSHED_TO_BOTTOM,
} from "./deskNotes.logic";
import { DirectionPanel } from "./DeskDirection";
import {
  saveChatRole,
  saveDeskFocus,
  saveDeskLink,
  saveDeskPin,
  useDeskNotes,
  saveNextStep,
  savePushBack,
  saveStar,
} from "./deskNotesStore";
import { PinnedStrip } from "./DeskPins";
import { SprintCockpit, TodoPanel } from "./DeskSprintCockpit";
import { TestPage } from "./DeskTest";
import { useDeliverReports } from "./deskReports";
import {
  itemForSheet,
  sheetsForItem,
  testPageUrl,
  uncheckedRows,
  useHubSheets,
} from "./deskSheets";
import { StatusSyncBar } from "./DeskWrapUp";
import { toastManager } from "../ui/toast";
import { chatsToWrapUp, WRAP_ASKED, wrapUpMessage } from "./wrapUp.logic";
import { useSendToChat } from "./deskSend";
import { FeedbackButton, InboxStrip, QuickNoteButton, QuickNoteDialog } from "./DeskInbox";
import { MobileBottomBar, MobileNow, type MobileScreen, MobileSprint } from "./DeskMobile";
import { SidebarWork } from "./SidebarWork";
import { AgentsView, DecisionPanel, PlanPane } from "./DeskAgents";
import { MachinesCard } from "./DeskMachines";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { minuteTickToMs } from "./fleetBoard.logic";
import { DeskCard, openExternal, STAGE_VARIANT } from "./DeskParts";
import { BacklogView } from "./DeskBacklog";
import { AppView, DeskModal, SprintView } from "./DeskViews";
import { collectPrs, type DeskPr } from "./deskPrs.logic";
import { CatchupSection } from "./DeskToday";
import { type Entry, NowView } from "./DeskNow";
import { StoriesView } from "./DeskStories";
import { buildStoryBoard, recentActivity } from "./storyBoard.logic";
import { buildStoryMap, nextSprint } from "./storyMap.logic";
import { changesSince } from "./deskFocus.logic";
import { ChatLauncher, type DeskProjectChoice } from "./DeskChat";
import {
  buildChatPrompt,
  contextLink,
  type DeskChatContext,
  readDeskFragment,
} from "./deskChat.logic";
import type { DraftId } from "../../composerDraftStore";
import type { DeskChatLink } from "./deskNotes.logic";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useComposerDraftStore } from "../../composerDraftStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

/** The Desk's tabs; BoardPage shows them in its one tab bar beside Chats. */
export type DeskTab = "now" | "stories" | "agents" | "machines" | "sprint" | "backlog" | "apps";
const DeskFocusSchema = Schema.NullOr(
  Schema.Struct({
    app: Schema.String,
    feature: Schema.NullOr(Schema.String),
    view: Schema.Literals(["overview", "board", "sprint", "prs"]),
  }),
);
type DeskFocus = NonNullable<typeof DeskFocusSchema.Type>;
const ALL = "*";

/**
 * Fleet fork: the board's planning tabs over one GitHub project. Every card is one work item;
 * its PRs and agent chats are badges on it. Today is for deciding, Sprint for tracking (Status
 * columns), Backlog for choosing what's next, Apps for where each application stands.
 */
const deskUrl = () => `${window.location.origin}/board`;

/** Where a chat started or linked from the Board is pinned: the place it came from, and its app. */
/**
 * Titles each Today chat with the day it was started ("Today · Thu, Nov 19") once its first
 * message has made it a real chat, then remembers that, so renaming it by hand afterwards sticks.
 */
function useDatedTodayChats(notes: DeskNotes, chats: ReadonlyArray<CardChatState>) {
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // Marking a chat titled updates the notes at once, so a rerun finds nothing left to do.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- renames chats on their machines once they exist
  useEffect(() => {
    for (const entry of untitledTodayChats(notes)) {
      const link = notes.links[entry.key];
      const chat = chats.find((each) => `${each.environmentId}:${each.threadId}` === entry.key);
      if (!link || !chat) continue;
      saveDeskLink(entry.key, { ...link, titled: true });
      if (chat.title === entry.title) continue;
      void updateThreadMetadata({
        environmentId: chat.environmentId as EnvironmentId,
        input: { threadId: chat.threadId as ThreadId, title: entry.title },
      });
    }
  }, [notes, chats, updateThreadMetadata]);
}

// Asked in this page's lifetime. The notes poll can bring back a copy saved before the ask
// reached the hub, which would otherwise ask the same chat again.
const wrapUpAsked = new Set<string>();

/**
 * Wrap-up after merge: once a story lead's item has shipped, asks that chat (once) to wrap up,
 * without asking Rigo. Recording the ask as its next step first keeps it from being sent twice.
 */
function useWrapUpNudges(
  notes: DeskNotes,
  chats: ReadonlyArray<CardChatState>,
  items: ReadonlyArray<DeskItem>,
) {
  const sendToChat = useSendToChat();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- messages chats on their machines when their item ships
  useEffect(() => {
    for (const { chat, item } of chatsToWrapUp(notes, chats, items)) {
      const asked = `${chat.threadId} ${item.url}`;
      if (wrapUpAsked.has(asked)) continue;
      wrapUpAsked.add(asked);
      saveNextStep(chat.threadId, `${WRAP_ASKED} of ${deskRef(item) ?? item.title}`);
      void sendToChat(chat, wrapUpMessage(item)).then((sent) => {
        if (sent)
          toastManager.add({
            type: "info",
            title: `Asked "${chatTitle(chat.title)}" to wrap up`,
            description: `${deskRef(item) ?? item.title} has shipped.`,
          });
      });
    }
  }, [notes, chats, items, sendToChat]);
}

function launcherApp(context: DeskChatContext): string | null {
  if (context.kind === "item") return context.item.app;
  return context.kind === "today" || context.kind === "inbox" ? null : context.app;
}

/** Where a chat started from the Desk is pinned: its own place only. App strips are for planners. */
function pinPlacesFor(context: DeskChatContext): PinPlace[] {
  if (context.kind === "today") return [{ kind: "today" }];
  if (context.kind === "inbox") return [];
  if (context.kind === "item")
    return context.item.url ? [{ kind: "item", url: context.item.url }] : [];
  if (context.kind === "sprint") {
    return [{ kind: "sprint", sprint: context.sprint.title, app: context.app }];
  }
  return [{ kind: "app", app: context.app }];
}

export function DeskPage(props: {
  readonly tab: DeskTab;
  readonly onTab: (tab: DeskTab) => void;
  readonly switcher: ReactNode;
  readonly chats: ReadonlyArray<CardChatState>;
  /** Every chat, settled ones too: a pinned chat stays on its strip after it settles. */
  readonly pinnable: ReadonlyArray<CardChatState>;
  readonly projectName: (projectKey: string) => string | null;
  readonly projects: ReadonlyArray<DeskProjectChoice>;
}) {
  // A `#desk=…` link (a chat's Desk chip or its opening message) opens that place. It is read
  // once, before the remembered view loads, and cleared from the address.
  const [deepLink] = useState(() => {
    if (typeof window === "undefined") return null;
    const target = readDeskFragment(window.location.hash);
    if (target === null) return null;
    if (target.kind === "app") {
      writeLocalStorageValue("t3-fleet:desk-app", target.app, ALL, Schema.String);
      writeLocalStorageValue(
        "t3-fleet:desk-focus",
        { app: target.app, feature: target.feature, view: target.view },
        null as DeskFocus | null,
        DeskFocusSchema,
      );
    } else if (target.kind === "sprint") {
      writeLocalStorageValue("t3-fleet:desk-app", target.app ?? ALL, ALL, Schema.String);
    }
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
    return target;
  });
  // The Test page for one sheet, opened by a `#desk=test` link (usually in a tab of its own).
  const [testSheet, setTestSheet] = useState<string | null>(
    deepLink?.kind === "test" ? deepLink.sheet : null,
  );
  const { handleNewThread } = useHandleNewThread();
  const [launcher, setLauncher] = useState<DeskChatContext | null>(null);
  const desk = useDesk();
  const notes = useDeskNotes();
  const sendToChat = useSendToChat();
  const hubSheets = useHubSheets();
  useDatedTodayChats(notes.notes, props.pinnable);
  const board = useBoard();
  const mode = props.tab;
  const setMode = props.onTab;
  const [focus, setFocus] = useLocalStorage(
    "t3-fleet:desk-focus",
    null as DeskFocus | null,
    DeskFocusSchema,
  );
  const [modal, setModal] = useState<{
    readonly itemId: string | null;
    readonly chat: CardChatState | null;
    readonly draft?: {
      readonly draftId: DraftId;
      readonly threadId: ThreadId;
      readonly environmentId: EnvironmentId;
    };
    readonly sequence: ReadonlyArray<string>;
    /** Opened from a pull request (shown first in the window). */
    readonly pr?: DeskPr;
    /** Set by a deep link before the Desk's data loads; resolved to the item once it has. */
    readonly itemUrl?: string;
    /** The item window's tab to open on, instead of the one its column suggests. */
    readonly tab?: "details" | "chats" | "review";
    /** The window this one was opened from (a planning session), for a way back to it. */
    readonly back?: { readonly chat: CardChatState; readonly label: string };
  } | null>(
    deepLink?.kind === "item"
      ? {
          itemId: null,
          chat: null,
          sequence: [],
          itemUrl: deepLink.url,
          ...(deepLink.tab ? { tab: deepLink.tab } : {}),
        }
      : null,
  );
  const [chosenSprint, setChosenSprint] = useState<string | null>(
    deepLink?.kind === "sprint" ? deepLink.sprint : null,
  );
  const [storedApp, setStoredApp] = useLocalStorage("t3-fleet:desk-app", ALL, Schema.String);
  // When the user last said they were caught up; 0 means never (then: the last 8 hours).
  const [caughtUp, setCaughtUp] = useLocalStorage("t3-fleet:caught-up", 0, Schema.Number);
  const [query, setQuery] = useState("");
  // An app's Sprint tab opens on its sprint page; the status columns stay one click away.
  const [statusBoard, setStatusBoard] = useState(false);
  // Fleet fork: on a phone the Board is three screens (Now, Work, Sprint) and a bottom bar.
  const phone = useMediaQuery("max-sm");
  const [phoneWork, setPhoneWork] = useState(false);
  const [phoneNote, setPhoneNote] = useState(false);
  const [kind, setKind] = useState<WorkKind | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const view = desk.view;
  const apps = view?.apps ?? [];
  const app = apps.includes(storedApp) ? storedApp : null;
  const items = view?.items ?? [];
  const nowMs = minuteTickToMs(useNowMinute());
  const sprint = currentSprint(view?.sprints ?? [], nowMs);
  useDeliverReports(notes.notes, items, props.pinnable, nowMs);
  useWrapUpNudges(notes.notes, props.pinnable, items);
  // A Desk link followed while already here (e.g. from a chat in the work window) only changes
  // the fragment; apply it the same way and clear it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for `#desk=…` fragment changes in the browser's address
  useEffect(() => {
    const onHashChange = () => {
      const target = readDeskFragment(window.location.hash);
      if (target === null) return;
      if (target.kind === "test") {
        setTestSheet(target.sheet);
      } else if (target.kind === "today") {
        setMode("now");
      } else if (target.kind === "item") {
        setModal({
          itemId: null,
          chat: null,
          sequence: [],
          itemUrl: target.url,
          ...(target.tab ? { tab: target.tab } : {}),
        });
      } else if (target.kind === "sprint") {
        setMode("sprint");
        setChosenSprint(target.sprint);
        setStoredApp(target.app ?? ALL);
      } else {
        setStoredApp(target.app);
        setFocus({ app: target.app, feature: target.feature, view: target.view });
        setMode(
          target.view === "board" || target.view === "sprint"
            ? "sprint"
            : target.view === "prs"
              ? "now"
              : "apps",
        );
      }
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [setMode, setFocus, setStoredApp]);
  const linksByChat = new Map<string, string[]>();
  for (const card of board.document.cards) {
    for (const ref of card.chats) {
      linksByChat.set(
        `${ref.environmentId}:${ref.threadId}`,
        card.links.map((link) => link.url),
      );
    }
  }
  const chatLinks = notes.notes.links;
  const linkedChats = (keep: (link: DeskChatLink) => boolean) =>
    props.chats.filter((chat) => {
      const link = chatLinks[`${chat.environmentId}:${chat.threadId}`];
      return link !== undefined && keep(link);
    });
  const withLinked = (base: ReadonlyArray<CardChatState>, linked: ReadonlyArray<CardChatState>) => {
    const seen = new Set(base.map((chat) => `${chat.environmentId}:${chat.threadId}`));
    return [
      ...base,
      ...linked.filter((chat) => !seen.has(`${chat.environmentId}:${chat.threadId}`)),
    ];
  };
  const chatRepo = (chat: CardChatState) =>
    chat.projectKey ? (props.projectName(chat.projectKey)?.split("/").pop() ?? null) : null;
  const chatsFor = (item: DeskItem) =>
    withLinked(
      chatsForItem(item, props.chats, linksByChat, {
        focused: focusedThreads(notes.notes, item.url),
        repoOf: chatRepo,
      }),
      linkedChats((link) => link.itemUrl !== null && link.itemUrl === item.url),
    );
  const appThreads = (name: string) =>
    withLinked(
      chatsForApp(props.chats, appRepos(items, name), props.projectName),
      linkedChats((link) => link.app === name),
    );
  // Chats open in the Desk's work window (with their item, when one matches) so the Desk stays put.
  const openChat = (chat: CardChatState) => {
    const key = `${chat.environmentId}:${chat.threadId}`;
    const owner = items.find((entry) =>
      chatsFor(entry).some((found) => `${found.environmentId}:${found.threadId}` === key),
    );
    setModal({ itemId: owner?.itemId ?? null, chat, sequence: [] });
  };
  // A planner's question opens its planning session, where it can be answered in context.
  // A decision opens as its card in a side panel; the chat that asked is one click from there.
  const [decisionShown, setDecisionShown] = useState<string | null>(null);
  const openDecision = (decision: PlannerDecision) => setDecisionShown(decision.id);
  // A planner's to-do opens as its steps in a side panel, found again by its planner and text.
  const [todoShown, setTodoShown] = useState<{ threadId: string; text: string } | null>(null);
  const openTodo = (todo: PlannerTodo) =>
    setTodoShown({ threadId: todo.threadId, text: todo.line.text });
  const openItemIn = (sequence: ReadonlyArray<string>) => (entry: DeskItem) =>
    setModal({ itemId: entry.itemId, chat: null, sequence });

  const header = (
    <WorkspacePageHeader electron={isElectron} className="border-b border-border">
      {props.switcher}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {desk.error ??
          view?.error ??
          (view?.syncedAt
            ? `From GitHub · synced ${new Date(view.syncedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}`
            : "")}
      </span>
      {view?.configured ? (
        <FeedbackButton
          apps={view.apps ?? []}
          context={() =>
            [
              `the Board's ${mode.charAt(0).toUpperCase()}${mode.slice(1)} tab`,
              app && mode !== "now" && mode !== "agents" && mode !== "machines"
                ? `app ${app}`
                : null,
              typeof window === "undefined" ? null : window.location.hash || null,
            ]
              .filter(Boolean)
              .join(" · ")
          }
        />
      ) : null}
      {view?.configured ? <QuickNoteButton apps={view.apps ?? []} /> : null}
      {view?.configured ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={desk.loading}
          onClick={() => void refreshDesk()}
        >
          <RefreshCwIcon />
          Refresh
        </Button>
      ) : null}
    </WorkspacePageHeader>
  );

  const frame = (body: ReactNode) => (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {header}
        {body}
      </div>
    </SidebarInset>
  );

  if (!desk.onHub || (view && !view.configured)) {
    return frame(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {desk.onHub ? "Connect the Desk to GitHub" : "The Desk lives on the hub"}
          </EmptyTitle>
          <EmptyDescription>
            {desk.onHub
              ? "Give the hub a GitHub token and the project to read (see fleet/README.md, Dev Desk)."
              : "Open the fleet hub's address to see your development work here."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
  }
  if (!view) {
    return frame(
      <p className="p-6 text-sm text-muted-foreground">
        {desk.error ?? "Loading your work from GitHub…"}
      </p>,
    );
  }

  // One app filter for every tab; on Apps it picks the app page.

  // Dropping a card in a Sprint column sets its Status on GitHub.
  const onDragEnd = (event: DragEndEvent) => {
    const status = event.over?.data.current?.status as SprintStatus | undefined;
    const item = items.find((entry) => entry.itemId === event.active.id);
    if (!item || !status || sprintStatus(item, signalsFor(item)) === status) return;
    void setDeskField(item.itemId, "Status", status);
    // Done only sticks when nothing is left; otherwise show what's left to wrap up.
    if (
      status === "Done" &&
      wrapUpLeft({ ...item, state: "closed" }, signalsFor(item)).length > 0
    ) {
      setModal({ itemId: item.itemId, chat: null, sequence: [], tab: "details" });
    }
  };

  const startChat = async (context: DeskChatContext, project: DeskProjectChoice) => {
    const prompt = buildChatPrompt({
      context,
      items,
      notes: notes.notes,
      sprint,
      deskUrl: deskUrl(),
    });
    setLauncher(null);
    const created = await handleNewThread(project.ref, { prompt, navigate: false });
    if (created) {
      const key = `${project.ref.environmentId}:${created.threadId}`;
      if (context.kind === "today") {
        // Earlier days' chats leave the Today strip; they keep their dated titles in the sidebar.
        for (const [other, link] of Object.entries(notes.notes.links)) {
          if (link.kind === "today" && notes.notes.pins.today?.[other]?.pinned) {
            saveDeskPin({ kind: "today" }, other, false);
          }
        }
      }
      if (context.kind !== "inbox") saveDeskLink(key, contextLink(context, sprint));
      // A chat started from the Desk takes the level of where it started.
      if (context.kind === "app" || context.kind === "sprint") {
        saveChatRole(created.threadId, "planner", { app: context.app });
      } else if (context.kind === "today") {
        saveChatRole(created.threadId, "today");
      } else if (context.kind === "inbox") {
        saveChatRole(created.threadId, "helper");
      }
      if (context.kind === "item" && context.item.url) {
        saveDeskFocus(context.item.url, created.threadId);
      }
      for (const place of pinPlacesFor(context)) {
        saveDeskPin(place, key, true, context.kind === "today" ? "planner" : undefined);
      }
      setModal({
        itemId: context.kind === "item" ? context.item.itemId : null,
        chat: null,
        draft: { ...created, environmentId: project.ref.environmentId },
        sequence: [],
      });
    }
  };
  const linkChat = (context: DeskChatContext, chat: CardChatState) => {
    const ref = scopeThreadRef(chat.environmentId as EnvironmentId, chat.threadId as ThreadId);
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(ref)?.prompt ?? "";
    const prompt = buildChatPrompt({
      context,
      items,
      notes: notes.notes,
      sprint,
      deskUrl: deskUrl(),
    });
    store.setPrompt(ref, existing.trim() ? `${existing}\n\n${prompt}` : prompt);
    saveDeskLink(`${chat.environmentId}:${chat.threadId}`, contextLink(context, sprint));
    if (context.kind === "item" && context.item.url) saveDeskFocus(context.item.url, chat.threadId);
    for (const place of pinPlacesFor(context)) {
      saveDeskPin(place, `${chat.environmentId}:${chat.threadId}`, true);
    }
    setLauncher(null);
    // A chat he just started shows itself; everything else opens on a screen.
    setModal({
      itemId: context.kind === "item" ? context.item.itemId : null,
      chat,
      sequence: [],
      tab: "chats",
    });
  };

  const prs = collectPrs(items, props.chats);
  const prFor = (item: DeskItem) =>
    prs.find(
      (pr) =>
        pr.item?.itemId === item.itemId || item.pullRequests.some((link) => link.url === pr.url),
    ) ?? null;
  const card = (
    item: DeskItem,
    draggable: boolean,
    sequence: ReadonlyArray<string> = [],
    action?: ReactNode,
  ) => (
    <DeskCard
      key={item.itemId}
      item={item}
      chats={chatsFor(item)}
      pr={prFor(item)}
      draggable={draggable}
      showApp={app === null}
      currentSprint={sprint?.title ?? null}
      action={action}
      wrapUp={needsWrapUp(item, signalsFor(item))}
      onOpenChat={openChat}
      onOpen={openItemIn(sequence)}
    />
  );
  const ids = (list: ReadonlyArray<DeskItem>) => list.map((entry) => entry.itemId);
  const ownChatsOf = (entry: DeskItem) =>
    ownChats(entry, props.chats, {
      focused: focusedThreads(notes.notes, entry.url),
      linked: new Set(
        Object.entries(notes.notes.links)
          .filter(([, link]) => link.itemUrl !== null && link.itemUrl === entry.url)
          .map(([key]) => key),
      ),
      repoOf: chatRepo,
    });
  const signalsFor = (entry: DeskItem): ItemSignals => {
    // Only the item's own chats move its card or hold up its wrap-up.
    const chats = ownChatsOf(entry);
    const sheet = sheetsForItem(hubSheets, entry, notes.notes)[0];
    return {
      chats,
      focused: focusedThreads(notes.notes, entry.url).size > 0,
      sheet: sheet
        ? {
            unchecked: uncheckedRows(sheet.counts),
            failed: sheet.counts.fail + sheet.counts.blocked,
            retest: sheet.counts.retest ?? 0,
          }
        : null,
    };
  };
  // The PR shows first, with its own item (or the issue it closes) and its chat beside it.
  const openPr = (pr: DeskPr) =>
    setModal({
      // The issue the PR closes carries the plan (story, sprint, lane); the PR's own item doesn't.
      itemId:
        items.find((entry) => entry.pullRequests.some((link) => link.url === pr.url))?.itemId ??
        pr.item?.itemId ??
        null,
      chat: pr.chats[0] ?? null,
      sequence: [],
      pr,
    });
  const modalItem = modal?.itemId
    ? (items.find((entry) => entry.itemId === modal.itemId) ?? null)
    : modal?.itemUrl
      ? (items.find((entry) => entry.url === modal.itemUrl) ?? null)
      : null;
  const sprintShown = view.sprints?.find((entry) => entry.title === chosenSprint) ?? sprint;
  const focusApp =
    mode === "apps" && app !== null
      ? { app, feature: focus?.app === app ? focus.feature : null }
      : null;

  const upcoming = plannedSprints(view.sprints ?? [], nowMs);
  const planned = new Set(upcoming.map((entry) => entry.title));

  // The app's planner for the shown sprint: one recorded for this sprint first, else the newest.
  const plannerOf = (name: string): CardChatState | null => {
    const recorded = Object.entries(notes.notes.work)
      .filter(([, work]) => work.role === "planner" && work.app === name)
      .toSorted(
        ([, a], [, b]) =>
          Number(b.sprint === sprintShown?.title) - Number(a.sprint === sprintShown?.title) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
    for (const [threadId] of recorded) {
      const chat = props.pinnable.find((entry) => entry.threadId === threadId);
      if (chat) return chat;
    }
    const pinned = Object.entries(notes.notes.pins[`app:${name}`] ?? {}).find(
      ([, pin]) => pin.pinned && pin.role === "planner",
    )?.[0];
    return (
      props.pinnable.find((entry) => `${entry.environmentId}:${entry.threadId}` === pinned) ?? null
    );
  };
  // A star: "a user is about to be in this area", so its stories go first for a few days. Its
  // planner is told so the work is ready in time.
  const starArea = (star: Omit<Star, "until" | "updatedAt">, days: number | null) => {
    const wasOn = notes.notes.stars[starKey(star.app, star.feature)];
    const until = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
    saveStar(star, until);
    const area = star.feature ? `the ${star.feature} area` : `all of ${star.app}`;
    const when = until
      ? new Date(until).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      : null;
    const planner = plannerOf(star.app);
    // A new star or a new end date tells the planner; editing only the reason sends that.
    if (planner)
      void sendToChat(
        planner,
        until
          ? wasOn && Date.parse(wasOn.until) > Date.now()
            ? `★ Focus on ${area} (until ${when}): ${star.reason || "no reason given"}.`
            : `★ Focus: I starred ${area} until ${when}${star.reason ? `: ${star.reason}` : ""}. Do this area's stories first: get their sheets ready and tell me in a line if anything there can't be ready in time.`
          : `★ Focus off: ${area} is no longer starred. Back to your usual order.`,
      );
    toastManager.add({
      type: "success",
      title: until ? `★ ${star.feature ?? star.app} starred until ${when}` : "Star taken off",
      description: planner ? `${star.app}'s planner was told.` : undefined,
    });
  };
  // Push back: "not my priority right now". The row moves to the bottom of his queue (no date)
  // until he moves it up; its planner is told so it stops nudging and re-plans around it.
  const pushBack = (entry: Entry, pushed: boolean) => {
    savePushBack(entry.key, pushed ? PUSHED_TO_BOTTOM : null, entry.title);
    const planner = plannerOf(entry.app);
    if (planner)
      void sendToChat(
        planner,
        pushed
          ? `Pushed to the bottom of my queue: "${entry.title}" (${entry.badge}). Not my priority right now: keep it, don't nudge me about it, re-plan around it, and say in one line if that moves anything.`
          : `Moved back up: "${entry.title}" (${entry.badge}) is in my queue's order again.`,
      );
    toastManager.add({
      type: "success",
      title: pushed ? "Moved to the bottom of your queue" : "Moved back up",
      description: planner ? `${entry.app}'s planner was told.` : entry.title,
    });
  };
  const sprintPanel = () => {
    if (!sprintShown) {
      return <p className="p-6 text-sm text-muted-foreground">The project has no sprints yet.</p>;
    }
    if (app && !statusBoard) {
      return (
        <SprintCockpit
          app={app}
          sprint={sprintShown}
          nowMs={nowMs}
          items={items}
          notes={notes.notes}
          prs={prs}
          signalsFor={signalsFor}
          chatsFor={ownChatsOf}
          relatedChatsFor={(entry) =>
            chatsForItem(entry, props.pinnable, linksByChat, {
              focused: focusedThreads(notes.notes, entry.url),
              repoOf: chatRepo,
            })
          }
          planner={plannerOf(app)}
          onOpenItem={openItemIn([])}
          onOpenPr={openPr}
          onOpenChat={openChat}
          onStartChat={(entry) => setLauncher({ kind: "item", item: entry })}
          onStartPlanner={() => setLauncher({ kind: "sprint", sprint: sprintShown, app })}
          onShowBoard={() => setStatusBoard(true)}
          apps={apps}
          sprints={plannedSprints(view.sprints ?? [], nowMs).map((entry) => entry.title)}
          chats={props.chats}
          plannerFor={plannerOf}
          onSortInbox={() =>
            setLauncher({
              kind: "inbox",
              count: Object.values(notes.notes.inbox).filter((note) => note.state === "new").length,
            })
          }
        />
      );
    }
    const board = buildSprintBoard(items, sprintShown, { app, query }, signalsFor);
    // Where GitHub's Status lags the board; updated together once Rigo approves the list.
    const behind = SPRINT_STATUSES.flatMap((status) =>
      board[status].flatMap((entry) =>
        entry.kind !== "pr" &&
        (entry.status ?? "Todo") !== status &&
        // A closed item waiting to be wrapped up keeps Done on GitHub.
        !needsWrapUp(entry, signalsFor(entry))
          ? [{ entry, status }]
          : [],
      ),
    );
    // Previous / next steps through what's still moving; a Done card opens on its own.
    const sequence = SPRINT_STATUSES.filter((status) => status !== "Done").flatMap((status) =>
      ids(board[status]),
    );
    return (
      <>
        {app && statusBoard ? (
          <div className="px-4 pt-2">
            <Button size="xs" variant="outline" onClick={() => setStatusBoard(false)}>
              ← Back to the sprint page
            </Button>
          </div>
        ) : null}
        <SprintView
          view={view}
          sprint={sprintShown}
          nowMs={nowMs}
          notes={notes.notes}
          app={app}
          onSprint={setChosenSprint}
          onChat={() => setLauncher({ kind: "sprint", sprint: sprintShown, app })}
          pinned={
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {app ? (
                <PinnedStrip
                  framed
                  title={`Planning: ${app}`}
                  hint="Whole-app chats, such as the planner"
                  place={{ kind: "app", app }}
                  notes={notes.notes}
                  chats={props.pinnable}
                  onOpenChat={openChat}
                  empty={`Nothing pinned to ${app} yet. Pin the app's planner chat to see it here.`}
                />
              ) : null}
              <PinnedStrip
                framed
                title={`${sprintShown.title}${app ? ` · ${app}` : ""}`}
                hint="This sprint's work: development, bug fixes, features"
                place={{ kind: "sprint", sprint: sprintShown.title, app }}
                notes={notes.notes}
                chats={props.pinnable}
                onOpenChat={openChat}
                empty={`Nothing pinned to this sprint yet. Use Chat about this sprint, or Pin on a chat.`}
              />
            </div>
          }
          board={
            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              {behind.length > 0 ? (
                <StatusSyncBar
                  changes={behind.map(({ entry, status }) => ({
                    itemId: entry.itemId,
                    label: `${deskRef(entry) ?? "item"} ${deskTitle(entry)}`,
                    from: entry.status ?? "Todo",
                    to: status,
                  }))}
                />
              ) : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {SPRINT_STATUSES.map((status) => (
                  <StatusColumn key={status} status={status} count={board[status].length}>
                    {board[status].map((entry) => card(entry, true, sequence))}
                  </StatusColumn>
                ))}
              </div>
            </DndContext>
          }
        />
      </>
    );
  };

  const appSequence = focusApp
    ? (() => {
        const work = groupWork(
          items,
          (entry) =>
            entry.app === focusApp.app &&
            (focusApp.feature === null || entry.feature === focusApp.feature),
          sprint,
        );
        return ids(
          [...work.sprint, ...work.blocked, ...work.open].filter(
            (entry) => entry.state === "open" || entry.state === "draft",
          ),
        );
      })()
    : [];
  const summaries = summarizeApps(items, app ? [app] : apps, sprint);

  const caughtUpAt = caughtUp > 0 ? caughtUp : nowMs - 8 * 3_600_000;
  const repoOf = (chat: CardChatState) =>
    chat.projectKey ? (props.projectName(chat.projectKey)?.split("/").pop() ?? null) : null;
  // A repo belongs to the app that owns most of its items (claude-setup is Dev platform's).
  const repoCounts = new Map<string, Map<string, number>>();
  for (const entry of items) {
    if (!entry.repo || !entry.app) continue;
    const repo = entry.repo.split("/").pop() ?? entry.repo;
    const byApp = repoCounts.get(repo) ?? new Map<string, number>();
    byApp.set(entry.app, (byApp.get(entry.app) ?? 0) + 1);
    repoCounts.set(repo, byApp);
  }
  const repoApp = new Map(
    [...repoCounts].map(([repo, byApp]) => [
      repo,
      [...byApp].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? repo,
    ]),
  );
  const appOf = (chat: CardChatState) => {
    const repo = repoOf(chat);
    return repo ? (repoApp.get(repo) ?? repo) : null;
  };
  // A planner or sprint chat opened on its own shows the roster of its app's sprint above it.
  const rosterFor = (chat: CardChatState | null) => {
    if (!chat || modalItem) return null;
    const link = notes.notes.links[`${chat.environmentId}:${chat.threadId}`];
    const plannerOf = Object.entries(notes.notes.pins).find(
      ([place, pins]) =>
        place.startsWith("app:") &&
        pins[`${chat.environmentId}:${chat.threadId}`]?.role === "planner",
    )?.[0];
    const rosterApp =
      link && (link.kind === "sprint" || link.kind === "app")
        ? link.app
        : plannerOf
          ? plannerOf.slice("app:".length)
          : null;
    const rosterSprint =
      view.sprints?.find((entry) => entry.title === link?.sprint) ?? sprint ?? null;
    if (!rosterApp || !rosterSprint) return null;
    return (
      <PlanPane
        app={rosterApp}
        sprint={rosterSprint}
        goal={notes.notes.sprintGoals[rosterSprint.title]?.[rosterApp]?.text ?? null}
        nowMs={nowMs}
        items={items}
        chatsFor={ownChatsOf}
        signalsFor={signalsFor}
        onOpenItem={(entry) =>
          setModal({
            itemId: entry.itemId,
            chat: null,
            sequence: [],
            back: { chat, label: `${rosterApp} planning` },
          })
        }
        onStartChat={(entry) => setLauncher({ kind: "item", item: entry })}
        prs={prs}
        onOpenPr={openPr}
        planner={chat}
        notes={notes.notes}
        relatedChatsFor={(entry) =>
          // Settled chats too: their history is what a decision builds on.
          chatsForItem(entry, props.pinnable, linksByChat, {
            focused: focusedThreads(notes.notes, entry.url),
            repoOf: chatRepo,
          })
        }
        onOpenChat={(other) =>
          setModal({
            itemId: null,
            chat: other,
            sequence: [],
            back: { chat, label: `${rosterApp} planning` },
          })
        }
      />
    );
  };
  const overlays = (
    <>
      {modal && (modal.itemUrl === undefined || modalItem) ? (
        <DeskModal
          key={`${modal.itemId ?? ""}:${modal.chat?.threadId ?? ""}:${modal.pr?.url ?? ""}:${modal.draft?.draftId ?? ""}`}
          item={modalItem}
          pr={modal.pr ?? null}
          chat={modal.chat}
          allChats={props.pinnable}
          ownChats={modalItem ? ownChatsOf(modalItem) : []}
          back={
            modal.back
              ? {
                  label: modal.back.label,
                  onBack: () =>
                    modal.back && setModal({ itemId: null, chat: modal.back.chat, sequence: [] }),
                }
              : null
          }
          tab={modal.tab}
          roster={rosterFor(modal.chat)}
          chats={
            modalItem
              ? withLinked(chatsFor(modalItem), modal.pr?.chats ?? [])
              : modal.pr
                ? modal.pr.chats
                : modal.chat
                  ? [modal.chat]
                  : []
          }
          draft={modal.draft ?? null}
          view={view}
          sequence={modal.sequence}
          onNavigate={(itemId) => setModal({ itemId, chat: null, sequence: modal.sequence })}
          onOpenItem={(entry) =>
            setModal({ itemId: entry.itemId, chat: null, sequence: modal.sequence })
          }
          onClose={() => setModal(null)}
          onChat={(entry) => setLauncher({ kind: "item", item: entry })}
          onStartTest={(sheetId) => {
            setModal(null);
            setTestSheet(sheetId);
          }}
        />
      ) : null}
      {(() => {
        const decision = decisionShown ? (notes.notes.decisions[decisionShown] ?? null) : null;
        return (
          <DecisionPanel
            decision={decision}
            asker={
              decision
                ? (props.pinnable.find((entry) => entry.threadId === decision.threadId) ?? null)
                : null
            }
            items={items}
            chatsFor={(entry) =>
              chatsForItem(entry, props.pinnable, linksByChat, {
                focused: focusedThreads(notes.notes, entry.url),
                repoOf: chatRepo,
              })
            }
            notes={notes.notes}
            nowMs={nowMs}
            onOpenChat={(chat) => {
              setDecisionShown(null);
              setModal({ itemId: null, chat, sequence: [] });
            }}
            onClose={() => setDecisionShown(null)}
          />
        );
      })()}
      {(() => {
        const todo = todoShown
          ? (plannerTodos(notes.notes).find(
              (entry) =>
                entry.threadId === todoShown.threadId && entry.line.text === todoShown.text,
            ) ?? null)
          : null;
        return (
          <TodoPanel
            todo={todo}
            planner={
              todo
                ? (props.pinnable.find((entry) => entry.threadId === todo.threadId) ?? null)
                : null
            }
            items={items}
            prs={prs}
            notes={notes.notes}
            nowMs={nowMs}
            chatsFor={(entry) =>
              chatsForItem(entry, props.pinnable, linksByChat, {
                focused: focusedThreads(notes.notes, entry.url),
                repoOf: chatRepo,
              })
            }
            onOpenChat={(chat) => {
              setTodoShown(null);
              setModal({ itemId: null, chat, sequence: [] });
            }}
            onOpenPr={(pr) => {
              setTodoShown(null);
              openPr(pr);
            }}
            onOpenItem={(entry) => {
              setTodoShown(null);
              openItemIn([])(entry);
            }}
            onClose={() => setTodoShown(null)}
          />
        );
      })()}
      {launcher ? (
        <ChatLauncher
          context={launcher}
          projects={props.projects}
          appRepos={appRepos(items, launcherApp(launcher) ?? "")}
          chats={props.chats}
          appChats={
            new Set(
              (launcherApp(launcher) ? appThreads(launcherApp(launcher) ?? "") : []).map(
                (chat) => `${chat.environmentId}:${chat.threadId}`,
              ),
            )
          }
          onStart={(project) => void startChat(launcher, project)}
          onLink={(chat) => linkChat(launcher, chat)}
          onClose={() => setLauncher(null)}
        />
      ) : null}
    </>
  );

  if (testSheet) {
    const shownSheet = hubSheets.find((entry) => entry.id === testSheet) ?? null;
    const sheetItem = shownSheet ? itemForSheet(shownSheet, items, notes.notes) : null;
    const sheetChat =
      (shownSheet?.thread
        ? props.pinnable.find((entry) => entry.threadId === shownSheet.thread?.threadId)
        : undefined) ??
      (sheetItem ? ownChatsOf(sheetItem)[0] : undefined) ??
      null;
    const sheetRepo = shownSheet
      ? [...repoApp.keys()].find((repo) => shownSheet.title.includes(repo))
      : undefined;
    const sheetAppName = sheetItem?.app ?? (sheetRepo ? repoApp.get(sheetRepo) : undefined);
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <TestPage
          sheetId={testSheet}
          sheet={shownSheet}
          item={sheetItem}
          chat={sheetChat}
          chats={props.pinnable}
          planner={sheetAppName ? plannerOf(sheetAppName) : null}
          notes={notes.notes}
          onBack={() => setTestSheet(null)}
        />
      </SidebarInset>
    );
  }
  if (phone && (phoneWork || mode === "now" || mode === "sprint")) {
    const screen: MobileScreen = phoneWork ? "work" : mode === "sprint" ? "sprint" : "now";
    const shownSprint = view.sprints?.find((entry) => entry.title === chosenSprint) ?? sprint;
    const day = 86_400_000;
    const daysLeft = shownSprint
      ? Math.max(
          0,
          Math.ceil((Date.parse(shownSprint.startDate) + shownSprint.duration * day - nowMs) / day),
        )
      : 0;
    const body =
      screen === "work" ? (
        <SidebarWork />
      ) : screen === "sprint" ? (
        shownSprint ? (
          <MobileSprint
            apps={apps}
            app={app}
            onApp={(next) => setStoredApp(next ?? ALL)}
            heading={`${shownSprint.title} · ${daysLeft} days left`}
            goal={app ? (notes.notes.sprintGoals[shownSprint.title]?.[app]?.text ?? null) : null}
            board={buildSprintBoard(items, shownSprint, { app, query: "" }, signalsFor)}
            chatsFor={chatsFor}
            signalsFor={signalsFor}
            onOpenItem={openItemIn([])}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">The project has no sprints yet.</p>
        )
      ) : (
        <MobileNow
          nowMs={nowMs}
          chats={props.chats}
          waiting={waitingOnYou(items)}
          prs={prs}
          apps={apps}
          appOf={appOf}
          notes={notes.notes}
          items={items}
          sprints={plannedSprints(view.sprints ?? [], nowMs).map((entry) => entry.title)}
          currentSprint={sprint?.title ?? null}
          onStartChat={(entry) => setLauncher({ kind: "item", item: entry })}
          onOpenChat={openChat}
          onOpenItem={openItemIn([])}
          onOpenPr={openPr}
          decisions={openDecisions(notes.notes)}
          onOpenDecision={openDecision}
          todos={plannerTodos(notes.notes)}
          onOpenTodo={openTodo}
          // Always the sheet that was pressed: an item's Review tab shows its newest sheet, so
          // several sheets on one story all opened the same screen.
          onOpenSheet={(sheet) => setTestSheet(sheet.id)}
        />
      );
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <WorkspacePageHeader electron={isElectron} className="border-b border-border">
            <span className="min-w-0 flex-1 truncate text-base font-semibold">
              {screen === "work" ? "Work" : screen === "sprint" ? "Sprint" : "Now"}
            </span>
            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="xs" />}>More</MenuTrigger>
              <MenuPopup align="end">
                {(
                  [
                    ["agents", "Agents"],
                    ["machines", "Machines"],
                    ["backlog", "Backlog"],
                    ["apps", "Apps"],
                  ] as const
                ).map(([id, label]) => (
                  <MenuItem
                    key={id}
                    onClick={() => {
                      setPhoneWork(false);
                      setMode(id);
                    }}
                  >
                    {label}
                  </MenuItem>
                ))}
                <MenuItem onClick={() => void refreshDesk()}>Refresh from GitHub</MenuItem>
              </MenuPopup>
            </Menu>
          </WorkspacePageHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
          <MobileBottomBar
            active={screen}
            onScreen={(next) => {
              setPhoneWork(next === "work");
              if (next !== "work") setMode(next);
            }}
            onNote={() => setPhoneNote(true)}
          />
        </div>
        {phoneNote ? <QuickNoteDialog apps={apps} onClose={() => setPhoneNote(false)} /> : null}
        {overlays}
      </SidebarInset>
    );
  }

  return frame(
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
        <div className={mode === "now" || mode === "machines" ? "hidden" : "w-64 max-w-full"}>
          <Select
            value={app ?? ALL}
            onValueChange={(value) => {
              if (typeof value === "string") setStoredApp(value);
            }}
          >
            <SelectTrigger aria-label="Application" size="sm">
              <SelectValue>{app ?? "All applications"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={ALL}>All applications</SelectItem>
              {apps.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        {mode === "sprint" || mode === "backlog" ? (
          <div className="w-56 max-w-full">
            <Input
              size="sm"
              type="search"
              aria-label="Search work"
              placeholder="Search work…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}
      </div>
      {overlays}
      {mode === "now" ? (
        <NowView
          onPushBack={pushBack}
          nowMs={nowMs}
          chats={props.chats}
          waiting={waitingOnYou(items)}
          prs={prs}
          apps={apps}
          appOf={appOf}
          items={items}
          pinned={
            <div className="flex flex-col gap-3">
              <InboxStrip
                notes={notes.notes}
                items={items}
                apps={apps}
                sprints={plannedSprints(view.sprints ?? [], nowMs).map((entry) => entry.title)}
                chats={props.chats}
                onOpenChat={openChat}
                onStartChat={(entry) => setLauncher({ kind: "item", item: entry })}
                currentSprint={sprint?.title ?? null}
                plannerFor={plannerOf}
                onSort={() =>
                  setLauncher({
                    kind: "inbox",
                    count: Object.values(notes.notes.inbox).filter((note) => note.state === "new")
                      .length,
                  })
                }
              />
              <PinnedStrip
                place={{ kind: "today" }}
                notes={notes.notes}
                chats={props.pinnable}
                onOpenChat={openChat}
              />
            </div>
          }
          done={
            <CatchupSection
              catchup={changesSince(caughtUpAt, items, props.chats)}
              caughtUpAt={caughtUpAt}
              onCaughtUp={() => setCaughtUp(Date.now())}
              onOpenItem={openItemIn([])}
            />
          }
          notes={notes.notes}
          onOpenChat={openChat}
          onOpenItem={openItemIn(ids(waitingOnYou(items)))}
          onOpenPr={openPr}
          decisions={openDecisions(notes.notes)}
          onOpenDecision={openDecision}
          todos={plannerTodos(notes.notes)}
          onOpenTodo={openTodo}
          onOpenSheet={(sheet) => openExternal(testPageUrl(sheet.id))}
        />
      ) : mode === "stories" ? (
        <StoriesView
          cards={buildStoryBoard({
            items,
            prs,
            sheets: hubSheets,
            notes: notes.notes,
            chats: props.chats,
            decisions: openDecisions(notes.notes),
            answered: Object.values(notes.notes.decisions).filter((entry) => entry.answer !== null),
            sprint: sprint?.title ?? null,
            nowMs,
            appOfSheet: (sheet) => {
              const chat = props.chats.find((entry) => entry.threadId === sheet.thread?.threadId);
              return (chat ? appOf(chat) : null) ?? "Other";
            },
          }).map((card) =>
            // An item with no App field belongs to the app that owns most of its repo.
            card.app || !card.item?.repo
              ? card
              : { ...card, app: repoApp.get(card.item.repo.split("/").pop() ?? "") ?? null },
          )}
          activity={recentActivity(notes.notes, props.chats, nowMs)}
          sprintNames={{
            now: sprint?.title ?? null,
            next: nextSprint(view.sprints ?? [], sprint)?.title ?? null,
          }}
          onOpenItem={openItemIn([])}
          mapFor={(forApp, moves) =>
            buildStoryMap({
              items,
              notes: notes.notes,
              chats: props.chats,
              app: forApp,
              current: sprint,
              next: nextSprint(view.sprints ?? [], sprint),
              nowMs,
              moves,
              appOfItem: (entry) =>
                entry.repo ? (repoApp.get(entry.repo.split("/").pop() ?? "") ?? null) : null,
            })
          }
          nowMs={nowMs}
          stars={Object.values(notes.notes.stars)
            .filter((star) => Date.parse(star.until) > nowMs)
            .toSorted((a, b) => a.until.localeCompare(b.until))}
          onPriority={(card, value) => {
            if (card.item) void setDeskField(card.item.itemId, "Priority", value);
          }}
          onStar={starArea}
          onOpen={(card) => {
            if (card.decision) openDecision(card.decision);
            else if (card.stage === "test" && card.sheet) openExternal(testPageUrl(card.sheet.id));
            else if (card.stage === "merge" && card.pr) openPr(card.pr);
            else if (card.item) openItemIn([])(card.item);
          }}
        />
      ) : mode === "machines" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3 pb-6">
          <MachinesCard nowMs={nowMs} chats={props.chats} />
        </div>
      ) : mode === "agents" ? (
        <AgentsView
          chats={props.chats}
          items={items}
          notes={notes.notes}
          apps={apps}
          app={app}
          sprint={sprint}
          appOfRepo={appOf}
          repoOf={repoOf}
          chatsFor={chatsFor}
          onOpenChat={openChat}
          onOpenItem={openItemIn([])}
          onStartChat={(entry) => setLauncher({ kind: "item", item: entry })}
          onStartPlanner={(name) =>
            setLauncher({ kind: "app", app: name, view: "overview", feature: null })
          }
        />
      ) : mode === "apps" && focusApp ? (
        <AppView
          app={focusApp.app}
          pinned={
            <PinnedStrip
              place={{ kind: "app", app: focusApp.app }}
              notes={notes.notes}
              chats={props.pinnable}
              onOpenChat={openChat}
              empty={`Nothing pinned to ${focusApp.app} yet. Chats you start here are pinned automatically.`}
            />
          }
          feature={focusApp.feature}
          items={items}
          sprint={sprint}
          notes={notes.notes}
          threads={appThreads(focusApp.app)}
          card={(entry) => card(entry, false, appSequence)}
          onChat={() =>
            setLauncher({
              kind: "app",
              app: focusApp.app,
              view: "overview",
              feature: focusApp.feature,
            })
          }
          onOpenItem={openItemIn(appSequence)}
          onOpenChat={openChat}
          onFeature={(feature) => setFocus({ app: focusApp.app, feature, view: "overview" })}
        />
      ) : mode === "sprint" ? (
        sprintPanel()
      ) : mode === "backlog" ? (
        <BacklogView
          items={buildBacklog(items, planned, { app, query, kind })}
          kind={kind}
          onKind={setKind}
          sprints={upcoming.slice(0, 2)}
          card={card}
          onAddToSprint={(entry, title) => void setDeskField(entry.itemId, "Sprint", title)}
        />
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto px-4 pt-3 pb-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="md:col-span-2 xl:col-span-3">
            <DirectionPanel
              app={ALL_APPS}
              title="Where all the applications are going"
              sections={PORTFOLIO_DIRECTION}
              notes={notes.notes}
            />
          </div>
          {summaries.map((summary) => (
            <AppScorecard
              key={summary.app}
              summary={summary}
              sprintTitle={sprint?.title ?? null}
              sprintProgress={
                sprint ? sprintOverview(items, sprint, [summary.app], false) : { done: 0, total: 0 }
              }
              notes={notes.notes}
              threads={appThreads(summary.app)}
              onOpenApp={() => setStoredApp(summary.app)}
            />
          ))}
        </div>
      )}
    </>,
  );
}

/** One application for a leader: its features by stage, this sprint's work and split, blockers. */

function AppScorecard(props: {
  readonly summary: AppSummary;
  readonly sprintTitle: string | null;
  /** Same counting as the Sprint tab. */
  readonly sprintProgress: { readonly done: number; readonly total: number };
  readonly notes: DeskNotes;
  readonly threads: ReadonlyArray<CardChatState>;
  readonly onOpenApp: () => void;
}) {
  const { summary } = props;
  const goal = props.sprintTitle
    ? noteAt(props.notes, { kind: "sprintGoal", sprint: props.sprintTitle, app: summary.app })
    : null;
  const stages = (["Production", "Testing", "Experiment"] as const).flatMap((stage) => {
    const count = summary.features.filter((feature) => feature.stage === stage).length;
    return count > 0 ? [{ stage, count }] : [];
  });
  const statuses = new Map<
    string,
    { tone: ReturnType<typeof chatStatus>["tone"]; count: number }
  >();
  for (const chat of props.threads) {
    const status = chatStatus(chat);
    statuses.set(status.label, {
      tone: status.tone,
      count: (statuses.get(status.label)?.count ?? 0) + 1,
    });
  }
  return (
    <button
      type="button"
      aria-label={`Open ${summary.app}`}
      onClick={props.onOpenApp}
      className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-left hover:border-ring"
    >
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{summary.app}</span>
        <span className="text-xs text-muted-foreground">
          {summary.open} open
          {summary.blocked.length > 0 ? ` · ${summary.blocked.length} blocked` : ""}
        </span>
      </span>
      <span className={cn("text-xs", goal?.text ? "" : "text-muted-foreground")}>
        {goal?.text ? `Goal: ${goal.text}` : "No sprint goal yet"}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {stages.map(({ stage, count }) => (
          <Badge key={stage} variant={STAGE_VARIANT[stage]} size="sm">
            {count} {stage}
          </Badge>
        ))}
        {props.sprintTitle ? (
          <span className="text-2xs text-muted-foreground">
            {props.sprintProgress.total > 0
              ? `${props.sprintTitle}: ${props.sprintProgress.done} of ${props.sprintProgress.total} done`
              : `Nothing in ${props.sprintTitle}`}
          </span>
        ) : null}
      </span>
      {statuses.size > 0 ? (
        <span className="flex flex-wrap items-center gap-1">
          {[...statuses].map(([label, { tone, count }]) => (
            <Badge key={label} variant={tone} size="sm">
              {count} {label.toLowerCase()}
            </Badge>
          ))}
        </span>
      ) : null}
    </button>
  );
}

const STATUS_HINT: Record<SprintStatus, string> = {
  Todo: "Planned, not started",
  "In Progress": "An agent or a person is on it",
  "In Review": "A PR or a test sheet waits on you",
  Done: "Merged or closed",
};

/** One Sprint column; dropping a card here sets its Status. */
function StatusColumn(props: {
  readonly status: SprintStatus;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `status:${props.status}`,
    data: { status: props.status },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={props.status}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border bg-muted/40",
        isOver && "border-ring",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-0.5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {props.status === "Todo" ? "To do" : props.status}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{props.count}</span>
      </header>
      <p className="px-3 pb-1.5 text-2xs text-muted-foreground">{STATUS_HINT[props.status]}</p>
      <ol className="flex min-h-12 flex-col gap-2 px-2 pb-2">{props.children}</ol>
    </section>
  );
}
