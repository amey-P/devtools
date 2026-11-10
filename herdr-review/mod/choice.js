// A quick decision (review kind "choice", see bin/bridge.mjs): an agent's questions, each with options to pick.
//
// The questions are AskUserQuestion's shape: [{question, header, multiSelect, options: [{label, description, preview}]}].
// Each question gets a card: option rows (radio, or checkboxes when multiSelect), an "Other…" row with a text field, and
// an optional note. An option's `preview` (markdown) shows beside the options while that option is hovered or focused.
//
// Keys (Review.onKey hands them here first, unless a text field has the keyboard):
//   1–9   pick that option of the focused question (single choice moves on to the next unanswered question)
//   0     Other…             ↑↓  move between options      space / ↵  pick the focused option
//   tab / shift-tab  next / previous question                      ⌘↵ (the review)  submit
// The answer to a question is its picked labels in option order, joined with ", ", then the Other text, as Claude's
// AskUserQuestion reports them. Submitting needs every question answered.
import { div } from "gpui-kit";
import { v_flex, h_flex, TextView, Input, InputState } from "gpui-base";
import { tint, green, icon, kbd, stopPress } from "./ui.js";

export class ChoiceForm {
  /** `saved`: a draft (toDraft()). `onChange`: called after every change (the review saves the draft). `refocus`: give
   *  the keyboard back to the review (after Enter in a text field). */
  /** @param {any} questions @param {any} saved @param {{onChange?: () => void, refocus?: (cx?: any) => void}} [opts] */
  constructor(questions, saved, { onChange, refocus } = {}) {
    this.qs = Array.isArray(questions) ? questions : [];
    const n = this.qs.length;
    const arr = (v, f) => Array.from({ length: n }, (_, i) => (Array.isArray(v) && v[i] !== undefined && v[i] !== null ? v[i] : f()));
    this.picks = arr(saved?.picks, () => []).map((p) => new Set(Array.isArray(p) ? p : []));
    this.other = arr(saved?.other, () => "");
    this.otherOn = arr(saved?.otherOn, () => false);
    this.notes = arr(saved?.notes, () => "");
    this.noteOn = this.notes.map((x) => !!x);
    this.otherState = new Array(n).fill(null);  // InputState, made on first use (never in render)
    this.noteState = new Array(n).fill(null);
    this.fq = 0;          // focused question
    this.fo = 0;          // focused option (options.length is "Other…")
    this.typing = false;  // a text field here has the keyboard
    this.onChange = onChange ?? (() => {});
    this.refocus = refocus ?? (() => {});
  }

  release() {
    for (const s of [...this.otherState, ...this.noteState]) s?.release();
  }

  toDraft() {
    return { picks: this.picks.map((p) => [...p].sort((a, b) => a - b)), other: this.other, otherOn: this.otherOn, notes: this.notes };
  }

  /** The answer to question `i` ("" when none). */
  answerOf(i) {
    const q = this.qs[i];
    const labels = q.options.filter((_, oi) => this.picks[i].has(oi)).map((o) => o.label);
    if (this.otherOn[i] && this.other[i].trim()) labels.push(this.other[i].trim());
    return labels.join(", ");
  }

  get answered() { return this.qs.filter((_, i) => this.answerOf(i)).length; }
  get complete() { return this.qs.length > 0 && this.answered === this.qs.length; }
  get firstOpen() { return this.qs.findIndex((_, i) => !this.answerOf(i)); }

  /** What decision.json carries: {answers, notes?}. */
  result() {
    const answers = {};
    const notes = {};
    this.qs.forEach((q, i) => {
      answers[q.question] = this.answerOf(i);
      if (this.notes[i].trim()) notes[q.question] = this.notes[i].trim();
    });
    return Object.keys(notes).length ? { answers, notes } : { answers };
  }

  /** One line for toasts and the result card. */
  summary() {
    return this.qs.map((_, i) => this.answerOf(i)).filter(Boolean).join(" · ");
  }

  // ---- changes -----------------------------------------------------------------

  pick(qi, oi, cx) {
    const q = this.qs[qi];
    if (!q) return;
    this.fq = qi;
    this.fo = oi;
    if (oi >= q.options.length) { this.toggleOther(qi, cx); return; }
    const p = this.picks[qi];
    if (q.multiSelect) { if (p.has(oi)) p.delete(oi); else p.add(oi); }
    else {
      const again = p.has(oi);
      p.clear();
      this.otherOn[qi] = false;
      if (!again) p.add(oi);
      // A single choice made: on to the next question still open.
      if (!again) this.advance(qi);
    }
    this.onChange();
  }

  advance(from) {
    const n = this.qs.length;
    for (let k = 1; k < n; k++) {
      const i = (from + k) % n;
      if (!this.answerOf(i)) { this.fq = i; this.fo = 0; return; }
    }
  }

  toggleOther(qi, cx) {
    const q = this.qs[qi];
    const on = !this.otherOn[qi];
    this.otherOn[qi] = on;
    this.fq = qi;
    this.fo = q.options.length;
    if (on && !q.multiSelect) this.picks[qi].clear();
    if (on) this.focusField("other", qi, cx);
    else if (this.otherState[qi]) this.refocus();
    this.onChange();
  }

  toggleNote(qi, cx) {
    this.noteOn[qi] = !this.noteOn[qi];
    if (this.noteOn[qi]) this.focusField("note", qi, cx);
    else { this.notes[qi] = ""; this.noteState[qi]?.set_value(""); this.refocus(); this.onChange(); }
  }

  /** The text field (made now if it's new: this runs in a handler, not in render) and the keyboard on it. */
  focusField(which, qi, cx) {
    const states = which === "other" ? this.otherState : this.noteState;
    const values = which === "other" ? this.other : this.notes;
    if (!states[qi]) {
      const s = InputState.new({ placeholder: which === "other" ? "Your answer…" : "A note for the agent (optional)…", value: values[qi] ?? "" });
      s.on("change", () => { values[qi] = s.value(); this.onChange(); });
      s.on("focus", (_e, cx) => { this.typing = true; this.fq = qi; cx.notify(); });
      s.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
      s.on("submit", (_e, cx) => { this.typing = false; this.refocus(); cx.notify(); });
      states[qi] = s;
    }
    const s = states[qi];
    if (cx?.timer) cx.timer.after(30, () => s.focus());
    else s.focus();
  }

  /** A key for the form; true when it was used. `k` is the keystroke with ctrl- read as cmd-. */
  onKey(k, cx) {
    // Esc in a text field: back to the options (the window stays).
    if (this.typing) { if (k !== "escape") return false; this.typing = false; this.refocus(); return true; }
    if (!this.qs.length) return false;
    const q = this.qs[this.fq];
    const rows = q.options.length + 1;
    if (/^[1-9]$/.test(k)) {
      const oi = Number(k) - 1;
      if (oi >= q.options.length) return false;
      this.pick(this.fq, oi, cx);
    } else if (k === "0" || k === "o") this.pick(this.fq, q.options.length, cx);
    else if (k === "down" || k === "j") this.fo = (this.fo + 1) % rows;
    else if (k === "up" || k === "k") this.fo = (this.fo - 1 + rows) % rows;
    else if (k === "space" || k === "enter") this.pick(this.fq, this.fo, cx);
    else if (k === "tab") { this.fq = (this.fq + 1) % this.qs.length; this.fo = 0; }
    else if (k === "shift-tab") { this.fq = (this.fq - 1 + this.qs.length) % this.qs.length; this.fo = 0; }
    else return false;
    return true;
  }

  // ---- view --------------------------------------------------------------------

  /** `open`: the review still takes an answer. `sz`: the review's text scaler. `narrow`: previews go under the options. */
  render(t, { open, sz, narrow }) {
    return v_flex().w_full().gap(14).children(this.qs.map((q, qi) => this.renderQuestion(q, qi, t, { open, sz, narrow })));
  }

  renderQuestion(q, qi, t, { open, sz, narrow }) {
    const focused = open && qi === this.fq;
    const answer = this.answerOf(qi);
    const c = t.accent;
    const hasPreview = q.options.some((o) => o.preview);
    const shownPreview = hasPreview ? (q.options[qi === this.fq ? this.fo : -1]?.preview
      ?? q.options.find((_, oi) => this.picks[qi].has(oi))?.preview ?? q.options.find((o) => o.preview)?.preview) : null;

    const options = v_flex().flex_1().min_w(0).gap(6)
      .children(q.options.map((o, oi) => this.renderOption(q, qi, o, oi, t, { open, sz })))
      .child(this.renderOther(q, qi, t, { open, sz }));
    const preview = shownPreview && div().flex_1().min_w(0).p(12).rounded(9).bg(t.surface).border_1().border_color(t.border)
      .text_size(sz(12.5)).child(TextView.markdown(`chp-${qi}`, shownPreview).selectable(true));

    return v_flex().id(`chq-${qi}`).relative().w_full().gap(10).p(16).rounded(12).bg(t.background).border_1()
      .border_color(focused ? tint(c, "88") : t.border).shadow_sm()
      .when(open, (el) => el.on_mouse_down("left", () => { if (this.fq !== qi) { this.fq = qi; this.fo = 0; } }))
      .child(h_flex().gap(8).items_center()
        .when(!!q.header, (el) => el.child(div().flex_none().h(18).px(6).rounded(5).flex().items_center().text_size(sz(10)).font_semibold()
          .bg(tint(c, "22")).text_color(c).child(q.header.toUpperCase())))
        .child(div().text_size(sz(10.5)).text_color(t.dim).child(q.multiSelect ? "Pick any" : "Pick one"))
        .child(div().flex_1())
        .when(!!answer, (el) => el.child(h_flex().flex_none().gap(4).items_center().text_size(sz(11)).text_color(green(t))
          .child(icon("check", 11)).child("Answered"))))
      .child(div().text_size(sz(15)).font_semibold().whitespace_normal().child(q.question))
      .child(narrow || !preview
        ? v_flex().w_full().gap(10).child(options).when(!!preview, (el) => el.child(preview))
        : h_flex().w_full().gap(12).items_start().child(options).child(preview))
      .child(this.renderNote(qi, t, { open, sz }));
  }

  renderOption(q, qi, o, oi, t, { open, sz }) {
    const picked = this.picks[qi].has(oi);
    const focused = open && qi === this.fq && oi === this.fo;
    const c = t.accent;
    return h_flex().id(`cho-${qi}-${oi}`).w_full().gap(10).px(12).py(9).items_start().rounded(9).border_1()
      .border_color(picked ? c : focused ? tint(c, "66") : t.border).bg(picked ? tint(c, "16") : focused ? t.hover : t.surface)
      .when(open, (el) => el.cursor_pointer().hover((s) => s.border_color(tint(c, "aa")))
        .on_hover((h, cx) => { if (h && (this.fq !== qi || this.fo !== oi)) { this.fq = qi; this.fo = oi; cx.notify(); } })
        .on_click((_e, cx) => { this.pick(qi, oi, cx); this.refocus(); cx.notify(); }))
      .child(div().pt(2).child(this.mark(q.multiSelect, picked, t)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(sz(13)).font_medium().whitespace_normal().child(o.label))
        .when(!!o.description, (el) => el.child(div().text_size(sz(12)).text_color(t.muted).whitespace_normal().child(o.description))))
      .when(open && oi < 9, (el) => el.child(div().pt(1).child(kbd(String(oi + 1), t.dim))));
  }

  renderOther(q, qi, t, { open, sz }) {
    const on = this.otherOn[qi];
    const oi = q.options.length;
    const focused = open && qi === this.fq && this.fo === oi;
    const c = t.accent;
    const s = this.otherState[qi];
    const row = h_flex().id(`cho-${qi}-other`).w_full().gap(10).px(12).py(9).items_center().rounded(9).border_1()
      .border_color(on ? c : focused ? tint(c, "66") : t.border).bg(on ? tint(c, "16") : focused ? t.hover : t.surface)
      .when(open, (el) => el.cursor_pointer().hover((st) => st.border_color(tint(c, "aa")))
        .on_hover((h, cx) => { if (h && (this.fq !== qi || this.fo !== oi)) { this.fq = qi; this.fo = oi; cx.notify(); } })
        .on_click((_e, cx) => { this.toggleOther(qi, cx); cx.notify(); }))
      .child(this.mark(q.multiSelect, on, t))
      .child(div().flex_1().text_size(sz(13)).text_color(on ? t.foreground : t.muted).child("Other…"))
      .when(open, (el) => el.child(kbd("0", t.dim)));
    // The field: live once it exists; a restored draft shows its text until clicked (states are made in handlers).
    const field = on && (open && s
      ? div().pl(26).on_mouse_down("left", stopPress).child(Input.new(s).w_full().h(32).px(10).items_center().rounded(7).border_1()
        .border_color(tint(c, "88")).bg(t.background).text_size(sz(13)))
      : div().id(`cho-${qi}-other-text`).ml(26).h(32).px(10).flex().items_center().rounded(7).border_1().border_color(t.border)
        .bg(t.background).text_size(sz(13)).text_color(this.other[qi] ? t.foreground : t.dim)
        .when(open, (el) => el.cursor_text().on_click((_e, cx) => { this.focusField("other", qi, cx); cx.notify(); }))
        .child(this.other[qi] || "Your answer…"));
    return v_flex().w_full().gap(6).child(row).when(!!field, (el) => el.child(field));
  }

  renderNote(qi, t, { open, sz }) {
    const on = this.noteOn[qi];
    const s = this.noteState[qi];
    if (!on) {
      return open ? h_flex().child(div().id(`chn-${qi}`).flex_none().h(22).px(6).gap(5).flex().items_center().rounded(5).text_size(sz(11.5))
        .text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.toggleNote(qi, cx); cx.notify(); })
        .child(icon("comment", 11)).child("Add a note")) : div();
    }
    const box = open && s
      ? div().flex_1().on_mouse_down("left", stopPress).child(Input.new(s).w_full().h(30).px(10).items_center().rounded(7).border_1()
        .border_color(t.border).bg(t.surface).text_size(sz(12.5)))
      : div().id(`chn-${qi}-text`).flex_1().min_h(30).px(10).py(6).rounded(7).border_1().border_color(t.border).bg(t.surface)
        .text_size(sz(12.5)).whitespace_normal().text_color(this.notes[qi] ? t.foreground : t.dim)
        .when(open, (el) => el.cursor_text().on_click((_e, cx) => { this.focusField("note", qi, cx); cx.notify(); }))
        .child(this.notes[qi] || "A note for the agent (optional)…");
    return h_flex().w_full().gap(6).items_center()
      .child(div().flex_none().text_color(t.dim).child(icon("comment", 12)))
      .child(box)
      .when(open, (el) => el.child(div().id(`chn-${qi}-rm`).flex_none().w(22).h(22).rounded(5).flex().items_center().justify_center()
        .text_color(t.dim).cursor_pointer().tooltip("Remove the note").hover((st) => st.bg(t.hover).text_color(t.blocked))
        .on_click((_e, cx) => { this.toggleNote(qi, cx); cx.notify(); }).child(icon("trash", 12))));
  }

  /** A radio dot or a checkbox. */
  mark(multi, on, t) {
    const c = t.accent;
    const box = div().w(16).h(16).flex_none().border_1().border_color(on ? c : t.dim).flex().items_center().justify_center();
    return multi
      ? box.rounded(4).when(on, (el) => el.bg(c).text_color(t.background).child(icon("check", 11)))
      : box.rounded_full().when(on, (el) => el.child(div().w(8).h(8).rounded_full().bg(c)));
  }
}
