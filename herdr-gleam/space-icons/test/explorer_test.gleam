//// Bounded breadth-first explorer over the spec §6.3 domain. From `init`, every event in the
//// domain is applied to every reachable state; states are deduped by a canonical key. Every
//// transition is checked against I1, I2, I4, I5 and I7, and every reachable state against I3.
////
//// Domain: names drawn from a pool of 3 (snapshots are every list of 0–3 spaces over the pool, so
//// 2-name and duplicate-name rails are included); overrides absent, present or failed (read
//// error and undecodable text); geo listing ok, ok with files already on disk, or failed; Ticks
//// carrying the current `needed_files` for every snapshot, plus a doubled one and a stale one;
//// `Written` Ok and Error for every file in the universe, in any order and any number of times
//// (so duplicate and out-of-order answers are covered); the three UI events.

import gleam/dict
import gleam/int
import gleam/io
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleam/set.{type Set}
import gleam/string
import space_icons/geo
import space_icons/glyphs
import space_icons/model.{
  type Effect, type Event, type GeoFile, type Snapshot, type State,
  ClickedNewSpace, ClickedSpace, DirListed, DirUnknown, Flags, GeoDirListed, Log,
  MkdirAndList, OpenOverlay, OverridesLoading, OverridesRead, OverridesReady,
  ReadText, RightClickedSpace, RunCommand, Snapshot, Space, Tick, WriteFile,
  Written,
}
import space_icons/update

// --- domain -----------------------------------------------------------------

pub const flags = Flags(mod_name: "space-icons-g", app_home: "/HOME")

/// `Beta` is pinned to a Lucide glyph and `Rocket Ship` gets another seed/family when overrides
/// are present, so the present run draws different files from the absent one.
pub const names = ["alpha", "Beta", "Rocket Ship"]

pub const present_text =
  "{\"beta\": {\"glyph\": \"rocket\"}, \" ROCKET SHIP \": {\"seed\": \"zzz\", \"family\": \"rings\"}}"

pub type Mode {
  Mode(name: String, reads: List(Event))
}

pub fn modes() -> List(Mode) {
  [
    Mode("absent", [OverridesRead(Ok(None))]),
    Mode("present", [OverridesRead(Ok(Some(present_text)))]),
    Mode("failed", [
      OverridesRead(Error("Error: EACCES: permission denied")),
      OverridesRead(Ok(Some("{\"beta\": "))),
    ]),
  ]
}

/// Every list of 0–3 spaces over the name pool (40 rails).
pub fn snapshots() -> List(Snapshot) {
  let lists =
    list.fold([1, 2, 3], [[]], fn(acc, n) {
      let longer =
        list.flat_map(acc, fn(l) {
          case list.length(l) == n - 1 {
            True -> list.map(names, fn(name) { list.append(l, [name]) })
            False -> []
          }
        })
      list.append(acc, longer)
    })
  list.map(lists, snapshot)
}

pub fn snapshot(rail: List(String)) -> Snapshot {
  Snapshot(
    spaces: list.index_map(rail, fn(name, i) {
      Space(
        id: "s" <> int.to_string(i),
        name: name,
        status: "idle",
        active: False,
        machine: None,
      )
    }),
    theme: dict.new(),
    window: None,
  )
}

fn present_overrides() -> glyphs.Overrides {
  let assert Ok(o) = glyphs.decode_overrides(present_text)
  o
}

/// Every geo file any run can draw (empty and present overrides).
pub fn universe() -> List(GeoFile) {
  let st = update.init(flags).0
  [glyphs.no_overrides(), present_overrides()]
  |> list.flat_map(fn(o) {
    list.filter_map(names, fn(name) {
      let icon = glyphs.icon_for(name, o)
      case icon.glyph {
        Some(..) -> Error(Nil)
        None -> Ok(update.geo_file_for(st, icon.seed, icon.family))
      }
    })
  })
  |> list.unique
}

fn alpha_file() -> String {
  let icon = glyphs.icon_for("alpha", glyphs.no_overrides())
  geo.geo_file(icon.seed, icon.family)
}

pub fn events(mode: Mode, state: State, snaps: List(Snapshot)) -> List(Event) {
  let full = snapshot(names)
  let ticks =
    list.map(snaps, fn(snap) { Tick(update.needed_files(state, snap)) })
    |> list.append([
      Tick(list.append(
        update.needed_files(state, full),
        update.needed_files(state, full),
      )),
      Tick(universe()),
    ])
    |> list.unique
  let written =
    list.flat_map(universe(), fn(gf) {
      [Written(gf.file, Ok(Nil)), Written(gf.file, Error("EIO: i/o error"))]
    })
  list.flatten([
    mode.reads,
    [
      GeoDirListed(Ok([])),
      GeoDirListed(Ok([alpha_file(), "junk.txt"])),
      GeoDirListed(Error("EACCES: permission denied")),
    ],
    ticks,
    written,
    [ClickedSpace("s1"), RightClickedSpace("s1"), ClickedNewSpace],
  ])
}

// --- canonical forms ----------------------------------------------------------

fn sorted(s: Set(String)) -> String {
  s |> set.to_list |> list.sort(string.compare) |> string.join(",")
}

pub fn key(state: State) -> String {
  let o = case state.overrides {
    OverridesLoading -> "L"
    OverridesReady(d) -> "R" <> int.to_string(dict.size(d))
  }
  let g = case state.geo {
    DirUnknown -> "U"
    DirListed(ready) -> "D[" <> sorted(ready) <> "]"
  }
  o
  <> "|"
  <> g
  <> "|F["
  <> sorted(state.in_flight)
  <> "]|K["
  <> sorted(set.from_list(dict.keys(state.known)))
  <> "]"
}

pub fn show_effect(e: Effect) -> String {
  case e {
    ReadText(p) -> "ReadText(" <> p <> ")"
    MkdirAndList(d) -> "MkdirAndList(" <> d <> ")"
    WriteFile(path, file, _) -> "WriteFile(" <> path <> ", " <> file <> ")"
    RunCommand(name, None) -> "RunCommand(" <> name <> ")"
    RunCommand(name, Some(args)) ->
      "RunCommand(" <> name <> ", " <> json.to_string(args) <> ")"
    OpenOverlay(spec) -> "OpenOverlay(" <> json.to_string(spec) <> ")"
    Log(m) -> "Log(" <> m <> ")"
  }
}

fn show_event(e: Event) -> String {
  case e {
    Tick(needed) ->
      "Tick([" <> string.join(list.map(needed, fn(gf) { gf.file }), ",") <> "])"
    other -> string.inspect(other)
  }
}

fn ready(state: State) -> Set(String) {
  case state.geo {
    DirUnknown -> set.new()
    DirListed(r) -> r
  }
}

fn writes(effects: List(Effect)) -> List(String) {
  list.filter_map(effects, fn(e) {
    case e {
      WriteFile(file: f, ..) -> Ok(f)
      _ -> Error(Nil)
    }
  })
}

fn is_listed(state: State) -> Bool {
  case state.geo {
    DirUnknown -> False
    DirListed(..) -> True
  }
}

fn failed_read(e: Event) -> Bool {
  case e {
    OverridesRead(Error(..)) -> True
    OverridesRead(Ok(Some(text))) ->
      result_is_error(glyphs.decode_overrides(text))
    _ -> False
  }
}

fn result_is_error(r: Result(a, b)) -> Bool {
  case r {
    Ok(..) -> False
    Error(..) -> True
  }
}

// --- invariants ----------------------------------------------------------------

/// The violations of one transition `before --event--> after / effects`.
pub fn check(
  before: State,
  event: Event,
  after: State,
  effects: List(Effect),
) -> List(String) {
  let shown = list.map(effects, show_effect)
  let wrote = writes(effects)
  let i1 = case wrote != [] && { !is_listed(before) || !is_listed(after) } {
    True -> ["I1: WriteFile before the geo dir is listed"]
    False -> []
  }
  let i2 =
    list.flatten([
      case list.length(list.unique(wrote)) == list.length(wrote) {
        True -> []
        False -> ["I2: the same file written twice in one transition"]
      },
      list.filter_map(wrote, fn(f) {
        case
          set.contains(before.in_flight, f),
          set.contains(ready(before), f),
          set.contains(after.in_flight, f)
        {
          True, _, _ -> Ok("I2: WriteFile for " <> f <> ", already in flight")
          _, True, _ -> Ok("I2: WriteFile for " <> f <> ", already ready")
          _, _, False -> Ok("I2: " <> f <> " written but not in in_flight")
          False, False, True -> Error(Nil)
        }
      }),
      case set.size(set.intersection(after.in_flight, ready(after))) {
        0 -> []
        _ -> ["I2: a file is both ready and in flight"]
      },
    ])
  let i4 = case event {
    Written(f, Error(reason)) -> {
      let base =
        list.flatten([
          case set.contains(after.in_flight, f) {
            True -> ["I4: failed " <> f <> " still in flight"]
            False -> []
          },
          case ready(after) == ready(before) {
            True -> []
            False -> ["I4: a failed write changed ready"]
          },
          case shown == ["Log(geo: write " <> f <> ": " <> reason <> ")"] {
            True -> []
            False -> [
              "I4: expected one write Log, got " <> string.inspect(shown),
            ]
          },
        ])
      let retry = case after.overrides, after.geo {
        OverridesReady(..), DirListed(r) ->
          case set.contains(r, f) {
            True -> []
            False -> {
              let assert Ok(gf) = list.find(universe(), fn(g) { g.file == f })
              case writes(update.update(after, Tick([gf])).1) == [f] {
                True -> []
                False -> ["I4: the next Tick does not retry " <> f]
              }
            }
          }
        _, _ -> []
      }
      list.append(base, retry)
    }
    _ -> []
  }
  let i5 = case event {
    OverridesRead(..) ->
      case before.overrides, failed_read(event) {
        OverridesLoading, True ->
          case after.overrides == OverridesReady(glyphs.no_overrides()), shown {
            True, [one] ->
              case
                string.starts_with(one, "Log(space-icons: overrides.json: ")
              {
                True -> []
                False -> ["I5: wrong Log " <> one]
              }
            _, _ -> [
              "I5: failed read gave "
              <> string.inspect(#(after.overrides, shown)),
            ]
          }
        OverridesLoading, False ->
          case shown {
            [] -> []
            _ -> ["I5: a good read logged " <> string.inspect(shown)]
          }
        OverridesReady(..), _ ->
          case after == before && shown == [] {
            True -> []
            False -> ["I5: a second read changed something"]
          }
      }
    _ -> []
  }
  let ui = case event {
    ClickedSpace(id) ->
      Some(["RunCommand(space.select, {\"id\":\"" <> id <> "\"})"])
    RightClickedSpace(id) ->
      Some([
        "OpenOverlay({\"mod\":\"menu\",\"kind\":\"popup\",\"width\":200,\"height\":260,\"props\":{\"tab\":\"space\",\"target\":{\"id\":\""
        <> id
        <> "\"}}})",
      ])
    ClickedNewSpace -> Some(["RunCommand(space.new)"])
    _ -> None
  }
  let i7 = case ui {
    Some(expected) ->
      case shown == expected && after == before {
        True -> []
        False -> ["I7: UI event gave " <> string.inspect(shown)]
      }
    None ->
      case
        list.any(effects, fn(e) {
          case e {
            RunCommand(..) | OpenOverlay(..) -> True
            _ -> False
          }
        })
      {
        True -> ["I7: a non-UI event ran a command or opened an overlay"]
        False -> []
      }
  }
  list.flatten([i1, i2, i4, i5, i7])
}

/// The geo files `snap` draws under the state's overrides (an independent reading of the rail).
fn drawn(state: State, snap: Snapshot) -> Set(String) {
  let o = case state.overrides {
    OverridesLoading -> glyphs.no_overrides()
    OverridesReady(o) -> o
  }
  list.filter_map(snap.spaces, fn(s) {
    let icon = glyphs.icon_for(s.name, o)
    case icon.glyph {
      Some(..) -> Error(Nil)
      None -> Ok(geo.geo_file(icon.seed, icon.family))
    }
  })
  |> set.from_list
}

/// I3: settle the pending reads, Tick once, answer every write with Ok: every drawn file is ready
/// and nothing is needed any more.
pub fn check_live(
  mode: Mode,
  state: State,
  snaps: List(Snapshot),
) -> List(String) {
  let assert [read, ..] = mode.reads
  let settled = case state.geo {
    DirUnknown -> update.update(state, GeoDirListed(Ok([]))).0
    DirListed(..) -> state
  }
  let settled = update.update(settled, read).0
  list.filter_map(snaps, fn(snap) {
    let ticked =
      update.update(settled, Tick(update.needed_files(settled, snap))).0
    let done =
      set.fold(ticked.in_flight, ticked, fn(s, f) {
        update.update(s, Written(f, Ok(Nil))).0
      })
    case
      set.is_subset(drawn(done, snap), ready(done)),
      update.needed_files(done, snap)
    {
      True, [] -> Error(Nil)
      _, left ->
        Ok(
          "I3: dead state "
          <> key(state)
          <> ", still needed "
          <> string.inspect(list.map(left, fn(gf) { gf.file })),
        )
    }
  })
}

// --- search ------------------------------------------------------------------------

pub type Stats {
  Stats(states: Int, transitions: Int)
}

pub fn explore(mode: Mode) -> Stats {
  let snaps = snapshots()
  // I3 is checked against the distinct name sets only (the rest repeat them).
  let live_snaps =
    list.unique(
      list.map(snaps, fn(s) {
        list.sort(list.map(s.spaces, fn(sp) { sp.name }), string.compare)
        |> list.unique
      }),
    )
    |> list.map(snapshot)
  let #(start, init_effects) = update.init(flags)
  let assert [
    "ReadText(/HOME/mods/space-icons-g/overrides.json)",
    "MkdirAndList(/HOME/mods/space-icons-g/geo)",
  ] = list.map(init_effects, show_effect)
  assert_ok(check_live(mode, start, live_snaps), mode, "init")
  bfs(
    mode,
    snaps,
    live_snaps,
    [start],
    set.from_list([key(start)]),
    Stats(1, 0),
  )
}

fn bfs(
  mode: Mode,
  snaps: List(Snapshot),
  live_snaps: List(Snapshot),
  frontier: List(State),
  seen: Set(String),
  stats: Stats,
) -> Stats {
  case frontier {
    [] -> stats
    _ -> {
      let #(next, seen, stats) =
        list.fold(frontier, #([], seen, stats), fn(acc, state) {
          list.fold(events(mode, state, snaps), acc, fn(acc, event) {
            let #(next, seen, stats) = acc
            let #(after, effects) = update.update(state, event)
            assert_ok(
              check(state, event, after, effects),
              mode,
              key(state) <> " --" <> show_event(event) <> "-->",
            )
            let stats = Stats(..stats, transitions: stats.transitions + 1)
            let k = key(after)
            case set.contains(seen, k) {
              True -> #(next, seen, stats)
              False -> {
                assert_ok(check_live(mode, after, live_snaps), mode, k)
                #(
                  [after, ..next],
                  set.insert(seen, k),
                  Stats(..stats, states: stats.states + 1),
                )
              }
            }
          })
        })
      bfs(mode, snaps, live_snaps, next, seen, stats)
    }
  }
}

fn assert_ok(violations: List(String), mode: Mode, at: String) -> Nil {
  case violations {
    [] -> Nil
    _ ->
      panic as {
        "explorer ("
        <> mode.name
        <> ") at "
        <> at
        <> "\n  "
        <> string.join(violations, "\n  ")
      }
  }
}

pub fn explorer_test() {
  let total =
    list.fold(modes(), Stats(0, 0), fn(total, mode) {
      let s = explore(mode)
      io.println(
        "explorer: overrides "
        <> mode.name
        <> ": "
        <> int.to_string(s.states)
        <> " states, "
        <> int.to_string(s.transitions)
        <> " transitions",
      )
      Stats(total.states + s.states, total.transitions + s.transitions)
    })
  io.println(
    "explorer: total "
    <> int.to_string(total.states)
    <> " states, "
    <> int.to_string(total.transitions)
    <> " transitions",
  )
  assert total.states > 0
}

/// Sanity of the domain itself: 4 distinct drawable files (the present run draws a different one)
/// and 40 rails.
pub fn domain_test() {
  assert list.length(universe()) == 4
  assert list.length(snapshots()) == 40
}
