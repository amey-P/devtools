// Small drawing helpers shared by the full view (main.js) and the sidebar section (sidebar.js).

/** @import { Theme } from "./types" */
/** @import { Color } from "gpui-kit" */

/** @type {(name: string) => string} */
export const ICON = (name) => `mods/git/${name}.svg`;

/**
 * A theme color with a new hex-alpha suffix: (#rrggbb, "1f") → #rrggbb1f.
 * @param {Color} c
 * @param {string} a
 * @returns {Color}
 */
export const alpha = (c, a) => (typeof c === "string" && c.startsWith("#") ? /** @type {Color} */ (c.slice(0, 7) + a) : c);

/**
 * The lane colors for a theme, in graph order.
 * @param {Theme} t
 * @returns {Color[]}
 */
export const palette = (t) => [t.accent, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi4, t.ansi1, t.ansi13, t.ansi14, t.ansi10];

/** @type {(s: string) => number} */
export const hashOf = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };

/** @param {string} name */
export const initials = (name) => (name.trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("") || "?").toUpperCase();

/** @param {number} sec @returns {string} */
export function ago(sec) {
  const d = Date.now() / 1000 - sec;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`;
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))}mo`;
  return `${Math.floor(d / (86400 * 365))}y`;
}

/** A count in at most four characters: 999, 1.2k, 12k, 1.2m. @param {number} n @returns {string} */
export function compact(n) {
  const a = Math.abs(n);
  if (a < 1000) return String(n);
  /** @param {number} v @param {string} u */
  const f = (v, u) => (v < 10 ? (Math.floor(v * 10) / 10).toString() : String(Math.floor(v))) + u;
  return (n < 0 ? "-" : "") + (a < 1e6 ? f(a / 1e3, "k") : f(a / 1e6, "m"));
}

/** @param {number} n @param {string} word @returns {string} */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
