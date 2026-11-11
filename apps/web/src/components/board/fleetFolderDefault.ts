import type { ClientSettingsPatch } from "@t3tools/contracts";

import {
  getClientSettingsHydratedSnapshot,
  subscribeClientSettingsHydration,
  updateClientSettings,
} from "../../hooks/useSettings";

/**
 * Fleet fork defaults, each applied once per browser under its own key, so a default
 * added later still reaches browsers that took the earlier ones. Changing a setting
 * afterwards in Labs sticks.
 */
const FLEET_DEFAULTS: ReadonlyArray<{ readonly key: string; readonly patch: ClientSettingsPatch }> =
  [
    // Project folders, so the sidebar groups like the board.
    { key: "t3-fleet:folders-default-applied", patch: { boringSidebarEnabled: true } },
    // Two-line folder rows, so each chat shows its branch and machine.
    { key: "t3-fleet:multiline-default-applied", patch: { boringSidebarMultilineRows: true } },
  ];

/** Returns false until client settings have loaded, so a patch never races hydration. */
function applyFleetDefaultsOnce(): boolean {
  if (!getClientSettingsHydratedSnapshot()) return false;
  for (const { key, patch } of FLEET_DEFAULTS) {
    try {
      if (window.localStorage.getItem(key) !== null) continue;
      window.localStorage.setItem(key, new Date().toISOString());
    } catch {
      return true; // No storage (private window): leave the settings alone.
    }
    void updateClientSettings(patch);
  }
  return true;
}

export function installFleetFolderDefault(): void {
  if (applyFleetDefaultsOnce()) return;
  const unsubscribe = subscribeClientSettingsHydration(() => {
    if (applyFleetDefaultsOnce()) unsubscribe();
  });
}
