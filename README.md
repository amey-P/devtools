# herdr-app devtools

Mods, layouts and agent integrations for the [Herdr app](https://herdr.dev). They live in one repo and one script installs them on macOS or Linux.

| Project | Installs | Into `$HERDR_APP_HOME` |
|---|---|---|
| `herdr-git/` | Git graph and status pane (ctrl-shift-g) | `mods/git` |
| `herdr-minimal/` | The minimal layout and the space-icons mod | `layouts/minimal.{json,svg}`, `mods/space-icons` |
| `herdr-sidebar/` | Space-tree sidebar mod, used by the minimal layout | `mods/space-tree` |
| `herdr-review/` | Review mod and inbox, plus a Claude Code plugin and a pi extension | `mods/review`, `mods/review-inbox` (see [its README](herdr-review/README.md)) |

`HERDR_APP_HOME` defaults to `~/.config/herdr-app`.

## Install

```sh
git clone https://github.com/amey-P/devtools.git herdr-app && cd herdr-app
./install.sh                 # install everything
./install.sh install git     # or one target: git | minimal | sidebar | review
./install.sh status          # ● current  ◐ differs/symlink  ○ missing; exit 0 when all current
./install.sh uninstall [target]
```

You can also skip the clone:

```sh
curl -fsSL https://raw.githubusercontent.com/amey-P/devtools/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/amey-P/devtools/main/install.sh | bash -s -- install review   # pass a command/target
```

The bootstrap clones into `~/.local/share/herdr-devtools`, or pulls there if a clone already exists, and then runs that copy's `install.sh`.

**Requirements:** `bash`, `rsync`, `git` (for the bootstrap). The `review` target also needs Node.js 18+. When a tool is missing, the script prints the install command for your OS (brew, apt, dnf, pacman, apk or zypper). The `review` target sets up the Claude and pi integrations only when `claude` or `pi` is on PATH. When `herdr-app` is on PATH, each mod is validated with `herdr-app check`.

| Variable | Default | |
|---|---|---|
| `HERDR_APP_HOME` | `~/.config/herdr-app` | Herdr's home |
| `HERDR_DEVTOOLS_REPO` | `https://github.com/amey-P/devtools.git` | Git URL the bootstrap clones from |
| `HERDR_DEVTOOLS_DIR` | `~/.local/share/herdr-devtools` | Where the bootstrap clones to |

## Develop

Edit files in this repo, never in Herdr's home. Then run:

```sh
./install.sh watch           # re-copy every project on change (Ctrl-C stops all)
./herdr-sidebar/sync.sh --watch   # or just one project
```

- **Copies, not symlinks.** Herdr neither hot-reloads nor loads mod SVGs through a symlinked mod folder. If a symlink is found where a mod should be, the installer replaces it with a copy.
- Herdr writes `jsconfig.json` and `*.d.ts` into mod folders. These are never copied or deleted, and git ignores them.
- If Herdr changed the minimal layout in its home (the theme picker writes `theme`), sync adopts the newer copy back into the repo and keeps the old one as `.bak`.
- Shared helpers live in `scripts/lib.sh` (`sync_mod`, `sync_file`, `watch_loop`, `need`). They are portable across BSD/macOS and GNU/Linux userlands and bash 3.2+.

## Adding a project

1. Create `herdr-<name>/` and add a `sync.sh` that sources `../scripts/lib.sh` and calls `sync_mod`. `herdr-sidebar/sync.sh` is the shortest example.
2. In `install.sh`, add the name to `TARGETS` and add a case in `status_target` and `uninstall_target`.
