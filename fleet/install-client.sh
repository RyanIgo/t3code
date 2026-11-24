#!/usr/bin/env bash
# Install this fork's web client (with the /board page) into the T3 Code
# install on this machine. Only the browser UI changes; the t3 server binary,
# its data, and every other machine stay stock.
#
#   fleet/install-client.sh            build, check versions, swap, restart
#   fleet/install-client.sh --update   also move t3 to the fork's version first
#   fleet/install-client.sh --restore  put the upstream client back
#   fleet/install-client.sh --no-build use the existing apps/web/dist
#   fleet/install-client.sh --force    skip the version match check
#   fleet/install-client.sh --hub URL  where agents here publish artifacts (the fleet hub)
#   fleet/install-client.sh --skills-only  only the agent skills and hook: no build, no restart
#
# A full install also sets up fleet/updater.mjs on a timer: when the Board asks machines to
# update, this checkout pulls and refreshes its skills on its own (never restarting T3).
#
# A `t3 update` installs a fresh upstream client; re-run this afterwards.
# Run from a T3 chat, the update/swap/restart step is handed to a separate
# systemd job (the restart would kill the chat); output goes to fleet/install.log.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
t3_home="${T3CODE_HOME:-$HOME/.t3}"
state_file="$t3_home/runtime/service-state.json"
log_file="$repo_root/fleet/install.log"

# Detached runs and fresh shells may not have these on PATH yet.
export PATH="$PATH:$HOME/.local/bin"
if ! command -v vp >/dev/null && [[ -f "$HOME/.config/vite-plus/env" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.config/vite-plus/env"
fi
# No global vp: use the repo's own copy, installed with its dependencies.
if ! command -v vp >/dev/null && [[ -x "$repo_root/node_modules/.bin/vp" ]]; then
  export PATH="$repo_root/node_modules/.bin:$PATH"
fi

build=1 force=0 restore=0 update=0 detached=0 skills_only=0 hub=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  arg="${args[$i]}"
  case "$arg" in
    --hub) i=$((i + 1)); hub="${args[$i]:-}"; [[ -n "$hub" ]] || { echo "--hub needs the hub's URL" >&2; exit 2; } ;;
    --hub=*) hub="${arg#--hub=}" ;;
    --no-build) build=0 ;;
    --skills-only) skills_only=1 ;;
    --force) force=1 ;;
    --restore) restore=1 ;;
    --update) update=1 ;;
    --detached) detached=1 ;; # internal: already running in its own systemd job
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$state_file" ]]; then
  echo "No T3 Code install found at $t3_home (missing runtime/service-state.json)." >&2
  exit 1
fi

installed_version() {
  sed -n 's/.*"activeVersion": *"\([^"]*\)".*/\1/p' "$state_file"
}

client_paths() {
  client_dir="$t3_home/runtime/versions/$(installed_version)/client"
  backup_dir="$client_dir.upstream"
}

# Agent skills that teach agents the fork's features, for Claude Code and Codex.
install_agent_skills() {
  local skill name target
  for skill in "$repo_root"/fleet/skills/*/; do
    [[ -f "$skill/SKILL.md" ]] || continue
    name="$(basename "$skill")"
    for target in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
      [[ -d "$(dirname "$target")" ]] || continue
      mkdir -p "$target/$name"
      cp -a "$skill/." "$target/$name/"
    done
    echo "Installed agent skill $name."
  done
}

# Claude chats here report each finished turn to their planner (dev-desk's `report --hook`), so
# the planner hears without the chat remembering to tell it. Adds a Stop hook to the user's
# Claude settings once; leaves everything else in them as it is.
install_report_hook() {
  local settings="$HOME/.claude/settings.json"
  [[ -d "$HOME/.claude" ]] || return 0
  node - "$settings" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const command = 'node "$HOME/.claude/skills/dev-desk/desk.mjs" report --hook';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {
  if (error.code !== "ENOENT") { console.error(`Left ${file} alone: it isn't valid JSON.`); process.exit(0); }
}
settings.hooks ??= {};
settings.hooks.Stop ??= [];
const present = settings.hooks.Stop.some((group) =>
  (group.hooks ?? []).some((hook) => /dev-desk\/desk\.mjs"? report --hook/.test(String(hook.command ?? ""))));
if (present) { console.log("Turn reports to planners: already on."); process.exit(0); }
settings.hooks.Stop.push({ hooks: [{ type: "command", command, timeout: 10 }] });
fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
console.log("Turn reports to planners: on (a Stop hook in ~/.claude/settings.json).");
NODE
}

# Runs fleet/updater.mjs every 2 minutes: a systemd user timer on Linux and WSL, launchd on a Mac.
install_updater() {
  local node updater="$repo_root/fleet/updater.mjs"
  node="$(command -v node)" || { echo "No node on PATH: skipped the fleet updater."; return 0; }
  if [[ "$(uname)" == "Darwin" ]]; then
    local plist="$HOME/Library/LaunchAgents/com.t3.fleet-updater.plist"
    mkdir -p "$(dirname "$plist")"
    cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.t3.fleet-updater</string>
  <key>ProgramArguments</key><array><string>$node</string><string>$updater</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string></dict>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$repo_root/fleet/updater.log</string>
  <key>StandardErrorPath</key><string>$repo_root/fleet/updater.log</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/com.t3.fleet-updater" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "Fleet updater: on (launchd, every 2 minutes)."
  elif systemctl --user show-environment >/dev/null 2>&1; then
    local units="$HOME/.config/systemd/user"
    mkdir -p "$units"
    cat >"$units/t3-fleet-updater.service" <<UNIT
[Unit]
Description=Fleet updater: pull and refresh agent skills when the Board asks
[Service]
Type=oneshot
Environment=PATH=$PATH
ExecStart=$node $updater
UNIT
    cat >"$units/t3-fleet-updater.timer" <<UNIT
[Unit]
Description=Check the fleet hub for update requests every 2 minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now t3-fleet-updater.timer >/dev/null
    echo "Fleet updater: on (systemd timer, every 2 minutes)."
  else
    echo "Fleet updater: no systemd or launchd here; run 'node $updater' to update by hand."
  fi
}

restart_service() {
  if t3 service status 2>/dev/null | grep -qi "installed"; then
    t3 service restart
  else
    echo "No background service; restart t3 yourself to pick up the change."
  fi
}

# Restarting the service kills every agent it launched, including a chat that
# is running this script. Re-run the rest in its own systemd job instead.
detach_if_inside_t3() {
  [[ "$detached" == 1 ]] && return 0
  grep -q 'app-t3code' /proc/self/cgroup 2>/dev/null || return 0
  command -v systemd-run >/dev/null || return 0
  local args=(--detached --no-build)
  [[ "$restore" == 1 ]] && args+=(--restore)
  [[ "$update" == 1 ]] && args+=(--update)
  [[ "$force" == 1 ]] && args+=(--force)
  systemd-run --user --collect --quiet --unit="t3-fleet-install-$$" \
    --setenv=PATH="$PATH" --setenv=T3CODE_HOME="$t3_home" \
    bash -c "sleep 3; exec '$repo_root/fleet/install-client.sh' ${args[*]} >'$log_file' 2>&1"
  echo "Running inside T3: the swap and restart continue in a separate job."
  echo "T3 restarts in a few seconds; check $log_file afterwards."
  exit 0
}

if [[ "$skills_only" == 1 ]]; then
  install_agent_skills
  install_report_hook
  exit 0
fi

if [[ "$restore" == 1 ]]; then
  client_paths
  if [[ ! -d "$backup_dir" ]]; then
    echo "Nothing to restore: no $backup_dir." >&2
    exit 1
  fi
  detach_if_inside_t3
  rm -rf "$client_dir"
  mv "$backup_dir" "$client_dir"
  echo "Restored the upstream client for t3 $(installed_version)."
  restart_service
  exit 0
fi

fork_version="$(git -C "$repo_root" describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
fork_version="${fork_version#v}"
needs_update=0
machine_version="$(installed_version)"
if [[ -n "$fork_version" && "$fork_version" != "$machine_version" ]]; then
  newest="$(node -e 'const [a, b] = process.argv.slice(1); const n = (v) => v.split(/[.-]/).map(Number);
const [x, y] = [n(a), n(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) { console.log(x[i] > y[i] ? a : b); process.exit(0); }
console.log(a);' "$fork_version" "$machine_version")"
  if [[ "$newest" == "$machine_version" ]]; then
    # Never move a machine back: the fork has to catch up with it instead.
    cat >&2 <<EOF
The fleet build is behind this machine: it's based on t3 $fork_version, and this machine runs
t3 $machine_version. Installing it would need a downgrade, which the fleet never does.
Bring the fleet branch up to v$machine_version (or newer) first; this machine's agent skills
stay current meanwhile (fleet/install-client.sh --skills-only).
EOF
    [[ "$force" == 1 ]] || exit 1
  elif [[ "$update" == 1 ]]; then
    needs_update=1
  elif [[ "$force" != 1 ]]; then
    cat >&2 <<EOF
This machine runs t3 $machine_version; the fleet build is based on t3 $fork_version.
The web client and server must match. To move this machine up to $fork_version and install:
  fleet/install-client.sh --update
EOF
    exit 1
  fi
fi

if [[ "$build" == 1 ]]; then
  (cd "$repo_root" && vp run --filter @t3tools/web build)
fi
dist_dir="$repo_root/apps/web/dist"
if [[ ! -f "$dist_dir/index.html" ]]; then
  echo "No build at $dist_dir; run without --no-build." >&2
  exit 1
fi

install_agent_skills
install_report_hook
install_updater
if [[ -n "$hub" ]]; then
  mkdir -p "$HOME/.config/t3-fleet"
  printf '%s\n' "$hub" > "$HOME/.config/t3-fleet/hub-url"
  echo "Agents here publish artifacts to $hub."
fi

detach_if_inside_t3

if [[ "$needs_update" == 1 ]]; then
  echo "Moving t3 $(installed_version) to the fork's version $fork_version..."
  t3 update "$fork_version" -y
fi

client_paths
if [[ ! -d "$client_dir" && ! -d "$backup_dir" ]]; then
  echo "Installed version $(installed_version) has no client directory at $client_dir." >&2
  exit 1
fi

# Keep the first upstream copy only, so repeated installs never back up a fork build.
if [[ ! -d "$backup_dir" ]]; then
  cp -a "$client_dir" "$backup_dir"
fi
staging="$client_dir.fleet-staging"
rm -rf "$staging"
cp -a "$dist_dir" "$staging"
rm -rf "$client_dir"
mv "$staging" "$client_dir"
mkdir -p "$HOME/.config/t3-fleet"
git -C "$repo_root" rev-parse HEAD >"$HOME/.config/t3-fleet/client-commit"
echo "Installed the fleet board client into t3 $(installed_version) ($client_dir)."
echo "Upstream copy kept at $backup_dir; undo with: fleet/install-client.sh --restore"
restart_service
