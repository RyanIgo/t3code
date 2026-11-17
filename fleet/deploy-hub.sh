#!/usr/bin/env bash
# Deploy the fleet hub: the fork's UI as a hosted web app plus fleet/hub/server.mjs, on an
# always-on Linux host on your tailnet (for example a DigitalOcean droplet).
#
#   fleet/deploy-hub.sh <ssh-host> --setup --owner you@example.com   first time
#   fleet/deploy-hub.sh <ssh-host>                                    later updates
#   fleet/deploy-hub.sh <ssh-host> --hub-only                         only server.mjs/desk.mjs changed
#
# Uploads only files that changed since the running release (rsync, hard links for the rest),
# over one reused ssh connection.
#
# The host needs Node 20+ and Tailscale. Everything lives in ~/t3-fleet-hub there and runs as
# a systemd user service behind `tailscale serve` (HTTPS on the host's tailnet name).
set -euo pipefail

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

host="" setup=0 owner="" port=3790 hub_only=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup) setup=1 ;;
    --owner) owner="${2:?--owner needs your Tailscale login}"; shift ;;
    --port) port="${2:?}"; shift ;;
    --hub-only) hub_only=1 ;;
    -h|--help) usage 0 ;;
    -*) echo "Unknown option: $1" >&2; usage 1 ;;
    *) host="$1" ;;
  esac
  shift
done
[[ -n "$host" ]] || usage 1
if [[ "$setup" == 1 && -z "$owner" ]]; then
  echo "--setup needs --owner <your Tailscale login>." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote_root='$HOME/t3-fleet-hub'
if [[ "$setup" == 1 && "$hub_only" == 1 ]]; then
  echo "--setup needs the UI too; drop --hub-only." >&2
  exit 1
fi

# One ssh connection for the whole deploy (each new one costs over a second).
control_dir="$(mktemp -d)"
ssh_opts=(-o ControlMaster=auto -o "ControlPath=$control_dir/%C" -o ControlPersist=60)
ssh() { command ssh "${ssh_opts[@]}" "$@"; }

echo "Checking $host…"
ssh "$host" 'command -v node >/dev/null && node -e "process.exit(Number(process.versions.node.split(\".\")[0]) >= 20 ? 0 : 1)"' \
  || { echo "$host needs Node 20 or newer." >&2; exit 1; }
hub_name="$(ssh "$host" "tailscale status --json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
[[ -n "$hub_name" ]] || { echo "Could not read $host's Tailscale name." >&2; exit 1; }
hub_url="https://$hub_name"
echo "Hub address: $hub_url"

# A separate output folder, so this machine's own client build in apps/web/dist is untouched.
out_dir="$(mktemp -d)"
trap 'command ssh "${ssh_opts[@]}" -O exit "$host" 2>/dev/null; rm -rf "$out_dir" "$control_dir"' EXIT
if [[ "$hub_only" == 1 ]]; then
  echo "Keeping the running release's UI (--hub-only)."
else
  echo "Building the hosted UI…"
  (
    cd "$repo_root/apps/web"
    # Never set VITE_HTTP_URL / VITE_WS_URL: the hosted app connects to each machine itself.
    unset VITE_HTTP_URL VITE_WS_URL
    VITE_HOSTED_APP_URL="$hub_url" vp build --outDir "$out_dir/web" --emptyOutDir
  )
fi
cp "$repo_root/fleet/hub/server.mjs" "$out_dir/server.mjs"
cp "$repo_root/fleet/hub/desk.mjs" "$out_dir/desk.mjs"
# Artifact pages (test sheet, page theme) come from packages/shared so they match T3's look.
node --input-type=module -e '
  const shared = await import(process.argv[1]);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.argv[2], JSON.stringify({ sheetHtml: shared.artifactSheetHtml(), themeHead: shared.artifactThemeHead() }));
' "$repo_root/packages/shared/src/artifacts.ts" "$out_dir/artifact-assets.json"

release="$(date -u +%Y%m%d-%H%M%S)"
echo "Uploading release $release…"
ssh "$host" "mkdir -p $remote_root/releases $remote_root/data && chmod 700 $remote_root/data"
if [[ "$hub_only" == 1 ]]; then
  ssh "$host" "test -d $remote_root/current/web && mkdir -p $remote_root/releases/$release \
    && cp -al $remote_root/current/web/. $remote_root/releases/$release/web" \
    || { echo "No running release to keep the UI from; deploy without --hub-only." >&2; exit 1; }
fi
# Unchanged files (same content) become hard links to the running release's copies; the
# link-dest path is relative to the new release folder. The first deploy has nothing to link to.
rsync -rlpt --checksum --compress -e "ssh ${ssh_opts[*]}" \
  --link-dest="../../current/" \
  "$out_dir/" "$host:t3-fleet-hub/releases/$release/" \
  || rsync -rlpt --checksum --compress -e "ssh ${ssh_opts[*]}" "$out_dir/" "$host:t3-fleet-hub/releases/$release/"

if [[ "$setup" == 1 ]]; then
  echo "Setting up the service and tailscale serve…"
  ssh "$host" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/t3-fleet-hub.service" <<UNIT
[Unit]
Description=T3 fleet hub (UI and shared connections)
After=network-online.target

[Service]
Environment=HUB_PORT=$port
Environment=HUB_OWNERS=$owner
Environment=HUB_WEB=%h/t3-fleet-hub/current/web
Environment=HUB_DATA=%h/t3-fleet-hub/data
ExecStart=$(ssh "$host" 'command -v node') %h/t3-fleet-hub/current/server.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  ssh "$host" "loginctl enable-linger \$USER 2>/dev/null || sudo loginctl enable-linger \$USER; systemctl --user daemon-reload && systemctl --user enable t3-fleet-hub"
  ssh "$host" "tailscale serve --bg --https=443 http://127.0.0.1:$port 2>/dev/null || sudo tailscale serve --bg --https=443 http://127.0.0.1:$port" \
    || echo "Run on $host: sudo tailscale serve --bg --https=443 http://127.0.0.1:$port" >&2
fi

echo "Switching to the new release…"
ssh "$host" "cd $remote_root && ln -sfn releases/$release current && systemctl --user restart t3-fleet-hub \
  && ls -1dt releases/* | tail -n +4 | xargs -r rm -rf"

sleep 1
login="$(ssh "$host" "systemctl --user show t3-fleet-hub -p Environment" | tr ' ' '\n' | sed -n 's/^HUB_OWNERS=\([^,]*\).*/\1/p')"
if ssh "$host" "curl -sf -H 'Tailscale-User-Login: $login' http://127.0.0.1:$port/fleet/whoami" >/dev/null; then
  echo "Hub is up: $hub_url"
else
  echo "The hub service did not answer. Check: ssh $host journalctl --user -u t3-fleet-hub -n 50" >&2
  exit 1
fi
