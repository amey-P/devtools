//// One test per FFI function (src/space_icons/ffi/js.mjs), on the values that make JS and Gleam differ.

import gleam/dynamic
import gleam/dynamic/decode
import gleam/json
import gleam/list
import space_icons/js

pub fn utf16_units_test() {
  assert js.utf16_units("") == []
  assert js.utf16_units("aZ") == [97, 90]
  // An astral code point is two UTF-16 code units; a lone surrogate is one.
  assert js.utf16_units("🚀") == [0xd83d, 0xde80]
  assert js.utf16_units("e\u{301}") == [101, 0x301]
}

pub fn imul_test() {
  assert js.imul(0x811c9dc5, 0x01000193) == 84_696_351
  assert js.imul(-1, -1) == 1
  assert js.imul(0x7fffffff, 2) == -2
}

pub fn to_u32_test() {
  assert js.to_u32(-1) == 4_294_967_295
  assert js.to_u32(4_294_967_296) == 0
  assert js.to_u32(5) == 5
}

pub fn to_i32_test() {
  assert js.to_i32(4_294_967_295) == -1
  assert js.to_i32(0x6d2b79f5 + 0x7fffffff) == -315_917_836
  assert js.to_i32(7) == 7
}

pub fn js_num_test() {
  assert js.js_num(12.0) == "12"
  assert js.js_num(3.5) == "3.5"
  assert js.js_num(-0.75) == "-0.75"
  assert js.js_num(-0.0) == "0"
  assert js.js_num(0.1 +. 0.2) == "0.30000000000000004"
  assert js.js_num(1.0e21) == "1e+21"
}

pub fn n2_test() {
  assert js.n2(1.005) == 1.0
  assert js.n2(2.675) == 2.67
  assert js.n2(-0.001) == -0.0
  assert js.js_num(js.n2(-0.001)) == "0"
  assert js.n2(12.345678) == 12.35
}

pub fn trig_test() {
  assert js.pi() == 3.141592653589793
  assert js.cos(0.0) == 1.0
  assert js.sin(js.pi() /. 6.0) == 0.49999999999999994
  assert js.cos(js.pi() /. 3.0) == 0.5000000000000001
}

pub fn to_base36_test() {
  assert js.to_base36(0) == "0"
  assert js.to_base36(35) == "z"
  assert js.to_base36(4_294_967_295) == "1z141z3"
}

fn parse(text: String) -> dynamic.Dynamic {
  let assert Ok(v) = json.parse(text, decode.dynamic)
  v
}

fn keys(text: String) -> List(String) {
  js.entries(parse(text)) |> list.map(fn(e) { e.0 })
}

pub fn entries_test() {
  // JS property order: integer-like keys ascending first, then insertion order. "1 " is not integer-like.
  assert keys("{\"b\":1,\"2\":2,\"a\":3,\"1\":4,\"1 \":5}")
    == ["1", "2", "b", "a", "1 "]
  // Values come through untouched.
  let assert [#("k", v)] = js.entries(parse("{\"k\":7}"))
  assert decode.run(v, decode.int) == Ok(7)
  // An array has index keys; a string has one index key per UTF-16 unit, valued by that unit.
  assert keys("[10,20]") == ["0", "1"]
  let assert [#("0", a), #("1", b)] = js.entries(dynamic.string("ab"))
  assert decode.run(a, decode.string) == Ok("a")
  assert decode.run(b, decode.string) == Ok("b")
  assert keys("\"\u{1F680}\"") == ["0", "1"]
  // A number, a bool or an empty object has none.
  assert keys("12") == []
  assert keys("true") == []
  assert keys("{}") == []
}
