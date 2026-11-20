/**
 * Fleet fork: sends Rigo's message to a chat from the Board (an answer to a planner's question,
 * a nudge after he edits the big picture). Queued behind any turn in progress, never steering it.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { newMessageId } from "../../lib/utils";
import { readThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

export function useSendToChat() {
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (
    chat: { readonly environmentId: string; readonly threadId: string },
    text: string,
  ) => {
    const shell = readThreadShell(
      scopeThreadRef(chat.environmentId as EnvironmentId, chat.threadId as ThreadId),
    );
    if (!shell) return false;
    const result = await startTurn({
      environmentId: chat.environmentId as EnvironmentId,
      input: {
        threadId: chat.threadId as ThreadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        dispatchMode: "queue",
      },
    });
    return result._tag === "Success";
  };
}
