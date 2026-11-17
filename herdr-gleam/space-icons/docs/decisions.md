# Decision log: space-icons Gleam port

Plan: `~/.claude/plans/pasted-content-id-a562-prompt-structured-squirrel.md`. Beads epic: `agentctl-s4m`.

## Toolchain (Phase 0, 2026-11-17)

| Tool | Version | Source |
|---|---|---|
| Gleam | 1.19.2 | `brew install gleam` (pulls erlang + rebar3; brew exited 1 on a post-install step, binary works) |
| Node | v26.12.1 | `/opt/homebrew/bin/node` |
| esbuild | pinned in `package.json` in Phase 1 | npm devDep, local to this folder |
| TypeScript | pinned in `package.json` in Phase 1 | npm devDep, local to this folder |
| Herdr | herdr-app 0.1.16 | `~/.local/bin/herdr-app` |
| ffmpeg | `/opt/homebrew/bin/ffmpeg` | already installed; used for crops and pixel diffs (no new dep) |

## D1. Parity oracle = agentctl repo HEAD, not the installed copy

- **Choice:** the frozen oracle is `agentctl/herdr-minimal/space-icons/` at HEAD (commit 434a9e9 and later).
- **Rejected:** `~/.config/herdr-app/mods/space-icons/`. It is a stale install: it still has `COLORS`, `alpha()` ink and the override `color`.
- **Why:** owner's decision. HEAD is the committed, newer source. Consequences: no colors and no `alpha` in the core, the override decoder handles only `glyph`/`seed`/`family`, and the snapshot matrix swaps its "color" axis for "theme keys present/missing".

## D2. `alpha()` is not ported

Repo HEAD `glyphs.js` still exports `alpha`, but nothing imports it. Porting dead code adds an FFI surface (`to_hex` padding) with no user. If colors come back, port it then. Parity trap 5.6 is noted for that day.

## D3. Source location: `agentctl/herdr-gleam/space-icons/`

- **Rejected:** `~/code/herdr-mods/space-icons/`, which the prompt names. It does not exist, and all Herdr mod sources live in agentctl.
- **Why:** owner's decision. One repo, one history. The cutover can wire it into `install.mjs`. The write scope is this folder + `~/.config/herdr-app/mods/space-icons-*` + baseline/compare layouts.
- Build output and deps stay out of git through a local `.gitignore`. The repo root `.gitignore` is untouched. There is no root `main.js`, so `scripts/typecheck.mjs` skips this folder.

## D4. Baseline mod = `mods/space-icons-base`

`space-icons` is in no layout today. `space-tree` in the sidebar is the live user of the same geo code. To shoot a baseline without touching `mods/space-icons`, repo HEAD was copied to `mods/space-icons-base`, with its 3 hard-coded paths (`icons/`, the `GeoCache` folder, `overrides.json`) changed to that folder. Rendering is unchanged.

Layout `layouts/si-baseline.json` = `minimal.json` + a 56 px `rail` block (`space-icons-base`) on the left, as `minimal.json.bak` had it. I switched to it for the shots and then back to `minimal`.

## Phase 0 findings

- `herdr-app check mods/space-icons-base` → `check passed`, exit 0.
- **G6 defect does not show up in check:** no `geo/` folder appeared, because `mkdir`/`readdir` run inside `cx.spawn`, which the check does not drive. The guard is still in scope: `checking()` keeps the new shell free of side effects whatever the check runs.
- **Old write path:** `GeoCache.load()` swallows mkdir/readdir errors and still sets `loaded = true`. So `GeoDirListed(Error)` → `DirListed(empty)` + `Log` (parity).
- **Old duplicates:** a render that comes while a write is still running re-queues the same file, so it can be written twice. `in_flight` removes this (I2). There is no visible effect.
- **Empty-box phase is real:** with new spaces, the first frame shows 17 px empty boxes until the 150 ms timer writes the files and notifies. The new mod must keep this (seen in the first 9-space shot).
- **Live coverage limits:** `hc machine ls` → no machines, so no live remote badge. Statuses can't be forced by a command, so only the statuses that happen (the active agent space) are in shots. The golden view set (c) covers every status, the remote badge and scrolling.
- 9 spaces fit the 1080 px rail, so the live shot doesn't scroll. Golden (c) covers scrolling with 7 spaces as a tree (layout is not part of the tree).

Baseline shots (rail strip, 52 px wide): `docs/baseline/rail-3spaces.png` (the user's 3 spaces, one active with a status dot), `docs/baseline/rail-9spaces.png` (+6 temp spaces: a pinned Lucide `rocket` through `_example-lucide`, forced `radial` through `_example-family`, 4 geo icons).

## Parity edge cases to pin (from reading the oracle)

- Recorder: `.when(c, f)` applies or skips and is not recorded. `.children(xs)` is recorded as the same `child` calls.
- Overrides root is an array → `Object.entries` keys "0","1"…. Root `null` → throws → `Log`.
- Duplicate keys after trim+lowercase: the last wins.
- `overrides["constructor"]` is a truthy function in JS, with no `glyph/seed/family` fields → no effect.
- `glyph: 1.0` → index 1 (a JS integer). `1.5`, `-1` and out-of-range values → ignored.

## Phase 1: toolchain spike (2026-11-17)

- Pinned: esbuild 0.28.2, typescript 5.9.3 (the repo's own version; 7.x skipped as too new for the `.d.ts` files), vitest 5.1.0, fast-check 4.10.2. Gleam deps: gleam_stdlib 1.1.0, gleeunit 1.11.0 (dev).
- esbuild's `postinstall` was **not** approved (`npm install-scripts`). The platform binary comes from its optional dependency, and `npx esbuild --version` works without the postinstall.
- The spike module used a custom type, a `List`, a `Dict`, a `case` and the FFI `js_num`. It was bundled with `esbuild --bundle --format=esm --external:herdr --external:gpui-kit --external:gpui-base --external:fs/promises` (24 KB, stdlib included).
- `herdr-app check mods/space-icons-spike` → passed. `mod.open` showed `Hello from Gleam · busy/2=2.5 · 12.0=12` (`docs/baseline/spike-overlay.png`). **QuickJS runs Gleam's JS output unchanged; no workaround needed.**
- `js_num(12.0)` → `12` confirms parity trap 5.3: Gleam floats must cross the FFI to get JS number formatting.
- `typescript_declarations = true` in gleam.toml gives the shell `.d.mts` types for the core.
