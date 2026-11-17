import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { htmlRenderFileName, type HtmlRenderReference } from "@t3tools/shared/htmlRender";
import * as Schema from "effect/Schema";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  GlobeIcon,
  LinkIcon,
  ListChecksIcon,
  LogOutIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { openUrlInPreview } from "~/browser/openFileInPreview";
import { readThreadPreviewState } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

import { useLongLivedAssetUrl } from "~/assets/longLivedAssetUrls";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import {
  useQuietThreadShell,
  useThreadHistory,
  useThreadVisibleTurnItems,
} from "../../state/entities";
import { previewEnvironment } from "../../state/preview";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { makePageFeedbackHandler } from "../chat/pageFeedbackHandler";
import { ArtifactFrame } from "../chat/ArtifactFrame";
import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import {
  collectReviewLinks,
  collectReviewPages,
  collectReviewPullRequests,
  collectReviewSheets,
  reviewAppTarget,
  type ReviewPage,
  type ReviewSheet,
  type ReviewPullRequest,
} from "./reviewItems.logic";
import { QuestionSheetForm } from "./QuestionSheetForm";
import { leaveReviewWindow, useAppMessageSender } from "./reviewWindow";
import ChatMarkdown from "../ChatMarkdown";

const GUIDE_HEIGHT_KEY = "t3-fleet:review-guide-height";
const GUIDE_COLLAPSED_KEY = "t3-fleet:review-guide-collapsed";
const MIN_GUIDE = 160;
const MIN_CHAT = 260;
const LINKS_SHOWN = 8;

type Selection = { readonly kind: "page" | "sheet"; readonly id: string };

const PR_TONE: Record<ReviewPullRequest["state"], string> = {
  open: "border-success/40 text-success-foreground",
  draft: "border-border text-muted-foreground",
  merged: "border-primary/40 text-primary",
  closed: "border-destructive/40 text-destructive-foreground",
  unknown: "border-border text-muted-foreground",
};

function newestSelection(
  page: ReviewPage | undefined,
  sheet: ReviewSheet | undefined,
): Selection | null {
  if (sheet && (!page || sheet.position > page.position)) {
    return { kind: "sheet", id: sheet.sheet.key };
  }
  return page ? { kind: "page", id: page.id } : null;
}

function openInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

// Opened once per chat per window, so closing the tab or browsing elsewhere sticks.
const autoOpenedApps = new Set<string>();

function sessionUrl(snapshot: { readonly navStatus: { readonly _tag: string } }): string | null {
  return "url" in snapshot.navStatus && typeof snapshot.navStatus.url === "string"
    ? snapshot.navStatus.url
    : null;
}

/**
 * Fleet fork: the Review window's guide, above the chat. It holds what to review (question
 * sheets, pages, PRs, links); the app itself opens in T3's browser on the right.
 */
export function ReviewGuidePane(props: { readonly threadRef: ScopedThreadRef }) {
  const threadKey = scopedThreadKey(props.threadRef);
  const thread = useQuietThreadShell(props.threadRef);
  const turnItems = useThreadVisibleTurnItems(props.threadRef);
  const pages = collectReviewPages(turnItems);
  const sheets = collectReviewSheets(turnItems);
  // Long chats load their recent history first; older pages arrive with earlier history.
  const history = useThreadHistory(props.threadRef);
  const loadEarlierHistory = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier thread history",
    reportFailure: false,
  });
  const loadEarlier = () =>
    void loadEarlierHistory({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId },
    });
  const pullRequests = collectReviewPullRequests(thread?.pullRequests ?? []);
  const links = collectReviewLinks(
    turnItems.flatMap(({ item }) =>
      item.type === "assistant_message" && !item.streaming ? [item.text] : [],
    ),
    new Set(pullRequests.map((pr) => pr.url)),
  );
  const appTarget = reviewAppTarget(links);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const openInBrowser = async (url: string) => {
    const existing = Object.values(readThreadPreviewState(props.threadRef).sessions).find(
      (session) => sessionUrl(session) === url,
    );
    if (existing) {
      useRightPanelStore.getState().openBrowser(props.threadRef, existing.tabId);
      return;
    }
    const result = await openUrlInPreview({ threadRef: props.threadRef, url, openPreview });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not open the browser",
        description: "Check that this machine can reach the address, then try again.",
      });
    }
  };
  const appUrl = appTarget?.url ?? null;
  const openAppInBrowser = useEffectEvent((url: string) => void openInBrowser(url));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the app under review in the server's browser once per chat in this window
  useEffect(() => {
    if (appUrl === null || autoOpenedApps.has(threadKey)) return;
    autoOpenedApps.add(threadKey);
    openAppInBrowser(appUrl);
  }, [appUrl, threadKey]);

  // Null follows the newest page or question sheet, so one the agent just made opens by itself.
  const [chosen, setChosen] = useState<Selection | null>(null);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const selection: Selection | null =
    chosen !== null &&
    (chosen.kind === "page"
      ? pages.some((page) => page.id === chosen.id)
      : sheets.some((entry) => entry.sheet.key === chosen.id))
      ? chosen
      : newestSelection(pages[0], sheets[0]);
  const page = selection?.kind === "page" ? pages.find((p) => p.id === selection.id) : undefined;
  const sheet =
    selection?.kind === "sheet"
      ? sheets.find((entry) => entry.sheet.key === selection.id)?.sheet
      : undefined;

  const [storedHeight, setStoredHeight] = useLocalStorage(GUIDE_HEIGHT_KEY, 0, Schema.Number);
  const [collapsed, setCollapsed] = useLocalStorage(GUIDE_COLLAPSED_KEY, false, Schema.Boolean);
  const [dragTop, setDragTop] = useState<{ readonly top: number; readonly height: number } | null>(
    null,
  );
  const maxHeight = Math.max(MIN_GUIDE, window.innerHeight - MIN_CHAT);
  const height = Math.min(
    maxHeight,
    Math.max(MIN_GUIDE, dragTop?.height ?? (storedHeight || Math.round(window.innerHeight * 0.45))),
  );

  return (
    <section
      aria-label="Review"
      style={collapsed ? undefined : { height }}
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col border-b border-border bg-background",
        dragTop !== null && "pointer-events-none select-none",
      )}
    >
      <header className="flex min-w-0 items-center gap-2 border-b border-border py-2 pr-32 pl-3">
        <span className="text-2xs font-semibold tracking-wider text-primary uppercase">Review</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {thread?.title ?? "Chat"}
        </span>
        {appTarget ? (
          <Button size="xs" variant="outline" onClick={() => void openInBrowser(appTarget.url)}>
            <GlobeIcon aria-hidden />
            <span className="max-w-40 truncate">{new URL(appTarget.url).host}</span>
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={collapsed ? "Show the review guide" : "Hide the review guide"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronDownIcon aria-hidden /> : <ChevronUpIcon aria-hidden />}
        </Button>
        <Button size="xs" variant="ghost" onClick={leaveReviewWindow}>
          <LogOutIcon aria-hidden />
          Normal window
        </Button>
      </header>
      {collapsed ? null : (
        <>
          <nav
            aria-label="Things to review"
            className="flex max-h-[40%] shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-border px-3 py-2"
          >
            {pullRequests.length > 0 ? (
              <ItemRow
                icon={<PullRequestGlyph.pullRequest aria-hidden className="size-3.5" />}
                label="PRs"
              >
                {pullRequests.map((pr) => (
                  <a
                    key={pr.url}
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex max-w-64 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent",
                      PR_TONE[pr.state],
                    )}
                  >
                    <span className="truncate">{pr.label}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground">{pr.state}</span>
                  </a>
                ))}
              </ItemRow>
            ) : null}
            {sheets.length > 0 ? (
              <ItemRow icon={<ListChecksIcon aria-hidden className="size-3.5" />} label="Asks">
                {sheets.map((entry, index) => (
                  <Chip
                    key={entry.sheet.key}
                    active={selection?.kind === "sheet" && selection.id === entry.sheet.key}
                    onClick={() => setChosen({ kind: "sheet", id: entry.sheet.key })}
                  >
                    {entry.sheet.title}
                    <span className="text-2xs text-muted-foreground">
                      {entry.sheet.questions.length}
                      {index === 0 ? " · latest" : ""}
                    </span>
                  </Chip>
                ))}
              </ItemRow>
            ) : null}
            <ItemRow icon={<FileCode2Icon aria-hidden className="size-3.5" />} label="Pages">
              {pages.length === 0 && !history.hasMoreHistory ? (
                <span className="text-xs text-muted-foreground">None yet</span>
              ) : (
                pages.map((p, index) => (
                  <Chip
                    key={p.id}
                    active={selection?.kind === "page" && selection.id === p.id}
                    onClick={() => setChosen({ kind: "page", id: p.id })}
                  >
                    {p.title}
                    {index === 0 ? (
                      <span className="text-2xs text-muted-foreground">latest</span>
                    ) : null}
                  </Chip>
                ))
              )}
              {history.hasMoreHistory ? (
                <button
                  type="button"
                  disabled={history.loading}
                  onClick={loadEarlier}
                  className="inline-flex cursor-pointer items-center rounded-md px-1.5 py-0.5 text-xs text-primary outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default disabled:opacity-60"
                >
                  {history.loading ? "Loading…" : "Load earlier"}
                </button>
              ) : null}
            </ItemRow>
            {links.length > 0 ? (
              <ItemRow icon={<LinkIcon aria-hidden className="size-3.5" />} label="Links">
                {(showAllLinks ? links : links.slice(0, LINKS_SHOWN)).map((l) => (
                  <Chip
                    key={l.url}
                    active={false}
                    onClick={() => (l.embeddable ? void openInBrowser(l.url) : openInNewTab(l.url))}
                  >
                    {l.tailscale ? <GlobeIcon aria-hidden className="size-3 shrink-0" /> : null}
                    {l.label}
                    {l.embeddable ? null : (
                      <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
                    )}
                  </Chip>
                ))}
                {links.length > LINKS_SHOWN ? (
                  <button
                    type="button"
                    onClick={() => setShowAllLinks((all) => !all)}
                    className="inline-flex cursor-pointer items-center rounded-md px-1.5 py-0.5 text-xs text-primary outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    {showAllLinks ? "Fewer" : `${links.length - LINKS_SHOWN} more`}
                  </button>
                ) : null}
              </ItemRow>
            ) : null}
          </nav>
          <div className="relative min-h-0 flex-1">
            {page ? (
              <ReviewPageView
                key={page.id}
                environmentId={props.threadRef.environmentId}
                threadRef={props.threadRef}
                page={page}
              />
            ) : sheet ? (
              <div className="size-full overflow-y-auto p-4">
                <QuestionSheetForm
                  key={sheet.key}
                  sheet={sheet}
                  threadRef={props.threadRef}
                  renderMarkdown={(markdown) => (
                    <ChatMarkdown text={markdown} cwd={undefined} threadRef={props.threadRef} />
                  )}
                />
              </div>
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm font-medium text-foreground">Nothing to review here yet</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  When the agent builds a review page or asks a set of questions, it opens here. The
                  app itself opens in the browser on the right when the agent posts its Tailscale
                  address.
                </p>
              </div>
            )}
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the review guide"
            tabIndex={0}
            className="absolute inset-x-0 -bottom-1 z-10 h-2 cursor-row-resize outline-hidden hover:bg-primary/30 focus-visible:bg-primary/50"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragTop({ top: event.clientY - height, height });
            }}
            onPointerMove={(event) => {
              if (dragTop !== null) setDragTop({ ...dragTop, height: event.clientY - dragTop.top });
            }}
            onPointerUp={() => {
              if (dragTop !== null) setStoredHeight(Math.round(height));
              setDragTop(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") setStoredHeight(Math.max(MIN_GUIDE, height - 40));
              if (event.key === "ArrowDown") setStoredHeight(Math.min(maxHeight, height + 40));
            }}
          />
        </>
      )}
    </section>
  );
}

function ItemRow(props: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="flex w-14 shrink-0 items-center gap-1 pt-0.5 text-2xs text-muted-foreground uppercase">
        {props.icon}
        {props.label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">{props.children}</div>
    </div>
  );
}

function Chip(props: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={cn(
        "inline-flex max-w-64 cursor-pointer items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        props.active
          ? "border-primary bg-primary text-primary-foreground [&_span]:text-primary-foreground/80"
          : "border-border text-foreground hover:bg-accent",
      )}
    >
      {props.children}
    </button>
  );
}

function ReviewPageView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly page: ReviewPage;
}) {
  const send = useAppMessageSender(scopedThreadKey(props.threadRef));
  if (props.page.artifact) {
    return (
      <div className="flex size-full flex-col">
        <ArtifactFrame
          artifact={props.page.artifact}
          threadRef={props.threadRef}
          onSendMessage={send}
          fill
        />
      </div>
    );
  }
  return (
    <ReviewRenderView
      environmentId={props.environmentId}
      threadRef={props.threadRef}
      htmlRender={props.page.htmlRender}
      send={send}
    />
  );
}

function ReviewRenderView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly htmlRender: HtmlRenderReference;
  readonly send: ((text: string) => Promise<void>) | undefined;
}) {
  const { attachmentId, title } = props.htmlRender;
  const send = props.send;
  const onPageFeedback = makePageFeedbackHandler({
    threadRef: props.threadRef,
    pageTitle: title,
    onSendMessage: send,
  });
  // The frame keeps the first URL it loads, so later mints do not reload the page.
  const [src, setSrc] = useState<string | null>(null);
  const assetUrl = useLongLivedAssetUrl(src === null ? props.environmentId : null, {
    _tag: "attachment",
    attachmentId,
    fileName: htmlRenderFileName(title),
    mimeType: "text/html",
    disposition: "inline",
  });
  if (src === null && assetUrl._tag === "Success") setSrc(assetUrl.url);
  if (src === null) {
    return (
      <p className="flex size-full items-center justify-center text-xs text-muted-foreground">
        {assetUrl._tag === "Failure" ? `Unable to load ${title}` : `Loading ${title}…`}
      </p>
    );
  }
  return (
    <HtmlRenderDocument
      src={src}
      title={title}
      threadRef={props.threadRef}
      className="block size-full"
      onPageFeedback={onPageFeedback}
    />
  );
}
