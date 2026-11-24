//// The rail as data: a port of the oracle's main.js `render` and `cell`. Each `Attr` is one GPUI
//// builder call and the shell makes them in list order, so the order here is the oracle's order.
//// A `.when(c, f)` becomes a list that is appended only when `c` holds.
////
//// I6: an `Svg` shows a geo file only when the folder listing (or a landed write) put it in
//// `ready`; a pinned Lucide glyph and the two chrome icons are the only other paths.

import gleam/dict.{type Dict}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/set
import space_icons/glyphs
import space_icons/model.{
  type Event, type Snapshot, type Space, type State, ClickedNewSpace,
  ClickedSpace, DirListed, DirUnknown, OverridesLoading, OverridesReady,
  RightClickedSpace, Window,
}
import space_icons/update

pub type Node {
  El(kind: Kind, attrs: List(Attr), children: List(Node))
}

pub type Kind {
  HFlex
  VFlex
  Div
  Svg(path: String)
}

/// A theme color: `None` when the theme has no such key (the oracle then passes `undefined`).
pub type Color =
  Option(String)

/// Only the builder calls main.js makes.
pub type Attr {
  Id(String)
  Relative
  Absolute
  WFull
  SizeFull
  MinH(Int)
  H(Int)
  Size(Int)
  FlexNone
  Flex1
  Top(Int)
  Bottom(Int)
  Left(Int)
  Right(Int)
  W(Int)
  Pt(Int)
  Pb(Int)
  Gap(Int)
  Rounded(Int)
  Bg(Color)
  Border1
  Border2
  BorderColor(Color)
  TextColor(Color)
  JustifyCenter
  ItemsCenter
  CursorPointer
  OverflowYScrollbar
  Tooltip(String)
  /// `.hover((st) => st...)`: the style calls, in order.
  Hover(List(Attr))
  /// `.loop("opacity", { from, to, period })`
  LoopOpacity(from: Float, to: Float, period: Int)
  /// `.on_click(() => …)`: the event goes to `update`.
  OnClick(Event)
  /// `.on_mouse_down("right", () => …)`
  OnRightDown(Event)
  /// `.on_mouse_down("left", (_e, cx) => cx.stop_propagation())`
  StopLeftDown
}

const cell_size = 34

const server_svg = "mods/workspace-chrome/server.svg"

const plus_svg = "mods/workspace-chrome/plus.svg"

/// main.js `render()`.
pub fn view(state: State, snapshot: Snapshot) -> Node {
  let t = snapshot.theme
  // `w?.platform === "macos" && !w?.fullscreen`
  let lights = case snapshot.window {
    Some(Window(platform: "macos", fullscreen: False)) -> True
    Some(Window(..)) | None -> False
  }
  let overrides = case state.overrides {
    OverridesLoading -> glyphs.no_overrides()
    OverridesReady(o) -> o
  }
  El(
    VFlex,
    [
      SizeFull,
      MinH(0),
      Bg(color(t, "chrome")),
      Pt(case lights {
        True -> 40
        False -> 10
      }),
      Pb(8),
    ],
    [
      El(
        VFlex,
        [Flex1, MinH(0), Gap(2), OverflowYScrollbar, StopLeftDown],
        list.map(snapshot.spaces, cell(state, overrides, t, _)),
      ),
      El(HFlex, [FlexNone, WFull, JustifyCenter, Pt(6)], [
        El(
          HFlex,
          [
            Id("space-new"),
            Size(cell_size),
            Rounded(10),
            JustifyCenter,
            ItemsCenter,
            Border1,
            BorderColor(color(t, "border")),
            TextColor(color(t, "dim")),
            Hover([Bg(color(t, "hover")), TextColor(color(t, "foreground"))]),
            Tooltip("New space"),
            StopLeftDown,
            OnClick(ClickedNewSpace),
          ],
          [El(Svg(plus_svg), [Size(14)], [])],
        ),
      ]),
    ],
  )
}

/// main.js `cell(s, t)`.
fn cell(
  state: State,
  overrides: glyphs.Overrides,
  t: Dict(String, String),
  s: Space,
) -> Node {
  // `s.machine ? … : …` and `Boolean(s.machine)`: an empty string counts as no machine.
  let machine = case s.machine {
    Some("") | None -> None
    Some(m) -> Some(m)
  }
  let loud =
    s.status == "blocked" || s.status == "done" || s.status == "working"
  let active_bar = case s.active {
    True -> [
      El(
        Div,
        [
          Absolute,
          Left(0),
          Top(11),
          Bottom(11),
          W(2),
          Rounded(1),
          Bg(color(t, "accent")),
        ],
        [],
      ),
    ]
    False -> []
  }
  let look = case s.active {
    True -> [Bg(color(t, "selected")), BorderColor(color(t, "border"))]
    False -> [
      Bg(color(t, "surface")),
      BorderColor(color(t, "surface")),
      Hover([Bg(color(t, "hover")), TextColor(color(t, "foreground"))]),
    ]
  }
  let icon = case icon_path(state, overrides, s.name) {
    Some(path) -> El(Svg(path), [Size(17)], [])
    None -> El(Div, [Size(17)], [])
  }
  let dot = case loud {
    True -> [
      El(
        Div,
        list.append(
          [
            Absolute,
            Top(-3),
            Right(-3),
            Size(9),
            Rounded(5),
            Border2,
            BorderColor(color(t, "chrome")),
            // `t[s.status] ?? t.unknown`
            Bg(option.or(color(t, s.status), color(t, "unknown"))),
          ],
          case s.status == "working" {
            True -> [LoopOpacity(from: 0.35, to: 1.0, period: 1200)]
            False -> []
          },
        ),
        [],
      ),
    ]
    False -> []
  }
  let badge = case machine {
    Some(..) -> [
      El(
        HFlex,
        [
          Absolute,
          Bottom(-3),
          Right(-3),
          Size(13),
          Rounded(4),
          Bg(color(t, "chrome")),
          JustifyCenter,
          ItemsCenter,
          TextColor(color(t, "muted")),
        ],
        [El(Svg(server_svg), [Size(9)], [])],
      ),
    ]
    None -> []
  }
  let inner =
    El(
      HFlex,
      list.flatten([
        [
          Relative,
          Size(cell_size),
          Rounded(10),
          JustifyCenter,
          ItemsCenter,
          TextColor(case s.active {
            True -> color(t, "foreground")
            False -> color(t, "muted")
          }),
          Border1,
        ],
        look,
      ]),
      list.flatten([[icon], dot, badge]),
    )
  El(
    HFlex,
    [
      Id("space-" <> s.id),
      Relative,
      WFull,
      H(cell_size + 6),
      FlexNone,
      JustifyCenter,
      ItemsCenter,
      CursorPointer,
      Tooltip(case machine {
        Some(m) -> s.name <> " · " <> m
        None -> s.name
      }),
      OnClick(ClickedSpace(s.id)),
      OnRightDown(RightClickedSpace(s.id)),
    ],
    list.append(active_bar, [inner]),
  )
}

/// A pinned Lucide icon, else the geometric one once it is on disk (`None`: an empty box).
pub fn icon_path(
  state: State,
  overrides: glyphs.Overrides,
  name: String,
) -> Option(String) {
  let icon = glyphs.icon_for(name, overrides)
  case icon.glyph {
    Some(g) -> Some("mods/" <> state.flags.mod_name <> "/icons/" <> g <> ".svg")
    None -> {
      let gf = update.geo_file_for(state, icon.seed, icon.family)
      case state.geo {
        DirListed(ready) ->
          case set.contains(ready, gf.file) {
            True -> Some(update.geo_rel(state.flags) <> "/" <> gf.file)
            False -> None
          }
        DirUnknown -> None
      }
    }
  }
}

fn color(t: Dict(String, String), key: String) -> Color {
  option.from_result(dict.get(t, key))
}
