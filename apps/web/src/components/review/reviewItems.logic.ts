import type { OrchestrationV2ProjectedTurnItem, ThreadPullRequestLink } from "@t3tools/contracts";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import { type ArtifactLink, extractArtifactLinks } from "@t3tools/shared/artifacts";
import { htmlRenderFromToolItem } from "@t3tools/shared/toolOutput";

import { extractQuestionSheets, type QuestionSheet } from "./questionSheet.logic";

/** Fleet fork: what the Review window can show on its left: the chat's pages, PRs and links. */
export type ReviewPage = {
  readonly id: string;
  readonly position: number;
  readonly title: string;
} & (
  | { readonly htmlRender: HtmlRenderReference; readonly artifact?: undefined }
  | { readonly artifact: ArtifactLink; readonly htmlRender?: undefined }
);

export interface ReviewSheet {
  readonly position: number;
  readonly sheet: QuestionSheet;
}

export interface ReviewLink {
  readonly url: string;
  readonly label: string;
  /** Local, private-network and Tailscale pages open in T3's browser; others in a new tab. */
  readonly embeddable: boolean;
  /** A Tailscale address: the app under review, reachable from every machine. */
  readonly tailscale: boolean;
}

export interface ReviewPullRequest {
  readonly url: string;
  readonly label: string;
  readonly state: "open" | "draft" | "merged" | "closed" | "unknown";
}

type TurnItem = Pick<OrchestrationV2ProjectedTurnItem, "position" | "item">;

/** The chat's interactive pages and artifacts, newest first; an artifact once, at its latest. */
export function collectReviewPages(turnItems: ReadonlyArray<TurnItem>): ReviewPage[] {
  const pages: ReviewPage[] = [];
  const artifacts = new Set<string>();
  for (const { item, position } of turnItems.toSorted((a, b) => b.position - a.position)) {
    if (item.type === "assistant_message" && !item.streaming) {
      for (const artifact of extractArtifactLinks(item.text)) {
        if (artifacts.has(artifact.id)) continue;
        artifacts.add(artifact.id);
        pages.push({ id: `artifact:${artifact.id}`, position, title: artifact.title, artifact });
      }
      continue;
    }
    if (item.type !== "dynamic_tool" || item.status !== "completed") continue;
    const htmlRender = htmlRenderFromToolItem(item);
    if (htmlRender !== undefined) {
      pages.push({ id: item.id, position, title: htmlRender.title, htmlRender });
    }
  }
  return pages;
}

/** The chat's question sheets, newest first and each once. */
export function collectReviewSheets(turnItems: ReadonlyArray<TurnItem>): ReviewSheet[] {
  const sheets: ReviewSheet[] = [];
  const seen = new Set<string>();
  for (const { item, position } of turnItems.toSorted((a, b) => b.position - a.position)) {
    if (item.type !== "assistant_message" || item.streaming) continue;
    for (const sheet of extractQuestionSheets(item.text).toReversed()) {
      if (seen.has(sheet.key)) continue;
      seen.add(sheet.key);
      sheets.push({ position, sheet });
    }
  }
  return sheets;
}

export function collectReviewPullRequests(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReviewPullRequest[] {
  return links
    .filter((link) => link.source !== "stack-dismissed")
    .map((link) => {
      const snapshot = link.snapshot;
      const state: ReviewPullRequest["state"] =
        snapshot === null
          ? "unknown"
          : snapshot.mergedAt
            ? "merged"
            : snapshot.state === "open"
              ? snapshot.isDraft
                ? "draft"
                : "open"
              : snapshot.state === "merged"
                ? "merged"
                : "closed";
      return {
        url: link.url,
        label: `#${link.number}${snapshot ? ` ${snapshot.title}` : ""}`,
        state,
      };
    });
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`\]]+/g;
const MARKDOWN_LINK = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g;

function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?*_~]+$/, "");
  // Drop a closing bracket the URL never opened, as in "(see https://x.dev/a)".
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(/[.,;:!?*_~]+$/, "");
  }
  return url;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".ts.net")) {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  const [a = -1, b = -1] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

const GITHUB_ITEM = /^\/[^/]+\/([^/]+)\/(?:issues|pull)\/(\d+)/;

/** "repo#12" for a GitHub issue or PR, so a bare "#12" still says where it lives. */
function githubItemLabel(url: URL): string | null {
  if (url.hostname !== "github.com") return null;
  const match = GITHUB_ITEM.exec(url.pathname);
  return match ? `${match[1]}#${match[2]}` : null;
}

function isTailscaleHost(hostname: string): boolean {
  if (hostname.toLowerCase().endsWith(".ts.net")) return true;
  const [a = -1, b = -1] = hostname.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function shortLabel(url: URL): string {
  const path = url.pathname === "/" ? "" : url.pathname;
  const label = `${url.host}${path}`;
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}

function pickLabel(written: string | undefined, url: URL): string {
  const github = githubItemLabel(url);
  if (written === undefined) return github ?? shortLabel(url);
  // Link text that is only a number ("#12", "PR #12") gains the repository.
  return github !== null && /^(?:PR |issue )?#?\d+$/i.test(written) ? github : written;
}

/**
 * Links the agent posted, newest first and each once. Pull request links are left out
 * (they have their own row), as is anything that does not parse as a web URL.
 */
export function collectReviewLinks(
  assistantTexts: ReadonlyArray<string>,
  exclude: ReadonlySet<string> = new Set(),
): ReviewLink[] {
  const links: ReviewLink[] = [];
  const seen = new Set(exclude);
  for (const text of assistantTexts.toReversed()) {
    const labels = new Map<string, string>();
    for (const [, label, raw] of text.matchAll(MARKDOWN_LINK)) {
      if (label && raw) labels.set(trimUrl(raw), label.trim());
    }
    for (const [raw] of text.matchAll(URL_PATTERN)) {
      const url = trimUrl(raw);
      if (seen.has(url)) continue;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      seen.add(url);
      links.push({
        url,
        label: pickLabel(labels.get(url), parsed),
        embeddable: isPrivateHost(parsed.hostname),
        tailscale: isTailscaleHost(parsed.hostname),
      });
    }
  }
  return links;
}

/** The app to review: the newest Tailscale link the agent posted. */
export function reviewAppTarget(links: ReadonlyArray<ReviewLink>): ReviewLink | null {
  return links.find((link) => link.tailscale) ?? null;
}
