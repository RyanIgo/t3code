import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ArtifactReference } from "@t3tools/shared/artifacts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { readLocalApi } from "../../localApi";
import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { Button } from "../ui/button";
import { makePageFeedbackHandler } from "./pageFeedbackHandler";

const INITIAL_HEIGHT = 420;
const MAX_HEIGHT = 1200;

/**
 * Fleet fork: an artifact shown live from the fleet hub. The hub page saves what the user does
 * itself; Submit comes back here as a page message, like an html_render page's send.
 */
export function ArtifactFrame(props: {
  readonly artifact: ArtifactReference;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly onSendMessage?: ((text: string) => Promise<void>) | undefined;
  /** Fill the parent instead of fitting the page's height (the Review window). */
  readonly fill?: boolean;
}) {
  const { artifact } = props;
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const onPageFeedback = makePageFeedbackHandler({
    threadRef: props.threadRef,
    pageTitle: artifact.title,
    onSendMessage: props.onSendMessage,
  });
  const height = Math.min(MAX_HEIGHT, Math.max(120, contentHeight ?? INITIAL_HEIGHT));
  return (
    <div
      className={
        props.fill
          ? "flex min-h-0 flex-1 flex-col"
          : "flex flex-col overflow-hidden rounded-lg border border-border"
      }
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {artifact.kind === "sheet" ? "Test sheet" : "Page"} · {artifact.title}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            const api = readLocalApi();
            if (api) void api.shell.openExternal(artifact.url).catch(() => undefined);
            else window.open(artifact.url, "_blank", "noopener,noreferrer");
          }}
        >
          <ExternalLinkIcon />
          Open link
        </Button>
      </div>
      <div
        className={props.fill ? "flex min-h-0 flex-1 flex-col" : undefined}
        style={props.fill ? undefined : { height }}
      >
        <HtmlRenderDocument
          // A republish bumps the version; reload so the new rows or page show.
          key={artifact.version}
          src={artifact.url}
          title={artifact.title}
          threadRef={props.threadRef}
          className={props.fill ? "min-h-0 flex-1" : "block size-full"}
          onContentHeight={setContentHeight}
          onPageFeedback={onPageFeedback}
        />
      </div>
    </div>
  );
}
