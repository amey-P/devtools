# herdr-subagents-mcp

One stdio MCP server, shared by **pi** and **Claude Code**, for spawning, steering, waiting on and reading **pi subagents** that run in herdr-core (`hc`) terminals. Subagents are picked by **role** (planner / worker / reviewer / scout). Each role is an hc template that sets the model, thinking level and tool allowlist.

Agents never need to read `hc --skill`; the usage contract lives in the tool descriptions.

## Tools

| Mode | When | Tools |
|---|---|---|
| off | `HC_TERMINAL_ID` unset (not inside herdr) | none |
| child | `HC_SUBAGENT_ROLE` set (by a role template) | `subagent_report` |
| parent | otherwise | `subagent_spawn`, `subagent_send`, `subagent_wait`, `subagent_read`, `subagent_stop`, `subagent_list` |

- `subagent_spawn {role, task, name?, cwd?}` runs `hc run --bg --parent $HC_TERMINAL_ID … -- <role> <task>`. The role enum comes from `hc templates`. If no role templates are installed, the call returns an error telling the agent to run `init`.
- `subagent_send {to, message, wait?, timeout?}` runs `hc send`, never `--force`. With `wait`, it reads the nested `.wait` result.
- `subagent_wait {target?, mode?: any|all, timeout? (180, max 600)}`. A timeout is a check-in; `reason: message` means a report is arriving as input.
- `subagent_read {name, lines?}` returns the screen, cleaned and capped at 120 lines / 6 KB.
- `subagent_stop {name, kill?}` sends an interrupt, or with `kill`, runs kill + rm.
- `subagent_list` lists the children of this terminal.
- `subagent_report {message}` (child only) sends `hc send <parent>`. The parent comes from `hc get`.

Children report back as `<hc from="<addr> <name>">…</hc>` input typed into the parent's TUI. This works for pi and for interactive Claude Code, but not under `claude -p`.

Long calls (spawn, wait, send with wait, report) send MCP progress notifications every 15 s, which reset pi's 60 s request timeout. Cancelling the request (Esc) kills the `hc` process. The server watches the templates directory and sends `tools/list_changed` when roles change.

## Build

```sh
cargo build --release
cargo test          # unit tests + stdio integration tests against tests/fake-hc.sh
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
- `HC_BIN` overrides the `hc` binary (used by tests). `HERDR_MCP_PROGRESS_MS` overrides the progress interval.
