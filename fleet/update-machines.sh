#!/usr/bin/env bash
# Ask every fleet machine to pull the latest and refresh its agent skills (no T3 restart), then
# show where each one stands. The same as "Update all machines" on the Board's Agents tab.
#
#   fleet/update-machines.sh          ask, then list the machines
#   fleet/update-machines.sh status   only list them
set -euo pipefail
hub="${T3_FLEET_HUB_URL:-$(cat "$HOME/.config/t3-fleet/hub-url" 2>/dev/null || echo https://t3-hub.tail0392d7.ts.net)}"
[[ "${1:-}" == "status" ]] || curl -fsS -X POST "$hub/fleet/updates/request" >/dev/null
curl -fsS "$hub/fleet/updates" | node -e '
const { request, machines } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
console.log(request ? `Update asked ${request.at} (${request.id})` : "No update asked yet");
for (const m of Object.values(machines)) {
  const state = request && m.requestDone !== request.id ? "updating…" : m.ok ? "up to date" : "did not update";
  console.log(`- ${m.machine}: ${state} at ${m.commit} (seen ${m.seenAt})${m.clientBehind ? " · client needs install-client.sh" : ""}${m.ok ? "" : ` · ${m.result}`}`);
}'
