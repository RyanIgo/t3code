#!/usr/bin/env bash
# Live review of the hosted UI (Board, Desk, artifacts) without deploying: Vite in hosted mode
# plus a local fleet hub on a copy of the real hub's data. Edits show in the browser in seconds.
#
#   fleet/dev-review.sh start [--from <ssh-host>] [--fresh-data] [--port 5740] [--hub-port 3799]
#   fleet/dev-review.sh stop
#   fleet/dev-review.sh status
#
# Open http://localhost:<port>/board (Windows forwards localhost to WSL). Notes and artifacts
# saved there stay in the copy; Desk lane and field edits go to GitHub for real.
set -euo pipefail

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

command="${1:-}"; shift || true
from="t3hub" fresh=0 port=5740 hub_port=3799
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) from="${2:?}"; shift ;;
    --fresh-data) fresh=1 ;;
    --port) port="${2:?}"; shift ;;
    --hub-port) hub_port="${2:?}"; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state="${XDG_CACHE_HOME:-$HOME/.cache}/t3-fleet-dev"
mkdir -p "$state" && chmod 700 "$state"

alive() { [[ -f "$state/$1.pid" ]] && kill -0 "$(cat "$state/$1.pid")" 2>/dev/null; }

stop_one() {
  if alive "$1"; then
    # Each was started with setsid, so its PID is also its process group.
    kill -- "-$(cat "$state/$1.pid")" 2>/dev/null || true
    echo "Stopped the $1."
  fi
  rm -f "$state/$1.pid"
}

case "$command" in
  stop)
    stop_one vite
    stop_one hub
    exit 0
    ;;
  status)
    for name in hub vite; do
      if alive "$name"; then echo "$name: running (log $state/$name.log)"; else echo "$name: stopped"; fi
    done
    [[ -f "$state/url" ]] && echo "Review at $(cat "$state/url")/board"
    exit 0
    ;;
  start) ;;
  *) usage 1 ;;
esac

if alive hub || alive vite; then
  echo "Already running. Review at $(cat "$state/url")/board (fleet/dev-review.sh stop to end)."
  exit 0
fi

# Data: a copy of the real hub's documents, never the original. The GitHub token stays there.
if [[ "$fresh" == 1 || ! -d "$state/data" ]]; then
  echo "Copying the hub data from $from…"
  mkdir -p "$state/data" && chmod 700 "$state/data"
  rsync -rlpt --delete --exclude github-token "$from:t3-fleet-hub/data/" "$state/data/"
fi
login="$(ssh "$from" "systemctl --user show t3-fleet-hub -p Environment" | tr ' ' '\n' \
  | sed -n 's/^HUB_OWNERS=\([^,]*\).*/\1/p')"
[[ -n "$login" ]] || { echo "Could not read the hub owner's login from $from." >&2; exit 1; }
token="$(gh auth token 2>/dev/null || true)"
[[ -n "$token" ]] || echo "No gh login here: the Desk will be empty (run gh auth login)." >&2

# The hub runs from the working tree's files, like a deploy would ship them.
mkdir -p "$state/hub"
cp "$repo_root/fleet/hub/server.mjs" "$repo_root/fleet/hub/desk.mjs" "$state/hub/"
node --input-type=module -e '
  const shared = await import(process.argv[1]);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.argv[2], JSON.stringify({ sheetHtml: shared.artifactSheetHtml(), themeHead: shared.artifactThemeHead() }));
' "$repo_root/packages/shared/src/artifacts.ts" "$state/hub/artifact-assets.json"

url="http://localhost:$port"
echo "$url" > "$state/url"

HUB_PORT="$hub_port" HUB_OWNERS="$login" HUB_DATA="$state/data" HUB_WEB="$state/hub/no-web" \
  HUB_GITHUB_TOKEN="$token" setsid node "$state/hub/server.mjs" > "$state/hub.log" 2>&1 < /dev/null &
echo $! > "$state/hub.pid"

(
  cd "$repo_root/apps/web"
  # Never set VITE_HTTP_URL / VITE_WS_URL: the hosted app connects to each machine itself.
  unset VITE_HTTP_URL VITE_WS_URL
  export PORT="$port" VITE_HOSTED_APP_URL="$url" \
    T3_FLEET_DEV_HUB="http://127.0.0.1:$hub_port" T3_FLEET_DEV_LOGIN="$login"
  setsid vp dev > "$state/vite.log" 2>&1 < /dev/null &
  echo $! > "$state/vite.pid"
)

echo "Waiting for the dev server…"
for _ in $(seq 1 90); do
  if curl -sf "$url/fleet/whoami" > /dev/null 2>&1; then
    echo "Review at $url/board"
    echo "Logs: $state/hub.log, $state/vite.log. Stop: fleet/dev-review.sh stop"
    exit 0
  fi
  if ! alive hub || ! alive vite; then break; fi
  sleep 1
done
echo "Did not come up. Check $state/hub.log and $state/vite.log." >&2
exit 1
