// 64 distinct Lucide line icons (icons/<name>.svg, ISC) x 7 theme colors = 448 icons.
// Order matters: changing either list reshuffles every space's icon. Append only.

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

// Theme color names, looked up in theme() at render time so the rail follows
// the applied theme (catppuccin: red, yellow, green, teal, blue, pink, mauve).
export const COLORS = ["ansi1", "ansi3", "ansi2", "ansi6", "ansi4", "ansi5", "accent"];

// 32-bit FNV-1a.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// A space's icon from its name. `overrides`: { "<lowercase name>": { glyph: index|name, color: index|theme name|"#hex" } }.
// Returns { glyph: icon name, color: a theme color name or "#rrggbb" }.
export function iconFor(name, overrides = {}) {
  const key = (name ?? "").trim().toLowerCase();
  const h = fnv1a(key);
  let glyph = GLYPHS[h % GLYPHS.length];
  let color = COLORS[(h >>> 16) % COLORS.length];
  const o = overrides[key];
  if (o) {
    if (typeof o.glyph === "number" && GLYPHS[o.glyph]) glyph = GLYPHS[o.glyph];
    else if (typeof o.glyph === "string" && GLYPHS.includes(o.glyph)) glyph = o.glyph;
    if (typeof o.color === "number" && COLORS[o.color]) color = COLORS[o.color];
    else if (typeof o.color === "string" && o.color) color = o.color;
  }
  return { glyph, color };
}

// "#rrggbb" or "#rrggbbaa" at opacity `a` (0..1).
export function alpha(hex, a) {
  const base = String(hex).slice(0, 7);
  return base + Math.round(a * 255).toString(16).padStart(2, "0");
}
