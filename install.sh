#!/usr/bin/env bash
# agentctl: install every Herdr mod, layout and integration in this repo
# (macOS and Linux; on Windows use install.ps1). The work happens in install.mjs (Node 18+).
#
#   ./install.sh [command] [target] [agent]
#     install    copy into Herdr's home (default command)
#     status     what's installed, and whether it matches the repo
#     watch      re-copy whenever a source file changes (Ctrl-C to stop)
#     uninstall  remove what this repo installed (layouts are left alone)
#   targets: all (default) | git | minimal | sidebar | usage | peruse | agents
#   agents is opt-in and never part of `all` (the Claude Code plugin and pi extension):
#   `install agents [claude|pi]` opts in, `uninstall agents [claude|pi]` opts out.
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

# need_node: Node.js 18+ or an install hint for this OS.
need_node() {
  if command -v node >/dev/null 2>&1 && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)'; then return 0; fi
  local hint="install Node.js 18+ from https://nodejs.org"
  case "$(uname -s)" in
    Darwin) hint="brew install node" ;;
    Linux)
      if [ -r /etc/os-release ]; then
        case "$(. /etc/os-release; echo "${ID:-}")" in
          ubuntu|debian|pop|linuxmint) hint="sudo apt-get install -y nodejs" ;;
          fedora|rhel|centos|rocky|almalinux) hint="sudo dnf install -y nodejs" ;;
          arch|manjaro|endeavouros) hint="sudo pacman -S nodejs" ;;
          alpine) hint="sudo apk add nodejs" ;;
          opensuse*|sles) hint="sudo zypper install nodejs" ;;
        esac
      fi ;;
  esac
  echo "error: Node.js 18+ not found. Install it: $hint" >&2
  exit 1
}

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

main() {
  local self="${BASH_SOURCE[0]:-}"
  if [ -z "$self" ] || [ ! -f "$self" ] || [ ! -f "$(dirname "$self")/install.mjs" ]; then
    bootstrap "$@"
  fi
  need_node
  exec node "$(cd "$(dirname "$self")" && pwd)/install.mjs" "$@"
}

main "$@"
