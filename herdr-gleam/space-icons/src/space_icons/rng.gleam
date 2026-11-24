//// mulberry32 and the oracle's `tools` (int, pick, chance) as pure state passing.
//// The order of draws is the contract: every call here mirrors one `rnd()` in geo.js.

import gleam/float
import gleam/int
import gleam/list
import space_icons/js

pub opaque type Rng {
  Rng(a: Int)
}

pub fn new(seed: Int) -> Rng {
  Rng(js.to_i32(seed))
}

/// `x >>> n` for an int32 `x` (Gleam's shift is the signed `>>`).
fn shr_u(x: Int, n: Int) -> Int {
  js.to_u32(x) / int.bitwise_shift_left(1, n)
}

/// One draw, uniform in [0, 1), and the next state.
pub fn next(rng: Rng) -> #(Float, Rng) {
  let a = js.to_i32(rng.a + 0x6d2b79f5)
  let t =
    js.imul(int.bitwise_exclusive_or(a, shr_u(a, 15)), int.bitwise_or(1, a))
  let t =
    int.bitwise_exclusive_or(
      t
        + js.imul(
        int.bitwise_exclusive_or(t, shr_u(t, 7)),
        int.bitwise_or(61, t),
      ),
      t,
    )
  let u = js.to_u32(int.bitwise_exclusive_or(t, shr_u(t, 14)))
  #(int.to_float(u) /. 4_294_967_296.0, Rng(a))
}

/// `Math.floor(rnd() * n)`
pub fn int(rng: Rng, n: Int) -> #(Int, Rng) {
  let #(x, rng) = next(rng)
  #(float.truncate(float.floor(x *. int.to_float(n))), rng)
}

/// `xs[Math.floor(rnd() * xs.length)]`. `xs` must not be empty.
pub fn pick(rng: Rng, xs: List(a)) -> #(a, Rng) {
  let #(i, rng) = int(rng, list.length(xs))
  let assert [x, ..] = list.drop(xs, i)
  #(x, rng)
}

/// `rnd() < p`
pub fn chance(rng: Rng, p: Float) -> #(Bool, Rng) {
  let #(x, rng) = next(rng)
  #(x <. p, rng)
}
