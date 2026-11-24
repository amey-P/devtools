# Phase 9 report: `space-icons-g` installed side by side and verified live (2026-11-24)

## Install

- `scripts/build.sh && scripts/install.sh && scripts/check.sh` →
  `check passed: ~/.config/herdr-app/mods/space-icons-g`, and `herdr-app status` → `"errors": []`.
- `overrides.json` in `mods/space-icons-g` is byte-identical to `mods/space-icons-base/overrides.json`
  (`_example-lucide` pinned to `rocket`, `_example-family` forced to `radial`, `_example-reroll` re-seeded).

## A live bug found and fixed: `SpaceInfo.status` can be null

On the first live shot, the new rail showed only its "+" button. The cause: `herdr.d.ts` declares
`status: Status | null`, and the core's snapshot decoder required a string. One null status made
the whole `spaces` list fail to decode, and it fell back to `[]`. The fakes and the golden matrix
only ever used string statuses, so every test passed.

- **Fix:** `Space.status` is now `Option(String)`. `null` becomes `None`, which is not loud, the
  same as the oracle's `LOUD.has(null)`. `machine` was already nullable.
- **Red first:** `parity/view.test.js` › "SpaceInfo as Herdr sends it" has 2 cases: null status,
  and a mixed rail with null/`working`/`idle` statuses, `vps`/`""`/null machines and the extra
  SpaceInfo fields. Each is compared against the oracle rendered live. Both failed before the fix
  and pass after it.
- This is not a parity break or a visible change. It is a decoding gap. Logged in `decisions.md`.

## Screenshots and pixel diffs

**Method.** `layouts/si-gleam.json` = `si-baseline.json` with only the rail's mod changed
(`space-icons-base` → `space-icons-g`), so both share the same geometry. For each scenario,
`layout.switch si-baseline` → `herdr-app shot`, then `layout.switch si-gleam` → `herdr-app shot`.
I compared the rail strip (x 0–39, full height, 43,200 px) pixel by pixel.

**Rejected first try:** both rails side by side in one layout. The first column renders 40 px wide
and the second 50 px, so the left-pinned accent bar and the centered icons can't be aligned at
one offset.

| Scenario | Differing px (exact) | Where | Max channel delta | Outside the dot box |
|---|---|---|---|---|
| 3 spaces (user's own, `amey` active + `working`) | 60 (0.139%) | x29–36, y47–54 | 5 | **0** |
| 9 spaces (+6 temp: pinned glyph, forced family, re-seed, 3 geo) | 60 (0.139%) | same box | 4 | **0** |
| + an agent space in `blocked` | 54 (0.125%) | same box | 3 | **0** |
| after `space.close` × 2 | 60 (0.139%) | same box | 32 | **0** |

Every difference sits inside one 8×8 box: the status dot of the `working` space, which pulses
(`.loop("opacity", {from: 0.35, to: 1, period: 1200})`). The two shots catch it at different
phases. **Tolerance:** 0 differing pixels outside the animated dot. That bar is met in all four
scenarios.

Files in `docs/verify/` (rail strips only, 40×1080, because the full shots show the terminal):
`<scenario>-base.png`, `<scenario>-g.png`, and `<scenario>-diff.png` (absolute difference ×8).

## Geo files

After the 9-space scenario, every file in `mods/space-icons-g/geo/` also exists, with the same
name, in `mods/space-icons-base/geo/` (`comm -23` was empty). The file names are hashes of the SVG
text, so the SVGs are byte-identical too.

## Live scenarios

| Scenario | Result |
|---|---|
| `herdr-app do space.new` × 7, `space.close` × 7 | Both rails add and remove cells identically (see the 9-space and closed shots). New spaces show the empty-box frame, then their icon after the 150 ms tick. |
| Agent statuses | `working`: the `amey` space (this session) in every shot, with the pulsing dot on both rails. `blocked`: a `claude` agent started in a temp space stopped at Claude's folder-trust prompt, and both rails show the blocked dot. `done`: not produced live. Getting it would mean trusting a folder in the user's Claude config, so I answered "No, exit" (the status went back to null). The golden view set (c) covers `done`. |
| Hot reload | Re-saving `mods/space-icons-g/main.js` reloaded the mod. `status` → `"errors": []`, and the rail was redrawn. |
| Delete a geo file | Deleted `geo/se7fbv.svg`. It was written again within 1.5 s, **even without the explicit reload**: a file change inside the mod folder already makes Herdr reload the mod, so `init` lists the folder again and the next tick rewrites the file. The old mod behaves the same (same test on `space-icons-base`: rewritten). |

## Cleanup

All temp spaces are closed. The layout is back on `minimal`, with the same selected space as before.
The layouts `si-baseline.json` and `si-gleam.json` stay, for the cutover review.
