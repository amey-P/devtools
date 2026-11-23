# Interface: Herdr peruse

Inside a Herdr terminal (`HC_TERMINAL_ID` set), contract drafts, review sheets and reflection sheets open
as documents in the peruse pane. The learner comments on blocks and clicks `choice` options, then presses
Send. Their notes come back as their next message.

```sh
P="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/peruse/bin/peruse.mjs"
node "$P" "$NOTES/learning/<topic>/sessions/2026-11-21-review.md" --title "<Topic> · s4 review"
```

**Always open non-blocking** (no `--wait`). Tell the learner in one line that it's open, then end your turn.
Killing a waiting process cancels the document, so a Bash timeout would throw away their work.

| Exit | Meaning | Do |
|---|---|---|
| 0 | opened | wait for their message |
| 2 | dismissed | ask in chat: stop, skip or reopen |
| 3 | not in Herdr | run the flow in chat |

A closed window isn't a refusal: the document waits in the inbox (ctrl-shift-i). If the learner types in
chat while a document is open, answer them and remind them it's waiting.

## Writing session documents

Session documents go in `sessions/YYYY-MM-DD-<step>.md` (`contract`, `review`, `close`, `milestone`).
Start each one with a banner:

```md
> Comment on a **Answer** block to answer it · click to self-mark · Send when done.
```

**Prompts** are blocks the learner answers by commenting. Each starts with its ID:

```md
> **R3 Answer by commenting here.** «the learner's own prompt, verbatim»
```

**Self-marks and next steps** are the only `choice` fences. They are for logistics, never for content:

````md
```choice
R3 After checking your notes, how did your answer do?
- Pass
- Miss
```
````

- The question starts with its ID and stays on one line. A label can't contain `: ` or a spaced dash.
- Never put `[x]` or `[ ]` in an option.
- Never write a content question as a `choice`, because the options themselves would be content.
- Renders: headings, lists, tables, code, quotes. Doesn't render: mermaid, math, Obsidian callouts.

## Reading what comes back

```md
## 1. Feedback on: "R3 Answer by commenting here. …"
<their answer>
## 2. Decision: "R3 After checking your notes, how did your answer do?"
**Picked:** Pass
## 3. Feedback on: "<some other block>"
<a question or a remark>
## General feedback
…
```

- `Feedback on` an ID'd block is the learner's answer. Store it verbatim where that template field lives.
- `Decision` / `Picked` is a self-mark or a choice. Update the schedule.
- `Feedback on` any other block is a question: take it up the Socratic ladder and log it in `questions.md`.
- An ID with no reply means not attempted. Leave its schedule unchanged.
- `LGTM` alone means sent with nothing: ask whether to do it in chat or skip it.
