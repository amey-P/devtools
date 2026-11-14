// 64 distinct Lucide line icons (icons/<name>.svg, ISC), used only when overrides.json pins one;
// by default a space gets a seeded geometric icon (geo.js). Glyphs carry no color of their
// own: the renderers ink them with the theme's neutral tokens.
// Order matters: changing the list reshuffles every pinned index. Append only.

export const GLYPHS = [
  "rocket", "cat", "dog", "fish", "bird", "turtle", "rabbit", "squirrel",
  "snail", "rat", "bug", "anchor", "leaf", "tree-pine", "flower-2", "sprout",
  "shell", "mountain", "flame", "snowflake", "moon", "sun", "cloud", "zap",
  "droplet", "star", "heart", "crown", "ghost", "skull", "bot", "gem",
  "key", "bell", "umbrella", "guitar", "music", "coffee", "pizza", "ice-cream-cone",
  "apple", "carrot", "cherry", "plane", "car", "bike", "sailboat", "train-front",
  "book-open", "hammer", "wrench", "compass", "puzzle", "gamepad-2", "lightbulb", "magnet",
  "bomb", "trophy", "flag", "shield", "feather", "palette", "telescope", "tent",
];

/** @import { Overrides, Icon } from "./types" */

// A space's icon from its name: a seeded geometric mark (geo.js) by default.
// `overrides`: { "<lowercase name>": { glyph?: index|name, seed?: string, family?: string } }.
// `glyph` pins a Lucide icon instead; `seed` rerolls the geometric one; `family` forces its family.
// Returns { glyph: Lucide name or null, seed, family }.
/**
 * @param {string} name
 * @param {Overrides} [overrides]
 * @returns {Icon}
 */
export function iconFor(name, overrides = {}) {
  const key = (name ?? "").trim().toLowerCase();
  /** @type {string | null} */
  let glyph = null;
  let seed = key;
  /** @type {string | undefined} */
  let family;
  const o = overrides[key];
  if (o) {
    if (typeof o.glyph === "number" && GLYPHS[o.glyph]) glyph = GLYPHS[o.glyph];
    else if (typeof o.glyph === "string" && GLYPHS.includes(o.glyph)) glyph = o.glyph;
    if (typeof o.seed === "string" && o.seed.trim()) seed = o.seed;
    if (typeof o.family === "string" && o.family) family = o.family;
  }
  return { glyph, seed, family };
}

// "#rrggbb" or "#rrggbbaa" at opacity `a` (0..1).
/**
 * @param {string} hex
 * @param {number} a
 * @returns {import("gpui-kit").Color}
 */
export function alpha(hex, a) {
  const base = String(hex).slice(0, 7);
  return /** @type {import("gpui-kit").Color} */ (base + Math.round(a * 255).toString(16).padStart(2, "0"));
}
