#!/usr/bin/env bash
# Install this fork's web client (with the /board page) into the T3 Code
# install on this machine. Only the browser UI changes; the t3 server binary,
# its data, and every other machine stay stock.
#
#   fleet/install-client.sh            build, check versions, swap, restart
#   fleet/install-client.sh --restore  put the upstream client back
#   fleet/install-client.sh --no-build use the existing apps/web/dist
#   fleet/install-client.sh --force    skip the version match check
#
# A `t3 update` installs a fresh upstream client; re-run this afterwards.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
t3_home="${T3CODE_HOME:-$HOME/.t3}"
state_file="$t3_home/runtime/service-state.json"

build=1 force=0 restore=0
for arg in "$@"; do
  case "$arg" in
    --no-build) build=0 ;;
    --force) force=1 ;;
    --restore) restore=1 ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$state_file" ]]; then
  echo "No T3 Code install found at $t3_home (missing runtime/service-state.json)." >&2
  exit 1
fi
installed_version="$(sed -n 's/.*"activeVersion": *"\([^"]*\)".*/\1/p' "$state_file")"
client_dir="$t3_home/runtime/versions/$installed_version/client"
backup_dir="$client_dir.upstream"
if [[ ! -d "$client_dir" && ! -d "$backup_dir" ]]; then
  echo "Installed version $installed_version has no client directory at $client_dir." >&2
  exit 1
fi

restart_service() {
  if t3 service status 2>/dev/null | grep -qi "installed"; then
    t3 service restart
  else
    echo "No background service; restart t3 yourself to pick up the change."
  fi
}

if [[ "$restore" == 1 ]]; then
  if [[ ! -d "$backup_dir" ]]; then
    echo "Nothing to restore: no $backup_dir." >&2
    exit 1
  fi
  rm -rf "$client_dir"
  mv "$backup_dir" "$client_dir"
  echo "Restored the upstream client for t3 $installed_version."
  restart_service
  exit 0
fi

fork_version="$(git -C "$repo_root" describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
fork_version="${fork_version#v}"
if [[ "$fork_version" != "$installed_version" && "$force" != 1 ]]; then
  cat >&2 <<EOF
Version mismatch: this fork is based on t3 $fork_version, but this machine runs t3 $installed_version.
The web client and server must match. Either:
  t3 update $fork_version -y        # move this machine to the fork's version
or rebase the fork onto v$installed_version. (--force skips this check.)
EOF
  exit 1
fi

if [[ "$build" == 1 ]]; then
  (cd "$repo_root" && vp run --filter @t3tools/web build)
fi
dist_dir="$repo_root/apps/web/dist"
if [[ ! -f "$dist_dir/index.html" ]]; then
  echo "No build at $dist_dir; run without --no-build." >&2
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
echo "Installed the fleet board client into t3 $installed_version ($client_dir)."
echo "Upstream copy kept at $backup_dir; undo with: fleet/install-client.sh --restore"
restart_service
