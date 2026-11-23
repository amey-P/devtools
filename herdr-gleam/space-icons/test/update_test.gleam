//// Unit tests and a qcheck property for the state machine (space_icons/update).

import explorer_test.{flags, names, present_text, snapshot, universe}
import gleam/dict
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import qcheck
import space_icons/glyphs
import space_icons/model.{
  type Event, type State, ClickedNewSpace, ClickedSpace, DirListed, GeoDirListed,
  Log, OverridesRead, OverridesReady, RightClickedSpace, State, Tick, WriteFile,
  Written,
}
import space_icons/update

fn ready_state() -> State {
  let s = update.init(flags).0
  let s = update.update(s, OverridesRead(Ok(None))).0
  update.update(s, GeoDirListed(Ok([]))).0
}

pub fn init_test() {
  let #(s, effects) = update.init(flags)
  assert list.map(effects, explorer_test.show_effect)
    == [
      "ReadText(/HOME/mods/space-icons-g/overrides.json)",
      "MkdirAndList(/HOME/mods/space-icons-g/geo)",
    ]
  assert update.geo_rel(flags) == "mods/space-icons-g/geo"
  // Nothing is needed until overrides are settled.
  assert update.needed_files(s, snapshot(names)) == []
}

pub fn geo_dir_error_is_listed_empty_test() {
  let s = update.init(flags).0
  let #(s, effects) = update.update(s, GeoDirListed(Error("EACCES: nope")))
  assert s.geo == DirListed(set.new())
  assert effects == [Log("geo: /HOME/mods/space-icons-g/geo: EACCES: nope")]
}

pub fn overrides_present_test() {
  let s = update.init(flags).0
  let #(s, effects) = update.update(s, OverridesRead(Ok(Some(present_text))))
  assert effects == []
  let assert Ok(o) = glyphs.decode_overrides(present_text)
  assert s.overrides == OverridesReady(o)
  // A second answer (hot reload is a non-goal) changes nothing.
  assert update.update(s, OverridesRead(Ok(None))) == #(s, [])
}

pub fn tick_write_land_test() {
  let s = ready_state()
  let needed = update.needed_files(s, snapshot(["alpha", "alpha", "Beta"]))
  assert list.length(needed) == 2
  let #(s, effects) = update.update(s, Tick(needed))
  let assert [WriteFile(path: p, file: f, content: svg), WriteFile(..)] =
    effects
  assert p == "/HOME/mods/space-icons-g/geo/" <> f
  assert svg != ""
  // The same tick again: everything is in flight, no duplicate write (I2).
  assert update.update(s, Tick(needed)) == #(s, [])
  let s = update.update(s, Written(f, Ok(Nil))).0
  assert s.geo == DirListed(set.from_list([f]))
  assert !set.contains(s.in_flight, f)
}

pub fn failed_write_retries_test() {
  let s = ready_state()
  let needed = update.needed_files(s, snapshot(["alpha"]))
  let assert #(s, [WriteFile(file: f, ..)]) = update.update(s, Tick(needed))
  let #(s, effects) = update.update(s, Written(f, Error("EIO")))
  assert effects == [Log("geo: write " <> f <> ": EIO")]
  assert s.geo == DirListed(set.new())
  let assert [WriteFile(file: again, ..)] =
    update.update(s, Tick(update.needed_files(s, snapshot(["alpha"])))).1
  assert again == f
}

/// Notify-on-change relies on structural equality: the same content built in another order is
/// equal, and an event that changes nothing returns an equal state.
pub fn structural_equality_test() {
  let a = State(..ready_state(), in_flight: set.from_list(["x", "y"]))
  let b =
    State(..ready_state(), in_flight: set.insert(set.from_list(["y"]), "x"))
  assert a == b
  let k1 = dict.from_list([#("a|", 1), #("b|", 2)])
  let k2 = dict.insert(dict.from_list([#("b|", 2)]), "a|", 1)
  assert k1 == k2
  assert update.update(a, ClickedNewSpace).0 == a
  assert update.update(a, GeoDirListed(Ok(["z"]))).0 == a
}

// --- property: I2 under random event sequences ------------------------------------

fn event_table(state: State) -> List(Event) {
  let rails = [
    [],
    ["alpha"],
    ["Beta", "Rocket Ship"],
    names,
    ["alpha", "alpha"],
  ]
  list.flatten([
    [
      OverridesRead(Ok(None)),
      OverridesRead(Ok(Some(present_text))),
      OverridesRead(Error("boom")),
      GeoDirListed(Ok([])),
      GeoDirListed(Error("boom")),
      ClickedSpace("s0"),
      RightClickedSpace("s0"),
    ],
    list.map(rails, fn(r) { Tick(update.needed_files(state, snapshot(r))) }),
    list.flat_map(universe(), fn(gf) {
      [Written(gf.file, Ok(Nil)), Written(gf.file, Error("EIO"))]
    }),
  ])
}

pub fn no_duplicate_write_property_test() {
  let gen =
    qcheck.generic_list(
      elements_from: qcheck.bounded_int(0, 19),
      length_from: qcheck.bounded_int(0, 60),
    )
  use picks <- qcheck.run(
    qcheck.default_config() |> qcheck.with_test_count(500),
    gen,
  )
  let start = update.init(flags).0
  // `outstanding`: files with a WriteFile out and no Written answered for it yet.
  let #(_, _) =
    list.fold(picks, #(start, set.new()), fn(acc, pick) {
      let #(state, outstanding) = acc
      let table = event_table(state)
      let assert Ok(event) =
        list.first(list.drop(table, pick % list.length(table)))
      let #(after, effects) = update.update(state, event)
      let ready = case state.geo {
        DirListed(r) -> r
        model.DirUnknown -> set.new()
      }
      let outstanding = case event {
        Written(f, ..) -> set.delete(outstanding, f)
        _ -> outstanding
      }
      list.fold(effects, #(after, outstanding), fn(acc, e) {
        let #(after, outstanding) = acc
        case e {
          WriteFile(file: f, ..) -> {
            assert !set.contains(outstanding, f)
            assert !set.contains(state.in_flight, f)
            assert !set.contains(ready, f)
            #(after, set.insert(outstanding, f))
          }
          _ -> acc
        }
      })
    })
  Nil
}
