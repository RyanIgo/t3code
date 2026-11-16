import { describe, expect, it } from "vite-plus/test";

import { readSpeechResults, type SpeechResultList } from "./speechRecognition";

function results(...items: ReadonlyArray<[string, boolean]>): SpeechResultList {
  return items.map(([transcript, isFinal]) =>
    Object.assign([{ transcript }], { isFinal }),
  ) as unknown as SpeechResultList;
}

describe("readSpeechResults", () => {
  it("returns new final text once and keeps the rest as interim", () => {
    const list = results([" check the", true], [" board ", true], [" and wh", false]);
    expect(readSpeechResults(list, 0)).toEqual({
      finalText: "check the board",
      interim: "and wh",
      nextIndex: 2,
    });
    expect(readSpeechResults(list, 2)).toEqual({ finalText: "", interim: "and wh", nextIndex: 2 });
  });

  it("does not skip past an unfinished result to a later final one", () => {
    const list = results(["hello", false], ["world", true]);
    expect(readSpeechResults(list, 0)).toEqual({
      finalText: "",
      interim: "hello world",
      nextIndex: 0,
    });
  });
});
