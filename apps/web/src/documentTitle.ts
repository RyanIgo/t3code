/**
 * Fleet fork: the browser tab shows the chat it holds ("<thread> · T3 Code"), so several
 * popped-out chats stay findable among tabs. Falls back to the app's name elsewhere.
 */
let appTitle = typeof document === "undefined" ? "" : document.title;
let threadTitle: string | null = null;

function apply() {
  if (typeof document === "undefined") return;
  document.title = threadTitle ? `${threadTitle} · ${appTitle}` : appTitle;
}

export function setAppDocumentTitle(title: string): void {
  appTitle = title;
  apply();
}

/** Shows `title` in the tab until the returned function is called. */
export function showThreadInDocumentTitle(title: string): () => void {
  threadTitle = title.trim() || null;
  apply();
  return () => {
    if (threadTitle !== (title.trim() || null)) return;
    threadTitle = null;
    apply();
  };
}
