/**
 * Fleet fork: every machine's fleet checkout, and one button that asks them all to pull the
 * latest and refresh their agent skills (fleet/updater.mjs does it within a couple of minutes,
 * without restarting T3). A machine whose T3 client changed says so; installing that restarts T3,
 * so it stays a step Rigo runs on that machine himself.
 */
import { useEffect, useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DeskHeading } from "./DeskParts";

interface Machine {
  readonly machine: string;
  readonly commit: string | null;
  readonly subject: string | null;
  readonly branch: string | null;
  readonly requestDone: string | null;
  readonly result: string | null;
  readonly ok: boolean;
  readonly clientBehind: boolean;
  readonly seenAt: string;
}

interface Updates {
  readonly request: { readonly id: string; readonly at: string; readonly by: string | null } | null;
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

export function MachinesCard(props: { readonly nowMs: number }) {
  const [updates, setUpdates] = useUpdates();
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
  const status = (machine: Machine) => {
    if (props.nowMs - Date.parse(machine.seenAt) > OFFLINE_MS)
      return { label: `Off since ${time(machine.seenAt)}`, tone: "outline" as const };
    if (request && machine.requestDone !== request.id)
      return { label: "Updating…", tone: "info" as const };
    if (!machine.ok) return { label: "Didn't update", tone: "error" as const };
    return { label: "Up to date", tone: "success" as const };
  };
  return (
    <section
      aria-label="Machines"
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DeskHeading>Machines · {machines.length}</DeskHeading>
        <span className="text-2xs text-muted-foreground">
          {request ? `Last asked to update ${time(request.at)}.` : "No update asked for yet."} Each
          pulls and refreshes its agents' skills within 2 minutes; T3 isn't restarted.
        </span>
        <Button size="xs" className="ml-auto" disabled={asking} onClick={() => void ask()}>
          {asking ? "Asking…" : "Update all machines"}
        </Button>
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
            return (
              <li key={machine.machine} className="flex flex-col gap-0.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-medium">{machine.machine}</b>
                  <Badge variant={shown.tone} size="sm">
                    {shown.label}
                  </Badge>
                  <span className="min-w-0 truncate text-2xs text-muted-foreground">
                    {machine.commit} {machine.subject}
                  </span>
                </span>
                {!machine.ok && machine.result ? (
                  <span className="text-xs text-destructive-foreground">{machine.result}</span>
                ) : null}
                {machine.clientBehind ? (
                  <span className="text-xs text-muted-foreground">
                    T3's own screens changed: when nothing is running there, run{" "}
                    <code>fleet/install-client.sh</code> on this machine (it restarts T3).
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
