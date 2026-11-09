#!/usr/bin/env bash
# Shared helpers for the herdr-app monorepo. Source it; don't run it.
# Portable across macOS (BSD userland, bash 3.2) and Linux (GNU userland).
#
# Copies, not symlinks: Herdr neither hot-reloads nor loads mod assets (SVGs)
# through a symlinked mod folder. The repo stays the source of truth.

HERDR_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -t 1 ]; then
  _c_ok=$'\033[32m' _c_warn=$'\033[33m' _c_err=$'\033[31m' _c_dim=$'\033[2m' _c_off=$'\033[0m'
else
  _c_ok='' _c_warn='' _c_err='' _c_dim='' _c_off=''
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s%s%s\n' "$_c_ok" "$*" "$_c_off"; }
warn() { printf '%s%s%s\n' "$_c_warn" "$*" "$_c_off" >&2; }
die()  { printf '%serror: %s%s\n' "$_c_err" "$*" "$_c_off" >&2; exit 1; }
dim()  { printf '%s%s%s\n' "$_c_dim" "$*" "$_c_off"; }

# Files Herdr writes into a mod folder, plus junk: never copied, never deleted.
HERDR_EXCLUDES=(--exclude jsconfig.json --exclude '*.d.ts' --exclude .installed.json
  --exclude .DS_Store --exclude '*.bak' --exclude .gitignore)

os_name() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux)
      if [ -r /etc/os-release ]; then (. /etc/os-release; echo "${ID:-linux}"); else echo linux; fi ;;
    *) uname -s | tr '[:upper:]' '[:lower:]' ;;
  esac
}

# need <cmd> [brew-pkg] [linux-pkg]: fail with an install hint when <cmd> is missing.
need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  local brew="${2:-$1}" pkg="${3:-${2:-$1}}" hint
  case "$(os_name)" in
    macos) hint="brew install $brew" ;;
    ubuntu|debian|pop|linuxmint) hint="sudo apt-get install -y $pkg" ;;
    fedora|rhel|centos|rocky|almalinux) hint="sudo dnf install -y $pkg" ;;
    arch|manjaro|endeavouros) hint="sudo pacman -S $pkg" ;;
    alpine) hint="sudo apk add $pkg" ;;
    opensuse*|sles) hint="sudo zypper install $pkg" ;;
    *) hint="install '$pkg' with your package manager" ;;
  esac
  die "$1 not found. Install it: $hint"
}

has() { command -v "$1" >/dev/null 2>&1; }

# herdr_check <dir>: validate a mod with herdr-app when it's on PATH (warn only).
herdr_check() {
  has herdr-app || return 0
  local out
  if out="$(herdr-app check "$1" 2>&1)"; then dim "        herdr-app check passed"
  else warn "        herdr-app check failed for $1:"; printf '%s\n' "$out" >&2; fi
}

# sync_mod <src_dir> <mod_name> [extra rsync args…]: mirror a mod folder into Herdr's home.
sync_mod() {
  local src="$1" name="$2" dst="$HERDR_HOME/mods/$2"; shift 2
  [ -d "$src" ] || die "no mod folder at $src"
  if [ -L "$dst" ]; then rm "$dst"; say "unlink  mods/$name (was a symlink)"; fi
  mkdir -p "$dst"
  rsync -a --delete "${HERDR_EXCLUDES[@]}" "$@" "$src/" "$dst/"
  say "synced  mods/$name"
  herdr_check "$dst"
}

# sync_file <src> <dst> <label>: copy one file. If Herdr changed its copy more
# recently (the theme picker writes into layouts), adopt that copy back into
# the repo first and keep the old one as <src>.bak.
sync_file() {
  local src="$1" dst="$2" label="${3:-$2}"
  mkdir -p "$(dirname "$dst")"
  [ -L "$dst" ] && rm "$dst"
  if [ -f "$dst" ] && ! cmp -s "$src" "$dst" && [ "$dst" -nt "$src" ]; then
    say "adopt   $label (changed in Herdr's home; old repo copy kept as $(basename "$src").bak)"
    cp "$src" "$src.bak"; cp "$dst" "$src"; return 0
  fi
  if ! cmp -s "$src" "$dst" 2>/dev/null; then cp "$src" "$dst"; say "copied  $label"; fi
}

# tree_stamp <dir…>: a fingerprint of file paths and mtimes (GNU or BSD stat).
if stat -c %Y / >/dev/null 2>&1; then _stat_fmt=(-c '%Y %n'); else _stat_fmt=(-f '%m %N'); fi
tree_stamp() {
  find "$@" -type f ! -name '*.bak' ! -name '*.d.ts' ! -name jsconfig.json ! -name .DS_Store \
    -exec stat "${_stat_fmt[@]}" {} + 2>/dev/null | LC_ALL=C sort | cksum
}

# watch_loop <fn> <dir…>: call <fn> whenever anything under <dir…> changes.
watch_loop() {
  local fn="$1"; shift
  say "watching $* (Ctrl-C to stop)"
  local last now
  last="$(tree_stamp "$@")"
  while sleep 1; do
    now="$(tree_stamp "$@")"
    if [ "$now" != "$last" ]; then "$fn" || warn "sync failed; still watching"; last="$(tree_stamp "$@")"; fi
  done
}
