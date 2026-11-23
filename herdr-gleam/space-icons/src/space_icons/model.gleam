//// The core's data: what the shell supplies (Flags, Snapshot), what the core keeps (State), what
//// comes in (Event) and what goes out (Effect). Spec §6.1, with the names tightened.
////
//// State is plain data with no functions inside, so `==` is structural (Dict and Set compare by
//// content). The shell notifies only when `new_state != old_state` (docs/decisions.md, Phase 6).

import gleam/dict.{type Dict}
import gleam/json.{type Json}
import gleam/option.{type Option}
import gleam/set.{type Set}
import space_icons/glyphs

/// What the shell knows at start-up and the core cannot compute.
pub type Flags {
  /// `mod_name`: the install folder under `mods/` (`MOD_NAME`, `space-icons-g` before cutover).
  /// `app_home`: `appHome()`, the absolute Herdr config folder.
  Flags(mod_name: String, app_home: String)
}

/// One space as `spaces()` reports it (only the fields the rail uses).
pub type Space {
  Space(
    id: String,
    name: String,
    status: String,
    active: Bool,
    machine: Option(String),
  )
}

/// `window()` reduced to what the rail reads. `None` in Snapshot when `window()` returns null.
pub type Window {
  Window(platform: String, fullscreen: Bool)
}

/// Everything `view` and `needed_files` read from Herdr, sampled fresh by the shell.
pub type Snapshot {
  Snapshot(
    spaces: List(Space),
    theme: Dict(String, String),
    window: Option(Window),
  )
}

/// overrides.json: not read yet, or read (empty when absent or broken). Read once, at init.
pub type Overrides {
  OverridesLoading
  OverridesReady(glyphs.Overrides)
}

/// The geo folder: not listed yet, or listed with the file names known to be on disk.
pub type GeoDir {
  DirUnknown
  DirListed(ready: Set(String))
}

/// A generated geometric icon. `key` is geocache.js's memo key `seed|family`; `file` is
/// `fnv1a(svg) base36 + ".svg"`.
pub type GeoFile {
  GeoFile(key: String, file: String, svg: String)
}

pub type State {
  State(
    flags: Flags,
    overrides: Overrides,
    geo: GeoDir,
    /// Files with a WriteFile out and no Written back yet.
    in_flight: Set(String),
    /// Memo `seed|family` -> GeoFile, so an SVG is generated once (geocache.js `made`).
    known: Dict(String, GeoFile),
  )
}

pub type Event {
  /// Result of `ReadText`: `Ok(None)` when the file is missing (`readTextFile` gave null).
  OverridesRead(Result(Option(String), String))
  /// Result of `MkdirAndList`: the folder's file names, or the error text.
  GeoDirListed(Result(List(String), String))
  /// Timer (150 ms): the files from `needed_files` for the current snapshot.
  Tick(needed: List(GeoFile))
  /// Result of one `WriteFile`.
  Written(file: String, result: Result(Nil, String))
  ClickedSpace(id: String)
  RightClickedSpace(id: String)
  ClickedNewSpace
}

pub type Effect {
  /// `readTextFile(path)`, answered with `OverridesRead`.
  ReadText(path: String)
  /// `mkdir -p dir` then `readdir dir`, answered with `GeoDirListed`.
  MkdirAndList(dir: String)
  /// `writeFile(path, content)`, answered with `Written(file, ..)`.
  WriteFile(path: String, file: String, content: String)
  /// `run(name, args)`; `None` calls `run(name)` with no second argument.
  RunCommand(name: String, args: Option(Json))
  /// `openOverlay(spec)`.
  OpenOverlay(spec: Json)
  /// `console.log(message)`.
  Log(message: String)
}
