# agentctl

One repo for everything custom around my coding agents: mods, layouts and agent integrations for the [Herdr app](https://herdr.dev), the pi and Claude Code configs I wrote (statuslines, skills), and the herdr subagents MCP server. One script installs them on macOS, Linux or Windows.

| Project | Installs | Into `$HERDR_APP_HOME` |
|---|---|---|
| `herdr-git/` | Git section in the minimal layout's sidebar, plus a full commit-graph window on ctrl-shift-g (see below) | `mods/git` |
| `herdr-minimal/` | The minimal layout and the space-icons mod | `layouts/minimal.{json,svg}`, `mods/space-icons` |
| `herdr-sidebar/` | Space-tree sidebar mod, used by the minimal layout | `mods/space-tree` |
| `herdr-usage/` | Agent usage widget at the bottom of the minimal layout's sidebar, plus its settings page (ctrl-shift-u) (see below) | `mods/agent-usage`, `mods/usage-settings` |
| `herdr-peruse/` | Peruse mods: read and annotate any markdown (agent docs, plans, quick decisions), its inbox and settings | `mods/peruse`, `mods/peruse-inbox`, `mods/peruse-settings`, plus `mods/review` (a shim for the old name; see [its README](herdr-peruse/README.md)) |
| `plugins/` → *plugins* (opt-in) | Coding-agent plugins, each installable into several agents. `plugins/peruse`: peruse's Claude Code plugin (hooks, skill) and pi extension, from one folder ([README](plugins/peruse/README.md)) | Claude Code's `agentctl` marketplace, pi's settings |
| `agents/` → *links* (opt-in) | pi powerline statusline extension, Claude Code statusline, custom skills (`explainer`, `git`), symlinked so edits apply at once | `~/.pi/agent/extensions/`, `~/.claude/statusline.sh`, `~/.agents/skills/` |
| `herdr-subagents-mcp/` | Rust MCP server pi uses to spawn and steer herdr subagents (build with `cargo build --release`) | referenced from `~/.pi/agent/mcp.json` |

`HERDR_APP_HOME` defaults to `~/.config/herdr-app`.

## Install

```sh
git clone https://github.com/amey-P/devtools.git agentctl && cd agentctl
./install.sh                 # install everything
./install.sh install git     # or one target: git | minimal | sidebar | usage | peruse
./install.sh status          # ● current  ◐ differs/symlink  ○ missing; exit 0 when all current
./install.sh uninstall [target]
```

**Agent plugins are opt-in and kept apart from the mods.** `install`, `status` and every mod target leave Claude Code and pi alone. A plugin is a folder under `plugins/`; its targets come from what's in it (`.claude-plugin/plugin.json` for Claude, a `"pi"` field in `package.json` for pi).

```sh
./install.sh install plugins peruse [claude|pi]   # opt in: every agent on PATH, or one
./install.sh install plugins                      # refresh whatever is installed (never adds one)
./install.sh status plugins [peruse]              # ● current  ◐ differs  · not installed
./install.sh uninstall plugins [peruse] [claude|pi]
./install.sh bump peruse patch                    # after editing it: Claude caches plugins by version
```

Being installed is what counts as opted in, so there's no state file. A plugin that needs a Herdr mod (peruse needs the peruse mods) only warns when it's missing; install the mod with its own target. The old `agents` target still works and maps to `plugins`. The logic lives in `scripts/plugins.mjs`.

**Agent configs are opt-in too.** `./install.sh install links` symlinks `agents/` into `~/.pi`, `~/.claude` and `~/.agents` (an existing real file is moved to `~/.local/state/agentctl/backup/`, not beside it, where pi or the skill loader would still pick it up); `status links` and `uninstall links` work the same way. Unlike Herdr mods these load fine through a symlink, so there's nothing to re-sync. The list lives in `scripts/links.mjs`.

You can also skip the clone:

```sh
curl -fsSL https://raw.githubusercontent.com/amey-P/devtools/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/amey-P/devtools/main/install.sh | bash -s -- install peruse   # pass a command/target
```

On Windows (PowerShell), run `.\install.ps1` in a clone (same commands and targets), or skip the clone:

```powershell
irm https://raw.githubusercontent.com/amey-P/devtools/main/install.ps1 | iex
```

That clones into `%LOCALAPPDATA%\herdr-devtools`. Both scripts only bootstrap: the work happens in `install.mjs`, which you can also run directly with `node install.mjs …` on any OS.

The bootstrap clones into `~/.local/share/herdr-devtools`, or pulls there if a clone already exists, and then runs that copy's `install.sh`.

**Requirements:** Node.js 18+, and `git` for the bootstrap. Nothing else: no rsync, no bash on Windows. When Node is missing, the scripts print the install command for your OS (brew, apt, dnf, pacman, apk, zypper or winget). Herdr's home is `HERDR_APP_HOME`, else what `herdr-app --help` reports, else `~/.config/herdr-app`. The `plugins` target installs into Claude and pi only when `claude` or `pi` is on PATH. When `herdr-app` is on PATH, each mod is validated with `herdr-app check`.

| Variable | Default | |
|---|---|---|
| `HERDR_APP_HOME` | `~/.config/herdr-app` | Herdr's home |
| `HERDR_DEVTOOLS_REPO` | `https://github.com/amey-P/devtools.git` | Git URL the bootstrap clones from |
| `HERDR_DEVTOOLS_DIR` | `~/.local/share/herdr-devtools` | Where the bootstrap clones to |

## Git in the sidebar

`herdr-git` is a section at the bottom of the minimal layout's sidebar, above the usage widget (the sidebar's `git` block). Closed, it is one row: the branch with a clean/dirty/conflict dot, a rebase/merge/cherry-pick/revert/bisect in progress (with its step), the number of changed files and ahead/behind. Clicking it opens the block (Herdr keeps the size, so it stays open across restarts). The block describes the current worktree only: its working tree, how far it is ahead of and behind the base branch, its recent and incoming commits, and the agents whose terminals are in it (click one to focus it). With more than one checkout, a row at the bottom sums up the rest (`5 worktrees · 2 dirty · 1 blocked`) and opens the overview. The commit graph and commit details are too wide for the sidebar: the graph button, or ctrl-shift-g, opens the full view as a window. On the narrow icon rail the row shrinks to the branch glyph, and a click opens that window.

### Worktree overview

Built for agent workflows where each agent works in its own `git worktree`. When the repo has more than one checkout, the window opens on an overview with one card per worktree. Each card shows:

- the branch and folder
- an operation in progress and conflicts
- how far it is ahead of and behind the base branch, and its upstream
- changed files and lines, and the last commit
- `merged`, `no commits yet`, `locked` or `missing` when they apply
- the agents working in it, with their status (click one to focus it)

The worktree you're in comes first. The rest are ordered by what needs you: a conflict or a stopped rebase, then a blocked agent, a finished agent, uncommitted work and unmerged commits; clean ones come next, and merged or missing ones last. Click a card (or j/k and Enter) to drill into the full view for that worktree. Its history starts on "Since main", which shows only that worktree's own commits. Esc or `‹ Worktrees` goes back. `o` opens the worktree's space. The base branch is `git config herdr.base` if set, else `origin/HEAD`, else `main`/`master`/`trunk`. Cards refresh every 8 seconds while the overview is shown, and right away when anything under the shared git dir changes.

It follows the focused terminal's repo, falling back to the tab's other terminals and the space's folder. It handles ordinary checkouts, linked worktrees, submodules, a folder inside `.git` and bare repos (including the `.bare` + worktrees layout), on this machine or a space's. Locally it watches the work tree and both git dirs, so commits made in any worktree show up at once. ctrl-shift-g opens the full view in any layout (`./install.sh install git` rebinds the old split-pane key; anything else bound there is left alone). `node --test herdr-git/test` runs its unit tests.

## Agent usage widget

`herdr-usage/agent-usage` shows one row per tracked service (Claude Code, Codex, pi, OpenCode Go) at the bottom of the sidebar: a bar for the plan limit in use (5h window, with ticks for the other windows — weekly and monthly where the service has them), the percent or today's cost, and a dot that pulses while one of its agents works. Bars turn green, then amber at 50%, then red at 80%. Hover the strip for a detail card with every limit window, reset times, today and 7-day tokens and cost, a 7-day sparkline and the live agents (click a dot to focus it). Click the strip to pin the detail open. A folded sidebar shows a rail of tiles instead. Bind `agent-usage.toggle` or `agent-usage.refresh` in `keys.json` if you want keys for them.

**Toggling and swapping services.** Each service has a switch in the detail card — flip it off and the service disappears from the strip, the card and the rail (the card footer shows "N hidden · show" to bring them back). Which services exist at all is `herdr-usage/agent-usage/services.json`: add, remove or set `"enabled": false` there and sync — no code changes. Each entry gives the row's `label`, `icon`, `brand` color, how live agents match it (`program`/`apps`), and `api: true` for services whose usage lives server-side instead of in local logs.

**Settings (ctrl-shift-u).** The ⚙ in the card's footer, or ctrl-shift-u, opens a floating settings window (bind `mod.open {name: "usage-settings"}` if your keys.json lost the binding — `./install.sh install usage` adds it for you). Per service: enabled (off = not scanned at all) and in strip (off = scanned, but left out of the widget; the card's switch writes the same setting). Global: how often the scanner re-reads logs (1–60 min) and the limit APIs (5–60 min), plus a clear-cache button. Your edits go to `<HERDR_APP_HOME>/data/agent-usage/config.json`, holding only what differs from the defaults, so re-running the installer or `sync.sh` never clobbers them; the widget follows changes live (it watches the file). A hand-broken config.json is never overwritten: the widget keeps its last good settings and Save refuses until the file parses. Labels, icons, colors and live-agent matchers stay in `services.json`; estimate prices, API endpoints and log dirs live in `scan.mjs`. The widget tells the scanner which services to scan (`scan.mjs --services a,b`), so `scan.mjs` never reads config.json.

It runs `node scan.mjs` from the mod folder every `scan.everyMinutes` (a minute by default, set in the settings). The scanner:

- reads session logs under `~/.claude/projects`, `~/.pi/agent/sessions` and `~/.codex/sessions` (last 8 days) and caches its read offsets in `~/.cache/herdr-agent-usage/`.
- every `scan.limitsEveryMinutes` (five minutes by default), reads the Claude Code OAuth token (from the macOS Keychain item `Claude Code-credentials` or `~/.claude/.credentials.json`) and calls `https://api.anthropic.com/api/oauth/usage` for plan limits. It never refreshes or prints the token. If the token has expired, the card asks you to reconnect. Codex limits come from its logs, with no network call.
- asks `https://opencode.ai/zen/go/v1/usage` (with the plan's API key) for OpenCode Go's rolling 5h / weekly / monthly usage. The key is taken from the first of: `OPENCODE_GO_API_KEY` (or `OPENCODE_API_KEY` / `OPENCODE_ZEN_API_KEY`), pi's `~/.pi/agent/auth.json`, or the opencode CLI's `~/.local/share/opencode/auth.json` — wherever you configured the Go key. It is read, never printed. Without a key the card shows a "not connected" note.

Claude cost is estimated at API list prices, shown with a `~`. pi reports its own cost. OpenCode Go's API reports percentages and reset times only — no dollar figures or history — so its card section shows the three windows without token stats.

## Develop

Edit files in this repo, never in Herdr's home. Then run:

```sh
./install.sh watch           # re-copy every project on change (Ctrl-C stops all)
./herdr-sidebar/sync.sh --watch   # or just one project
```

- **Copies, not symlinks.** Herdr neither hot-reloads nor loads mod SVGs through a symlinked mod folder. If a symlink is found where a mod should be, the installer replaces it with a copy.
- Herdr writes `jsconfig.json` and `*.d.ts` into mod folders. These are never copied or deleted, and git ignores them.
- If Herdr changed the minimal layout in its home (the theme picker writes `theme`), sync adopts the newer copy back into the repo and keeps the old one as `.bak`.
### Type checking

The mods stay plain `.js` (Herdr runs them on QuickJS), with types in JSDoc comments, checked by TypeScript:

```sh
npm install                  # once: typescript + @types/node, dev-only
npm run typecheck            # every mod and the Node scripts
npm run typecheck -- usage   # only projects whose name contains "usage" (`node`: the Node scripts)
npm run typecheck -- --by-file   # error counts per file
node scripts/same-runtime.mjs main   # prove a change touched only comments (JSDoc), not code
```

- Each mod folder has a `tsconfig.json` extending `tsconfig.mod.json`; the root `tsconfig.json` covers the Node scripts (`*.mjs`). Editors pick these up, so errors show inline.
- `noImplicitAny` is on: a parameter without a JSDoc type (`/** @param {string} id */`) is an error. Existing code is being annotated over time, so the check doesn't pass yet.
- The script regenerates each mod's `gpui-kit.d.ts` with `herdr-app check` first. Fixes for gaps in Herdr's own types go in `types/herdr.d.ts`.
- `tsconfig.json` and `*.d.ts` are dev-only; the installers never copy them.
- Give arrays built by `push` in a loop an explicit type: tsc once took ~10 minutes inferring one (`herdr-git` `statusCard`).

- `install.mjs` does all installing (a mirror copy like `rsync --delete`, content-hash status, an mtime poll for `watch`); `scripts/keys.mjs` does the keys.json edits. Each project's `sync.sh` is a one-line wrapper around it.

## Adding a project

1. Create `herdr-<name>/` with its mod folder(s).
2. In `install.mjs`, add the name to `TARGETS` and an entry to `SPEC` (its mods, files and key bindings); install, status, watch and uninstall all read from that.
3. Optionally add a `sync.sh` wrapper like `herdr-sidebar/sync.sh`.
