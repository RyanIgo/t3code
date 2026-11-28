/**
 * Fleet fork: a to-do filled in on the Do form (Board contract, 2026-11-28). What's required of
 * Rigo and why only he can do it, then the steps as tick cards: where to go, how he knows it's
 * done. Ticks are his own progress, kept in this browser.
 */
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { OnlyYou, PlanLine } from "./deskNotes.logic";
import { DeskHeading, openExternal } from "./DeskParts";

const ONLY_YOU_LABEL: Record<OnlyYou, string> = {
  "sign-in": "Needs your sign-in",
  phone: "Needs your phone",
  person: "Needs a person you talk to",
  judgement: "Needs your judgement",
};

function tickKey(line: PlanLine): string {
  return `t3-fleet:do-ticks:${line.since ?? ""}:${line.text}`;
}

function readTicks(line: PlanLine): ReadonlyArray<number> {
  try {
    const raw = window.localStorage.getItem(tickKey(line));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "number") : [];
  } catch {
    return [];
  }
}

export function DoSteps(props: {
  readonly line: PlanLine;
  /** Opens a step's page the Do page's way (beside, or his browser); else a new tab. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
  readonly opensLabel?: ((url: string) => string) | undefined;
  /** "checked 2 h ago": when the planner last rewrote its checklist. */
  readonly checked: string | null;
}) {
  const { line } = props;
  const steps = line.steps ?? [];
  const [ticks, setTicks] = useState<ReadonlyArray<number>>(() => readTicks(line));
  const toggle = (index: number) => {
    const next = ticks.includes(index)
      ? ticks.filter((value) => value !== index)
      : [...ticks, index];
    setTicks(next);
    try {
      window.localStorage.setItem(tickKey(line), JSON.stringify(next));
    } catch {
      // Private window: ticks just don't survive a reload.
    }
  };
  const open = (url: string) => (props.onOpenLink ? props.onOpenLink(url) : openExternal(url));
  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
        <span className="text-xs font-semibold">
          Required from you · {steps.length} step{steps.length === 1 ? "" : "s"}
          {line.minutes ? ` · about ${line.minutes} min` : ""}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {line.onlyYou ? (
            <Badge variant="warning" size="sm">
              {ONLY_YOU_LABEL[line.onlyYou]}
            </Badge>
          ) : null}
          {props.checked ? <span>Checked against its item {props.checked}</span> : null}
        </span>
      </section>
      <section className="flex flex-col gap-1">
        <DeskHeading>Why</DeskHeading>
        <p>{line.why ?? "The planner didn't say why."}</p>
        {line.unblocks ? <p className="text-muted-foreground">Unblocks: {line.unblocks}</p> : null}
      </section>
      <section className="flex flex-col gap-1.5">
        <DeskHeading>
          Steps · {ticks.length} of {steps.length} done
        </DeskHeading>
        <ol className="flex flex-col gap-1.5">
          {steps.map((step, index) => {
            const done = ticks.includes(index);
            return (
              <li
                key={step.text}
                className="flex items-start gap-2.5 rounded-md border border-border border-s-4 border-s-primary px-3 py-2"
              >
                <input
                  id={`do-step-${index}`}
                  type="checkbox"
                  className="mt-1"
                  checked={done}
                  onChange={() => toggle(index)}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <label
                    htmlFor={`do-step-${index}`}
                    className={done ? "text-muted-foreground line-through" : "font-medium"}
                  >
                    {index + 1} · {step.text}
                  </label>
                  {step.goTo ? (
                    <span className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Button size="xs" variant="outline" onClick={() => open(step.goTo ?? "")}>
                        Go to ↗
                      </Button>
                      <span className="text-muted-foreground">
                        {props.opensLabel?.(step.goTo) ?? new URL(step.goTo).hostname}
                      </span>
                    </span>
                  ) : null}
                  {step.doneWhen ? (
                    <span className="text-xs">
                      <span className="font-semibold">Done when:</span> {step.doneWhen}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
