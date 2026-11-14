#!/usr/bin/env bash
# git-changes.sh — READ-ONLY snapshot of all uncommitted work (staged, unstaged,
# untracked) for commit planning. Usage: bash git-changes.sh
set -uo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "NOT_A_GIT_REPO: $(pwd)" >&2
  exit 1
fi

MAX_LINES="${GIT_HELPER_MAX_LINES:-1500}"

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

if [ -z "$(git status --porcelain=v1)" ]; then
  echo "WORKTREE CLEAN — nothing to commit"
  exit 0
fi

printf '== BRANCH ==\n'
git status -sb | sed -n '1p'

capped "PORCELAIN STATUS" status --porcelain=v1
capped "DIFF STAT (staged + unstaged)" diff --stat HEAD
capped "STAGED DIFF" diff --cached
capped "UNSTAGED DIFF" diff
capped "UNTRACKED FILES" ls-files --others --exclude-standard
