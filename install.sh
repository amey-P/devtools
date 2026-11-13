#!/usr/bin/env bash
# herdr-app devtools: install every Herdr mod, layout and integration in this repo.
#
#   ./install.sh [command] [target] [agent]
#     install    copy into Herdr's home (default command)
#     status     what's installed, and whether it matches the repo
#     watch      re-copy whenever a source file changes (Ctrl-C to stop)
#     uninstall  remove what this repo installed (layouts are left alone)
#   targets: all (default) | git | minimal | sidebar | usage | review | agents
#   agents is opt-in and never part of `all`: it adds the coding-agent integrations
#   (the herdr-review Claude Code plugin and pi extension). `install agents [claude|pi]`
#   opts in; after that, `install` keeps them current. `uninstall agents [claude|pi]` opts out.
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
TARGETS="git minimal sidebar usage review"   # what `all` means
AGENTS="claude pi"                           # `agents` (opt-in) integrations

usage() { sed -n '2,/^# Everything sits/p' "$1" | sed '$d' | sed '$d' | sed 's/^# \{0,1\}//'; }

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
# agent_on <claude|pi>: opted in = installed. No state file to drift.
agent_on() { has node && review_mjs installed "$1" >/dev/null 2>&1; }

# install_agents <list>: the review mod first (every integration loads its bridge), then each agent.
install_agents() {
  has node || { warn "  node not found; agents need Node.js 18+"; return 0; }
  review_mjs installed herdr >/dev/null 2>&1 || review_mjs install herdr | sed '1d'
  local a
  for a in $1; do
    if has "$a"; then review_mjs install "$a" | sed '1d'
    else warn "  $a not on PATH; skipped (install it, then: ./install.sh install agents $a)"; fi
  done
}

# keys.json bindings install.sh manages (scripts/keys.mjs does the JSON surgery idempotently and
# backs keys.json up before its first change).
USAGE_BINDING='ctrl-shift-u'; USAGE_CMD='{"command":"mod.open","args":{"name":"usage-settings"}}'
# The git view used to open as a split pane; it's now a drawer in the minimal layout, and this key
# opens it as a window elsewhere. The old pane binding is migrated, anything else is left alone.
GIT_BINDING='ctrl-shift-g'; GIT_CMD='{"command":"mod.open","args":{"name":"git"}}'
GIT_OLD_CMD='{"command":"pane.split","args":{"direction":"right","mod":"git"}}'
keys_mjs() { HERDR_APP_HOME="$HERDR_HOME" node "$REPO_ROOT/scripts/keys.mjs" "$@"; }

# ensure_binding <key> <command-json> [keys.mjs options…]
ensure_binding() {
  local key="$1" cmd="$2"; shift 2
  has node || { warn "  node not found; bind $key by hand: in $HERDR_HOME/keys.json \"global\", add \"$key\": $cmd"; return 0; }
  local out; out="$(keys_mjs ensure "$key" "$cmd" "$@")" || { warn "  could not update keys.json"; return 0; }
  case "$out" in warn*) warn "$out" ;; *) say "$out" ;; esac
}
remove_binding() { has node || return 0; keys_mjs remove "$1" "$2" || true; }
# current | missing | bound to something else, for status.
binding_state() { has node || { echo "node not found"; return; }; keys_mjs state "$1" "$2" 2>/dev/null || echo unreadable; }

install_target() {
  case "$1" in
    git)     say "git:";     bash "$REPO_ROOT/herdr-git/sync.sh"; ensure_binding "$GIT_BINDING" "$GIT_CMD" --replace "$GIT_OLD_CMD" ;;
    minimal) say "minimal:"; bash "$REPO_ROOT/herdr-minimal/sync.sh" ;;
    sidebar) say "sidebar:"; bash "$REPO_ROOT/herdr-sidebar/sync.sh" ;;
    usage)
      say "usage:"
      has node || warn "  node not found; the usage widget needs Node.js 18+ to read usage (installing anyway)"
      bash "$REPO_ROOT/herdr-usage/sync.sh"
      ensure_binding "$USAGE_BINDING" "$USAGE_CMD" ;;
    review)
      say "review:"
      if has node; then
        review_mjs install herdr | sed '1d'
        # Agents someone opted into stay current; nobody gets one by default.
        local a; for a in $AGENTS; do agent_on "$a" && review_mjs install "$a" | sed '1d'; done
      else warn "  node not found; skipped herdr-review (install Node.js 18+ and re-run: ./install.sh install review)"; fi ;;
    agents)
      say "agents:"
      install_agents "${AGENT_PICK:-$AGENTS}" ;;
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
    git)
      show mods/git "$(mod_state "$REPO_ROOT/herdr-git" git --exclude sync.sh --exclude test)" || r=1
      show "keys.json $GIT_BINDING" "$(binding_state "$GIT_BINDING" "$GIT_CMD")" || r=1 ;;
    sidebar) show mods/space-tree "$(mod_state "$REPO_ROOT/herdr-sidebar/space-tree" space-tree)" || r=1 ;;
    usage)
      show mods/agent-usage "$(mod_state "$REPO_ROOT/herdr-usage/agent-usage" agent-usage)" || r=1
      show mods/usage-settings "$(mod_state "$REPO_ROOT/herdr-usage/usage-settings" usage-settings)" || r=1
      show "keys.json $USAGE_BINDING" "$(binding_state "$USAGE_BINDING" "$USAGE_CMD")" || r=1 ;;
    minimal)
      show mods/space-icons "$(mod_state "$REPO_ROOT/herdr-minimal/space-icons" space-icons)" || r=1
      for f in minimal.json minimal.svg; do
        show "layouts/$f" "$(file_state "$REPO_ROOT/herdr-minimal/layouts/$f" "$HERDR_HOME/layouts/$f")" || r=1
      done ;;
    review)
      if has node; then review_mjs status herdr | sed '1d' || r=1
      else show review "node not found" || r=1; fi
      # Opted-in agents count toward status; the rest are just noted.
      if [ -z "${STATUS_AGENTS:-}" ]; then
        local a; for a in $AGENTS; do
          if agent_on "$a"; then review_mjs status "$a" | sed '1d' || r=1
          else dim "  · $a     not opted in (./install.sh install agents $a)"; fi
        done
      fi ;;
    agents)
      if has node; then local a; for a in ${AGENT_PICK:-$AGENTS}; do review_mjs status "$a" | sed '1d' || r=1; done
      else show agents "node not found" || r=1; fi ;;
  esac
  return $r
}

uninstall_target() {
  local name
  case "$1" in
    git) name=git ;; minimal) name=space-icons ;; sidebar) name=space-tree ;; usage) name="agent-usage usage-settings" ;;
    review)
      say "review:"
      has node || { warn "  node not found; skipped"; return; }
      local a on=""; for a in $AGENTS; do agent_on "$a" && on="$on $a"; done
      [ -n "$on" ] && warn "  agents still installed:$on — they need the review mod; remove them with ./install.sh uninstall agents"
      review_mjs uninstall herdr; return ;;
    agents)
      say "agents:"
      has node || { warn "  node not found; skipped"; return; }
      local a; for a in ${AGENT_PICK:-$AGENTS}; do review_mjs uninstall "$a"; done; return ;;
  esac
  for n in $name; do
    rm -rf "${HERDR_HOME:?}/mods/$n"
    say "removed mods/$n"
  done
  if [ "$1" = git ]; then remove_binding "$GIT_BINDING" "$GIT_CMD"; fi
  if [ "$1" = usage ]; then
    remove_binding "$USAGE_BINDING" "$USAGE_CMD"
    dim "  kept data/agent-usage/ (your settings) and any keys.json.bak-usage-settings; delete them by hand if unwanted"
  fi
}

watch_all() {
  local pids=""
  trap 'kill $pids 2>/dev/null; wait 2>/dev/null; exit 0' INT TERM
  for t in $1; do
    case "$t" in
      git|minimal|sidebar|usage) bash "$REPO_ROOT/herdr-$t/sync.sh" --watch & pids="$pids $!" ;;
      agents) dim "agents load from their install location; re-run ./install.sh install agents after changes" ;;
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
    case " $TARGETS agents " in *" $target "*) targets="$target" ;; *) die "unknown target '$target' (all | ${TARGETS// / | } | agents)" ;; esac
  fi
  # `agents [claude|pi]`: pick one integration.
  AGENT_PICK=""
  if [ "$target" = agents ] && [ -n "${3:-}" ]; then
    case " $AGENTS " in *" $3 "*) AGENT_PICK="$3" ;; *) die "unknown agent '$3' (${AGENTS// / | })" ;; esac
  fi
  [ "$target" = agents ] && STATUS_AGENTS=1

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
