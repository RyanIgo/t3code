import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage, writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { environmentSummaries } from "../../state/presentation";
import { isOrchestratorTitle } from "../command/fleetOrchestrator";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  type BoardScope,
  type CardChatState,
  type CardPullRequestState,
  buildBoardLists,
  CARD_STAGES,
  type PlacedCard,
  listInitiatives,
  looseCards,
  placeCards,
} from "./boardCards.logic";
import { addCards, useBoard } from "./boardStore";
import { CardModal } from "./CardModal";
import { DeskPage, type DeskTab } from "./DeskPage";
import { readDeskFragment } from "./deskChat.logic";
import { appRepos } from "./desk.logic";
import { useDesk } from "./deskStore";
import { resolveFleetBoardCard } from "./fleetBoard.logic";
import { FleetBoardPage } from "./FleetBoardPage";
import { ProjectBoard } from "./ProjectBoard";
import { useFleetBoardThreads } from "./useFleetBoardThreads";

/** Desk tabs plan GitHub work; Chats shows the agents' chats (a list, or cards you arrange). */
const BoardTab = Schema.Literals(["today", "plan", "sprint", "apps", "prs", "chats"]);
type BoardTab = typeof BoardTab.Type;
const ChatsLayout = Schema.Literals(["list", "cards"]);
/** The repo picker's "All repos" entry; never a real project key. */
const ALL_REPOS = "*";

const GroupBy = Schema.Literals(["repo", "initiative"]);
type GroupBy = typeof GroupBy.Type;

const TABS: ReadonlyArray<{ readonly id: BoardTab; readonly label: string }> = [
  { id: "today", label: "Today" },
  { id: "plan", label: "Plan" },
  { id: "sprint", label: "Sprint" },
  { id: "apps", label: "Apps" },
  { id: "prs", label: "PRs" },
  { id: "chats", label: "Chats" },
];
const isTab = (value: unknown): value is BoardTab => TABS.some((tab) => tab.id === value);

function pullRequestState(
  snapshot: { state: string; isDraft: boolean; mergedAt?: string | null | undefined } | null,
): CardPullRequestState {
  if (snapshot === null) return "unknown";
  if (snapshot.mergedAt || snapshot.state === "merged") return "merged";
  if (snapshot.state === "open") return snapshot.isDraft ? "draft" : "open";
  return "closed";
}

/** Every chat the board can place, with the project (sidebar group) it belongs to. */
function useCardChats(includeSettled: boolean): CardChatState[] {
  const groups = useSidebarProjectGroups();
  const { threads } = useFleetBoardThreads(includeSettled);
  const projectKeyByRef = new Map<string, string>();
  for (const group of groups) {
    for (const ref of group.memberProjectRefs) {
      projectKeyByRef.set(`${ref.environmentId}:${ref.projectId}`, group.projectKey);
    }
  }
  return threads
    .filter((thread) => !isOrchestratorTitle(thread.title))
    .map((thread) => {
      const resolved = resolveFleetBoardCard(thread);
      return {
        environmentId: thread.environmentId,
        threadId: thread.id,
        title: thread.title,
        projectKey: projectKeyByRef.get(`${thread.environmentId}:${thread.projectId}`) ?? null,
        column: resolved.column,
        needsYou: resolved.column === "needs",
        working: resolved.tone === "working",
        hasPullRequest: Boolean(thread.linkedPullRequest),
        pullRequestNumber: thread.linkedPullRequest?.number ?? null,
        pullRequests: (thread.pullRequests ?? [])
          .filter((link) => link.source !== "stack-dismissed")
          .map((link) => ({
            url: link.url,
            label: `${link.repository.split("/").pop() ?? link.repository}#${link.number}`,
            state: pullRequestState(link.snapshot),
            checks: link.snapshot?.checksState ?? null,
            mergeability: link.snapshot?.mergeability ?? null,
          })),
        since: resolved.since ?? thread.updatedAt,
        worktree: thread.worktreePath ?? null,
        branch: thread.branch ?? null,
      };
    });
}

export function BoardPage() {
  // A `#desk=…` link opens its place on the Desk, whichever tab was last used.
  useState(() => {
    if (typeof window === "undefined") return null;
    const target = readDeskFragment(window.location.hash);
    if (target === null) return null;
    const tab: BoardTab =
      target.kind === "sprint"
        ? "sprint"
        : target.kind === "item"
          ? "today"
          : target.view === "board"
            ? "plan"
            : target.view === "sprint" || target.view === "prs"
              ? target.view
              : "apps";
    writeLocalStorageValue("t3-fleet:tab", tab, "today" as BoardTab, BoardTab);
    return null;
  });
  const [tab, setTab] = useLocalStorage("t3-fleet:tab", "today" as BoardTab, BoardTab);
  const [layout, setLayout] = useLocalStorage(
    "t3-fleet:chats-layout",
    "list" as typeof ChatsLayout.Type,
    ChatsLayout,
  );
  // The Desk's app filter also narrows the chat list, so a tab change keeps the same app.
  const desk = useDesk();
  const [storedDeskApp, setDeskApp] = useLocalStorage("t3-fleet:desk-app", "*", Schema.String);
  const deskItems = desk.view?.items ?? [];
  const deskApp = (desk.view?.apps ?? []).includes(storedDeskApp) ? storedDeskApp : null;
  const switcher = (
    <div className="flex shrink-0 items-center gap-2">
      <ToggleGroup
        aria-label="Board tab"
        className="shrink-0"
        value={[tab]}
        onValueChange={(next) => {
          if (isTab(next[0])) setTab(next[0]);
        }}
      >
        {TABS.map((option) => (
          <Toggle key={option.id} value={option.id}>
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
      {tab === "chats" ? (
        <ToggleGroup
          aria-label="Chats layout"
          className="shrink-0"
          value={[layout]}
          onValueChange={(next) => {
            if (next[0] === "list" || next[0] === "cards") setLayout(next[0]);
          }}
        >
          <Toggle value="list">List</Toggle>
          <Toggle value="cards">Cards</Toggle>
        </ToggleGroup>
      ) : null}
    </div>
  );
  if (tab === "chats") {
    return layout === "list" ? (
      <FleetBoardPage
        viewSwitcher={switcher}
        onlyRepos={deskApp ? { app: deskApp, repos: appRepos(deskItems, deskApp) } : null}
        onShowAll={() => setDeskApp("*")}
      />
    ) : (
      <CardsPage switcher={switcher} />
    );
  }
  return <DeskView tab={tab} onTab={setTab} switcher={switcher} />;
}

function DeskView(props: {
  readonly tab: DeskTab;
  readonly onTab: (tab: DeskTab) => void;
  readonly switcher: React.ReactNode;
}) {
  const groups = useSidebarProjectGroups();
  const environments = useAtomValue(environmentSummaries.environmentsAtom);
  const machine = new Map(
    environments.map((environment) => [environment.environmentId, environment.environmentLabel]),
  );
  const projectNames = new Map(groups.map((group) => [group.projectKey, group.displayName]));
  const projects = groups.flatMap((group) =>
    group.memberProjectRefs.map((ref) => ({
      key: `${ref.environmentId}:${ref.projectId}`,
      label: `${machine.get(ref.environmentId) ?? "Machine"} · ${group.displayName}`,
      ref,
      repo: group.displayName.split("/").pop() ?? group.displayName,
    })),
  );
  return (
    <DeskPage
      tab={props.tab}
      onTab={props.onTab}
      switcher={props.switcher}
      chats={useCardChats(false)}
      projectName={(key) => projectNames.get(key) ?? null}
      projects={projects}
    />
  );
}

function CardsPage(props: { readonly switcher: React.ReactNode }) {
  const board = useBoard();
  const [includeSettled, setIncludeSettled] = useLocalStorage(
    "t3-fleet:board-settled",
    false,
    Schema.Boolean,
  );
  const chats = useCardChats(includeSettled);
  const groups = useSidebarProjectGroups();
  const environments = useAtomValue(environmentSummaries.environmentsAtom);
  const [storedProject, setStoredProject] = useLocalStorage(
    "t3-fleet:board-project",
    "",
    Schema.String,
  );
  const [planning, setPlanning] = useLocalStorage("t3-fleet:board-planning", false, Schema.Boolean);
  const [groupBy, setGroupBy] = useLocalStorage("t3-fleet:board-group", "repo" as GroupBy, GroupBy);
  const [storedInitiative, setStoredInitiative] = useLocalStorage(
    "t3-fleet:board-initiative",
    "",
    Schema.String,
  );
  const [open, setOpen] = useState<{ id: string; sequence: ReadonlyArray<string> } | null>(null);

  const labelByEnvironment = new Map<string, string>(
    environments.map((environment) => [environment.environmentId, environment.environmentLabel]),
  );
  const showMachines = environments.filter((environment) => environment.isEnabled).length > 1;
  const machineLabel = (environmentId: string) =>
    showMachines ? (labelByEnvironment.get(environmentId) ?? null) : null;
  const projectLabel = new Map(groups.map((group) => [group.projectKey, group.displayName]));
  const initiatives = listInitiatives(board.document);
  const initiative =
    initiatives.find((name) => name.toLowerCase() === storedInitiative.toLowerCase()) ??
    initiatives[0] ??
    null;
  const allRepos = storedProject === ALL_REPOS;
  const projectKey = projectLabel.has(storedProject)
    ? storedProject
    : (groups[0]?.projectKey ?? "");
  const scope: BoardScope =
    groupBy === "initiative" && initiative !== null
      ? { kind: "initiative", initiative }
      : allRepos
        ? { kind: "all" }
        : { kind: "project", projectKey };
  const boardLists = buildBoardLists(board.document, scope, chats);
  const looseOnBoard = Object.values(boardLists).flatMap((list) =>
    list.filter((placed) => placed.loose),
  );
  const looseChatCount = looseOnBoard.reduce((sum, placed) => sum + placed.chats.length, 0);
  const addAllToBoard = () =>
    addCards(
      CARD_STAGES.flatMap((stage) => {
        const list = boardLists[stage.id];
        const last = Math.max(
          0,
          ...list.filter((placed) => !placed.loose).map((p) => p.card.order),
        );
        return list
          .filter((placed) => placed.loose)
          .map((placed, index) => ({
            projectKey: placed.card.projectKey,
            title: placed.card.title,
            stage: placed.stage,
            order: last + 1000 * (index + 1),
            chats: placed.card.chats,
          }));
      }),
    );
  const projects = groups.map((group) => ({
    projectKey: group.projectKey,
    displayName: group.displayName,
  }));

  const placedCards = placeCards(board.document, chats);
  const loose = looseCards(placedCards, chats);
  const resolvePlaced = (id: string): PlacedCard | null =>
    placedCards.find((placed) => placed.card.id === id) ??
    loose.find((placed) => placed.card.id === id) ??
    null;
  const openPlaced = open ? resolvePlaced(open.id) : null;
  // The cards the window cycles through, placed live so a card that changes list moves tab.
  const openPool = open
    ? open.sequence.flatMap((id) => {
        const placed = resolvePlaced(id);
        return placed ? [placed] : [];
      })
    : [];
  const openCard = (id: string, sequence: ReadonlyArray<string>) => setOpen({ id, sequence });
  const navigateCard = (id: string) =>
    setOpen((current) =>
      current === null
        ? null
        : {
            id,
            // A chat turned into a card keeps its place in the sequence under its new id.
            sequence: current.sequence.includes(id)
              ? current.sequence
              : current.sequence.map((entry) => (entry === current.id ? id : entry)),
          },
    );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          {props.switcher}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {board.error ??
              (board.storage === "browser"
                ? "Saved in this browser only. Open the hub to share it."
                : "")}
          </span>
        </WorkspacePageHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
          <ToggleGroup
            aria-label="Group by"
            value={[groupBy]}
            onValueChange={(next) => {
              if (next[0] === "repo" || next[0] === "initiative") setGroupBy(next[0]);
            }}
          >
            <Toggle value="repo">Repo</Toggle>
            <Toggle value="initiative">Initiative</Toggle>
          </ToggleGroup>
          <div className="w-56 max-w-full min-w-0">
            {groupBy === "repo" ? (
              <Select
                value={allRepos ? ALL_REPOS : projectKey}
                onValueChange={(value) => {
                  if (typeof value === "string") setStoredProject(value);
                }}
              >
                <SelectTrigger aria-label="Repo" size="sm" className="w-full">
                  <SelectValue>
                    {allRepos ? "All repos" : (projectLabel.get(projectKey) ?? "Pick a repo")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={ALL_REPOS}>All repos</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.projectKey} value={group.projectKey}>
                      {group.displayName}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : initiative === null ? (
              <span className="text-xs text-muted-foreground">
                No initiatives yet. Set one on a card.
              </span>
            ) : (
              <Select
                value={initiative}
                onValueChange={(value) => {
                  if (typeof value === "string") setStoredInitiative(value);
                }}
              >
                <SelectTrigger aria-label="Initiative" size="sm" className="w-full">
                  <SelectValue>{initiative}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {initiatives.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              id="board-planning"
              size="sm"
              checked={planning}
              onCheckedChange={setPlanning}
            />
            <Label htmlFor="board-planning">Planning</Label>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              id="board-settled"
              size="sm"
              checked={includeSettled}
              onCheckedChange={setIncludeSettled}
            />
            <Label htmlFor="board-settled">Settled chats</Label>
          </div>
          {looseOnBoard.length > 0 ? (
            <Button variant="outline" size="xs" onClick={addAllToBoard}>
              Add {looseChatCount} chat{looseChatCount === 1 ? "" : "s"} to the board
            </Button>
          ) : null}
        </div>

        {groups.length === 0 ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>
                Projects from your connected machines show up here. Pair a machine in Settings →
                Connections.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col pt-2">
            {planning ? (
              <p className="px-4 pb-2 text-xs text-muted-foreground">
                Planning: add and arrange cards. Nothing starts until you start a chat.
                {scope.kind !== "project"
                  ? ` New cards go to ${projectLabel.get(projectKey) ?? "the last repo you picked"}; change it on the card.`
                  : ""}
              </p>
            ) : null}
            <ProjectBoard
              scope={scope}
              newCardProjectKey={projectKey}
              document={board.document}
              chats={chats}
              planning={planning}
              machineLabel={machineLabel}
              projectLabel={(key) => projectLabel.get(key) ?? "Unknown project"}
              onOpen={openCard}
            />
          </div>
        )}
      </div>
      {openPlaced && open ? (
        <CardModal
          placed={openPlaced}
          chats={chats}
          projects={projects}
          initiatives={initiatives}
          pool={openPool}
          loose={loose}
          onNavigate={navigateCard}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </SidebarInset>
  );
}
