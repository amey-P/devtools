//// Seeded geometric icons: a port of the oracle's geo.js. Same seed, same SVG text, byte for byte.
//// Order matters: every rng draw happens in the same order as in geo.js.

import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import space_icons/hash
import space_icons/js
import space_icons/jstext
import space_icons/num
import space_icons/rng.{type Rng}

/// geo.js `FAMILIES`. Order matters: the seed picks a family by index.
pub const families = ["tiles", "radial", "rings", "stripes", "orbit", "overlap"]

const fade = 0.42

pub type GeoIcon {
  GeoIcon(svg: String, family: String)
}

/// A shape kind as geo.js passes it: `"circle"` or a side count 3..8.
pub type Kind {
  Circle
  Sides(Int)
}

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

/// A filled shape by kind (geo.js `shape`).
pub fn shape(
  kind: Kind,
  cx: Float,
  cy: Float,
  r: Float,
  rot: Float,
  attrs: String,
) -> String {
  case kind {
    Circle ->
      "<circle cx=\""
      <> num.n2_text(cx)
      <> "\" cy=\""
      <> num.n2_text(cy)
      <> "\" r=\""
      <> num.n2_text(r)
      <> "\""
      <> attrs
      <> "/>"
    Sides(sides) ->
      "<polygon points=\""
      <> poly(cx, cy, r, sides, rot)
      <> "\""
      <> attrs
      <> "/>"
  }
}

/// Polygons look smaller than a circle of the same radius; scale them up a touch.
fn optical(kind: Kind) -> Float {
  case kind {
    Circle -> 1.0
    Sides(3) -> 1.22
    Sides(4) -> 1.1
    Sides(_) -> 1.04
  }
}

// --- families ---------------------------------------------------------------

type Tile {
  Sq
  Dot
  Quarter
  Tri
  Half
}

type Cell {
  Cell(k: Option(Tile), q: Int, fade: Bool)
}

/// A 3x3 grid of Bauhaus tiles, mirrored left-right. Up to 12 tries for 5..8 filled cells.
fn tiles(r: Rng) -> #(String, Rng) {
  let #(cells, r) = tiles_try(r, 0, [])
  let c = 7.0
  let o = 1.5
  let body = fn(k) {
    case k {
      Sq ->
        "<rect width=\""
        <> num.text(c)
        <> "\" height=\""
        <> num.text(c)
        <> "\" rx=\"0.8\"/>"
      Dot ->
        "<circle cx=\""
        <> num.text(c /. 2.0)
        <> "\" cy=\""
        <> num.text(c /. 2.0)
        <> "\" r=\""
        <> num.text(c /. 2.0 -. 0.3)
        <> "\"/>"
      Quarter -> {
        let c = num.text(c)
        "<path d=\"M0 0H"
        <> c
        <> "A"
        <> c
        <> " "
        <> c
        <> " 0 0 1 0 "
        <> c
        <> "Z\"/>"
      }
      Tri -> {
        let c = num.text(c)
        "<path d=\"M0 0H" <> c <> "L0 " <> c <> "Z\"/>"
      }
      Half ->
        "<rect width=\""
        <> num.text(c)
        <> "\" height=\""
        <> num.text(c /. 2.0)
        <> "\"/>"
    }
  }
  let svg =
    list.index_map(cells, fn(cell, i) {
      case cell.k {
        None -> ""
        Some(k) -> {
          let row = i / 2
          let col = i % 2
          let y = num.text(o +. int.to_float(row) *. c)
          let half = num.text(c /. 2.0)
          let opacity = case cell.fade {
            True -> " opacity=\"" <> num.text(fade) <> "\""
            False -> ""
          }
          let inner =
            "<g transform=\"rotate("
            <> int.to_string(cell.q * 90)
            <> " "
            <> half
            <> " "
            <> half
            <> ")\""
            <> opacity
            <> ">"
            <> body(k)
            <> "</g>"
          let tile =
            "<g transform=\"translate("
            <> num.text(o +. int.to_float(col) *. c)
            <> " "
            <> y
            <> ")\">"
            <> inner
            <> "</g>"
          case col {
            0 ->
              tile
              <> "<g transform=\"translate("
              <> num.text(o +. 3.0 *. c)
              <> " "
              <> y
              <> ") scale(-1 1)\">"
              <> inner
              <> "</g>"
            _ -> tile
          }
        }
      }
    })
    |> string.concat
  #(svg, r)
}

fn tiles_try(r: Rng, tries: Int, cells: List(Cell)) -> #(List(Cell), Rng) {
  case tries < 12 {
    False -> #(cells, r)
    True -> {
      let #(cells, r) = tiles_cells(r, 0, [])
      let filled =
        list.index_map(cells, fn(c, i) {
          case c.k, i % 2 {
            None, _ -> 0
            Some(_), 0 -> 2
            Some(_), _ -> 1
          }
        })
        |> int.sum
      case filled >= 5 && filled <= 8 {
        True -> #(cells, r)
        False -> tiles_try(r, tries + 1, cells)
      }
    }
  }
}

/// Six cells in row-major order (row 0..2, col 0..1); `acc` is reversed.
fn tiles_cells(r: Rng, i: Int, acc: List(Cell)) -> #(List(Cell), Rng) {
  case i < 6 {
    False -> #(list.reverse(acc), r)
    True -> {
      let col = i % 2
      let #(k, r) = case col {
        0 ->
          rng.pick(r, [
            Some(Sq),
            Some(Dot),
            Some(Quarter),
            Some(Quarter),
            Some(Tri),
            Some(Half),
            None,
          ])
        _ -> rng.pick(r, [Some(Sq), Some(Dot), Some(Half), None])
      }
      let #(q, r) = case col, k {
        1, Some(Half) -> {
          let #(q, r) = rng.int(r, 2)
          #(q * 2, r)
        }
        _, _ -> rng.int(r, 4)
      }
      let #(f, r) = rng.chance(r, 0.18)
      tiles_cells(r, i + 1, [Cell(k, q, f), ..acc])
    }
  }
}

type Petal {
  Leaf
  Wedge
  PetalDot
  Bar
}

type Hub {
  HubDot
  Ring
  Fade
}

/// n petals turned around the centre.
fn radial(r: Rng) -> #(String, Rng) {
  let #(n, r) = rng.pick(r, [3, 4, 5, 6, 8])
  let #(petal, r) = rng.pick(r, [Leaf, Wedge, PetalDot, Bar])
  let #(turn, r) = rng.int(r, 2)
  let nf = int.to_float(n)
  let rot = int.to_float(turn) *. { 180.0 /. nf }
  let narrow = js.sin(js.pi() /. nf)
  let one = case petal {
    Leaf ->
      "<ellipse cx=\"12\" cy=\"6\" rx=\""
      <> num.n2_text(float.min(3.2, 5.6 *. narrow))
      <> "\" ry=\"5\"/>"
    Wedge -> {
      let w = float.min(4.5, 8.5 *. narrow)
      "<path d=\"M12 9.5L"
      <> num.n2_text(12.0 -. w)
      <> " 1.5H"
      <> num.n2_text(12.0 +. w)
      <> "Z\"/>"
    }
    PetalDot ->
      "<circle cx=\"12\" cy=\"4.5\" r=\""
      <> num.n2_text(float.min(3.4, 6.5 *. narrow))
      <> "\"/>"
    Bar -> {
      let w = float.min(2.6, 5.0 *. narrow)
      "<rect x=\""
      <> num.n2_text(12.0 -. w /. 2.0)
      <> "\" y=\"1.5\" width=\""
      <> num.n2_text(w)
      <> "\" height=\"7.5\" rx=\""
      <> num.n2_text(w /. 2.0)
      <> "\"/>"
    }
  }
  let petals =
    upto(n)
    |> list.map(fn(i) {
      "<g transform=\"rotate("
      <> num.n2_text(rot +. int.to_float(i * 360) /. nf)
      <> " 12 12)\">"
      <> one
      <> "</g>"
    })
    |> string.concat
  let #(hub, r) = rng.pick(r, [Some(HubDot), Some(Ring), Some(Fade), None])
  let hub = case hub {
    Some(HubDot) -> "<circle cx=\"12\" cy=\"12\" r=\"2.4\"/>"
    Some(Ring) ->
      "<circle cx=\"12\" cy=\"12\" r=\"2.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/>"
    Some(Fade) ->
      "<circle cx=\"12\" cy=\"12\" r=\"10.5\" opacity=\""
      <> num.text(fade *. 0.5)
      <> "\"/>"
    None -> ""
  }
  #(petals <> hub, r)
}

/// `xs[i]` for an index known to be in range.
fn at(xs: List(a), i: Int) -> a {
  let assert [x, ..] = list.drop(xs, i)
  x
}

/// `xs.indexOf(x)` for an x known to be in xs.
fn index_of(xs: List(a), x: a) -> Int {
  let assert [y, ..rest] = xs
  case y == x {
    True -> 0
    False -> 1 + index_of(rest, x)
  }
}

const outline =
  " fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\""

/// An outlined outer shape holding a different solid one.
fn rings(r: Rng) -> #(String, Rng) {
  let kinds = [Circle, Sides(3), Sides(4), Sides(5), Sides(6), Sides(8)]
  let #(outer, r) = rng.pick(r, kinds)
  let #(inner, r) = rng.pick(r, kinds)
  let #(inner, r) = case inner == outer {
    True -> {
      let #(j, r) = rng.int(r, 5)
      #(at(kinds, { index_of(kinds, inner) + 1 + j } % 6), r)
    }
    False -> #(inner, r)
  }
  // `outer === 4 && r.chance(0.5)`: the draw happens only for a square.
  let #(o_rot, r) = case outer {
    Sides(4) -> {
      let #(turn, r) = rng.chance(r, 0.5)
      case turn {
        True -> #(js.pi() /. 4.0, r)
        False -> #(0.0, r)
      }
    }
    _ -> #(0.0, r)
  }
  let ring_r = 9.6 *. optical(outer)
  let ring = shape(outer, 12.0, 12.0, ring_r, o_rot, outline)
  let #(size, r) = rng.pick(r, [3.6, 4.6])
  let #(turn, r) = rng.int(r, 4)
  let solid =
    shape(
      inner,
      12.0,
      12.0,
      size *. optical(inner),
      int.to_float(turn) *. { js.pi() /. 4.0 },
      "",
    )
  let #(tinted, r) = rng.chance(r, 0.4)
  let tint = case tinted {
    True ->
      shape(
        outer,
        12.0,
        12.0,
        ring_r,
        o_rot,
        " opacity=\"" <> num.text(fade *. 0.5) <> "\"",
      )
    False -> ""
  }
  #(tint <> ring <> solid, r)
}

type Silhouette {
  Plain(Kind)
  Diamond
}

/// A silhouette filled with parallel bands.
fn stripes(r: Rng, id: String) -> #(String, Rng) {
  let #(kind, r) =
    rng.pick(r, [
      Plain(Circle),
      Plain(Sides(6)),
      Plain(Sides(4)),
      Plain(Sides(3)),
      Diamond,
    ])
  let #(k, r) = rng.pick(r, [2, 3, 3, 4])
  let #(angle, r) = rng.pick(r, [0, 45, 90, 135])
  let sil = case kind {
    Diamond -> shape(Sides(4), 12.0, 12.0, 11.0, 0.0, "")
    Plain(Sides(4)) ->
      "<rect x=\"2.5\" y=\"2.5\" width=\"19\" height=\"19\" rx=\"3\"/>"
    Plain(kind) -> shape(kind, 12.0, 12.0, 10.3 *. optical(kind), 0.0, "")
  }
  let w = 24.0 /. int.to_float(2 * k + 1)
  let bands =
    upto(k)
    |> list.map(fn(i) {
      "<rect x=\"-6\" y=\""
      <> num.n2_text(w +. int.to_float(i * 2) *. w)
      <> "\" width=\"36\" height=\""
      <> num.n2_text(w)
      <> "\"/>"
    })
    |> string.concat
  // `sil.replace("/>", ...)`: the first "/>" only (each silhouette has exactly one).
  let assert Ok(#(head, tail)) = string.split_once(sil, "/>")
  let outline =
    head
    <> " fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/>"
    <> tail
  #(
    "<clipPath id=\""
      <> id
      <> "\">"
      <> sil
      <> "</clipPath><g clip-path=\"url(#"
      <> id
      <> ")\"><g transform=\"rotate("
      <> int.to_string(angle)
      <> " 12 12)\">"
      <> bands
      <> "</g></g>"
      <> outline,
    r,
  )
}

type Body {
  Moon
  Solid(Kind)
}

/// A body (often a crescent) with satellites on a track.
fn orbit(r: Rng, id: String) -> #(String, Rng) {
  let #(track, r) = rng.chance(r, 0.5)
  let big_r = case track {
    True -> 6.0
    False -> 7.5
  }
  let #(body, r) =
    rng.pick(r, [Moon, Solid(Circle), Solid(Sides(6)), Solid(Sides(4))])
  let #(body, r) = case body {
    Moon -> {
      let #(step, r) = rng.int(r, 8)
      let a = int.to_float(step) *. { tau() /. 8.0 }
      #(
        "<mask id=\""
          <> id
          <> "\"><rect width=\"24\" height=\"24\" fill=\"#fff\"/><circle cx=\""
          <> num.n2_text(12.0 +. js.cos(a) *. big_r *. 0.75)
          <> "\" cy=\""
          <> num.n2_text(12.0 +. js.sin(a) *. big_r *. 0.75)
          <> "\" r=\""
          <> num.n2_text(big_r *. 0.85)
          <> "\" fill=\"#000\"/></mask>"
          <> "<circle cx=\"12\" cy=\"12\" r=\""
          <> num.text(big_r)
          <> "\" mask=\"url(#"
          <> id
          <> ")\"/>",
        r,
      )
    }
    Solid(kind) -> {
      let rot = case kind {
        Sides(4) -> js.pi() /. 4.0
        _ -> 0.0
      }
      #(shape(kind, 12.0, 12.0, big_r *. optical(kind), rot, ""), r)
    }
  }
  let ring = case track {
    True ->
      "<circle cx=\"12\" cy=\"12\" r=\"9.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" opacity=\""
      <> num.text(fade +. 0.2)
      <> "\"/>"
    False -> ""
  }
  let #(count, r) = rng.pick(r, [1, 2, 3])
  let #(step, r) = rng.int(r, 8)
  let start = int.to_float(step) *. { tau() /. 8.0 }
  let #(d, sat_r) = case track {
    True -> #(9.6, 2.4)
    False -> #(9.4, 2.1)
  }
  let sats =
    upto(count)
    |> list.map(fn(i) {
      let a = start +. int.to_float(i) *. tau() /. int.to_float(count)
      "<circle cx=\""
      <> num.n2_text(12.0 +. js.cos(a) *. d)
      <> "\" cy=\""
      <> num.n2_text(12.0 +. js.sin(a) *. d)
      <> "\" r=\""
      <> num.text(sat_r)
      <> "\"/>"
    })
    |> string.concat
  #(body <> ring <> sats, r)
}

/// Two big shapes offset on a diagonal: one solid, one faded or outlined.
fn overlap(r: Rng) -> #(String, Rng) {
  let kinds = [Circle, Sides(3), Sides(4), Sides(6), Circle]
  let #(a, r) = rng.pick(r, kinds)
  let #(b, r) = rng.pick(r, kinds)
  let #(quadrant, r) = rng.int(r, 4)
  let dir = int.to_float(quadrant) *. { js.pi() /. 2.0 } +. js.pi() /. 4.0
  let dx = js.cos(dir) *. 3.6
  let dy = js.sin(dir) *. 3.6
  let #(faded, r) = rng.chance(r, 0.5)
  let back = case faded {
    True -> " opacity=\"" <> num.text(fade) <> "\""
    False -> outline
  }
  let b_rot = case b {
    Sides(4) -> js.pi() /. 4.0
    _ -> 0.0
  }
  #(
    shape(a, 12.0 -. dx, 12.0 -. dy, 7.0 *. optical(a), 0.0, back)
      <> shape(b, 12.0 +. dx, 12.0 +. dy, 7.0 *. optical(b), b_rot, ""),
    r,
  )
}

// --- entry ------------------------------------------------------------------

/// geo.js `geoIcon`: `seed` is trimmed and lower-cased; a `family` not in `families` (or None) is
/// picked by the seed, which costs one draw.
pub fn geo_icon(seed: String, family: Option(String)) -> GeoIcon {
  let h = hash.fnv1a(jstext.key(seed))
  let r = rng.new(h)
  let #(fam, r) = case family {
    Some(f) ->
      case list.contains(families, f) {
        True -> #(f, r)
        False -> rng.pick(r, families)
      }
    None -> rng.pick(r, families)
  }
  let id = "g" <> js.to_base36(h)
  let #(body, _) = case fam {
    "tiles" -> tiles(r)
    "radial" -> radial(r)
    "rings" -> rings(r)
    "stripes" -> stripes(r, id)
    "orbit" -> orbit(r, id)
    _ -> overlap(r)
  }
  GeoIcon(
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"currentColor\">"
      <> body
      <> "</svg>",
    family: fam,
  )
}

/// The geo cache file name for an icon: `fnv1a(svg).toString(36) + ".svg"` (geocache.js).
pub fn geo_file(seed: String, family: Option(String)) -> String {
  js.to_base36(hash.fnv1a(geo_icon(seed, family).svg)) <> ".svg"
}
