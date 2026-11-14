#!/usr/bin/env bash
# git-recon.sh — one-shot READ-ONLY recon of the current repository.
# Usage: bash git-recon.sh      (exits 1 outside a git repo)
set -uo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "NOT_A_GIT_REPO: $(pwd)" >&2
  exit 1
fi

MAX_LINES="${GIT_HELPER_MAX_LINES:-1500}"

# capped <label> <git args...> — print a section, truncating long output
capped() {
  local label=$1; shift
  printf '\n== %s ==\n' "$label"
  local n
  n=$(git "$@" 2>/dev/null | wc -l | tr -d ' ')
  n=${n:-0}
  if [ "$n" -eq 0 ]; then
    echo "(none)"
  elif [ "$n" -gt "$MAX_LINES" ]; then
    git "$@" 2>/dev/null | head -n "$MAX_LINES"
    printf '[TRUNCATED: showing %s of %s lines — rerun: git %s]\n' "$MAX_LINES" "$n" "$*"
  else
    git "$@" 2>/dev/null
  fi
}

echo "== BRANCH / STATUS =="
git status

capped "RECENT COMMITS" log --oneline --decorate -15

printf '\n== STASHES ==\n'
git stash list

printf '\n== REMOTES ==\n'
git remote -v

capped "UNCOMMITTED DIFF STAT" diff --stat HEAD
capped "UNTRACKED FILES" ls-files --others --exclude-standard
