# herdr-review

Review documents and agent plans natively in the [Herdr app](https://herdr.dev): a pane beside
the agent to annotate, approve or send feedback. One repo, three install targets:

| Path | Installs to | How |
|---|---|---|
| `mod/` | `$HERDR_APP_HOME/mods/review` (default `~/.config/herdr-app/mods/review`) | copied (or symlinked with `--link`) |
| `mod-inbox/` | `$HERDR_APP_HOME/mods/review-inbox` (opens the review inbox) | the same way, with `mod/` |
| `.claude-plugin/` + `integrations/claude/` | Claude Code marketplace `herdr-local`, plugin `herdr-review` | `claude plugin` CLI; Claude caches a copy per version |
| `integrations/pi/` | pi package in `~/.pi/agent/settings.json` | `pi install`; loaded live from this repo |

The Herdr mod is the hub. The Claude hooks, the `request-review` skill and the pi extension all
load `mods/review/bin/bridge.mjs` from the Herdr app folder, so install the `herdr` target first.

## Install

```sh
node install.mjs install          # all targets
node install.mjs install herdr    # or one: herdr | claude | pi
node install.mjs status           # exit 0 when everything is current
```

`npm link` puts the same CLI on your PATH as `herdr-review`.

## Configure

Reviews open as a **floating window** by default. Drag it by its header. The header names the agent that asked for
the review and where it lives (`from Claude Code · space › tab`). Click that to jump to the agent.

**Later, not now.** ✕ or Esc closes the window but keeps the review: the agent keeps waiting (the Claude hook allows
4 days) and your notes stay. **Dismiss** is the old close: the agent stops waiting and falls back to its own
prompt (Claude's plan dialog, for example).

## Review inbox

`ctrl-shift-i` opens the **review inbox**, a floating window that lists every review from the last week:

- **Needs you**: plans and asks an agent is waiting on (oldest first), then documents with unsent notes or
  feedback not yet sent.
- **Resolved**: approved, changes requested, sent, dismissed, replaced.

Resubmitted versions fold into the newest one (`v3 · 3 versions`). Click a row, or press ↵, to reopen it where you
left off. Each row has buttons to go to its agent, dismiss it while the agent waits, or discard it once it's done.
↑↓ select, tab cycles All · Plans · Asks, and Esc closes the inbox. A review whose agent is gone (killed without
cleaning up) shows as *Agent gone*. Discard it.

To keep new reviews from popping up at all:

```sh
node install.mjs config arrive inbox    # a toast instead of a window; the review waits in the inbox
```

```sh
node install.mjs config                 # show the settings in effect, and where each comes from
node install.mjs config place right     # float | right | down (a split beside the agent) | tab
node install.mjs config width 900       # floating size: px, or a share of the window (0.6)
node install.mjs config height 0.8
node install.mjs config focus false     # don't take the keyboard when a review opens
node install.mjs config arrive inbox    # open (default) | inbox: new reviews wait in the inbox
node install.mjs config width --reset   # back to the default
```

Settings live in `$HERDR_APP_HOME/data/review/config.json`. Per session, `HERDR_REVIEW_PLACE=right` overrides
`place`. Per review, so does `review.mjs --place …` (and the pi tool's `place`). If a floating window can't open,
the review falls back to a split, then a tab.

`ctrl-shift-r` (the last agent reply) also follows `place`. `install herdr` rebinds it to
`mod.open {"name": "review"}` and binds `ctrl-shift-i` to `mod.open {"name": "review-inbox"}` in `keys.json`
(unless that key is taken), keeping a backup in `keys.json.bak-review`.

## Workflow

- **Mod** (`mod/`): edit, then `node install.mjs sync herdr`. It mirrors the files, leaves Herdr's
  own `jsconfig.json` / `*.d.ts` alone and runs `herdr-app check`. Herdr hot-reloads the change.
- **Claude plugin** (`integrations/claude/`): Claude runs a cached copy and only refreshes it when
  the version changes. Run `node install.mjs bump patch`, then `sync claude`, then restart Claude
  sessions. `sync` refuses when the plugin files changed but the version didn't
  (`--force` reinstalls at the same version).
- **pi** (`integrations/pi/`): loaded straight from this repo. Restart pi sessions to reload.

`node install.mjs version 1.0.0` / `bump patch|minor|major` writes the version into
`package.json`, `.claude-plugin/marketplace.json`, the Claude `plugin.json` and the pi `package.json`.

## Uninstall

`node install.mjs uninstall [target]` removes the mod folder, the Claude plugin and marketplace,
and the pi entry. Review history in `$HERDR_APP_HOME/data/review` is kept.
