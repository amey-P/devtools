# Prompt: Port the Herdr `space-icons` mod to a Gleam core with a thin JS shell

## 1. Role and outcome

You are a senior engineer. Port the Herdr app mod `space-icons` to this architecture:

- A **pure Gleam core**: state machine, icon logic and view description.
- A **thin, generic TypeScript shell**: the only code that touches Herdr.

The new mod must look and behave **the same** as the current mod. The new design must make each
state x event combination a compile-time decision. It must also let tests analyse the behaviour
exhaustively.

Work in phases. Each phase has an exit gate. Do not start a phase before the gate of the
previous phase passes. At the gates marked **[ASK]**, stop and wait for my approval.

## 2. Context

### 2.1 Herdr

- Herdr is a native app for coding agents. Its config lives in `~/.config/herdr-app`.
- **Read first:** `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts` and `gpui-kit.d.ts`. These files
  are the API truth for the installed version. Herdr rewrites them on each start. Never edit them.
- Mods run in an embedded **QuickJS** runtime. A mod is `mods/<name>/main.js`. It default-exports
  a class that extends `View` from `"gpui-kit"`, with `init(props, cx)` and `render(cx)`.
- UI is described with chained GPUI builders (`div()`, `h_flex()`, `v_flex()`, `svg()`). There is no DOM.
- Rules from `AGENTS.md` that apply here:
  - Never keep a `cx`. Each callback gets its own `cx`.
  - `render()` must not notify or spawn.
  - No `setTimeout`. Use `cx.timer`.
  - Module top level must have no side effects.
  - `init()` runs for real during `herdr-app check`. Guard side effects with `checking()`.
- Tools:
  - `herdr-app check <mod folder>`: loads the mod and renders it once. Exits nonzero on error.
  - `herdr-app status`: shows errors from files and mods.
  - `herdr-app shot <file.png>`: saves the window as a PNG.
  - `herdr-app do <command>`: runs an app command.

### 2.2 The current mod: `~/.config/herdr-app/mods/space-icons/`

| File | Purpose |
|---|---|
| `main.js` | `SpaceIcons` view. A vertical rail with one icon cell for each space and a "New space" button at the bottom |
| `glyphs.js` | `iconFor(name, overrides)`: FNV-1a hash of the trimmed, lower-case name gives the color (from `COLORS`) and the seed. `overrides.json` can pin a Lucide glyph, a color, a seed or a family. `alpha(hex, a)` appends an alpha byte |
| `geo.js` | `geoIcon(seed, {family})`: seeded generator (mulberry32) for a 24x24 SVG in one of 6 families: `tiles`, `radial`, `rings`, `stripes`, `orbit`, `overlap` |
| `geocache.js` | `svg()` draws only files. So each generated SVG is written once to `mods/space-icons/geo/<fnv1a(svg) base36>.svg`. `path()` queues a missing file during render. A 150 ms timer writes the queue, then calls `cx.notify()` |
| `overrides.json` | User overrides, keyed by lower-case space name |
| `icons/*.svg`, `icons/LICENSE` | 64 Lucide icons (ISC license) |
| `mod.json` | `{ "place": "none", "title": "Space icons" }` |

Behaviour of each cell (from `main.js`):

- Click runs `space.select {id}`.
- Right-click opens the `menu` popup (`width 200, height 260, props {tab: "space", target: {id}}`).
- Tooltip is `name`, or `name · machine`.
- An active space has an accent bar on the left edge, a stronger background and a border.
- A "loud" status (`blocked`, `done`, `working`) shows a dot. `working` pulses with `.loop("opacity", ...)`.
- A remote space shows a server badge.
- The icon is a pinned Lucide glyph, or the geo SVG when the file is on disk, or an empty 17 px box.
- The rail top padding is 40 on macOS when the window is not fullscreen, else 10.

## 3. Goals

1. **G1: Parity.** For the same inputs, the new mod gives byte-identical icon SVGs, the same geo
   file names, the same colors and the same view tree as the current mod.
2. **G2: Pure core.** All logic is in Gleam, with no I/O. The core has three functions:
   - `update(State, Event) -> #(State, List(Effect))`
   - `view(State, Snapshot) -> Node`
   - `init(Flags) -> #(State, List(Effect))`
3. **G3: Compile-time exhaustiveness.** `update` matches on `#(state, event)` with **no catch-all
   `_` branch**. When I add a variant, the compiler must show each place that has no decision for it.
4. **G4: Analysis.** Tests explore all reachable states (on a bounded domain) and check the
   invariants in section 6.
5. **G5: Thin shell.** One TypeScript shell. It reads a Snapshot, runs Effects, converts callbacks
   to Events and translates `Node` into GPUI builders. It contains no mod-specific logic, so other
   mods can reuse it.
6. **G6: Safe in `check` mode.** When `checking()` is true, the shell runs no effects. (The current
   mod creates a folder and reads files during a check. This is a known defect, and this port fixes it.)

## 4. Non-goals

- No visual redesign. No new features.
- Do not edit shipped Herdr mods, `AGENTS.md` or the `.d.ts` files.
- Do not remove or change the current `space-icons` mod before the cutover gate.
- Do not add a hot reload for `overrides.json`. The current mod reads it only in `init`. Keep this
  behaviour, and write it down as a possible future change.

## 5. Constraints and parity traps (read before you write code)

The geo file name is a hash of the SVG text. If one character of the SVG changes, all file names
change. So, treat the SVG string as a byte-exact contract.

1. **UTF-16 hashing.** The current `fnv1a` hashes `charCodeAt` values, which are UTF-16 code units.
   Gleam strings iterate by grapheme or code point. Get UTF-16 code units through FFI.
2. **32-bit integer math.** `Math.imul`, `>>> 0` and `| 0` need exact 32-bit semantics. Gleam
   `Int` on JavaScript is a JS number. Put these operations in FFI.
3. **Number to string.** The current code puts JS numbers into template strings (`12`, `3.5`,
   `-0.75`) and uses `+v.toFixed(2)`. Gleam `float.to_string` gives a different format (`12.0`).
   Use one FFI function `js_num(Float) -> String` that does `String(x)`, and one for `n2`.
4. **Trigonometry.** Use `Math.cos`, `Math.sin` and `Math.PI` through FFI, so the results are bit-identical.
5. **RNG call order.** `geo.js` says: "changing FAMILIES or any rng call order reshuffles every
   icon." Keep the exact order of each `rnd()`, `int()`, `pick()` and `chance()` call, including
   the retry loop in `tiles` (up to 12 tries).
6. **`alpha()`** uses `String(hex).slice(0, 7)` and `Math.round(a * 255).toString(16).padStart(2, "0")`.
   Copy this exactly, including when the input is not a valid hex color.
7. **Fallbacks.** Theme lookups fall back: `t[color] ?? t.accent` and `t[s.status] ?? t.unknown`.
   An override color that starts with `#` is used directly.
8. **Overrides decoding.** `glyph` can be an index or a name. `color` can be an index, a theme
   name or a `#hex` value. `seed` is used only if `trim()` is not empty. Invalid values are
   ignored silently. Keys are trimmed and made lower-case. Decode with `gleam/dynamic/decode`.

**FFI policy:** Put all FFI in one file, `src/space_icons/ffi/js.mjs`. Allow only these items:
`utf16_units`, `imul`, `to_u32`, `to_i32`, `js_num`, `n2`, `cos`, `sin`, `pi`, `round`,
`to_hex`, `to_base36`. Each function must be at most 3 lines and must have a parity test. To add
another FFI function, ask me first.

## 6. Target design

### 6.1 Types (a sketch: improve the names, keep the shape)

```gleam
pub type Space { Space(id: String, name: String, status: String, active: Bool, machine: Option(String)) }
pub type Snapshot { Snapshot(spaces: List(Space), theme: Dict(String, String), macos_lights: Bool) }

pub type Overrides { OverridesLoading  OverridesReady(Dict(String, Override)) }
pub type GeoDir    { DirUnknown  DirListed(ready: Set(String)) }

pub type State {
  State(overrides: Overrides, geo: GeoDir, in_flight: Set(String), known: Dict(String, GeoFile))
}

pub type Event {
  OverridesRead(Result(Option(String), String))
  GeoDirListed(Result(List(String), String))
  Tick(needed: List(GeoFile))        // shell sends the files the current view needs
  Written(file: String, result: Result(Nil, String))
  ClickedSpace(id: String)
  RightClickedSpace(id: String)
  ClickedNewSpace
}

pub type Effect {
  ReadText(path: String)
  MkdirAndList(dir: String)
  WriteFile(path: String, content: String)
  RunCommand(name: String, args: Json)
  OpenOverlay(spec: Json)
  Log(message: String)
}
```

You decide how `Tick` gets the needed files. One good option is a pure function
`needed_files(State, Snapshot) -> List(GeoFile)`. The shell calls it on each timer tick. This keeps
`render` free of mutation. Write down your choice in the decision log.

### 6.2 `Node`: a small UI tree owned by the core

```gleam
pub type Node { El(kind: Kind, attrs: List(Attr), children: List(Node))  Text(String) }
pub type Kind { HFlex  VFlex  Div  Svg(path: String) }
pub type Attr {
  Id(String) Relative Absolute WFull SizeFull MinH(Int) H(Int) Size(Int) FlexNone Flex1
  Top(Int) Bottom(Int) Left(Int) Right(Int) W(Int) Pt(Int) Pb(Int) Gap(Int) Rounded(Int)
  Bg(String) Border1 Border2 BorderColor(String) TextColor(String) JustifyCenter ItemsCenter
  CursorPointer OverflowYScrollbar Tooltip(String) Hover(List(Attr))
  LoopOpacity(from: Float, to: Float, period: Int)
  OnClick(Event) OnRightDown(Event) StopLeftDown
}
```

Add only the attributes that the current `main.js` uses. The shell maps each `Attr` to exactly one
builder call, in list order.

### 6.3 Invariants for the exhaustive explorer

Bounded domain: 0 to 3 spaces, 2 or 3 distinct names, overrides absent or present, and all event
types in all orders (also duplicate and out-of-order `Written` events).

- **I1:** No `WriteFile` effect before `geo` is `DirListed`. (The current code has the same rule
  with the `loaded` flag.)
- **I2:** A file is never in `in_flight` twice. No `WriteFile` for a file that is ready or in flight.
- **I3:** From each reachable state, after `GeoDirListed(Ok)`, a `Tick` followed by successful
  `Written` events leads to a state where each needed file is ready (no dead state).
- **I4:** A failed write removes the file from `in_flight` and does not add it to `ready`. The
  next `Tick` asks for it again. (This is the retry behaviour of the current code.)
- **I5:** A failed overrides read gives empty overrides, one `Log` effect and no crash.
- **I6:** `view` shows an SVG path only for a file in `ready`, or for a pinned Lucide glyph.
- **I7:** UI events give only `RunCommand` or `OpenOverlay` effects, with the exact arguments from section 2.2.

## 7. Project layout

Keep the source **outside** `~/.config/herdr-app/mods/`, because Herdr reloads on each save there.

```
~/code/herdr-mods/space-icons/
  gleam.toml                     target = "javascript"
  src/space_icons/
    hash.gleam  rng.gleam  num.gleam  glyphs.gleam  geo.gleam
    model.gleam  update.gleam  view.gleam  core.gleam (public API for the shell)
    ffi/js.mjs
  test/                          gleeunit + qcheck: unit tests, properties, explorer
  shell/
    main.ts                      class extends View; runs init/update/view
    interpret.ts                 Node -> GPUI builders
    effects.ts                   Effect -> herdr calls; skips all when checking()
    snapshot.ts                  spaces()/theme()/window() -> Snapshot
  parity/                        Vitest, runs in Node
    oracle/                      FROZEN copies of glyphs.js and geo.js, and main.js with fakes
    fakes/                       recorder fakes for "herdr", "gpui-kit", "gpui-base"
    golden/                      generated corpus files
  scripts/  build.sh  install.sh  check.sh
  docs/decisions.md              decision log
  README.md
```

Build: run `gleam build`, then bundle `shell/main.ts` with esbuild (`--bundle --format=esm`, and
external `herdr`, `gpui-kit`, `gpui-base`, `fs/promises`). The output is one `main.js` file. Then
copy `main.js`, `mod.json`, `overrides.json` and `icons/` (with `LICENSE`) to the install folder.

The install folder name is a build-time constant `MOD_NAME`. Before the cutover it is
`space-icons-g`. The geo folder and the overrides path come from `MOD_NAME`. They are not hard-coded.

## 8. Process

### Phase 0: Reconnaissance and baseline
- Read `AGENTS.md`, `herdr.d.ts`, the parts of `gpui-kit.d.ts` that you need, and all files of the mod.
- Run `herdr-app check` on the current mod and record the result.
- Save baseline screenshots with `herdr-app shot`: rail with 1 space, rail with many spaces, one
  active space, one remote space, statuses `working`, `blocked` and `done`.
- Record the versions of the Gleam, Node, esbuild and Herdr tools in `docs/decisions.md`.
- **Gate:** a short report of the findings and any part of this prompt that does not match the
  real code. **[ASK]**

### Phase 1: Toolchain spike (remove risk first)
- Make a minimal Gleam module (a custom type, a `List`, a `Dict`, a `case`, and one FFI call).
  Bundle it with a minimal shell into `mods/space-icons-spike/`.
- The shell renders one text line that comes from Gleam.
- Run `herdr-app check`, then open the mod in the app.
- **Gate:** the check passes and the text shows in the app. If QuickJS rejects the Gleam output,
  stop and report the exact error. Do not work around it. **[ASK]**
- After the gate, delete the spike folder (ask for permission if a delete is blocked).

### Phase 2: Parity oracle
- Copy the current `glyphs.js` and `geo.js` into `parity/oracle/`. Never change these copies.
- Write recorder fakes. Each builder call is recorded as `{method, args}` in a tree, and callbacks
  are replaced by labels. Load the current `main.js` against the fakes.
- Generate golden files:
  - (a) 10,000 or more names: ASCII, empty, whitespace, mixed case, emoji, CJK, combining marks,
    and lone surrogates. For each name, store the result of `iconFor`.
  - (b) For each name and for each forced family: the `geoIcon` SVG and the file name.
  - (c) View trees for the snapshot matrix in section 9.
- **Gate:** the golden files are generated, can be regenerated, and are committed.

### Phase 3: Numeric core and FFI (red, green, refactor)
- Port `fnv1a`, `mulberry32` and the helpers `int`, `pick`, `chance`, `n2` and `poly`.
- Add property tests against the oracle (fast-check in `parity/`): the same output for random strings and seeds.
- **Gate:** all parity tests pass. Each FFI function has a test.

### Phase 4: `glyphs` and `alpha`
- Port `iconFor`, the overrides decoder, `COLORS`, `GLYPHS` and `alpha`.
- **Gate:** parity on corpus (a), plus override cases: glyph index or name, invalid glyph, color
  index out of range, `#hex` color, theme color name, blank seed, unknown family.

### Phase 5: `geo` families
- Port the 6 families and `geoIcon`. Port one family at a time, with parity tests for that family.
- **Gate:** byte-identical SVG and file name for all of corpus (b).

### Phase 6: State machine and explorer
- Define `State`, `Event`, `Effect` and a total `update` with no catch-all branch.
- Write the bounded breadth-first explorer in `test/`. Check I1 to I5 and I7.
- Add one deliberate mutation test: remove the I1 guard and show that the explorer fails. Then put the guard back.
- **Gate:** the explorer passes. Show the number of reachable states and transitions. **[ASK]**

### Phase 7: View
- Define `Node` and `Attr`. Write `view(State, Snapshot) -> Node`.
- Write the shell interpreter. Run the new view through the same recorder fakes.
- **Gate:** the recorded tree is identical to golden set (c) for each snapshot in the matrix. I6 passes.

### Phase 8: Shell and effects
- Write `main.ts`, `effects.ts` and `snapshot.ts`.
  - `init` gives the effects from `core.init`.
  - A `cx.timer.every(150, ...)` sends `Tick`.
  - Effect results become Events.
  - After each `update`, the shell calls `cx.notify()` only if the state changed.
  - `render` calls only `view` and `interpret`.
  - Pass a new `cx` to each callback. Store no `cx`.
- Typecheck with `tsc --noEmit` against the Herdr `.d.ts` files (reference them, do not copy them).
- Test with the fake `herdr`: the effect runner does nothing when `checking()` is true, and
  timers start only through `cx.timer`.
- **Gate:** `tsc` passes, the shell tests pass, and `herdr-app check` passes on the bundle.

### Phase 9: Install side by side and verify live
- Install to `mods/space-icons-g/`. Run `herdr-app check` and `herdr-app status` (no errors).
- Put the new mod in a copy of the layout (`layout.clone`). Do not change the user's current layout.
- Repeat the Phase 0 screenshots, then compare them to the baseline with a pixel diff and a small tolerance.
- Live scenarios:
  - Create and close spaces with `herdr-app do`.
  - Start an agent and see `working`, `blocked` and `done`.
  - Save a file in the mod folder to trigger a hot reload.
  - Delete one file in the geo folder and confirm that the mod writes it again.
- **Gate:** a report with screenshots, diffs and results. **[ASK]**

### Phase 10: Cutover proposal
- Do not cut over. Write the exact steps for a cutover and for a rollback:
  - Rename the folders.
  - Copy or keep `geo/`. The files are deterministic, so they regenerate.
  - Move `overrides.json`.
  - Set `MOD_NAME` back to `space-icons`.
- **Gate:** I approve the cutover. **[ASK]**

## 9. Snapshot matrix for the view parity tests

At minimum, combine these values pairwise (use a pairwise tool, or list the cases):

- spaces: 0, 1, 7 (more than the rail height, so it scrolls)
- status: `idle`, `working`, `blocked`, `done`, an unknown string
- active: true, false
- machine: none, `"vps"`
- color: a theme name that exists in the theme, a theme name that is missing (accent fallback), `#rrggbb`, `#rrggbbaa`
- icon: geo file ready, geo file not ready (empty box), pinned Lucide glyph
- window: macOS not fullscreen, macOS fullscreen, Linux, `window()` returns null

## 10. Rules of work

- Use red, green, refactor. Write the failing test first.
- Commit after each green gate, with a message that names the phase.
- Write each choice that this prompt does not settle into `docs/decisions.md`: the choice, the
  options you rejected, and why.
- Write nothing outside `~/code/herdr-mods/space-icons/` and `~/.config/herdr-app/mods/space-icons-*`,
  except the layout copy in Phase 9.
- **Stop and ask** in these cases:
  - QuickJS cannot run something.
  - Exact parity is not possible for an output.
  - A fix would change the visible behaviour.
  - The Herdr API is different from this prompt.
  - You want to add an FFI function or a dependency.

## 11. Definition of done

- [ ] All parity tests pass: corpus (a), corpus (b) and view set (c).
- [ ] The explorer passes I1 to I7. The mutation test shows that it catches a removed guard.
- [ ] `update` has no catch-all branch. Adding a dummy `Event` variant makes `gleam build` fail. Show this, then revert it.
- [ ] `tsc --noEmit` passes. `herdr-app check mods/space-icons-g` passes. `herdr-app status` shows no mod errors.
- [ ] The screenshot diffs are within tolerance.
- [ ] The shell has no `space-icons`-specific logic.
- [ ] `README.md` explains how to build, test, install and roll back. `docs/decisions.md` is complete.
