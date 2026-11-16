import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { toastManager } from "../ui/toast";
import plannerPrompt from "./prompts/planner.md?raw";
import reconcilerPrompt from "./prompts/reconciler.md?raw";
import askingPrompt from "./prompts/asking.md?raw";

export type OrchestratorRole = "Planner" | "Reconciler";

export const ORCHESTRATOR_ROLES: ReadonlyArray<{
  readonly role: OrchestratorRole;
  readonly summary: string;
}> = [
  {
    role: "Planner",
    summary: "Follows your GitHub Projects board and issues, ranks priorities, opens issues.",
  },
  {
    role: "Reconciler",
    summary: "Finds duplicate, conflicting, stalled and finished chats across machines.",
  },
];

// Both roles share how they ask questions and show pages; it sits before the closing "sweep" line.
function withAsking(prompt: string): string {
  const closing = prompt.lastIndexOf("\n\nWhen I say");
  return closing === -1
    ? `${prompt.trimEnd()}\n\n${askingPrompt.trim()}\n`
    : `${prompt.slice(0, closing)}\n\n${askingPrompt.trim()}${prompt.slice(closing)}`;
}

const PROMPTS: Record<OrchestratorRole, string> = {
  Planner: withAsking(plannerPrompt),
  Reconciler: withAsking(reconcilerPrompt),
};

/** Opens a new chat with the role's standing prompt in the composer, ready to send. */
export function useStartOrchestrator() {
  const { handleNewThread, defaultProjectRef } = useHandleNewThread();
  return (role: OrchestratorRole) => {
    if (defaultProjectRef === null) {
      toastManager.add({
        type: "warning",
        title: "Add a project first",
        description: "An orchestrator chat lives in a project, though it watches all of them.",
      });
      return;
    }
    void handleNewThread(defaultProjectRef, { prompt: PROMPTS[role] });
  };
}
