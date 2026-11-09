// A rail of spaces, one icon each. The icon comes from a hash of the space's
// name (glyphs.js), so the same repo or folder always looks the same. Click to
// switch, right-click for the space menu, hover for the name.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, openOverlay, theme, window, appHome, readTextFile } from "herdr";
import { iconFor, alpha } from "./glyphs.js";

const CELL = 34;
const LOUD = new Set(["blocked", "done", "working"]);

export default class SpaceIcons extends View {
  init(_props, cx) {
    this.overrides = {};
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${appHome()}/mods/space-icons/overrides.json`);
        if (text) {
          const raw = JSON.parse(text);
          this.overrides = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v]));
        }
      } catch (e) {
        console.log(`space-icons: overrides.json: ${e}`);
      }
      cx.notify();
    });
  }

  cell(s, t) {
    const { glyph, color } = iconFor(s.name, this.overrides);
    const ink = color.startsWith("#") ? color : (t[color] ?? t.accent);
    const loud = LOUD.has(s.status);
    return h_flex()
      .id(`space-${s.id}`)
      .relative()
      .w_full()
      .h(CELL + 6)
      .flex_none()
      .justify_center()
      .items_center()
      .cursor_pointer()
      .tooltip(s.machine ? `${s.name} · ${s.machine}` : s.name)
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", () =>
        openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: s.id } } }))
      // Active: a thin bar on the rail's edge.
      .when(s.active, (el) => el.child(div().absolute().left(0).top(11).bottom(11).w(2).rounded(1).bg(t.accent)))
      .child(
        h_flex()
          .relative()
          .size(CELL)
          .rounded(10)
          .justify_center()
          .items_center()
          .text_color(ink)
          .border_1()
          .when(s.active, (el) => el.bg(alpha(ink, 0.24)).border_color(alpha(ink, 0.6)))
          .when(!s.active, (el) => el.bg(alpha(ink, 0.12)).border_color(alpha(ink, 0)).hover((st) => st.bg(alpha(ink, 0.2))))
          .child(svg(`mods/space-icons/icons/${glyph}.svg`).size(17))
          .when(loud, (el) => el.child(
            div().absolute().top(-3).right(-3).size(9).rounded(5).border_2().border_color(t.chrome).bg(t[s.status] ?? t.unknown)
              .when(s.status === "working", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1200 }))))
          .when(Boolean(s.machine), (el) => el.child(
            h_flex().absolute().bottom(-3).right(-3).size(13).rounded(4).bg(t.chrome).justify_center().items_center().text_color(t.muted)
              .child(svg("mods/workspace-chrome/server.svg").size(9)))),
      );
  }

  render() {
    const t = theme();
    const w = window();
    const lights = w?.platform === "macos" && !w?.fullscreen;
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .pt(lights ? 40 : 10)
      .pb(8)
      .child(
        v_flex().flex_1().min_h(0).gap(2).overflow_y_scrollbar()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .children(spaces().map((s) => this.cell(s, t))),
      )
      .child(
        h_flex().flex_none().w_full().justify_center().pt(6)
          .child(
            h_flex().id("space-new").size(CELL).rounded(10).justify_center().items_center()
              .border_1().border_color(t.border).text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .tooltip("New space")
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click(() => run("space.new"))
              .child(svg("mods/workspace-chrome/plus.svg").size(14)),
          ),
      );
  }
}
