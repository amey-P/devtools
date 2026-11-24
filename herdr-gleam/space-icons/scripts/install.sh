#!/bin/sh
# Copies dist/ into ~/.config/herdr-app/mods/$MOD_NAME (a copy, never a symlink: Herdr's reload
# and svg() both need real files). geo/ (generated icons) is left alone, and an existing
# overrides.json is kept: it is the user's file.
set -eu
cd "$(dirname "$0")/.."
MOD_NAME="${MOD_NAME:-space-icons-g}"
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
DST="$HOME_DIR/mods/$MOD_NAME"
[ -f dist/main.js ] || { echo "no dist/main.js: run scripts/build.sh first" >&2; exit 1; }
mkdir -p "$DST"
EXCLUDE="--exclude geo"
[ -f "$DST/overrides.json" ] && EXCLUDE="$EXCLUDE --exclude overrides.json"
# shellcheck disable=SC2086
rsync -a --delete $EXCLUDE dist/ "$DST/"
echo "installed $DST"
