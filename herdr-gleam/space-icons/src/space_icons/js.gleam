//// Bindings for ffi/js.mjs, the core's only FFI. Every other module reaches JS through here.

import gleam/dynamic.{type Dynamic}

/// The string's UTF-16 code units (`charCodeAt`), as the oracle's fnv1a hashes them.
@external(javascript, "./ffi/js.mjs", "utf16_units")
pub fn utf16_units(s: String) -> List(Int)

/// `Math.imul`: 32-bit multiply.
@external(javascript, "./ffi/js.mjs", "imul")
pub fn imul(a: Int, b: Int) -> Int

/// `x >>> 0`
@external(javascript, "./ffi/js.mjs", "to_u32")
pub fn to_u32(x: Int) -> Int

/// `x | 0`
@external(javascript, "./ffi/js.mjs", "to_i32")
pub fn to_i32(x: Int) -> Int

/// `String(x)`: how a JS template string prints a number (`12`, not `12.0`).
@external(javascript, "./ffi/js.mjs", "js_num")
pub fn js_num(x: Float) -> String

/// `+v.toFixed(2)`
@external(javascript, "./ffi/js.mjs", "n2")
pub fn n2(v: Float) -> Float

@external(javascript, "./ffi/js.mjs", "cos")
pub fn cos(x: Float) -> Float

@external(javascript, "./ffi/js.mjs", "sin")
pub fn sin(x: Float) -> Float

@external(javascript, "./ffi/js.mjs", "pi")
pub fn pi() -> Float

/// `n.toString(36)`
@external(javascript, "./ffi/js.mjs", "to_base36")
pub fn to_base36(n: Int) -> String

/// `Object.entries(x)`, in JS property order: integer-like keys ascending, then insertion order.
/// Throws on null/undefined, so callers must guard first.
@external(javascript, "./ffi/js.mjs", "entries")
pub fn entries(x: Dynamic) -> List(#(String, Dynamic))
