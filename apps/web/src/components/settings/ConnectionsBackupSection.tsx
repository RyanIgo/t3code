import { useState } from "react";

import {
  restoreCatalogBackup,
  saveCatalogBackup,
  supportsCatalogBackup,
  useCatalogBackupStatus,
} from "../../connection/fleetCatalogBackup";
import { useNowMinute } from "../../hooks/useNowMinute";
import { formatFleetBoardAge, minuteTickToMs } from "../board/fleetBoard.logic";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

function isPickerCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Fleet fork: a file copy of this browser's saved environments, outside Chrome's storage. */
export function ConnectionsBackupSection() {
  const status = useCatalogBackupStatus();
  const nowMs = minuteTickToMs(useNowMinute());
  const [busy, setBusy] = useState<"save" | "restore" | null>(null);
  if (!supportsCatalogBackup()) return null;

  const save = async () => {
    setBusy("save");
    try {
      const fileName = await saveCatalogBackup();
      toastManager.add({
        type: "success",
        title: "Environments backed up",
        description: `${fileName} now updates whenever your environments change.`,
      });
    } catch (error) {
      if (!isPickerCancel(error)) {
        toastManager.add({ type: "error", title: "Could not save the backup" });
      }
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy("restore");
    try {
      const count = await restoreCatalogBackup();
      toastManager.add({
        type: "success",
        title: `Restored ${count} environment${count === 1 ? "" : "s"}`,
        description: "Reloading to reconnect…",
      });
      window.location.reload();
    } catch (error) {
      if (!isPickerCancel(error)) {
        toastManager.add({
          type: "error",
          title: "Could not restore the backup",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const age = status?.savedAt ? formatFleetBoardAge(status.savedAt, nowMs) : null;
  return (
    <SettingsSection title="Backup">
      <SettingsRow
        title="Back up environments to a file"
        description={
          status
            ? `Saving to ${status.fileName}${age ? `, last saved ${age} ago` : ""}. If saving stops after a browser restart, click Back up to allow it again (choose "Allow on every visit").`
            : "Keeps a copy of your saved environments and their sign-ins in a file on this computer, so clearing browser data can't lose them. Keep the file private."
        }
        control={
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void save()}>
            Back up
          </Button>
        }
      />
      <SettingsRow
        title="Restore from a backup file"
        description="Replaces this browser's saved environments with the ones in the file, then reloads."
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void restore()}
          >
            Restore
          </Button>
        }
      />
    </SettingsSection>
  );
}
