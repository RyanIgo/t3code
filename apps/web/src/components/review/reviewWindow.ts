import { useSyncExternalStore } from "react";

import { isElectron } from "../../env";

/**
 * Fleet fork: the Review window is a second browser window showing one chat with no
 * sidebar and its pages, PRs and links on the left. The window's name marks it, so the
 * mode survives reloads and moving between chats. `?review` in the URL also turns it on.
 */
const REVIEW_WINDOW_NAME = "t3-review";

let reviewWindow: boolean | null = null;

export function isReviewWindow(): boolean {
  if (reviewWindow !== null) return reviewWindow;
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("review")) window.name = REVIEW_WINDOW_NAME;
  reviewWindow = window.name === REVIEW_WINDOW_NAME;
  return reviewWindow;
}

/** The desktop app opens new windows in the system browser, so only the web client offers it. */
export function supportsReviewWindow(): boolean {
  return !isElectron && typeof window !== "undefined" && typeof window.open === "function";
}

/** Opens (or reuses) the one Review window, showing the chat at `href`. */
export function openReviewWindow(href: string): boolean {
  const opened = window.open(href, REVIEW_WINDOW_NAME, "popup,width=1600,height=1000");
  opened?.focus();
  return opened !== null;
}

/** Turns this window back into a normal T3 window. */
export function leaveReviewWindow(): void {
  window.name = "";
  const url = new URL(window.location.href);
  url.searchParams.delete("review");
  window.location.replace(url);
}

type AppMessageSender = (text: string) => Promise<void>;
const senders = new Map<string, AppMessageSender>();
const listeners = new Set<() => void>();

/**
 * ChatView owns sending a message as the user. It lends that here so the Review pane's pages
 * can send feedback into the chat they belong to. Returns the release function.
 */
export function lendAppMessageSender(threadKey: string, send: AppMessageSender): () => void {
  senders.set(threadKey, send);
  for (const listener of listeners) listener();
  return () => {
    if (senders.get(threadKey) !== send) return;
    senders.delete(threadKey);
    for (const listener of listeners) listener();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppMessageSender(threadKey: string | null): AppMessageSender | undefined {
  return useSyncExternalStore(subscribe, () =>
    threadKey === null ? undefined : senders.get(threadKey),
  );
}
