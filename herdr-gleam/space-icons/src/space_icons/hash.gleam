//// 32-bit FNV-1a over UTF-16 code units, as the oracle's `fnv1a` (glyphs.js and geo.js).

import gleam/int
import gleam/list
import space_icons/js

pub fn fnv1a(text: String) -> Int {
  js.utf16_units(text)
  |> list.fold(0x811c9dc5, fn(h, c) {
    js.to_u32(js.imul(int.bitwise_exclusive_or(h, c), 0x01000193))
  })
}
