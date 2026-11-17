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
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import type { CardChatState } from "./boardCards.logic";
import { useBoard } from "./boardStore";
import {
  buildDeskColumns,
  chatsForItem,
  chatWaitsOnYou,
  DESK_LANES,
  type DeskItem,
  type DeskLane,
  deskRef,
  deskTitle,
  NOW_LIMIT,
  summarizeApps,
  groupWork,
  sprintOverview,
  appRepos,
  chatsForApp,
  type AppSummary,
  currentSprint,
  waitingOnYou,
} from "./desk.logic";
import { refreshDesk, setDeskLane, useDesk } from "./deskStore";
import { type DeskNotes, noteAt } from "./deskNotes.logic";
import { saveDeskLink, saveDeskNote, useDeskNotes } from "./deskNotesStore";
import { minuteTickToMs } from "./fleetBoard.logic";
import {
  DeskCard,
  formatDay,
  NoteEditor,
  openExternal,
  STAGE_VARIANT,
  ThreadList,
} from "./DeskParts";
import { AppView, DeskModal, SprintView } from "./DeskViews";
import { PrLens } from "./DeskPrs";
import { collectPrs, type DeskPr, type PrGrouping } from "./deskPrs.logic";
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

const DeskMode = Schema.Literals(["lanes", "apps", "sprint", "prs"]);
const DeskFocusSchema = Schema.NullOr(
  Schema.Struct({
    app: Schema.String,
    feature: Schema.NullOr(Schema.String),
    view: Schema.Literals(["overview", "board", "sprint", "prs"]),
  }),
);
type DeskFocus = NonNullable<typeof DeskFocusSchema.Type>;
type DeskMode = typeof DeskMode.Type;
const ALL = "*";
const UNSORTED_SHOWN = 25;

const LANE_HINT: Record<DeskLane | "Unsorted", string> = {
  Now: "Being worked on this week",
  Next: "Up after Now",
  Later: "Wanted, not soon",
  Blocked: "Waiting on someone or something",
  Unsorted: "Open work with no lane yet, highest priority first",
};

/**
 * Fleet fork: the Dev Desk. All development work from the GitHub project in plain words: Lanes
 * for doing it, Apps for leading it (each application's features by stage, this sprint and its
 * 60 / 20 / 20 split), with what needs you on top. Lives on the fleet hub.
 */
const deskUrl = () => `${window.location.origin}/board`;

export function DeskPage(props: {
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
      writeLocalStorageValue("t3-fleet:desk-mode", "apps", "apps" as DeskMode, DeskMode);
      writeLocalStorageValue(
        "t3-fleet:desk-focus",
        { app: target.app, feature: target.feature, view: target.view },
        null as DeskFocus | null,
        DeskFocusSchema,
      );
    } else if (target.kind === "sprint") {
      writeLocalStorageValue("t3-fleet:desk-mode", "sprint", "apps" as DeskMode, DeskMode);
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
  const [mode, setMode] = useLocalStorage("t3-fleet:desk-mode", "apps" as DeskMode, DeskMode);
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
  const [query, setQuery] = useState("");
  const [showAllUnsorted, setShowAllUnsorted] = useState(false);
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
        setMode("apps");
        setFocus({ app: target.app, feature: target.feature, view: target.view });
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
      <h1 className="hidden shrink-0 text-sm font-medium sm:block">Desk</h1>
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

  // The app filter only applies where it's shown (not on Apps, which has its own app pages).
  const needsApp = mode === "apps" ? null : app;
  const chatsNeedingYou = (needsApp === null ? props.chats : appThreads(needsApp)).filter(
    chatWaitsOnYou,
  );
  const waiting = waitingOnYou(items).filter((item) => !needsApp || item.app === needsApp);

  const onDragEnd = (event: DragEndEvent) => {
    const lane = event.over?.data.current?.lane as DeskLane | "Unsorted" | undefined;
    const item = items.find((entry) => entry.itemId === event.active.id);
    if (!item || !lane || (item.lane ?? "Unsorted") === lane) return;
    void setDeskLane(item.itemId, lane === "Unsorted" ? null : lane);
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

  const card = (item: DeskItem, draggable: boolean, sequence: ReadonlyArray<string> = []) => (
    <DeskCard
      key={item.itemId}
      item={item}
      chats={chatsFor(item)}
      draggable={draggable}
      showApp={app === null && focus === null}
      currentSprint={sprint?.title ?? null}
      onOpenChat={openChat}
      onOpen={openItemIn(sequence)}
    />
  );
  const ids = (list: ReadonlyArray<DeskItem>) => list.map((entry) => entry.itemId);
  const prs = collectPrs(items, props.chats);
  const openPr = (pr: DeskPr) => {
    if (pr.item) {
      setModal({
        itemId: pr.item.itemId,
        chat: pr.chats[0] ?? null,
        sequence: prs.flatMap((entry) => (entry.item ? [entry.item.itemId] : [])),
      });
    } else if (pr.chats[0]) {
      openChat(pr.chats[0]);
    } else {
      openExternal(pr.url);
    }
  };
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
  const focusApp = focus && apps.includes(focus.app) ? focus : null;

  const lanes = (onlyApp: string | null) => {
    const laneColumns = buildDeskColumns(items, { app: onlyApp ?? app, query });
    const order = ["Unsorted" as const, ...DESK_LANES];
    const sequence = order.flatMap((lane) => ids(laneColumns[lane]));
    return (
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-4 pb-4">
          {order.map((lane) => {
            const laneItems = laneColumns[lane];
            const shown =
              lane === "Unsorted" && !showAllUnsorted
                ? laneItems.slice(0, UNSORTED_SHOWN)
                : laneItems;
            return (
              <DeskColumn
                key={lane}
                lane={lane}
                count={laneItems.length}
                footer={
                  shown.length < laneItems.length ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="mx-2 mb-2"
                      onClick={() => setShowAllUnsorted(true)}
                    >
                      Show {laneItems.length - shown.length} more
                    </Button>
                  ) : null
                }
              >
                {shown.map((item) => card(item, true, sequence))}
              </DeskColumn>
            );
          })}
        </div>
      </DndContext>
    );
  };

  const sprintPanel = (pageApp: string | null) => {
    // An app page, else the app chosen in the filter: every part of the sprint follows it.
    const onlyApp = pageApp ?? app;
    if (!sprintShown) {
      return <p className="p-6 text-sm text-muted-foreground">The project has no sprints yet.</p>;
    }
    const sequence = sprintOverview(items, sprintShown, onlyApp ? [onlyApp] : apps).apps.flatMap(
      (entry) => ids(entry.items),
    );
    return (
      <SprintView
        view={view}
        sprint={sprintShown}
        nowMs={nowMs}
        notes={notes.notes}
        app={onlyApp}
        card={(entry) => card(entry, false, sequence)}
        onSprint={setChosenSprint}
        onChat={() => setLauncher({ kind: "sprint", sprint: sprintShown, app: onlyApp })}
        prsPanel={prLens(
          (pr) =>
            pr.sprint?.title === sprintShown.title && (onlyApp === null || pr.app === onlyApp),
          "app",
        )}
        linkedChats={withLinked(
          linkedChats(
            (link) =>
              link.sprint === sprintShown.title &&
              link.kind === "sprint" &&
              (onlyApp === null || link.app === onlyApp),
          ),
          items
            .filter(
              (entry) =>
                entry.sprint?.title === sprintShown.title &&
                (onlyApp === null || entry.app === onlyApp),
            )
            .flatMap(chatsFor),
        )}
        onOpenChat={openChat}
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
  const overviewSequence = summaries.flatMap((summary) =>
    ids([...summary.sprintItems, ...summary.blocked]),
  );

  return frame(
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
        <ToggleGroup
          aria-label="Desk view"
          value={[mode]}
          onValueChange={(next) => {
            if (
              next[0] === "lanes" ||
              next[0] === "apps" ||
              next[0] === "sprint" ||
              next[0] === "prs"
            ) {
              setMode(next[0]);
            }
          }}
        >
          <Toggle value="apps">Apps</Toggle>
          <Toggle value="sprint">Sprint</Toggle>
          <Toggle value="prs">PRs</Toggle>
          <Toggle value="lanes">Lanes</Toggle>
        </ToggleGroup>
        {mode !== "apps" ? (
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
        ) : null}
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
        {sprint ? (
          <span className="text-xs text-muted-foreground">
            {sprint.title}: {formatDay(sprint.startDate)} –{" "}
            {formatDay(sprint.startDate, sprint.duration - 1)}
          </span>
        ) : null}
      </div>
      {mode === "apps" ? (
        <nav aria-label="Applications" className="flex shrink-0 gap-1 overflow-x-auto px-4 pt-2">
          <Button
            variant={focusApp ? "ghost" : "secondary"}
            size="xs"
            onClick={() => setFocus(null)}
          >
            All apps
          </Button>
          {apps.map((name) => (
            <Button
              key={name}
              variant={focusApp?.app === name ? "secondary" : "ghost"}
              size="xs"
              onClick={() =>
                setFocus({ app: name, feature: null, view: focusApp?.view ?? "overview" })
              }
            >
              {name}
            </Button>
          ))}
        </nav>
      ) : null}
      {mode !== "apps" || focusApp === null ? (
        <NeedsYou
          chats={chatsNeedingYou}
          items={waiting}
          onOpenChat={openChat}
          onOpenItem={openItemIn(ids(waiting))}
        />
      ) : null}
      {modal && (modal.itemUrl === undefined || modalItem) ? (
        <DeskModal
          key={`${modal.itemId ?? ""}:${modal.chat?.threadId ?? ""}`}
          item={modalItem}
          chat={modal.chat}
          chats={modalItem ? chatsFor(modalItem) : modal.chat ? [modal.chat] : []}
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
      {mode === "apps" && focusApp ? (
        <AppView
          app={focusApp.app}
          feature={focusApp.feature}
          subview={focusApp.view}
          items={items}
          sprint={sprint}
          notes={notes.notes}
          threads={appThreads(focusApp.app)}
          card={(entry) => card(entry, false, appSequence)}
          onChat={() =>
            setLauncher({
              kind: "app",
              app: focusApp.app,
              view: focusApp.view,
              feature: focusApp.feature,
            })
          }
          board={lanes(focusApp.app)}
          sprintPanel={sprintPanel(focusApp.app)}
          prsPanel={prLens((pr) => pr.app === focusApp.app, "sprint")}
          onOpenItem={openItemIn(appSequence)}
          onOpenChat={openChat}
          onFeature={(feature) => setFocus({ ...focusApp, feature, view: "overview" })}
          onSubview={(next) => setFocus({ ...focusApp, feature: null, view: next })}
          onBack={() => setFocus(null)}
        />
      ) : mode === "sprint" ? (
        sprintPanel(null)
      ) : mode === "prs" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
          {prLens((pr) => app === null || pr.app === app)}
        </div>
      ) : mode === "lanes" ? (
        lanes(null)
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto px-4 pt-3 pb-4 xl:grid-cols-2">
          {sprint ? (
            <section
              aria-label={`${sprint.title} notes`}
              className="rounded-lg border border-border bg-muted/40 p-3 xl:col-span-2"
            >
              <NoteEditor
                label={`${sprint.title} notes`}
                hint="What this sprint is for and what feedback said. Agents read it."
                placeholder="e.g. Goal: get bid review and access control in front of users by Nov 22; feedback from the test sheets goes here."
                note={noteAt(notes.notes, { kind: "sprintNotes", sprint: sprint.title })}
                rows={3}
                onSave={(text) => saveDeskNote({ kind: "sprintNotes", sprint: sprint.title }, text)}
              />
            </section>
          ) : null}
          {summaries.map((summary) => (
            <AppScorecard
              key={summary.app}
              summary={summary}
              sprintTitle={sprint?.title ?? null}
              card={(item) => card(item, false, overviewSequence)}
              notes={notes.notes}
              threads={appThreads(summary.app)}
              onOpenChat={openChat}
              onOpenApp={() => setFocus({ app: summary.app, feature: null, view: "overview" })}
              onOpenFeature={(feature) => setFocus({ app: summary.app, feature, view: "overview" })}
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
  readonly card: (item: DeskItem) => ReactNode;
  readonly notes: DeskNotes;
  readonly threads: ReadonlyArray<CardChatState>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenApp: () => void;
  readonly onOpenFeature: (feature: string) => void;
}) {
  const { summary } = props;
  const goalTarget = props.sprintTitle
    ? ({ kind: "sprintGoal", sprint: props.sprintTitle, app: summary.app } as const)
    : null;
  const { mix } = summary;
  const total = mix.feature + mix.maintenance + mix.other;
  const percent = (value: number) => (total === 0 ? 0 : Math.round((value / total) * 100));
  return (
    <section
      aria-label={summary.app}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">
          <button
            type="button"
            className="cursor-pointer hover:underline"
            onClick={props.onOpenApp}
          >
            {summary.app}
          </button>
        </h2>
        <span className="text-xs text-muted-foreground">
          {summary.open} open · {summary.maintenance} maintenance · {summary.blocked.length} blocked
        </span>
      </header>
      {goalTarget ? (
        <NoteEditor
          label={`${props.sprintTitle} goal`}
          hint="One line: what this app should reach this sprint."
          placeholder="e.g. Estimators level bids on one screen, in Testing with two of them."
          note={noteAt(props.notes, goalTarget)}
          rows={1}
          onSave={(text) => saveDeskNote(goalTarget, text)}
        />
      ) : null}
      {summary.features.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            Features
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {summary.features.map((feature) => (
              <li key={feature.feature} className="flex items-center gap-2">
                <span className="w-24 shrink-0">
                  {feature.stage ? (
                    <Badge variant={STAGE_VARIANT[feature.stage]} size="sm">
                      {feature.stage}
                    </Badge>
                  ) : (
                    <span className="text-2xs text-muted-foreground">No stage</span>
                  )}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline disabled:cursor-default disabled:no-underline"
                  onClick={() => props.onOpenFeature(feature.feature)}
                >
                  {feature.name}
                </button>
                <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                  {feature.inSprint > 0 ? `${feature.inSprint} in sprint · ` : ""}
                  {feature.open} open{feature.blocked > 0 ? ` · ${feature.blocked} blocked` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <h3 className="flex flex-wrap items-baseline gap-2 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          {props.sprintTitle ?? "This sprint"}
          {total > 0 ? (
            <span className="font-normal tracking-normal normal-case">
              {percent(mix.feature)}% features · {percent(mix.maintenance)}% maintenance ·{" "}
              {percent(mix.other)}% fixes, research & support (budget 60 / 20 / 20)
            </span>
          ) : null}
        </h3>
        {summary.sprintItems.length > 0 ? (
          <ol className="flex flex-col gap-2">{summary.sprintItems.map(props.card)}</ol>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing planned for this sprint.</p>
        )}
      </div>
      {summary.blocked.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            Blocked
          </h3>
          <ol className="flex flex-col gap-2">{summary.blocked.map(props.card)}</ol>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          Threads · {props.threads.length}
        </h3>
        <ThreadList
          threads={props.threads}
          onOpenChat={props.onOpenChat}
          empty="No open T3 chats in this app's repos."
        />
      </div>
      <details className="group/notes">
        <summary className="cursor-pointer text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          Notes for agents
          {props.notes.apps[summary.app] ? "" : " · none yet"}
        </summary>
        <div className="mt-1.5">
          <NoteEditor
            label="Notes for agents"
            hint="Goals, decisions, conventions, what not to touch. Agents read this before working here."
            placeholder={
              "e.g.\n- Estimators are the users; keep screens plain.\n- Decided 2026-11-17: leveling is the heart of Bids.\n- Don't change the AI read switches without asking."
            }
            note={props.notes.apps[summary.app] ?? null}
            rows={8}
            onSave={(text) => saveDeskNote({ kind: "app", app: summary.app }, text)}
          />
        </div>
      </details>
    </section>
  );
}

function NeedsYou(props: {
  readonly chats: ReadonlyArray<CardChatState>;
  readonly items: ReadonlyArray<DeskItem>;
  readonly onOpenChat: (chat: CardChatState) => void;
  readonly onOpenItem: (item: DeskItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = props.chats.length + props.items.length;
  if (total === 0) {
    return <p className="px-4 pt-3 text-xs text-muted-foreground">Nothing is waiting on you.</p>;
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
          {chat.title}
        </button>
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
    <section
      aria-label="Needs you"
      className="mx-4 mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Needs you · {total}
      </h2>
      <ul className="flex flex-col gap-1 text-sm">{expanded ? rows : rows.slice(0, 5)}</ul>
      {rows.length > 5 ? (
        <Button variant="ghost" size="xs" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer" : `Show ${rows.length - 5} more`}
        </Button>
      ) : null}
    </section>
  );
}

function DeskColumn(props: {
  readonly lane: DeskLane | "Unsorted";
  readonly count: number;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${props.lane}`,
    data: { lane: props.lane },
  });
  const overLimit = props.lane === "Now" && props.count > NOW_LIMIT;
  return (
    <section
      ref={setNodeRef}
      aria-label={props.lane === "Unsorted" ? "Not sorted" : props.lane}
      className={cn(
        "flex max-h-full w-72 max-w-[85vw] shrink-0 flex-col rounded-lg border border-border bg-muted/40",
        isOver && "border-ring",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-0.5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {props.lane === "Unsorted" ? "Not sorted" : props.lane}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {props.lane === "Now" ? `${props.count} / ${NOW_LIMIT}` : props.count}
        </span>
        {overLimit ? (
          <Badge variant="warning" size="sm" className="ms-auto">
            Too many
          </Badge>
        ) : null}
      </header>
      <p className="px-3 pb-1.5 text-2xs text-muted-foreground">{LANE_HINT[props.lane]}</p>
      <ol className="flex min-h-8 flex-col gap-2 overflow-y-auto px-2 pb-2">{props.children}</ol>
      {props.footer}
    </section>
  );
}
