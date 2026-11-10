// Review: a document, block by block, to annotate and then send to an agent.
//
// Kinds (what is reviewed) and modes (how it ends):
//   plan   an agent's plan (bin/bridge.mjs, from the Claude hook / pi submit_plan)   decision: Approve / Request changes
//   ask    an agent ran bin/review.mjs                                              decision with --wait, else send
//   file   props {kind: "file", file, on?}: a file, live-reloaded (markdown's Review)  send
//   reply  props {kind: "reply"}: the last reply of the agent in this tab (ctrl-shift-r)  send
// Bridge-made reviews get props {id}; the request lives in <app home>/data/review/<id>/ (see bridge.mjs).
// Placement (bin/config.mjs, <app home>/data/review/config.json): a floating window (default), a split or a tab.
// Opened with `mod.open {name: "review"}` (no props, as an overlay), this copy is the launcher: it opens the
// floating windows the bridge queued in data/review/.float/, or, with none queued, the reply review of the
// focused tab where the config says (ctrl-shift-r), then closes itself.
// Floating copies get props {float: true, overlay}: drag them by the header; ✕ or Esc closes.
// Send mode types the feedback into the agent's terminal (hc send) and stays open for another round.
//
// Hover a block: a toolbar offers Comment · Delete · Replace. Select part of a block, ⌘C, then
// "Use copied text" in the note narrows the quote to that span.
// Keys while the pane has focus: ⌘Enter saves the open note, else requests changes / sends;
// ⌘⇧Enter approves (again on the "approve with notes?" prompt: approve with notes); Esc cancels.
// Bindable commands: review.submit (⌘Enter's behaviour), .send, .approve, .deny, .general, .sidebar, .refresh, .settings.
// Settings (⚙ in the header, settings.js): the window, the look (ui.*) and what the agent is told (prompts.*), saved to
// <app home>/data/review/config.json; every open review re-reads it when it changes (watchConfig).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";
import * as fs from "fs/promises";
import {
  props, theme, settings, agents, panes, focused, appHome, home, exec, hc, notify, nextCommand, watchFolder, readTextFile,
  run, openOverlay, closeOverlay,
} from "herdr";
import { splitBlocks, plain } from "./blocks.js";
import { toMarkdown, ordered } from "./feedback.js";
import {
  AGENT_NAMES, base, safe, green, tint, clip, readJson, plural, ago, readConfig, stopPress, store, icon, wash, dot, badge, btn,
  spool, isReviewId, openReviewWindow, openInboxAction, scaler, withFont, fillText,
} from "./ui.js";
import { Inbox } from "./inbox.js";
import { Settings } from "./settings.js";

const DOC_LABEL = { plan: "IMPLEMENTATION PLAN", file: "FILE", reply: "AGENT REPLY", ask: "REVIEW REQUEST" };
const MARKDOWN = /\.(md|mdx|markdown|txt|text)$/i;
const dirOf = (f) => f.replace(/[\\/][^\\/]*$/, "") || "/";
const expand = (f) => (f && f.startsWith("~/") ? home() + f.slice(1) : f);

/** Non-markdown files (code, logs) become fenced chunks, one per blank-line-separated run, so each is annotatable. */
function asMarkdown(text, file) {
  if (!file || MARKDOWN.test(file)) return text;
  const ext = (/\.([\w+-]+)$/.exec(file)?.[1] ?? "").toLowerCase();
  const chunks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).filter((c) => c.trim());
  return chunks.map((c) => { const ticks = /```/.test(c) ? "````" : "```"; return `${ticks}${ext}\n${c}\n${ticks}`; }).join("\n\n");
}
const KINDS = {
  comment: { icon: "comment", label: "Comment", verb: "Comment" },
  delete: { icon: "trash", label: "Delete", verb: "Delete" },
  replace: { icon: "pencil", label: "Replace", verb: "Replace" },
  general: { icon: "globe", label: "Global", verb: "Global comment" },
};
const WIDE = 940;

export default class Review extends View {
  init(_props, cx) {
    const p = props() ?? {};
    // The settings as their own floating window (settings.js).
    if (p.settings && p.float) { this.settingsWindow = new Settings(p.overlay ?? null, cx); return; }
    // mod.open with no props: the launcher (see the top of this file).
    if (p.overlay && !p.id && !p.kind && !p.float) {
      this.launcher = true;
      cx.spawn(async () => this.launch(p.overlay));
      return;
    }
    // The review inbox (opened by the review-inbox mod): a list, not a review.
    if (p.inbox) { this.inbox = new Inbox(p.overlay ?? null, cx); return; }
    this.id = p.id ?? null;
    this.overlay = p.overlay ?? null;  // set when this copy is a floating window
    this.floating = !!this.overlay;
    this.closing = false;
    this.h = cx.focus_handle();
    this.h.focus();  // now, so Esc closes the window even while it loads
    // A person-launched review (no spool request): what to show, and where its draft lives.
    this.launch = !this.id && (p.kind === "file" || p.kind === "reply") ? { kind: p.kind, file: expand(p.file ?? null), on: p.on ?? null } : null;
    this.pane = p.pane ?? focused()?.pane ?? null;
    this.tab = p.tab ?? panes().find((x) => x.pane === this.pane)?.tab ?? focused()?.tab ?? null;
    this.dir = this.id ? `${appHome()}/data/review/${this.id}`
      : this.launch ? `${appHome()}/data/review/pane-${safe(this.pane ?? `${this.launch.kind}-${base(this.launch.file)}`)}` : null;
    this.pickedTarget = store.get("target");
    this.lastSent = null;      // {at, md, to} after a send-mode send
    this.newer = false;        // reply: a newer reply arrived while annotating
    this.sending = false;
    this.req = null;
    this.error = null;
    this.blocks = [];
    this.anns = [];
    this.status = "loading";   // loading | open | sent | cancelled
    this.sent = null;          // the decision this pane wrote or found
    this.editing = null;       // {ann: id | null, block, type, quote, state}
    this.hovered = -1;
    this.selected = null;      // annotation id picked in the sidebar
    this.confirm = false;      // approve with annotations: ask what to do with them
    this.width = 0;
    this.seq = 0;
    this.side = store.get("side"); // "1" | "0" | null (null: open when wide)
    this.sideTab = "notes";    // notes | preview
    this.lastKey = 0;          // dedupes a chord that reaches us twice (key handler + bound command)
    this.sz = scaler(null);    // text size, scaled by the ui.textSize setting
    this.settings = null;      // the settings screen, while it's shown in place of the document

    if (!this.dir) { this.error = "Nothing to review: give props {id}, {kind: \"file\", file} or {kind: \"reply\"}."; this.status = "cancelled"; return; }

    cx.spawn(async (cx) => {
      // A failed load says so instead of showing "Loading…" for good.
      try { await this.load(); }
      catch (e) { this.error = `Couldn't open this review: ${e?.message ?? e}`; this.status = "cancelled"; this.req = null; this.launch = null; cx.notify(); return; }
      if (this.id && this.status === "open") this.markSeen({ opened_at: Date.now() });
      cx.notify();
      if (this.cfg?.window?.focus !== false) this.h.focus();
      this.watchConfig(cx);
      if (this.id) this.watchSpool(cx);
      if (this.liveFile) this.watchFile(cx);
      if (this.kind === "reply") this.watchReplies(cx);
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") { if (!this.editing) this.h.focus(); }
        else if (c === "submit") this.submitKey(cx);
        else if (c === "send") this.send(cx);
        else if (c === "approve") this.approveKey(cx);
        else if (c === "deny") this.deny(cx);
        else if (c === "general") this.startEdit(null, "general", cx);
        else if (c === "sidebar") this.toggleSide(cx);
        else if (c === "refresh") this.reloadContent(cx, true);
        else if (c === "settings") this.toggleSettings(cx);
        cx.notify();
      }
    });
    // Relative times in the sidebar.
    cx.timer.every(60000, (cx) => { if (this.status === "open") cx.notify(); });
  }

  /** The launcher: opens what the bridge queued (or the reply review), then closes itself. */
  async launch(self) {
    const cfg = await readConfig();
    const spool = `${appHome()}/data/review`;
    const queue = `${spool}/.float`;
    let ids = [];
    try { ids = (await fs.readdir(queue)).filter(isReviewId); } catch {}
    const size = { width: cfg.window.width, height: cfg.window.height };
    for (const id of ids) {
      try { await fs.unlink(`${queue}/${id}`); } catch { continue; } // another launcher took it
      const req = await readJson(`${spool}/${id}/request.json`);
      if (!req) continue;
      if (cfg.window.arrive === "inbox") {
        // Quiet arrival: a toast, and the review waits in the inbox until it's opened.
        const who = AGENT_NAMES[req.agent] ?? AGENT_NAMES[req.parent?.app] ?? "An agent";
        notify({ title: req.kind === "plan" ? `Plan from ${who}` : `Review request from ${who}`,
          body: `${req.title ?? "Review"}: waiting in the review inbox.`, level: "info", action: openInboxAction });
        await fs.writeFile(`${spool}/${id}/meta.json`, JSON.stringify({ inbox: true, pane: null })).catch(() => {});
        continue;
      }
      // One spot per agent: its next review opens where this one was dropped.
      await openReviewWindow(id, req, cfg);
    }
    if (!ids.length) {
      const f = focused();
      const reply = { kind: "reply", pane: f?.pane ?? null, tab: f?.tab ?? null };
      if (cfg.window.place === "float") openOverlay({ kind: "window", mod: "review", props: { ...reply, float: true }, key: `review-reply-${safe(f?.tab ?? "")}`, ...size });
      else if (cfg.window.place === "tab") run("tab.new", { space: f?.space, mod: "review", props: reply, name: "Review" });
      else run("pane.split", { direction: cfg.window.place === "down" ? "down" : "right", mod: "review", props: reply });
    }
    closeOverlay(self);
  }

  /** A floating window closes itself (once). */
  closeWindow() {
    if (!this.floating || this.closing) return;
    this.closing = true;
    closeOverlay(this.overlay);
  }

  /** After a decision, a floating window shows the result for a moment, then goes. */
  closeSoon(cx) {
    if (!this.floating || this.mode !== "decision") return;
    cx.timer.after(1200, () => this.closeWindow());
  }

  async close() {
    if (this.launcher) return;
    if (this.settingsWindow) { this.settingsWindow.release(); return; }
    if (this.inbox) { this.inbox.close(); return; }
    this.settings?.release();
    this.editing?.state.release();
    // Closed without a decision: later. The agent keeps waiting and the review stays in the inbox
    // (Dismiss is the way to let the agent fall back to its own prompt).
    if (this.status === "open" && this.id) await this.markSeen({ deferred_at: Date.now() });
  }

  /** Records when this review was opened / put off (seen.json, read by the inbox). */
  async markSeen(patch) {
    if (!this.id) return;
    const prev = (await readJson(`${this.dir}/seen.json`)) ?? {};
    await fs.writeFile(`${this.dir}/seen.json`, JSON.stringify({ ...prev, ...patch })).catch(() => {});
    return prev;
  }

  /** ✕ / Esc on a floating review: put it off. The first time, say where it went. */
  later() {
    if (this.status === "open" && this.id && !store.get("later-told")) {
      store.set("later-told", "1");
      const waits = this.mode === "decision" ? `${this.agentName} keeps waiting. ` : "";
      notify({ title: "Saved for later", body: `${waits}Find it in the review inbox (ctrl-shift-i).`,
        level: "info", timeout: 5000, action: openInboxAction });
    }
    this.closeWindow();
  }

  /** Let the waiting agent fall back to its own prompt (the old ✕). */
  dismiss(cx) {
    if (this.status !== "open" || this.mode !== "decision") return;
    if (this.editing) this.saveEdit(cx);
    cx.spawn(async (cx) => {
      await this.decide("dismissed", cx);
      this.closeWindow();
    });
  }

  // ---- data ------------------------------------------------------------------

  get kind() { return this.req?.kind ?? this.launch?.kind ?? "plan"; }
  get mode() { return this.req?.mode ?? (this.launch ? "send" : "decision"); }
  get file() { return this.req?.file ?? this.launch?.file ?? null; }
  /** File content reloads live: file reviews, and send-mode reviews an agent asked for on a file. */
  get liveFile() { return !!this.file && this.mode === "send"; }

  /** Agents in this pane's tab, the candidates to send to. */
  get tabAgents() {
    const all = agents();
    const tab = this.tab ?? panes().find((x) => x.pane === this.pane)?.tab;
    return tab ? all.filter((a) => a.tab === tab) : [];
  }

  /** The terminal feedback goes to (and, for replies, whose reply this is). */
  get target() {
    if (this.req?.target) return this.req.target;
    if (this.req?.terminal) return this.req.terminal;
    const list = this.tabAgents;
    if (this.pickedTarget && list.some((a) => a.address === this.pickedTarget)) return this.pickedTarget;
    return list.find((a) => a.focused)?.address ?? list.sort((a, b) => b.seq - a.seq)[0]?.address ?? null;
  }

  cycleTarget(cx) {
    const list = this.tabAgents;
    if (list.length < 2) return;
    const i = list.findIndex((a) => a.address === this.target);
    this.pickedTarget = list[(i + 1) % list.length].address;
    store.set("target", this.pickedTarget);
    if (this.kind === "reply") this.reloadContent(cx, true);
    cx.notify();
  }

  async load() {
    this.cfg = await readConfig();
    this.sz = scaler(this.cfg);
    if (this.id) {
      this.req = await readJson(`${this.dir}/request.json`);
      if (!this.req) { this.error = "This review is gone."; this.status = "cancelled"; return; }
      if (this.req.tab) this.tab = this.req.tab;
    } else {
      await fs.mkdir(this.dir, { recursive: true }).catch(() => {});
    }
    const draft = await readJson(`${this.dir}/draft.json`);
    if (Array.isArray(draft)) {
      this.anns = draft;
      this.seq = draft.reduce((m, a) => Math.max(m, Number(String(a.id).slice(1)) || 0), draft.length);
    }
    this.lastSent = (await readJson(`${this.dir}/sent.json`)) ?? null;
    if (this.liveFile || this.launch) await this.reloadContent(null, false);
    else this.setContent(this.req.content ?? this.req.plan ?? "");
    this.status = "open";
    await this.refreshStatus();
  }

  get title() {
    if (this.req?.title) return this.req.title;
    if (this.kind === "file") return base(this.file) || "File";
    if (this.kind === "reply") return `${this.agentName}'s last reply`;
    return "Review";
  }

  /** New text: re-split, and keep annotations anchored to where their quote is now. */
  setContent(text) {
    if (text === this.text) return false;
    this.text = text;
    this.blocks = splitBlocks(asMarkdown(text, this.file));
    if (this.anns.length) {
      let moved = false;
      this.anns = this.anns.map((a) => {
        if (a.type === "general" || !a.quote) return a;
        const fits = (i) => i >= 0 && i < this.blocks.length && (this.blocks[i].src.includes(a.quote) || plain(this.blocks[i].src).includes(a.quote));
        if (a.block !== null && fits(a.block)) return a.stale ? { ...a, stale: false } : a;
        // Nearest block that still holds the quote.
        let best = -1;
        for (let i = 0; i < this.blocks.length; i++) {
          if (fits(i) && (best < 0 || Math.abs(i - (a.block ?? i)) < Math.abs(best - (a.block ?? best)))) best = i;
        }
        moved = true;
        return best >= 0 ? { ...a, block: best, stale: false } : { ...a, block: null, stale: true };
      });
      if (moved) this.saveDraft();
    }
    return true;
  }

  /** Reads the file or the reply again. `manual`: the person asked (always replaces a reply). */
  async reloadContent(cx, manual) {
    let text = null;
    if (this.kind === "reply" && !this.id) {
      const t = this.target;
      if (!t) { text = ""; this.error = "No agent in this tab."; }
      else {
        const r = await readJson(`${appHome()}/data/review/replies/${safe(t)}.json`);
        if (r?.text) { text = r.text; this.replyAt = r.at; this.replySource = "hook"; }
        else {
          // No hook for this agent: its screen and recent history, as one block.
          try { text = (await hc(["read", t, "--lines", "400"])).stdout.replace(/\s+$/, ""); } catch { text = ""; }
          // One fenced chunk per blank-line-separated run, so each part is annotatable.
          text = text ? asMarkdown(text.replace(/```/g, "ˋˋˋ"), "screen.log") : "";
          this.replyAt = Date.now();
          this.replySource = "screen";
        }
        this.error = text ? null : "No reply yet.";
      }
      if (!manual && this.anns.length && this.text !== undefined && text !== this.text) { this.newer = true; cx?.notify(); return; }
    } else if (this.file) {
      try { text = await readTextFile(this.file, { on: this.launch?.on ?? null }); } catch { text = null; }
      if (text === null) { this.error = `Can't read ${this.file}.`; text = this.text ?? ""; }
      else this.error = null;
    } else return;
    this.newer = false;
    if (this.setContent(text ?? "") || manual) cx?.notify();
  }

  /** Settings saved anywhere (the settings screen, the CLI) apply to this open review. */
  watchConfig(cx) {
    const dir = `${appHome()}/data/review`;
    cx.spawn(async (cx) => {
      let last = JSON.stringify(this.cfg);
      for (;;) {
        try { await watchFolder(dir); } catch { return; }
        const cfg = await readConfig();
        const now = JSON.stringify(cfg);
        if (now === last) continue;
        last = now;
        this.cfg = cfg;
        this.sz = scaler(cfg);
        cx.notify();
      }
    });
  }

  /** The ⚙ button: the settings screen in place of the document, and back. */
  toggleSettings(cx) {
    if (this.settings) { this.settings.release(); this.settings = null; this.h.focus(); }
    else {
      if (this.editing) this.saveEdit(cx);
      this.settings = new Settings(null, cx, { onClose: () => { this.settings?.release(); this.settings = null; this.h.focus(); cx.notify(); } });
    }
    cx.notify();
  }

  watchSpool(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(this.dir); } catch { return; }
        if (await this.refreshStatus()) { cx.notify(); this.closeSoon(cx); }
      }
    });
  }

  watchFile(cx) {
    if (this.launch?.on) {
      cx.timer.every(3000, (cx) => { cx.spawn(async (cx) => this.reloadContent(cx, false)); });
      return;
    }
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(dirOf(this.file)); } catch { cx.timer.every(3000, (cx) => { cx.spawn(async (cx) => this.reloadContent(cx, false)); }); return; }
        await this.reloadContent(cx, false);
      }
    });
  }

  watchReplies(cx) {
    if (this.id) return;
    const dir = `${appHome()}/data/review/replies`;
    cx.spawn(async (cx) => {
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      for (;;) {
        try { await watchFolder(dir); } catch { return; }
        await this.reloadContent(cx, false);
      }
    });
  }

  async refreshStatus() {
    if (this.status !== "open") return false;
    const d = await readJson(`${this.dir}/decision.json`);
    if (d?.decision) { this.status = d.decision === "dismissed" ? "cancelled" : "sent"; this.sent = d; this.dropEditor(); return true; }
    if (await fs.exists(`${this.dir}/cancelled`)) {
      let why = "";
      try { why = (await fs.readFile(`${this.dir}/cancelled`, "utf8")).trim(); } catch {}
      this.status = "cancelled";
      this.sent = { decision: "cancelled", reason: why };
      this.dropEditor();
      return true;
    }
    return false;
  }

  saveDraft() {
    fs.writeFile(`${this.dir}/draft.json`, JSON.stringify(this.anns)).catch(() => {});
  }

  /** How the feedback is headed for this kind of review. */
  get framing() {
    const k = this.kind;
    const fb = this.cfg?.prompts?.feedback;
    const labels = fb ? { intro: fb.intro, sections: fb.sections } : undefined;
    if (k === "plan" || k === "reply") {
      const f = fb?.[k] ?? (k === "plan" ? { heading: "Plan Feedback", subject: "this plan" } : { heading: "Feedback on your last reply", subject: "your last reply" });
      return { heading: fillText(f.heading), subject: fillText(f.subject), labels };
    }
    const name = this.file ? base(this.file) : this.title;
    const path = this.file ? (this.file.startsWith(home()) ? "~" + this.file.slice(home().length) : this.file) : null;
    const f = fb?.file ?? { heading: "Feedback on {name}", subject: "`{path}`" };
    // No file (an ask): the title, in quotes, stands in for the path.
    const vars = { name, path: path ?? this.title };
    const subject = path ? fillText(f.subject, vars) : `"${this.title}"`;
    return { heading: fillText(f.heading, vars), subject, labels };
  }

  get feedback() { return toMarkdown(this.anns, this.framing); }

  // ---- annotations -----------------------------------------------------------

  dropEditor() {
    this.editing?.state.release();
    this.editing = null;
    this.confirm = false;
  }

  startEdit(block, type, cx, ann = null) {
    if (this.status !== "open") return;
    this.editing?.state.release();
    const b = block === null ? null : this.blocks[block];
    const value = ann?.text ?? (type === "replace" && b ? b.src : "");
    const placeholder = type === "delete" ? "Why delete it? (optional)"
      : type === "replace" ? "What it should say instead"
      : type === "general" ? "Feedback on the plan as a whole" : "Your comment";
    const state = TextareaState.new({ placeholder: `${placeholder}…`, value, rows: 3 });
    state.set_auto_grow(3, 14);
    // The textarea's own bindings take ⌘Enter before our key handler sees it: it arrives as a submit.
    state.on("submit", (e, cx) => { if (e?.secondary) { this.lastKey = Date.now(); this.saveEdit(cx); } });
    this.editing = { ann: ann?.id ?? null, block, type, quote: ann?.quote ?? b?.src ?? null, state };
    this.selected = ann?.id ?? null;
    this.confirm = false;
    cx.notify();
    cx.timer.after(30, () => state.focus());
  }

  saveEdit(cx) {
    const e = this.editing;
    if (!e) return;
    const text = e.state.value();
    if (e.type !== "delete" && !text.trim()) { this.cancelEdit(cx); return; }
    if (e.type === "replace" && text.trim() === (e.quote ?? "").trim()) { this.cancelEdit(cx); return; }
    if (e.ann) {
      this.anns = this.anns.map((a) => (a.id === e.ann ? { ...a, text, quote: e.quote } : a));
    } else {
      const id = `n${++this.seq}`;
      this.anns.push({ id, block: e.block, type: e.type, quote: e.quote, text, created: Date.now() });
      this.selected = id;
    }
    e.state.release();
    this.editing = null;
    this.saveDraft();
    this.h.focus();
    cx.notify();
  }

  cancelEdit(cx) {
    this.editing?.state.release();
    this.editing = null;
    this.h.focus();
    cx.notify();
  }

  remove(id, cx) {
    this.anns = this.anns.filter((a) => a.id !== id);
    if (this.editing?.ann === id) this.cancelEdit(cx);
    if (this.selected === id) this.selected = null;
    this.saveDraft();
    cx.notify();
  }

  useCopied(cx) {
    const e = this.editing;
    if (!e || e.block === null) return;
    cx.spawn(async (cx) => {
      let text = "";
      try { text = (await exec("pbpaste", [])).stdout.trim(); } catch {}
      const src = this.blocks[e.block]?.src ?? "";
      if (!text) notify({ title: "Review", body: "The clipboard is empty: select part of the block, ⌘C, then try again.", level: "info" });
      else if (!src.includes(text) && !plain(src).includes(text)) notify({ title: "Review", body: "The copied text isn't in this block.", level: "warning" });
      else { e.quote = text; if (e.type === "replace" && e.state.value() === src) e.state.set_value(text); }
      cx.notify();
    });
  }

  toggleSide(cx) {
    this.side = this.showSide ? "0" : "1";
    store.set("side", this.side);
    cx.notify();
  }

  get showSide() {
    if (this.side !== null) return this.side === "1";
    const pref = this.cfg?.ui?.sidebar ?? "auto";
    return pref === "auto" ? this.width >= WIDE : pref === "open";
  }

  // ---- decisions -------------------------------------------------------------

  async decide(decision, cx, extra = {}) {
    if (this.status !== "open") return;
    if (!(await fs.exists(`${this.dir}`))) return;
    const d = { decision, at: Date.now(), ...extra };
    try {
      await fs.writeFile(`${this.dir}/decision.json`, JSON.stringify(d));
    } catch (e) {
      notify({ title: "Review", body: `Could not send: ${e?.message ?? e}`, level: "error" });
      return;
    }
    this.status = "sent";
    this.sent = d;
    this.dropEditor();
    const who = this.agentName;
    const plan = this.kind === "plan";
    if (decision === "dismissed") { cx.notify(); return; }
    notify({
      title: decision === "approve" ? (plan ? "Plan approved" : "Approved") : (plan ? "Changes requested" : "Feedback sent"),
      body: decision === "approve" ? (plan ? `${who} can start.` : `${who} can continue.`) : (plan ? `${who} will revise the plan.` : `${who} has your feedback.`),
      level: decision === "approve" ? "success" : "info", timeout: 3000,
    });
    cx.notify();
    this.closeSoon(cx);
  }

  /** Send mode: type the feedback into the agent's terminal, then start a fresh round. */
  send(cx) {
    if (this.status !== "open" || this.mode !== "send" || this.sending) return;
    if (this.editing) this.saveEdit(cx);
    if (!this.anns.length) { this.startEdit(null, "general", cx); return; }
    const to = this.target;
    const agent = agents().find((a) => a.address === to);
    if (!to) { notify({ title: "Review", body: "No agent to send to in this tab. Copy the feedback instead.", level: "warning" }); return; }
    if (agent?.status === "blocked") {
      notify({ title: "Review", body: `${this.agentName} is waiting on a prompt. Answer it first, then send.`, level: "warning" });
      return;
    }
    const md = this.feedback;
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => {
      let r = null, err = null;
      try { r = await exec("hc", ["send", to, md], { timeout: 120000 }); } catch (e) { err = e?.message ?? String(e); }
      this.sending = false;
      if (err || r?.code !== 0) {
        notify({ title: "Review", body: `Could not send: ${err ?? (r?.stderr || r?.stdout || "hc send failed").trim()}`, level: "error" });
        cx.notify();
        return;
      }
      this.lastSent = { at: Date.now(), md, to, count: this.anns.length };
      fs.writeFile(`${this.dir}/sent.json`, JSON.stringify(this.lastSent)).catch(() => {});
      this.anns = [];
      this.selected = null;
      this.saveDraft();
      notify({ title: "Feedback sent", body: `${this.agentName} has your ${plural(this.lastSent.count, "note")}.`, level: "success", timeout: 2500 });
      cx.notify();
    });
  }

  approve(cx, mode = null) {
    if (this.status !== "open" || this.mode !== "decision") return;
    if (this.editing) this.saveEdit(cx);
    if (this.anns.length && !mode) { this.confirm = true; this.h.focus(); cx.notify(); return; }
    this.confirm = false;
    const n = this.cfg?.prompts?.notes?.[this.kind === "plan" ? "plan" : "other"]
      ?? (this.kind === "plan" ? { heading: "Implementation notes", intro: "Notes on the approved plan:" } : { heading: "Notes", intro: "Approved, with these notes:" });
    const notes = mode === "notes" ? toMarkdown(this.anns, { heading: fillText(n.heading), intro: fillText(n.intro), labels: this.framing.labels }) : "";
    cx.spawn(async (cx) => this.decide("approve", cx, notes ? { notes } : {}));
  }

  deny(cx) {
    if (this.mode === "send") { this.send(cx); return; }
    if (this.status !== "open") return;
    if (this.editing) this.saveEdit(cx);
    if (!this.anns.length) { this.startEdit(null, "general", cx); return; }
    this.confirm = false;
    const feedback = this.feedback;
    cx.spawn(async (cx) => this.decide("deny", cx, { feedback }));
  }

  // ⌘Enter / ⌘⇧Enter, from the key handler or a bound command; a chord seen twice runs once.
  dedupe() {
    const now = Date.now();
    if (now - this.lastKey < 250) return false;
    this.lastKey = now;
    return true;
  }

  submitKey(cx) {
    if (!this.dedupe()) return;
    if (this.editing) this.saveEdit(cx);
    else if (!this.confirm) this.deny(cx);
  }

  approveKey(cx) {
    if (this.mode !== "decision" || !this.dedupe()) return;
    if (this.confirm) this.approve(cx, "notes");
    else this.approve(cx);
  }

  copyFeedback(cx) {
    const md = this.feedback;
    if (!md) return;
    cx.spawn(async () => {
      const tmp = `${this.dir}/.clip.md`;
      await fs.writeFile(tmp, md);
      await exec("sh", ["-c", 'pbcopy < "$1"', "sh", tmp]);
      notify({ title: "Review", body: "Feedback copied.", level: "success", timeout: 2000 });
    });
  }

  // ---- view ------------------------------------------------------------------

  get agent() { const t = this.target; return t ? agents().find((a) => a.address === t) ?? null : null; }
  get agentName() {
    return this.agent?.program?.name ?? AGENT_NAMES[this.req?.agent] ?? AGENT_NAMES[this.req?.parent?.app] ?? "The agent";
  }

  /** The agent that asked (bridge reviews) or that feedback goes to: where it is, and whether it still runs. */
  get parent() {
    const live = this.agent;
    const saved = this.req?.parent ?? null;
    return {
      terminal: this.target,
      live: !!live,
      ended: !!this.req && !live,
      space: live?.space_name ?? saved?.space_name ?? null,
      tab: live?.tab_name ?? saved?.tab_name ?? null,
      title: live?.title ?? null,
    };
  }

  color(type, t) {
    return type === "delete" ? t.blocked : type === "replace" ? green(t) : type === "general" ? t.accent : t.ansi3;
  }

  onKey(e, cx) {
    if (this.settings) return; // the settings screen has its own keys
    const k = e.keystroke.replace(/^ctrl-/, "cmd-");
    if (k === "escape") {
      if (this.editing) this.cancelEdit(cx);
      else if (this.confirm) { this.confirm = false; cx.notify(); }
      else if (this.selected) { this.selected = null; cx.notify(); }
      else if (this.floating) this.later();
      else return;
    } else if (k === "cmd-enter") this.submitKey(cx);
    else if (k === "cmd-shift-enter") this.approveKey(cx);
    else return;
    cx.stop_propagation();
  }

  render(cx) {
    if (this.launcher) return div();
    if (this.settingsWindow) return withFont(div().size_full(), this.settingsWindow.saved).child(this.settingsWindow.render(theme()));
    if (this.inbox) return this.inbox.render(cx);
    const t = theme();
    const root = withFont(v_flex(), this.cfg).id("review").relative().track_focus(this.h).size_full().bg(t.canvas).text_color(t.foreground)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); } })
      .on_key_down((e, cx) => this.onKey(e, cx))
      // Clicks that land outside text and the editor give the keyboard back to the review.
      .on_mouse_down("left", () => this.h.focus());
    // The frame (header, ✕) draws straight away; only the body waits for load().
    if (this.status === "loading") return root.child(this.renderHeader(t))
      .child(div().flex_1().min_h(0).flex().items_center().justify_center()
        .when(this.floating, (el) => el.on_mouse_down("left", (_e, cx) => { this.h.focus(); cx.stop_propagation(); }))
        .child(div().text_size(13).text_color(t.dim).child("Loading…")));
    if (!this.req && !this.launch) return root.items_center().justify_center().child(div().text_size(13).text_color(t.muted).child(this.error ?? "Nothing to review."));
    const wide = this.width >= WIDE;
    const side = this.showSide;
    if (this.settings) return root.child(this.renderHeader(t)).child(div().flex_1().min_h(0).child(this.settings.render(t)));
    return root
      .child(this.renderHeader(t))
      .child(h_flex().flex_1().min_h(0).relative()
        // A floating window drags by its header only: presses in the body stay here.
        .when(this.floating, (el) => el.on_mouse_down("left", (_e, cx) => { this.h.focus(); cx.stop_propagation(); }))
        .child(this.renderDoc(t))
        .when(side && wide, (el) => el.child(this.renderSide(t)))
        .when(side && !wide, (el) => el.child(div().absolute().top(0).right(0).bottom(0).shadow_lg().child(this.renderSide(t)))))
      .when(this.confirm, (el) => el.child(this.renderConfirm(t)));
  }

  renderHeader(t) {
    const p = this.agent?.program;
    const ic = p?.icon
      ? (p.tint ? svg(p.icon).size(18).flex_none().text_color(p.color ?? t.foreground) : image(p.icon).w(18).h(18).flex_none())
      : div().w(18).h(18).rounded(5).bg(t.accent).flex_none();
    const open = this.status === "open";
    const loading = this.status === "loading";
    const n = this.anns.length;
    const compact = this.width > 0 && this.width < 720;
    const d = this.sent?.decision;
    const sendMode = this.mode === "send";
    const plan = this.kind === "plan";
    const [stColor, stLabel] = loading ? [t.dim, "Loading…"] : open
      ? (sendMode
        ? (this.sending ? [t.working, "Sending…"]
          : n ? [t.accent, "Ready to send"]
          : this.lastSent ? [green(t), `Sent ${ago(this.lastSent.at)}${ago(this.lastSent.at) === "just now" ? "" : " ago"}`]
          : [t.accent, "Annotate, then send"])
        : [t.accent, this.req?.created && ago(this.req.created) !== "just now" ? `Waiting ${ago(this.req.created)}` : "Awaiting your review"])
      : d === "approve" ? [green(t), "Approved"] : d === "deny" ? [t.accent, plan ? "Changes requested" : "Feedback sent"] : [t.dim, "Closed"];
    const tabAgents = sendMode && !this.id ? this.tabAgents : [];
    const counts = ["comment", "delete", "replace", "general"].map((k) => [k, this.anns.filter((a) => a.type === k).length]).filter(([, c]) => c);
    return h_flex().id("pr-head").relative().h(64).flex_none().pl(16).pr(10).gap(12).items_center().bg(t.chrome)
      .border_b_1().border_color(t.border)
      .child(wash(tint(stColor, "1c"), tint(t.chrome, "00"), 90))
      .child(div().relative().w(38).h(38).flex_none()
        .child(div().absolute().top(0).left(0).size_full().rounded(11).bg(tint(t.accent, "22")).border_1().border_color(tint(t.accent, "44")))
        .child(div().absolute().top(4).left(4).w(30).h(30).rounded(8).bg(t.raised).border_1().border_color(t.border).shadow_sm()
          .flex().items_center().justify_center().child(ic)))
      .child(v_flex().relative().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(8).items_center().min_w(0)
          .child(div().text_size(15).font_semibold().truncate().child(this.title))
          .when(!!this.req?.version && this.kind !== "file", (el) => el.child(div().flex_none().h(18).px(6).rounded(5).flex().items_center().text_size(10.5).font_semibold()
            .bg(t.raised).border_1().border_color(t.border).text_color(t.muted).child(`v${this.req.version}`)))
          .when(this.newer, (el) => el.child(div().flex_none().on_mouse_down("left", stopPress).child(h_flex().id("pr-newer").flex_none().h(18).px(6).gap(4).rounded(5).items_center().text_size(10.5)
            .font_semibold().bg(tint(t.accent, "22")).text_color(t.accent).cursor_pointer().hover((s) => s.bg(tint(t.accent, "38")))
            .tooltip("A newer reply arrived. Load it (your annotations stay where their quote still fits)")
            .on_click((_e, cx) => { cx.spawn(async (cx) => this.reloadContent(cx, true)); })
            .child(icon("refresh", 10)).child("Newer reply")))))
        .child(h_flex().gap(7).items_center().text_size(11.5).text_color(t.dim).min_w(0)
          .child(dot(stColor, open, 7))
          .child(div().flex_none().text_color(open ? t.muted : stColor).child(stLabel))
          .when(!loading, (el) => el.child(div().flex_none().child("·"))
            .child(this.renderParent(t, sendMode, tabAgents, compact)))
          .when(!loading && !compact && counts.length > 0, (el) => el.child(div().flex_none().child("·"))
            .children(counts.map(([k, c]) => h_flex().flex_none().gap(3).items_center().text_color(this.color(k, t))
              .child(icon(KINDS[k].icon, 11)).child(String(c)))))
          .when(!n && open && !compact, (el) => el.child(div().flex_none().child("·")).child(div().flex_none().child("No annotations")))))
      // Controls keep their presses (a floating window drags by the rest of the header).
      .child(h_flex().relative().flex_none().gap(12).items_center().on_mouse_down("left", stopPress)
      .when(open, (el) => el
        .child(btn("pr-general", t, { ic: "globe", label: compact ? null : "Global comment", tooltip: compact ? "Global comment" : null,
          onClick: (cx) => this.startEdit(null, "general", cx) }))
        .child(btn("pr-copy", t, { ic: "copy", tooltip: "Copy feedback as markdown", disabled: !n, onClick: (cx) => this.copyFeedback(cx) }))
        .when(sendMode && (this.kind === "reply" || !!this.file), (el) => el.child(btn("pr-refresh", t, { ic: "refresh",
          tooltip: this.kind === "reply" ? "Load the latest reply" : "Reload the file", onClick: (cx) => { cx.spawn(async (cx) => this.reloadContent(cx, true)); } })))
        .child(div().w(1).h(18).bg(t.border).flex_none())
        .when(sendMode, (el) => el.child(btn("pr-send", t, { ic: "send", label: this.sending ? "Sending…" : compact ? "Send" : `Send to ${this.agentName}`,
          variant: "solid", color: t.accent, kbd: compact ? null : "⌘↵", disabled: !n || !this.target || this.sending,
          onClick: (cx) => this.send(cx) })))
        .when(!sendMode, (el) => el
          .child(btn("pr-deny", t, { label: plan ? (compact ? "Changes" : "Request changes") : (compact ? "Feedback" : "Send feedback"),
            variant: "outline", color: plan ? t.blocked : t.accent, kbd: compact ? null : "⌘↵", onClick: (cx) => this.deny(cx) }))
          .child(btn("pr-approve", t, { ic: "check", label: plan ? "Approve" : "Looks good", variant: "solid", color: green(t), kbd: compact ? null : "⌘⇧↵",
            onClick: (cx) => this.approve(cx) }))))
      .when(!loading && !this.settings, (el) => el.child(btn("pr-side-toggle", t, { ic: "sidebar", active: this.showSide, tooltip: "Annotations", onClick: (cx) => this.toggleSide(cx) })))
      .when(!loading, (el) => el.child(btn("pr-settings", t, { ic: "settings", active: !!this.settings, tooltip: this.settings ? "Back to the review" : "Settings", onClick: (cx) => this.toggleSettings(cx) })))
      .when(open && this.mode === "decision" && !!this.id, (el) => el.child(btn("pr-dismiss", t, { label: compact ? null : "Dismiss", ic: compact ? "trash" : null,
        tooltip: `Stop waiting here: ${this.agentName} falls back to its own prompt`, onClick: (cx) => this.dismiss(cx) })))
      .when(this.floating, (el) => el.child(btn("pr-close", t, { ic: "x",
        tooltip: open && this.id ? "Later: keep it in the review inbox (esc)" : "Close (esc)", onClick: () => this.later() }))));
  }

  /** Who asked for this review (or who feedback goes to), and where that agent is. Click: go to it. */
  renderParent(t, sendMode, tabAgents, compact) {
    const par = this.parent;
    if (sendMode && !par.terminal) return div().flex_none().child("No agent in this tab");
    const where = [par.space, par.tab].filter(Boolean).join(" › ");
    const tip = [par.title, par.ended ? "This agent is no longer running." : "Go to this agent"].filter(Boolean).join("\n");
    const label = h_flex().gap(5).items_center().min_w(0)
      .child(div().flex_none().text_color(par.ended ? t.dim : t.muted).child(`${this.id || !sendMode ? "from" : "to"} ${this.agentName}`))
      .when(!!where && !compact, (el) => el.child(div().flex_none().text_color(t.dim).child("·"))
        .child(div().min_w(0).truncate().text_color(t.dim).child(where)))
      .when(par.ended, (el) => el.child(div().flex_none().italic().text_color(t.dim).child("(ended)")));
    const go = h_flex().id("pr-parent").min_w(0).gap(4).items_center().px(5).rounded(4).tooltip(tip).child(label)
      .when(par.live, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => run("agent.focus", { terminal: par.terminal })));
    return h_flex().min_w(0).gap(2).items_center().on_mouse_down("left", stopPress)
      .child(go)
      .when(tabAgents.length > 1, (el) => el.child(div().id("pr-target").flex_none().h(18).px(4).rounded(4).flex().items_center()
        .cursor_pointer().text_size(9).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Send to another agent in this tab").on_click((_e, cx) => this.cycleTarget(cx)).child("▾")));
  }

  renderDoc(t) {
    const open = this.status === "open";
    const general = this.anns.filter((a) => a.type === "general");
    const editingGeneral = this.editing && this.editing.block === null;
    const narrow = this.width > 0 && this.width < 640;
    const words = this.blocks.reduce((n, b) => n + plain(b.src).split(/\s+/).filter(Boolean).length, 0);
    const steps = this.blocks.filter((b) => b.kind === "item").length;
    const sections = this.blocks.filter((b) => b.kind === "heading").length;
    const meta = (ic, text) => h_flex().gap(5).items_center().flex_none().child(icon(ic, 11)).child(text);
    return div().id("pr-doc").relative().flex_1().min_w(0).h_full().overflow_y_scrollbar()
      .child(div().absolute().top(0).left(0).right(0).h(220).child(wash(tint(t.accent, "12"), tint(t.canvas, "00"), 180)))
      .child(v_flex().relative().w_full().max_w(this.cfg?.ui?.contentWidth ?? 860).mx_auto().px(narrow ? 10 : 28).pt(narrow ? 12 : 26).pb(110).gap(14)
        .when(!open, (el) => el.child(this.renderResult(t)))
        .when(open && this.mode === "send" && !!this.lastSent && !this.anns.length, (el) => el.child(this.renderSent(t)))
        .child(h_flex().px(4).gap(14).items_center().text_size(this.sz(11)).text_color(t.dim).flex_wrap()
          .child(div().text_size(this.sz(10.5)).font_semibold().text_color(t.accent).child(DOC_LABEL[this.kind] ?? "DOCUMENT"))
          .when(!!this.file, (el) => el.child(div().min_w(0).truncate().text_color(t.dim).child(
            this.file.startsWith(home()) ? "~" + this.file.slice(home().length) : this.file)))
          .when(this.kind === "reply" && this.replySource === "screen", (el) => el.child(div().flex_none().text_color(t.dim)
            .tooltip("This agent doesn't report its replies, so this is its screen and recent history").child("from the screen")))
          .child(div().flex_1())
          .when(sections > 0, (el) => el.child(meta("sidebar", plural(sections, "section"))))
          .when(steps > 0, (el) => el.child(meta("check", plural(steps, "step"))))
          .when(this.cfg?.ui?.readingTime !== false, (el) => el.child(meta("comment", `${Math.max(1, Math.round(words / 230))} min read`))))
        .when(general.length > 0 || editingGeneral, (el) => el.child(v_flex().relative().gap(8).p(14).rounded(12)
          .bg(t.background).border_1().border_color(tint(t.accent, "55")).shadow_sm()
          .child(wash(tint(t.accent, "14"), tint(t.background, "00"), 90))
          .child(h_flex().relative().gap(8).items_center().text_size(this.sz(11)).font_semibold().text_color(t.accent)
            .child(badge("globe", t.accent, 20, 11)).child("GLOBAL COMMENTS"))
          .children(general.map((a) => this.renderNote(a, t)))
          .when(editingGeneral, (el) => el.child(this.renderEditor(t)))))
        .child(v_flex().relative().w_full().rounded(14).overflow_hidden()
          .bg(t.background).border_1().border_color(t.border).shadow_lg()
          .when(!open, (el) => el.opacity(0.6))
          // Accent ribbon across the top of the page.
          .child(div().relative().w_full().h(3).flex_none().child(wash(t.accent, green(t), 90)))
          .child(v_flex().w_full().pl(narrow ? 8 : 18).pr(narrow ? 12 : 40).py(narrow ? 16 : 34).gap(2)
            .when(this.cfg?.ui?.textSize > 0, (el) => el.text_size(this.cfg.ui.textSize))
            .when(!this.blocks.length, (el) => el.child(div().py(30).text_center().text_size(this.sz(13)).text_color(t.dim).whitespace_normal()
              .child(this.error ?? (this.kind === "reply" ? `No reply from ${this.agentName} yet. It appears here after its next turn.` : "Nothing to review."))))
            .children(this.blocks.map((b, i) => this.renderBlock(b, i, t))))));
  }

  renderSent(t) {
    const s = this.lastSent;
    const c = green(t);
    return h_flex().relative().gap(12).items_center().px(16).py(12).rounded(12).bg(t.background)
      .border_1().border_color(tint(c, "55")).shadow_sm()
      .child(wash(tint(c, "1e"), tint(t.background, "00"), 90))
      .child(div().relative().w(30).h(30).flex_none().rounded_full().bg(tint(c, "26")).text_color(c)
        .flex().items_center().justify_center().child(icon("send", 14)))
      .child(v_flex().relative().flex_1().min_w(0).gap(2)
        .child(div().text_size(this.sz(13)).font_semibold().text_color(c).child(`Sent ${plural(s.count ?? 1, "note")} to ${this.agentName}`))
        .child(div().text_size(this.sz(12)).text_color(t.muted).whitespace_normal()
          .child(this.kind === "reply" ? "Annotate its next reply the same way (it loads here when it arrives)."
            : this.liveFile ? "This file reloads when it changes: annotate it again for another round." : "Add more notes for another round.")))
      .child(btn("pr-sent-copy", t, { ic: "copy", tooltip: "Copy what was sent", onClick: (cx) => {
        cx.spawn(async () => {
          const tmp = `${this.dir}/.clip.md`;
          await fs.writeFile(tmp, s.md ?? "");
          await exec("sh", ["-c", 'pbcopy < "$1"', "sh", tmp]);
          notify({ title: "Review", body: "Copied what was sent.", level: "success", timeout: 2000 });
        });
      } }));
  }

  renderResult(t) {
    const d = this.sent ?? {};
    const who = this.agentName;
    const plan = this.kind === "plan";
    const [color, ic, title, body] = d.decision === "approve"
      ? [green(t), "check", d.notes ? "Approved with notes" : plan ? "Plan approved" : "Approved",
        d.notes ? `${who} will follow your notes${plan ? " while implementing" : ""}.` : plan ? `${who} can start.` : `${who} can continue.`]
      : d.decision === "deny" ? [plan ? t.blocked : t.accent, "send", plan ? "Changes requested" : "Feedback sent",
        plan ? `Your feedback was sent. ${who} will revise the plan.` : `Your feedback was sent to ${who}.`]
      : d.reason === "replaced" ? [t.dim, "pencil", "Replaced", `A newer ${plan ? "version of this plan" : "review request"} replaced this review.`]
      : d.decision === "dismissed" ? [t.dim, "x", "Closed", "Closed without a decision."]
      : [t.dim, "x", "No longer waiting", this.error ?? "The agent stopped waiting for this review."];
    return h_flex().relative().gap(16).items_center().px(20).py(18).rounded(14).bg(t.background)
      .border_1().border_color(tint(color, "66")).shadow_md()
      .child(wash(tint(color, "26"), tint(t.background, "00"), 90))
      .child(div().relative().w(44).h(44).flex_none()
        .child(div().absolute().top(0).left(0).size_full().rounded_full().bg(tint(color, "18")))
        .child(div().absolute().top(5).left(5).w(34).h(34).rounded_full().bg(tint(color, "30")).text_color(color)
          .flex().items_center().justify_center().child(icon(ic, 18))))
      .child(v_flex().relative().gap(3).min_w(0)
        .child(div().text_size(this.sz(15)).font_semibold().text_color(color).child(title))
        .child(div().text_size(this.sz(12.5)).text_color(t.muted).child(body)));
  }

  renderBlock(b, i, t) {
    const notes = this.anns.filter((a) => a.block === i);
    const del = notes.find((a) => a.type === "delete");
    const rep = notes.find((a) => a.type === "replace");
    const com = notes.some((a) => a.type === "comment");
    const editingHere = this.editing?.block === i;
    const open = this.status === "open";
    const hover = open && this.hovered === i;
    const ring = this.selected && notes.some((a) => a.id === this.selected);
    const accent = del ? t.blocked : rep ? t.blocked : com ? t.ansi3 : null;
    const struck = !!(del || rep);
    const heading = b.kind === "heading";

    const toolbar = h_flex().absolute().top(heading ? 6 : 2).right(4).h(28).px(3).gap(1).items_center().rounded(8)
      .bg(t.popover).border_1().border_color(t.border).shadow_md()
      .children(["comment", "delete", "replace"].map((k) => h_flex().id(`tb-${k}-${i}`).h(22).px(7).gap(5).items_center().rounded(5)
        .text_size(this.sz(11.5)).font_medium().cursor_pointer().text_color(k === "delete" ? t.blocked : t.muted)
        .hover((s) => s.bg(t.hover).text_color(k === "delete" ? t.blocked : t.foreground))
        .on_click((_e, cx) => this.startEdit(i, k, cx))
        .child(icon(KINDS[k].icon, 13))
        .when(this.width >= 560, (el) => el.child(KINDS[k].label))));

    const framed = b.kind === "table";
    const body = div().id(`bw-${i}`).relative().flex_1().min_w(0).px(10).py(heading ? 6 : 3).rounded(8)
      .when(!!accent, (el) => el.border_l_2().border_color(accent).bg(tint(accent, struck ? "14" : "1c")))
      .when(hover && !accent, (el) => el.bg(t.hover))
      .when(!!ring, (el) => el.border_1().border_color(t.accent))
      .child(div().when(struck, (el) => el.line_through().opacity(0.55))
        .when(framed, (el) => el.p(10).rounded(8).bg(t.surface).border_1().border_color(t.border))
        .when(b.kind === "quote", (el) => el.pl(10).border_l_2().border_color(tint(t.accent, "88")))
        // Text keeps its own presses (selection, ⌘C) instead of handing the keyboard to the root.
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(TextView.markdown(`b-${i}`, b.src).selectable(true)))
      .when(hover && !editingHere, (el) => el.child(toolbar));

    // Left gutter: a marker in the annotation's colour, or a faint dot on hover.
    const mark = notes.length
      ? div().w(18).h(18).rounded_full().bg(tint(accent ?? this.color(notes[0].type, t), "28"))
        .text_color(accent ?? this.color(notes[0].type, t)).flex().items_center().justify_center()
        .text_size(this.sz(10)).font_semibold().child(String(notes.length))
      : div().w(6).h(6).rounded_full().when(hover && open, (el) => el.bg(t.dim));
    const gutter = div().w(22).flex_none().flex().justify_center().pt(heading ? 10 : 6).child(mark);

    const replacement = rep && rep.text.trim() && div().ml(10).mt(3).px(10).py(4).rounded(6)
      .border_l_2().border_color(green(t)).bg(tint(green(t), "16"))
      .child(TextView.markdown(`r-${i}`, rep.text).selectable(true));

    return v_flex().id(`blk-${i}`).w_full()
      .when(heading && i > 0, (el) => el.mt(14))
      .on_hover((h, cx) => { const v = h ? i : (this.hovered === i ? -1 : this.hovered); if (v !== this.hovered) { this.hovered = v; cx.notify(); } })
      .child(h_flex().w_full().items_start().child(gutter).child(div().w(b.level * 20).flex_none()).child(body))
      .child(v_flex().w_full().pl(22 + b.level * 20)
        .when(!!replacement, (el) => el.child(replacement))
        .when(notes.length > 0, (el) => el.child(v_flex().gap(6).pl(10).py(6).children(notes.map((a) => this.renderNote(a, t)))))
        .when(editingHere, (el) => el.child(div().pl(10).py(6).child(this.renderEditor(t)))));
  }

  pill(type, t) {
    const c = this.color(type, t);
    return h_flex().flex_none().h(18).px(6).gap(4).items_center().rounded(5).bg(tint(c, "22")).text_color(c)
      .text_size(this.sz(10)).font_semibold().child(icon(KINDS[type].icon, 11)).child(KINDS[type].label.toUpperCase());
  }

  renderNote(a, t) {
    const color = this.color(a.type, t);
    const open = this.status === "open";
    const partial = a.quote && a.block !== null && a.quote !== this.blocks[a.block]?.src;
    const sel = this.selected === a.id;
    if (this.editing?.ann === a.id) return div();
    const text = a.type === "replace" ? (partial ? "" : "Replacement shown above.") : a.text.trim();
    return v_flex().id(`note-${a.id}`).relative().gap(6).pl(14).pr(12).py(10).rounded(10).bg(t.surface).border_1()
      .border_color(sel ? color : t.border).shadow_sm()
      .when(open, (el) => el.cursor_pointer().hover((s) => s.border_color(tint(color, "aa")))
        .on_click((_e, cx) => this.startEdit(a.block, a.type, cx, a)))
      .child(div().absolute().top(8).bottom(8).left(0).w(3).rounded(2).bg(color))
      .child(h_flex().gap(8).items_center()
        .child(badge(KINDS[a.type].icon, color, 20, 11))
        .child(div().text_size(this.sz(11.5)).font_semibold().text_color(color).child(KINDS[a.type].verb))
        .child(div().flex_1().text_size(this.sz(11)).text_color(t.dim).child(ago(a.created ?? Date.now())))
        .when(open, (el) => el.child(div().id(`rm-${a.id}`).w(22).h(22).rounded(5).flex().items_center().justify_center()
          .text_color(t.dim).cursor_pointer().tooltip("Remove annotation")
          .hover((s) => s.bg(t.hover).text_color(t.blocked))
          .on_click((_e, cx) => { cx.stop_propagation(); this.remove(a.id, cx); })
          .child(icon("trash", 13)))))
      .when(!!partial, (el) => el.child(div().pl(8).border_l_2().border_color(tint(color, "88"))
        .text_size(this.sz(12)).italic().text_color(t.muted).whitespace_normal().child(clip(a.quote, 200))))
      .when(a.type === "replace" && !!partial, (el) => el.child(div().text_size(this.sz(12.5)).px(8).py(4).rounded(5)
        .bg(tint(green(t), "16")).text_color(t.foreground).whitespace_normal().child(a.text)))
      .when(text !== "", (el) => el.child(div().text_size(this.sz(13)).whitespace_normal()
        .text_color(a.type === "replace" ? t.dim : t.foreground).child(text)));
  }

  renderEditor(t) {
    const e = this.editing;
    const color = this.color(e.type, t);
    const partial = e.block !== null && e.quote && e.quote !== this.blocks[e.block]?.src;
    return v_flex().id("pr-editor").relative().gap(10).p(14).rounded(12).bg(t.popover).border_1().border_color(color).shadow_lg()
      // The editor keeps its presses: the textarea holds the keyboard while it's open.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().gap(8).items_center()
        .child(this.pill(e.type, t))
        .child(div().text_size(this.sz(12)).text_color(t.muted).child(e.ann ? "Editing annotation" : e.type === "delete" ? "Mark this block for deletion" : "New annotation"))
        .child(div().flex_1()))
      .when(!!partial, (el) => el.child(div().pl(8).border_l_2().border_color(tint(color, "88"))
        .text_size(this.sz(12)).italic().text_color(t.muted).whitespace_normal().child(clip(e.quote, 200))))
      .child(div().p(2).rounded(10).bg(tint(color, "22"))
        .child(Textarea.new(e.state).p(10).rounded(8).border_1().border_color(tint(color, "88")).bg(t.background).text_size(this.sz(13))))
      .child(h_flex().gap(6).items_center()
        .when(e.block !== null, (el) => el.child(btn("pr-e-copied", t, { ic: "copy", label: "Use copied text",
          tooltip: "Select part of the block, ⌘C, then narrow the quote to it", onClick: (cx) => this.useCopied(cx) })))
        .child(div().flex_1())
        .child(btn("pr-e-cancel", t, { label: "Cancel", kbd: "esc", onClick: (cx) => this.cancelEdit(cx) }))
        .child(btn("pr-e-save", t, { label: e.type === "delete" ? "Mark for deletion" : "Save", variant: "solid",
          color: e.type === "delete" ? t.blocked : t.solid, kbd: "⌘↵", onClick: (cx) => this.saveEdit(cx) })));
  }

  renderSide(t) {
    const list = ordered(this.anns);
    const tab = (id, label, count) => h_flex().id(`pr-tab-${id}`).flex_1().h(26).gap(6).justify_center().items_center().rounded(6)
      .text_size(this.sz(12)).font_medium().cursor_pointer().text_color(this.sideTab === id ? t.foreground : t.muted)
      .when(this.sideTab === id, (el) => el.bg(t.background).shadow_sm())
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.sideTab = id; cx.notify(); })
      .child(label)
      .when(!!count, (el) => el.child(div().h(16).px(5).rounded(8).flex().items_center().text_size(this.sz(10)).font_semibold()
        .bg(tint(t.accent, "26")).text_color(t.accent).child(String(count))));
    const stat = (k) => {
      const c = this.color(k, t);
      const n = this.anns.filter((a) => a.type === k).length;
      return v_flex().flex_1().gap(2).py(8).items_center().rounded(8).bg(n ? tint(c, "14") : t.surface)
        .border_1().border_color(n ? tint(c, "44") : t.border)
        .child(h_flex().gap(4).items_center().text_color(n ? c : t.dim).child(icon(KINDS[k].icon, 12))
          .child(div().text_size(this.sz(15)).font_semibold().child(String(n))))
        .child(div().text_size(this.sz(10)).text_color(t.dim).child(KINDS[k].label));
    };
    return v_flex().id("pr-side").w(this.cfg?.ui?.sidebarWidth ?? 320).flex_none().h_full().bg(t.chrome).border_l_1().border_color(t.border)
      .child(h_flex().h(48).flex_none().px(10).gap(6).items_center().border_b_1().border_color(t.border)
        .child(h_flex().flex_1().p(3).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border)
          .child(tab("notes", "Annotations", list.length))
          .child(tab("preview", "Preview", 0)))
        .when(this.width < WIDE, (el) => el.child(btn("pr-side-close", t, { ic: "x", tooltip: "Hide", onClick: (cx) => this.toggleSide(cx) }))))
      .when(this.sideTab === "notes" && list.length > 0, (el) => el.child(h_flex().flex_none().gap(6).px(10).pt(10)
        .child(stat("comment")).child(stat("delete")).child(stat("replace")).child(stat("general"))))
      .child(div().id("pr-side-list").flex_1().min_h(0).overflow_y_scrollbar()
        .child(this.sideTab === "preview" ? this.renderPreview(t) : this.renderList(list, t)));
  }

  renderList(list, t) {
    const open = this.status === "open";
    if (!list.length) {
      return v_flex().p(18).gap(10).items_center().text_size(this.sz(12.5)).text_color(t.dim)
        .child(div().mt(24).w(40).h(40).rounded_full().bg(t.raised).flex().items_center().justify_center().text_color(t.muted).child(icon("comment", 18)))
        .child(div().text_size(this.sz(13)).font_semibold().text_color(t.muted).child("No annotations yet"))
        .child(div().text_center().whitespace_normal().child(this.mode === "send"
          ? "Hover a block and choose Comment, Delete or Replace, then Send."
          : `Hover a block and choose Comment, Delete or Replace. Approve when ${this.kind === "plan" ? "the plan" : "it"} looks right.`));
    }
    return v_flex().p(10).gap(8).children(list.map((a) => {
      const color = this.color(a.type, t);
      const where = a.type === "general" ? (this.kind === "plan" ? "Whole plan" : "Whole document") : clip(plain(a.quote ?? this.blocks[a.block]?.src ?? ""), 90);
      const sel = this.selected === a.id;
      return v_flex().id(`side-${a.id}`).relative().gap(6).pl(13).pr(10).py(10).rounded(10).bg(t.surface).border_1()
        .border_color(sel ? color : t.border).shadow_sm()
        .child(div().absolute().top(8).bottom(8).left(0).w(3).rounded(2).bg(color))
        .when(open, (el) => el.cursor_pointer().hover((s) => s.border_color(tint(color, "aa")))
          .on_click((_e, cx) => this.startEdit(a.block, a.type, cx, a)))
        .when(!open, (el) => el.on_click((_e, cx) => { this.selected = a.id; cx.notify(); }))
        .child(h_flex().gap(8).items_center()
          .child(this.pill(a.type, t))
          .when(!!a.stale, (el) => el.child(div().flex_none().h(18).px(6).rounded(5).flex().items_center().text_size(this.sz(10)).font_semibold()
            .bg(t.raised).text_color(t.dim).tooltip("Its text is no longer in the document. It is still sent, with the quote.").child("STALE")))
          .child(div().flex_1().text_size(this.sz(11)).text_color(t.dim).child(ago(a.created ?? Date.now())))
          .when(open, (el) => el.child(div().id(`srm-${a.id}`).w(22).h(22).rounded(5).flex().items_center().justify_center()
            .text_color(t.dim).cursor_pointer().tooltip("Remove annotation")
            .hover((s) => s.bg(t.hover).text_color(t.blocked))
            .on_click((_e, cx) => { cx.stop_propagation(); this.remove(a.id, cx); })
            .child(icon("trash", 13)))))
        .child(div().pl(8).border_l_2().border_color(tint(color, "88")).text_size(this.sz(11.5)).italic().text_color(t.muted)
          .whitespace_normal().child(where))
        .when(a.text.trim() !== "", (el) => el.child(div().text_size(this.sz(12.5)).whitespace_normal()
          .when(a.type === "replace", (e) => e.font_family(settings().font_family).text_size(this.sz(12)).text_color(green(t)))
          .child(clip(a.text, 260))));
    }));
  }

  renderPreview(t) {
    const md = this.feedback;
    if (!md) {
      return v_flex().p(18).gap(8).items_center().text_size(this.sz(12.5)).text_color(t.dim)
        .child(div().mt(24).text_center().whitespace_normal().child(`The feedback the agent receives appears here once you annotate ${this.kind === "plan" ? "the plan" : "it"}.`));
    }
    return v_flex().p(12).gap(10)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().text_size(this.sz(11.5)).text_color(t.dim).child(this.mode === "send" ? `Typed into ${this.agentName} on Send`
          : this.kind === "plan" ? "Sent to the agent on Request changes" : "Sent to the agent on Send feedback"))
        .child(btn("pr-prev-copy", t, { ic: "copy", label: "Copy", onClick: (cx) => this.copyFeedback(cx) })))
      .child(div().p(12).rounded(8).bg(t.background).border_1().border_color(t.border).text_size(this.sz(12.5))
        .child(TextView.markdown("pr-preview", md).selectable(true)));
  }

  renderConfirm(t) {
    const n = this.anns.length;
    return div().id("pr-modal").absolute().top(0).left(0).right(0).bottom(0).bg("#0000007a")
      .flex().items_center().justify_center().on_mouse_down("left", stopPress)
      .on_click((_e, cx) => { this.confirm = false; cx.notify(); })
      .child(v_flex().id("pr-modal-card").relative().w(420).gap(14).p(22).rounded(16).bg(t.popover).border_1().border_color(tint(green(t), "55")).shadow_2xl()
        .on_click((_e, cx) => cx.stop_propagation())
        .child(div().absolute().top(0).left(0).right(0).h(90).rounded_t(16).child(wash(tint(green(t), "22"), tint(t.popover, "00"), 180)))
        .child(h_flex().relative().gap(10).items_center()
          .child(div().w(32).h(32).rounded_full().flex_none().bg(tint(green(t), "22")).text_color(green(t))
            .flex().items_center().justify_center().child(icon("check", 16)))
          .child(div().text_size(15).font_semibold().child("Approve with annotations?")))
        .child(div().text_size(13).text_color(t.muted).whitespace_normal()
          .child(`You have ${plural(n, "annotation")}. Send them to ${this.agentName} as notes to follow${this.kind === "plan" ? " while implementing" : ""}, or approve without them.`))
        .child(h_flex().gap(8).items_center()
          .child(btn("pr-c-cancel", t, { label: "Cancel", kbd: "esc", onClick: (cx) => { this.confirm = false; cx.notify(); } }))
          .child(div().flex_1())
          .child(btn("pr-c-discard", t, { label: "Discard notes", variant: "outline", color: t.muted, onClick: (cx) => this.approve(cx, "discard") }))
          .child(btn("pr-c-notes", t, { label: "Approve with notes", variant: "solid", color: green(t), kbd: "⌘⇧↵", onClick: (cx) => this.approve(cx, "notes") }))));
  }
}
