#!/usr/bin/env bash
# herdr-app devtools: install every Herdr mod, layout and integration in this repo.
#
#   ./install.sh [command] [target]
#     install    copy into Herdr's home (default command)
#     status     what's installed, and whether it matches the repo
#     watch      re-copy whenever a source file changes (Ctrl-C to stop)
#     uninstall  remove what this repo installed (layouts are left alone)
#   targets: all (default) | git | minimal | sidebar | usage | review
#
# Without a clone, bootstrap with:
#   curl -fsSL https://raw.githubusercontent.com/amey-P/devtools/main/install.sh | bash                    # clone + install all
#   curl -fsSL https://raw.githubusercontent.com/amey-P/devtools/main/install.sh | bash -s -- install git  # clone + one target
#
# Environment:
#   HERDR_APP_HOME        Herdr's home            (default ~/.config/herdr-app)
#   HERDR_DEVTOOLS_REPO   git URL to bootstrap from
#   HERDR_DEVTOOLS_DIR    where bootstrap clones  (default ~/.local/share/herdr-devtools)
#
# Everything sits inside main(), so a truncated `curl | bash` download runs nothing.
set -euo pipefail

DEFAULT_REPO_URL="https://github.com/amey-P/devtools.git"
TARGETS="git minimal sidebar usage review"

usage() { sed -n '2,20p' "$1" | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------- bootstrap

bootstrap() {
  local url="${HERDR_DEVTOOLS_REPO:-$DEFAULT_REPO_URL}"
  local dir="${HERDR_DEVTOOLS_DIR:-$HOME/.local/share/herdr-devtools}"
  command -v git >/dev/null 2>&1 || { echo "error: git is required to bootstrap" >&2; exit 1; }
  if [ -d "$dir/.git" ]; then
    echo "updating $dir"
    git -C "$dir" pull --ff-only --quiet
  else
    [ -n "$url" ] || { echo "error: set HERDR_DEVTOOLS_REPO to the repo's git URL" >&2; exit 1; }
    echo "cloning $url → $dir"
    mkdir -p "$(dirname "$dir")"
    git clone --quiet "$url" "$dir"
  fi
  exec bash "$dir/install.sh" "$@"
}

# ---------------------------------------------------------------- targets

review_mjs() { node "$REPO_ROOT/herdr-review/install.mjs" "$@"; }

# The keys.json binding install.sh manages for the usage settings (idempotent; backs the file up
# before the first change). Node does the JSON surgery; bash can't do that portably.
USAGE_BINDING='ctrl-shift-u'; USAGE_MOD='usage-settings'
keys_json() { KEYS_FILE="$HERDR_HOME/keys.json" USAGE_BINDING="$USAGE_BINDING" USAGE_MOD="$USAGE_MOD" node "$@"; }

usage_binding_hint() { echo "bind ctrl-shift-u by hand: in $HERDR_HOME/keys.json \"global\", add \"ctrl-shift-u\": {\"command\":\"mod.open\",\"args\":{\"name\":\"usage-settings\"}}"; }

ensure_binding() {
  has node || { warn "  node not found; $(usage_binding_hint)"; return 0; }
  # No keys.json yet (Herdr hasn't run): don't create one holding only this key — Herdr treats the
  # file as the whole key map. Re-run install after Herdr has started once.
  [ -f "$HERDR_HOME/keys.json" ] || { warn "  no keys.json yet (start Herdr once, then re-run install); or $(usage_binding_hint)"; return 0; }
  keys_json -e '
    const fs = require("fs");
    const f = process.env.KEYS_FILE, binding = process.env.USAGE_BINDING, mod = process.env.USAGE_MOD;
    let j;
    try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { j = null; }
    if (!j || typeof j !== "object" || Array.isArray(j)) { console.log("warn    keys.json isn\x27t a valid JSON object; not touching it"); process.exit(0); }
    if (!j.global || typeof j.global !== "object") j.global = {};
    const want = { command: "mod.open", args: { name: mod } };
    const cur = JSON.stringify(j.global[binding] ?? null);
    if (cur === JSON.stringify(want)) { console.log("        keys.json already binds " + binding); process.exit(0); }
    if (j.global[binding] !== undefined) { console.log("warn    keys.json already uses " + binding + " for " + JSON.stringify(j.global[binding]) + "; leaving it"); process.exit(0); }
    const b = f + ".bak-" + mod;
    let note;
    if (fs.existsSync(b)) note = "kept the earlier backup keys.json.bak-" + mod;
    else { fs.copyFileSync(f, b); note = "backup: keys.json.bak-" + mod; }
    j.global[binding] = want;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    console.log("bound   " + binding + " -> " + mod + " in keys.json (" + note + ")");
  ' || warn "  could not update keys.json"
}

remove_binding() {
  has node || return 0
  keys_json -e '
    const fs = require("fs");
    const f = process.env.KEYS_FILE, binding = process.env.USAGE_BINDING, mod = process.env.USAGE_MOD;
    let j;
    try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { process.exit(0); }
    const want = JSON.stringify({ command: "mod.open", args: { name: mod } });
    if (!j?.global || JSON.stringify(j.global[binding] ?? null) !== want) process.exit(0);
    delete j.global[binding];
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    console.log("unbound " + binding + " from keys.json");
  ' || true
}

# current | not bound | bound to something else — for status.
binding_state() {
  has node || { echo "node not found"; return; }
  keys_json -e '
    const fs = require("fs");
    const f = process.env.KEYS_FILE, binding = process.env.USAGE_BINDING, mod = process.env.USAGE_MOD;
    let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { console.log("missing"); process.exit(0); }
    const cur = j?.global?.[binding];
    console.log(cur === undefined ? "missing"
      : JSON.stringify(cur) === JSON.stringify({ command: "mod.open", args: { name: mod } }) ? "current" : "bound to something else");
  ' 2>/dev/null || echo "unreadable"
}

install_target() {
  case "$1" in
    git)     say "git:";     bash "$REPO_ROOT/herdr-git/sync.sh" ;;
    minimal) say "minimal:"; bash "$REPO_ROOT/herdr-minimal/sync.sh" ;;
    sidebar) say "sidebar:"; bash "$REPO_ROOT/herdr-sidebar/sync.sh" ;;
    usage)
      say "usage:"
      has node || warn "  node not found; the usage widget needs Node.js 18+ to read usage (installing anyway)"
      bash "$REPO_ROOT/herdr-usage/sync.sh"
      ensure_binding ;;
    review)
      say "review:"
      if has node; then review_mjs install all
      else warn "  node not found; skipped herdr-review (install Node.js 18+ and re-run: ./install.sh install review)"; fi ;;
  esac
}

# mod_state <src> <name> [extra rsync args]: prints current | differs | symlink | missing
mod_state() {
  local src="$1" dst="$HERDR_HOME/mods/$2"; shift 2
  if [ -L "$dst" ]; then echo symlink; return; fi
  [ -d "$dst" ] || { echo missing; return; }
  local diff
  diff="$(rsync -anc --delete --itemize-changes "${HERDR_EXCLUDES[@]}" "$@" "$src/" "$dst/" | grep -v '^\.d' || true)"
  [ -z "$diff" ] && echo current || echo differs
}
file_state() {
  if [ -L "$2" ]; then echo symlink; elif [ ! -f "$2" ]; then echo missing
  elif cmp -s "$1" "$2"; then echo current; else echo differs; fi
}
show() { # <label> <state>
  local mark
  case "$2" in current) mark="${_c_ok}●${_c_off}" ;; missing) mark="${_c_warn}○${_c_off}" ;; *) mark="${_c_warn}◐${_c_off}" ;; esac
  printf '  %s %-22s %s\n' "$mark" "$1" "$2"
  [ "$2" = current ]
}

status_target() {
  local r=0
  case "$1" in
    git)     show mods/git "$(mod_state "$REPO_ROOT/herdr-git" git --exclude sync.sh)" || r=1 ;;
    sidebar) show mods/space-tree "$(mod_state "$REPO_ROOT/herdr-sidebar/space-tree" space-tree)" || r=1 ;;
    usage)
      show mods/agent-usage "$(mod_state "$REPO_ROOT/herdr-usage/agent-usage" agent-usage)" || r=1
      show mods/usage-settings "$(mod_state "$REPO_ROOT/herdr-usage/usage-settings" usage-settings)" || r=1
      show "keys.json $USAGE_BINDING" "$(binding_state)" || r=1 ;;
    minimal)
      show mods/space-icons "$(mod_state "$REPO_ROOT/herdr-minimal/space-icons" space-icons)" || r=1
      for f in minimal.json minimal.svg; do
        show "layouts/$f" "$(file_state "$REPO_ROOT/herdr-minimal/layouts/$f" "$HERDR_HOME/layouts/$f")" || r=1
      done ;;
    review)
      if has node; then review_mjs status | sed '1d' || r=1
      else show review "node not found" || r=1; fi ;;
  esac
  return $r
}

uninstall_target() {
  local name
  case "$1" in
    git) name=git ;; minimal) name=space-icons ;; sidebar) name=space-tree ;; usage) name="agent-usage usage-settings" ;;
    review) say "review:"; if has node; then review_mjs uninstall all; else warn "  node not found; skipped"; fi; return ;;
  esac
  for n in $name; do
    rm -rf "${HERDR_HOME:?}/mods/$n"
    say "removed mods/$n"
  done
  if [ "$1" = usage ]; then
    remove_binding
    dim "  kept data/agent-usage/ (your settings) and any keys.json.bak-$USAGE_MOD; delete them by hand if unwanted"
  fi
}

watch_all() {
  local pids=""
  trap 'kill $pids 2>/dev/null; wait 2>/dev/null; exit 0' INT TERM
  for t in $1; do
    case "$t" in
      git|minimal|sidebar|usage) bash "$REPO_ROOT/herdr-$t/sync.sh" --watch & pids="$pids $!" ;;
      review)
        has node || { warn "node not found; not watching review"; continue; }
        ( review_sync() { review_mjs sync herdr; }
          review_sync
          watch_loop review_sync "$REPO_ROOT/herdr-review/mod" "$REPO_ROOT/herdr-review/mod-inbox" ) & pids="$pids $!" ;;
    esac
  done
  wait
}

# ---------------------------------------------------------------- main

main() {
  local self="${BASH_SOURCE[0]:-}"
  if [ -z "$self" ] || [ ! -f "$self" ] || [ ! -f "$(dirname "$self")/scripts/lib.sh" ]; then
    bootstrap "$@"
  fi
  # shellcheck source=scripts/lib.sh
  . "$(cd "$(dirname "$self")" && pwd)/scripts/lib.sh"

  local cmd="${1:-install}" target="${2:-all}" targets
  case "$cmd" in -h|--help|help) usage "$self"; exit 0 ;; esac
  if [ "$target" = all ]; then targets="$TARGETS"
  else
    case " $TARGETS " in *" $target "*) targets="$target" ;; *) die "unknown target '$target' (all | ${TARGETS// / | })" ;; esac
  fi

  case "$cmd" in
    install|sync)
      need rsync rsync rsync
      if [ ! -d "$HERDR_HOME" ]; then
        warn "$HERDR_HOME doesn't exist yet (is the Herdr app installed?). Creating it."
      fi
      mkdir -p "$HERDR_HOME/mods" "$HERDR_HOME/layouts"
      dim "herdr home: $HERDR_HOME  ($(os_name))"
      for t in $targets; do install_target "$t"; done
      ok "done" ;;
    status)
      need rsync rsync rsync
      dim "herdr home: $HERDR_HOME"
      local all=0
      for t in $targets; do status_target "$t" || all=2; done
      exit $all ;;
    watch)
      need rsync rsync rsync
      mkdir -p "$HERDR_HOME/mods" "$HERDR_HOME/layouts"
      watch_all "$targets" ;;
    uninstall)
      for t in $targets; do uninstall_target "$t"; done ;;
    *) usage "$self"; exit 1 ;;
  esac
}

main "$@"
