#!/usr/bin/env bash
# Copy the minimal layout and the space-icons mod into the Herdr app's home. Safe to re-run.
#   ./sync.sh          copy once
#   ./sync.sh --watch  copy again whenever a file here changes (Ctrl-C to stop)
# If Herdr changed the layout in its home (the theme picker writes `theme`),
# that newer copy is pulled back here first (old one kept as .bak).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../scripts/lib.sh"

sync_once() {
  sync_mod "$HERE/space-icons" space-icons
  sync_file "$HERE/layouts/minimal.json" "$HERDR_HOME/layouts/minimal.json" layouts/minimal.json
  sync_file "$HERE/layouts/minimal.svg" "$HERDR_HOME/layouts/minimal.svg" layouts/minimal.svg
}

sync_once
[ "${1:-}" = "--watch" ] && watch_loop sync_once "$HERE/space-icons" "$HERE/layouts"
exit 0
