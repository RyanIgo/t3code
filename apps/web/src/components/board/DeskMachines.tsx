/**
 * Fleet fork: every machine's fleet checkout, and one button that asks them all to pull the
 * latest and refresh their agent skills (fleet/updater.mjs does it within a couple of minutes,
 * without restarting T3). Installing a changed T3 app restarts T3, so it's offered only for
 * machines the Board sees idle, and only when Rigo presses Install.
 */
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

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
          nowMs - Date.parse(updates.install.at) < INSTALL_LIMIT_MS)),
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
    [`Asked ${clock(install.at)}`, "done"],
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
    props.nowMs - Date.parse(install.at) < DONE_SHOWN_MS;
  const status = (machine: Machine) => {
    if (building(machine))
      return {
        label: `Building the new T3 app · ${minutes(props.nowMs - Date.parse(machine.phaseAt ?? ""))}`,
        tone: "info" as const,
      };
    if (props.nowMs - Date.parse(machine.seenAt) > OFFLINE_MS)
      return { label: `Off since ${time(machine.seenAt)}`, tone: "outline" as const };
    if (request && machine.requestDone !== request.id)
      return { label: "Updating…", tone: "info" as const };
    if (installing(machine))
      return { label: "Install asked · waiting for it to pick up", tone: "info" as const };
    if (!machine.ok) return { label: "Didn't update", tone: "error" as const };
    if (justInstalled(machine))
      return {
        label: `Installed ✓ ${machine.commit ?? ""} · T3 restarted`,
        tone: "success" as const,
      };
    return { label: "Up to date", tone: "success" as const };
  };
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DeskHeading>Machines · {machines.length}</DeskHeading>
        <span className="text-2xs text-muted-foreground">
          {request
            ? (() => {
                const awake = machines.filter(
                  (machine) => props.nowMs - Date.parse(machine.seenAt) <= OFFLINE_MS,
                );
                const done = awake.filter((machine) => machine.requestDone === request.id);
                return done.length < awake.length
                  ? `Update asked ${clock(request.at)}: ${done.length} of ${awake.length} machines done so far.`
                  : `Last update ${time(request.at)}: all ${awake.length} awake machines done.`;
              })()
            : "No update asked for yet."}{" "}
          Update pulls code and agents' skills within 2 minutes without restarting T3; Install puts
          in the new T3 app and restarts T3.
        </span>
        <span className="ml-auto flex gap-1.5">
          {readyToInstall.length > 0 ? (
            <Button
              size="xs"
              variant="outline"
              disabled={asking}
              onClick={() => void askInstall(readyToInstall.map((machine) => machine.machine))}
            >
              Install the new T3 app on {readyToInstall.length} idle{" "}
              {readyToInstall.length === 1 ? "machine" : "machines"}
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
        <ul className="flex flex-col gap-1.5">
          {machines.map((machine) => {
            const shown = status(machine);
            const environment = environmentOf(machine);
            const working = workingOn(machine);
            return (
              <li key={machine.machine} className="flex flex-col gap-0.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-medium">{environment?.environmentLabel ?? machine.machine}</b>
                  <Badge variant={shown.tone} size="sm">
                    {shown.label}
                  </Badge>
                  {working === null ? (
                    <Badge variant="outline" size="sm">
                      Chats unknown
                    </Badge>
                  ) : working.length > 0 ? (
                    <Badge variant="info" size="sm">
                      {working.length} working
                    </Badge>
                  ) : (
                    <Badge variant="outline" size="sm">
                      Idle
                    </Badge>
                  )}
                  <span className="min-w-0 truncate text-2xs text-muted-foreground">
                    {machine.commit} {machine.subject}
                  </span>
                </span>
                {install && (installing(machine) || justInstalled(machine)) ? (
                  <InstallSteps machine={machine} install={install} nowMs={props.nowMs} />
                ) : null}
                {!machine.ok && machine.result ? (
                  <span className="text-xs text-destructive-foreground">{machine.result}</span>
                ) : null}
                {working && working.length > 0 ? (
                  <span className="truncate text-xs text-muted-foreground">
                    Working: {working.map((chat) => chatTitle(chat.title)).join(" · ")}
                  </span>
                ) : null}
                {machine.clientBehind && !installing(machine) ? (
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {working === null
                      ? "New T3 app ready. The Board can't see this machine's chats: install it from a terminal there (fleet/install-client.sh) when nothing runs."
                      : working.length > 0
                        ? `New T3 app ready. Install once the ${working.length} working ${working.length === 1 ? "chat finishes" : "chats finish"} (it restarts T3).`
                        : "New T3 app ready. Nothing is running there."}
                    {working?.length === 0 ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={asking}
                        onClick={() => void askInstall([machine.machine])}
                      >
                        Install (restarts T3)
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
