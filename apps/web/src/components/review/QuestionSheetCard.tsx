import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { ListChecksIcon, PanelsLeftRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../ui/button";
import type { QuestionSheet } from "./questionSheet.logic";
import { QuestionSheetForm } from "./QuestionSheetForm";
import { isReviewWindow, openReviewWindow, supportsReviewWindow } from "./reviewWindow";

/**
 * Fleet fork: a question sheet inside a chat message. It starts as a short summary; the
 * user answers here or in the Review tab, where the same answers carry over.
 */
export function QuestionSheetCard(props: {
  readonly sheet: QuestionSheet;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly renderMarkdown: (text: string) => ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { sheet, threadRef } = props;
  const canPopOut = threadRef !== undefined && supportsReviewWindow() && !isReviewWindow();
  return (
    <section
      aria-label={`Questions: ${sheet.title}`}
      className="my-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ListChecksIcon aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {sheet.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {sheet.questions.length} question{sheet.questions.length === 1 ? "" : "s"}
        </span>
      </div>
      {open ? (
        <QuestionSheetForm
          className="mt-3"
          sheet={sheet}
          threadRef={threadRef}
          renderMarkdown={props.renderMarkdown}
        />
      ) : (
        <>
          <ol className="mt-2 mb-0 list-decimal ps-8 text-sm text-muted-foreground">
            {sheet.questions.map((question) => (
              <li key={question.id} className="truncate">
                {question.title}
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setOpen(true)}>
              Answer here
            </Button>
            {canPopOut ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  openReviewWindow(
                    router.history.createHref(
                      `/${encodeURIComponent(threadRef.environmentId)}/${encodeURIComponent(threadRef.threadId)}`,
                    ),
                  )
                }
              >
                <PanelsLeftRightIcon aria-hidden />
                Answer in Review tab
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
