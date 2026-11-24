/**
 * Fleet fork: a note box on the Board with voice input. T3's own dictation (transcribed on the
 * machine set in Voice settings) when it's set up; otherwise the browser's speech recognition.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { useRef } from "react";

import { TextFieldSpeechControls, useTextFieldSpeech } from "../../speech/useTextFieldSpeech";
import { Textarea } from "../ui/textarea";
import { DictationButton } from "../voice/DictationButton";

export function DeskNoteField(props: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly placeholder: string;
  readonly rows?: number;
  /** The chat's machine, which T3's dictation runs through. */
  readonly environmentId: string;
  readonly onSubmit?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const speech = useTextFieldSpeech({
    environmentId: props.environmentId as EnvironmentId,
    ownerKey: `desk-note:${props.id}`,
    text: props.value,
    textareaRef,
    onTextChange: props.onChange,
  });
  // Browser dictation inserts finished phrases at the end, with a space between.
  const append = (text: string) => {
    const current = textareaRef.current?.value ?? props.value;
    props.onChange(current.trim() ? `${current.replace(/\s+$/, "")} ${text.trim()}` : text.trim());
    return true;
  };
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        ref={textareaRef}
        id={props.id}
        rows={props.rows ?? 3}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && props.onSubmit) {
            event.preventDefault();
            props.onSubmit();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <TextFieldSpeechControls speech={speech} />
        {speech.available ? null : <DictationButton onText={append} />}
      </div>
    </div>
  );
}
