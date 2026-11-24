#!/bin/sh
# Loads the installed mod once (herdr-app check), then shows Herdr's file and mod errors.
set -eu
MOD_NAME="${MOD_NAME:-space-icons-g}"
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
herdr-app check "$HOME_DIR/mods/$MOD_NAME"
herdr-app status
