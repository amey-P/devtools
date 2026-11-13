#!/usr/bin/env bash
# Copy this project into the Herdr app's home. Safe to re-run.
#   ./sync.sh          copy once
#   ./sync.sh --watch  copy again whenever a file here changes (Ctrl-C to stop)
# A wrapper around the repo's install.mjs (Node 18+): node install.mjs install|watch git
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${1:-}" = "--watch" ]; then exec node "$ROOT/install.mjs" watch git; fi
exec node "$ROOT/install.mjs" install git
