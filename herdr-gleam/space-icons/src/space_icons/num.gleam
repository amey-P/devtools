//// Number text exactly as the oracle's template strings print it.

import space_icons/js

/// `${n2(v)}`
pub fn n2_text(v: Float) -> String {
  js.js_num(js.n2(v))
}

/// `${v}`
pub fn text(v: Float) -> String {
  js.js_num(v)
}
