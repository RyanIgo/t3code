import { MicIcon, MicOffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type BrowserSpeechRecognition,
  getSpeechRecognition,
  readSpeechResults,
  speechErrorMessage,
} from "./speechRecognition";

/**
 * Fleet fork: dictation into the message box with the browser's built-in speech recognition.
 * Finished phrases are inserted as they arrive; words still being heard show above the button.
 */
export function DictationButton(props: { readonly onText: (text: string) => boolean }) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the microphone if the composer unmounts mid-dictation
  useEffect(() => () => recognitionRef.current?.abort(), []);

  const Recognition = getSpeechRecognition();
  if (Recognition === null) return null;

  const stop = () => recognitionRef.current?.stop();
  const start = () => {
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    let nextIndex = 0;
    recognition.onresult = (event) => {
      const read = readSpeechResults(event.results, nextIndex);
      nextIndex = read.nextIndex;
      if (read.finalText !== "") props.onText(read.finalText);
      setInterim(read.interim);
    };
    recognition.onerror = (event) => {
      const message = speechErrorMessage(event.error);
      if (message) toastManager.add({ type: "error", title: "Dictation", description: message });
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
      setInterim("");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      toastManager.add({ type: "error", title: "Dictation could not start. Try again." });
    }
  };

  const label = listening ? "Stop dictation" : "Dictate";
  return (
    <span className="relative inline-flex">
      {listening ? (
        <span
          role="status"
          className="pointer-events-none absolute start-0 bottom-full mb-2 max-w-72 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm"
        >
          {interim || "Listening…"}
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={listening ? "default" : "ghost"}
              size="icon-sm"
              aria-label={label}
              aria-pressed={listening}
              onPointerDown={(event) => event.preventDefault()}
              onClick={listening ? stop : start}
            />
          }
        >
          {listening ? <MicOffIcon /> : <MicIcon />}
        </TooltipTrigger>
        <TooltipPopup>
          {listening ? "Stop dictation" : "Dictate with your device's built-in speech recognition"}
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
