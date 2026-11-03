import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFleetBoard,
  sortByFleetBoardUrgency,
  formatFleetBoardAge,
  minuteTickToMs,
  resolveFleetBoardCard,
  type FleetBoardThreadInput,
} from "./fleetBoard.logic";

const desktop = EnvironmentId.make("env-desktop");
const laptop = EnvironmentId.make("env-laptop");
const warehouse = ProjectId.make("project-warehouse");
const drawings = ProjectId.make("project-drawings");

function thread(
  overrides: Omit<Partial<FleetBoardThreadInput>, "id"> & { id: string },
): FleetBoardThreadInput {
  return {
    environmentId: desktop,
    projectId: warehouse,
    title: overrides.id,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    pendingGuestMessageCount: 0,
    interactionMode: "default",
    latestRun: null,
    runtime: null,
    blockedOnThreadWait: false,
    updatedAt: "2026-11-01T10:00:00.000Z",
    linkedPullRequest: null,
    lastVisitedAt: null,
    ...overrides,
    id: ThreadId.make(overrides.id),
  };
}

function runtime(
  status: NonNullable<FleetBoardThreadInput["runtime"]>["status"],
  extra: Partial<NonNullable<FleetBoardThreadInput["runtime"]>> = {},
): FleetBoardThreadInput["runtime"] {
  return {
    status,
    activeRunId: null,
    activityStartedAt: "2026-11-01T09:50:00.000Z",
    providerInstanceId: "claudeAgent" as never,
    providerName: null,
    lastError: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...extra,
  };
}

function completedRun(completedAt: string): FleetBoardThreadInput["latestRun"] {
  return {
    runId: "run-1" as never,
    status: "completed",
    requestedAt: null,
    startedAt: "2026-11-01T09:00:00.000Z",
    completedAt,
    assistantMessageId: null,
  };
}

describe("resolveFleetBoardCard", () => {
  it("puts pending approvals and questions in Needs me", () => {
    expect(resolveFleetBoardCard(thread({ id: "a", hasPendingApprovals: true }))).toMatchObject({
      column: "needs",
      tone: "attention",
      nextStep: "Approve a pending request",
    });
    expect(resolveFleetBoardCard(thread({ id: "b", hasPendingUserInput: true }))).toMatchObject({
      column: "needs",
      nextStep: "Answer a question",
    });
  });

  it("only shows Plan ready when the sidebar would", () => {
    const planned = {
      hasActionableProposedPlan: true,
      latestRun: completedRun("2026-11-01T09:30:00.000Z"),
      lastVisitedAt: "2026-11-01T09:45:00.000Z",
    };
    expect(
      resolveFleetBoardCard(thread({ id: "p1", interactionMode: "plan", ...planned })),
    ).toMatchObject({ column: "needs", nextStep: "Plan ready to review" });
    // Switched back to default mode: the stale flag must not keep it in Needs me.
    expect(
      resolveFleetBoardCard(thread({ id: "p2", interactionMode: "default", ...planned })).column,
    ).toBe("queued");
  });

  it("shows a one-line failure reason", () => {
    const card = resolveFleetBoardCard(
      thread({ id: "f", runtime: runtime("failed", { lastError: "tests\nfailed in worktree" }) }),
    );
    expect(card).toMatchObject({ column: "needs", tone: "failed" });
    expect(card.nextStep).toBe("Failed: tests failed in worktree");
  });

  it("separates running work from work that is still starting", () => {
    expect(resolveFleetBoardCard(thread({ id: "r", runtime: runtime("running") })).column).toBe(
      "running",
    );
    expect(resolveFleetBoardCard(thread({ id: "q", runtime: runtime("queued") })).column).toBe(
      "queued",
    );
  });

  it("marks completions you have not opened as Done, unreviewed", () => {
    const unseen = thread({
      id: "d",
      latestRun: completedRun("2026-11-01T09:30:00.000Z"),
      lastVisitedAt: "2026-11-01T09:00:00.000Z",
      linkedPullRequest: {
        projectId: warehouse,
        repository: "cfe/warehouse",
        number: 212,
        url: "https://example.test/pr/212",
      },
    });
    expect(resolveFleetBoardCard(unseen)).toMatchObject({
      column: "done",
      nextStep: "Review result · PR #212",
    });

    const seen = { ...unseen, lastVisitedAt: "2026-11-01T09:45:00.000Z" };
    expect(resolveFleetBoardCard(seen)).toMatchObject({ column: "queued", tone: "quiet" });
  });
});

describe("buildFleetBoard", () => {
  const groups = [
    {
      projectKey: "drawings",
      displayName: "cfe-drawings",
      memberProjectRefs: [{ environmentId: laptop, projectId: drawings }],
    },
    {
      projectKey: "warehouse",
      displayName: "cfe-data-warehouse",
      // One project folder spanning two machines.
      memberProjectRefs: [
        { environmentId: desktop, projectId: warehouse },
        { environmentId: laptop, projectId: warehouse },
      ],
    },
    { projectKey: "empty", displayName: "empty", memberProjectRefs: [] },
  ];

  it("merges a project across machines and sorts rows that need you first", () => {
    const { rows, totals } = buildFleetBoard(groups, [
      thread({
        id: "draw-run",
        environmentId: laptop,
        projectId: drawings,
        runtime: runtime("running"),
      }),
      thread({ id: "wh-approval", hasPendingApprovals: true }),
      thread({ id: "wh-laptop-run", environmentId: laptop, runtime: runtime("running") }),
      thread({ id: "orphan", projectId: ProjectId.make("unknown") }),
    ]);

    expect(rows.map((row) => row.group.displayName)).toEqual([
      "cfe-data-warehouse",
      "cfe-drawings",
    ]);
    expect(rows[0]?.columns.needs.map((c) => c.thread.id)).toEqual(["wh-approval"]);
    expect(rows[0]?.columns.running.map((c) => c.thread.environmentId)).toEqual([laptop]);
    expect(totals).toEqual({ needs: 1, running: 2, queued: 0, done: 0 });
  });

  it("orders Needs me by longest wait", () => {
    const { rows } = buildFleetBoard(groups, [
      thread({ id: "newer", hasPendingUserInput: true, updatedAt: "2026-11-01T10:05:00.000Z" }),
      thread({ id: "older", hasPendingUserInput: true, updatedAt: "2026-11-01T09:05:00.000Z" }),
    ]);
    expect(rows[0]?.columns.needs.map((c) => c.thread.id)).toEqual(["older", "newer"]);
  });

  it("lists a project's chats as sub-rows, most urgent first", () => {
    const { rows } = buildFleetBoard(groups, [
      thread({ id: "idle", updatedAt: "2026-11-01T11:00:00.000Z" }),
      thread({ id: "run", runtime: runtime("running") }),
      thread({ id: "ask", hasPendingUserInput: true }),
    ]);
    expect(rows[0]?.chats.map((c) => c.thread.id)).toEqual(["ask", "run", "idle"]);
  });
});

describe("sortByFleetBoardUrgency", () => {
  it("puts what needs you first and keeps the given order within a tier", () => {
    const sorted = sortByFleetBoardUrgency(
      [
        thread({ id: "idle-a" }),
        thread({ id: "run", runtime: runtime("running") }),
        thread({ id: "idle-b" }),
        thread({ id: "ask", hasPendingApprovals: true }),
      ],
      (entry) => entry,
    );
    expect(sorted.map((entry) => entry.id)).toEqual(["ask", "run", "idle-a", "idle-b"]);
  });
});

describe("formatFleetBoardAge", () => {
  const now = Date.parse("2026-11-01T12:00:00.000Z");
  it("formats compact ages", () => {
    expect(formatFleetBoardAge("2026-11-01T11:59:30.000Z", now)).toBe("30s");
    expect(formatFleetBoardAge("2026-11-01T11:48:00.000Z", now)).toBe("12m");
    expect(formatFleetBoardAge("2026-11-01T09:00:00.000Z", now)).toBe("3h");
    expect(formatFleetBoardAge("2026-10-29T12:00:00.000Z", now)).toBe("3d");
    expect(formatFleetBoardAge(null, now)).toBeNull();
  });
});

describe("minuteTickToMs", () => {
  it("reads the zone-less minute tick as UTC, not local time", () => {
    expect(minuteTickToMs("2026-11-01T11:05")).toBe(Date.parse("2026-11-01T11:05:00.000Z"));
  });
});
