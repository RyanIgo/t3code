import { useFleetHubSyncStatus } from "../../connection/fleetHubSync";
import { useNowMinute } from "../../hooks/useNowMinute";
import { formatFleetBoardAge, minuteTickToMs } from "../board/fleetBoard.logic";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** Fleet fork: shows whether this browser's saved environments are in step with the hub. */
export function HubSyncSection() {
  const status = useFleetHubSyncStatus();
  const nowMs = minuteTickToMs(useNowMinute());
  if (status === null) return null;
  const age = formatFleetBoardAge(status.at, nowMs);
  const title =
    status.state === "synced"
      ? "Synced with the hub"
      : status.state === "offline"
        ? "Hub not reachable"
        : "Hub sync failed";
  const when = age ? `${age} ago` : "just now";
  return (
    <SettingsSection title="Hub">
      <SettingsRow
        title={title}
        description={`${status.message ?? "Every device that opens this hub gets these environments."} Version ${status.version}, ${when}.`}
        control={
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    </SettingsSection>
  );
}
