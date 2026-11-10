// One sidebar: spaces as an accordion, each space's tabs as single rows
// ending in one dot per agent. The shown space is always
// expanded; others fold to one line with a status dot and open with the chevron.
// Narrower than NARROW it draws as a "constellation" rail: only the shown
// space keeps a tile, its tabs below as small pills of agent dots; every other
// space is a bare glyph with a status badge. Names, branches and tab lists
// live in hover cards. Same clicks and menus as the tree.
// Motion is native only: expand/collapse, the sliding active bar, springy
// tile/bar growth on the rail, and pulses on working (slow) / blocked (fast).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, HoverCard } from "gpui-base";
import { spaces, agents, panes, run, openOverlay, theme, window, appHome, readTextFile, setAgentOrder } from "herdr";
import { iconFor, alpha } from "./glyphs.js";

/** @import { Theme, Overrides } from "./types" */
/** @import { SpaceInfo, TabInfo, AgentInfo, PaneInfo, Status } from "herdr" */

const ROW = 26;          // tab row height
const SPACE = 30;        // space row height
const MAX_DOTS = 6;
const NARROW = 160;
// Rail ("constellation")
const TILE = 32;         // shown space's tile
const GLYPH = 16;        // other spaces' bare glyph
const GLYPH_BOX = 20;    // their (invisible) tile, so the active one grows from it
const RAIL_ROW = 26;     // an inactive space's row
const PILL = 14;         // a tab's dot cluster
const PILL_GAP = 3;
const PILL_DOTS = 4;
/** @type {import("gpui-shell").TransitionPolicy} */
const EXPAND = { duration: 140, easing: "ease-out" };
/** @type {import("gpui-shell").TransitionPolicy} */
const SLIDE = { duration: 160, easing: "ease-out" };
/** @type {import("gpui-shell").SpringPolicy} */
const SPRING = { response: 260, damping: 0.75 };

/** @param {import("gpui-kit").MouseButtonEvent} _e @param {import("gpui-kit").Context} cx @returns {void} */
const stop = (_e, cx) => cx.stop_propagation();

export default class SpaceTree extends View {
  /** @param {import("gpui-shell").Props | undefined} _props @param {import("gpui-kit").AsyncContext} cx @returns {void} */
  init(_props, cx) {
    /** @type {number} */
    this.width = 248;
    /** @type {Overrides} */
    this.overrides = {};
    /** @type {Record<string, boolean>} */
    this.open = {};
    try { this.open = JSON.parse(localStorage.getItem("open") ?? "{}") ?? {}; } catch { this.open = {}; }
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${appHome()}/mods/space-tree/overrides.json`);
        if (text) {
          const raw = JSON.parse(text);
          this.overrides = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v]));
        }
      } catch (e) {
        console.log(`space-tree: overrides.json: ${e}`);
      }
      cx.notify();
    });
  }

  /** @param {string} id @param {import("gpui-kit").Context} cx @returns {void} */
  toggle(id, cx) {
    this.open[id] = !this.open[id];
    try { localStorage.setItem("open", JSON.stringify(this.open)); } catch {}
    cx.notify();
  }

  /** @param {SpaceInfo} s @param {Theme} t @param {number} size @returns {import("gpui-kit").Element} */
  icon(s, t, size) {
    const { glyph, color } = iconFor(s.name, this.overrides);
    const ink = color.startsWith("#") ? /** @type {import("gpui-kit").Color} */ (color) : (t[color] ?? t.accent);
    return h_flex().flex_none().size(size).rounded(Math.round(size * 0.3)).justify_center().items_center()
      .text_color(ink).bg(alpha(ink, s.active ? 0.24 : 0.12))
      .child(svg(`mods/space-tree/icons/${glyph}.svg`).size(Math.round(size * 0.6)));
  }

  /** @param {AgentInfo} a @param {Theme} t @param {number} [size] @param {string} [key] @returns {import("gpui-kit").Element} */
  dot(a, t, size = 7, key = "dot") {
    const color = t[a.status] ?? t.unknown;
    const idle = a.status === "idle";
    return div()
      .id(`${key}-${a.address}`)
      .flex_none()
      .size(size)
      .rounded(Math.ceil(size / 2))
      .cursor_pointer()
      .when(idle, (d) => d.border_1().border_color(color))
      .when(!idle, (d) => d.bg(color))
      .when(a.status === "working", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1400 }))
      .tooltip(`${a.program?.name ?? a.app ?? "agent"} · ${a.status}${a.title ? ` · ${a.title}` : ""}`)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: a.address }); });
  }

  // A folded space's rollup dot.
  /** @param {Status} status @param {Theme} t @param {number} [size] @returns {import("gpui-kit").Element} */
  statusDot(status, t, size = 7) {
    return div().flex_none().size(size).rounded(Math.ceil(size / 2)).bg(t[status] ?? t.unknown)
      .when(status === "working", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1400 }))
      .when(status === "blocked", (d) => d.loop("opacity", { from: 0.3, to: 1, period: 700 }));
  }

  /** @param {import("gpui-kit").Element} el @param {SpaceInfo} s @returns {import("gpui-kit").Element} */
  spaceMouse(el, s) {
    return el
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        if (e.click_count === 2) run("space.rename", { id: s.id });
        else run("space.select", { id: s.id });
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: s.id } } });
      });
  }

  /** @param {import("gpui-kit").Element} el @param {SpaceInfo} s @param {TabInfo} c @returns {import("gpui-kit").Element} */
  tabMouse(el, s, c) {
    return el
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        if (e.click_count === 2) run("tab.rename", { id: c.id });
        else run("tab.select", { id: c.id });
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: s.id } } });
      });
  }

  /** @param {SpaceInfo} s @param {Theme} t @param {boolean} expanded @param {number} size @returns {import("gpui-kit").Element} */
  chevron(s, t, expanded, size) {
    return h_flex().id(`chev-${s.id}`).flex_none().justify_center().items_center().text_color(t.dim)
      .when(!s.active, (el) => el.hover((st) => st.text_color(t.foreground)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); if (!s.active) this.toggle(s.id, cx); })
      .child(svg(`mods/workspace-chrome/${expanded ? "chevron-down" : "chevron-right"}.svg`).size(size));
  }

  // A space's tabs: folds open/closed, with the active tab's bar sliding between rows.
  /** @param {SpaceInfo} s @param {Theme} t @param {number} rowH @param {number} barLeft @param {import("gpui-kit").Element[]} rows @returns {import("gpui-kit").Element} */
  tabsBody(s, t, rowH, barLeft, rows) {
    const expanded = s.active || Boolean(this.open[s.id]);
    const height = expanded ? rows.length * rowH + 4 : 0;
    const activeIdx = Math.max(0, s.tabs.findIndex((c) => c.active));
    const inset = Math.round(rowH * 0.2);
    return v_flex()
      .id(`tabs-${s.id}`)
      .relative()
      .flex_none()
      .overflow_hidden()
      .h(height)
      .opacity(expanded ? 1 : 0)
      .transition("height", EXPAND)
      .transition("opacity", EXPAND)
      .pt(2)
      .child(div().id(`bar-${s.id}`).absolute().left(barLeft).w(2).h(rowH - 2 * inset).rounded(1)
        .top(2 + activeIdx * rowH + inset).transition("top", SLIDE)
        .bg(s.active ? t.accent : t.border))
      .children(rows);
  }

  /** @param {TabInfo} c @param {PaneInfo[]} allPanes @returns {string} */
  tabLabel(c, allPanes) {
    if (c.named) return c.name;
    const inTab = allPanes.filter((p) => p.tab === c.id);
    const program = inTab.find((p) => p.program?.agent)?.program ?? inTab[0]?.program;
    return program?.name ?? `Tab ${c.index}`;
  }

  /** @param {SpaceInfo} s @param {TabInfo} c @param {AgentInfo[]} list @param {Theme} t @param {PaneInfo[]} allPanes @returns {import("gpui-kit").Element} */
  tabRow(s, c, list, t, allPanes) {
    const selected = c.active && s.active;
    const shown = list.slice(0, MAX_DOTS);
    const extra = list.length - shown.length;
    return this.tabMouse(h_flex()
      .id(`tab-${c.id}`)
      .h(ROW)
      .flex_none()
      .mx(6)
      .pl(56)
      .pr(8)
      .gap(8)
      .items_center()
      .rounded(6)
      .text_size(12.5)
      .cursor_pointer()
      .text_color(selected ? t.foreground : c.active ? t.muted : t.dim)
      .when(selected, (el) => el.bg(t.selected))
      .when(!selected, (el) => el.hover((st) => st.bg(t.hover))), s, c)
      .child(div().flex_1().min_w(0).truncate().child(c.zoomed ? `${this.tabLabel(c, allPanes)} · zoomed` : this.tabLabel(c, allPanes)))
      .child(h_flex().flex_none().gap(4).items_center()
        .children(shown.map((a) => this.dot(a, t)))
        .when(extra > 0, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`+${extra}`))));
  }

  /** @param {SpaceInfo} s @param {Theme} t @param {Map<string, AgentInfo[]>} byTab @param {PaneInfo[]} allPanes @returns {import("gpui-kit").Element} */
  space(s, t, byTab, allPanes) {
    const expanded = s.active || Boolean(this.open[s.id]);
    const header = this.spaceMouse(h_flex()
      .id(`space-${s.id}`)
      .h(SPACE)
      .flex_none()
      .mx(6)
      .px(6)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .text_size(13)
      .text_color(s.active ? t.foreground : t.muted)
      .hover((st) => st.bg(t.hover)), s)
      .child(this.chevron(s, t, expanded, 12).size(14))
      .child(this.icon(s, t, 20))
      .child(div().flex_1().min_w(0).truncate().when(s.active, (el) => el.font_medium()).child(s.name))
      .when(Boolean(s.machine), (el) => el.child(svg("mods/workspace-chrome/server.svg").size(11).flex_none().text_color(t.dim)))
      .when(Boolean(s.branch) && s.active, (el) => el.child(div().flex_none().max_w(90).truncate().text_size(11).text_color(t.dim).child(s.branch)))
      .when(!expanded && Boolean(s.status) && s.status !== "idle", (el) => el.child(this.statusDot(s.status, t)));

    const rows = s.tabs.map((c) => this.tabRow(s, c, byTab.get(c.id) ?? [], t, allPanes));
    return v_flex().flex_none().child(header).child(this.tabsBody(s, t, ROW, 46, rows));
  }

  // Rail: one tab as a pill of its agents' dots (a hollow ring when it has none).
  /** @param {SpaceInfo} s @param {TabInfo} c @param {AgentInfo[]} list @param {Theme} t @param {PaneInfo[]} allPanes @returns {import("gpui-kit").Element} */
  tabCluster(s, c, list, t, allPanes) {
    const selected = c.active;
    const shown = list.slice(0, PILL_DOTS);
    const extra = list.length - shown.length;
    const pill = this.tabMouse(h_flex()
        .id(`tab-${c.id}`)
        .h(PILL)
        .min_w(PILL + 6)
        .px(4)
        .gap(3)
        .justify_center()
        .items_center()
        .rounded(PILL / 2)
        .cursor_pointer()
        .when(selected, (el) => el.bg(t.selected))
        .when(!selected, (el) => el.hover((st) => st.bg(t.hover))), s, c)
        .when(list.length === 0, (el) => el.child(div().flex_none().size(6).rounded(3).border_1()
          .border_color(selected ? t.muted : t.dim)))
        .children(shown.map((a) => this.dot(a, t, 6)))
        .when(extra > 0, (el) => el.child(div().text_size(8).line_height(8).text_color(t.dim).child(`+${extra}`)));
    return h_flex().w_full().h(PILL).flex_none().justify_center().items_center().child(
      HoverCard.new(`card-${c.id}`).anchor("left_center").open_delay(250).close_delay(200)
        .trigger(pill)
        .content(this.tabCard(s, c, list, t, allPanes)));
  }

  // Rail hover on a space: its name and where it lives, then every tab (clickable).
  /** @param {SpaceInfo} s @param {Theme} t @param {Map<string, AgentInfo[]>} byTab @param {PaneInfo[]} allPanes @returns {import("gpui-kit").Element} */
  spaceCard(s, t, byTab, allPanes) {
    const where = [s.branch, s.machine].filter(Boolean).join(" · ");
    return v_flex().w(220).p(8).gap(6).rounded(10).bg(t.popover).border_1().border_color(t.border)
      .shadow_lg().text_size(12.5)
      .child(this.spaceMouse(h_flex().id(`scard-${s.id}`).gap(8).items_center().min_w(0).cursor_pointer(), s)
        .child(this.icon(s, t, 18))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_medium().text_color(t.foreground).child(s.name))
          .when(Boolean(where), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(where)))))
      .when(s.tabs.length > 0, (el) => el.child(div().h(1).w_full().bg(t.border)))
      .children(s.tabs.map((c) => {
        const list = byTab.get(c.id) ?? [];
        const label = this.tabLabel(c, allPanes);
        const on = c.active && s.active;
        return this.tabMouse(h_flex().id(`scard-tab-${c.id}`).h(22).px(4).gap(8).items_center().rounded(5)
          .cursor_pointer().text_color(on ? t.foreground : t.muted)
          .when(on, (r) => r.bg(t.selected))
          .when(!on, (r) => r.hover((st) => st.bg(t.hover).text_color(t.foreground))), s, c)
          .child(c.status
            ? this.statusDot(c.status, t, 6)
            : div().flex_none().size(6).rounded(3).border_1().border_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().child(c.zoomed ? `${label} · zoomed` : label))
          .when(list.length > 0, (r) => r.child(div().flex_none().text_size(11).text_color(t.dim).child(String(list.length))));
      }));
  }

  // Rail hover: the tab's agents, then its name. Clicks work as in the tree.
  /** @param {SpaceInfo} s @param {TabInfo} c @param {AgentInfo[]} list @param {Theme} t @param {PaneInfo[]} allPanes @returns {import("gpui-kit").Element} */
  tabCard(s, c, list, t, allPanes) {
    const label = this.tabLabel(c, allPanes);
    return v_flex().w(220).p(8).gap(6).rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5)
      .children(list.map((a) => h_flex().gap(8).items_center().min_w(0)
        .child(this.dot(a, t, 8, "card-dot"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(a.program?.name ?? a.app ?? "agent"))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(a.status))))
      .child(this.tabMouse(div().id(`card-tab-${c.id}`).truncate().cursor_pointer()
        .text_size(list.length ? 11.5 : 12.5).text_color(list.length ? t.muted : t.foreground)
        .hover((st) => st.text_color(t.foreground))
        .child(c.zoomed ? `${label} · zoomed` : label), s, c));
  }

  // Rail: the shown space is a tile over its constellation of tab pills; the rest
  // are bare glyphs with a status badge. Ids stay put across states so the tile,
  // row and accent bar spring between them.
  /** @param {SpaceInfo} s @param {Theme} t @param {Map<string, AgentInfo[]>} byTab @param {PaneInfo[]} allPanes @returns {import("gpui-kit").Element} */
  rail(s, t, byTab, allPanes) {
    const on = s.active;
    const { glyph, color } = iconFor(s.name, this.overrides);
    const ink = color.startsWith("#") ? /** @type {import("gpui-kit").Color} */ (color) : (t[color] ?? t.accent);
    const rowH = on ? TILE + 8 : RAIL_ROW;
    const box = on ? TILE : GLYPH_BOX;
    const badge = !on && Boolean(s.status) && s.status !== "idle";

    const tile = this.spaceMouse(h_flex()
      .id(`rail-tile-${s.id}`)
      .relative()
      .flex_none()
      .w(box).h(box)
      .spring("width", SPRING).spring("height", SPRING)
      .rounded(on ? 10 : 6)
      .justify_center().items_center()
      .cursor_pointer()
      .text_color(on ? ink : alpha(ink, 0.6))
      .when(on, (el) => el.bg(alpha(ink, 0.2)).border_1().border_color(alpha(ink, 0.45)).shadow_sm())
      .when(!on, (el) => el.hover((st) => st.text_color(ink).bg(alpha(ink, 0.12)))), s)
      .child(svg(`mods/space-tree/icons/${glyph}.svg`).size(on ? 19 : GLYPH))
      .when(badge, (el) => el.child(div().absolute().top(-1).right(-2).p(1).rounded(4).bg(t.chrome)
        .child(this.statusDot(s.status, t, 5))));

    const header = h_flex().id(`rail-${s.id}`).relative().w_full().flex_none()
      .h(rowH).spring("height", SPRING)
      .justify_center().items_center()
      .child(div().id(`rail-bar-${s.id}`).absolute().left(0).w(2).rounded(1).bg(t.accent)
        .h(on ? TILE - 8 : 0).top(on ? 8 : rowH / 2).opacity(on ? 1 : 0)
        .spring("height", SPRING).spring("top", SPRING).transition("opacity", EXPAND))
      .child(HoverCard.new(`rail-card-${s.id}`).anchor("left_center").open_delay(250).close_delay(200)
        .trigger(tile)
        .content(this.spaceCard(s, t, byTab, allPanes)));

    const n = s.tabs.length;
    const stars = v_flex()
      .id(`stars-${s.id}`)
      .flex_none()
      .overflow_hidden()
      .items_center()
      .gap(PILL_GAP)
      .pt(2)
      .h(on && n ? n * (PILL + PILL_GAP) + 4 : 0)
      .opacity(on ? 1 : 0)
      .transition("height", EXPAND)
      .transition("opacity", EXPAND)
      .children(s.tabs.map((c) => this.tabCluster(s, c, byTab.get(c.id) ?? [], t, allPanes)));

    return v_flex().flex_none().child(header).child(stars);
  }

  render() {
    const t = theme();
    const w = window();
    const lights = w?.platform === "macos" && !w?.fullscreen;
    const all = spaces();
    const allAgents = agents();
    const allPanes = panes();

    /** @type {Map<string, AgentInfo[]>} */
    const byTab = new Map();
    for (const a of allAgents) {
      if (!byTab.has(a.tab)) byTab.set(a.tab, []);
      byTab.get(a.tab).push(a);
    }
    // agent.next / agent.prev follow the tree.
    setAgentOrder(all.flatMap((s) => s.tabs.flatMap((c) => (byTab.get(c.id) ?? []).map((a) => a.address))));

    const narrow = this.width < NARROW;
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .pt(lights ? 40 : 10)
      .pb(8)
      .child(
        v_flex().id("tree").flex_1().min_h(0).gap(2).overflow_y_scrollbar()
          .on_mouse_down("left", stop)
          .children(all.map((s) => (narrow ? this.rail(s, t, byTab, allPanes) : this.space(s, t, byTab, allPanes)))),
      )
      // The rail keeps only a ghosted plus.
      .when(narrow, (root) => root.child(
        h_flex().id("space-new").flex_none().h(SPACE).mt(4).w_full().justify_center().items_center()
          .text_color(alpha(t.dim, 0.5)).cursor_pointer()
          .hover((st) => st.text_color(t.foreground))
          .tooltip("New space")
          .on_mouse_down("left", stop)
          .on_click(() => run("space.new"))
          .child(svg("mods/workspace-chrome/plus.svg").size(13)),
      ))
      .when(!narrow, (root) => root.child(
        h_flex().id("space-new").flex_none().h(SPACE).mx(6).mt(4).px(6).gap(8)
          .items_center().rounded(6).text_size(12.5).text_color(t.dim).cursor_pointer()
          .hover((st) => st.bg(t.hover).text_color(t.foreground))
          .tooltip("New space")
          .on_mouse_down("left", stop)
          .on_click(() => run("space.new"))
          .child(svg("mods/workspace-chrome/plus.svg").size(13))
          .child("space"),
      ));
  }
}
