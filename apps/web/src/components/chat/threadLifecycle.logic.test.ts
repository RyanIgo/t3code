import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadLifecycle } from "./threadLifecycle.logic";

const pr = (snapshot: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({
    number: 32,
    source: "agent",
    linkedAt: "2026-11-10T00:00:00.000Z",
    snapshot: {
      baseBranch: "main",
      isDraft: false,
      checksState: null,
      reviewDecision: null,
      ...snapshot,
    },
    ...extra,
  }) as unknown as ThreadPullRequestLink;

const base = {
  createdAt: "2026-11-09T00:00:00.000Z",
  status: "ready" as const,
  hasRun: true,
  settledAt: null,
};
const states = (lifecycle: ReturnType<typeof resolveThreadLifecycle>) =>
  Object.fromEntries(lifecycle.stages.map((stage) => [stage.id, stage.state]));

describe("resolveThreadLifecycle", () => {
  it("asks for a pull request after work with none linked", () => {
    const lifecycle = resolveThreadLifecycle({ ...base, pullRequests: [] });
    expect(states(lifecycle)).toMatchObject({ working: "done", pr: "current", merged: "todo" });
    expect(lifecycle.next).toMatch(/No pull request yet/);
  });

  it("blocks on failing checks and requested changes, checks first", () => {
    const lifecycle = resolveThreadLifecycle({
      ...base,
      pullRequests: [
        pr({ state: "open", checksState: "failing", reviewDecision: "changes-requested" }),
      ],
    });
    expect(states(lifecycle)).toMatchObject({ checks: "blocked", review: "blocked" });
    expect(lifecycle.next).toMatch(/Checks are failing/);
  });

  it("points at wrap-up once merged, and is done once settled", () => {
    const merged = pr({ state: "merged", mergedAt: "2026-11-11T00:00:00.000Z" });
    const lifecycle = resolveThreadLifecycle({ ...base, pullRequests: [merged] });
    expect(lifecycle.merged).toBe(true);
    expect(states(lifecycle)).toMatchObject({
      checks: "done",
      review: "done",
      merged: "done",
      settled: "current",
    });
    expect(lifecycle.next).toMatch(/Merged to main\. Wrap up/);
    const settled = resolveThreadLifecycle({
      ...base,
      pullRequests: [merged],
      settledAt: "2026-11-12T00:00:00.000Z",
    });
    expect(states(settled)).toMatchObject({ settled: "done" });
  });

  it("follows the open pull request over an older merged one", () => {
    const lifecycle = resolveThreadLifecycle({
      ...base,
      pullRequests: [
        pr({ state: "merged" }),
        pr({ state: "open", checksState: "pending" }, { number: 40 }),
      ],
    });
    expect(lifecycle.stages.find((stage) => stage.id === "pr")?.detail).toMatch(/^#40/);
    expect(lifecycle.next).toMatch(/Waiting for checks/);
  });
});
