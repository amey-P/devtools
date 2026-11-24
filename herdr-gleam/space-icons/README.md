# space-icons (Gleam core + thin TypeScript shell)

A port of the Herdr mod `space-icons`, a vertical rail with one icon per space. It looks and
behaves exactly like the original (`herdr-minimal/space-icons`, frozen in `parity/oracle/`):
the same SVG bytes, the same geo file names and the same view tree.

- `src/space_icons/`: the **pure Gleam core**. `update.gleam` is the state machine. It decides
  every (overrides, geo dir, event) combination explicitly, with no catch-all. `view.gleam` is
  the rail as data. `glyphs.gleam`/`geo.gleam` make the icons. `core.gleam` is the only API the
  shell sees. `ffi/js.mjs` holds the only FFI (11 one-line functions for JS number, string and
  32-bit semantics).
- `shell/`: the **generic shell**. `runtime.ts` (a `View` that runs any core speaking the
  protocol), `interpret.ts` (tree → GPUI builders), `effects.ts` (ops → Herdr; nothing runs under
  `herdr-app check`), `snapshot.ts`, `gleam.ts` (binding). `main.ts` is the 3-line entry that
  binds this core.
- `parity/`: Vitest against the frozen oracle. That covers 10,000 names for `iconFor`, 70,000 geo
  SVGs, 30 + 2 view trees, plus the fakes for `herdr`, `gpui-kit`, `gpui-base` and `fs/promises`.
- `test/`: gleeunit + qcheck, including a breadth-first explorer over every reachable state
  (1,337 states, 32,447 transitions) that checks invariants I1–I7.
- `docs/`: `spec.md` (the brief), `decisions.md` (every choice the brief left open),
  `phase9-report.md` (live verification), `cutover.md` (cutover and rollback), `baseline/`,
  `verify/` (screenshots).

## Requirements

Gleam ≥ 1.19 (`brew install gleam`), Node ≥ 22, then `npm ci` in this folder.

## Build, test, install

```sh
npm test               # gleam test (unit, properties, explorer) + vitest (parity, shell)
npm run typecheck      # tsc --noEmit against ~/.config/herdr-app/{herdr,gpui-kit}.d.ts
scripts/build.sh       # gleam build + esbuild → dist/ (main.js, mod.json, overrides.json, icons/)
scripts/install.sh     # copies dist/ → ~/.config/herdr-app/mods/$MOD_NAME (keeps geo/ and an existing overrides.json)
scripts/check.sh       # herdr-app check + herdr-app status
```

`MOD_NAME` (the folder under `mods/`) defaults to `space-icons-g`, the side-by-side name used
before the cutover. Set `MOD_NAME=space-icons` for the real one. `npm run golden` regenerates the
goldens from the oracle. A plain `vitest run` fails if they would change.

To see it, put `{ "mod": "space-icons-g" }` in a layout block. `layouts/si-gleam.json` is a copy
of the minimal layout with the rail on the left.

## Roll back

The new mod lives in its own folder (`mods/space-icons-g`) until the cutover. Removing that
folder removes it. For the cutover itself and how to undo it, see `docs/cutover.md`.

## Behaviour notes

- `overrides.json` is read once per mod start. Saving it still takes effect: Herdr reloads the
  mod when any file in its folder changes, as with the old mod. Keys are trimmed and
  lowercased. `glyph` pins a Lucide icon (by name or index), `seed` re-rolls, and `family`
  forces one of `tiles radial rings stripes orbit overlap`.
- Geometric icons are written to `mods/$MOD_NAME/geo/<hash>.svg` by a 150 ms tick, only after
  the folder is listed. A cell shows an empty 17 px box until its file is on disk.
- Adding a geo family to the list changes most auto-picked icons and their file names: the
  family is drawn by index into that list. A family in the list without its own branch in `geo.gleam` silently
  draws as `overlap` (the dispatch ends in `_ -> overlap(r)`).
- `MOD_NAME` is baked in at build time. A bundle copied into a different folder reads and writes
  the folder it was built for.
