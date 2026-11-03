#!/usr/bin/env bash
# One-shot setup of the fleet board on a machine that already runs T3 Code:
# installs vp (Node 26 + pnpm) if missing, installs dependencies, then builds
# and installs the client, moving t3 to the fork's version if needed.
#
#   fleet/setup.sh                 everything above
#   fleet/setup.sh --no-update     fail on a version mismatch instead of updating t3
#
# Extra arguments go to fleet/install-client.sh.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vp_env="$HOME/.config/vite-plus/env"

update_flag=--update
args=()
for arg in "$@"; do
  case "$arg" in
    --no-update) update_flag= ;;
    -h | --help) sed -n '2,9p' "$0"; exit 0 ;;
    *) args+=("$arg") ;;
  esac
done

if ! command -v t3 >/dev/null && [[ ! -x "$HOME/.local/bin/t3" ]]; then
  echo "T3 Code is not installed on this machine. Install it first, then re-run." >&2
  exit 1
fi

[[ -f "$vp_env" ]] && . "$vp_env"
if ! command -v vp >/dev/null; then
  echo "Installing vp (Vite+), which provides the pinned Node and pnpm..."
  VP_NODE_MANAGER=yes bash -c "$(curl -fsSL https://vite.plus)"
  . "$vp_env"
fi
for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if [[ -f "$rc" ]] && ! grep -q 'vite-plus/env' "$rc"; then
    echo ". \"$vp_env\"" >>"$rc"
  fi
done

cd "$repo_root"
vp i
vp test run apps/web/src/components/board
exec fleet/install-client.sh ${update_flag:+"$update_flag"} ${args[@]+"${args[@]}"}
