// Hand-written types for the space-tree mod (dev-only: tsc reads it, the installers don't copy it).
// The shared fixes to Herdr's own types are in /types/herdr.d.ts.

/** One entry of overrides.json. */
export interface IconOverride {
  /** An index into GLYPHS, or a glyph name. */
  glyph?: number | string;
  /** Generate the geometric icon from this string instead of the space name. */
  seed?: string;
  /** Force a geometric family (geo.js FAMILIES). */
  family?: string;
}

/** overrides.json: lowercase space name → its override. Parsed JSON, so entries are unchecked. */
export type Overrides = Record<string, IconOverride>;

/** What iconFor() returns. */
export interface Icon {
  /** A Lucide icon name from GLYPHS (icons/<glyph>.svg) when overrides pin one; else null (geometric). */
  glyph: string | null;
  /** The geometric icon's seed. */
  seed: string;
  /** A forced geometric family, if any. */
  family?: string;
}

/** theme(): color name → hex color. */
export type Theme = Record<string, import("gpui-kit").Color>;
