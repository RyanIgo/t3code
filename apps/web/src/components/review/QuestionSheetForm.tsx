import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { CheckIcon, SendIcon, TextCursorInputIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import {
  countAnswered,
  formatSheetAnswers,
  type QuestionSheet,
  type SheetAnswer,
  type SheetQuestion,
} from "./questionSheet.logic";
import { useAppMessageSender } from "./reviewWindow";

const StoredSheet = Schema.Struct({
  answers: Schema.Record(
    Schema.String,
    Schema.Struct({ picked: Schema.Array(Schema.String), text: Schema.String }),
  ),
  sentAt: Schema.NullOr(Schema.String),
});
type StoredSheet = typeof StoredSheet.Type;
const EMPTY: StoredSheet = { answers: {}, sentAt: null };
const NO_ANSWER: SheetAnswer = { picked: [], text: "" };

/**
 * Fleet fork: the form for a question sheet. Answers are kept per chat and sheet in this
 * browser until sent, so a half-answered sheet survives reloads and moving between windows.
 */
export function QuestionSheetForm(props: {
  readonly sheet: QuestionSheet;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly renderMarkdown: (text: string) => ReactNode;
  readonly className?: string;
}) {
  const { sheet, threadRef } = props;
  const threadKey = threadRef ? scopedThreadKey(threadRef) : "none";
  const [stored, setStored] = useLocalStorage(
    `t3-fleet:sheet:${threadKey}:${sheet.key}`,
    EMPTY,
    StoredSheet,
  );
  const send = useAppMessageSender(threadRef ? threadKey : null);
  const [sending, setSending] = useState(false);
  const answered = countAnswered(sheet, stored.answers);

  const update = (question: SheetQuestion, next: SheetAnswer) =>
    setStored({ ...stored, answers: { ...stored.answers, [question.id]: next } });
  const togglePick = (question: SheetQuestion, option: string) => {
    const current = stored.answers[question.id] ?? NO_ANSWER;
    const has = current.picked.includes(option);
    const picked =
      question.pick === "one"
        ? has
          ? []
          : [option]
        : has
          ? current.picked.filter((value) => value !== option)
          : [...current.picked, option];
    update(question, { ...current, picked });
  };

  const message = () => formatSheetAnswers(sheet, stored.answers);
  const putInComposer = () => {
    if (!threadRef) return;
    const store = useComposerDraftStore.getState();
    const prompt = store.getComposerDraft(threadRef)?.prompt ?? "";
    store.setPrompt(threadRef, prompt.trim() === "" ? message() : `${prompt}\n\n${message()}`);
    toastManager.add({ type: "success", title: "Answers are in the message box" });
  };
  const sendNow = async () => {
    if (!send) return putInComposer();
    setSending(true);
    try {
      await send(message());
      setStored({ ...stored, sentAt: new Date().toISOString() });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not send the answers",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-3", props.className)}>
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {sheet.title}
        </h3>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {answered} of {sheet.questions.length} answered
        </span>
      </div>
      {sheet.intro ? (
        <div className="text-sm text-muted-foreground">{props.renderMarkdown(sheet.intro)}</div>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {sheet.questions.map((question) => {
          const answer = stored.answers[question.id] ?? NO_ANSWER;
          const done = answer.picked.length > 0 || answer.text.trim() !== "";
          return (
            <li
              key={question.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-3",
                done ? "border-success/40 bg-success/[0.04]" : "border-border bg-card",
              )}
            >
              <p className="m-0 flex gap-2 text-sm font-medium text-foreground">
                <span
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-2xs tabular-nums",
                    done ? "bg-success text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <CheckIcon aria-hidden className="size-3" /> : question.id}
                </span>
                <span className="min-w-0">{question.title}</span>
              </p>
              {question.body ? (
                <div className="ps-7 text-sm text-muted-foreground">
                  {props.renderMarkdown(question.body)}
                </div>
              ) : null}
              {question.options.length > 0 ? (
                <div
                  role="group"
                  aria-label={question.pick === "one" ? "Pick one" : "Pick any"}
                  className="flex flex-wrap gap-1.5 ps-7"
                >
                  {question.options.map((option) => {
                    const picked = answer.picked.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={picked}
                        onClick={() => togglePick(question, option)}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                          picked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:bg-accent",
                        )}
                      >
                        {picked ? <CheckIcon aria-hidden className="size-3" /> : null}
                        {option}
                      </button>
                    );
                  })}
                  <span className="self-center text-2xs text-muted-foreground">
                    {question.pick === "one" ? "pick one" : "pick any"}
                  </span>
                </div>
              ) : null}
              <textarea
                aria-label={`Answer to question ${question.id}`}
                rows={2}
                value={answer.text}
                placeholder={question.options.length > 0 ? "Add a note (optional)" : "Your answer"}
                onChange={(event) => update(question, { ...answer, text: event.target.value })}
                className="ms-7 min-h-14 resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={sending || !threadRef} onClick={() => void sendNow()}>
          <SendIcon aria-hidden />
          {stored.sentAt ? "Send again" : "Send answers"}
        </Button>
        <Button size="sm" variant="outline" disabled={!threadRef} onClick={putInComposer}>
          <TextCursorInputIcon aria-hidden />
          Put in message box
        </Button>
        <span className="text-xs text-muted-foreground">
          {stored.sentAt
            ? "Sent. Edit and send again to correct anything."
            : answered < sheet.questions.length
              ? "Unanswered questions are sent as skipped."
              : "All answered."}
        </span>
      </div>
    </div>
  );
}
