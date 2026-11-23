//// JavaScript string semantics the oracle relies on.
//// Gleam's `string.trim` uses its own whitespace list on the JS target (it trims U+0085/U+200E/U+200F
//// and keeps U+00A0, U+3000, U+FEFF, ...), so `js_trim` re-implements `String.prototype.trim`.
//// `string.lowercase` is `toLowerCase` on the JS target, so it is used as is.

import gleam/list
import gleam/string

/// ECMAScript WhiteSpace + LineTerminator: what `String.prototype.trim` removes.
fn is_js_space(c: Int) -> Bool {
  case c {
    0x09 | 0x0A | 0x0B | 0x0C | 0x0D | 0x20 | 0xA0 | 0x1680 | 0x2028 | 0x2029 -> True
    0x202F | 0x205F | 0x3000 | 0xFEFF -> True
    _ -> c >= 0x2000 && c <= 0x200A
  }
}

fn space(c: UtfCodepoint) -> Bool {
  is_js_space(string.utf_codepoint_to_int(c))
}

/// `s.trim()`
pub fn js_trim(s: String) -> String {
  let cps = string.to_utf_codepoints(s)
  case cps, list.last(cps) {
    [], _ -> s
    [first, ..], Ok(last) ->
      case space(first) || space(last) {
        False -> s
        True ->
          cps
          |> list.drop_while(space)
          |> list.reverse
          |> list.drop_while(space)
          |> list.reverse
          |> string.from_utf_codepoints
      }
    _, Error(Nil) -> s
  }
}

/// `(name ?? "").trim().toLowerCase()`: how a space name or an overrides key is looked up.
pub fn key(s: String) -> String {
  string.lowercase(js_trim(s))
}
