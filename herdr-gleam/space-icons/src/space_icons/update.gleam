//// The state machine: `init`, `update` and the pure tick source `needed_files`. A port of the
//// behaviour in the oracle's main.js `init` / click handlers and geocache.js `load` / `start` /
//// `path`, with the fixes listed in docs/decisions.md (Phase 6).
////
//// `update` decides every (overrides, geo dir, event) combination explicitly: there is no `_` and
//// no catch-all arm, so a new variant of Overrides, GeoDir or Event fails the build until each
//// combination has a decision. Where a part does not matter, the arm lists its constructors.

import gleam/dict
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleam/set.{type Set}
import space_icons/geo
import space_icons/glyphs
import space_icons/hash
import space_icons/js
import space_icons/model.{
  type Effect, type Event, type Flags, type GeoFile, type Snapshot, type State,
  ClickedNewSpace, ClickedSpace, DirListed, DirUnknown, GeoDirListed, GeoFile,
  Log, MkdirAndList, OpenOverlay, OverridesLoading, OverridesRead,
  OverridesReady, ReadText, RightClickedSpace, RunCommand, State, Tick,
  WriteFile, Written,
}

// --- paths ------------------------------------------------------------------

/// `${appHome}/mods/${mod}/overrides.json` (main.js init).
pub fn overrides_path(flags: Flags) -> String {
  flags.app_home <> "/" <> "mods/" <> flags.mod_name <> "/overrides.json"
}

/// `mods/${mod}/geo`, relative to the app home: what `svg()` gets (geocache.js `rel`).
pub fn geo_rel(flags: Flags) -> String {
  "mods/" <> flags.mod_name <> "/geo"
}

/// `${appHome}/mods/${mod}/geo` (geocache.js `dir`).
pub fn geo_dir(flags: Flags) -> String {
  flags.app_home <> "/" <> geo_rel(flags)
}

// --- init -------------------------------------------------------------------

/// Read overrides.json and list the geo folder. Both answers arrive as events, in any order.
pub fn init(flags: Flags) -> #(State, List(Effect)) {
  #(
    State(
      flags: flags,
      overrides: OverridesLoading,
      geo: DirUnknown,
      in_flight: set.new(),
      known: dict.new(),
    ),
    [ReadText(overrides_path(flags)), MkdirAndList(geo_dir(flags))],
  )
}

// --- update -----------------------------------------------------------------

pub fn update(state: State, event: Event) -> #(State, List(Effect)) {
  case state.overrides, state.geo, event {
    // overrides.json is read once (no hot reload, spec §4). A late second answer is ignored.
    OverridesLoading, DirUnknown, OverridesRead(result)
    | OverridesLoading, DirListed(..), OverridesRead(result)
    -> overrides_read(state, result)
    OverridesReady(..), DirUnknown, OverridesRead(..)
    | OverridesReady(..), DirListed(..), OverridesRead(..)
    -> #(state, [])

    // The geo folder is listed once. An error still counts as listed, with nothing on disk
    // (geocache.js `load` sets `loaded` in both cases).
    OverridesLoading, DirUnknown, GeoDirListed(result)
    | OverridesReady(..), DirUnknown, GeoDirListed(result)
    -> dir_listed(state, result)
    OverridesLoading, DirListed(..), GeoDirListed(..)
    | OverridesReady(..), DirListed(..), GeoDirListed(..)
    -> #(state, [])

    // I1: writes start only once the folder is listed (and overrides are settled, as in the
    // oracle, where `load` runs after the overrides read). Every tick memoizes what it carries.
    OverridesReady(..), DirListed(ready), Tick(needed) ->
      write_missing(remember(state, needed), ready, needed)
    OverridesLoading, DirUnknown, Tick(needed)
    | OverridesLoading, DirListed(..), Tick(needed)
    | OverridesReady(..), DirUnknown, Tick(needed)
    -> #(remember(state, needed), [])

    // A landed write makes the file ready. Before the listing there is no ready set to add to
    // (unreachable: I1 means no write is out before the listing).
    OverridesLoading, DirListed(ready), Written(file, Ok(Nil))
    | OverridesReady(..), DirListed(ready), Written(file, Ok(Nil))
    -> #(
      State(
        ..state,
        geo: DirListed(set.insert(ready, file)),
        in_flight: set.delete(state.in_flight, file),
      ),
      [],
    )
    OverridesLoading, DirUnknown, Written(file, Ok(Nil))
    | OverridesReady(..), DirUnknown, Written(file, Ok(Nil))
    -> #(State(..state, in_flight: set.delete(state.in_flight, file)), [])

    // I4: a failed write leaves `ready` alone and frees the file, so the next tick retries it.
    OverridesLoading, DirUnknown, Written(file, Error(reason))
    | OverridesLoading, DirListed(..), Written(file, Error(reason))
    | OverridesReady(..), DirUnknown, Written(file, Error(reason))
    | OverridesReady(..), DirListed(..), Written(file, Error(reason))
    -> #(State(..state, in_flight: set.delete(state.in_flight, file)), [
      Log("geo: write " <> file <> ": " <> reason),
    ])

    // I7: UI events do the same in every state and change nothing.
    OverridesLoading, DirUnknown, ClickedSpace(id)
    | OverridesLoading, DirListed(..), ClickedSpace(id)
    | OverridesReady(..), DirUnknown, ClickedSpace(id)
    | OverridesReady(..), DirListed(..), ClickedSpace(id)
    -> #(state, [select_space(id)])
    OverridesLoading, DirUnknown, RightClickedSpace(id)
    | OverridesLoading, DirListed(..), RightClickedSpace(id)
    | OverridesReady(..), DirUnknown, RightClickedSpace(id)
    | OverridesReady(..), DirListed(..), RightClickedSpace(id)
    -> #(state, [space_menu(id)])
    OverridesLoading, DirUnknown, ClickedNewSpace
    | OverridesLoading, DirListed(..), ClickedNewSpace
    | OverridesReady(..), DirUnknown, ClickedNewSpace
    | OverridesReady(..), DirListed(..), ClickedNewSpace
    -> #(state, [new_space()])
  }
}

/// I5: a missing file is no overrides; an unreadable or undecodable one is no overrides and
/// exactly one Log, with main.js's text.
fn overrides_read(
  state: State,
  result: Result(option.Option(String), String),
) -> #(State, List(Effect)) {
  let decoded = case result {
    Ok(None) -> Ok(glyphs.no_overrides())
    Ok(Some(text)) -> glyphs.decode_overrides(text)
    Error(reason) -> Error(reason)
  }
  case decoded {
    Ok(overrides) -> #(State(..state, overrides: OverridesReady(overrides)), [])
    Error(reason) -> #(
      State(..state, overrides: OverridesReady(glyphs.no_overrides())),
      [Log("space-icons: overrides.json: " <> reason)],
    )
  }
}

fn dir_listed(
  state: State,
  result: Result(List(String), String),
) -> #(State, List(Effect)) {
  case result {
    Ok(files) -> #(State(..state, geo: DirListed(set.from_list(files))), [])
    Error(reason) -> #(State(..state, geo: DirListed(set.new())), [
      Log("geo: " <> geo_dir(state.flags) <> ": " <> reason),
    ])
  }
}

fn remember(state: State, needed: List(GeoFile)) -> State {
  let known =
    list.fold(needed, state.known, fn(known, gf) {
      dict.insert(known, gf.key, gf)
    })
  State(..state, known: known)
}

/// I2: one WriteFile per file that is neither ready nor in flight, even if `needed` repeats it.
fn write_missing(
  state: State,
  ready: Set(String),
  needed: List(GeoFile),
) -> #(State, List(Effect)) {
  let #(in_flight, effects) =
    list.fold(needed, #(state.in_flight, []), fn(acc, gf) {
      let #(in_flight, effects) = acc
      case set.contains(ready, gf.file) || set.contains(in_flight, gf.file) {
        True -> acc
        False -> #(set.insert(in_flight, gf.file), [
          WriteFile(
            path: geo_dir(state.flags) <> "/" <> gf.file,
            file: gf.file,
            content: gf.svg,
          ),
          ..effects
        ])
      }
    })
  #(State(..state, in_flight: in_flight), list.reverse(effects))
}

// --- UI effects (main.js handlers, exact arguments) -------------------------

/// `run("space.select", { id })`
fn select_space(id: String) -> Effect {
  RunCommand("space.select", Some(json.object([#("id", json.string(id))])))
}

/// `run("space.new")`
fn new_space() -> Effect {
  RunCommand("space.new", None)
}

/// `openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id } } })`
fn space_menu(id: String) -> Effect {
  OpenOverlay(
    json.object([
      #("mod", json.string("menu")),
      #("kind", json.string("popup")),
      #("width", json.int(200)),
      #("height", json.int(260)),
      #(
        "props",
        json.object([
          #("tab", json.string("space")),
          #("target", json.object([#("id", json.string(id))])),
        ]),
      ),
    ]),
  )
}

// --- tick source --------------------------------------------------------------

/// The geo files the rail for `snapshot` draws that `update` still has to act on: not ready
/// (or the folder is not listed yet), or not memoized in `known` yet. Pinned Lucide glyphs are
/// skipped. One entry per file, in rail order. Empty while overrides are loading: the oracle
/// never writes before overrides are settled (docs/decisions.md, Phase 6).
pub fn needed_files(state: State, snapshot: Snapshot) -> List(GeoFile) {
  case state.overrides {
    OverridesLoading -> []
    OverridesReady(overrides) -> {
      let needed_and_seen =
        list.fold(snapshot.spaces, #([], set.new()), fn(acc, space) {
          let #(needed, seen) = acc
          let icon = glyphs.icon_for(space.name, overrides)
          case option.is_some(icon.glyph) {
            True -> acc
            False -> {
              let gf = geo_file_for(state, icon.seed, icon.family)
              let pending = case state.geo {
                DirUnknown -> True
                DirListed(ready) -> !set.contains(ready, gf.file)
              }
              let fresh = !dict.has_key(state.known, gf.key)
              case { pending || fresh } && !set.contains(seen, gf.file) {
                True -> #([gf, ..needed], set.insert(seen, gf.file))
                False -> acc
              }
            }
          }
        })
      list.reverse(needed_and_seen.0)
    }
  }
}

/// The memoized GeoFile for `seed|family`, else a freshly generated one (geocache.js `path`).
pub fn geo_file_for(
  state: State,
  seed: String,
  family: option.Option(String),
) -> GeoFile {
  let key = seed <> "|" <> option.unwrap(family, "")
  case dict.get(state.known, key) {
    Ok(gf) -> gf
    Error(Nil) -> {
      let svg = geo.geo_icon(seed, family).svg
      GeoFile(key: key, file: js.to_base36(hash.fnv1a(svg)) <> ".svg", svg: svg)
    }
  }
}
