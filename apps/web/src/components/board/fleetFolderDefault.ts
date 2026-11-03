import {
  getClientSettingsHydratedSnapshot,
  subscribeClientSettingsHydration,
  updateClientSettings,
} from "../../hooks/useSettings";

const APPLIED_KEY = "t3-fleet:folders-default-applied";

/** Returns false until client settings have loaded, so the patch never races hydration. */
function applyFolderDefaultOnce(): boolean {
  if (!getClientSettingsHydratedSnapshot()) return false;
  try {
    if (window.localStorage.getItem(APPLIED_KEY) !== null) return true;
    window.localStorage.setItem(APPLIED_KEY, new Date().toISOString());
  } catch {
    return true; // No storage (private window): leave the setting alone.
  }
  void updateClientSettings({ boringSidebarEnabled: true });
  return true;
}

/**
 * Fleet fork: turn on project folders (the "boring sidebar") once per browser, so the
 * sidebar groups like the board. Turning folders off in Labs afterwards sticks.
 */
export function installFleetFolderDefault(): void {
  if (applyFolderDefaultOnce()) return;
  const unsubscribe = subscribeClientSettingsHydration(() => {
    if (applyFolderDefaultOnce()) unsubscribe();
  });
}
