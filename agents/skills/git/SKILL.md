---
name: git
description: Work with the current git repository. Use for repo recon and inspection (status, branch, recent activity, stashes, remotes), summarizing what changed, and grouping uncommitted changes into logical commits via a reviewed, approval-gated commit plan.
---

# Git helpers

Read-only observation scripts live in `scripts/`. Run them with bash; they work from any directory inside the repo and never mutate anything.

Dispatch by request:
- Question about repo state ("what changed?", "where am I?", "what's going on here?") → run `scripts/git-recon.sh`, answer from its output.
- Request to group or plan commits ("group my changes", "commit this mess") → GROUP workflow below.
- No clear intent → run `scripts/git-recon.sh` and summarize.

## Scripts

- `scripts/git-recon.sh` — one-shot repo recon: branch + ahead/behind, full status, recent commits, stashes, remotes, uncommitted diff stat, untracked files.
- `scripts/git-changes.sh` — snapshot of all uncommitted work for commit planning: porcelain status, staged + unstaged diffs, untracked files. Exits early with `WORKTREE CLEAN` when there is nothing to do.

Behavior: sections are capped at 1500 lines (override with `GIT_HELPER_MAX_LINES`); truncation is marked inline with `[TRUNCATED: ...]` — rerun the underlying git command (printed in the marker) only if you need the rest. Outside a repository both exit 1 with `NOT_A_GIT_REPO: <path>`. Never combine them with state-changing flags.

## RECON summary

Summarize concisely:
1. Branch + upstream, ahead/behind counts
2. Working tree: staged vs unstaged vs untracked (grouped, not a raw dump)
3. In-progress operations (merge/rebase/cherry-pick, conflicts, detached HEAD)
4. Recent activity, stashes, remotes — only what's noteworthy
5. 2–3 suggested next actions

Never mutate anything during recon.

## GROUP — turn uncommitted changes into logical commits

Goal: plan a sequence of clean, atomic commits covering ALL uncommitted work (staged, unstaged, untracked). **Present the plan and stop — do not stage or commit anything until the user explicitly approves it.**

1. Run `scripts/git-changes.sh`. If it reports `WORKTREE CLEAN`, say so and stop. Read the untracked files it lists (skip binaries/huge files) to understand their purpose.
2. Analyze and cluster files that belong to one change: same feature/fix, renames + edits, code + its tests, migrations/models + generated lockfiles. Split apart unrelated concerns; if a single file mixes concerns, call out that `git add -p` will be needed and which hunks go where.
3. Present the plan as a numbered table: **# | commit message | files | notes**. Rules:
   - Conventional Commits (`feat(scope): ...`), imperative mood, ≤72 chars, intent over mechanics
   - Order so each commit builds on its own (code before or with its tests)
   - Flag files that should NOT be committed (secrets, credentials, build artifacts, junk) and suggest `.gitignore` entries for them
4. Wait for approval; apply any edits the user makes to the plan. Once approved, execute in order: `git add` exactly the listed paths (never `git add -A`/`git add .`), then `git commit -m "<message>"`. Report each resulting short hash.
5. If a hook fails or a commit errors, stop and report — don't retry or use `--no-verify` without asking.

## Safety

Never force-push, `reset --hard`, amend, or rewrite history without explicit confirmation.
