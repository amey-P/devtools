// Agent usage: a small strip at the bottom of the sidebar. One row per coding
// agent (Claude, Codex, pi): its icon, a thin bar of the plan limit in use
// (5h window; a tick marks the weekly one), the percent (or today's cost when the
// agent has no plan limit) and a live dot for its agents in Herdr.
// Hover opens a card with the detail; a click pins that detail open inline
// (the block grows with `layout.resize`). Narrower than NARROW it draws as a
// rail of tiles, each with a fill line and a status badge; hover for the card.
//
// Data comes from scan.mjs (Node), run every minute; plan limits every 5 minutes.
// Colors follow the theme: bars go green → amber → red as a limit fills.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, HoverCard } from "gpui-base";
import { agents, run, theme, exec, appHome, nextCommand, settings } from "herdr";

const BLOCK = "usage";            // the layout block this mod lives in
const NARROW = 160;
const ROW = 26;                   // compact row
const PAD = 6;                    // compact strip's top/bottom padding
const TILE = 26;                  // rail tile
const RAIL_GAP = 6;
const TICK_MS = 60_000;
const LIMITS_EVERY = 5;           // ticks
const EXPAND = { duration: 160, easing: "ease-out" };
const GLIDE = { duration: 420, easing: "ease-out" };

const PROVIDERS = [
  { key: "claude", label: "Claude", icon: "icons/claude.svg", brand: "#d97757",
    owns: (a) => a.program?.key === "claude" || (a.app ?? "").startsWith("claude") },
  { key: "codex", label: "Codex", icon: "icons/codex.svg", brand: "#7c8cf8",
    owns: (a) => a.program?.key === "codex" || a.app === "codex" },
  { key: "pi", label: "pi", icon: "icons/pi.svg", brand: "#4fb8b2",
    owns: (a) => a.program?.key === "pi" || a.app === "pi" },
];
const URGENCY = { blocked: 4, done: 3, working: 2, idle: 1 };

const stop = (_e, cx) => cx.stop_propagation();

// "#rrggbb" + alpha → "#rrggbbaa" (same as space-tree's glyphs.js).
function alpha(hex, a) {
  if (typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) return hex;
  return hex.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
}

function fmtTokens(n) {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  return `${(n / 1e9).toFixed(1)}B`;
}
function fmtCost(c) {
  if (!c) return "$0";
  if (c < 0.01) return "<$0.01";
  if (c < 100) return `$${c.toFixed(2)}`;
  return `$${Math.round(c).toLocaleString("en-US")}`;
}
function fmtIn(iso) {
  const ms = Date.parse(iso ?? "") - Date.now();
  if (!(ms > 0)) return "";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function fmtAgo(iso) {
  const s = Math.round((Date.now() - Date.parse(iso ?? "")) / 1000);
  if (!(s >= 0)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Limit color: calm → warning → critical, from the theme's ANSI palette.
const level = (pct, t) => (pct >= 80 ? t.ansi1 : pct >= 50 ? t.ansi3 : t.ansi2);

export default class AgentUsage extends View {
  init(_props, cx) {
    this.width = 248;
    this.detailH = 0;
    this.lastPx = null;
    this.busy = false;
    this.error = null;
    this.ticks = 0;
    this.data = null;
    this.pinned = false;
    try { this.data = JSON.parse(localStorage.getItem("data") ?? "null"); } catch {}
    try { this.pinned = localStorage.getItem("pinned") === "1"; } catch {}
    this.refresh(cx, true);
    cx.timer.every(TICK_MS, (cx) => {
      this.ticks += 1;
      this.refresh(cx, this.ticks % LIMITS_EVERY === 0);
    });
    // Key commands (keys.json: "agent-usage.toggle" / "agent-usage.refresh").
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") this.togglePin(cx);
        else if (c === "refresh") this.refresh(cx, true);
      }
    });
  }

  refresh(cx, limits) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const args = [`${appHome()}/mods/agent-usage/scan.mjs`];
        if (limits) args.push("--limits");
        const r = await exec("node", args, { timeout: 60_000 });
        const next = JSON.parse(r.stdout);
        // Keep the last known limits between limit checks.
        for (const [k, p] of Object.entries(next.providers ?? {})) {
          if (!("limits" in p) && this.data?.providers?.[k]?.limits) p.limits = this.data.providers[k].limits;
        }
        this.data = next;
        this.error = null;
        try { localStorage.setItem("data", JSON.stringify(next)); } catch {}
      } catch (e) {
        this.error = /not found|No such file|ENOENT|spawn/i.test(String(e)) ? "needs Node 18+" : "scan failed";
        console.log(`agent-usage: ${e}`);
      }
      this.busy = false;
      cx.notify();
    });
  }

  togglePin(cx) {
    this.pinned = !this.pinned;
    try { localStorage.setItem("pinned", this.pinned ? "1" : "0"); } catch {}
    cx.notify();
  }

  // ---------------------------------------------------------------- model

  rows() {
    const live = agents();
    const out = [];
    for (const p of PROVIDERS) {
      const d = this.data?.providers?.[p.key] ?? null;
      const mine = live.filter(p.owns);
      const used = (d?.week?.msgs ?? 0) > 0 || d?.limits?.state === "ok";
      if (!used && mine.length === 0) continue;
      const windows = d?.limits?.state === "ok" ? d.limits.windows ?? [] : [];
      const status = mine.reduce((s, a) => ((URGENCY[a.status] ?? 0) > (URGENCY[s] ?? 0) ? a.status : s), null);
      out.push({ ...p, d, agents: mine, windows, primary: windows[0] ?? null,
        weekly: windows.find((w) => w.label === "week") ?? null, status });
    }
    return out;
  }

  // ---------------------------------------------------------------- pieces

  glyph(r, size, t, on = true) {
    return h_flex().flex_none().size(size).rounded(Math.round(size * 0.3)).justify_center().items_center()
      .bg(alpha(r.brand, on ? 0.18 : 0.1)).text_color(r.brand)
      .child(svg(r.icon).size(Math.round(size * 0.62)));
  }

  statusDot(status, t, size = 6) {
    return div().flex_none().size(size).rounded(Math.ceil(size / 2)).bg(t[status] ?? t.unknown)
      .when(status === "working", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1400 }))
      .when(status === "blocked", (d) => d.loop("opacity", { from: 0.3, to: 1, period: 700 }));
  }

  agentDot(a, t) {
    return div().id(`ad-${a.address}`).flex_none().size(7).rounded(4).cursor_pointer()
      .when(a.status === "idle", (d) => d.border_1().border_color(t.idle))
      .when(a.status !== "idle", (d) => d.bg(t[a.status] ?? t.unknown))
      .when(a.status === "working", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1400 }))
      .tooltip(`${a.space_name} · ${a.tab_name || `tab ${a.tab_index}`} · ${a.status}`)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: a.address }); });
  }

  // A thin limit bar; `tick` marks a second window (the weekly one) on the same track.
  bar(id, pct, t, h, tick = null) {
    const p = Math.max(0, Math.min(100, pct ?? 0));
    const color = level(p, t);
    return div().id(id).relative().flex_1().min_w(0).h(h).rounded(h).bg(alpha(t.foreground, 0.08))
      .child(div().id(`${id}-fill`).absolute().left(0).top(0).h(h).rounded(h).bg(color)
        .w(`${p}%`).transition("width", GLIDE)
        .when(p >= 90, (d) => d.loop("opacity", { from: 0.55, to: 1, period: 1600 })))
      .when(tick != null, (el) => el.child(div().absolute().top(-1).h(h + 2).w(2).rounded(1)
        .left(`${Math.max(0, Math.min(98, tick))}%`).bg(alpha(t.foreground, 0.45))));
  }

  // ---------------------------------------------------------------- compact

  compactRow(r, t) {
    const value = r.primary ? `${Math.round(r.primary.pct)}%` : fmtCost(r.d?.today?.cost ?? 0);
    const valueColor = r.primary ? level(r.primary.pct, t) : t.muted;
    return h_flex().id(`row-${r.key}`).h(ROW).flex_none().mx(6).px(6).gap(8).items_center().rounded(6)
      .child(this.glyph(r, 18, t))
      .child(div().flex_none().w(44).truncate().text_size(12).text_color(t.muted).child(r.label))
      .child(r.primary
        ? this.bar(`bar-${r.key}`, r.primary.pct, t, 4, r.weekly && r.weekly !== r.primary ? r.weekly.pct : null)
        : div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
          .child(`${fmtTokens(this.total(r.d?.today))} today`))
      .child(h_flex().flex_none().min_w(34).justify_end().text_size(11.5).text_color(valueColor).child(value))
      .child(div().flex_none().w(6).child(r.status && r.status !== "idle" ? this.statusDot(r.status, t) : div()));
  }

  total(b) { return b ? b.in + b.out + b.cw + b.cr : 0; }

  // ---------------------------------------------------------------- detail

  windowLine(r, w, i, t) {
    const resets = fmtIn(w.resets_at);
    return v_flex().gap(4)
      .child(h_flex().items_center().text_size(11)
        .child(div().flex_1().text_color(t.muted).child(w.label))
        .child(div().text_color(level(w.pct, t)).child(`${Math.round(w.pct)}%`))
        .when(Boolean(resets), (el) => el.child(div().pl(6).text_color(t.dim).child(`· ${resets}`))))
      .child(h_flex().child(this.bar(`win-${r.key}-${i}`, w.pct, t, 5)));
  }

  stat(label, b, estimated, t) {
    return v_flex().flex_1().min_w(0).gap(1)
      .child(div().text_size(10.5).text_color(t.dim).child(label))
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(13).font_medium().text_color(t.foreground).child(fmtTokens(this.total(b))))
        .child(div().text_size(11).text_color(t.muted).child(`${estimated ? "~" : ""}${fmtCost(b?.cost ?? 0)}`)));
  }

  spark(r, t) {
    const days = r.d?.daily ?? [];
    const max = Math.max(1, ...days.map((d) => d.tokens));
    return h_flex().h(24).gap(3).items_end()
      .children(days.map((d, i) => {
        const last = i === days.length - 1;
        return div().id(`sp-${r.key}-${d.day}`).flex_1().rounded(2)
          .h(Math.max(2, Math.round((d.tokens / max) * 24)))
          .bg(alpha(r.brand, last ? 0.9 : d.tokens ? 0.4 : 0.15))
          .tooltip(`${d.day} · ${fmtTokens(d.tokens)} tokens · ${fmtCost(d.cost)}`);
      }));
  }

  limitNote(r, t) {
    const s = r.d?.limits?.state;
    const text = s === "stale" ? "Open Claude to refresh its sign-in for limits"
      : s === "signed-out" ? "Not signed in: no plan limits"
      : s === "error" ? `Limits unavailable (${r.d.limits.error ?? "error"})`
      : null;
    return text ? div().text_size(11).text_color(t.dim).child(text) : null;
  }

  section(r, t) {
    const plan = r.d?.limits?.plan;
    const note = this.limitNote(r, t);
    return v_flex().gap(8)
      .child(h_flex().gap(8).items_center()
        .child(this.glyph(r, 18, t))
        .child(div().text_size(12.5).font_medium().text_color(t.foreground).child(r.label))
        .when(Boolean(plan), (el) => el.child(div().px(5).rounded(4).text_size(10)
          .bg(alpha(r.brand, 0.16)).text_color(r.brand).child(String(plan).toUpperCase())))
        .child(div().flex_1())
        .child(h_flex().gap(4).items_center().children(r.agents.slice(0, 8).map((a) => this.agentDot(a, t)))))
      .children(r.windows.map((w, i) => this.windowLine(r, w, i, t)))
      .when(Boolean(note), (el) => el.child(note))
      .child(h_flex().gap(10)
        .child(this.stat("Today", r.d?.today, r.d?.estimated, t))
        .child(this.stat("7 days", r.d?.week, r.d?.estimated, t)))
      .when((r.d?.daily ?? []).length > 0, (el) => el.child(this.spark(r, t)));
  }

  detail(list, t, idPrefix) {
    return v_flex().gap(12)
      .children(list.flatMap((r, i) => {
        const s = this.section(r, t);
        return i === 0 ? [s] : [div().h(1).w_full().bg(t.border), s];
      }))
      .child(h_flex().items_center().text_size(10.5).text_color(t.dim)
        .child(div().flex_1().child(this.error
          ? this.error
          : `${list.some((r) => r.d?.estimated) ? "~ estimated at API prices · " : ""}${fmtAgo(this.data?.at)}`))
        .child(div().id(`${idPrefix}-refresh`).px(4).rounded(4).cursor_pointer()
          .when(this.busy, (d) => d.loop("opacity", { from: 0.3, to: 1, period: 800 }))
          .hover((s) => s.text_color(t.foreground).bg(t.hover))
          .tooltip("Refresh now")
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.refresh(cx, true); cx.notify(); })
          .child(div().text_size(13).child("↻"))));
  }

  card(list, t, id) {
    return v_flex().w(260).p(12).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_lg()
      .child(this.detail(list, t, id));
  }

  // ---------------------------------------------------------------- views

  resizeTo(px) {
    px = Math.round(px);
    if (px === this.lastPx) return;
    this.lastPx = px;
    run("layout.resize", { id: BLOCK, px });
  }

  wide(list, t) {
    const compactH = PAD * 2 + Math.max(1, list.length) * ROW;
    const open = this.pinned;
    this.resizeTo(compactH + (open ? this.detailH + 8 : 0));

    const strip = v_flex().id("strip").flex_none().py(PAD).cursor_pointer()
      .hover((s) => s.bg(alpha(t.foreground, 0.03)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => this.togglePin(cx))
      .children(list.length ? list.map((r) => this.compactRow(r, t))
        : [h_flex().h(ROW).px(12).text_size(11.5).text_color(t.dim)
          .child(this.error ?? (this.data ? "No agent usage yet" : "Reading usage…"))]);

    const inline = div().id("inline").flex_none().overflow_hidden()
      .h(open ? this.detailH : 0).opacity(open ? 1 : 0)
      .transition("height", EXPAND).transition("opacity", EXPAND)
      .child(v_flex().id("inline-body").flex_none().px(12).pb(8)
        .on_size_change((size, cx) => {
          // Sizes are reported zoomed; .h() and layout.resize take zoom-1 px.
          const h = Math.ceil(size.height / (Number(settings().zoom) || 1));
          if (h !== this.detailH) { this.detailH = h; cx.notify(); }
        })
        .child(this.detail(list, t, "inline")));

    return v_flex().size_full().min_h(0).justify_end()
      .child(inline)
      .child(open || !list.length ? strip
        : HoverCard.new("usage-card").anchor("bottom_left").open_delay(300).close_delay(200)
          .trigger(strip)
          .content(this.card(list, t, "card")));
  }

  rail(list, t) {
    this.resizeTo(PAD * 2 + Math.max(1, list.length) * (TILE + RAIL_GAP) - RAIL_GAP);
    return v_flex().size_full().py(PAD).gap(RAIL_GAP).items_center().justify_end()
      .children(list.map((r) => {
        const pct = r.primary?.pct ?? null;
        const badge = r.status && r.status !== "idle";
        const tile = h_flex().id(`tile-${r.key}`).relative().size(TILE).rounded(8).justify_center().items_center()
          .bg(alpha(r.brand, 0.14)).text_color(r.brand).cursor_pointer().overflow_hidden()
          .hover((s) => s.bg(alpha(r.brand, 0.24)))
          .on_mouse_down("left", stop)
          .child(svg(r.icon).size(15))
          .when(pct != null, (el) => el.child(div().absolute().left(0).bottom(0).w_full().h(3).bg(alpha(t.foreground, 0.08))
            .child(div().id(`tile-fill-${r.key}`).h(3).w(`${Math.max(0, Math.min(100, pct))}%`).bg(level(pct, t))
              .transition("width", GLIDE))))
          .when(badge, (el) => el.child(div().absolute().top(2).right(2).p(1).rounded(4).bg(t.chrome)
            .child(this.statusDot(r.status, t, 5))));
        return HoverCard.new(`rail-card-${r.key}`).anchor("left_center").open_delay(250).close_delay(200)
          .trigger(tile)
          .content(this.card([r], t, `rail-${r.key}`));
      }));
  }

  render() {
    const t = theme();
    const list = this.rows();
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .child(this.width < NARROW ? this.rail(list, t) : this.wide(list, t));
  }
}
