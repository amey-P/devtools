#!/usr/bin/env bash
# Copy the agent-usage and usage-settings mods into the Herdr app's home. Safe to re-run.
#   ./sync.sh          copy once
#   ./sync.sh --watch  copy again whenever a file here changes (Ctrl-C to stop)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../scripts/lib.sh"

sync_once() {
  sync_mod "$HERE/agent-usage" agent-usage
  sync_mod "$HERE/usage-settings" usage-settings
}

sync_once
[ "${1:-}" = "--watch" ] && watch_loop sync_once "$HERE/agent-usage" "$HERE/usage-settings"
exit 0
