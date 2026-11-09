#!/usr/bin/env bash
# Copy the git mod (this folder) into the Herdr app's home as mods/git. Safe to re-run.
#   ./sync.sh          copy once
#   ./sync.sh --watch  copy again whenever a file here changes (Ctrl-C to stop)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../scripts/lib.sh"

sync_once() { sync_mod "$HERE" git --exclude sync.sh; }

sync_once
[ "${1:-}" = "--watch" ] && watch_loop sync_once "$HERE"
exit 0
