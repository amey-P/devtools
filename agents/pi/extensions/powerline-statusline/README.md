# powerline-statusline

Single-row powerline footer for pi, replacing the built-in footer in TUI mode.

```
< mode >< folder >< git > ···· < tok/s >< other statuses > ···· < context >< model >
```

- **Left**
  - **mode** — mode emoji + uppercase mode name, plus a compact plannotator
    phase suffix when it adds information (`PLAN·exec 3/5`, `YOLO·plan`).
    Colored from this pill's fixed palette: yolo red, plan magenta, careful
    green, custom modes slate. (mode-manager's own status text uses theme
    `accent` for both plan and custom; the pill keeps them apart.) Hidden only
    when mode-manager is absent.
  - **folder** — cwd, home abbreviated.
  - **git** — branch plus `~conflicts +staged !unstaged ?untracked` counts
    (zero counts omitted). Green when clean, amber when dirty, slate with a
    warning glyph when the status read failed.
- **Center**
  - **tok/s** — live while a message streams, last measured value otherwise
    (idle, tool runs, waiting for the next response).
  - **other statuses** — other extensions' `setStatus` texts (otherwise hidden,
    since this footer replaces pi's), sharing one dark pill, truncated to the
    space left and omitted when too little remains. Mode-manager and
    plannotator statuses are not repeated here; they are on the mode pill.
- **Right**
  - **context** — used tokens / model context window; green, amber ≥70%,
    red ≥90%.
  - **model** — current model, with its thinking-level suffix.

Toggle with `/powerline-status` (off restores pi's default footer).

## Design conventions

Classic powerline conventions (powerline, oh-my-posh, powerlevel10k, starship):

- Icons only from stable Nerd Fonts ranges (Powerline E0A0–E0D4, Font Awesome
  F000–F2FF; never Material Design F500+, which v3 moved).
- State is a background swap, never a new element. The mode pill is always
  visible while mode-manager publishes a mode.
- Status texts arrive wrapped in theme SGR (and possibly OSC 8) sequences;
  they are stripped with pi-tui's `stripTerminalSequences` so this pill's
  palette stays authoritative and widths are measured correctly.

## Where the mode comes from

1. `mode-manager:changed` events (`ModeFeed` in `values/mode.ts`). On install
   the footer also sends `mode-manager:request { action: "status" }` so a
   footer that starts late learns the current mode. See the events contract in
   `../mode-manager/README.md`.
2. Fallback until the first event: mode-manager's `setStatus` text under the
   `mode-manager` key (`Ⓜ <mode>`).

Plannotator's phase comes from its own `plannotator` status text (`⏸ plan`
while planning, `📋 3/5` while executing), which it rewrites on every change.

The channel names are duplicated from `mode-manager/events.ts` because
extensions must not import each other.

## Files

- `index.ts` — wiring only: footer install/removal, event subscriptions, command.
- `render.ts` — row composition: the only module that knows what each pill holds (pure).
- `pills.ts`, `layout.ts` — painting and zone layout.
- `values/` — services: `git.ts` (throttled, single-flight git status),
  `mode.ts` (mode feed and status parsing), `tokps.ts` (token rate).

Each footer install creates a fresh `GitWatcher` (and disposes the previous
one); removal disposes it. The token-rate tracker and the mode feed are created
once per extension instance and live across installs.
