/**
 * Fleet fork: hub test sheets, for the Now tab and an item's Review tab. A sheet is matched to an
 * item by the chat that published it, the story sheet the Desk made for it, or a "#<n>" in its
 * title that names the item or one of its pull requests.
 */
import { useEffect, useState } from "react";

import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";
import type { DeskNotes } from "./deskNotes.logic";

interface SheetCounts {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly skip: number;
  readonly blocked: number;
}

/** A hub test sheet as the artifact list gives it. */
export interface SheetSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  /** The chat that published it, when it was published from one. */
  readonly thread: { readonly threadId: string } | null;
  readonly counts: SheetCounts;
}

/** The parts of a full sheet the Review tab shows above the checks. */
interface SheetDetail {
  readonly id: string;
  readonly app: { readonly url: string; readonly start?: string; readonly machine?: string } | null;
  readonly rows: ReadonlyArray<{
    readonly url?: string;
    readonly links?: ReadonlyArray<unknown>;
    readonly detail?: string;
  }>;
}

const SHEET_POLL_MS = 60_000;

/** Every test sheet on the hub, refreshed each minute while the page is visible. */
export function useHubSheets(): SheetSummary[] {
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the hub's artifact list for test sheets while open
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/fleet/artifacts", { signal: AbortSignal.timeout(10_000) })
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (body: { artifacts?: Array<SheetSummary & { kind: string }> } | null) => {
            if (live && body?.artifacts) {
              setSheets(body.artifacts.filter((artifact) => artifact.kind === "sheet"));
            }
          },
          () => undefined,
        );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, SHEET_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return sheets;
}

/** One sheet's app block and rows, loaded when the Review tab shows it. */
export function useSheetDetail(id: string | null): SheetDetail | null {
  const [detail, setDetail] = useState<SheetDetail | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the sheet from the hub when the shown sheet changes
  useEffect(() => {
    if (!id) return;
    let live = true;
    fetch(`/fleet/artifacts/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (body: (SheetDetail & { app?: SheetDetail["app"] }) | null) => {
          if (live && body) setDetail({ id, app: body.app ?? null, rows: body.rows ?? [] });
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [id]);
  return detail?.id === id ? detail : null;
}

/** Checks not yet marked. */
export const uncheckedRows = (counts: SheetCounts) =>
  Math.max(0, counts.total - counts.pass - counts.fail - counts.skip - counts.blocked);

/** A sheet an agent left without the app block or a single link to open. */
export function sheetIsIncomplete(detail: SheetDetail): boolean {
  return (
    !detail.app?.url ||
    !detail.rows.some(
      (row) => row.url || (row.links?.length ?? 0) > 0 || /https?:\/\//.test(row.detail ?? ""),
    )
  );
}

/** The sheets that review an item, newest first. */
export function sheetsForItem(
  sheets: ReadonlyArray<SheetSummary>,
  item: DeskItem,
  chats: ReadonlyArray<CardChatState>,
  notes: DeskNotes,
): SheetSummary[] {
  const threads = new Set(chats.map((chat) => chat.threadId));
  const storySheet = item.url ? notes.sheets[item.url]?.id : undefined;
  const numbers = new Set(
    [item.number, ...item.pullRequests.map((pr) => pr.number)].filter(
      (value): value is number => value !== null,
    ),
  );
  // A chat often reviews several PRs, so its sheets count only when their title doesn't name
  // some other item.
  const reviews = (sheet: SheetSummary) => {
    if (sheet.id === storySheet) return true;
    const named = [...sheet.title.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
    if (named.some((number) => numbers.has(number))) return true;
    return named.length === 0 && sheet.thread !== null && threads.has(sheet.thread.threadId);
  };
  return sheets
    .filter(reviews)
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * The item a sheet reviews: the item its chat is on, the story it was made from, or the item (or
 * PR) its title names by number, open ones first. Null when nothing matches.
 */
export function itemForSheet(
  sheet: SheetSummary,
  items: ReadonlyArray<DeskItem>,
  notes: DeskNotes,
): DeskItem | null {
  const byUrl = new Map(items.flatMap((item) => (item.url ? [[item.url, item]] : [])));
  const threadId = sheet.thread?.threadId;
  const focusUrl = threadId
    ? notes.work[threadId]?.items.findLast((span) => span.until === null)?.url
    : undefined;
  if (focusUrl && byUrl.has(focusUrl)) return byUrl.get(focusUrl) ?? null;
  for (const [url, story] of Object.entries(notes.sheets)) {
    if (story.id === sheet.id && byUrl.has(url)) return byUrl.get(url) ?? null;
  }
  const numbers = [...sheet.title.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
  const open = items.filter((item) => item.state === "open" || item.state === "draft");
  for (const list of [open, items]) {
    for (const number of numbers) {
      const found =
        list.find((item) => item.pullRequests.some((pr) => pr.number === number)) ??
        list.find((item) => item.number === number);
      if (found) return found;
    }
  }
  return null;
}

/** The sheets that test a pull request: those whose title names its number, newest first. */
export function sheetsForPullRequest(
  sheets: ReadonlyArray<SheetSummary>,
  number: number | null | undefined,
): SheetSummary[] {
  if (number == null) return [];
  return sheets
    .filter((sheet) =>
      [...sheet.title.matchAll(/#(\d+)/g)].some((match) => Number(match[1]) === number),
    )
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
