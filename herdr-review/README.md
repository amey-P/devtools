# herdr-review

Review documents and agent plans natively in the [Herdr app](https://herdr.dev): a pane beside
the agent to annotate, approve or send feedback. Agents can also ask **quick decisions**: options to click, answered in
seconds. One repo, three install targets:

| Path | Installs to | How |
|---|---|---|
| `mod/` | `$HERDR_APP_HOME/mods/review` (default `~/.config/herdr-app/mods/review`) | copied (or symlinked with `--link`) |
| `mod-inbox/` | `$HERDR_APP_HOME/mods/review-inbox` (opens the review inbox) | the same way, with `mod/` |
| `mod-settings/` | `$HERDR_APP_HOME/mods/review-settings` (opens the settings window) | the same way, with `mod/` |
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

Reviews open as a **floating window** by default. Drag it by its header.

**Gentle arrivals.** A review an agent asks for never takes over the screen:

- On the agent's workspace it fades in where `window.place` says, and the keyboard stays where it was.
- On another workspace nothing opens. A small **pill** slides in at the top of the window with a pulsing dot. Click
  it to open the review: the floating window, or (split/tab) Herdr takes you to the agent with the review beside it.
  Switch to that workspace yourself and it opens there quietly. ✕ on the pill sends it to the inbox; `+N` opens the
  inbox when several are waiting.

 The header names the agent that asked for
the review and where it lives (`from Claude Code · space › tab`). Click that to jump to the agent.

**Later, not now.** ✕ or Esc closes the window but keeps the review: the agent keeps waiting (the Claude hook allows
4 days) and your notes stay. **Dismiss** is the old close: the agent stops waiting and falls back to its own
prompt (Claude's plan dialog, for example).

**Approve follows your notes.** With no annotations, **Approve** is the main button (⌘⇧↵) and *Request changes*
stays quiet (it starts a global comment). Once you've annotated, *Request changes* leads (⌘↵) and Approve becomes
**Approve with notes ▾**, so a stray click can't throw your notes away. The ▾ menu also offers *Approve, discard
notes*; ⌘⇧↵ opens that menu, and ⌘⇧↵ again approves with the notes. While a note is being written, both buttons wait
until you save or cancel it.

Inside the pane, things ease in and out instead of popping: new notes and the editor fade in, the block toolbar
appears softly on hover, the sidebar slides, the result card settles in once you decide, and a floating window
fades out as it closes.

## Quick decisions

Some questions need a pick, not an annotation. A **decision** opens like a review (the same window, pill, inbox and
Dismiss/later rules) and shows one card per question: options to click (radio, or checkboxes for *pick any*), an
**Other…** row for your own words, and *Add a note*. An option's preview (code, a mockup) shows beside the options while
it's hovered. Keys: `1–9` pick, `0` Other, ↑↓ move, space/↵ pick, tab next question, ⌘↵ submit.

They come from:

- **Claude Code**: its `AskUserQuestion` tool. The plugin's PermissionRequest hook opens the questions in Herdr and
  hands the answers back as the tool's `answers`. Dismiss falls back to Claude's own dialog. If your Claude version
  ignores hook answers, set `HERDR_REVIEW_ASK=deny` to deliver them as a message instead.
- **pi**: the `ask_user` tool.
- **Anything else**: `mod/bin/ask.mjs` waits and prints the answers as JSON (exit 2 dismissed, 3 not in Herdr):

  ```sh
  node mod/bin/ask.mjs "Which database?" -o Postgres -o "SQLite:zero setup" [--multi] [--header DB] [--text]
  node mod/bin/ask.mjs spec.json        # {"questions": [...]} in AskUserQuestion's shape, or - for stdin
  ```

**Choices inside a document.** A plan or document can carry decisions too: a fence with the info string `choice`
(`choice multi` for several picks) shows its options as chips to click:

````md
```choice
Which storage backend?
- Postgres: durable, needs a server
- SQLite: zero setup
```
````

A pick is sent with the rest of your feedback (`Decision: "…"` · `Picked: …`), on Request changes or Approve with notes.

## Review inbox

`ctrl-shift-i` opens the **review inbox**, a floating window that lists every review from the last week:

- **Needs you**: plans, asks and decisions an agent is waiting on (oldest first), then documents with unsent notes or
  feedback not yet sent.
- **Resolved**: approved, changes requested, answered, sent, dismissed, replaced.

Resubmitted versions fold into the newest one (`v3 · 3 versions`). Click a row, or press ↵, to reopen it where you
left off. Each row has buttons to go to its agent, dismiss it while the agent waits, or discard it once it's done.
↑↓ select, tab cycles All · Plans · Asks · Decisions, and Esc closes the inbox. A review whose agent is gone (killed without
cleaning up) shows as *Agent gone*. Discard it.

To keep new reviews from popping up at all, set **When a review arrives → Wait in the inbox** in Settings
(or `node install.mjs config window.arrive inbox`): a toast instead of a window, and the review waits in the inbox.

## Settings

Click **⚙** in a review's header (or in the inbox) to open the settings. Edits stay a draft until **Save** (⌘S).
**Revert** undoes them, **Reset all** goes back to the defaults, and each changed field has its own *reset*. Saving
updates every open review and the inbox straight away. To bind a key, add `mod.open {"name": "review-settings"}` to
`keys.json`, or bind the `review.settings` command inside a review.

| Tab | What it sets |
|---|---|
| **Window** | where reviews open (floating, split right/down, tab), floating size, focus, open vs. wait in the inbox |
| **Appearance** | font (any installed family), text size, document and sidebar width, sidebar default, reading time |
| **Agent text** | everything the agent is told: the "plan not approved" message, approved-with-notes, feedback headings and intro, section titles, pi's plan-mode framing, what pi is told when a plan is approved |

Everything is saved as JSON in `$HERDR_APP_HOME/data/review/config.json`. The file holds only what differs from
[`mod/config.defaults.json`](mod/config.defaults.json) and points at [`mod/config.schema.json`](mod/config.schema.json),
so editors complete and check it. You can edit it by hand:

```jsonc
{
  "$schema": "../../mods/review/config.schema.json",
  "window": { "place": "right", "arrive": "inbox" },
  "ui": { "font": "Georgia", "textSize": 15, "sidebar": "closed" },
  "prompts": {
    "deny": ["Not approved yet. Address every point below, then resubmit.", "", ""],
    "feedback": { "intro": "Here are {count} notes on {subject}:" }
  }
}
```

- Text can be a string or an array of lines. Words in `{braces}` are filled in: `{subject}`, `{count}`, `{name}`,
  `{path}`, `{quote}`, `{tool}` (the Agent text tab lists which apply where).
- A value of the wrong type or out of range is ignored; the default is used. The old flat keys (`place`, `width`,
  `height`, `focus`, `arrive`) still work and move under `window` on the next save.
- Changes apply to the next review and the next decision (Claude's hook reads them on each plan; pi on its next turn).
- `ui.textSize` 0 means the theme's size. Code blocks keep the theme's code font.

From the command line:

```sh
node install.mjs config                          # every setting, its value, and where it comes from
node install.mjs config window.place right       # float | right | down | tab  (old form: config place right)
node install.mjs config ui.font "JetBrains Mono"
node install.mjs config prompts.deny "Revise the plan:\n\n"   # \n is a new line
node install.mjs config prompts.deny --reset     # back to the default
node install.mjs config edit                     # open config.json in $EDITOR
node install.mjs config path
```

Per session, `HERDR_REVIEW_PLACE=right` overrides `window.place`. Per review, so does `review.mjs --place …` (and the
pi tool's `place`). If a floating window can't open, the review falls back to a split, then a tab.

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
- **Settings**: add a setting to `mod/config.defaults.json` (plus a rule in `mod/config-core.js` if it needs one),
  then run `node scripts/config-schema.mjs` to regenerate the schema.

`node install.mjs version 1.0.0` / `bump patch|minor|major` writes the version into
`package.json`, `.claude-plugin/marketplace.json`, the Claude `plugin.json` and the pi `package.json`.

## Uninstall

`node install.mjs uninstall [target]` removes the mod folder, the Claude plugin and marketplace,
and the pi entry. Review history in `$HERDR_APP_HOME/data/review` is kept.
