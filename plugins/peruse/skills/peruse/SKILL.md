---
name: peruse
description: Show the user a document to read and annotate in the Herdr app instead of a wall of text in the terminal. Use it on your own whenever an answer would run past ~40 lines or needs several sections, tables or long code (an explanation, a comparison, a design note, a review, a report), whenever you have 3 or more open questions that need context to answer (put them in the doc as ```choice blocks), and when the user asks to read, review or annotate something ("let me read it", "send it for review"). Their notes and picks come back as their next message. Only inside a Herdr app terminal (HC_TERMINAL_ID is set). Not for 1-4 quick questions (use AskUserQuestion).
---

# Peruse: hand the user a document

The Herdr app shows a markdown file as a document to read. The user can comment on, delete or replace any block, add
global notes, and click options in ```choice blocks. Their notes come back to you as markdown.

## When to use it (your call)

- **Long answers.** If the reply would be more than about 40 lines, or needs headings, tables or long code, write it
  as a document instead of printing it. The terminal is a poor place to read long text, and the user can't annotate it there.
- **Questions with context.** With 3 or more open questions, or questions that only make sense next to an explanation,
  put them in the document as `choice` blocks beside that explanation. Don't ask them in prose at the end of a long reply.
- **Asked for.** The user says "let me read it", "send it for review", "I want to annotate this", or similar.

Keep short answers in the terminal. For 1-4 quick questions that need no background, use AskUserQuestion (inside Herdr
it opens there as options to click).

## How

1. Write the document to `.peruse/<YYYY-MM-DD>-<slug>.md` at the root of the working directory (`date +%F` for the date;
   the slug is 2-4 lowercase words joined by hyphens, e.g. `.peruse/2026-11-15-auth-options.md`). If the user named
   a file, or the document belongs somewhere specific (a spec in `docs/`), use that path instead.
   Keep `.peruse/` out of git: if `git check-ignore -q .peruse` fails, add `.peruse/` to `.git/info/exclude` (local;
   leave the project's .gitignore alone), unless the project keeps these in git.
2. Open it, without waiting:

   ```sh
   node "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/peruse/bin/peruse.mjs" .peruse/2026-11-15-auth-options.md --title "Auth options"
   ```

3. In the terminal, reply in 1-3 lines: the gist, and that the full write-up is open in Herdr (with the path). Don't
   repeat the document. Then stop and wait for the user: their notes arrive as their next message.

Add `--wait` only when you can't continue without their answer. It blocks until they send their notes (printed on
stdout, or `LGTM` if they approve without notes), so give the Bash call a long timeout (up to 600000 ms). If it times
out, tell the user to send their notes in chat when they're ready. Only pass `--place float|right|down|tab` when the
user asks for a placement this time.

Exit codes: 0 opened (or the notes / `LGTM` with `--wait`) · 2 the user dismissed it (ask them in chat) · 3 not inside
the Herdr app (give the answer in the terminal instead).

The user can close the window and come back to it from Herdr's inbox (ctrl-shift-i), so a closed window isn't a
refusal. *Done reading* means they read it and have nothing to add.

When notes come back, address every one. If they ask for changes, edit the same file and open it again. The new
version replaces the old one in their inbox.

## Writing the document

- Start with a `# Title`, then the answer or recommendation first. Use sections the user can comment on one at a time.
- Put each decision in a `choice` fence right where its context is. The user picks with a click, and the pick comes
  back as `Decision: "…"` / `Picked: …`:

  ````md
  ```choice
  Which storage backend?
  - Postgres: durable, needs a server
  - SQLite: zero setup
  ```
  ````

  Use `choice multi` when several options can be picked. Option lines are `- label: description`. If you have a
  recommendation, say so in the option's description.

## Other entry points

- Text without a file: pipe it on stdin with `-` (`… peruse.mjs - --title "Draft reply"`).
- Quick questions from scripts or other agents: `ask.mjs` waits and prints the answers as JSON:

  ```sh
  node "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/peruse/bin/ask.mjs" "Which database?" -o Postgres -o "SQLite:zero setup"
  ```

- The user can open any file themselves with `peruse.mjs open <file>`. That isn't for you to call.
