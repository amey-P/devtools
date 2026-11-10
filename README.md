# herdr-app devtools

Mods, layouts and agent integrations for the [Herdr app](https://herdr.dev). They live in one repo and one script installs them on macOS or Linux.

| Project | Installs | Into `$HERDR_APP_HOME` |
|---|---|---|
| `herdr-git/` | Git graph and status pane (ctrl-shift-g) | `mods/git` |
| `herdr-minimal/` | The minimal layout and the space-icons mod | `layouts/minimal.{json,svg}`, `mods/space-icons` |
| `herdr-sidebar/` | Space-tree sidebar mod, used by the minimal layout | `mods/space-tree` |
| `herdr-usage/` | Agent usage widget at the bottom of the minimal layout's sidebar, plus its settings page (ctrl-shift-u) (see below) | `mods/agent-usage`, `mods/usage-settings` |
| `herdr-review/` | Review mod and inbox, plus a Claude Code plugin and a pi extension | `mods/review`, `mods/review-inbox` (see [its README](herdr-review/README.md)) |

`HERDR_APP_HOME` defaults to `~/.config/herdr-app`.

## Install

```sh
git clone https://github.com/amey-P/devtools.git herdr-app && cd herdr-app
./install.sh                 # install everything
./install.sh install git     # or one target: git | minimal | sidebar | usage | review
./install.sh status          # ● current  ◐ differs/symlink  ○ missing; exit 0 when all current
./install.sh uninstall [target]
```

You can also skip the clone:

```sh
curl -fsSL https://raw.githubusercontent.com/amey-P/devtools/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/amey-P/devtools/main/install.sh | bash -s -- install review   # pass a command/target
```

The bootstrap clones into `~/.local/share/herdr-devtools`, or pulls there if a clone already exists, and then runs that copy's `install.sh`.

**Requirements:** `bash`, `rsync`, `git` (for the bootstrap). The `review` and `usage` targets also need Node.js 18+. When a tool is missing, the script prints the install command for your OS (brew, apt, dnf, pacman, apk or zypper). The `review` target sets up the Claude and pi integrations only when `claude` or `pi` is on PATH. When `herdr-app` is on PATH, each mod is validated with `herdr-app check`.

| Variable | Default | |
|---|---|---|
| `HERDR_APP_HOME` | `~/.config/herdr-app` | Herdr's home |
| `HERDR_DEVTOOLS_REPO` | `https://github.com/amey-P/devtools.git` | Git URL the bootstrap clones from |
| `HERDR_DEVTOOLS_DIR` | `~/.local/share/herdr-devtools` | Where the bootstrap clones to |

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

- Shared helpers live in `scripts/lib.sh` (`sync_mod`, `sync_file`, `watch_loop`, `need`). They are portable across BSD/macOS and GNU/Linux userlands and bash 3.2+.

## Adding a project

1. Create `herdr-<name>/` and add a `sync.sh` that sources `../scripts/lib.sh` and calls `sync_mod`. `herdr-sidebar/sync.sh` is the shortest example.
2. In `install.sh`, add the name to `TARGETS` and add a case in `status_target` and `uninstall_target`.
