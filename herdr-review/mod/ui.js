// Shared by the review (main.js) and the inbox (inbox.js): theme helpers, small widgets, config, spool reads.
/** @import { Theme, ReviewConfig, ReviewRequest, ReviewRecord, ReviewState } from "./types"
 *  @import { Color, Element, Path, Context, MouseButtonEvent } from "gpui-kit" */
import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import * as fs from "fs/promises";
import { appHome, openOverlay, agents, run } from "herdr";
import * as core from "./config-core.js";
export const ICONS = "mods/review/icons";
export const AGENT_NAMES = { claude: "Claude Code", "claude-code": "Claude Code", pi: "pi", codex: "Codex" };
/** Last path segment of `f` (a file path; null/undefined give ""). `split` always yields at least one
 *  element, so the pop is always a string — the callers (main.js fillText vars) need one.
 *  @param {string | null | undefined} f @returns {string} */
export const base = (f) => /** @type {string} */ ((f ?? "").split(/[\\/]/).pop());
/** @param {string} s @returns {string} */
export const safe = (s) => String(s).replace(/[^\w.-]/g, "_");

/** Approve / replacement green: the theme's ANSI green (its `done` is blue in some themes).
 *  @param {Theme} t @returns {Color} */
export const green = (t) => t.ansi2 ?? t.done;

/** Appends alpha `a` to a hex color (non-hex colors pass through untouched).
 *  @param {Color} c @param {string} a @returns {Color} */
export const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? /** @type {Color} */ (c + a) : c);
/** @param {string} s @param {number} n @returns {string} */
export const clip = (s, n) => { const o = s.replace(/\s+/g, " ").trim(); return o.length > n ? o.slice(0, n - 1) + "…" : o; };
/** Parses the JSON file at `p` (any JSON value); null when it can't be read or parsed.
 *  @param {string} p @returns {Promise<any | null>} */
export const readJson = async (p) => { try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; } };
/** @param {number} n @param {string} w @returns {string} */
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** Rough age of a timestamp, for labels ("3h").
 *  @param {number} ms @returns {string} */
export const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
// ---- settings (config-core.js has the rules; bin/config.mjs reads the same files for node) -----------------

// Only if config.defaults.json can't be read: enough to open a window.
/** @type {ReviewConfig} */
const FALLBACK = { window: { place: "float", width: 0.6, height: 0.8, focus: true, arrive: "open" },
  ui: { font: "", textSize: 0, contentWidth: 860, sidebarWidth: 320, sidebar: "auto", readingTime: true }, prompts: null };
// Read on every call, never cached: in the Herdr runtime a task spawned in a new window's init stalls forever if its
// first await settles without a host call while another window closes in the same turn. A cached value made
// `await readConfig()` exactly that.
export async function configDefaults() {
  return (await readJson(`${appHome()}/mods/review/config.defaults.json`)) ?? FALLBACK;
}
export const configPath = () => `${appHome()}/data/review/config.json`;
/** config.json as written (an empty object when missing). */
export const readConfigFile = async () => (await readJson(configPath())) ?? {};
/** The settings in effect: {window, ui, prompts} (prompts is null without the defaults file).
 *  @returns {Promise<ReviewConfig>} */
export async function readConfig() {
  const [d, raw] = await Promise.all([configDefaults(), readConfigFile()]);
  return /** @type {ReviewConfig} */ (core.merge(d, raw));
}
/** Saves settings `cfg` (keeping only what differs from the defaults, and keys this version doesn't know).
 *  @param {ReviewConfig} cfg */
export async function writeConfig(cfg) {
  const d = await configDefaults();
  let text = null;
  try { text = await fs.readFile(configPath(), "utf8"); } catch {}
  let raw = {};
  if (text !== null && text.trim()) {
    try { raw = JSON.parse(text); } catch { throw new Error("config.json isn't valid JSON: fix it or delete it, then save again"); }
  }
  const next = core.toFile(d, core.merge(d, cfg), raw);
  await fs.mkdir(`${appHome()}/data/review`, { recursive: true }).catch(() => {});
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}
export const fillText = core.text;
/** Text sizes scaled by the `ui.textSize` setting: sizes are designed for 13px text; 0 (the default) leaves them.
 *  @param {ReviewConfig | null} cfg @returns {(n: number) => number} */
export const scaler = (cfg) => { const r = (cfg?.ui?.textSize || 13) / 13; return (n) => Math.round(n * r * 2) / 2; };
/** Applies `ui.font` to an element (text styles inherit, so everything inside follows).
 *  @param {Element} el @param {ReviewConfig | null} cfg @returns {Element} */
export const withFont = (el, cfg) => (cfg?.ui?.font ? el.font_family(cfg.ui.font) : el);

// Stops a press from reaching a floating window's drag (and the root's focus grab).
/** @param {MouseButtonEvent} _e @param {Context} cx */
export const stopPress = (_e, cx) => cx.stop_propagation();

export const store = {
  /** @param {string} k @returns {string | null} */
  get(k) { try { return localStorage.getItem(k) ?? null; } catch { return null; } },
  /** @param {string} k @param {string} v */
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

/** @param {string} name @param {number} [size] @returns {Element} */
export const icon = (name, size = 14) => svg(`${ICONS}/${name}.svg`).size(size).flex_none();

/** A full-size rectangle path, for `wash`.
 *  @returns {Path} */
export const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
/** A layer that fills its (relative) parent with a gradient: soft washes behind headers and cards.
 *  @param {Color} from @param {Color} to @param {number} [angle] @returns {Element} */
export const wash = (from, to, angle = 90) =>
  window.paint_path(RECT(), Background.linear_gradient(angle, from, to).color_space("oklab")).absolute().top(0).left(0).size_full();

// ---- motion ------------------------------------------------------------------
// Native transitions only animate a *later* change of target: an element that is new draws one frame at its start
// value (hidden), then `Appear` flips it to shown and the transition carries it in.
/** @type {import("./types").Motion} */
export const SOFT = { duration: 200, easing: "ease-out" };
/** @type {import("./types").Motion} */
export const QUICK = { duration: 140, easing: "ease-out" };

export class Appear {
  /** `cx`: any context of the view that draws the elements (init's, or a handler's): its tasks redraw that view.
   *  @param {Context} cx */
  constructor(cx) {
    this.on = new Set();      // keys drawn shown
    this.pending = new Set(); // keys drawn hidden once, shown next frame
    this.acx = null;
    cx.spawn(async (acx) => { this.acx = acx; });
  }
  /** False the first time `key` is asked about (draw it hidden), true from the next frame on.
   *  @param {string} key @returns {boolean} */
  is(key) {
    if (this.on.has(key)) return true;
    if (!this.acx) { this.on.add(key); return true; } // no clock yet: just show it
    if (!this.pending.size) {
      try {
        this.acx.timer.after(16, (cx) => {
          for (const k of this.pending) this.on.add(k);
          this.pending.clear();
          cx.notify();
        });
      } catch { this.on.add(key); return true; }
    }
    this.pending.add(key);
    return false;
  }
  /** Already shown, no entrance (e.g. notes restored from a draft).
   *  @param {string} key */
  mark(key) { this.on.add(key); }
  /** Gone: the next time it's drawn it comes in again.
   *  @param {string} key */
  forget(key) { this.on.delete(key); this.pending.delete(key); }
}

/** Fades `el` in and lifts it `dy` px into place once `shown`. */
/** @type {<E extends import("gpui-kit").Element>(el: E, shown: boolean, dy?: number, policy?: import("./types").Motion) => E} */
export const fadeIn = (el, shown, dy = 6, policy = SOFT) => el.relative().top(shown ? 0 : dy).opacity(shown ? 1 : 0)
  .transition("opacity", policy).transition("top", policy);

// A status dot; `pulse` breathes a halo around it (native loop, no timer).
/** @param {Color} color @param {boolean} [pulse] @param {number} [size] @returns {Element} */
export function dot(color, pulse = false, size = 8) {
  return div().relative().flex_none().w(size).h(size)
    .when(pulse, (el) => el.child(div().absolute().top(-3).left(-3).w(size + 6).h(size + 6).rounded_full()
      .bg(tint(color, "55")).loop("opacity", { from: 0.15, to: 0.9, period: 1800 })))
    .child(div().absolute().top(0).left(0).w(size).h(size).rounded_full().bg(color));
}

// Round icon badge in a kind's colour.
/** @param {string} ic @param {Color} color @param {number} [size] @param {number} [isz] @returns {Element} */
export const badge = (ic, color, size = 22, isz = 12) => div().w(size).h(size).rounded_full().flex_none()
  .bg(tint(color, "24")).border_1().border_color(tint(color, "55")).text_color(color)
  .flex().items_center().justify_center().child(icon(ic, isz));

/** @param {string} text @param {Color} color @returns {Element} */
export function kbd(text, color) {
  return div().flex_none().h(17).px(4).rounded(4).border_1().border_color(tint(color, "55"))
    .flex().items_center().text_size(10).text_color(color).opacity(0.85).child(text);
}

// variant: ghost | outline | solid. `color` tints outline and solid.
// `split`: the left half of a split button (square right corners); `chevron` is the right half.
/**
 * @param {string} id
 * @param {Record<string, import("gpui-kit").Color>} t
 * @param {import("./types").BtnOpts} opts
 */
export function btn(id, t, { label, ic, variant = "ghost", color, kbd: k, disabled = false, active = false, tooltip, onClick, split = false }) {
  const c = color ?? t.foreground;
  const fg = variant === "solid" ? t.background : variant === "outline" ? c : active ? t.foreground : t.muted;
  let el = h_flex().id(id).h(28).flex_none().items_center().gap(6).text_size(12.5).font_medium()
    .px(label ? 10 : 7).text_color(fg);
  el = split ? el.rounded_l(7) : el.rounded(7);
  if (variant === "solid") el = el.bg(c).border_1().border_color(c);
  else if (variant === "outline") el = el.border_1().border_color(tint(c, "77"));
  else el = el.when(active, (e) => e.bg(t.selected));
  // Enabling / disabling eases rather than snaps.
  return el.opacity(disabled ? 0.4 : 1).transition("opacity", QUICK)
    .when(!disabled, (e) => e.cursor_pointer()
      .hover((s) => (variant === "solid" ? s.opacity(0.88) : variant === "outline" ? s.bg(tint(c, "1a")) : s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => onClick(cx)))
    .when(!!tooltip, (e) => e.tooltip(tooltip))
    .when(!!ic, (e) => e.child(icon(ic, 14)))
    .when(!!label, (e) => e.child(label))
    .when(!!k, (e) => e.child(kbd(k, fg)));
}

/** The right half of a split button (pairs with `btn(..., {split: true})`): a ▾ that opens a menu. The press is the
 *  Popover's (it wraps this as its trigger), so there is no click handler here.
 *  @param {string} id @param {Theme} t
 *  @param {{ variant?: "ghost" | "outline" | "solid"; color?: Color; disabled?: boolean; open?: boolean; tooltip?: string }} opts
 *  @returns {Element} */
export function chevron(id, t, { variant = "outline", color, disabled = false, open = false, tooltip }) {
  const c = color ?? t.foreground;
  const fg = variant === "solid" ? t.background : c;
  let el = h_flex().id(id).h(28).w(24).flex_none().items_center().justify_center().rounded_r(7).text_size(9).text_color(fg);
  // Solid: a 1px gap from the left half is the divider. Outline: the left half's right border is.
  if (variant === "solid") el = el.ml(1).bg(c).border_1().border_color(c);
  else el = el.border_1().border_l_0().border_color(tint(c, "77")).when(open, (e) => e.bg(tint(c, "1a")));
  return el.opacity(disabled ? 0.4 : 1).transition("opacity", QUICK)
    .when(!disabled, (e) => e.cursor_pointer()
      .hover((s) => (variant === "solid" ? s.opacity(0.88) : s.bg(tint(c, "1a")))))
    .when(!!tooltip, (e) => e.tooltip(tooltip))
    .child(open ? "▴" : "▾");
}

// ---- spool -------------------------------------------------------------------

export const spool = () => `${appHome()}/data/review`;
/** @param {string} n @returns {boolean} */
export const isReviewId = (n) => /^(rv|pr)-[\w-]+$/.test(n);
export const openInboxAction = { name: "mod.open", args: { name: "review-inbox" } };

/** Opens (or reopens) review `id` as a floating window, one spot per agent, and records where it is
 *  so the bridge can close it after a decision. `extra`: more props ({gentle: true}: fade in, leave the keyboard).
 *  Returns the overlay id.
 *  @param {string} id @param {ReviewRequest | null} req @param {ReviewConfig} cfg
 *  @param {{ gentle?: boolean }} extra @returns {Promise<string>} */
export async function openReviewWindow(id, req, cfg, extra = {}) {
  const overlay = openOverlay({ kind: "window", mod: "review", props: { id, float: true, ...extra },
    key: `review-${safe(req?.terminal ?? id)}`, width: cfg.window.width, height: cfg.window.height });
  await fs.writeFile(`${spool()}/${id}/meta.json`, JSON.stringify({ overlay, pane: null })).catch(() => {});
  return overlay;
}

/** Opens review `id` where the settings say: a floating window, or beside its agent (a split, else a tab in its
 *  space). A split or tab can't report its pane here (run() returns nothing): the review records it itself
 *  (main.js recordOwnPane). `gentle`: fade in and leave the keyboard where it is (and the person where they are).
 *  @param {string} id @param {ReviewRequest | null} req @param {ReviewConfig} cfg
 *  @param {{ gentle?: boolean }} opts @returns {Promise<string | null>} */
export async function openReviewPlaced(id, req, cfg, { gentle = false } = {}) {
  const props = gentle ? { id, gentle: true } : { id };
  const place = cfg.window.place;
  if (place === "float") return openReviewWindow(id, req, cfg, gentle ? { gentle: true } : {});
  await fs.writeFile(`${spool()}/${id}/meta.json`, JSON.stringify({ pane: null, opening: Date.now() })).catch(() => {});
  const pane = agents().find((a) => a.address === req?.terminal)?.pane;
  if (!gentle && req?.terminal) run("agent.focus", { terminal: req.terminal });
  if (place !== "tab" && pane) run("pane.split", { pane, direction: place === "down" ? "down" : "right", mod: "review", props });
  else run("tab.new", { space: req?.space, mod: "review", props, name: req?.kind === "plan" ? "Plan review" : req?.kind === "choice" ? "Decision" : "Review" });
  return null;
}

/** Where review `id` stands, from its spool files (see bin/bridge.mjs):
 *  pending (an agent waits for a decision) · draft (send mode, unsent notes) · open (send mode, nothing unsent)
 *  · approved · changes · answered (a choice) · sent · dismissed · replaced · interrupted. Null when it has no request.
 *  @param {string} id @returns {Promise<ReviewRecord | null>} */
export async function readReview(id) {
  const dir = `${spool()}/${id}`;
  const req = await readJson(`${dir}/request.json`);
  if (!req) return null;
  const [decision, sent, draft, seen] = await Promise.all(["decision", "sent", "draft", "seen"].map((n) => readJson(`${dir}/${n}.json`)));
  let cancelled = null;
  try { cancelled = (await fs.readFile(`${dir}/cancelled`, "utf8")).trim() || "interrupted"; } catch {}
  const notes = Array.isArray(draft) ? draft.length : 0;
  /** @type {ReviewState} */
  let state;
  if (decision?.decision === "approve") state = "approved";
  else if (decision?.decision === "answer") state = "answered";
  else if (decision?.decision === "deny") state = req.mode === "send" ? "sent" : "changes";
  else if (decision?.decision === "dismissed") state = "dismissed";
  else if (cancelled) state = cancelled === "replaced" ? "replaced" : "interrupted";
  else if (req.mode === "send") state = notes ? "draft" : sent ? "sent" : "open";
  else state = "pending";
  const at = decision?.at ?? sent?.at ?? req.created;
  return { id, dir, req, state, decision, sent, seen, notes, at, needsYou: state === "pending" || state === "draft" || state === "open" };
}
