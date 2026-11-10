// Review settings screen: edits <herdr-app home>/data/review/config.json (see config-core.js for the rules).
// Opened by the ⚙ button in a review (in place of the document) or in the review inbox (its own floating window),
// by the review.settings command, or by `mod.open {"name": "review-settings"}` (the mod-settings folder; bindable).
// Edits are a draft until Save; Save writes only what differs from the defaults, and every open review and inbox
// picks the change up (they watch data/review).
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Textarea, TextareaState, Scrollbar } from "gpui-base";
import { theme, fonts, notify, closeOverlay } from "herdr";
import * as core from "./config-core.js";
import { configDefaults, configPath, readConfig, writeConfig, tint, btn, icon, wash, stopPress, scaler, withFont, Appear, fadeIn, SOFT, QUICK } from "./ui.js";

/** @import { ReviewConfig, Theme } from "./types"
 *  @import { Color, Element, Context, AsyncContext, KeyEvent } from "gpui-kit" */

const TABS = [["window", "Window"], ["ui", "Appearance"], ["prompts", "Agent text"]];
const PLACE_LABELS = { float: "Floating", right: "Split right", down: "Split down", tab: "Tab" };
const ARRIVE_LABELS = { open: "Open it", inbox: "Wait in the inbox" };
const SIDEBAR_LABELS = { auto: "When wide", open: "Open", closed: "Closed" };

// The Agent text tab: [section, [path, label, what it's for / its placeholders]].
/** @type {[string, [string, string, string][]][]} */
const PROMPTS = [
  ["Plan decisions", [
    ["prompts.deny", "Plan sent back", "Goes before your feedback when you request changes on a plan."],
    ["prompts.approvedWithNotes", "Plan approved, with notes", "Goes before your notes when you approve a plan that has notes."],
  ]],
  ["Feedback", [
    ["prompts.feedback.intro", "Intro", "{subject}: what was reviewed · {count}: e.g. “3 pieces”"],
    ["prompts.feedback.plan.heading", "Heading for a plan", ""],
    ["prompts.feedback.plan.subject", "Subject for a plan", "Fills {subject} in the intro."],
    ["prompts.feedback.reply.heading", "Heading for an agent reply", ""],
    ["prompts.feedback.reply.subject", "Subject for an agent reply", ""],
    ["prompts.feedback.file.heading", "Heading for a file or request", "{name}: the file name, or the review's title"],
    ["prompts.feedback.file.subject", "Subject for a file or request", "{path}: the file path, or the title in quotes · {name}"],
  ]],
  ["Feedback sections", [
    ["prompts.feedback.sections.on", "A comment", "{quote}: the start of the annotated text"],
    ["prompts.feedback.sections.decision", "A pick in a choice block", "{quote}: the question"],
    ["prompts.feedback.sections.remove", "A deletion", ""],
    ["prompts.feedback.sections.change", "A replacement", ""],
    ["prompts.feedback.sections.general", "Global comments, after the others", ""],
    ["prompts.feedback.sections.generalOnly", "Global comments, alone", ""],
  ]],
  ["Approve with notes", [
    ["prompts.notes.plan.heading", "Heading for a plan", ""],
    ["prompts.notes.plan.intro", "Intro for a plan", ""],
    ["prompts.notes.other.heading", "Heading for anything else", ""],
    ["prompts.notes.other.intro", "Intro for anything else", ""],
  ]],
  ["pi plan mode", [
    ["prompts.pi.planMode", "When plan mode starts", "{tool}: the submit tool (submit_plan)"],
    ["prompts.pi.planOff", "When plan mode ends", ""],
  ]],
];

// The font list: row height (28 + 1 gap), how tall it gets, and how many fonts it draws before "keep typing".
const FONT_ROW = 29;
const FONT_LIST_H = 240;
const FONT_CAP = 200;

const NUMBER_FIELDS = ["window.width", "window.height", "ui.contentWidth", "ui.sidebarWidth"];
/** Deep-copies a settings value (raw config JSON: nested objects, text arrays, scalars).
 *  @param {any} v @returns {any} */
const clone = (v) => JSON.parse(JSON.stringify(v));
/** Two text settings render the same (core.text joins arrays and fills placeholders).
 *  @param {import("./types").Text} a @param {import("./types").Text} b @returns {boolean} */
const sameText = (a, b) => core.text(a) === core.text(b);

export class Settings {
  /** `overlay`: this floating window's id (closes it), or null when shown inside a review (`onClose` goes back).
   *  `cx`: the settings view's init context.
   *  @param {string | null} overlay @param {AsyncContext} cx @param {{ onClose?: (() => void) | null }} [opts] */
  constructor(overlay, cx, { onClose = null } = {}) {
    this.overlay = overlay;
    this.onClose = onClose;
    this.h = cx.focus_handle();
    this.appear = new Appear(cx); // the tab body and the font list fade / grow in
    this.tab = "window";
    this.loaded = false;
    /** @type {Record<string, InputState | TextareaState>} */
    this.inputs = {};       // path → InputState | TextareaState
    /** @type {Record<string, string>} */
    this.errors = {};       // path → what's wrong with the typed value
    this.fontOpen = false;
    /** @type {InputState | null} */
    this.fontQuery = null;  // InputState of the font search
    this.closing = false;
    /** @type {string[]} */
    this.allFonts = [];
    this.filling = false;   // set while fields are filled from the draft (their change events aren't edits)
    // Field states can't be made while rendering: make them all now, fill them once the settings are read.
    for (const path of NUMBER_FIELDS) this.inputs[path] = this.numberState(path);
    for (const [, fields] of PROMPTS) for (const [path] of fields) this.inputs[path] = this.textState(path);
    this.fontQuery = InputState.new({ placeholder: "Search fonts" });
    this.fontQuery.on("change", (_e, cx) => cx.notify());
    cx.spawn(async (cx) => {
      this.defaults = await configDefaults();
      this.saved = await readConfig();
      try { this.allFonts = [...new Set(fonts())].sort((a, b) => a.localeCompare(b)); } catch {}
      this.reset(this.saved);
      this.loaded = true;
      cx.notify();
      this.h.focus();
    });
  }

  /** Puts `cfg` in the draft and fills the fields from it.
   *  @param {ReviewConfig} cfg */
  reset(cfg) {
    this.errors = {};
    this.draft = clone(cfg);
    this.filling = true;
    try {
      for (const [path, s] of Object.entries(this.inputs)) {
        const v = core.get(this.draft, path);
        if (v !== undefined) s.set_value(typeof v === "number" ? String(v) : core.text(v));
      }
    } finally { this.filling = false; }
  }

  release() {
    for (const s of Object.values(this.inputs)) s.release?.();
    this.fontQuery?.release?.();
  }

  get dirty() { return this.loaded && JSON.stringify(this.draft) !== JSON.stringify(this.saved); }
  get errorCount() { return Object.keys(this.errors).length; }
  /** The draft value at dotted `path`.
   *  @param {string} path */
  value(path) { return core.get(this.draft, path); }
  /** @param {string} path */
  isDefault(path) {
    const v = this.value(path), d = core.get(this.defaults, path);
    return typeof d === "string" || Array.isArray(d) ? sameText(v, d) : v === d;
  }

  /** Sets a draft value, or records why it can't be. Text equal to the default's goes back to the default itself.
   *  `v` is a raw config value until core.problem validates it (the person's typed text, parsed).
   *  @param {string} path @param {any} v */
  setValue(path, v) {
    const def = core.get(this.defaults, path);
    if ((typeof def === "string" || Array.isArray(def)) && sameText(v, def)) v = clone(def);
    const why = core.problem(this.defaults, path, v);
    if (why) { this.errors[path] = why.replace(/^\S+ /, ""); return; }
    delete this.errors[path];
    core.set(this.draft, path, v);
  }

  /** Back to the default, in the draft and in its field.
   *  @param {string} path */
  resetField(path) {
    const def = clone(core.get(this.defaults, path));
    this.setValue(path, def);
    const s = this.inputs[path];
    if (s) { this.filling = true; try { s.set_value(typeof def === "number" ? String(def) : core.text(def)); } finally { this.filling = false; } }
  }

  close() {
    if (this.onClose) { this.onClose(); return; }
    if (this.closing || !this.overlay) return;
    this.closing = true;
    this.release();
    closeOverlay(this.overlay);
  }

  /** @param {Context} cx */
  async save(cx) {
    if (!this.dirty || this.errorCount) return;
    try {
      await writeConfig(this.draft);
      this.saved = await readConfig();
      this.draft = clone(this.saved);
      notify({ title: "Review settings", body: "Saved.", level: "success", timeout: 2000 });
    } catch (e) {
      notify({ title: "Review settings", body: `Could not save: ${e?.message ?? e}`, level: "error" });
    }
    cx.notify();
  }

  /** @param {KeyEvent} e @param {Context} cx */
  onKey(e, cx) {
    const k = e.keystroke.replace(/^ctrl-/, "cmd-");
    if (k === "escape") { if (this.fontOpen) this.fontOpen = false; else this.close(); }
    else if (k === "cmd-s") cx.spawn(async (cx) => this.save(cx));
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- fields ----------------------------------------------------------------

  /** @param {string} path @returns {InputState} */
  numberState(path) {
    const s = InputState.new({});
    s.on("change", (_e, cx) => {
      if (this.filling || !this.loaded) return;
      const raw = s.value().trim();
      if (raw === "" || !Number.isFinite(Number(raw))) this.errors[path] = "must be a number";
      else this.setValue(path, Number(raw));
      cx.notify();
    });
    return s;
  }

  /** @param {string} path @returns {TextareaState} */
  textState(path) {
    const multi = path === "prompts.pi.planMode" || path === "prompts.deny" || path === "prompts.approvedWithNotes";
    const s = TextareaState.new({ rows: multi ? 3 : 1 });
    s.set_auto_grow(multi ? 3 : 1, 12);
    s.on("change", (_e, cx) => { if (this.filling || !this.loaded) return; this.setValue(path, s.value()); cx.notify(); });
    return s;
  }

  // ---- view ------------------------------------------------------------------

  /** @param {Theme} [t] @returns {Element} */
  render(t = theme()) {
    const root = v_flex().id("settings").relative().track_focus(this.h).size_full().bg(t.canvas).text_color(t.foreground)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => this.h.focus());
    if (!this.loaded) return root.items_center().justify_center().child(div().text_size(13).text_color(t.dim).child("Loading…"));
    const body = this.tab === "window" ? this.renderWindow(t) : this.tab === "ui" ? this.renderUi(t) : this.renderPrompts(t);
    return root
      .child(this.renderHeader(t))
      .child(div().id("settings-body").flex_1().min_h(0).overflow_y_scrollbar()
        .on_mouse_down("left", (_e, cx) => { this.h.focus(); cx.stop_propagation(); })
        .child(fadeIn(v_flex().id(`settings-tab-${this.tab}`), this.appear.is(`tab-${this.tab}`), 4).w_full().max_w(720).mx_auto().px(20).py(16).gap(4).child(body)))
      .child(this.renderFooter(t));
  }

  /** @param {Theme} t @returns {Element} */
  renderHeader(t) {
    /** @param {string} id @param {string} label @returns {Element} */
    const chip = (id, label) => {
      const on = this.tab === id;
      return h_flex().id(`st-tab-${id}`).h(24).px(10).items_center().rounded(6).text_size(12).font_medium().cursor_pointer()
        .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.background).shadow_sm())
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { if (this.tab !== id) this.appear.forget(`tab-${id}`); this.tab = id; this.fontOpen = false; cx.notify(); })
        .child(label);
    };
    return v_flex().relative().flex_none().bg(t.chrome).border_b_1().border_color(t.border)
      .child(wash(tint(t.accent, "1c"), tint(t.chrome, "00"), 90))
      .child(h_flex().relative().h(54).pl(16).pr(10).gap(10).items_center()
        .child(div().w(30).h(30).rounded(8).flex_none().bg(tint(t.accent, "22")).border_1().border_color(tint(t.accent, "44"))
          .text_color(t.accent).flex().items_center().justify_center().child(icon("settings", 15)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().child("Review settings"))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child(configPath())))
        .child(h_flex().flex_none().gap(4).items_center().on_mouse_down("left", stopPress)
          .child(btn("st-close", t, { ic: "x", tooltip: this.onClose ? "Back to the review (esc)" : "Close (esc)", onClick: () => this.close() }))))
      .child(h_flex().relative().px(12).pb(10).gap(8).items_center()
        .child(h_flex().p(3).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border).on_mouse_down("left", stopPress)
          .children(TABS.map(([id, l]) => chip(id, l)))));
  }

  /** @param {Theme} t @returns {Element} */
  renderFooter(t) {
    const n = this.errorCount;
    const status = n ? `${n} field${n === 1 ? "" : "s"} to fix` : this.dirty ? "Unsaved changes" : "Saved";
    return h_flex().flex_none().h(52).px(16).gap(8).items_center().bg(t.chrome).border_t_1().border_color(t.border)
      .on_mouse_down("left", stopPress)
      .child(div().flex_1().text_size(12).text_color(n ? t.blocked : this.dirty ? t.accent : t.dim).child(status))
      .child(btn("st-defaults", t, { label: "Reset all", tooltip: "Put every setting back to its default (then Save)",
        onClick: (cx) => { this.reset(/** @type {ReviewConfig} */ (core.merge(this.defaults, {}))); cx.notify(); } }))
      .child(btn("st-revert", t, { label: "Revert", disabled: !this.dirty && !n, tooltip: "Undo the changes since the last save",
        onClick: (cx) => { this.reset(this.saved); cx.notify(); } }))
      .child(btn("st-save", t, { ic: "check", label: "Save", variant: "solid", color: t.accent, kbd: "⌘S", disabled: !this.dirty || n > 0,
        onClick: (cx) => { cx.spawn(async (cx) => this.save(cx)); } }));
  }

  /** @param {Theme} t @param {string} title @param {string} [note] @returns {Element} */
  section(t, title, note) {
    return v_flex().pt(14).pb(4).gap(2)
      .child(div().text_size(10.5).font_semibold().text_color(t.accent).child(title.toUpperCase()))
      .when(!!note, (el) => el.child(div().text_size(11.5).text_color(t.dim).whitespace_normal().child(note)));
  }

  /** A setting: its label and hint on the left, `control` on the right (or below, `stacked`).
   *  @param {Theme} t @param {string} path @param {string} label @param {string} hint @param {Element} control
   *  @param {{ stacked?: boolean }} [opts] @returns {Element} */
  row(t, path, label, hint, control, { stacked = false } = {}) {
    const err = this.errors[path];
    const changed = !this.isDefault(path);
    const head = h_flex().gap(6).items_center().min_w(0)
      .child(div().text_size(13).font_medium().child(label))
      .when(changed, (el) => el.child(div().w(6).h(6).rounded_full().bg(t.accent).flex_none())
        .child(div().id(`st-reset-${path}`).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .tooltip("Back to the default").on_click((_e, cx) => { this.resetField(path); cx.notify(); }).child("reset")));
    const text = v_flex().flex_1().min_w(0).gap(2).child(head)
      .when(!!hint, (el) => el.child(div().text_size(11.5).text_color(t.dim).whitespace_normal().child(hint)))
      .when(!!err, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(`Must be ${err.replace(/^must be /, "")}`)));
    const wrap = (stacked ? v_flex().gap(8) : h_flex().gap(16).items_center())
      .py(10).border_b_1().border_color(tint(t.border, "88"));
    return wrap.child(text).child(stacked ? control : div().flex_none().child(control));
  }

  /** @param {Theme} t @param {string} path @param {Record<string, string>} labels @returns {Element} */
  segmented(t, path, labels) {
    const cur = this.value(path);
    return h_flex().p(3).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .children(Object.entries(labels).map(([v, l]) => {
        const on = cur === v;
        return h_flex().id(`st-${path}-${v}`).h(24).px(9).items_center().rounded(6).text_size(12).font_medium().cursor_pointer()
          .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.background).shadow_sm())
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.setValue(path, v); cx.notify(); })
          .child(l);
      }));
  }

  /** @param {Theme} t @param {string} path @returns {Element} */
  toggle(t, path) {
    const on = !!this.value(path);
    return div().id(`st-${path}`).relative().w(34).h(20).rounded_full().cursor_pointer()
      .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border)
      .on_click((_e, cx) => { this.setValue(path, !on); cx.notify(); })
      .child(div().id(`st-${path}-knob`).absolute().top(2).left(on ? 16 : 2).transition("left", SOFT).w(14).h(14).rounded_full().bg(on ? t.background : t.muted));
  }

  /** @param {Theme} t @param {string} path @param {string} unit @returns {Element} */
  number(t, path, unit) {
    const err = !!this.errors[path];
    return h_flex().gap(6).items_center()
      .child(Input.new(/** @type {InputState} */ (this.inputs[path])).w(96).h(28).px(8).items_center().rounded(7).border_1()
        .border_color(err ? t.blocked : t.input ?? t.border).bg(t.background).text_size(13))
      .when(!!unit, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(unit)));
  }

  /** A size stepper; 0 means the theme's size, and stepping from it starts at `from`.
   *  @param {Theme} t @param {string} path @param {number} lo @param {number} hi @param {number} [from] @returns {Element} */
  stepper(t, path, lo, hi, from = 13) {
    const v = this.value(path);
    /** @param {number} d @returns {(cx: Context) => void} */
    const step = (d) => (cx) => { this.setValue(path, Math.min(hi, Math.max(lo, (v || from) + d))); cx.notify(); };
    return h_flex().gap(4).items_center()
      .child(btn(`st-${path}-dn`, t, { label: "−", variant: "outline", disabled: v > 0 && v <= lo, onClick: step(-1) }))
      .child(div().w(56).text_center().text_size(13).font_medium().child(v ? `${v}px` : "Theme"))
      .child(btn(`st-${path}-up`, t, { label: "+", variant: "outline", disabled: v >= hi, onClick: step(1) }));
  }

  /** @param {Theme} t @returns {Element} */
  renderWindow(t) {
    return v_flex()
      .child(this.section(t, "Where reviews open", "Agents can still ask for a place per review, and $HERDR_REVIEW_PLACE overrides this for a session."))
      .child(this.row(t, "window.place", "Open reviews as", "A split or tab opens beside the agent that asked. If a floating window can't open, it falls back to a split, then a tab.",
        this.segmented(t, "window.place", PLACE_LABELS), { stacked: true }))
      .child(this.row(t, "window.arrive", "When a review arrives", "“Open” opens quietly beside you; if you're on another workspace, a pill at the top waits for you. “Wait in the inbox” shows a toast instead (ctrl-shift-i opens the inbox).",
        this.segmented(t, "window.arrive", ARRIVE_LABELS)))
      .child(this.row(t, "window.focus", "Take the keyboard", "Reviews you open yourself (the pill, the inbox, ctrl-shift-r) get keyboard focus. Ones that arrive on their own never take it.", this.toggle(t, "window.focus")))
      .child(this.section(t, "Floating window size", "Pixels (200 or more), or a share of the Herdr window (0 to 1, e.g. 0.6). Applies to the next window that opens."))
      .child(this.row(t, "window.width", "Width", "", this.number(t, "window.width", "px or 0–1")))
      .child(this.row(t, "window.height", "Height", "", this.number(t, "window.height", "px or 0–1")));
  }

  /** @param {Theme} t @returns {Element} */
  renderUi(t) {
    return v_flex()
      .child(this.section(t, "Text"))
      .child(this.row(t, "ui.font", "Font", "For the document, notes and controls. Code blocks keep the theme's code font.", this.fontPicker(t), { stacked: this.fontOpen }))
      .child(this.row(t, "ui.textSize", "Text size", "The document text. Notes and the sidebar scale with it; “reset” goes back to the theme's size.", this.stepper(t, "ui.textSize", 9, 24)))
      .child(this.preview(t))
      .child(this.section(t, "Layout"))
      .child(this.row(t, "ui.contentWidth", "Document width", "The widest the document column gets.", this.number(t, "ui.contentWidth", "px")))
      .child(this.row(t, "ui.sidebarWidth", "Sidebar width", "The annotations sidebar.", this.number(t, "ui.sidebarWidth", "px")))
      .child(this.row(t, "ui.sidebar", "Show the sidebar", "Until you toggle it with the sidebar button, which is remembered.",
        this.segmented(t, "ui.sidebar", SIDEBAR_LABELS)))
      .child(this.row(t, "ui.readingTime", "Reading time", "The “N min read” above the document.", this.toggle(t, "ui.readingTime")));
  }

  /** @param {Theme} t @returns {Element} */
  fontPicker(t) {
    const cur = this.value("ui.font");
    const button = h_flex().id("st-font").h(28).px(10).gap(8).items_center().rounded(7).border_1().border_color(this.fontOpen ? t.accent : t.border)
      .bg(t.background).cursor_pointer().text_size(13).min_w(180)
      .on_click((_e, cx) => {
        this.fontOpen = !this.fontOpen;
        this.appear.forget("font-list");
        if (this.fontOpen) cx.spawn(async () => this.fontQuery.focus());
        cx.notify();
      })
      .child(div().flex_1().truncate().when(!!cur, (el) => el.font_family(cur)).child(cur || "Theme default"))
      .child(div().text_size(9).text_color(t.muted).child(this.fontOpen ? "▴" : "▾"));
    if (!this.fontOpen) return button;
    const q = (this.fontQuery?.value() ?? "").trim().toLowerCase();
    const matches = this.allFonts.filter((f) => !q || f.toLowerCase().includes(q));
    const shown = matches.slice(0, FONT_CAP);
    /** @param {string} name @param {string} [label] @returns {Element} */
    const item = (name, label) => {
      const on = (cur || "") === name;
      return h_flex().id(`st-font-${name || "default"}`).h(28).px(10).items_center().rounded(6).cursor_pointer().text_size(13)
        .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.setValue("ui.font", name); this.fontOpen = false; cx.notify(); })
        .child(div().flex_1().truncate().when(!!name, (el) => el.font_family(name)).child(label ?? name))
        .when(on, (el) => el.child(div().text_color(t.accent).child(icon("check", 12))));
    };
    const rows = [
      ...(!q ? [item("", "Theme default")] : []),
      ...shown.map((f) => item(f)),
      ...(matches.length > shown.length ? [div().px(10).py(6).text_size(11.5).text_color(t.dim)
        .child(`${matches.length - shown.length} more: keep typing to narrow it down`)] : []),
      ...(!matches.length ? [div().px(10).py(6).text_size(12).text_color(t.dim).child("No font matches")] : []),
    ];
    // A definite height with the scroll area pinned inside it (absolute, inset 0) and its own bar: a max-height
    // scroll area nested in the settings' scroll area never got a viewport of its own, so it didn't scroll.
    // Grows open from 0 the first frame.
    const grown = this.appear.is("font-list");
    const height = grown ? Math.min(FONT_LIST_H, rows.length * FONT_ROW + 4) : 0;
    return v_flex().gap(6).w_full()
      .child(button)
      .child(v_flex().p(6).gap(4).rounded(8).border_1().border_color(t.border).bg(t.popover ?? t.background)
        .child(h_flex().h(28).px(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.background)
          .child(Input.new(this.fontQuery).flex_1().h_full().text_size(12.5)))
        .child(div().id("st-font-frame").relative().w_full().overflow_hidden().h(height).opacity(grown ? 1 : 0)
          .transition("height", SOFT).transition("opacity", QUICK)
          // The list takes the wheel: the settings page doesn't scroll along with it.
          .on_scroll_wheel((_e, cx) => cx.stop_propagation())
          .child(v_flex().id("st-font-list").absolute().inset_0().overflow_y_scroll().gap(1).pr(8).children(rows))
          .child(Scrollbar.vertical("st-font-list").absolute().inset_0())));
  }

  /** @param {Theme} t @returns {Element} */
  preview(t) {
    const sz = scaler(this.draft);
    return withFont(v_flex().my(8).p(14).gap(6).rounded(10).bg(t.background).border_1().border_color(t.border), this.draft)
      .child(div().text_size(10.5).font_semibold().text_color(t.dim).child("PREVIEW"))
      .child(div().text_size(sz(17)).font_semibold().child("Implementation plan"))
      .child(div().text_size(sz(13)).whitespace_normal().text_color(t.foreground)
        .child("Each block can be commented on, deleted or replaced. Your notes go back to the agent as markdown."))
      .child(div().text_size(sz(12)).italic().text_color(t.muted).child("“…the quoted text of an annotation”"));
  }

  /** @param {Theme} t @returns {Element} */
  renderPrompts(t) {
    if (!this.defaults?.prompts) {
      return div().py(30).text_center().text_size(13).text_color(t.dim).whitespace_normal()
        .child("config.defaults.json is missing from the review mod; reinstall it (node install.mjs sync herdr).");
    }
    return v_flex()
      .child(div().pt(10).text_size(12).text_color(t.dim).whitespace_normal()
        .child("What the agent receives. Words in {braces} are filled in. Changes apply to the next review or decision; pi picks them up on its next turn."))
      .children(PROMPTS.map(([title, fields]) => v_flex()
        .child(this.section(t, title))
        .children(fields.map(([path, label, hint]) => this.row(t, path, label, hint,
          Textarea.new(/** @type {TextareaState} */ (this.inputs[path])).w_full().p(8).rounded(7).border_1()
            .border_color(this.errors[path] ? t.blocked : t.input ?? t.border).bg(t.background).text_size(12.5),
          { stacked: true })))));
  }
}

/** The settings as their own floating window (one at a time); mod-settings/main.js opens the same. */
/** @type {import("herdr").OverlaySpec} */
export const SETTINGS_WINDOW = { kind: "window", mod: "review", props: { settings: true, float: true }, key: "review-settings", width: 680, height: 0.8 };
