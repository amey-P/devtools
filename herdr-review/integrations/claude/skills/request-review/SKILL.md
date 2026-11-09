---
name: request-review
description: Ask the user to review and annotate a document in the Herdr app (a draft, spec, design note, long answer or any markdown/text file) and get their feedback back. Use when the user asks you to "send it for review", "let me annotate it", or when you want structured feedback on a written artifact before continuing. Only works inside a Herdr app terminal (HC_TERMINAL_ID is set). Not for plans in plan mode: ExitPlanMode already opens the review.
---

# Request a review in Herdr

The Herdr app has a review pane where the user can comment on, delete or replace any block of a document
and add global comments. Their feedback comes back to you as markdown.

1. Write what you want reviewed to a file (markdown preferred), or pipe text on stdin (`-`).
2. Run one of:

```sh
# Block until the user sends feedback; prints it (or "LGTM") on stdout.
node "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/review/bin/review.mjs" path/to/doc.md --wait --title "API design"

# Don't block: the pane opens, you continue; the feedback arrives later as the user's next message.
node "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/review/bin/review.mjs" path/to/doc.md
```

The review opens where the user set it (a floating window by default). Only pass `--place float|right|down|tab`
when the user asks for a specific placement this time.

The user can close the review and come back to it later from Herdr's review inbox (ctrl-shift-i), so a closed
window isn't a refusal. Prefer the non-blocking form unless you can't continue without the answer.
With `--wait`, give the Bash call a long timeout (up to 600000 ms). If it times out, tell the user to send their
feedback in chat when they're ready, and wait for their message.

Exit codes: 0 feedback or `LGTM` on stdout · 2 the user dismissed the review (ask them in chat) ·
3 not inside the Herdr app (ask for feedback in chat instead).

Address every piece of feedback. Run it again after revising if the user wants another round.
