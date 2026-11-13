import { useNavigate, useParams } from "@tanstack/react-router";
import { PlusIcon, RadarIcon, XIcon } from "lucide-react";
import * as Schema from "effect/Schema";

import { cn } from "../../lib/utils";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useEnvironmentIdentities } from "../../state/environments";
import {
  type FleetBoardTone,
  formatFleetBoardAge,
  resolveFleetBoardCard,
} from "../board/fleetBoard.logic";
import { type BoardThread, useFleetBoardThreads } from "../board/useFleetBoardThreads";
import { useSidebar } from "../ui/sidebar";
import {
  isOrchestratorTitle,
  orchestratorDigestLine,
  orchestratorDisplayTitle,
} from "./fleetOrchestrator";
import { ORCHESTRATOR_ROLES, useStartOrchestrator } from "./useStartOrchestrator";

const INTRO_HIDDEN_KEY = "t3-fleet:command-intro-hidden";

const TONE_RAIL: Record<FleetBoardTone, string> = {
  attention: "bg-warning",
  failed: "bg-destructive",
  working: "bg-info motion-safe:animate-status-pulse",
  done: "bg-success",
  quiet: "bg-primary/40",
};

const TONE_TEXT: Record<FleetBoardTone, string> = {
  attention: "text-warning-foreground",
  failed: "text-destructive-foreground",
  working: "text-info-foreground",
  done: "text-foreground",
  quiet: "text-muted-foreground",
};

/** Orchestrator chats, settled or not: they are standing chats, not tasks. */
function useOrchestratorThreads(): {
  readonly threads: BoardThread[];
  readonly nowMs: number;
} {
  const { threads, nowMs } = useFleetBoardThreads(true);
  return { threads: threads.filter((thread) => isOrchestratorTitle(thread.title)), nowMs };
}

/**
 * Fleet fork: the Command panel. Orchestrator chats live here, apart from the
 * work they oversee, each card showing its status and the gist of its latest
 * reply. The sidebar stacks the cards; the board lays them out in a row.
 */
export function CommandPanel({ layout }: { readonly layout: "sidebar" | "board" }) {
  const { threads, nowMs } = useOrchestratorThreads();
  const identities = useEnvironmentIdentities();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { environmentId: routeEnvironmentId, threadId: routeThreadId } = useParams({
    strict: false,
  });
  const startOrchestrator = useStartOrchestrator();
  const [introHidden, setIntroHidden] = useLocalStorage(INTRO_HIDDEN_KEY, false, Schema.Boolean);
  const missingRoles = ORCHESTRATOR_ROLES.filter(
    ({ role }) =>
      !threads.some((thread) =>
        orchestratorDisplayTitle(thread.title).toLowerCase().startsWith(role.toLowerCase()),
      ),
  );
  if (threads.length === 0) {
    if (layout === "sidebar" && introHidden) return null;
    return (
      <section
        aria-label="Command"
        className={cn(
          "rounded-lg border border-dashed border-primary/40 bg-primary/[0.04]",
          layout === "sidebar" ? "mx-2 mt-1 mb-2 p-2" : "p-3",
        )}
      >
        <h2 className="flex items-center gap-1.5 text-2xs font-semibold tracking-wider text-primary uppercase">
          <RadarIcon aria-hidden className="size-3.5" />
          Command
          {layout === "sidebar" ? (
            <button
              type="button"
              aria-label="Hide the Command intro"
              onClick={() => setIntroHidden(true)}
              className="ms-auto cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon aria-hidden className="size-3" />
            </button>
          ) : null}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Chats that watch your other chats and GitHub board, and report what matters. Pick one,
          then press send in the chat it opens.
        </p>
        <div
          className={cn(
            "mt-2 gap-1.5",
            layout === "sidebar"
              ? "flex flex-col"
              : "grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]",
          )}
        >
          {ORCHESTRATOR_ROLES.map(({ role, summary }) => (
            <button
              key={role}
              type="button"
              onClick={() => startOrchestrator(role)}
              className="flex cursor-pointer flex-col gap-0.5 rounded-md border border-primary/30 bg-card/70 px-2.5 py-1.5 text-left outline-hidden hover:border-primary/60 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                <PlusIcon aria-hidden className="size-3.5 text-primary" />
                Start {role}
              </span>
              <span className="text-xs text-muted-foreground">{summary}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }
  const labelById = new Map(
    identities.map((identity) => [identity.environmentId, identity.label] as const),
  );
  const open = (thread: BoardThread) => {
    if (layout === "sidebar" && isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.id },
    });
  };
  return (
    <section
      aria-label="Command"
      className={cn(
        "rounded-lg border border-primary/30 bg-primary/[0.06]",
        layout === "sidebar" ? "mx-2 mt-1 mb-2 p-1.5" : "p-2",
      )}
    >
      <h2 className="flex items-center gap-1.5 px-1 pb-1.5 text-2xs font-semibold tracking-wider text-primary uppercase">
        <RadarIcon aria-hidden className="size-3.5" />
        Command
        <span className="font-normal text-muted-foreground tabular-nums">{threads.length}</span>
        <span className="ms-auto flex items-center gap-1 font-normal tracking-normal normal-case">
          {missingRoles.map(({ role }) => (
            <button
              key={role}
              type="button"
              onClick={() => startOrchestrator(role)}
              className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm px-1 text-muted-foreground hover:text-primary"
            >
              <PlusIcon aria-hidden className="size-3" />
              {role}
            </button>
          ))}
        </span>
      </h2>
      <ul
        className={cn(
          "m-0 list-none gap-1.5 p-0",
          layout === "sidebar"
            ? "flex flex-col"
            : "grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]",
        )}
      >
        {threads.map((thread) => {
          const card = resolveFleetBoardCard(thread);
          const active = thread.environmentId === routeEnvironmentId && thread.id === routeThreadId;
          const latest = thread.source.latestVisibleMessage;
          const digest = latest?.role === "assistant" ? orchestratorDigestLine(latest.text) : null;
          const age = formatFleetBoardAge(card.since, nowMs);
          const machine = labelById.size > 1 ? (labelById.get(thread.environmentId) ?? null) : null;
          return (
            <li key={`${thread.environmentId}:${thread.id}`} className="min-w-0">
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => open(thread)}
                className={cn(
                  "relative flex w-full min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden rounded-md border py-1.5 ps-3 pe-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active
                    ? "border-primary/60 bg-primary/15"
                    : "border-transparent bg-card/70 hover:border-primary/30 hover:bg-card",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-1 left-1 w-[3px] rounded-full",
                    active ? "bg-primary" : TONE_RAIL[card.tone],
                  )}
                />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {orchestratorDisplayTitle(thread.title)}
                  </span>
                  {age ? (
                    <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                      {age}
                    </span>
                  ) : null}
                </span>
                <span className={cn("truncate text-xs", TONE_TEXT[card.tone])}>
                  {card.nextStep}
                </span>
                {digest ? (
                  <span
                    className={cn(
                      "text-xs text-muted-foreground",
                      layout === "sidebar" ? "truncate" : "line-clamp-2",
                    )}
                  >
                    {digest}
                  </span>
                ) : null}
                {machine ? (
                  <span className="truncate text-2xs text-muted-foreground">{machine}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
