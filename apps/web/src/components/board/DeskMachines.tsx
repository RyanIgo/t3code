/**
 * Fleet fork: every machine's fleet checkout, and one button that asks them all to pull the
 * latest and refresh their agent skills (fleet/updater.mjs does it within a couple of minutes,
 * without restarting T3). Installing a changed T3 app restarts T3, so it's offered only for
 * machines the Board sees idle, and only when Rigo presses Install.
 */
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { environmentSummaries } from "../../state/presentation";

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
/** The updater checks every 2 minutes; silent for longer than this, the machine is off or asleep. */
const OFFLINE_MS = 10 * 60_000;

const time = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

function useUpdates(): [Updates | null, (next: Updates) => void] {
  const [updates, setUpdates] = useState<Updates | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the hub for machines' update reports while open
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/fleet/updates", { signal: AbortSignal.timeout(10_000) })
        .then((response) => (response.ok ? (response.json() as Promise<Updates>) : null))
        .then(
          (body) => {
            if (live && body) setUpdates(body);
          },
          () => undefined,
        );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return [updates, setUpdates];
}

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

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
  const status = (machine: Machine) => {
    if (props.nowMs - Date.parse(machine.seenAt) > OFFLINE_MS)
      return { label: `Off since ${time(machine.seenAt)}`, tone: "outline" as const };
    if (request && machine.requestDone !== request.id)
      return { label: "Updating…", tone: "info" as const };
    if (installing(machine)) return { label: "Installing… T3 restarts", tone: "info" as const };
    if (!machine.ok) return { label: "Didn't update", tone: "error" as const };
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
          {request ? `Last asked to update ${time(request.at)}.` : "No update asked for yet."}{" "}
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
