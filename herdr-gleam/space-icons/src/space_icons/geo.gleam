//// Seeded geometric icons: a port of the oracle's geo.js. Same seed, same SVG text, byte for byte.
//// Order matters: every rng draw happens in the same order as in geo.js.

import gleam/int
import gleam/list
import gleam/string
import space_icons/js
import space_icons/num

fn tau() -> Float {
  js.pi() *. 2.0
}

/// [0, 1, ..., n - 1]
fn upto(n: Int) -> List(Int) {
  upto_loop(n - 1, [])
}

fn upto_loop(i: Int, acc: List(Int)) -> List(Int) {
  case i < 0 {
    True -> acc
    False -> upto_loop(i - 1, [i, ..acc])
  }
}

/// `Math.max(...xs)` / `Math.min(...xs)` for a non-empty list without NaN.
fn max(xs: List(Float)) -> Float {
  let assert [x, ..rest] = xs
  list.fold(rest, x, fn(m, v) {
    case v >. m {
      True -> v
      False -> m
    }
  })
}

fn min(xs: List(Float)) -> Float {
  let assert [x, ..rest] = xs
  list.fold(rest, x, fn(m, v) {
    case v <. m {
      True -> v
      False -> m
    }
  })
}

/// Regular polygon points, first vertex straight up (then turned by `rot` radians), shifted so its
/// bounding box (not its centroid) sits on cx,cy.
pub fn poly(cx: Float, cy: Float, r: Float, sides: Int, rot: Float) -> String {
  let angles =
    upto(sides)
    |> list.map(fn(i) {
      rot -. js.pi() /. 2.0 +. int.to_float(i) *. tau() /. int.to_float(sides)
    })
  let xs = list.map(angles, fn(a) { r *. js.cos(a) })
  let ys = list.map(angles, fn(a) { r *. js.sin(a) })
  let ox = { max(xs) +. min(xs) } /. 2.0
  let oy = { max(ys) +. min(ys) } /. 2.0
  list.map2(xs, ys, fn(x, y) {
    num.n2_text(cx +. x -. ox) <> "," <> num.n2_text(cy +. y -. oy)
  })
  |> string.join(" ")
}
