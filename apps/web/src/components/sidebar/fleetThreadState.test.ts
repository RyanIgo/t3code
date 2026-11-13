import { describe, expect, it } from "vite-plus/test";

import type { ThreadPullRequestLink } from "@t3tools/contracts";

import {
  countFleetThreadStates,
  pullRequestPhase,
  resolveFleetThreadState,
} from "./fleetThreadState";

const link = (
  state: "open" | "closed" | "merged",
  checksState: "passing" | "failing" | "pending" | null = null,
  source: ThreadPullRequestLink["source"] = "agent",
) => ({ source, snapshot: { state, checksState } }) as unknown as ThreadPullRequestLink;

describe("pullRequestPhase", () => {
  it("reads open checks first, then merged", () => {
    expect(pullRequestPhase([])).toBeNull();
    expect(pullRequestPhase([link("merged")])).toBe("merged");
    expect(pullRequestPhase([link("merged"), link("open", "pending")])).toBe("checks-pending");
    expect(pullRequestPhase([link("open", "failing"), link("open", "pending")])).toBe(
      "checks-failing",
    );
    expect(pullRequestPhase([link("open", "passing")])).toBe("open");
    expect(pullRequestPhase([link("open", "failing", "stack-dismissed")])).toBeNull();
    expect(pullRequestPhase([link("closed")])).toBeNull();
  });
});

describe("resolveFleetThreadState", () => {
  it.each([
    ["approval", false, false, "me"],
    ["input", false, false, "me"],
    ["request", false, false, "me"],
    ["failed", false, false, "me"],
    ["limited", false, false, "me"],
    ["ready", true, false, "me"],
    ["ready", false, true, "me"],
    ["working", false, false, "active"],
    ["working", true, false, "me"],
    ["waiting", false, false, "code"],
    ["ready", false, false, "inactive"],
  ] as const)("%s (unread %s, woke %s) is %s", (status, isUnread, isWoke, expected) => {
    expect(resolveFleetThreadState({ status, isUnread, isWoke })).toBe(expected);
  });

  it.each([
    ["ready", false, "merged", "merged"],
    ["ready", true, "merged", "me"],
    ["working", false, "merged", "active"],
    ["ready", false, "checks-pending", "code"],
    ["ready", false, "checks-failing", "me"],
    ["working", false, "checks-failing", "active"],
    ["ready", false, "open", "inactive"],
  ] as const)("%s (unread %s) with PR %s is %s", (status, isUnread, pullRequest, expected) => {
    expect(resolveFleetThreadState({ status, isUnread, isWoke: false, pullRequest })).toBe(
      expected,
    );
  });

  it("counts states", () => {
    expect(countFleetThreadStates(["me", "me", "code"])).toEqual({
      me: 2,
      active: 0,
      code: 1,
      merged: 0,
      inactive: 0,
    });
  });
});
