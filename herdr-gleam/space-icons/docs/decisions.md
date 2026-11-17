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

## Phase 2: parity oracle (2026-11-17)

- **Oracle:** `parity/oracle/{glyphs,geo,geocache,main}.js` are copied from `herdr-minimal/space-icons` at 434a9e9. `SHA256SUMS` + a test keep them frozen. `geocache.js` is included because `main.js` imports it.
- **Fakes via Vitest aliases** (`vitest.config.js`): `herdr`, `gpui-kit`, `gpui-base` and `fs/promises` resolve to `parity/fakes/`. The oracle runs unmodified. **Rejected:** a Node loader hook (more moving parts) and copying main.js's override-decoding expression (it would test a copy, not the code). The oracle's own `init` decodes overrides through the fake `readTextFile`.
- **Tree format** `{kind, args, attrs[{m,a}], children}`. `.when` is control flow and is not recorded. `children(xs)` is recorded the same as `child`. `hover(f)` records its style calls. `undefined` → `"$undefined"`. The recorder **throws if an attr follows a child**. The oracle never does this, which justifies the core's `El(kind, attrs, children)`.
- **Handler labels = behaviour:** each callback runs once at record time with a fake event/cx, and the label is the list of herdr/cx calls it made (e.g. `[["run","space.select",{"id":"s1"}]]`, `[["cx.stop_propagation"]]`). View parity therefore also checks I7's exact arguments.
- **Corpus (a):** 10,000 names (`parity/corpus.js`, fixed-seed PRNG): ASCII, Unicode whitespace (and look-alikes that are not whitespace: U+180E, U+200B, U+0085), emoji/ZWJ, CJK, combining marks, case-mapping specials (İ, ß, Σ, ǅ, K), lone surrogates and prototype keys. iconFor is run plain and with a 1,170-hit overrides text, plus 46 targeted override cases.
- **Corpus (b) storage:** 10,000 names × 7 requests (auto + 6 families) = 70,000 rows `[i, req, family, file, sha256/16]` in `geo.jsonl.gz` (1.1 MB). The full SVG text is kept for the first 200 names (`geo-full.json`) for readable diffs. **Rejected:** full SVGs for all rows (~40 MB). The 64-bit SHA prefix plus the oracle's own 32-bit file name makes a silent byte difference astronomically unlikely.
- **View set (c):** 30 cases = every window × theme with 0 spaces (8), plus 22 greedy all-pairs cases over count{1,7} × status{idle,working,blocked,done,weird} × active × machine{none,vps} × icon{geo ready, geo missing, pinned} × window{macos, macos-fullscreen, linux, null} × theme{full, no status colors → `unknown` fallback}. A 7-space case puts the subject among 6 fixed others covering every status/machine/icon.
- **Regeneration:** `npm run golden` writes the files. A plain `vitest run` rebuilds them in memory and fails on any difference.

### Findings that need a decision later (raised at the phase 4 gate)

1. **Override key collisions follow JS property order.** After trim+lowercase, the oracle keeps the last entry in `Object.entries` order: integer-like keys first (ascending), then source order (cases "collision: …"). A Gleam `Dict` from `gleam_json` loses that order. Exact parity needs the decoder to see the entries in order. Options: an FFI `entries` (needs approval), or a documented divergence for files that spell the same name twice.
2. **Log text contains the engine's error message** (`SyntaxError: Unexpected end of JSON input` is V8's; QuickJS words it differently). Log parity is therefore the prefix `space-icons: overrides.json: ` plus "exactly one Log" (I5), not the full text.
3. A root that is a string/number/array decodes the way `Object.entries` does (array → index keys; string → per-char keys with string values, which have no effect). Root `null` → TypeError → Log.
