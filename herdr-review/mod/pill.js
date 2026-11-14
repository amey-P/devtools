// The arrival pill: reviews that came in while the person was on another workspace wait here instead of opening
// over their work. The launcher (main.js launch) marks them meta.json {pill: true} and opens this as a small
// frameless window at the top of the Herdr window (props {pill: true}, key "review-pill").
//
// Click: open the newest one where the settings say (a floating window, or beside its agent: Herdr goes there).
// ✕: later, they wait in the review inbox. Switching to an item's workspace opens it there quietly.
// Items that are decided, dismissed or cancelled elsewhere drop out; with none left the pill closes itself.
/** @import { ReviewRecord } from "./types"
 *  @import { Context, AsyncContext } from "gpui-kit" */
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import * as fs from "fs/promises";
import { theme, focused, watchFolder, closeOverlay, run } from "herdr";
import {
  AGENT_NAMES, readJson, readConfig, readReview, isReviewId, spool, dot, icon, tint, stopPress, clip, openReviewPlaced,
  openInboxAction, withFont, Appear, ENTER, EXIT, SPRING, glowPhase, wash,
} from "./ui.js";

export class Pill {
  /** `overlay`: this frameless window's id (closes it), null when constructed without one.
   *  `cx`: the pill view's init context.
   *  @param {string | null} overlay @param {AsyncContext} cx */
  constructor(overlay, cx) {
    this.overlay = overlay;
    /** @type {ReviewRecord[]} */
    this.items = [];
    this.loaded = false;
    this.appear = new Appear(cx); // the bar draws once hidden, then the native transition brings it in
    this.closing = false;
    this.leaving = false; // the bar is animating out before the window closes
    /** @type {ReviewRecord | null} */
    this.last = null;     // the record last drawn: the leaving bar keeps showing it
    this.w = 0;           // measured window width: the bar grows from a narrower width to it (a scale-in)
    this.cfg = null;
    this.busy = false;
    cx.spawn(async (cx) => {
      this.cfg = await readConfig();
      await this.load();
      if (this.done()) return;
      cx.notify();
      for (;;) {
        try { await watchFolder(spool()); } catch { break; }
        this.cfg = await readConfig();
        await this.load();
        if (this.done()) return;
        cx.notify();
      }
      cx.timer.every(3000, (cx) => { cx.spawn(async (cx) => { await this.load(); if (!this.done()) cx.notify(); }); });
    });
    // The person walked into an item's workspace: open it there, quietly. A data check (no redraw unless it changes).
    cx.timer.every(400, (cx) => {
      if (this.busy || !this.loaded) return;
      const space = focused()?.space;
      const here = space && this.items.find((r) => r.req.space === space);
      if (!here) return;
      this.busy = true;
      cx.spawn(async (cx) => {
        try { await this.open(here, true); } finally { this.busy = false; }
        if (!this.done()) cx.notify();
      });
    });
  }

  /** Reviews waiting on the pill, newest first. */
  async load() {
    /** @type {string[]} */
    let ids = [];
    try { ids = (await fs.readdir(spool())).filter(isReviewId); } catch {}
    const metas = await Promise.all(ids.map((id) => readJson(`${spool()}/${id}/meta.json`)));
    const waiting = ids.filter((_id, i) => metas[i]?.pill);
    const all = (await Promise.all(waiting.map(readReview))).filter((r) => r && r.needsYou);
    this.items = all.sort((a, b) => b.req.created - a.req.created);
    this.loaded = true;
  }

  /** Nothing left: close. True when closed (or closing). */
  done() {
    if (this.loaded && !this.items.length) this.closeWindow();
    return this.closing;
  }

  closeWindow() {
    if (this.closing || !this.overlay) return;
    this.closing = true;
    // The bar (still drawn from `last`) lifts away and fades, then the window goes.
    const acx = this.appear.acx;
    try {
      if (!acx || !this.last) throw 0;
      this.leaving = true;
      acx.notify();
      acx.timer.after(EXIT.duration + 20, () => closeOverlay(/** @type {string} */ (this.overlay)));
    } catch { closeOverlay(this.overlay); }
  }

  close() {}

  /** Opens review `r` where the settings say (quietly when `gentle`).
   *  @param {ReviewRecord} r @param {boolean} gentle */
  async open(r, gentle) {
    this.items = this.items.filter((x) => x.id !== r.id);
    // openReviewPlaced rewrites meta.json (no more `pill`), so the watcher won't bring it back.
    await openReviewPlaced(r.id, r.req, this.cfg ?? (await readConfig()), { gentle });
  }

  /** ✕: every waiting review goes to the inbox. */
  async later() {
    await Promise.all(this.items.map((r) =>
      fs.writeFile(`${r.dir}/meta.json`, JSON.stringify({ inbox: true, pane: null })).catch(() => {})));
    this.items = [];
    this.closeWindow();
  }

  /** The pill bar. `cx`: the render context.
   *  @param {Context} cx */
  render(cx) {
    const t = theme();
    const r = this.items[0] ?? (this.leaving ? this.last : null);
    const root = div().id("pill-root").size_full().relative()
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.w) > 1) { this.w = size.width; cx.notify(); } });
    if (!r) return root;
    this.last = r;
    const who = AGENT_NAMES[r.req.agent] ?? AGENT_NAMES[r.req.parent?.app] ?? "An agent";
    const what = r.req.kind === "plan" ? `Plan from ${who}` : r.req.kind === "choice" ? `${who} asks you to decide` : `${who} asks for a review`;
    const where = [r.req.parent?.space_name, r.req.parent?.tab_name].filter(Boolean).join(" › ");
    const more = this.items.length - 1;
    const color = r.req.kind === "plan" ? t.accent : t.ansi3 ?? t.accent;

    // Entrance: drops in from above on a spring (a small overshoot), widening from a narrower bar to full width
    // (a scale-in from the centre), while an accent flash blooms inside and settles; the content resolves just after
    // the shell lands. Exit: a quick ease-in lift and fade.
    const shown = this.appear.is("bar") && !this.leaving;
    const phase = this.leaving ? 2 : glowPhase(this.appear, "bar", 320);
    const inset = shown ? 0 : 18;
    const exitPol = this.leaving ? EXIT : null;
    /** @param {import("gpui-kit").Element} el @param {number} delay */
    const late = (el, delay) => el.opacity(shown ? 1 : 0).transition("opacity", exitPol ?? { ...ENTER, delay });
    const bar = h_flex().id("pill").absolute().top(shown ? 1 : -14)
      .when(this.w > 0, (el) => el.left(inset).w(Math.max(0, this.w - inset * 2)).spring("left", SPRING).spring("width", SPRING))
      .when(!this.w, (el) => el.left(0).w_full())
      .h(36).opacity(shown ? 1 : 0).transition("opacity", exitPol ?? ENTER)
      .spring("top", SPRING)
      .overflow_hidden().pl(14).pr(6).gap(10).items_center().rounded_full()
      .bg(t.popover).border_1().border_color(tint(color, "66")).shadow_md()
      .text_color(t.foreground).cursor_pointer()
      .hover((s) => s.bg(t.hover).border_color(color))
      .on_mouse_down("left", stopPress)
      .on_click((_e, cx) => { cx.stop_propagation(); cx.spawn(async (cx) => { await this.open(r, false); if (!this.done()) cx.notify(); }); })
      .tooltip(more ? `Open the newest review (${more} more in the inbox, ctrl-shift-i)` : "Open the review")
      // Accent flash: blooms bright as the bar lands, then settles to a faint ambient wash.
      .child(div().absolute().top(0).left(0).size_full().opacity(phase === 0 ? 0 : phase === 1 ? 1 : 0.35)
        .transition("opacity", phase === 2 ? { duration: 900, easing: "ease-out" } : { duration: 160, easing: "ease-out" })
        .child(wash(tint(color, "40"), tint(color, "00"))))
      .child(late(div().flex_none(), 40).child(dot(color, true, 7)))
      .child(late(h_flex().flex_1().min_w(0).overflow_hidden().gap(5).text_size(12.5), 90)
        .child(div().flex_none().font_medium().child(clip(what, 34)))
        .when(!!where, (el) => el.child(div().min_w(0).truncate().text_color(t.muted).child(`· ${where}`))))
      .when(more > 0, (el) => el.child(late(div(), 140).id("pill-more").flex_none().h(20).px(7).rounded_full()
        .flex().items_center().text_size(11).font_medium().bg(tint(color, "24")).text_color(color)
        .on_mouse_down("left", stopPress)
        .on_click((_e, cx) => { cx.stop_propagation(); run(openInboxAction.name, openInboxAction.args); })
        .child(`+${more}`)))
      .child(late(div(), 170).id("pill-later").flex_none().w(24).h(24).rounded_full().flex().items_center().justify_center()
        .text_color(t.dim).hover((s) => s.bg(t.selected).text_color(t.foreground))
        .tooltip("Later: wait in the review inbox")
        .on_mouse_down("left", stopPress)
        .on_click((_e, cx) => { cx.stop_propagation(); cx.spawn(async () => this.later()); })
        .child(icon("x", 12)));
    return withFont(root, this.cfg).child(bar);
  }
}
