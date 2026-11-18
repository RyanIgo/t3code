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
  chatTitle,
  chatWaitsOnYou,
  currentSprint,
  type DeskItem,
  deskRef,
  deskTitle,
  groupWork,
  plannedSprints,
  SPRINT_STATUSES,
  type SprintStatus,
  sprintOverview,
  sprintStatus,
  summarizeApps,
  waitingOnYou,
  type WorkKind,
} from "./desk.logic";
import { refreshDesk, setDeskField, useDesk } from "./deskStore";
import { type DeskNotes, noteAt } from "./deskNotes.logic";
import { saveDeskLink, useDeskNotes } from "./deskNotesStore";
import { minuteTickToMs } from "./fleetBoard.logic";
import { DeskCard, DeskHeading, STAGE_VARIANT } from "./DeskParts";
import { BacklogView } from "./DeskBacklog";
import { AppView, DeskModal, SprintView } from "./DeskViews";
import { PrLens } from "./DeskPrs";
import { collectPrs, type DeskPr, isDependencyUpdate, type PrGrouping } from "./deskPrs.logic";
import { TodayView } from "./DeskToday";
import { changesSince, focusByApp, stalledItems } from "./deskFocus.logic";
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
export type DeskTab = "today" | "sprint" | "backlog" | "apps";
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

export function DeskPage(props: {
  readonly tab: DeskTab;
  readonly onTab: (tab: DeskTab) => void;
  readonly switcher: ReactNode;
  readonly chats: ReadonlyArray<CardChatState>;
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
  const { handleNewThread } = useHandleNewThread();
  const [launcher, setLauncher] = useState<DeskChatContext | null>(null);
  const desk = useDesk();
  const notes = useDeskNotes();
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
  } | null>(
    deepLink?.kind === "item"
      ? { itemId: null, chat: null, sequence: [], itemUrl: deepLink.url }
      : null,
  );
  const [chosenSprint, setChosenSprint] = useState<string | null>(
    deepLink?.kind === "sprint" ? deepLink.sprint : null,
  );
  const [storedApp, setStoredApp] = useLocalStorage("t3-fleet:desk-app", ALL, Schema.String);
  // When the user last said they were caught up; 0 means never (then: the last 8 hours).
  const [caughtUp, setCaughtUp] = useLocalStorage("t3-fleet:caught-up", 0, Schema.Number);
  const [query, setQuery] = useState("");
  const [showBumps, setShowBumps] = useState(false);
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
  // A Desk link followed while already here (e.g. from a chat in the work window) only changes
  // the fragment; apply it the same way and clear it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for `#desk=…` fragment changes in the browser's address
  useEffect(() => {
    const onHashChange = () => {
      const target = readDeskFragment(window.location.hash);
      if (target === null) return;
      if (target.kind === "item") {
        setModal({ itemId: null, chat: null, sequence: [], itemUrl: target.url });
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
              ? "today"
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
  const chatsFor = (item: DeskItem) =>
    withLinked(
      chatsForItem(item, props.chats, linksByChat),
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
  const appChats = app === null ? props.chats : appThreads(app);
  const waiting = waitingOnYou(items).filter((item) => !app || item.app === app);

  // Dropping a card in a Sprint column sets its Status on GitHub.
  const onDragEnd = (event: DragEndEvent) => {
    const status = event.over?.data.current?.status as SprintStatus | undefined;
    const item = items.find((entry) => entry.itemId === event.active.id);
    if (!item || !status || sprintStatus(item, agentActive(item)) === status) return;
    void setDeskField(item.itemId, "Status", status);
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
      saveDeskLink(
        `${project.ref.environmentId}:${created.threadId}`,
        contextLink(context, sprint),
      );
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
    setLauncher(null);
    setModal({ itemId: context.kind === "item" ? context.item.itemId : null, chat, sequence: [] });
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
      onOpenChat={openChat}
      onOpen={openItemIn(sequence)}
    />
  );
  const ids = (list: ReadonlyArray<DeskItem>) => list.map((entry) => entry.itemId);
  const agentActive = (entry: DeskItem) => chatsFor(entry).some((chat) => chat.working);
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
  const prLens = (keep: (pr: DeskPr) => boolean, grouping?: PrGrouping) => (
    <PrLens
      prs={prs.filter(keep)}
      {...(grouping ? { grouping } : {})}
      onOpenPr={openPr}
      onOpenChat={openChat}
    />
  );
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

  const sprintPanel = () => {
    if (!sprintShown) {
      return <p className="p-6 text-sm text-muted-foreground">The project has no sprints yet.</p>;
    }
    const board = buildSprintBoard(items, sprintShown, { app, query }, agentActive);
    const sequence = SPRINT_STATUSES.flatMap((status) => ids(board[status]));
    return (
      <SprintView
        view={view}
        sprint={sprintShown}
        nowMs={nowMs}
        notes={notes.notes}
        app={app}
        onSprint={setChosenSprint}
        onChat={() => setLauncher({ kind: "sprint", sprint: sprintShown, app })}
        board={
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
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
        return ids([...work.sprint, ...work.blocked, ...work.open, ...work.done]);
      })()
    : [];
  const summaries = summarizeApps(items, app ? [app] : apps, sprint);

  const caughtUpAt = caughtUp > 0 ? caughtUp : nowMs - 8 * 3_600_000;
  const repoOf = (chat: CardChatState) =>
    chat.projectKey ? (props.projectName(chat.projectKey)?.split("/").pop() ?? null) : null;
  const hasChat = (entry: DeskItem) => chatsFor(entry).length > 0;
  const stalled = stalledItems(
    items.filter((entry) => app === null || entry.app === app),
    sprint,
    hasChat,
  );
  const stalledCard = (entry: DeskItem) =>
    card(
      entry,
      false,
      ids(stalled),
      <Button
        variant="outline"
        size="xs"
        onClick={() => setLauncher({ kind: "item", item: entry })}
      >
        Start agent
      </Button>,
    );
  return frame(
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
        <div className="w-64 max-w-full">
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
      {modal && (modal.itemUrl === undefined || modalItem) ? (
        <DeskModal
          key={`${modal.itemId ?? ""}:${modal.chat?.threadId ?? ""}:${modal.pr?.url ?? ""}`}
          item={modalItem}
          pr={modal.pr ?? null}
          chat={modal.chat}
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
        />
      ) : null}
      {launcher ? (
        <ChatLauncher
          context={launcher}
          projects={props.projects}
          appRepos={appRepos(
            items,
            launcher.kind === "item" ? (launcher.item.app ?? "") : (launcher.app ?? ""),
          )}
          chats={props.chats}
          appChats={
            new Set(
              (launcher.kind === "item"
                ? launcher.item.app
                  ? appThreads(launcher.item.app)
                  : []
                : launcher.app
                  ? appThreads(launcher.app)
                  : []
              ).map((chat) => `${chat.environmentId}:${chat.threadId}`),
            )
          }
          onStart={(project) => void startChat(launcher, project)}
          onLink={(chat) => linkChat(launcher, chat)}
          onClose={() => setLauncher(null)}
        />
      ) : null}
      {mode === "today" ? (
        <TodayView
          app={app}
          catchup={changesSince(
            caughtUpAt,
            items.filter((entry) => app === null || entry.app === app),
            app === null ? props.chats : appThreads(app),
          )}
          caughtUpAt={caughtUpAt}
          onCaughtUp={() => setCaughtUp(Date.now())}
          onOpenChat={openChat}
          onOpenItem={openItemIn([])}
          repoOf={repoOf}
          focus={focusByApp({
            apps,
            items,
            prs,
            sprint,
            needsYou: (name) =>
              appThreads(name).filter(chatWaitsOnYou).length +
              waitingOnYou(items).filter((entry) => entry.app === name).length,
            hasChat: (entry) => chatsFor(entry).length > 0,
          })}
          onPickApp={(name) => setStoredApp(name ?? ALL)}
          answer={
            <NeedsYou
              title="Answer an agent"
              empty="No agent is waiting for an answer."
              chats={appChats.filter((chat) => chat.needsYou)}
              repoOf={repoOf}
              items={[]}
              onOpenChat={openChat}
              onOpenItem={openItemIn([])}
            />
          }
          review={
            <NeedsYou
              title="Review a result"
              empty="No results waiting for you."
              chats={appChats.filter((chat) => !chat.needsYou && chat.column === "done")}
              repoOf={repoOf}
              items={waiting}
              onOpenChat={openChat}
              onOpenItem={openItemIn(ids(waiting))}
            />
          }
          prs={prLens(
            (pr) =>
              (app === null || pr.app === app) &&
              (pr.stage === "ready" || pr.stage === "fix") &&
              (showBumps || !isDependencyUpdate(pr)),
            "app",
          )}
          bumps={
            prs.filter(
              (pr) =>
                (app === null || pr.app === app) && isDependencyUpdate(pr) && pr.stage === "ready",
            ).length
          }
          showBumps={showBumps}
          onToggleBumps={() => setShowBumps((value) => !value)}
          stalled={stalled}
          card={stalledCard}
        />
      ) : mode === "apps" && focusApp ? (
        <AppView
          app={focusApp.app}
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

function NeedsYou(props: {
  readonly title: string;
  readonly empty: string;
  readonly chats: ReadonlyArray<CardChatState>;
  /** The chat's repo, so each row says where it is. */
  readonly repoOf: (chat: CardChatState) => string | null;
  readonly items: ReadonlyArray<DeskItem>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = props.chats.length + props.items.length;
  if (total === 0) {
    return (
      <section aria-label={props.title} className="flex flex-col gap-1">
        <DeskHeading>{props.title} · 0</DeskHeading>
        <p className="text-xs text-muted-foreground">{props.empty}</p>
      </section>
    );
  }
  const rows: ReactNode[] = [
    ...props.chats.map((chat) => (
      <li key={`chat:${chat.environmentId}:${chat.threadId}`} className="flex items-center gap-2">
        <Badge variant="warning" size="sm">
          {chat.needsYou ? "Chat" : chat.column === "done" ? "Result" : "Checks"}
        </Badge>
        <button
          type="button"
          className="min-w-0 cursor-pointer truncate text-left hover:underline"
          onClick={() => props.onOpenChat(chat)}
        >
          {chatTitle(chat.title)}
        </button>
        {props.repoOf(chat) ? (
          <span className="shrink-0 text-2xs text-muted-foreground">{props.repoOf(chat)}</span>
        ) : null}
      </li>
    )),
    ...props.items.map((item) => (
      <li key={item.itemId} className="flex items-center gap-2">
        <Badge variant={item.lane === "Blocked" ? "error" : "info"} size="sm">
          {item.lane === "Blocked" ? "Blocked" : "Review"}
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
    )),
  ];
  return (
    <section aria-label={props.title} className="flex flex-col gap-1">
      <DeskHeading>
        {props.title} · {total}
      </DeskHeading>
      <ul className="flex flex-col gap-1 text-sm">{expanded ? rows : rows.slice(0, 5)}</ul>
      {rows.length > 5 ? (
        <Button variant="ghost" size="xs" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer" : `Show ${rows.length - 5} more`}
        </Button>
      ) : null}
    </section>
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
