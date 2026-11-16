/**
 * Fleet fork: the browser's built-in speech recognition (Google in Chrome, Apple in Safari).
 * TypeScript's DOM types omit it, so only the parts used here are declared.
 */
interface SpeechAlternative {
  readonly transcript: string;
}

export interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
}

export interface SpeechResultList {
  readonly length: number;
  readonly [index: number]: SpeechResult;
}

export interface BrowserSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: { readonly resultIndex: number; readonly results: SpeechResultList }) => void)
    | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Splits a result list into newly final text (from `fromIndex`) and the words still being
 * heard. `nextIndex` is where the next call should start, so final text is inserted once.
 */
export function readSpeechResults(
  results: SpeechResultList,
  fromIndex: number,
): { readonly finalText: string; readonly interim: string; readonly nextIndex: number } {
  const finals: string[] = [];
  const interim: string[] = [];
  let nextIndex = fromIndex;
  for (let index = fromIndex; index < results.length; index++) {
    const result = results[index];
    const transcript = result?.[0]?.transcript ?? "";
    if (result?.isFinal && nextIndex === index) {
      finals.push(transcript);
      nextIndex = index + 1;
    } else {
      interim.push(transcript);
    }
  }
  const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
  return { finalText: tidy(finals.join(" ")), interim: tidy(interim.join(" ")), nextIndex };
}

/** What to tell the user for a recognition error; null for errors that need no message. */
export function speechErrorMessage(error: string): string | null {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Allow the microphone for this site in the browser's site settings, then try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs an internet connection in this browser.";
    case "no-speech":
    case "aborted":
      return null;
    default:
      return "Dictation stopped unexpectedly. Try again.";
  }
}
