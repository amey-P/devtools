# Runtime: getting isolated cold readers

## Find a mechanism
In order of preference:
1. **The host's native subagent tool** (e.g. Claude Code's `Agent` tool, which takes a `model` override), or the equivalent in other harnesses.
2. **A headless CLI on PATH** that can disable tools and context: check `command -v claude pi codex …` and read `--help`. A separate process with tools disabled gives the strongest isolation.

If neither exists, tell the user. Don't simulate readers yourself.

## Isolation contract for readers
- A fresh subagent every run. Never resume one: a reader who has seen an earlier draft is no longer cold.
- Inputs are only the reader persona, the role line, the Check, the reader profile and the draft.
- Switch off project context, memory, skills, MCP and web wherever the mechanism allows.
- Prefer inlining both inputs so the reader needs no tools (a CLI can do this with `@file` or `$(cat …)` without pulling the draft into your own context). Otherwise give the two paths with: *"Read exactly these two files and nothing else. Use no other tools."*

The writer needs tools for research and for writing files. Give it the synthesized feedback, never raw reports.

## Model choice
List the models the mechanism offers. A strong model usually suits the writer. Put at least one reader on the weakest available model (e.g. a Haiku-class one) as the legibility floor. Other readers can use a different model family for variety. If only one model exists, carry on and say so in your final report.

Runs take minutes. Run readers in parallel in the background and wait for completion rather than polling. If a run produces nothing, fix the cause and re-run it. Never hand-write its output.

## Examples (check flags against `--help`)

**Claude Code `Agent` tool**
```
Agent(description="Cold reader", model="haiku",
      prompt="<agents/validator.md>\n\nYour role: <role>\nYour check: <check>\n\nRead exactly these two files and nothing else, using no other tools:\n- <reader profile path>\n- <draft path>\nThen write your report.")
```

**`claude -p`** (separate process, no tools)
```bash
claude -p --model haiku --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence \
  --system-prompt "$(cat "$SKILL/agents/validator.md")" \
  "Your role: $ROLE
Your check: $CHECK
=== reader profile ===
$(cat "$READER")
=== material ===
$(cat "$DRAFT")" </dev/null > "$REPORT"
```

**`pi`** (separate process, no tools)
```bash
( cd "$(mktemp -d)" && pi --print --no-session --no-tools --no-skills --no-context-files \
    --no-extensions --no-mcp --no-prompt-templates --model "$WEAK_MODEL" \
    --system-prompt "$(cat "$SKILL/agents/validator.md")" \
    @"$READER" @"$DRAFT" "Your role: $ROLE  Your check: $CHECK  Read cold, then report." </dev/null ) > "$REPORT"
```
`</dev/null` matters: `pi --print` blocks when it reads a non-TTY stdin.
