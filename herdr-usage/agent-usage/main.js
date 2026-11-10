// Agent usage: a small strip at the bottom of the sidebar. One row per tracked
// service (Claude, Codex, pi, OpenCode Go — see services.json): its icon, a thin
// bar of the limit in use (5h window; ticks mark the other windows), the percent
// (or today's cost when the service reports no limits) and a live dot for its
// agents in Herdr. Each service can be hidden from the card's switch; enabled /
// in-strip and the scan cadence are the settings screen (ctrl-shift-u, ⚙ in the
// card). Both write <app home>/data/agent-usage/config.json through
// config.updateConfig; this file reads it (config.js holds the rules) and tells
// scan.mjs which services to scan (--services) — the scanner never reads it.
// Hover opens a card with the detail; a click pins that detail open inline
// (the block grows with `layout.resize`). Narrower than NARROW it draws as a
// rail of tiles, each with a fill line and a status badge; hover for the card.
//
// Data comes from scan.mjs (Node), run every `scan.everyMinutes`; limits every
// `scan.limitsEveryMinutes`. Colors follow the theme: bars go green → amber →
// red as a limit fills.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, HoverCard } from "gpui-base";
import * as fs from "fs/promises";
import {
  agents, run, theme, exec, appHome, nextCommand, settings, readTextFile, writeTextFile, watchFolder, openOverlay,
  props, setShared,
} from "herdr";
import { Settings } from "./settings.js";
import * as cfg from "./config.js";

/** @import {LimitWindow, ProviderMeta, ProviderUsage, RawConfig, Theme, Totals} from "./types" */

/** One `rows()` entry: the effective service (key/label/icon/brand/matchers from services.json or
 *  the scan's meta, merged with the person's config) plus what scan.mjs reported for it. */
/** @typedef {{ key: string, label: string, icon?: string | null, brand?: import("gpui-kit").Color | null, program?: string | null, apps?: string[], api: boolean, enabled: boolean, hidden: boolean, d: ProviderUsage | null, agents: import("herdr").AgentInfo[], windows: LimitWindow[], primary: LimitWindow | null, weekly: LimitWindow | null, status: import("herdr").Status | null }} Row */

const BLOCK = "usage";            // the layout block this mod lives in
const NARROW = 160;
const ROW = 26;                   // compact row
const PAD = 6;                    // compact strip's top/bottom padding
const TILE = 26;                  // rail tile
const RAIL_GAP = 6;
const CHECK_MS = 30_000;          // how often the cadence timer checks what's due
/** @type {import("gpui-shell").TransitionPolicy} */
const EXPAND = { duration: 160, easing: "ease-out" };
/** @type {import("gpui-shell").TransitionPolicy} */
const GLIDE = { duration: 420, easing: "ease-out" };

// Row metadata (label/icon/brand and the live-agent matchers) comes from
// services.json, read here (config.parseServices; config.DEFAULT_SERVICES when
// it can't be read). Edit that file to swap services in or out.

// A live agent belongs to a service when its program key or app name matches.
/** @param {import("herdr").AgentInfo} a @param {{ program?: string | null, apps?: string[] }} m @returns {boolean} */
const owns = (a, m) => {
  const app = a.app ?? "";
  return (m.program && (a.program?.key === m.program || app.startsWith(m.program)))
    || (m.apps ?? []).includes(app);
};
const URGENCY = { blocked: 4, done: 3, working: 2, idle: 1 };

/** @param {import("gpui-kit").MouseButtonEvent} _e @param {import("gpui-kit").Context} cx */
const stop = (_e, cx) => cx.stop_propagation();

// "#rrggbb" + alpha → "#rrggbbaa" (same as space-tree's glyphs.js).
/** @param {import("gpui-kit").Color | null} hex @param {number} a @returns {import("gpui-kit").Color | null} */
function alpha(hex, a) {
  if (typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) return hex;
  return /** @type {import("gpui-kit").Color} */ (hex.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0"));
}

/** @param {number} n @returns {string} */
function fmtTokens(n) {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  return `${(n / 1e9).toFixed(1)}B`;
}
/** @param {number} c @returns {string} */
function fmtCost(c) {
  if (!c) return "$0";
  if (c < 0.01) return "<$0.01";
  if (c < 100) return `$${c.toFixed(2)}`;
  return `$${Math.round(c).toLocaleString("en-US")}`;
}
/** ISO time → time left ("3h 20m"), "" once the window has reset.
 *  @param {string | null} iso @returns {string}
 */
function fmtIn(iso) {
  const ms = Date.parse(iso ?? "") - Date.now();
  if (!(ms > 0)) return "";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
/** ISO time → "just now" / "5m ago" / "2h ago", "" before the first scan (this.data?.at is
 *  undefined until then).
 *  @param {string | null | undefined} iso @returns {string}
 */
function fmtAgo(iso) {
  const s = Math.round((Date.now() - Date.parse(iso ?? "")) / 1000);
  if (!(s >= 0)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Limit color: calm → warning → critical, from the theme's ANSI palette.
/** @param {number} pct @param {Theme} t @returns {import("gpui-kit").Color} */
const level = (pct, t) => (pct >= 80 ? t.ansi1 : pct >= 50 ? t.ansi3 : t.ansi2);

export default class AgentUsage extends View {
  /**
   * @param {import("gpui-shell").Props | undefined} _props
   * @param {import("gpui-kit").AsyncContext} cx
   */
  init(_props, cx) {
    // The settings screen, in one floating window (mods/usage-settings, ⚙ in the card): this copy
    // renders it instead of the strip and stays out of the widget's work below.
    const p = props() ?? {};
    if (p.settings && p.float) { this.settings = new Settings(p.overlay, cx); return; }
    /** @type {number} */
    this.width = 248;
    /** @type {number} */
    this.detailH = 0;
    this.lastPx = null;
    this.busy = false;
    this.error = null;
    this.data = null;
    this.pinned = false;
    this.pending = null;          // a refresh asked for while one ran: null | { limits }
    this.cfgPath = cfg.configPath(appHome());
    this.cfgDir = cfg.configDir(appHome());
    this.io = { readTextFile, writeTextFile, mkdir: fs.mkdir };
    this.cfgError = null;
    this.writeError = null;
    this.services = cfg.DEFAULT_SERVICES;
    /** @type {RawConfig} */
    this.raw = {};                // last config.json that parsed
    try { this.data = JSON.parse(localStorage.getItem("data") ?? "null"); } catch {}
    try { this.pinned = localStorage.getItem("pinned") === "1"; } catch {}
    // Services hidden from the strip used to live in localStorage; until migrateHidden has moved
    // them into config.json, keep honoring them so the strip doesn't flash them back on.
    /** @type {string[]} */
    this.legacyHidden = [];
    try {
      const legacy = JSON.parse(localStorage.getItem("hidden") ?? "null");
      if (Array.isArray(legacy)) this.legacyHidden = legacy.filter((k) => typeof k === "string");
    } catch {}
    this.cfg = this.computeCfg();
    this.lastScanAt = 0;
    this.lastLimitsAt = 0;
    // The first scan waits for the config, so disabled services are never scanned.
    cx.spawn(async (cx) => {
      await this.reloadConfig();
      await this.migrateHidden();
      this.refresh(cx, true);
      cx.notify();
    });
    cx.timer.every(CHECK_MS, (cx) => {
      // Slack of half a check: the timer drifts, and "59.9 s since" shouldn't wait 30 s more.
      const now = Date.now();
      /** @param {number} last @param {number} min @returns {boolean} */
      const due = (last, min) => now - last >= min * 60_000 - CHECK_MS / 2;
      const scan = due(this.lastScanAt, this.cfg.scan.everyMinutes);
      const limits = due(this.lastLimitsAt, this.cfg.scan.limitsEveryMinutes);
      if (scan || limits) this.refresh(cx, limits);
    });
    // The settings screen (and a hand edit) change config.json: follow along live.
    cx.spawn(async (cx) => {
      for (;;) {
        let changed;
        try { await fs.mkdir(this.cfgDir, { recursive: true }); changed = await watchFolder(this.cfgDir); }
        catch (e) { console.log(`agent-usage: config watch stopped: ${e}`); return; }
        if (!changed.some((p) => String(p).endsWith("config.json"))) continue; // store.json churns every scan
        const before = this.enabledKeys().join(",");
        await this.reloadConfig();
        if (this.enabledKeys().join(",") !== before) this.refresh(cx, true);
        cx.notify();
      }
    });
    // Key commands (keys.json: "agent-usage.toggle" / "agent-usage.refresh"; the settings screen
    // asks for a refresh through "agent-usage.refresh" after it saves).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") this.togglePin(cx);
        else if (c === "refresh") this.refresh(cx, true);
      }
    });
  }

  /** Effective config: the last good config.json + any not-yet-migrated legacy hidden list. */
  computeCfg() {
    const c = cfg.effective(this.services, this.raw);
    for (const k of this.legacyHidden) {
      const s = c.services[k];
      if (s && typeof this.raw?.services?.[k]?.hidden !== "boolean") s.hidden = true;
    }
    return c;
  }

  /** Re-reads services.json and config.json. A broken config.json keeps the last good one (and says so). */
  async reloadConfig() {
    try {
      const [svcText, rawText] = await Promise.all([
        readTextFile(`${appHome()}/mods/agent-usage/services.json`),
        readTextFile(this.cfgPath),
      ]);
      this.services = cfg.parseServices(svcText);
      const parsed = cfg.parseRaw(rawText);
      this.cfgError = parsed.error ?? null;
      if (!parsed.error) this.raw = parsed.value;
    } catch (e) {
      this.cfgError = String(e?.message ?? e);
    }
    this.cfg = this.computeCfg();
  }

  /** Writes config.json through config.updateConfig, then reloads. Errors show on the card.
   *  @param {(raw: RawConfig) => void} mutate
   *  @returns {Promise<boolean>}
   */
  async writeConfig(mutate) {
    try {
      this.raw = await cfg.updateConfig(this.cfgPath, this.cfgDir, mutate, this.io);
      this.writeError = null;
      this.cfg = this.computeCfg();
      return true;
    } catch (e) {
      this.writeError = String(e?.message ?? e);
      console.log(`agent-usage: ${this.writeError}`);
      return false;
    }
  }

  /** One-time: the localStorage hidden list becomes services.<key>.hidden in config.json. A service
   *  that already has a hidden flag in the file keeps it. localStorage is cleared only once written. */
  async migrateHidden() {
    if (!this.legacyHidden.length || this.cfgError) return;
    const ok = await this.writeConfig((raw) => {
      for (const k of this.legacyHidden) {
        if (!this.services.some((s) => s.key === k)) continue;
        if (typeof raw.services?.[k]?.hidden === "boolean") continue;
        cfg.setAt(raw, this.services, `services.${k}.hidden`, true);
      }
    });
    if (!ok) return;
    this.legacyHidden = [];
    try { localStorage.removeItem("hidden"); } catch {}
    this.cfg = this.computeCfg();
  }

  /** A service as the widget sees it: services.json entry (or the scan's meta) + the person's config.
   *  @param {string} key
   *  @param {ProviderMeta} [meta]
   */
  effectiveService(key, meta) {
    const svc = this.services.find((s) => s.key === key) ?? { key, label: key, ...(meta ?? {}) };
    return { ...svc, label: svc.label ?? key, ...(this.cfg.services[key] ?? cfg.serviceOf(svc, {})) };
  }

  /** Keys of the services to scan, in services.json order. */
  enabledKeys() { return this.services.filter((s) => this.cfg.services[s.key]?.enabled !== false).map((s) => s.key); }

  /** Runs scan.mjs for the enabled services and stores the result: `data`, localStorage and the
   *  shared "agent-usage.lastScan". `limits`: also fetch the plan-limit APIs. A request made while
   *  a scan is running is remembered in `pending` and re-run when it ends.
   *  @param {import("gpui-kit").AsyncContext} cx
   *  @param {boolean} limits
   */
  refresh(cx, limits) {
    if (this.busy) {
      // Asked for while a scan runs (a settings save, the ↻): run once more when it ends.
      this.pending = { limits: !!limits || !!this.pending?.limits };
      return;
    }
    this.busy = true;
    this.lastScanAt = Date.now();
    if (limits) this.lastLimitsAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        const args = [`${appHome()}/mods/agent-usage/scan.mjs`, "--services", this.enabledKeys().join(",")];
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
        setShared("agent-usage.lastScan", next.at ?? new Date().toISOString()); // the settings page shows it
      } catch (e) {
        this.error = /not found|No such file|ENOENT|spawn/i.test(String(e)) ? "needs Node" : "scan failed";
        console.log(`agent-usage: ${e}`);
      }
      this.busy = false;
      const again = this.pending;
      this.pending = null;
      if (again) this.refresh(cx, again.limits);
      cx.notify();
    });
  }

  /** The window copy (settings) closes: free its input states and stop its watch loop. */
  async close() {
    this.settings?.dispose();
  }

  /** @param {import("gpui-kit").Context} cx */
  togglePin(cx) {
    this.pinned = !this.pinned;
    try { localStorage.setItem("pinned", this.pinned ? "1" : "0"); } catch {}
    cx.notify();
  }

  /** persistently hides a service from the strip (config.json services.<key>.hidden).
   *  @param {string} key
   *  @param {import("gpui-kit").Context} cx
   */
  toggleHidden(key, cx) {
    const hidden = !this.effectiveService(key).hidden;
    cx.spawn(async (cx) => {
      await this.writeConfig((raw) => cfg.setAt(raw, this.services, `services.${key}.hidden`, hidden));
      cx.notify();
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  showAll(cx) {
    cx.spawn(async (cx) => {
      const keys = this.hiddenKeys();
      await this.writeConfig((raw) => { for (const k of keys) cfg.setAt(raw, this.services, `services.${k}.hidden`, false); });
      cx.notify();
    });
  }

  /** Services this scan knows about that the person hid from the strip. */
  hiddenKeys() {
    return Object.keys(this.data?.providers ?? {}).filter((k) => this.effectiveService(k).hidden);
  }

  // ---------------------------------------------------------------- model

  /** One row per visible service: the effective service merged with everything scan.mjs reported
   *  for it — the single thing the strip and the detail card draw from.
   *  @returns {Row[]}
   */
  rows() {
    const live = agents();
    /** @type {Row[]} */
    const out = [];
    for (const [key, raw] of Object.entries(this.data?.providers ?? {})) {
      /** @type {ProviderUsage | null} */
      const d = raw ?? null;
      // Effective service: scan meta (label/icon/brand/matchers) + the person's config.json overrides.
      const m = this.effectiveService(key, d?.meta);
      if (!m.enabled || m.hidden) continue;
      const mine = live.filter((a) => owns(a, m));
      const used = (d?.week?.msgs ?? 0) > 0 || d?.limits?.state === "ok";
      if (!used && mine.length === 0) continue;
      const windows = d?.limits?.state === "ok" ? d.limits.windows ?? [] : [];
      const status = mine.reduce(/** @type {(s: import("herdr").Status | null, a: import("herdr").AgentInfo) => import("herdr").Status | null} */ ((s, a) => ((URGENCY[a.status] ?? 0) > (URGENCY[s] ?? 0) ? a.status : s)), null);
      out.push({ ...m, api: !!m.api, d, agents: mine, windows, primary: windows[0] ?? null,
        weekly: windows.find((w) => w.label === "week") ?? null, status });
    }
    return out;
  }

  // ---------------------------------------------------------------- pieces

  /** The service's square badge; dimmed when the row isn't live (`on=false`).
   *  @param {Row} r
   *  @param {number} size
   *  @param {Theme} t
   *  @param {boolean} [on]
   *  @returns {import("gpui-kit").Element}
   */
  glyph(r, size, t, on = true) {
    return h_flex().flex_none().size(size).rounded(Math.round(size * 0.3)).justify_center().items_center()
      .bg(alpha(r.brand, on ? 0.18 : 0.1)).text_color(r.brand)
      .child(svg(r.icon).size(Math.round(size * 0.62)));
  }

  /** A status dot; working/blocked pulse.
   *  @param {import("herdr").Status} status
   *  @param {Theme} t
   *  @param {number} [size]
   *  @returns {import("gpui-kit").Element}
   */
  statusDot(status, t, size = 6) {
    return div().flex_none().size(size).rounded(Math.ceil(size / 2)).bg(t[status] ?? t.unknown)
      .when(status === "working", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1400 }))
      .when(status === "blocked", (d) => d.loop("opacity", { from: 0.3, to: 1, period: 700 }));
  }

  /** One live agent: a dot that opens its terminal, tinted per state.
   *  @param {import("herdr").AgentInfo} a
   *  @param {Theme} t
   *  @returns {import("gpui-kit").Element}
   */
  agentDot(a, t) {
    return div().id(`ad-${a.address}`).flex_none().size(7).rounded(4).cursor_pointer()
      .when(a.status === "idle", (d) => d.border_1().border_color(t.idle))
      .when(a.status !== "idle", (d) => d.bg(t[a.status] ?? t.unknown))
      .when(a.status === "working", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1400 }))
      .tooltip(`${a.space_name} · ${a.tab_name || `tab ${a.tab_index}`} · ${a.status}`)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: a.address }); });
  }

  // A thin limit bar; `ticks` mark the other windows (weekly, monthly) on the same track.
  /** @param {string} id @param {number} pct @param {Theme} t @param {number} h @param {number[]} [ticks] @returns {import("gpui-kit").Element} */
  bar(id, pct, t, h, ticks = []) {
    const p = Math.max(0, Math.min(100, pct ?? 0));
    const color = level(p, t);
    /** @param {number} x @param {number} i @returns {import("gpui-kit").Element} */
    const mark = (x, i) => div().id(`${id}-tick-${i}`).absolute().top(-1).h(h + 2).w(2).rounded(1)
      .left(`${Math.max(0, Math.min(98, x))}%`).bg(alpha(t.foreground, 0.45));
    return div().id(id).relative().flex_1().min_w(0).h(h).rounded(h).bg(alpha(t.foreground, 0.08))
      .child(div().id(`${id}-fill`).absolute().left(0).top(0).h(h).rounded(h).bg(color)
        .w(`${p}%`).transition("width", GLIDE)
        .when(p >= 90, (d) => d.loop("opacity", { from: 0.55, to: 1, period: 1600 })))
      .when(ticks[0] != null, (el) => el.child(mark(ticks[0], 0)))
      .when(ticks[1] != null, (el) => el.child(mark(ticks[1], 1)));
  }

  // ---------------------------------------------------------------- compact

  /** @param {Row} r @param {Theme} t @returns {import("gpui-kit").Element} */
  compactRow(r, t) {
    const value = r.primary ? `${Math.round(r.primary.pct)}%` : r.api ? "—" : fmtCost(r.d?.today?.cost ?? 0);
    const valueColor = r.primary ? level(r.primary.pct, t) : t.muted;
    return h_flex().id(`row-${r.key}`).h(ROW).flex_none().mx(6).px(6).gap(8).items_center().rounded(6)
      .child(this.glyph(r, 18, t))
      .child(div().flex_none().w(44).truncate().text_size(12).text_color(t.muted).child(r.label))
      .child(r.primary
        ? this.bar(`bar-${r.key}`, r.primary.pct, t, 4, r.windows.slice(1, 3).map((w) => w.pct))
        : div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
          .child(`${fmtTokens(this.total(r.d?.today))} today`))
      .child(h_flex().flex_none().min_w(34).justify_end().text_size(11.5).text_color(valueColor).child(value))
      .child(div().flex_none().w(6).child(r.status && r.status !== "idle" ? this.statusDot(r.status, t) : div()));
  }

  /** Sum of a Totals block's token directions; 0 without a block.
   *  @param {Totals} [b]
   *  @returns {number}
   */
  total(b) { return b ? b.in + b.out + b.cw + b.cr : 0; }

  // ---------------------------------------------------------------- detail

  /** One plan-limit window inside the service's detail: label + percent left + reset time, over a bar.
   *  @param {Row} r
   *  @param {LimitWindow} w
   *  @param {number} i
   *  @param {Theme} t
   *  @returns {import("gpui-kit").Element}
   */
  windowLine(r, w, i, t) {
    const resets = fmtIn(w.resets_at);
    return v_flex().gap(4)
      .child(h_flex().items_center().text_size(11)
        .child(div().flex_1().text_color(t.muted).child(w.label))
        .child(div().text_color(level(w.pct, t)).child(`${Math.round(w.pct)}%`))
        .when(Boolean(resets), (el) => el.child(div().pl(6).text_color(t.dim).child(`· ${resets}`))))
      .child(h_flex().child(this.bar(`win-${r.key}-${i}`, w.pct, t, 5)));
  }

  /** Tokens/cost headline: big token count with the unit label, "~" when estimated.
   *  @param {string} label
   *  @param {Totals | undefined} b
   *  @param {boolean | undefined} estimated
   *  @param {Theme} t
   *  @returns {import("gpui-kit").Element}
   */
  stat(label, b, estimated, t) {
    return v_flex().flex_1().min_w(0).gap(1)
      .child(div().text_size(10.5).text_color(t.dim).child(label))
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(13).font_medium().text_color(t.foreground).child(fmtTokens(this.total(b))))
        .child(div().text_size(11).text_color(t.muted).child(`${estimated ? "~" : ""}${fmtCost(b?.cost ?? 0)}`)));
  }

  /** The 7-day token sparkline (the scan's daily history).
   *  @param {Row} r
   *  @param {Theme} t
   *  @returns {import("gpui-kit").Element}
   */
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

  /** A one-line hint when the limits aren't current (expired session, signed out, API error);
   *  null when no explanation is needed.
   *  @param {Row} r
   *  @param {Theme} t
   *  @returns {import("gpui-kit").Element | null}
   */
  limitNote(r, t) {
    const s = r.d?.limits?.state;
    const text = s === "stale" ? `${r.label}: session expired — reconnect to refresh limits`
      : s === "signed-out" ? (r.api ? "Not connected: add a Go API key (env, pi or opencode auth)" : "Not signed in: no plan limits")
      : s === "error" ? `Limits unavailable (${r.d.limits.error ?? "error"})`
      : null;
    return text ? div().text_size(11).text_color(t.dim).child(text) : null;
  }

  // Show/hide this service in the strip (persisted; see toggleHidden). Drawn on
  // in the card, since that's where you turn a service off.
  /** @param {Row} r @param {Theme} t @returns {import("gpui-kit").Element} */
  hideSwitch(r, t) {
    return div().id(`hide-${r.key}`).relative().w(30).h(17).rounded(9).cursor_pointer().flex_none()
      .bg(alpha(r.brand, 0.4)).border_1().border_color(alpha(r.brand, 0.6))
      .tooltip(`Hide ${r.label}`)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggleHidden(r.key, cx); })
      .child(div().absolute().top(2).left(15).w(11).h(11).rounded(6).bg(r.brand ?? t.muted));
  }

  /** One service's whole detail block in the card: badge, plan chip, live agents, window bars,
   *  today/week stats and the 7-day sparkline.
   *  @param {Row} r
   *  @param {Theme} t
   *  @returns {import("gpui-kit").Element}
   */
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
        .child(this.hideSwitch(r, t))
        .when(r.agents.length > 0, (el) => el.child(h_flex().gap(4).items_center()
          .children(r.agents.slice(0, 8).map((a) => this.agentDot(a, t))))))
      .children(r.windows.map((w, i) => this.windowLine(r, w, i, t)))
      .when(Boolean(note), (el) => el.child(note))
      .when(!r.api, (el) => el.child(h_flex().gap(10)
        .child(this.stat("Today", r.d?.today, r.d?.estimated, t))
        .child(this.stat("7 days", r.d?.week, r.d?.estimated, t))))
      .when(!r.api && (r.d?.daily ?? []).length > 0, (el) => el.child(this.spark(r, t)));
  }

  /** The card's scrollable body: every service's detail, a status/error line and the ⚙/refresh/
   *  show-hidden buttons. `list` is rows() output, `idPrefix` keeps ids unique between copies.
   *  @param {Row[]} list
   *  @param {Theme} t
   *  @param {string} idPrefix
   *  @returns {import("gpui-kit").Element}
   */
  detail(list, t, idPrefix) {
    return v_flex().gap(12)
      .children(list.flatMap((r, i) => {
        const s = this.section(r, t);
        return i === 0 ? [s] : [div().h(1).w_full().bg(t.border), s];
      }))
      .child(h_flex().items_center().text_size(10.5).text_color(t.dim)
        .child(div().flex_1().child(this.error
          ? this.error
          : this.writeError
          ? `Could not save: ${this.writeError}`
          : this.cfgError
          ? `config.json: ${this.cfgError} (using the last good settings)`
          : `${list.some((r) => r.d?.estimated) ? "~ estimated at API prices · " : ""}${fmtAgo(this.data?.at)}`))
        .when(this.hiddenKeys().length > 0, (el) => el.child(div().id(`${idPrefix}-show`).px(4).rounded(4).cursor_pointer()
          .hover((s) => s.text_color(t.foreground).bg(t.hover))
          .tooltip("Show hidden services")
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.showAll(cx); })
          .child(`${this.hiddenKeys().length} hidden · show`)))
        .child(div().id(`${idPrefix}-settings`).px(4).rounded(4).cursor_pointer()
          .hover((s) => s.text_color(t.foreground).bg(t.hover))
          .tooltip("Usage settings (ctrl-shift-u)")
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.openSettings(); })
          .child(div().text_size(13).child("⚙")))
        .child(div().id(`${idPrefix}-refresh`).px(4).rounded(4).cursor_pointer()
          .when(this.busy, (d) => d.loop("opacity", { from: 0.3, to: 1, period: 800 }))
          .hover((s) => s.text_color(t.foreground).bg(t.hover))
          .tooltip("Refresh now")
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.refresh(cx, true); cx.notify(); })
          .child(div().text_size(13).child("↻"))));
  }

  /** The hover card wrap: bg/border/shadow around {@link AgentUsage.detail}.
   *  @param {Row[]} list
   *  @param {Theme} t
   *  @param {string} id
   *  @returns {import("gpui-kit").Element}
   */
  card(list, t, id) {
    return v_flex().w(260).p(12).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_lg()
      .child(this.detail(list, t, id));
  }

  // ---------------------------------------------------------------- views

  /** Grows/shrinks the strip's layout block to `px` (no-ops on repeats).
   *  @param {number} px
   */
  resizeTo(px) {
    px = Math.round(px);
    if (px === this.lastPx) return;
    /** @type {number | null} */
    this.lastPx = px;
    run("layout.resize", { id: BLOCK, px });
  }

  /** Sidebar-wide layout: the strip rows, plus the detail inline when pinned (layout.resize), else
   *  a hover card on hover.
   *  @param {Row[]} list
   *  @param {Theme} t
   *  @returns {import("gpui-kit").Element}
   */
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

  /** Narrow layout: one tile per service with a fill bar and status badge; hovering shows the card.
   *  @param {Row[]} list
   *  @param {Theme} t
   *  @returns {import("gpui-kit").Element}
   */
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

  openSettings() {
    openOverlay({ kind: "window", mod: "agent-usage", props: { settings: true, float: true }, key: "usage-settings", width: 640, height: 0.75 });
  }

  render() {
    if (this.settings) return this.settings.render();
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
