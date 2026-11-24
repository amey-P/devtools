#!/bin/sh
# Builds the mod into dist/: the Gleam core, the shell bundled into one main.js, and the assets.
# MOD_NAME is the folder under mods/ (space-icons-g before the cutover). Every path the core
# uses (overrides.json, geo/, icons/) is derived from it.
set -eu
cd "$(dirname "$0")/.."
MOD_NAME="${MOD_NAME:-space-icons-g}"
gleam build
rm -rf dist
mkdir -p dist
npx esbuild shell/main.ts --bundle --format=esm \
  --external:herdr --external:gpui-kit --external:gpui-base --external:fs/promises \
  --define:MOD_NAME="\"$MOD_NAME\"" --outfile=dist/main.js --log-level=warning
command cp -R assets/icons dist/icons
command cp assets/mod.json assets/overrides.json dist/
echo "built dist/ for mods/$MOD_NAME"
