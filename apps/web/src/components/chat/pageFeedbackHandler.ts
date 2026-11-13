import type { ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftStore } from "../../composerDraftStore";
import { toastManager } from "../ui/toast";
import {
  formatPageFeedbackMessage,
  type PageFeedback,
  upsertPageContextLine,
} from "./pageFeedback.logic";

/** Turns a page's feedback into a sent message, a draft, or a composer context line. */
export function makePageFeedbackHandler(input: {
  readonly threadRef: ScopedThreadRef | undefined;
  readonly pageTitle: string;
  readonly onSendMessage: ((text: string) => Promise<void>) | undefined;
}): ((feedback: PageFeedback) => Promise<boolean>) | undefined {
  const { threadRef, pageTitle, onSendMessage } = input;
  if (threadRef === undefined) return undefined;
  return async (feedback) => {
    const store = useComposerDraftStore.getState();
    const prompt = store.getComposerDraft(threadRef)?.prompt ?? "";
    if (feedback.action === "context") {
      store.setPrompt(threadRef, upsertPageContextLine(prompt, pageTitle, feedback.text));
      return true;
    }
    const message = formatPageFeedbackMessage(pageTitle, feedback);
    if (feedback.action === "draft") {
      store.setPrompt(threadRef, prompt.trim() === "" ? message : `${prompt}\n\n${message}`);
      return true;
    }
    if (onSendMessage === undefined) {
      toastManager.add({ type: "warning", title: "This page can't send messages here" });
      return false;
    }
    try {
      await onSendMessage(message);
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not send the page's message",
        description: error instanceof Error ? error.message : undefined,
      });
      return false;
    }
  };
}
