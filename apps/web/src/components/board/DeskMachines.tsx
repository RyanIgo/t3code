/**
 * Fleet fork: every machine's fleet checkout, and one button that asks them all to pull the
 * latest and refresh their agent skills (fleet/updater.mjs does it within a couple of minutes,
 * without restarting T3). Installing a changed T3 app restarts T3, so it's offered only for
 * machines the Board sees idle, and only when Rigo presses Install.
 */
import { useAtomValue } from "@effect/atom-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { environmentSummaries } from "../../state/presentation";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { CardChatState } from "./boardCards.logic";
import { chatTitle } from "./desk.logic";
import { DeskHeading } from "./DeskParts";

interface Machine {
  readonly machine: string;
  readonly environmentId?: string | null;
  readonly commit: string | null;
  readonly subject: string | null;
  readonly branch: string | null;
  readonly requestDone: string | null;
  readonly installDone?: string | null;
  readonly result: string | null;
  readonly ok: boolean;
  readonly clientBehind: boolean;
  /** Commits on the shared branch this machine hasn't pulled (null from older updaters). */
  readonly behind?: number | null;
  readonly seenAt: string;
  /** Set while it works on a request: "installing" can take many minutes without a report. */
  readonly phase?: "installing" | "updating" | null;
  readonly phaseAt?: string | null;
}

interface Updates {
  readonly request: { readonly id: string; readonly at: string; readonly by: string | null } | null;
  /** The machines last asked to install the new T3 app (each restarts T3 when it does). */
  readonly install?: {
    readonly id: string;
    readonly at: string;
    readonly machines: ReadonlyArray<string>;
    /** When each machine was asked; older hubs only have the shared `at`. */
    readonly askedAt?: Readonly<Record<string, string>>;
  } | null;
  readonly machines: Record<string, Machine>;
}

const POLL_MS = 20_000;
/** While a machine is working on a request, check more often so each step shows promptly. */
const BUSY_POLL_MS = 5_000;
/** The install script's own limit; a build silent for longer than this has failed. */
const INSTALL_LIMIT_MS = 40 * 60_000;
/** How long a finished install stays shown as "Installed", so the result can't be missed. */
const DONE_SHOWN_MS = 30 * 60_000;
/** The updater checks every 2 minutes; silent for longer than this, the machine is off or asleep. */
const OFFLINE_MS = 10 * 60_000;

const time = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const askedAt = (install: NonNullable<Updates["install"]>, machine: string) =>
  install.askedAt?.[machine] ?? install.at;
const minutes = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))} min`;

/** A machine still working on a request that it checked in for recently (asleep ones don't count). */
const inFlight = (updates: Updates, nowMs: number) =>
  Object.values(updates.machines).some(
    (machine) =>
      nowMs - Date.parse(machine.seenAt) <= OFFLINE_MS &&
      (machine.phase != null ||
        (updates.install !== null &&
          updates.install !== undefined &&
          updates.install.machines.includes(machine.machine) &&
          machine.installDone !== updates.install.id &&
          nowMs - Date.parse(askedAt(updates.install, machine.machine)) < INSTALL_LIMIT_MS)),
  );

function useUpdates(): [Updates | null, (next: Updates) => void] {
  const [updates, setUpdates] = useState<Updates | null>(null);
  // Read by the poll timer; a fresh request from a button press counts until the next poll says.
  const busy = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the hub for machines' update reports while open
  useEffect(() => {
    let live = true;
    let last = 0;
    const load = () => {
      last = Date.now();
      return fetch("/fleet/updates", { signal: AbortSignal.timeout(10_000) })
        .then((response) => (response.ok ? (response.json() as Promise<Updates>) : null))
        .then(
          (body) => {
            if (!live || !body) return;
            busy.current = inFlight(body, Date.now());
            setUpdates(body);
          },
          () => undefined,
        );
    };
    void load();
    // Every 5 seconds while a machine is working on a request, else every 20.
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busy.current || Date.now() - last >= POLL_MS) void load();
    }, BUSY_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return [
    updates,
    (next) => {
      busy.current = true;
      setUpdates(next);
    },
  ];
}

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

type Tone = "ok" | "warn" | "bad" | "info";

/** The updater's failure, in words that say what to do. */
function plainError(result: string | null): string {
  if (!result) return "no reason given.";
  if (result.includes("local changes"))
    return "this machine has code edits that aren't saved to git. Commit or discard them there, then update again.";
  if (result.includes("doesn't track"))
    return "its code isn't on a shared branch. Switch it to the fleet branch there.";
  return result;
}

function Line(props: {
  readonly label: string;
  readonly tone: Tone;
  readonly children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-start gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{props.label}</span>
      <span
        aria-hidden
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full",
          props.tone === "ok"
            ? "bg-success"
            : props.tone === "warn"
              ? "bg-warning"
              : props.tone === "bad"
                ? "bg-destructive"
                : "bg-info",
        )}
      />
      <span className={cn("min-w-0", props.tone === "bad" && "text-destructive-foreground")}>
        {props.children}
      </span>
    </span>
  );
}

type StepState = "done" | "now" | "todo" | "failed";

/** Where one machine's install is, step by step, so a long build never looks like nothing. */
function InstallSteps(props: {
  readonly machine: Machine;
  readonly install: NonNullable<Updates["install"]>;
  readonly nowMs: number;
}) {
  const { machine, install } = props;
  const finished = machine.installDone === install.id;
  const building = !finished && machine.phase === "installing" && !!machine.phaseAt;
  const failed = finished && !machine.ok;
  const steps: ReadonlyArray<readonly [string, StepState]> = [
    [`Asked ${clock(askedAt(install, machine.machine))}`, "done"],
    [
      building && machine.phaseAt
        ? `Picked up ${clock(machine.phaseAt)}`
        : "Picked up (within 2 min)",
      building || finished ? "done" : "now",
    ],
    [
      building && machine.phaseAt
        ? `Building · ${minutes(props.nowMs - Date.parse(machine.phaseAt))}`
        : "Build the app",
      finished ? (failed ? "failed" : "done") : building ? "now" : "todo",
    ],
    ["T3 restarts", finished ? (failed ? "todo" : "done") : "todo"],
    [
      finished && !failed ? `Done · ${machine.commit ?? ""}` : "Done",
      finished && !failed ? "done" : "todo",
    ],
  ];
  return (
    <ol aria-label="Install progress" className="flex flex-wrap text-2xs">
      {steps.map(([label, state]) => (
        <li
          key={label}
          className={cn(
            "-me-px flex items-center gap-1 border border-border px-2 py-1",
            state === "done" && "bg-success/10 text-muted-foreground",
            state === "now" && "border-info bg-info/12 font-semibold",
            state === "failed" && "border-destructive bg-destructive/12 font-semibold",
          )}
        >
          {state === "done" ? (
            "✓"
          ) : state === "now" ? (
            <span aria-hidden className="size-1.5 rounded-full bg-info" />
          ) : state === "failed" ? (
            "✕"
          ) : null}
          {label}
        </li>
      ))}
    </ol>
  );
}

export function MachinesCard(props: {
  readonly nowMs: number;
  readonly chats: ReadonlyArray<CardChatState>;
}) {
  const [updates, setUpdates] = useUpdates();
  const environments = useAtomValue(environmentSummaries.environmentsAtom);
  // Reports carry the machine's T3 environment id; older ones only a hostname, matched by name.
  const environmentOf = (machine: Machine) =>
    environments.find((entry) => entry.environmentId === machine.environmentId) ??
    environments.find((entry) => {
      const label = squash(entry.environmentLabel);
      const host = squash(machine.machine);
      return label.length > 2 && (label.includes(host) || host.includes(label));
    }) ??
    null;
  const [asking, setAsking] = useState(false);
  const request = updates?.request ?? null;
  const machines = Object.values(updates?.machines ?? {}).toSorted((a, b) =>
    a.machine.localeCompare(b.machine),
  );
  const ask = async () => {
    setAsking(true);
    try {
      const response = await fetch("/fleet/updates/request", { method: "POST" });
      if (response.ok) setUpdates((await response.json()) as Updates);
    } finally {
      setAsking(false);
    }
  };
  const install = updates?.install ?? null;
  const installing = (machine: Machine) =>
    !!install && install.machines.includes(machine.machine) && machine.installDone !== install.id;
  const askInstall = async (names: ReadonlyArray<string>) => {
    if (names.length === 0) return;
    setAsking(true);
    try {
      const response = await fetch("/fleet/updates/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machines: names }),
      });
      if (response.ok) setUpdates((await response.json()) as Updates);
    } finally {
      setAsking(false);
    }
  };
  const building = (machine: Machine) =>
    installing(machine) &&
    machine.phase === "installing" &&
    !!machine.phaseAt &&
    props.nowMs - Date.parse(machine.phaseAt) < INSTALL_LIMIT_MS;
  const justInstalled = (machine: Machine) =>
    !!install &&
    install.machines.includes(machine.machine) &&
    machine.installDone === install.id &&
    props.nowMs - Date.parse(askedAt(install, machine.machine)) < DONE_SHOWN_MS;
  const rulesLine = (machine: Machine): { text: string; tone: Tone } => {
    if (machine.phase === "updating" || (request && machine.requestDone !== request.id))
      return { text: "Updating now…", tone: "info" };
    if (!machine.ok) return { text: `Couldn't update: ${plainError(machine.result)}`, tone: "bad" };
    if (machine.behind != null && machine.behind > 0)
      return {
        text: `${machine.behind} new ${machine.behind === 1 ? "change" : "changes"} waiting. Press Update all machines.`,
        tone: "warn",
      };
    if (machine.behind === 0) return { text: "Current", tone: "ok" };
    return { text: "Did the last update", tone: "ok" };
  };
  const awake = machines.filter(
    (machine) => props.nowMs - Date.parse(machine.seenAt) <= OFFLINE_MS,
  );
  const doneCount = request
    ? awake.filter((machine) => machine.requestDone === request.id).length
    : 0;
  const updateProgress = !request
    ? null
    : doneCount < awake.length
      ? `Update asked ${clock(request.at)}: ${doneCount} of ${awake.length} machines done so far.`
      : `Last update asked ${time(request.at)}.`;
  const workingOn = (machine: Machine) => {
    const environment = environmentOf(machine);
    return environment
      ? props.chats.filter(
          (chat) => chat.working && chat.environmentId === environment.environmentId,
        )
      : null;
  };
  // Installing restarts T3, so only machines the Board can see are idle.
  const readyToInstall = machines.filter(
    (machine) =>
      machine.clientBehind &&
      !installing(machine) &&
      props.nowMs - Date.parse(machine.seenAt) <= OFFLINE_MS &&
      workingOn(machine)?.length === 0,
  );
  return (
    <section
      aria-label="Machines"
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <DeskHeading>Machines · {machines.length}</DeskHeading>
          <ul className="flex flex-col text-2xs text-muted-foreground">
            <li>
              <b className="font-medium text-foreground">Update all machines</b>: agents get the
              newest rules and code within 2 minutes. Nothing restarts.
            </li>
            <li>
              <b className="font-medium text-foreground">Install</b>: puts the newest T3 app on one
              machine. T3 restarts there, so only idle machines offer it.
            </li>
            {updateProgress ? <li>{updateProgress}</li> : null}
          </ul>
        </div>
        <span className="ml-auto flex gap-1.5">
          {readyToInstall.length > 1 ? (
            <Button
              size="xs"
              variant="outline"
              disabled={asking}
              onClick={() => void askInstall(readyToInstall.map((machine) => machine.machine))}
            >
              Install on all {readyToInstall.length} idle machines
            </Button>
          ) : null}
          <Button size="xs" disabled={asking} onClick={() => void ask()}>
            {asking ? "Asking…" : "Update all machines"}
          </Button>
        </span>
      </div>
      {install && machines.some((machine) => installing(machine)) ? (
        <ul className="flex list-disc flex-col gap-0.5 rounded-md border border-info/40 bg-info/8 py-1.5 ps-6 pe-3 text-xs">
          <li>
            <b>Installing on {install.machines.join(", ")}.</b> Each step below fills in as it
            happens; this card checks every 5 seconds.
          </li>
          <li>
            The machine picks it up within 2 minutes, then builds the new T3 app (several minutes).
          </li>
          <li>T3 restarts there at the end: its windows reload and its chats reconnect.</li>
        </ul>
      ) : null}
      {machines.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No machine reports yet. Run <code>git pull && fleet/install-client.sh</code> once on each
          machine to turn its updater on.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {machines.map((machine) => {
            const environment = environmentOf(machine);
            const working = workingOn(machine);
            const asleep =
              props.nowMs - Date.parse(machine.seenAt) > OFFLINE_MS && !building(machine);
            const rules = rulesLine(machine);
            return (
              <li key={machine.machine} className="flex flex-col gap-1 py-1.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-medium">{environment?.environmentLabel ?? machine.machine}</b>
                  {asleep ? (
                    <Badge variant="outline" size="sm">
                      Asleep or off since {time(machine.seenAt)}
                    </Badge>
                  ) : working === null ? (
                    <Badge variant="outline" size="sm">
                      Can't see its chats
                    </Badge>
                  ) : working.length > 0 ? (
                    <Badge variant="info" size="sm">
                      {working.length} {working.length === 1 ? "chat" : "chats"} working
                    </Badge>
                  ) : (
                    <Badge variant="outline" size="sm">
                      Idle
                    </Badge>
                  )}
                </span>
                {asleep ? null : (
                  <>
                    <Line label="Agents' rules" tone={rules.tone}>
                      {rules.text}
                    </Line>
                    <Line
                      label="T3 app"
                      tone={
                        install && (installing(machine) || justInstalled(machine))
                          ? "info"
                          : machine.clientBehind
                            ? "warn"
                            : "ok"
                      }
                    >
                      {install && (installing(machine) || justInstalled(machine)) ? (
                        <InstallSteps machine={machine} install={install} nowMs={props.nowMs} />
                      ) : !machine.clientBehind ? (
                        "Current"
                      ) : working === null ? (
                        "New version ready. Install it from a terminal on that machine (fleet/install-client.sh) when nothing is running."
                      ) : working.length > 0 ? (
                        `New version ready. Install once its ${working.length} working ${working.length === 1 ? "chat finishes" : "chats finish"}.`
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          New version ready.
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={asking}
                            onClick={() => void askInstall([machine.machine])}
                          >
                            Install now (restarts T3 there)
                          </Button>
                        </span>
                      )}
                    </Line>
                    {working && working.length > 0 ? (
                      <span className="truncate ps-28 text-xs text-muted-foreground">
                        Working: {working.map((chat) => chatTitle(chat.title)).join(" · ")}
                      </span>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
