// The review inbox: every review in the spool (data/review/<id>/, see bin/bridge.mjs), what needs you first.
//
// Opened as a floating window by the review-inbox mod (ctrl-shift-i), which gives the review mod props {inbox: true}.
// Needs you: plans and asks an agent is waiting on (pending), and send-mode reviews with unsent notes (draft) or not
// yet answered (open). Resolved: approved, changes requested, sent, dismissed, replaced (the last 7 days, as the
// bridge's gc keeps them). Versions collapse into their newest: like the bridge, a new request replaces the one
// the same agent made of the same kind.
// Click or Enter: reopen the review where it was left (its notes are in draft.json). Esc closes the inbox.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as fs from "fs/promises";
import { theme, agents, panes, exec, run, notify, watchFolder, openOverlay, closeOverlay } from "herdr";
import {
  AGENT_NAMES, green, tint, plural, readJson, ago, readConfig, stopPress, icon, wash, dot, btn,
  spool, isReviewId, readReview, openReviewWindow, scaler, withFont,
} from "./ui.js";
import { SETTINGS_WINDOW } from "./settings.js";

const WEEK = 7 * 86400e3;
const FILTERS = [["all", "All"], ["plan", "Plans"], ["ask", "Asks"]];
const STATE = {
  pending: { label: "Waiting for you", color: (t) => t.blocked, pulse: true },
  draft: { label: "Unsent notes", color: (t) => t.accent },
  open: { label: "Feedback wanted", color: (t) => t.accent },
  orphaned: { label: "Agent gone", color: (t) => t.dim },
  approved: { label: "Approved", color: (t) => green(t) },
  changes: { label: "Changes requested", color: (t) => t.accent },
  sent: { label: "Sent", color: (t) => green(t) },
  dismissed: { label: "Dismissed", color: (t) => t.dim },
  replaced: { label: "Replaced", color: (t) => t.dim },
  interrupted: { label: "Agent stopped waiting", color: (t) => t.dim },
};

export class Inbox {
  constructor(overlay, cx) {
    this.overlay = overlay;
    this.h = cx.focus_handle();
    this.items = [];
    this.loaded = false;
    this.filter = "all";
    this.sel = 0;
    this.closing = false;
    this.sz = scaler(null);
    cx.spawn(async (cx) => { try {
      // Without a direct fs call first, this task stalls in the app's runtime and the inbox stays on "Loading…".
      await fs.exists(spool());
      this.cfg = await readConfig();
      this.sz = scaler(this.cfg);
      await this.load();
      cx.notify();
      this.h.focus();
      for (;;) {
        try { await watchFolder(spool()); } catch { break; }
        // The folder holds config.json too: settings saved elsewhere apply here.
        this.cfg = await readConfig();
        this.sz = scaler(this.cfg);
        await this.load();
        cx.notify();
      }
      // No watcher: poll gently.
      cx.timer.every(3000, (cx) => { cx.spawn(async (cx) => { await this.load(); cx.notify(); }); });
    } catch (e) { notify({ title: "Review inbox", body: `Could not load: ${e?.message ?? e}`, level: "error" }); } });
    cx.timer.every(60000, (cx) => cx.notify());
  }

  close() {}

  closeWindow() {
    if (this.closing || !this.overlay) return;
    this.closing = true;
    closeOverlay(this.overlay);
  }

  async load() {
    let ids = [];
    try { ids = (await fs.readdir(spool())).filter(isReviewId); } catch {}
    const all = (await Promise.all(ids.map(readReview))).filter(Boolean);
    const live = new Set(agents().map((a) => a.address));
    for (const r of all) {
      r.live = live.has(r.req.terminal);
      // Waiting, but its agent is gone (killed without cleaning up): nothing will read a decision.
      if (r.state === "pending" && !r.live) { r.state = "orphaned"; r.needsYou = false; }
    }
    // Versions: show the newest, count the rest.
    const groups = new Map();
    for (const r of all) {
      const k = groupKey(r.req);
      const g = groups.get(k);
      if (!g) groups.set(k, [r]);
      else g.push(r);
    }
    const shown = [];
    for (const g of groups.values()) {
      g.sort((a, b) => b.req.created - a.req.created);
      const top = g[0];
      top.versions = g.length;
      shown.push(top);
    }
    const now = Date.now();
    const needs = shown.filter((r) => r.needsYou)
      .sort((a, b) => (a.state === "pending") === (b.state === "pending") ? a.req.created - b.req.created : a.state === "pending" ? -1 : 1);
    const done = shown.filter((r) => !r.needsYou && now - r.at < WEEK).sort((a, b) => b.at - a.at);
    const prev = this.visible[this.sel]?.id;
    this.items = [...needs, ...done];
    this.loaded = true;
    const i = this.visible.findIndex((r) => r.id === prev);
    this.sel = i >= 0 ? i : Math.min(this.sel, Math.max(0, this.visible.length - 1));
  }

  get visible() {
    return this.filter === "all" ? this.items : this.items.filter((r) => (r.req.kind ?? "plan") === this.filter);
  }

  // ---- actions ---------------------------------------------------------------

  async open(r) {
    // Already showing as a split or tab beside its agent: go there.
    const meta = await readJson(`${r.dir}/meta.json`);
    if (meta?.pane && panes().some((p) => p.pane === meta.pane)) { run("pane.focus", { pane: meta.pane }); return; }
    await openReviewWindow(r.id, r.req, this.cfg ?? (await readConfig()));
  }

  async dismiss(r, cx) {
    await fs.writeFile(`${r.dir}/decision.json`, JSON.stringify({ decision: "dismissed", at: Date.now() })).catch(() => {});
    await this.load();
    cx.notify();
  }

  async discard(r, cx) {
    // Every version of it.
    const k = groupKey(r.req);
    let ids = [r.id];
    try {
      const all = (await fs.readdir(spool())).filter(isReviewId);
      const reqs = await Promise.all(all.map((id) => readJson(`${spool()}/${id}/request.json`)));
      ids = all.filter((_, i) => reqs[i] && groupKey(reqs[i]) === k);
    } catch {}
    try { await exec("rm", ["-rf", ...ids.map((id) => `${spool()}/${id}`)]); }
    catch (e) { notify({ title: "Review inbox", body: `Could not discard: ${e?.message ?? e}`, level: "error" }); }
    await this.load();
    cx.notify();
  }

  onKey(e, cx) {
    const k = e.keystroke;
    const list = this.visible;
    if (k === "escape") this.closeWindow();
    else if (k === "down" || k === "j") this.sel = Math.min(list.length - 1, this.sel + 1);
    else if (k === "up" || k === "k") this.sel = Math.max(0, this.sel - 1);
    else if (k === "enter" && list[this.sel]) cx.spawn(async () => this.open(list[this.sel]));
    else if (k === "tab") { const i = FILTERS.findIndex(([f]) => f === this.filter); this.filter = FILTERS[(i + 1) % FILTERS.length][0]; this.sel = 0; }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- view ------------------------------------------------------------------

  render(cx) {
    const t = theme();
    const list = this.visible;
    const needs = list.filter((r) => r.needsYou);
    const done = list.filter((r) => !r.needsYou);
    const root = withFont(v_flex(), this.cfg).id("inbox").relative().track_focus(this.h).size_full().bg(t.canvas).text_color(t.foreground)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => this.h.focus());
    const section = (label, n, color) => h_flex().px(16).pt(14).pb(6).gap(8).items_center()
      .child(div().text_size(10.5).font_semibold().text_color(color).child(label))
      .child(div().h(16).px(5).rounded(8).flex().items_center().text_size(10).font_semibold().bg(tint(color, "22")).text_color(color).child(String(n)));
    let idx = 0;
    const rows = (rs) => rs.map((r) => this.renderRow(r, idx++, t));
    return root
      .child(this.renderHeader(t))
      .child(div().id("inbox-list").flex_1().min_h(0).overflow_y_scrollbar()
        // The list keeps its presses (the window drags by its header).
        .on_mouse_down("left", (_e, cx) => { this.h.focus(); cx.stop_propagation(); })
        .when(!this.loaded, (el) => el.child(div().p(24).text_size(13).text_color(t.dim).child("Loading…")))
        .when(this.loaded && !list.length, (el) => el.child(v_flex().p(30).gap(10).items_center().text_color(t.dim)
          .child(div().mt(20).w(40).h(40).rounded_full().bg(t.raised).flex().items_center().justify_center().text_color(t.muted).child(icon("check", 18)))
          .child(div().text_size(13).font_semibold().text_color(t.muted).child("Nothing here"))
          .child(div().text_size(12.5).text_center().whitespace_normal().child("Plans and documents agents send for review show up here. Close a review with ✕ or Esc to come back to it later."))))
        .when(needs.length > 0, (el) => el.child(section("NEEDS YOU", needs.length, t.accent)).children(rows(needs)))
        .when(done.length > 0, (el) => el.child(section("RESOLVED · LAST 7 DAYS", done.length, t.dim)).children(rows(done)))
        .child(div().h(12)));
  }

  renderHeader(t) {
    const waiting = this.items.filter((r) => r.state === "pending").length;
    const color = waiting ? t.blocked : t.accent;
    const chip = (f, label) => {
      const n = f === "all" ? this.items.length : this.items.filter((r) => (r.req.kind ?? "plan") === f).length;
      const on = this.filter === f;
      return h_flex().id(`inbox-f-${f}`).h(24).px(8).gap(5).items_center().rounded(6).text_size(12).font_medium().cursor_pointer()
        .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.background).shadow_sm())
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.filter = f; this.sel = 0; cx.notify(); })
        .child(label).child(div().text_size(10.5).text_color(t.dim).child(String(n)));
    };
    return v_flex().relative().flex_none().bg(t.chrome).border_b_1().border_color(t.border)
      .child(wash(tint(color, "1c"), tint(t.chrome, "00"), 90))
      .child(h_flex().relative().h(54).pl(16).pr(10).gap(10).items_center()
        .child(div().w(30).h(30).rounded(8).flex_none().bg(tint(color, "22")).border_1().border_color(tint(color, "44"))
          .text_color(color).flex().items_center().justify_center().child(icon("comment", 15)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().child("Review inbox"))
          .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
            .child(dot(color, waiting > 0, 7))
            .child(waiting ? `${plural(waiting, "agent")} waiting on you` : "No agent is waiting")))
        .child(h_flex().flex_none().gap(4).items_center().on_mouse_down("left", stopPress)
          .child(btn("inbox-settings", t, { ic: "settings", tooltip: "Review settings", onClick: () => openOverlay(SETTINGS_WINDOW) }))
          .when(!!this.overlay, (el) => el.child(btn("inbox-close", t, { ic: "x", tooltip: "Close (esc)", onClick: () => this.closeWindow() })))))
      .child(h_flex().relative().px(12).pb(10).gap(8).items_center()
        .child(h_flex().p(3).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border).on_mouse_down("left", stopPress)
          .children(FILTERS.map(([f, l]) => chip(f, l))))
        .child(div().flex_1())
        .child(div().text_size(10.5).text_color(t.dim).child("↑↓ select · ↵ open · tab filter")));
  }

  renderRow(r, i, t) {
    const st = STATE[r.state] ?? STATE.interrupted;
    const c = st.color(t);
    const sel = i === this.sel;
    const req = r.req;
    const live = agents().find((a) => a.address === req.terminal);
    const p = live?.program;
    const who = p?.name ?? AGENT_NAMES[req.agent] ?? AGENT_NAMES[req.parent?.app] ?? "Agent";
    const where = [live?.space_name ?? req.parent?.space_name, live?.tab_name ?? req.parent?.tab_name].filter(Boolean).join(" › ");
    const ic = p?.icon
      ? (p.tint ? svg(p.icon).size(16).flex_none().text_color(p.color ?? t.foreground) : image(p.icon).w(16).h(16).flex_none())
      : div().w(16).h(16).rounded(4).bg(tint(t.accent, "55")).flex_none();
    const kind = req.kind === "plan" ? "PLAN" : req.mode === "send" ? "DOC" : "ASK";
    const deferred = r.seen?.deferred_at && r.needsYou;
    const fresh = r.needsYou && !r.seen?.opened_at;
    const time = r.needsYou ? `${r.state === "pending" ? "waiting " : ""}${ago(req.created)}` : ago(r.at);
    const meta = [who, where, time].filter(Boolean);
    const sub = (s) => div().flex_none().child(s);
    return h_flex().id(`inbox-r-${r.id}`).relative().mx(10).mb(6).pl(14).pr(8).py(9).gap(10).items_center().rounded(10)
      .bg(sel ? t.selected : t.background).border_1().border_color(sel ? tint(t.accent, "88") : t.border)
      .when(!r.needsYou, (el) => el.opacity(0.75))
      .cursor_pointer().hover((s) => s.border_color(tint(t.accent, "66")))
      .on_click((_e, cx) => { this.sel = i; cx.spawn(async () => this.open(r)); cx.notify(); })
      .child(div().absolute().top(8).bottom(8).left(0).w(3).rounded(2).bg(c))
      .child(div().w(30).h(30).rounded(8).flex_none().bg(t.raised).border_1().border_color(t.border).flex().items_center().justify_center().child(ic))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(7).items_center().min_w(0)
          .child(div().min_w(0).truncate().text_size(this.sz(13.5)).font_semibold().child(req.title ?? "Review"))
          .child(div().flex_none().h(16).px(5).rounded(4).flex().items_center().text_size(this.sz(9.5)).font_semibold().bg(t.raised).text_color(t.muted).child(kind))
          .when(r.versions > 1 || (req.version ?? 1) > 1, (el) => el.child(div().flex_none().text_size(this.sz(10.5)).text_color(t.dim)
            .child(`v${req.version ?? r.versions}${r.versions > 1 ? ` · ${plural(r.versions, "version")}` : ""}`)))
          .when(fresh, (el) => el.child(div().flex_none().h(16).px(5).rounded(4).flex().items_center().text_size(this.sz(9.5)).font_semibold()
            .bg(tint(t.accent, "26")).text_color(t.accent).child("NEW"))))
        .child(h_flex().gap(6).items_center().text_size(this.sz(11.5)).text_color(t.dim).min_w(0)
          .child(dot(c, !!st.pulse, 6))
          .child(div().flex_none().text_color(r.needsYou ? c : t.dim).child(st.label))
          .children(meta.flatMap((m) => [sub("·"), div().min_w(0).truncate().child(m)]))
          .when(r.notes > 0, (el) => el.child(sub("·")).child(h_flex().flex_none().gap(3).items_center().child(icon("comment", 10)).child(String(r.notes))))
          .when(!!deferred, (el) => el.child(sub("·")).child(sub(`put off ${ago(r.seen.deferred_at)}`)))))
      .child(h_flex().flex_none().gap(2).items_center().on_mouse_down("left", stopPress)
        .when(r.live, (el) => el.child(btn(`inbox-go-${r.id}`, t, { ic: "send", tooltip: `Go to ${who}`,
          onClick: (cx) => { cx.stop_propagation(); run("agent.focus", { terminal: req.terminal }); } })))
        .when(r.state === "pending", (el) => el.child(btn(`inbox-dis-${r.id}`, t, { ic: "x",
          tooltip: `Dismiss: ${who} falls back to its own prompt`, onClick: (cx) => { cx.stop_propagation(); cx.spawn(async (cx) => this.dismiss(r, cx)); } })))
        .when(r.state !== "pending", (el) => el.child(btn(`inbox-rm-${r.id}`, t, { ic: "trash",
          tooltip: r.versions > 1 ? `Discard all ${r.versions} versions` : "Discard", onClick: (cx) => { cx.stop_propagation(); cx.spawn(async (cx) => this.discard(r, cx)); } }))));
  }
}

/** Requests of one agent and kind (and session, when it has one) are versions of each other. */
const groupKey = (req) => `${req.terminal}|${req.kind ?? "plan"}|${req.session ?? ""}`;
