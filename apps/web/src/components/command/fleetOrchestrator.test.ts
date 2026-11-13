import { describe, expect, it } from "vite-plus/test";

import {
  isOrchestratorTitle,
  orchestratorDigestLine,
  orchestratorDisplayTitle,
  toggleOrchestratorTitle,
} from "./fleetOrchestrator";

describe("orchestrator titles", () => {
  it("recognizes the marker, even with leading space or no gap", () => {
    expect(isOrchestratorTitle("⌘ Planner")).toBe(true);
    expect(isOrchestratorTitle("  ⌘Planner")).toBe(true);
    expect(isOrchestratorTitle("Planner ⌘")).toBe(false);
  });

  it("toggles the marker on and off", () => {
    expect(toggleOrchestratorTitle("Planner")).toBe("⌘ Planner");
    expect(toggleOrchestratorTitle("⌘ Planner")).toBe("Planner");
    expect(orchestratorDisplayTitle("⌘")).toBe("Orchestrator");
  });
});

describe("orchestratorDigestLine", () => {
  it("flattens markdown into one short line", () => {
    expect(orchestratorDigestLine("## Today\n- **Ship** board\n```ts\nx\n```\ndone")).toBe(
      "Today Ship board done",
    );
    expect(orchestratorDigestLine("a".repeat(10), 5)).toBe("aaaa…");
    expect(orchestratorDigestLine("   ")).toBeNull();
  });
});
