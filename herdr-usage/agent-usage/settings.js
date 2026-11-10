// Usage settings screen: edits <herdr app home>/data/agent-usage/config.json (config.js holds the rules).
// Opened by ctrl-shift-u (mods/usage-settings opens the agent-usage mod with props {settings: true, float: true})
// or the ⚙ in the usage card's footer; this class renders in place of the strip (main.js branches on the props).
// Edits are a draft until Save. Save writes only the settings changed here, on top of a fresh read of the
// file (config.updateConfig), so a hide toggled in the card meanwhile survives. The widget watches the file.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { theme, appHome, readTextFile, writeTextFile, notify, closeOverlay, watchFolder, run, exec, shared } from "herdr";
import * as fs from "fs/promises";
import * as cfg from "./config.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const SOFT = { duration: 160, easing: "ease-out" };
const CACHE_NOTE = "~/.cache/herdr-agent-usage (or $XDG_CACHE_HOME/herdr-agent-usage)";
const stopPress = (_e, cx) => cx.stop_propagation(); // a press the window must not take as a drag
const SCAN_ROWS = [
  ["everyMinutes", "Rescan every", "How often the widget re-reads session logs for tokens and cost."],
  ["limitsEveryMinutes", "Limits every", "How often plan limits are fetched (Claude and OpenCode Go are rate-limited server-side; Codex limits come from its logs)."],
];

function alpha(hex, a) {
  if (typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) return hex;
  return hex.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
}
function fmtAgo(iso) {
  const s = Math.round((Date.now() - Date.parse(iso ?? "")) / 1000);
  if (!(s >= 0)) return "not yet";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export class Settings {
  /** `overlay`: the floating window's id (closes it). Runs inside the view's init (a live host call). */
  constructor(overlay, cx) {
    this.overlay = overlay;
    this.h = cx.focus_handle();
    this.home = appHome();
    this.configFile = cfg.configPath(this.home);
    this.configDir = cfg.configDir(this.home);
    this.scanPath = `${this.home}/mods/agent-usage/scan.mjs`;
    this.io = { readTextFile, writeTextFile, mkdir: fs.mkdir };
    this.loaded = false;
    this.loadError = null;
    this.closing = false;
    this.saving = false;
    this.clearing = false;
    this.services = cfg.DEFAULT_SERVICES;
    this.errors = {};       // path → what's wrong with the typed value
    this.nodeVersion = null;
    // Input states need a live host call: make them all now (never after an await), fill them on load.
    this.inputs = {};
    for (const [f] of SCAN_ROWS) this.inputs[`scan.${f}`] = this.numberState(`scan.${f}`);

    cx.spawn(async (cx) => {
      await this.load(cx);
      for (;;) {
        let changed;
        try { await fs.mkdir(this.configDir, { recursive: true }); changed = await watchFolder(this.configDir); }
        catch { return; }
        if (this.closing) return;
        if (!changed.some((p) => String(p).endsWith("config.json"))) continue; // store.json churns every scan
        await this.load(cx);
      }
    });
    cx.spawn(async (cx) => {
      try { this.nodeVersion = (await exec("node", ["--version"], { timeout: 5000 })).stdout.trim() || null; } catch {}
      cx.notify();
    });
  }

  // ---- model -----------------------------------------------------------------

  async load(cx) {
    try {
      const [svcText, rawText] = await Promise.all([
        readTextFile(`${this.home}/mods/agent-usage/services.json`),
        readTextFile(this.configFile),
      ]);
      if (this.closing) return;
      this.services = cfg.parseServices(svcText);
      const parsed = cfg.parseRaw(rawText);
      this.parseError = parsed.error ?? null;
      this.saved = cfg.effective(this.services, parsed.value ?? {});
      // First load, or the file changed underneath a clean page: take it. Never under someone typing.
      if (!this.loaded || (!this.dirty && !this.errorCount)) {
        this.draft = clone(this.saved);
        this.fillInputs();
      }
      if (!this.loaded) { this.loaded = true; this.h.focus(); }
      this.loadError = null;
    } catch (e) {
      this.loadError = String(e?.message ?? e);
    }
    cx.notify();
  }

  get dirty() { return this.loaded && cfg.changedPaths(this.draft, this.saved).length > 0; }
  get errorCount() { return Object.keys(this.errors).length; }
  valueAt(path) {
    const [head, key, field] = path.split(".");
    return head === "scan" ? this.draft.scan[key] : this.draft.services[key]?.[field];
  }
  isDefault(path) { return this.valueAt(path) === cfg.defaultAt(this.services, path); }

  /** Sets a draft value, or records why it can't be. */
  setValue(path, value) {
    const why = cfg.problem(path, value);
    if (why) { this.errors[path] = why; return; }
    delete this.errors[path];
    const [head, key, field] = path.split(".");
    if (head === "scan") this.draft.scan[key] = value;
    else this.draft.services[key][field] = value;
  }

  /** Back to the default, in the draft and in its field. */
  resetField(path) {
    const def = cfg.defaultAt(this.services, path);
    delete this.errors[path];
    const [head, key, field] = path.split(".");
    if (head === "scan") this.draft.scan[key] = def;
    else this.draft.services[key][field] = def;
    this.fillInput(path);
  }

  revert() {
    this.errors = {};
    this.draft = clone(this.saved);
    this.fillInputs();
  }

  // ---- inputs ----------------------------------------------------------------

  numberState(path) {
    const s = InputState.new({});
    s.on("change", (_e, cx) => {
      if (this.filling || !this.loaded) return;
      const raw = s.value().trim();
      if (!/^\d+$/.test(raw)) this.errors[path] = "a whole number";
      else this.setValue(path, Number(raw));
      cx.notify();
    });
    return s;
  }

  fillInput(path) {
    const s = this.inputs[path];
    if (!s) return;
    this.filling = true;
    try { s.set_value(String(this.valueAt(path) ?? "")); } finally { this.filling = false; }
  }

  fillInputs() { for (const path of Object.keys(this.inputs)) this.fillInput(path); }

  release() { for (const s of Object.values(this.inputs)) s.release?.(); this.inputs = {}; }

  // ---- actions ---------------------------------------------------------------

  /** Esc / ✕: close the window (main.js's close() releases the states). */
  close() {
    if (this.closing || !this.overlay) return;
    this.closing = true;
    closeOverlay(this.overlay);
  }

  /** The window went away (any way): stop the watch loop, free the inputs. */
  dispose() {
    this.closing = true;
    this.release();
  }

  async save(cx) {
    if (!this.dirty || this.errorCount || this.saving || this.parseError) return;
    this.saving = true;
    cx.notify();
    try {
      const changed = cfg.changedPaths(this.draft, this.saved);
      const written = await cfg.updateConfig(this.configFile, this.configDir, (raw) => {
        for (const path of changed) cfg.setAt(raw, this.services, path, this.valueAt(path));
      }, this.io);
      this.saved = cfg.effective(this.services, written);
      this.draft = clone(this.saved);
      this.fillInputs();
      notify({ title: "Usage settings", body: "Saved.", level: "success", timeout: 2000 });
      run("agent-usage.refresh"); // the widget re-scans now with the new services / cadence
    } catch (e) {
      notify({ title: "Usage settings", body: `Could not save: ${e?.message ?? e}`, level: "error" });
    }
    this.saving = false;
    cx.notify();
  }

  async clearCache(cx) {
    if (this.clearing) return;
    this.clearing = true;
    cx.notify();
    try {
      const r = await exec("node", [this.scanPath, "--reset-cache"], { timeout: 30_000 });
      if (r.code !== 0) throw new Error((r.stderr || `exit ${r.code}`).trim());
      notify({ title: "Usage settings", body: "Cache cleared — rescanning.", level: "success", timeout: 2000 });
      run("agent-usage.refresh");
    } catch (e) {
      notify({ title: "Usage settings", body: `Could not clear the cache: ${e?.message ?? e}`, level: "error" });
    }
    this.clearing = false;
    cx.notify();
  }

  onKey(e, cx) {
    const k = e.keystroke.replace(/^ctrl-/, "cmd-");
    if (k === "escape") this.close();
    else if (k === "cmd-s") cx.spawn(async (cx) => this.save(cx));
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- pieces ----------------------------------------------------------------

  btn(id, t, { label, onClick, disabled = false, solid = false, tooltip } = {}) {
    const base = h_flex().id(id).h(26).px(10).gap(6).items_center().rounded(7).text_size(12).font_medium()
      .on_mouse_down("left", stopPress)
      .when(solid, (el) => el.bg(t.accent).text_color(t.background))
      .when(!solid, (el) => el.border_1().border_color(t.border).bg(t.surface).text_color(t.foreground))
      .when(disabled, (el) => el.opacity(0.45))
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)));
    if (tooltip) base.tooltip(tooltip);
    if (!disabled && onClick) base.on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); });
    return base.child(label);
  }

  /** A switch for a boolean setting. `invert`: drawn on when the stored value is false ("in strip" ↔ hidden). */
  toggle(path, t, { invert = false } = {}) {
    const value = !!this.valueAt(path);
    const on = invert ? !value : value;
    return div().id(`st-${path}`).relative().w(34).h(20).rounded_full().cursor_pointer().flex_none()
      .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border)
      .on_mouse_down("left", stopPress)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.setValue(path, !value);
        cx.notify();
      })
      .child(div().id(`st-${path}-knob`).absolute().top(2).left(on ? 16 : 2).transition("left", SOFT).w(14).h(14).rounded_full()
        .bg(on ? t.background : t.muted));
  }

  /** Dot + "reset" chip after a label whose value isn't the default. */
  changeMark(t, path) {
    if (!this.loaded || this.isDefault(path)) return null;
    return h_flex().gap(6).items_center()
      .child(div().w(6).h(6).rounded_full().bg(t.accent).flex_none())
      .child(div().id(`st-reset-${path}`).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .tooltip("Back to the default").on_mouse_down("left", stopPress)
        .on_click((_e, cx) => { cx.stop_propagation(); this.resetField(path); cx.notify(); }).child("reset"));
  }

  /** A setting: label + hint on the left, `control` on the right. */
  row(t, path, label, hint, control, { setting = true } = {}) {
    const err = this.errors[path];
    const mark = setting ? this.changeMark(t, path) : null;
    const head = h_flex().gap(6).items_center().min_w(0)
      .child(div().text_size(13).font_medium().child(label))
      .when(!!mark, (el) => el.child(mark));
    const text = v_flex().flex_1().min_w(0).gap(2).child(head)
      .when(!!hint, (el) => el.child(div().text_size(11.5).text_color(t.dim).whitespace_normal().child(hint)))
      .when(!!err, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(`Must be ${err}`)));
    return h_flex().gap(16).items_center().py(9).border_b_1().border_color(t.border)
      .child(text).child(div().flex_none().child(control));
  }

  number(path, unit, t) {
    const err = !!this.errors[path];
    return h_flex().gap(6).items_center()
      .child(Input.new(this.inputs[path]).w(72).h(28).px(8).items_center().rounded(7).border_1()
        .border_color(err ? t.blocked : t.input ?? t.border).bg(t.background).text_size(13))
      .when(!!unit, (el) => el.child(div().w(30).text_size(11.5).text_color(t.dim).child(unit)));
  }

  glyphEl(svc, t, size = 24) {
    const initial = (svc.label ?? svc.key ?? "?").trim().charAt(0).toUpperCase() || "?";
    return h_flex().flex_none().size(size).rounded(Math.round(size * 0.3)).justify_center().items_center()
      .bg(alpha(svc.brand, 0.18)).text_color(svc.brand ?? t.muted).overflow_hidden()
      .child(svc.icon ? svg(svc.icon).size(Math.round(size * 0.6)) : div().text_size(11).child(initial));
  }

  section(t, title, note) {
    return v_flex().pt(16).pb(4).gap(2)
      .child(div().text_size(10.5).font_semibold().text_color(t.accent).child(title.toUpperCase()))
      .when(!!note, (el) => el.child(div().text_size(11.5).text_color(t.dim).whitespace_normal().child(note)));
  }

  // ---- sections ----------------------------------------------------------

  serviceRow(svc, t) {
    const kp = `services.${svc.key}`;
    if (!this.draft.services[svc.key]) return div();
    const labeled = (text, path, opts) => h_flex().gap(6).items_center()
      .child(div().text_size(11.5).text_color(t.dim).child(text))
      .child(this.toggle(path, t, opts));
    const marks = [this.changeMark(t, `${kp}.enabled`), this.changeMark(t, `${kp}.hidden`)].filter(Boolean);
    return h_flex().gap(10).items_center().py(9).border_b_1().border_color(t.border)
      .child(this.glyphEl(svc, t))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().text_size(13).font_medium().truncate().child(svc.label ?? svc.key))
        .when(Boolean(svc.api), (el) => el.child(div().px(5).rounded(4).text_size(10).flex_none()
          .bg(alpha(svc.brand, 0.16)).text_color(svc.brand ?? t.muted).child("API")))
        .when(marks.length > 0, (el) => el.child(marks[0])))
      .child(labeled("in strip", `${kp}.hidden`, { invert: true }))
      .child(labeled("enabled", `${kp}.enabled`));
  }

  renderServices(t) {
    return v_flex().gap(1)
      .child(this.section(t, "Services", "Enabled off stops scanning a service. In strip off keeps scanning it but leaves it out of the widget (the card's switch does the same). Labels, colors and matchers live in services.json."))
      .children(this.services.map((svc) => this.serviceRow(svc, t)));
  }

  renderScan(t) {
    return v_flex().gap(1)
      .child(this.section(t, "Scanning", "The scanner reads the agents' session logs and — less often — the plan-limit APIs. It keeps 7 days of history."))
      .children(SCAN_ROWS.map(([f, label, hint]) =>
        this.row(t, `scan.${f}`, label, `${hint} ${cfg.RANGES[f][0]}–${cfg.RANGES[f][1]} min.`, this.number(`scan.${f}`, "min", t))));
  }

  renderData(t) {
    return v_flex().gap(1)
      .child(this.section(t, "Data"))
      .child(this.row(t, "data.scan", "Last scan", "When the widget last read usage.",
        div().text_size(12).text_color(t.muted).child(fmtAgo(shared("agent-usage.lastScan"))), { setting: false }))
      .child(this.row(t, "data.node", "Node", "The scanner needs Node.js in PATH.",
        div().text_size(12).text_color(this.nodeVersion ? t.muted : t.blocked).child(this.nodeVersion ?? "not found"), { setting: false }))
      .child(this.row(t, "data.cache", "Scan cache", `${CACHE_NOTE}. Clearing it makes the next scan read the logs from scratch.`,
        this.btn("st-clear-cache", t, { label: this.clearing ? "Clearing…" : "Clear & rescan", disabled: this.clearing,
          tooltip: "Delete the scanner's cache, then rescan", onClick: (cx) => cx.spawn(async (cx) => this.clearCache(cx)) }), { setting: false }));
  }

  renderFiles(t) {
    return v_flex().gap(1)
      .child(this.section(t, "Files", "Your settings are saved next to the widget's defaults. Prices and API endpoints are code, not settings — they live in scan.mjs."))
      .child(v_flex().gap(4).py(8)
        .child(div().text_size(11.5).text_color(t.muted).child(`Defaults  mods/agent-usage/services.json`))
        .child(div().text_size(11.5).text_color(t.muted).child(`Yours     ${this.configFile}`))
        .child(div().text_size(11.5).text_color(t.muted).child(`Cache     ${CACHE_NOTE}`)));
  }

  // ---- view ----------------------------------------------------------------

  render(t = theme()) {
    const root = v_flex().id("usage-settings").relative().track_focus(this.h).size_full().bg(t.canvas).text_color(t.foreground)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => this.h.focus());
    if (!this.loaded) return root.items_center().justify_center()
      .child(div().text_size(13).text_color(this.loadError ? t.blocked : t.dim)
        .child(this.loadError ? `Could not read the settings: ${this.loadError}` : "Loading…"));
    return root
      .child(this.renderHeader(t))
      .child(div().id("settings-body").flex_1().min_h(0).overflow_y_scrollbar()
        .on_mouse_down("left", (_e, cx) => { this.h.focus(); cx.stop_propagation(); })
        .child(v_flex().id("settings-page").w_full().max_w(640).mx_auto().px(24).pb(16)
          .when(!!this.parseError, (el) => el.child(div().mt(12).p(10).rounded(8).border_1().border_color(t.blocked)
            .text_size(12).text_color(t.blocked).whitespace_normal()
            .child(`config.json isn't valid JSON (${this.parseError}). Fix or delete it to save from here; the widget uses the defaults until then.`)))
          .child(this.renderServices(t))
          .child(this.renderScan(t))
          .child(this.renderData(t))
          .child(this.renderFiles(t))))
      .child(this.renderFooter(t));
  }

  renderHeader(t) {
    return v_flex().relative().flex_none().bg(t.chrome).border_b_1().border_color(t.border)
      .child(h_flex().relative().h(54).px(16).gap(10).items_center()
        .child(h_flex().w(30).h(30).rounded(8).flex_none().justify_center().items_center()
          .bg(alpha(t.accent, 0.18)).border_1().border_color(alpha(t.accent, 0.35)).text_color(t.accent)
          .child(div().text_size(15).child("⚙")))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().child("Usage settings"))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child(this.configFile)))
        .child(h_flex().flex_none().items_center().on_mouse_down("left", stopPress)
          .child(this.btn("st-close", t, { label: "✕", tooltip: "Close (esc)", onClick: () => this.close() }))));
  }

  renderFooter(t) {
    const n = this.errorCount;
    const status = n ? `${n} field${n === 1 ? "" : "s"} to fix`
      : this.parseError ? "Fix config.json first"
      : this.saving ? "Saving…"
      : this.dirty ? "Unsaved changes" : "Saved";
    return h_flex().flex_none().h(50).px(16).gap(8).items_center().bg(t.chrome).border_t_1().border_color(t.border)
      .on_mouse_down("left", stopPress)
      .child(div().flex_1().text_size(12)
        .text_color(n || this.parseError ? t.blocked : this.dirty ? t.accent : t.dim)
        .child(status))
      .child(this.btn("st-revert", t, { label: "Revert", disabled: !this.dirty && !n, tooltip: "Undo the changes since the last save", onClick: (cx) => { this.revert(); cx.notify(); } }))
      .child(this.btn("st-save", t, { label: "Save", solid: true, disabled: !this.dirty || n > 0 || !!this.parseError || this.saving, tooltip: "Write your changes (⌘S)", onClick: (cx) => { cx.spawn(async (cx) => this.save(cx)); } }));
  }
}
