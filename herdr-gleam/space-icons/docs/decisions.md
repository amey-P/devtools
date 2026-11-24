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

1. **Resolved in Phase 4 by the FFI `entries` (owner-approved, 11th function).** **Override key collisions follow JS property order.** After trim+lowercase, the oracle keeps the last entry in `Object.entries` order: integer-like keys first (ascending), then source order (cases "collision: …"). A Gleam `Dict` from `gleam_json` loses that order. Exact parity needs the decoder to see the entries in order. Options: an FFI `entries` (needs approval), or a documented divergence for files that spell the same name twice.
2. **Log text contains the engine's error message** (`SyntaxError: Unexpected end of JSON input` is V8's; QuickJS words it differently). Log parity is therefore the prefix `space-icons: overrides.json: ` plus "exactly one Log" (I5), not the full text.
3. A root that is a string/number/array decodes the way `Object.entries` does (array → index keys; string → per-char keys with string values, which have no effect). Root `null` → TypeError → Log.

## Phase 3: numeric core and FFI (2026-11-17)

- **FFI in use (10 of the 12 allowed at the end of Phase 3; 11 of 12 after Phase 4's `entries`):** `utf16_units imul to_u32 to_i32 js_num n2 cos sin pi to_base36`, all in `src/space_icons/ffi/js.mjs` and bound once in `space_icons/js.gleam`. `round` and `to_hex` are **not added**: only `alpha()` needed them, and it is not ported (D2). Each function has a test in `test/ffi_test.gleam`.
- **`>>>` without FFI:** Gleam's `int.bitwise_shift_right` is the signed `>>`. `x >>> n` = `to_u32(x) / 2^n` (Gleam int division truncates; the operand is non-negative and below 2^53, so it is exact). `^`, `|` and `+` already have JS semantics on the JS target.
- **RNG as state passing:** `rng.next/int/pick/chance` return `#(value, Rng)`. Each call is exactly one `rnd()` in geo.js, so the draw order can be checked against the source line by line.
- `gleam_stdlib` 1.x has no `list.range`, so geo.gleam has a private `upto(n)`.
- **Parity (fast-check, `parity/numeric.test.js`):** fnv1a on 5,000 arbitrary UTF-16 strings (lone surrogates included) + 5,000 full-Unicode strings. The first 64 mulberry32 draws for 2,000 u32 seeds. 5,000 random int/pick/chance sequences. `String(n2(v))` on 5,000 doubles. `poly` on 5,000 random inputs. The oracle's private helpers come from `parity/oracle-private.js`, which imports the frozen geo.js text plus one export line, so the file itself is unchanged.
- **The tests can fail:** a wrong FNV prime and a signed shift in mulberry32 each turned 4 properties red. Both were reverted.
- Gleam string literals cannot spell lone surrogates, so `utf16_units` on lone surrogates is tested from Vitest (UTF-16 property) and not in gleeunit.

## Phase 4: glyphs (2026-11-23)

- **FFI is now 11 of 12:** `entries` = `toList(Object.entries(x))`, a list of `#(String, Dynamic)`. The owner approved it to resolve finding 1. `glyphs.decode_overrides` folds the entries in order into a Dict keyed by `jstext.key(k)`, so the last entry in JS property order wins, as `Object.fromEntries` does in the oracle. Value decoding is unchanged.
- **Root guard (never throws):** `entries` is called only for a root that `dynamic.classify` calls `Object`, `Array` or `String`. `Nil` (JSON `null`) → `Error("TypeError: Cannot convert undefined or null to object")` → exactly one Log, empty overrides. `Int`, `Float` and `Bool` → no entries. These cases are pinned by the goldens "root null/array/string/number/true".
- **Red first:** with the 3 collision cases made ordinary tests, only "collision: last written wins" failed. "reversed" and "index key sorts first" passed by luck under the Dict's order. All 3 now pass, and `ORDER_DEPENDENT` and `test.fails` are gone.
- **Edge cases:** a string root gives one index key per UTF-16 unit, each valued by a string (no effect). This is what `Object.entries` does natively, so no Gleam re-implementation is needed. `"1 "` is not integer-like, so it sorts after `"1"`-style keys; after trimming it collides with `"1"` and wins (golden "index key sorts first"). A JSON `"__proto__"` key is an own property from `JSON.parse`, so `Object.entries` sees it in both the oracle and the port. The old Dict path depended on gleam_json's handling. `int` is no longer imported by glyphs.gleam (the array branch went away).

## Phase 5: geo families (2026-11-23)

- **Ported** `shape`, `optical`, the 6 families (tiles, radial, rings, stripes, orbit, overlap; one at a time, each red first), `geo_icon(seed, Option(String)) -> GeoIcon(svg, family)` and `geo_file(seed, family)` = `to_base36(fnv1a(svg)) <> ".svg"`. **No new FFI and no new dependency** (still 11 of 12).
- **Types instead of `string|number`:** `Kind = Circle | Sides(Int)` (pub, so Vitest can drive `shape`). Family-local enums: `Tile`, `Petal`, `Hub`, `Silhouette = Plain(Kind) | Diamond` (stripes), `Body = Moon | Solid(Kind)` (orbit). `null` choices are `Option`. `pick` draws over the same list length in the same order, so the index (and the draw) is unchanged.
- **Draw-order traps, matched line by line:**
  - rings: `outer === 4 && r.chance(0.5)` short-circuits, so the chance is drawn **only** when the outer shape is a square. In `shape(inner, …, r.pick([3.6, 4.6]) * …, r.int(4) * …)` the arguments are evaluated left to right: pick, then int. The re-pick on `inner === outer` costs one `int(5)` and indexes `(indexOf + 1 + j) % 6`.
  - tiles: the retry loop runs up to 12 times. After 12 failed tries the **last** attempt is used. `q` is `int(2) * 2` only for a middle-column `half`, else `int(4)`; `chance(0.18)` comes after `q`.
  - radial/orbit: the hub pick and the satellite picks come after the petals/body text is built; there are no draws inside those loops.
  - geo_icon: a forced family that is in `families` draws nothing. `None`, `""` or any unknown name (`"Tiles"`, `" tiles"`, `"constructor"`) costs one `int(6)` draw (same as `pick`). Case-sensitive, no trim, as `FAMILIES.includes`.
- **Float text:** every number in the SVG goes through `num.text`/`num.n2_text`, computed with the oracle's own expression and grouping (`(i * TAU) / count`, `12 + cos(a) * R * 0.75`, `w + (i * 2) * w`, `rot + (i * 360) / n`), because Gleam float ops compile to the same JS ops. Constants like `C / 2 - 0.3`, `FADE * 0.5` and `FADE + 0.2` are computed rather than written as literals. Integer-only text (`q * 90`, stripe `angle`) uses `int.to_string`. No 32-bit ops are needed outside the existing `rng`/`hash`.
- `sil.replace("/>", …)` replaces only the first match: ported with `string.split_once`, not `string.replace` (each silhouette has exactly one `/>`, but this keeps the semantics).
- **Tests (`parity/geo.test.js`, 17 tests):** for each of the 6 families plus `auto`, all **10,000** corpus (b) rows for that request (family, file name via `geo_file`, sha256/16 of the SVG): **70,000 rows**, all matching. Plus the full-text diff of the first 200 names per request (1,400 SVGs) against `geo-full.json`. Plus 5,000 fast-check `shape` cases against the oracle's private `shape`, 300 names × 8 odd family strings and `None` against the oracle `geoIcon`/`geoFile`, and 3,000 arbitrary seeds. `parity/gleam.js` gained `G.some` (JS value → Gleam Option). `test/geo_test.gleam` pins 3 file names and the family fallback in gleeunit.
- **The tests can fail:** drawing the rings `chance(0.5)` for every outer shape (the short-circuit removed) turned rings, auto and the oracle-comparison tests red (6 failures). Reverted.

## Phase 6: state machine and explorer (2026-11-23)

Files: `src/space_icons/model.gleam` (types), `src/space_icons/update.gleam` (`init`, `update`, `needed_files`), `test/explorer_test.gleam` (BFS explorer), `test/update_test.gleam` (unit tests + qcheck property). **No new FFI** (still 11 of 12). **One new dev dependency:** `qcheck >= 1.0.5 and < 2.0.0` (approved in the plan). It brings in its own deps `exception`, `gleam_regexp`, `gleam_yielder` and `prng`, all dev-only.

### Types (shape of spec §6.1, names tightened)

- `Flags(mod_name, app_home)`: everything the shell supplies at start. Every path comes from these: overrides `${app_home}/mods/${mod}/overrides.json`, geo dir `${app_home}/mods/${mod}/geo`, svg path `mods/${mod}/geo/<file>` (`update.geo_rel`). Nothing is hard-coded.
- `Snapshot(spaces: List(Space), theme: Dict(String, String), window: Option(Window))` with `Window(platform, fullscreen)`. **Rejected:** §6.1's `macos_lights: Bool`. Working out `platform == "macos" && !fullscreen` in the shell would be mod logic (G5), so the core does it in phase 7. `None` = `window()` returned null (a golden (c) axis).
- `Overrides = OverridesLoading | OverridesReady(glyphs.Overrides)`, `GeoDir = DirUnknown | DirListed(ready: Set(String))`, `GeoFile(key: "seed|family", file, svg)`.
- `State(flags, overrides, geo, in_flight: Set(String), known: Dict(String, GeoFile))`. `flags` is added to §6.1's shape because `WriteFile` and the Log texts need the paths.
- `Event`: `OverridesRead(Result(Option(String), String))` (`Ok(None)` = `readTextFile` returned null), `GeoDirListed(Result(List(String), String))`, `Tick(needed: List(GeoFile))`, `Written(file, Result(Nil, String))`, `ClickedSpace(id)`, `RightClickedSpace(id)`, `ClickedNewSpace`.
- `Effect`: `ReadText(path)`, `MkdirAndList(dir)`, `WriteFile(path, file, content)`, `RunCommand(name, args: Option(Json))`, `OpenOverlay(spec: Json)`, `Log(message)`. `WriteFile` carries `file` so the shell can answer with `Written(file, ..)` without parsing the path. `RunCommand` args are an `Option`: `run("space.new")` passes **no** second argument, and `None` keeps that difference visible. **Rejected:** typed command variants (`SpaceSelect(id)` …). The shell would need to know them, which breaks G5. `gleam/json` keeps the shell generic, and its key order is the oracle's literal order.

### `update`

- `case state.overrides, state.geo, event` (multi-subject case) with **no `_`, no variable catch-all and no other wildcard** anywhere in `update`. An arm that doesn't care about a part lists every constructor of that part (`OverridesLoading, … | OverridesReady(..), …`). Fields are ignored with `..`, not `_`. All 28 combinations are spelled out.
- **I1, and the write gate:** writes happen only in `OverridesReady, DirListed`. The oracle's `loaded` flag means both, because its `load()` runs after the overrides read in the same spawn. Our `ReadText` and `MkdirAndList` run in parallel, so the core needs both conditions. A Tick in any other combination only memoizes its files into `known`.
- **I2:** `write_missing` skips a file that is ready, already in flight, or earlier in the same Tick. The old duplicate write (a render re-queues a file while its write is still running) is gone.
- **I4:** `Written(f, Error(e))` → `f` leaves `in_flight`, `ready` is untouched, `Log("geo: write ${f}: ${e}")`. The next Tick writes it again. `Written(f, Ok)` → `f` leaves `in_flight` and joins `ready`, even when `f` was not in flight (the write did land). It is ignored before the listing, which I1 makes unreachable.
- **I5:** `OverridesRead` while `Loading`: `Ok(None)` → empty; `Ok(Some(text))` → `decode_overrides` (empty text → empty); a decode error or `Error(e)` → empty + exactly one `Log("space-icons: overrides.json: ${e}")`. The `space-icons:` prefix is the old **literal** text (it does not follow `mod_name`), per "Log texts stay as they are". A second `OverridesRead` is ignored, because hot reload is a non-goal (spec §4). A possible future change: accept it while `Ready`.
- `GeoDirListed(Error(e))` → `DirListed(empty)` + `Log("geo: ${dir}: ${e}")` (Phase 0 finding). A second listing is ignored.
- **I7:** each of the three UI events returns the same state and exactly one effect in every combination: `RunCommand("space.select", {"id"})`, `RunCommand("space.new", None)`, `OpenOverlay({"mod":"menu","kind":"popup","width":200,"height":260,"props":{"tab":"space","target":{"id"}}})`. These are the oracle's arguments.
- **Notify on change:** `State` holds only data (no functions, no Json), so `==` is structural. Gleam's Dict and Set compare by content: `update_test.structural_equality_test` builds equal states in different insertion orders. The shell calls `cx.notify()` only when `new != old`. There is one difference from the oracle: a Tick that starts writes changes `in_flight`, so it notifies once. That render changes nothing visible, and the view does not read `in_flight`. **Rejected:** a `changed: Bool` returned from `update`. It is redundant with `==` and easy to get wrong.

### Tick source: `needed_files(State, Snapshot) -> List(GeoFile)`

- Pure. The shell calls it every 150 ms with a fresh snapshot, then calls `update(Tick(needed))`. `render` never mutates.
- It returns the geo files the rail would draw that `update` still has to act on: **not ready** (all of them while the dir is unknown), **or not yet in `known`**. The result is deduped by file, in rail order, and pinned Lucide glyphs are skipped. The "not yet in `known`" part goes beyond "not ready". Without it, a file that is already on disk at start-up would never be memoized, and both `needed_files` and phase 7's `view` would regenerate its SVG on every tick and render. After one Tick it drops out of the list. A Tick that only re-memoizes the same entries leaves the state equal, so the shell does not notify.
- **While overrides are `Loading` it returns `[]`.** In the oracle, render queues files with the overrides it has (`{}` before the read), but nothing is written before `loaded`, and `loaded` comes after the overrides read. So the only effect of the pre-read queue is that the oracle also writes the files for the *empty-override* icon of every overridden name: orphan files that are never drawn. Nothing visible changes, because the empty-box phase still happens: phase 7's view uses empty overrides while `Loading`, and nothing is ready yet. **Rejected:** computing with empty overrides while `Loading`. With our parallel reads, a listing that arrives before the overrides read would then write those orphan files.
- `known` is filled in `update` on every Tick (geocache.js `made`). Its key is `seed|family`, with `None` written as `""` as in the oracle (`family ?? ""`).

### Explorer (`test/explorer_test.gleam`)

- **Domain:** a name pool of 3 (`alpha`, `Beta`, `Rocket Ship`). Snapshots are all 40 lists of 0–3 spaces over the pool, so 2-name rails and duplicate names are included.
- There are 3 overrides runs:
  - absent: `Ok(None)`.
  - present: `Beta` is pinned to `rocket`, and `" ROCKET SHIP "` gets seed `zzz` and family `rings`, which also exercises key trim and lowercase.
  - failed: both a read error and undecodable text, in all orders.
- **Events in every state:**
  - the run's reads.
  - 3 listings: ok, ok with `alpha`'s file and `junk.txt` already on disk, and failed.
  - one Tick per snapshot with the **current** `needed_files`, plus one with the full list doubled and one stale Tick carrying the whole file universe.
  - `Written` Ok and Error for all 4 files of the universe, at any time and any number of times (duplicate and out-of-order answers).
  - the 3 UI events.
- States are deduped by a canonical key (sorted sets and the `known` keys).
- **Checks:**
  - I1, I2, I4, I5 and I7 on every transition. I4 includes "a Tick right after the failure writes it again".
  - I3 on every newly reached state: settle the pending reads, Tick each distinct name set, answer every in-flight file with `Ok`. Then every drawn file must be ready and `needed_files` must be `[]`.
  - The `init` effects are asserted once.
- **Counts:**

  ```
  explorer: overrides absent: 517 states, 12981 transitions
  explorer: overrides present: 303 states, 5968 transitions
  explorer: overrides failed: 517 states, 13498 transitions
  explorer: total 1337 states, 32447 transitions
  ```

  The whole `gleam test` run takes about 1 s.
- **qcheck:** `no_duplicate_write_property_test`: 500 random sequences of up to 60 events from a 20-event table (Ticks computed from the current state). It checks that no WriteFile is issued for a file that is outstanding (written, no answer yet), in flight or ready. Removing the `in_flight` check in `write_missing` falsifies it, together with the explorer (`I2: the same file written twice in one transition`) and a unit test. That change was reverted.

### Mutation proof

**I1 guard removed:** the arm `OverridesReady(..), DirUnknown, Tick(needed)` was made to call `write_missing(…, set.new(), needed)`. `gleam test`:

```
panic test/explorer_test.gleam:498
 test: explorer_test.explorer_test
 info: explorer (absent) at R0|U|F[]|K[] --Tick([10ji174.svg])-->
  I1: WriteFile before the geo dir is listed
19 passed, 1 failures
```

It was restored from a byte copy, and `cmp` against the copy showed no difference. `gleam test` is green again.

**Dummy `Event` variant added** (`Dummy` after `ClickedNewSpace`). `gleam build`:

```
error: Inexhaustive patterns
    ┌─ src/space_icons/update.gleam:62:3
 62 │ ╭   case state.overrides, state.geo, event {
The missing patterns are:

    OverridesLoading, DirUnknown, model.Dummy
    OverridesLoading, DirListed(ready:), model.Dummy
    OverridesReady(_), DirUnknown, model.Dummy
    OverridesReady(_), DirListed(ready:), model.Dummy
```

It was reverted the same way (a `cmp`-verified copy), and the build is clean.

## Phase 7: view (2026-11-24)

Files: `src/space_icons/view.gleam` (`Node`, `Kind`, `Attr`, `view`), `src/space_icons/core.gleam` (the shell protocol), `shell/interpret.ts`, `shell/gleam.ts`, `shell/effects.ts`, `parity/view.test.js`, `test/view_test.gleam`; I6 added to `test/explorer_test.gleam`. **No new FFI, no new dependency** (still 11 of 12).

- **`Attr` = exactly main.js's builder calls.** Each `.when(c, f)` became a list appended when `c` holds, so attr order is the oracle's. `Text` from the spec's sketch is **left out**: main.js renders no text node. Color attrs take `Option(String)`; `None` (theme has no such key) reaches the builder as `undefined`, which is what `t.x` gives. `t[s.status] ?? t.unknown` = `option.or`. An empty `machine` string counts as no machine (`s.machine ? …`, `Boolean(s.machine)`).
- **I6 in the view, not in a filter:** `icon_path` shows a geo file only when `DirListed(ready)` contains it; before the listing every geo cell is the 17 px box. While overrides are `Loading`, the view uses empty overrides (as the oracle's `{}` before its read).
- **Shell protocol (`core.gleam`).** **Choice:** the core renders to JSON text in the recorder's own format `{kind, args, attrs: [{m, a}], children}`, one attr per builder call. Arguments that are not JSON are markers: `{"$":"event","i":n}` (index into `Rendered.events`, a Gleam list of opaque Events), `{"$":"stop"}` and `{"$":"undefined"}`. Effects become `Out(op, args JSON, reply)` where `reply` holds Gleam closures that decode the op's result (`decode.optional(decode.string)` for `readTextFile`, `decode.list(decode.string)` for `readdir`) into the answering Event. The raw `{spaces, theme, window}` is decoded in Gleam (`decode_snapshot`, each part falls back on its own). **Rejected:** the shell reading Gleam records/lists directly (couples the shell to one core's types); gleam_json's in-memory representation as native JS (an implementation detail); a JS-array FFI (would be a 12th function for convenience only). The shell walks lists with Gleam's public `List$isNonEmpty / List$NonEmpty$first / rest` and reads records with the generated `Type$Variant$field` accessors.
- **Handlers through `update`:** `OnClick(ClickedSpace(id))` etc. are not closures in the core. The interpreter turns a marker into `(e, cx) => dispatch(event, cx)`, and dispatch = `update` + run the effects. So the recorded handler label (what the handler does when run once) comes from the real path core event → update → effect → herdr `run`/`openOverlay`, and the parity test checks I7's exact arguments.
- **Gate:** all **30** view cases in golden (c) are deep-equal to the oracle's tree (`parity/view.test.js`), and render makes no herdr calls. The explorer checks I6 on every reachable state × all 40 snapshots: every `Svg` is a chrome icon, a known glyph, or a ready geo file, and every ready drawn file is shown. Counts unchanged: 1337 states, 32447 transitions.
- **The tests can fail:** swapping `Tooltip` and `StopLeftDown` on the new-space button turned all 30 view cases red. Showing the geo path before the listing turned the explorer red (`I6: drew mods/space-icons-g/geo/1q2p2i1.svg (not ready, not a glyph)`). Both reverted from a `cmp`-verified copy.

## Phase 8: shell and effects (2026-11-24)

Files: `shell/runtime.ts` (generic View: init/dispatch/render), `shell/snapshot.ts`, `shell/main.ts` (entry: binds the core), `shell/tsconfig.json`, `shell/shell.test.ts`, `scripts/{build,install,check}.sh`, `assets/` (vendored `icons/` + LICENSE, `mod.json`, `overrides.json` from `herdr-minimal/space-icons`). No new dependency.

- **`main.ts` is 3 lines of binding.** The class lives in `runtime.ts` as `mount(app, modName)`, which takes any core that speaks the protocol. The only mod-specific lines in `shell/` are the two imports in `main.ts` (`grep -i space shell/*.ts`). `snapshot.ts` samples `spaces()/theme()/window()` raw; a mod that needs other reads would pass its own sampler. **Rejected:** putting the class in `main.ts` (then the generic part could not be tested without the core's build path).
- **Check mode (G6):** `runtime.init` returns right after `core.init` when `checking()`: no effect, no timer. `runEffects` also returns at once when `checking()`, so a handler fired during a check does nothing. `herdr-app check dist` passed and created no `geo/`.
- **Dispatch:** `update` → run effects → `cx.notify()` only if `core.changed` (structural `!=`). Async ops (`read_text`, `mkdir_list`, `write_file`) run in `cx.spawn` and answer with that task's `cx`; errors are `String(e)`, as the oracle's template strings. A dispatcher method is named `dispatch`, not `update`: `View.update(props)` is a Herdr lifecycle hook.
- **tsconfig:** `paths.herdr` and `files` point at `~/.config/herdr-app/{herdr,gpui-kit}.d.ts` by a relative path (tsconfig cannot expand `~`). Options follow agentctl's `tsconfig.mod.json`. The core's types come from Gleam's `.d.mts`.
- **Install:** `install.sh` copies with `rsync -a --delete`, never symlinks (agentctl rule: Herdr's reload and `svg()` need real files). It leaves `geo/` alone and keeps an existing `overrides.json` (the user's file).
- **Tests (`shell/shell.test.ts`, 7):** check mode makes no herdr/fs call, starts no timer and runs no handler effect; init reads overrides and lists the folder, with one 150 ms timer through `cx.timer.every`; a tick writes each missing file once (duplicate names collapse), then notifies, and a quiet tick neither writes nor notifies; a failed write logs once and is written again on the next tick (I4); boot + tick renders the oracle's tree for two golden cases (7 spaces on macOS, 1 space with a null window).
- **The tests can fail:** dropping the `checking()` guard in `runEffects` failed "a handler runs no effect". An unconditional `cx.notify()` in dispatch failed the quiet-tick test and both oracle-tree tests: the handler labels then contain `cx.notify`, so a click that re-renders for nothing is visible to the parity check. Both reverted from `cmp`-verified copies.
- **Gate:** `npm run typecheck` passes, `npm test` = 23 gleeunit + 115 Vitest tests green, `herdr-app check dist` → `check passed`. Bundle: 154 KB.

## Phase 9: live verification (2026-11-24)

Full report: `docs/phase9-report.md`; rail strips and diffs in `docs/verify/`.

- **`Space.status: Option(String)`** (was `String`). Herdr's `SpaceInfo.status` is `Status | null`: a phase 0 recon miss. The string-only decoder dropped the whole rail on the first live run. `None` is not loud, as `LOUD.has(null)`. Red first: `parity/view.test.js` › "SpaceInfo as Herdr sends it" (2 cases against the live oracle). The decoder stays all-or-nothing for a malformed space (wrong `id`/`name`/`active` type), because the oracle would render such a space anyway, so dropping it would also be a difference. The nullable fields (`status`, `machine`) are the only ones the API allows to be null.
- **Screenshot method:** the same layout with only the rail's mod swapped, then 2 shots. **Rejected:** both rails side by side in one layout, because the first column renders 40 px and the second 50 px.
- **Tolerance:** 0 differing pixels outside the pulsing `working` dot (x29–36, y47–54 in the strip). Met in all 4 scenarios. Inside the dot, the differences are animation phase (max channel delta 3–39).
- **Geo rewrite:** deleting a file under `mods/<mod>/` triggers Herdr's hot reload, so both mods rewrite a deleted geo file at once. There is no difference to log.

## Phase 10: cutover proposal (2026-11-24)

- `docs/cutover.md`: exact cutover and rollback steps, **not run**. Build with `MOD_NAME=space-icons` (verified: the bundle's mount call names `"space-icons"`). Keep the old install as `mods/space-icons-old`. Install, then carry over `overrides.json` (and optionally `geo/`, whose names are identical). The agentctl `install.mjs` change: an optional `build` step on `ModSpec`, and `src: "herdr-gleam/space-icons/dist"`. `herdr-minimal/space-icons` is kept through a soak period. Two rollback paths: a folder swap during the soak, or `git revert` + `node install.mjs minimal`.
- **Rejected:** committing `dist/main.js` (a generated 154 KB file that can drift from source).
- `README.md`: build, test, install and roll back.

## Definition of done (spec §11)

- [x] Parity: corpus (a) 10,000 names + 46 override cases, corpus (b) 70,000 geo rows, view set (c) 30 cases + 2 live-shaped SpaceInfo cases.
- [x] The explorer passes I1–I7 (1,337 states, 32,447 transitions). Mutations: I1 guard (Phase 6), I2 `in_flight` (Phase 6), I6 path guard (Phase 7).
- [x] `update` has no catch-all. The dummy `Event` variant fails `gleam build` with the missing arms (Phase 6, reverted).
- [x] `tsc --noEmit` passes. `herdr-app check mods/space-icons-g` passes. `herdr-app status` shows `"errors": []`.
- [x] Screenshot diffs within tolerance: 0 differing px outside the pulsing `working` dot, in 4 scenarios (`docs/phase9-report.md`).
- [x] The shell has no space-icons logic. The only mod-specific lines are the core imports in `shell/main.ts`.
- [x] `README.md` covers build, test, install and rollback. `docs/decisions.md` is complete.
- [ ] Cutover: waiting for the owner's approval (`docs/cutover.md`).
