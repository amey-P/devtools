//// A space's icon from its name: a port of the oracle's glyphs.js (`GLYPHS`, `iconFor`) and of the
//// overrides.json decoding in main.js's init. Repo HEAD has no colors (docs/decisions.md D1, D2).

import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import space_icons/jstext

/// 64 Lucide icons (icons/<name>.svg, ISC). Order matters: an override's index picks from it. Append only.
pub const glyphs = [
  "rocket", "cat", "dog", "fish", "bird", "turtle", "rabbit", "squirrel", "snail", "rat", "bug", "anchor",
  "leaf", "tree-pine", "flower-2", "sprout", "shell", "mountain", "flame", "snowflake", "moon", "sun",
  "cloud", "zap", "droplet", "star", "heart", "crown", "ghost", "skull", "bot", "gem", "key", "bell",
  "umbrella", "guitar", "music", "coffee", "pizza", "ice-cream-cone", "apple", "carrot", "cherry", "plane",
  "car", "bike", "sailboat", "train-front", "book-open", "hammer", "wrench", "compass", "puzzle",
  "gamepad-2", "lightbulb", "magnet", "bomb", "trophy", "flag", "shield", "feather", "palette", "telescope",
  "tent",
]

/// One overrides.json entry, already validated: invalid fields are None (the oracle ignores them).
pub type Override {
  Override(glyph: Option(String), seed: Option(String), family: Option(String))
}

/// Lowercase, trimmed space name -> its override.
pub type Overrides =
  Dict(String, Override)

pub type Icon {
  /// `glyph`: a pinned Lucide icon, else None (a geometric icon from `seed`, maybe a forced `family`).
  Icon(glyph: Option(String), seed: String, family: Option(String))
}

pub fn no_overrides() -> Overrides {
  dict.new()
}

/// `iconFor(name, overrides)`
pub fn icon_for(name: String, overrides: Overrides) -> Icon {
  let key = jstext.key(name)
  case dict.get(overrides, key) {
    Error(Nil) -> Icon(glyph: None, seed: key, family: None)
    Ok(o) -> Icon(glyph: o.glyph, seed: option.unwrap(o.seed, key), family: o.family)
  }
}

/// overrides.json text -> overrides, or the reason to log. Mirrors main.js:
/// `Object.fromEntries(Object.entries(JSON.parse(text)).map(([k, v]) => [k.trim().toLowerCase(), v]))`.
/// Empty text is "no overrides" (the oracle's `if (text)`).
pub fn decode_overrides(text: String) -> Result(Overrides, String) {
  case text {
    "" -> Ok(no_overrides())
    _ ->
      case json.parse(text, decode.dynamic) {
        Error(e) -> Error("SyntaxError: " <> parse_error(e))
        Ok(root) ->
          case root_entries(root) {
            Error(reason) -> Error(reason)
            Ok(entries) ->
              Ok(
                list.fold(entries, no_overrides(), fn(acc, entry) {
                  dict.insert(acc, jstext.key(entry.0), to_override(entry.1))
                }),
              )
          }
      }
  }
}

fn parse_error(e: json.DecodeError) -> String {
  case e {
    json.UnexpectedEndOfInput -> "unexpected end of JSON input"
    json.UnexpectedByte(b) -> "unexpected byte " <> b
    json.UnexpectedSequence(s) -> "unexpected sequence " <> s
    json.UnableToDecode(_) -> "unable to decode"
  }
}

/// `Object.entries(root)`, in order. A string root gives per-character entries whose values are
/// strings, which have no fields, so it is the same as no entries.
fn root_entries(root: Dynamic) -> Result(List(#(String, Dynamic)), String) {
  case decode.run(root, decode.dict(decode.string, decode.dynamic)) {
    // TODO(phase 4 gate): a Dict loses JS property order, which only matters when two keys
    // normalize to the same name. See docs/decisions.md.
    Ok(d) -> Ok(dict.to_list(d))
    Error(_) ->
      case decode.run(root, decode.list(decode.dynamic)) {
        Ok(xs) -> Ok(list.index_map(xs, fn(x, i) { #(int.to_string(i), x) }))
        Error(_) ->
          case dynamic.classify(root) {
            "Nil" -> Error("TypeError: Cannot convert undefined or null to object")
            _ -> Ok([])
          }
      }
  }
}

/// One entry's value. Only a plain object can carry fields; anything else (null, a number, a
/// string, an array) is an override with no effect, which still replaces an earlier entry.
fn to_override(v: Dynamic) -> Override {
  case decode.run(v, decode.dict(decode.string, decode.dynamic)) {
    Error(_) -> Override(None, None, None)
    Ok(fields) ->
      Override(
        glyph: field(fields, "glyph", glyph),
        seed: field(fields, "seed", seed),
        family: field(fields, "family", family),
      )
  }
}

fn field(fields: Dict(String, Dynamic), name: String, f: fn(Dynamic) -> Option(String)) -> Option(String) {
  case dict.get(fields, name) {
    Ok(v) -> f(v)
    Error(Nil) -> None
  }
}

/// `typeof g === "number" && GLYPHS[g]`, else `typeof g === "string" && GLYPHS.includes(g)`.
fn glyph(v: Dynamic) -> Option(String) {
  case decode.run(v, decode.int) {
    Ok(i) ->
      case i >= 0 {
        True -> list.drop(glyphs, i) |> list.first |> option.from_result
        False -> None
      }
    Error(_) ->
      case decode.run(v, decode.string) {
        Ok(name) ->
          case list.contains(glyphs, name) {
            True -> Some(name)
            False -> None
          }
        Error(_) -> None
      }
  }
}

/// `typeof s === "string" && s.trim()`: kept untrimmed.
fn seed(v: Dynamic) -> Option(String) {
  case decode.run(v, decode.string) {
    Ok(s) ->
      case jstext.js_trim(s) {
        "" -> None
        _ -> Some(s)
      }
    Error(_) -> None
  }
}

/// `typeof f === "string" && f`
fn family(v: Dynamic) -> Option(String) {
  case decode.run(v, decode.string) {
    Ok("") | Error(_) -> None
    Ok(f) -> Some(f)
  }
}
