# peruse plugin

The agent side of [herdr-peruse](../../herdr-peruse/README.md): agents hand you long answers, open questions
and plans as documents to read and annotate in the Herdr app, and their questions open as options to click.
One folder, two agent targets:

| Target | Files | Installs as |
|---|---|---|
| `claude` | `.claude-plugin/plugin.json`, `hooks/`, `bin/`, `skills/peruse/` | plugin `herdr-peruse` from the repo's `agentctl` marketplace (`.claude-plugin/marketplace.json` at the root) |
| `pi` | `package.json` (`"pi"` field), `pi/index.ts` | a pi package in `~/.pi/agent/settings.json`, loaded live from this folder |

Every target loads the bridge from `$HERDR_APP_HOME/mods/peruse/bin/bridge.mjs`, so it needs the peruse mods
(`./install.sh install peruse`). Outside a Herdr terminal the hooks step aside and the agent's normal prompts show.

## Install

From the repo root (opt-in: plain `./install.sh install` never touches agents):

```sh
./install.sh install plugins peruse          # every agent on PATH
./install.sh install plugins peruse claude   # or one: claude | pi
./install.sh install plugins                 # later: refresh what's installed
./install.sh status plugins
./install.sh uninstall plugins peruse [claude|pi]
```

## Workflow

- **Claude** runs a cached copy and only refreshes it when the version changes. After an edit run
  `./install.sh bump peruse patch`, then `./install.sh install plugins`, then restart Claude sessions.
  `install` refuses when the files changed but the version didn't (`--force` reinstalls at the same version).
  `bump` writes `package.json`, `.claude-plugin/plugin.json` and the marketplace entry.
- **pi** loads this folder directly: restart pi sessions to reload.

## Adding a target

A target is detected from the files in this folder (see `scripts/plugins.mjs`). Another agent is one more adapter
there, plus that agent's manifest here.
