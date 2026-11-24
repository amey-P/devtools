import gleam/dict
import gleam/option.{None, Some}
import space_icons/model.{
  Flags, GeoDirListed, OverridesRead, Snapshot, Space, Window,
}
import space_icons/update
import space_icons/view.{Div, El, Pt, Size, Svg}

const flags = Flags(mod_name: "space-icons-g", app_home: "/HOME")

fn rail(names: List(String)) {
  Snapshot(
    spaces: {
      let mk = fn(n) {
        Space(id: n, name: n, status: "idle", active: False, machine: None)
      }
      case names {
        [] -> []
        [a] -> [mk(a)]
        [a, b, ..] -> [mk(a), mk(b)]
      }
    },
    theme: dict.new(),
    window: Some(Window("macos", False)),
  )
}

fn icon_of(node: view.Node) -> view.Node {
  // root > list > cell > inner > icon
  let assert El(_, _, [El(_, _, [El(_, _, [El(_, _, [icon, ..])])]), ..]) = node
  icon
}

/// While overrides.json is still being read, a pinned name is not pinned yet and nothing is
/// ready: the cell shows the 17 px empty box, as the oracle does before its first notify.
pub fn loading_shows_empty_box_test() {
  let st = update.init(flags).0
  let st = update.update(st, GeoDirListed(Ok([]))).0
  let assert El(Div, [Size(17)], []) = icon_of(view.view(st, rail(["beta"])))
}

/// Once overrides arrive, a pinned glyph is drawn from the mod's own icons folder.
pub fn pinned_glyph_path_test() {
  let st = update.init(flags).0
  let st =
    update.update(
      st,
      OverridesRead(Ok(Some("{\"beta\":{\"glyph\":\"rocket\"}}"))),
    ).0
  let assert El(Svg("mods/space-icons-g/icons/rocket.svg"), [Size(17)], []) =
    icon_of(view.view(st, rail(["beta"])))
}

/// macOS with traffic lights: top padding 40; a null window: 10.
pub fn top_padding_test() {
  let st = update.init(flags).0
  let assert El(_, [_, _, _, Pt(40), ..], _) = view.view(st, rail([]))
  let assert El(_, [_, _, _, Pt(10), ..], _) =
    view.view(st, Snapshot(..rail([]), window: None))
}
