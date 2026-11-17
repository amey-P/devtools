//// Phase 1 toolchain spike: a custom type, a List, a Dict, a case and one FFI call. Deleted after the gate.

import gleam/dict
import gleam/int
import gleam/list
import gleam/string

pub type Mood {
  Calm
  Busy(count: Int)
}

@external(javascript, "./space_icons/ffi/js.mjs", "js_num")
fn js_num(x: Float) -> String

pub fn line() -> String {
  let counts =
    [Calm, Busy(5)]
    |> list.map(fn(m) {
      case m {
        Calm -> #("calm", 0)
        Busy(n) -> #("busy", n)
      }
    })
    |> dict.from_list
  let busy = case dict.get(counts, "busy") {
    Ok(n) -> n
    Error(Nil) -> -1
  }
  string.join(
    ["Hello from Gleam", "busy/2=" <> js_num(int.to_float(busy) /. 2.0), "12.0=" <> js_num(12.0)],
    " · ",
  )
}
