/**
 * Fleet fork: hub test sheets, for the Now tab and an item's Review tab. A sheet is matched to an
 * item by the story sheet the Desk made for it, a "#<n>" in its title that names the item or one
 * of its pull requests, or the chat recorded on the item having published it.
 */
import { type RefObject, useEffect, useEffectEvent, useState } from "react";

import type { CardChatState } from "./boardCards.logic";
import { type DeskItem, itemByTitleRef } from "./desk.logic";
import { useSendToChat } from "./deskSend";
import { type DeskNotes, focusedThreads } from "./deskNotes.logic";

interface SheetCounts {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly skip: number;
  readonly blocked: number;
  /** Checks the chat fixed that haven't been tested again yet (from a newer hub). */
  readonly retest?: number;
  /** Checks answered with a note but no pass/fail: feedback for the chat (from a newer hub). */
  readonly noted?: number;
}

/** A hub test sheet as the artifact list gives it. */
export interface SheetSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  /** The chat that published it, when it was published from one. */
  readonly thread: { readonly threadId: string } | null;
  readonly counts: SheetCounts;
  /** When Rigo last pressed Submit (from a newer hub). */
  readonly submittedAt?: string | null;
}

/** The parts of a full sheet the Review tab shows above the checks. */
interface SheetDetail {
  readonly id: string;
  readonly app: { readonly url: string; readonly start?: string; readonly machine?: string } | null;
  readonly rows: ReadonlyArray<{
    readonly id?: string;
    readonly title?: string;
    readonly url?: string;
    readonly links?: ReadonlyArray<{ readonly url?: string; readonly label?: string }>;
    readonly detail?: string;
  }>;
  /** Each check's result, by row id. */
  readonly results: Readonly<Record<string, string>>;
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
          if (live && body) {
            const rows = (body as { state?: { rows?: Record<string, { status?: string }> } }).state
              ?.rows;
            setDetail({
              id,
              app: body.app ?? null,
              rows: body.rows ?? [],
              results: Object.fromEntries(
                Object.entries(rows ?? {}).flatMap(([rowId, row]) =>
                  row.status ? [[rowId, row.status]] : [],
                ),
              ),
            });
          }
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [id]);
  return detail?.id === id ? detail : null;
}

/** Checks not yet marked. A note counts as an answer: it's feedback for the chat. */
export const uncheckedRows = (counts: SheetCounts) =>
  Math.max(
    0,
    counts.total - counts.pass - counts.fail - counts.skip - counts.blocked - (counts.noted ?? 0),
  );

/**
 * Whose move a sheet is. "agent": Rigo submitted and the chat hasn't republished since (its
 * fixes come back as re-tests). "rigo": checks left or re-tests. "clean": every check passed or
 * skipped. "issues": answered, with failures or notes, and not submitted.
 */
export function sheetTurn(sheet: SheetSummary): "agent" | "rigo" | "clean" | "issues" {
  const { fail, blocked } = sheet.counts;
  const retest = sheet.counts.retest ?? 0;
  const noted = sheet.counts.noted ?? 0;
  if (retest > 0) return "rigo";
  const submitted =
    sheet.submittedAt != null && Date.parse(sheet.submittedAt) >= Date.parse(sheet.updatedAt);
  if (uncheckedRows(sheet.counts) === 0 && fail + blocked + noted === 0) return "clean";
  if (submitted) return "agent";
  return uncheckedRows(sheet.counts) > 0 ? "rigo" : "issues";
}

/** Each "#n" a title names, with the repo written before it when there is one. */
function titleRefs(title: string): Array<{ repo: string | null; number: number }> {
  return [...title.matchAll(/(?:([\w.-]+)\s?)?#(\d+)/g)].map((match) => ({
    repo: /^[a-z][\w.-]*-[\w.-]+$/i.test(match[1] ?? "") ? (match[1] ?? "").toLowerCase() : null,
    number: Number(match[2]),
  }));
}

/**
 * The sheets that test one pull request: their title names its repo and number, or only its
 * number when the sheet belongs to the same app.
 */
export function sheetsTestingPr(
  sheets: ReadonlyArray<SheetSummary>,
  pr: { readonly repo: string; readonly number: number; readonly app: string | null },
  appOf: (sheet: SheetSummary) => string,
): SheetSummary[] {
  const repo = pr.repo.split("/").pop()?.toLowerCase() ?? "";
  return sheets.filter((sheet) =>
    titleRefs(sheet.title).some(
      (ref) =>
        ref.number === pr.number &&
        (ref.repo === repo || (ref.repo === null && pr.app !== null && appOf(sheet) === pr.app)),
    ),
  );
}

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
  notes: DeskNotes,
): SheetSummary[] {
  // Only the chat recorded on the item: a chat that touched many items (a living list) doesn't
  // make its sheets this item's.
  const threads = focusedThreads(notes, item.url);
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
  return itemByTitleRef(sheet.title, items);
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

/** The Board's Test page for a sheet: the sheet with its work chat, for the left half of the screen. */
export const testPageUrl = (sheetId: string) =>
  new URL(
    `/board#desk=test&sheet=${encodeURIComponent(sheetId)}`,
    window.location.origin,
  ).toString();

/**
 * The sheet in `frame` hands its page its Submit (results go to the work chat) and, when
 * `onOpenLink` is given, its link clicks. Nothing else's messages are listened to.
 */
export function useSheetRelay(
  frame: RefObject<HTMLIFrameElement | null>,
  chat: CardChatState | null,
  title: string,
  onOpenLink?: (url: string) => void,
  /** After the chat got his submitted results. */
  onSubmitted?: () => void,
) {
  const sendToChat = useSendToChat();
  const openLink = useEffectEvent((url: string) => onOpenLink?.(url));
  const relaySubmit = useEffectEvent((id: string | undefined, submitted: string) => {
    const reply = (ok: boolean) =>
      frame.current?.contentWindow?.postMessage({ type: "t3-page:result", id, ok }, "*");
    if (!chat) {
      reply(false);
      return;
    }
    void sendToChat(
      chat,
      `Rigo submitted the test sheet "${title}":\n\n${submitted}\n\nRead the full results and his notes (t3-artifacts), fix what failed, tick the acceptance criteria that passed, then hand it back for a re-check or wrap up.`,
    ).then((ok) => {
      reply(ok);
      if (ok) onSubmitted?.();
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- relays the embedded sheet's link clicks and Submit
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data as { type?: string; id?: string; text?: string; url?: string };
      if (message?.type === "t3-page:open" && typeof message.url === "string") {
        openLink(message.url);
      } else if (message?.type === "t3-page:send" && typeof message.text === "string") {
        relaySubmit(message.id, message.text);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);
}
