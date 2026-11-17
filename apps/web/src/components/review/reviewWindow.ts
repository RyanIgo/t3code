import { useSyncExternalStore } from "react";

import { isElectron } from "../../env";

/**
 * Fleet fork: a Review tab is a browser tab showing one chat with no sidebar and its pages,
 * PRs and links on the left. Each chat gets its own tab, named for it, so opening it again
 * focuses that tab. The tab's name marks the mode, so it survives reloads; `?review` in the
 * URL also turns it on.
 */
const REVIEW_WINDOW_NAME = "t3-review";

let reviewWindow: boolean | null = null;

export function isReviewWindow(): boolean {
  if (reviewWindow !== null) return reviewWindow;
  if (typeof window === "undefined") return false;
  if (
    new URLSearchParams(window.location.search).has("review") &&
    !window.name.startsWith(REVIEW_WINDOW_NAME)
  ) {
    window.name = REVIEW_WINDOW_NAME;
  }
  reviewWindow = window.name.startsWith(REVIEW_WINDOW_NAME);
  return reviewWindow;
}

/** The desktop app opens new windows in the system browser, so only the web client offers it. */
export function supportsReviewWindow(): boolean {
  return !isElectron && typeof window !== "undefined" && typeof window.open === "function";
}

/** Opens the chat at `href` in its own Review tab, or brings that tab forward. */
export function openReviewWindow(href: string): boolean {
  const url = new URL(href, window.location.href);
  url.searchParams.set("review", "");
  const opened = window.open(url.toString(), `${REVIEW_WINDOW_NAME}:${url.pathname}${url.hash}`);
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
