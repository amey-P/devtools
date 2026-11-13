# herdr-subagents-mcp

One stdio MCP server, shared by **pi** and **Claude Code**, for spawning, steering, waiting on, reading and arranging **subagents** that run in herdr-core (`hc`) terminals. Subagents are usually picked by **role** (planner / worker / reviewer / scout). Each role is an hc template that sets the model, thinking level and tool allowlist. Any other program (claude, a dev server) can be spawned too. Each subagent is shown as a pane in the parent's Herdr tab, so you can watch its work.

Agents never need to read `hc --skill`; the usage contract lives in the tool descriptions.

## Tools

| Mode | When | Tools |
|---|---|---|
| off | `HC_TERMINAL_ID` unset (not inside herdr) | none |
| child | `HC_SUBAGENT_ROLE` set (by a role template) | `subagent_report` |
| parent | otherwise | `subagent_spawn`, `subagent_send`, `subagent_wait`, `subagent_read`, `subagent_stop`, `subagent_list`, `subagent_layout` |

- `subagent_spawn {role, task, name?, cwd?, visible?}` runs `hc run --bg --parent $HC_TERMINAL_ID … -- <role> <task>`. The role enum comes from `hc templates`. If no role templates are installed, the call returns an error telling the agent to run `init`.
- `subagent_spawn {program: [argv…], task?, …}` spawns any program instead of a role: `… -- env HC_SUBAGENT_ROLE=custom <argv…>`. The env prefix puts a child that loads this server (claude, pi) into child mode, so it can report back but can't spawn agents. With a `task`, the server waits up to 60 s for the program to become ready (`hc wait`), then sends the task with a reporting footer. Without a task (servers), it returns right after starting.
- **Panes:** the agent never places panes; the server does, in the background, one at a time. Unless `visible: false`, the child starts headless and the server gives it a pane in the parent's tab (master + stack, `src/placement.rs`):
  - The first child splits the parent's pane right, so the parent keeps the left half.
  - Each later child halves the largest child pane (by `cols × rows` from `hc get`) along its long side (`right` if `cols > 2 × rows`, else `down`). Herdr splits are 50/50, so panes stay within 2× of each other.
  - If that half would be under 60×10, it tries the other direction; if neither fits, the child gets its own tab.
  - `terminal.keep` splits the focused pane, so the server focuses the target, keeps the child, waits until its pane appears (`HERDR_MCP_SETTLE_MS`, default 1500), then puts focus back. Only the parent's own panes and its children's are split.
  - When the person is looking at another tab, it falls back to copying the parent's `herdr.space`/`herdr.tab` labels and Herdr places it, so the view never jumps. Outside a Herdr window the child runs headless and the result says so.
  - When a child reports, its pane is parked (`terminal.park`): it keeps running and its space frees up. `subagent_send` to it places it again. `subagent_layout hide` opts a child out of that.
- `subagent_send {to, message, wait?, timeout?}` runs `hc send`, never `--force`. With `wait`, it reads the nested `.wait` result.
- `subagent_wait {target?, mode?: any|all, timeout? (180, max 600)}`. A timeout is a check-in; `reason: message` means a report is arriving as input.
- `subagent_read {name, lines?}` returns the screen, cleaned and capped at 120 lines / 6 KB.
- `subagent_stop {name, kill?}` sends an interrupt, or with `kill`, runs kill + rm.
- `subagent_list` lists the children of this terminal.
- `subagent_layout {name, action, place?, with?}` arranges a child's pane. It refuses terminals that aren't this terminal's children. Actions:
  - `show`: `place: here` (the default) places it as above; `place: tab` runs `herdr-app do terminal.keep` with `place: tab`.
  - `hide`: `terminal.park`. The pane goes away and the terminal keeps running.
  - `focus`, `zoom` (toggles), and `swap` (`with` another child or `me`). These look up pane IDs with `herdr-app ls`.

  Window changes apply a moment after the call returns.
- `subagent_report {message}` (child only) sends `hc send <parent>`, then parks its own pane. The parent comes from `hc get`.

Children report back as `<hc from="<addr> <name>">…</hc>` input typed into the parent's TUI. This works for pi and for interactive Claude Code, but not under `claude -p`.

Long calls (spawn, wait, send with wait, report) send MCP progress notifications every 15 s, which reset pi's 60 s request timeout. Cancelling the request (Esc) kills the `hc` process. The server watches the templates directory and sends `tools/list_changed` when roles change.

## Build

```sh
cargo build --release
cargo test          # unit tests + stdio integration tests against tests/fake-hc.sh and tests/fake-herdr-app.sh
```

Both clients run `target/release/herdr-subagents-mcp` directly, so a rebuild takes effect in the next session.

## Setup

**The server name must be `herdr`** in both clients. Role templates allowlist `mcp__herdr__subagent_report`, so any other name breaks child reporting.

pi, in `~/.pi/agent/mcp.json`. `exposure: direct` is required (the default `codemode` hides the tools), and `timeout` is a backstop above the 600 s max wait:

```json
{ "mcpServers": { "herdr": {
  "command": "~/workspace/devtools/herdr-subagents-mcp/target/release/herdr-subagents-mcp",
  "exposure": "direct",
  "timeout": 700,
  "description": "Spawn, steer, wait on and read herdr pi subagents by role"
}}}
```

Claude Code:

```sh
claude mcp add --scope user herdr -- /Volumes/amey/Users/amey/workspace/devtools/herdr-subagents-mcp/target/release/herdr-subagents-mcp
```

`~/.claude/settings.json` allows `mcp__herdr__*` without prompting.

Check with `pi mcp list` and `claude mcp list`.

## Roles

```sh
herdr-subagents-mcp init      # write missing templates to ~/.config/herdr-core/templates (never overwrites)
herdr-subagents-mcp migrate   # rewrite templates from the old pi extension; shows a diff and skips files you edited
                              # (--force ROLE to replace an edited one)
```

| Role | Model | Thinking | Tools |
|---|---|---|---|
| planner | opencode-go/deepseek-v4.1-flash | high | read, grep, find, ls, write |
| worker | opencode-go/deepseek-v4.1-flash | medium | read, bash, edit, write, grep, find, ls |
| reviewer | zai/glm-5.3-flash | high | read, grep, find, ls, bash |
| scout | opencode-go/deepseek-v4.1-flash | low | read, grep, find, ls |

The template command shape is:

```
HC_SUBAGENT_ROLE=<role> /opt/homebrew/bin/pi --model <provider/id> --thinking <lvl> --tools <list>,mcp__herdr__subagent_report
```

The env var puts the child's MCP server into child mode. Because `--tools` contains an `mcp__` entry, pi drops every other MCP tool, so children cannot spawn agents. You can edit templates freely, or add your own. A template counts as a role when its command contains `HC_SUBAGENT_ROLE=`.

## Footguns (handled; keep them that way)

- Children are interactive pi, never `pi -p`. Tasks go in `hc run <template> <task>`, never sent to a booting agent. If `first_message.sent` is false, read before resending.
- Never `hc send --force`. `blocked` means a person is needed.
- `hc ls` lists every terminal the user has. Filter by `parent`, and only stop what you started.
- Use `provider/id` model names and the absolute pi path in templates, which run via `sh -c`.
- `HC_BIN` overrides the `hc` binary and `HERDR_APP_BIN` the `herdr-app` binary (both used by tests). `HERDR_MCP_PROGRESS_MS` overrides the progress interval.

## Not exposed yet

hc can do these, but the tools don't offer them:
- `hc keys`, to clear a readiness or trust dialog after `first_message.sent=false`
- `hc get` detail
- child → sibling messaging
- `--on <machine>`, `--outlive-parent`, `--no-notify`
- `wait --output`

`send`, `read`, `stop` and `wait target` don't check that the terminal is one of your children (`layout` does).
