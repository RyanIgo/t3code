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

build=1 force=0 restore=0 update=0 detached=0
for arg in "$@"; do
  case "$arg" in
    --no-build) build=0 ;;
    --force) force=1 ;;
    --restore) restore=1 ;;
    --update) update=1 ;;
    --detached) detached=1 ;; # internal: already running in its own systemd job
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
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
  [[ "$detached" == 1 ]] && return
  grep -q 'app-t3code' /proc/self/cgroup 2>/dev/null || return
  command -v systemd-run >/dev/null || return
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
if [[ "$fork_version" != "$(installed_version)" ]]; then
  if [[ "$update" == 1 && -n "$fork_version" ]]; then
    needs_update=1
  elif [[ "$force" != 1 ]]; then
    cat >&2 <<EOF
Version mismatch: this fork is based on t3 $fork_version, but this machine runs t3 $(installed_version).
The web client and server must match. Either:
  fleet/install-client.sh --update  # move this machine to the fork's version, then install
or rebase the fork onto v$(installed_version). (--force skips this check.)
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
echo "Installed the fleet board client into t3 $(installed_version) ($client_dir)."
echo "Upstream copy kept at $backup_dir; undo with: fleet/install-client.sh --restore"
restart_service
