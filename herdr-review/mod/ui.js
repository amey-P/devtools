// Shared by the review (main.js) and the inbox (inbox.js): theme helpers, small widgets, config, spool reads.
import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import * as fs from "fs/promises";
import { appHome, openOverlay } from "herdr";
import * as core from "./config-core.js";
export const ICONS = "mods/review/icons";
export const AGENT_NAMES = { claude: "Claude Code", "claude-code": "Claude Code", pi: "pi", codex: "Codex" };
export const base = (f) => (f ?? "").split(/[\\/]/).pop();
export const safe = (s) => String(s).replace(/[^\w.-]/g, "_");

// Approve / replacement green: the theme's ANSI green (its `done` is blue in some themes).
export const green = (t) => t.ansi2 ?? t.done;

export const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);
export const clip = (s, n) => { const o = s.replace(/\s+/g, " ").trim(); return o.length > n ? o.slice(0, n - 1) + "…" : o; };
export const readJson = async (p) => { try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; } };
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
// ---- settings (config-core.js has the rules; bin/config.mjs reads the same files for node) -----------------

// Only if config.defaults.json can't be read: enough to open a window.
const FALLBACK = { window: { place: "float", width: 0.6, height: 0.8, focus: true, arrive: "open" },
  ui: { font: "", textSize: 0, contentWidth: 860, sidebarWidth: 320, sidebar: "auto", readingTime: true }, prompts: null };
let defaults = null;
export async function configDefaults() {
  defaults ??= await readJson(`${appHome()}/mods/review/config.defaults.json`);
  return defaults ?? FALLBACK;
}
export const configPath = () => `${appHome()}/data/review/config.json`;
/** config.json as written (an empty object when missing). */
export const readConfigFile = async () => (await readJson(configPath())) ?? {};
/** The settings in effect: {window, ui, prompts} (prompts is null without the defaults file). */
export async function readConfig() {
  return core.merge(await configDefaults(), await readConfigFile());
}
/** Saves settings `cfg` (keeping only what differs from the defaults, and keys this version doesn't know). */
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
/** Text sizes scaled by the `ui.textSize` setting: sizes are designed for 13px text; 0 (the default) leaves them. */
export const scaler = (cfg) => { const r = (cfg?.ui?.textSize || 13) / 13; return (n) => Math.round(n * r * 2) / 2; };
/** Applies `ui.font` to an element (text styles inherit, so everything inside follows). */
export const withFont = (el, cfg) => (cfg?.ui?.font ? el.font_family(cfg.ui.font) : el);

// Stops a press from reaching a floating window's drag (and the root's focus grab).
export const stopPress = (_e, cx) => cx.stop_propagation();

export const store = {
  get(k) { try { return localStorage.getItem(k) ?? null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

export const icon = (name, size = 14) => svg(`${ICONS}/${name}.svg`).size(size).flex_none();

// A layer that fills its (relative) parent with a gradient: soft washes behind headers and cards.
export const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
export const wash = (from, to, angle = 90) =>
  window.paint_path(RECT(), Background.linear_gradient(angle, from, to).color_space("oklab")).absolute().top(0).left(0).size_full();

// A status dot; `pulse` breathes a halo around it (native loop, no timer).
export function dot(color, pulse = false, size = 8) {
  return div().relative().flex_none().w(size).h(size)
    .when(pulse, (el) => el.child(div().absolute().top(-3).left(-3).w(size + 6).h(size + 6).rounded_full()
      .bg(tint(color, "55")).loop("opacity", { from: 0.15, to: 0.9, period: 1800 })))
    .child(div().absolute().top(0).left(0).w(size).h(size).rounded_full().bg(color));
}

// Round icon badge in a kind's colour.
export const badge = (ic, color, size = 22, isz = 12) => div().w(size).h(size).rounded_full().flex_none()
  .bg(tint(color, "24")).border_1().border_color(tint(color, "55")).text_color(color)
  .flex().items_center().justify_center().child(icon(ic, isz));

export function kbd(text, color) {
  return div().flex_none().h(17).px(4).rounded(4).border_1().border_color(tint(color, "55"))
    .flex().items_center().text_size(10).text_color(color).opacity(0.85).child(text);
}

// variant: ghost | outline | solid. `color` tints outline and solid.
export function btn(id, t, { label, ic, variant = "ghost", color, kbd: k, disabled = false, active = false, tooltip, onClick }) {
  const c = color ?? t.foreground;
  const fg = variant === "solid" ? t.background : variant === "outline" ? c : active ? t.foreground : t.muted;
  let el = h_flex().id(id).h(28).flex_none().items_center().gap(6).rounded(7).text_size(12.5).font_medium()
    .px(label ? 10 : 7).text_color(fg);
  if (variant === "solid") el = el.bg(c).border_1().border_color(c);
  else if (variant === "outline") el = el.border_1().border_color(tint(c, "77"));
  else el = el.when(active, (e) => e.bg(t.selected));
  return el
    .when(disabled, (e) => e.opacity(0.4))
    .when(!disabled, (e) => e.cursor_pointer()
      .hover((s) => (variant === "solid" ? s.opacity(0.88) : variant === "outline" ? s.bg(tint(c, "1a")) : s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => onClick(cx)))
    .when(!!tooltip, (e) => e.tooltip(tooltip))
    .when(!!ic, (e) => e.child(icon(ic, 14)))
    .when(!!label, (e) => e.child(label))
    .when(!!k, (e) => e.child(kbd(k, fg)));
}

// ---- spool -------------------------------------------------------------------

export const spool = () => `${appHome()}/data/review`;
export const isReviewId = (n) => /^(rv|pr)-[\w-]+$/.test(n);
export const openInboxAction = { name: "mod.open", args: { name: "review-inbox" } };

/** Opens (or reopens) review `id` as a floating window, one spot per agent, and records where it is
 *  so the bridge can close it after a decision. Returns the overlay id. */
export async function openReviewWindow(id, req, cfg) {
  const overlay = openOverlay({ kind: "window", mod: "review", props: { id, float: true },
    key: `review-${safe(req?.terminal ?? id)}`, width: cfg.window.width, height: cfg.window.height });
  await fs.writeFile(`${spool()}/${id}/meta.json`, JSON.stringify({ overlay, pane: null })).catch(() => {});
  return overlay;
}

/** Where review `id` stands, from its spool files (see bin/bridge.mjs):
 *  pending (an agent waits for a decision) · draft (send mode, unsent notes) · open (send mode, nothing unsent)
 *  · approved · changes · sent · dismissed · replaced · interrupted. Null when it has no request. */
export async function readReview(id) {
  const dir = `${spool()}/${id}`;
  const req = await readJson(`${dir}/request.json`);
  if (!req) return null;
  const [decision, sent, draft, seen] = await Promise.all(["decision", "sent", "draft", "seen"].map((n) => readJson(`${dir}/${n}.json`)));
  let cancelled = null;
  try { cancelled = (await fs.readFile(`${dir}/cancelled`, "utf8")).trim() || "interrupted"; } catch {}
  const notes = Array.isArray(draft) ? draft.length : 0;
  let state;
  if (decision?.decision === "approve") state = "approved";
  else if (decision?.decision === "deny") state = req.mode === "send" ? "sent" : "changes";
  else if (decision?.decision === "dismissed") state = "dismissed";
  else if (cancelled) state = cancelled === "replaced" ? "replaced" : "interrupted";
  else if (req.mode === "send") state = notes ? "draft" : sent ? "sent" : "open";
  else state = "pending";
  const at = decision?.at ?? sent?.at ?? req.created;
  return { id, dir, req, state, decision, sent, seen, notes, at, needsYou: state === "pending" || state === "draft" || state === "open" };
}
