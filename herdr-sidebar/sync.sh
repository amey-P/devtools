#!/usr/bin/env bash
# Copy the space-tree mod into the Herdr app's home. Safe to re-run.
#   ./sync.sh          copy once
#   ./sync.sh --watch  copy again whenever a file here changes (Ctrl-C to stop)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../scripts/lib.sh"

sync_once() { sync_mod "$HERE/space-tree" space-tree; }

sync_once
[ "${1:-}" = "--watch" ] && watch_loop sync_once "$HERE/space-tree"
exit 0
