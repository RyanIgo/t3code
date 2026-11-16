import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { cn } from "../../lib/utils";
import { environmentSummaries } from "../../state/presentation";
import { isOrchestratorTitle } from "../command/fleetOrchestrator";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  type CardCategory,
  type CardChatState,
  type PlacedCard,
  buildCategoryView,
  CARD_CATEGORIES,
  listInitiatives,
  looseCard,
  orderAt,
  placeCard,
} from "./boardCards.logic";
import { useBoard, updateCard } from "./boardStore";
import { CardModal } from "./CardModal";
import { resolveFleetBoardCard } from "./fleetBoard.logic";
import { FleetBoardPage } from "./FleetBoardPage";
import { BoardCardTile, ProjectBoard } from "./ProjectBoard";
import { useFleetBoardThreads } from "./useFleetBoardThreads";

const BoardView = Schema.Literals(["board", "views", "activity"]);
type BoardView = typeof BoardView.Type;
const GroupBy = Schema.Literals(["repo", "initiative"]);
type GroupBy = typeof GroupBy.Type;

const VIEW_OPTIONS: ReadonlyArray<{ readonly id: BoardView; readonly label: string }> = [
  { id: "board", label: "Board" },
  { id: "views", label: "Views" },
  { id: "activity", label: "Activity" },
];

/** Every chat the board can place, with the project (sidebar group) it belongs to. */
function useCardChats(): CardChatState[] {
  const groups = useSidebarProjectGroups();
  const { threads } = useFleetBoardThreads(false);
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
        since: resolved.since ?? thread.updatedAt,
      };
    });
}

export function BoardPage() {
  const [view, setView] = useLocalStorage("t3-fleet:board-view", "board" as BoardView, BoardView);
  const switcher = (
    <ToggleGroup
      aria-label="Board view"
      className="shrink-0"
      value={[view]}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "board" || value === "views" || value === "activity") setView(value);
      }}
    >
      {VIEW_OPTIONS.map((option) => (
        <Toggle key={option.id} value={option.id}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
  if (view === "activity") return <FleetBoardPage viewSwitcher={switcher} />;
  return <CardsPage view={view} switcher={switcher} />;
}

function CardsPage(props: {
  readonly view: "board" | "views";
  readonly switcher: React.ReactNode;
}) {
  const board = useBoard();
  const chats = useCardChats();
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
  const [hideDone, setHideDone] = useState(true);
  const [open, setOpen] = useState<{ id: string; sequence: ReadonlyArray<string> } | null>(null);

  const labelByEnvironment = new Map<string, string>(
    environments.map((environment) => [environment.environmentId, environment.environmentLabel]),
  );
  const showMachines = environments.filter((environment) => environment.isEnabled).length > 1;
  const machineLabel = (environmentId: string) =>
    showMachines ? (labelByEnvironment.get(environmentId) ?? null) : null;
  const projectLabel = new Map(groups.map((group) => [group.projectKey, group.displayName]));
  const projectKey = projectLabel.has(storedProject)
    ? storedProject
    : (groups[0]?.projectKey ?? "");
  const initiatives = listInitiatives(board.document);
  const initiative =
    initiatives.find((name) => name.toLowerCase() === storedInitiative.toLowerCase()) ??
    initiatives[0] ??
    null;
  const byInitiative = groupBy === "initiative" && initiative !== null;
  const projects = groups.map((group) => ({
    projectKey: group.projectKey,
    displayName: group.displayName,
  }));

  const openPlaced = (() => {
    if (!open) return null;
    const stored = board.document.cards.find((card) => card.id === open.id);
    if (stored) return placeCard(stored, chats);
    const chat = chats.find((entry) => `chat:${entry.environmentId}:${entry.threadId}` === open.id);
    return chat ? looseCard(chat) : null;
  })();
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
          <h1 className="hidden shrink-0 text-sm font-medium sm:block">Board</h1>
          {props.switcher}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {board.error ??
              (board.storage === "browser"
                ? "Saved in this browser only. Open the hub to share it."
                : "")}
          </span>
        </WorkspacePageHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
          {props.view === "board" ? (
            <>
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
                    value={projectKey}
                    onValueChange={(value) => {
                      if (typeof value === "string") setStoredProject(value);
                    }}
                  >
                    <SelectTrigger aria-label="Repo" size="sm" className="w-full">
                      <SelectValue>{projectLabel.get(projectKey) ?? "Pick a repo"}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
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
            </>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5">
              <Switch
                id="board-hide-done"
                size="sm"
                checked={hideDone}
                onCheckedChange={setHideDone}
              />
              <Label htmlFor="board-hide-done">Hide done</Label>
            </div>
          )}
          {props.view === "board" ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <Switch
                id="board-planning"
                size="sm"
                checked={planning}
                onCheckedChange={setPlanning}
              />
              <Label htmlFor="board-planning">Planning</Label>
            </div>
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
        ) : props.view === "board" ? (
          <div className="flex min-h-0 flex-1 flex-col pt-2">
            {planning ? (
              <p className="px-4 pb-2 text-xs text-muted-foreground">
                Planning: add and arrange cards. Nothing starts until you start a chat.
                {byInitiative
                  ? ` New cards go to ${projectLabel.get(projectKey) ?? "the last repo you picked"}; change it on the card.`
                  : ""}
              </p>
            ) : null}
            <ProjectBoard
              scope={
                byInitiative ? { kind: "initiative", initiative } : { kind: "project", projectKey }
              }
              newCardProjectKey={projectKey}
              document={board.document}
              chats={chats}
              planning={planning}
              machineLabel={machineLabel}
              projectLabel={(key) => projectLabel.get(key) ?? "Unknown project"}
              onOpen={openCard}
            />
          </div>
        ) : (
          <CategoryViews
            chats={chats}
            hideDone={hideDone}
            projectLabel={(key) => projectLabel.get(key) ?? "Unknown project"}
            machineLabel={machineLabel}
            onOpen={openCard}
          />
        )}
      </div>
      {openPlaced && open ? (
        <CardModal
          placed={openPlaced}
          chats={chats}
          projects={projects}
          initiatives={initiatives}
          sequence={open.sequence}
          onNavigate={navigateCard}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </SidebarInset>
  );
}

const VIEW_COLUMNS: ReadonlyArray<{ readonly id: CardCategory | "none"; readonly label: string }> =
  [...CARD_CATEGORIES, { id: "none", label: "No category" }];

/** Every project's cards at a glance, one column per category. Drag to recategorize. */
function CategoryViews(props: {
  readonly chats: ReadonlyArray<CardChatState>;
  readonly hideDone: boolean;
  readonly projectLabel: (projectKey: string) => string;
  readonly machineLabel: (environmentId: string) => string | null;
  readonly onOpen: (cardId: string, sequence: ReadonlyArray<string>) => void;
}) {
  const board = useBoard();
  const view = buildCategoryView(board.document, props.chats);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );
  const visible = (list: ReadonlyArray<PlacedCard>) =>
    props.hideDone ? list.filter((placed) => placed.stage !== "done") : list;
  const sequence = VIEW_COLUMNS.flatMap((column) =>
    visible(view[column.id]).map((placed) => placed.card.id),
  );
  const categoryOf = new Map(
    board.document.cards.map((card) => [card.id, card.category ?? "none"] as const),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const target =
      (event.over?.data.current?.category as CardCategory | "none" | undefined) ??
      (overId ? categoryOf.get(overId) : undefined);
    if (!target) return;
    const list = visible(view[target]).filter((placed) => placed.card.id !== id);
    const overIndex = list.findIndex((placed) => placed.card.id === overId);
    updateCard(id, {
      category: target === "none" ? null : target,
      ...(categoryOf.get(id) === target
        ? { order: orderAt(list, overIndex === -1 ? list.length : overIndex) }
        : {}),
    });
  };

  if (board.document.cards.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>No cards yet</EmptyTitle>
          <EmptyDescription>
            Turn on Planning on the Board view to add cards, then give each one a category.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-4 py-3">
        {VIEW_COLUMNS.map((column) => (
          <CategoryColumn
            key={column.id}
            id={column.id}
            label={column.label}
            cards={visible(view[column.id])}
            projectLabel={props.projectLabel}
            machineLabel={props.machineLabel}
            onOpen={(id) => props.onOpen(id, sequence)}
          />
        ))}
      </div>
    </DndContext>
  );
}

function CategoryColumn(props: {
  readonly id: CardCategory | "none";
  readonly label: string;
  readonly cards: ReadonlyArray<PlacedCard>;
  readonly projectLabel: (projectKey: string) => string;
  readonly machineLabel: (environmentId: string) => string | null;
  readonly onOpen: (cardId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `category:${props.id}`,
    data: { category: props.id },
  });
  const needsYou = props.cards.filter((placed) => placed.needsYou).length;
  return (
    <section
      ref={setNodeRef}
      aria-label={props.label}
      className={cn(
        "flex max-h-full w-72 max-w-[85vw] shrink-0 flex-col rounded-lg border border-border bg-muted/40",
        props.id === "critical" && "border-t-2 border-t-destructive",
        isOver && "border-ring",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {props.label}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{props.cards.length}</span>
        {needsYou > 0 ? (
          <span className="ms-auto text-2xs text-warning-foreground">{needsYou} need you</span>
        ) : null}
      </header>
      <SortableContext
        items={props.cards.map((placed) => placed.card.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="flex min-h-8 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {props.cards.map((placed) => (
            <BoardCardTile
              key={placed.card.id}
              placed={placed}
              stage={placed.stage}
              showStage
              projectLabel={props.projectLabel(placed.card.projectKey)}
              machineLabel={props.machineLabel}
              onOpen={() => props.onOpen(placed.card.id)}
            />
          ))}
        </ol>
      </SortableContext>
    </section>
  );
}
