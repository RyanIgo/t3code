/**
 * Fleet fork: a to-do's helper. Rigo's first question on a planner's to-do forks a hidden side
 * chat from the planner (so it knows the plan), briefed on that one line. It answers on the line
 * with `desk.mjs plan answer --planner`, does what it can itself, and closes when he ticks Done.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { newMessageId, newThreadId } from "../../lib/utils";
import { readThreadShell, waitForThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import type { CardChatState } from "./boardCards.logic";
import type { PlanLine } from "./deskNotes.logic";
import { savePlanLineHelper } from "./deskNotesStore";
import { useSendToChat } from "./deskSend";

const DESK = "node ~/.claude/skills/dev-desk/desk.mjs";

const refOf = (environmentId: string, threadId: string) =>
  scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId);

function answerHow(line: PlanLine, plannerId: string) {
  return `${DESK} plan answer "${line.text}" "<your answer>" --planner ${plannerId} (add --how "<numbered steps>" when the steps change)`;
}

function screenshots(question: string) {
  return question.includes("](http")
    ? "\n\nHis question has screenshots: download each link (curl -o) and look at it first."
    : "";
}

function brief(line: PlanLine, plannerId: string, question: string) {
  return [
    `You're Rigo's helper for one to-do on this planner's checklist. You're a side chat forked from the planner, so you know its plan; he never sees this chat.`,
    "",
    `The to-do: "${line.text}"`,
    line.why ? `Why: ${line.why}` : null,
    line.how ? `Steps:\n${line.how}` : null,
    line.links?.length ? `Links: ${line.links.join(" ")}` : null,
    "",
    "How you work:",
    `- Answer on the to-do, never only here: ${answerHow(line, plannerId)}. He reads only that, in the to-do's panel on the Board.`,
    "- Bullets, short, about this to-do only.",
    "- Do what you can yourself (draft the email, run the check, look it up, prepare the command) and put the result in your answer; leave him only what only he can do.",
    "- If your answer changes what he does, pass --how with the new numbered steps.",
    "- Don't rewrite the checklist (no plan set), start other chats, or work on other items. If it needs the planner, say so in your answer.",
    "",
    `His question: ${question}${screenshots(question)}`,
  ]
    .filter((part) => part !== null)
    .join("\n");
}

export function useTodoHelper() {
  const sendToChat = useSendToChat();
  const forkSideChat = useAtomCommand(threadEnvironment.forkSideChat, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const stopSession = useOrchestrationCommand(threadEnvironment.stopSession, {
    reportFailure: false,
  });
  const archive = useOrchestrationCommand(threadEnvironment.archive, { reportFailure: false });

  /** Sends his question to the line's helper, starting one on its first question. */
  const ask = async (planner: CardChatState, line: PlanLine, question: string) => {
    const { environmentId } = planner;
    if (line.helper && readThreadShell(refOf(environmentId, line.helper))) {
      return sendToChat(
        { environmentId, threadId: line.helper },
        `Rigo asks about "${line.text}": ${question}${screenshots(question)}\n\nAnswer on the to-do: ${answerHow(line, planner.threadId)}.`,
      );
    }
    const source = readThreadShell(refOf(environmentId, planner.threadId));
    if (!source) return false;
    const helper = newThreadId();
    const fork = await forkSideChat({
      environmentId: environmentId as EnvironmentId,
      input: {
        sourceThreadId: planner.threadId as ThreadId,
        targetThreadId: helper,
        title: `To-do: ${line.text.slice(0, 60)}`,
      },
    });
    if (fork._tag === "Failure" || !(await waitForThreadShell(refOf(environmentId, helper))))
      return false;
    savePlanLineHelper(planner.threadId, line.text, helper);
    const turn = await startTurn({
      environmentId: environmentId as EnvironmentId,
      input: {
        threadId: helper,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: brief(line, planner.threadId, question),
          attachments: [],
        },
        modelSelection: source.modelSelection,
        titleSeed: line.text,
        runtimeMode: source.runtimeMode,
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      },
    });
    return turn._tag === "Success";
  };

  /** Done: the helper stops and is archived (it never shows in the sidebar anyway). */
  const finish = async (planner: CardChatState, line: PlanLine) => {
    if (!line.helper) return;
    const environmentId = planner.environmentId as EnvironmentId;
    const threadId = line.helper as ThreadId;
    await stopSession({ environmentId, input: { threadId } });
    await archive({ environmentId, input: { threadId } });
  };

  return { ask, finish };
}
