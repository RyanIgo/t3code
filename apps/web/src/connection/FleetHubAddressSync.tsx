import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { isHostedStaticApp } from "../hostedPairing";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * Fleet fork: on the fleet hub, tell each connected machine the hub's address, so its agents can
 * publish artifacts there. Machines the hub can't write settings on keep T3_FLEET_HUB_URL.
 */
export function FleetHubAddressSync() {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const update = useAtomCommand(serverEnvironment.updateSettings, "Set the fleet hub address");
  const tried = useRef(new Set<EnvironmentId>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the hub's address to each newly connected machine's server settings
  useEffect(() => {
    if (!isHostedStaticApp()) return;
    const hub = window.location.origin;
    for (const [environmentId, config] of configs) {
      if (config.settings.fleetHubUrl === hub || tried.current.has(environmentId)) continue;
      tried.current.add(environmentId);
      void update({ environmentId, input: { patch: { fleetHubUrl: hub } } });
    }
  }, [configs, update]);
  return null;
}
