// Hand-written types for the space-tree mod (dev-only: tsc reads it, the installers don't copy it).
// The shared fixes to Herdr's own types are in /types/herdr.d.ts.

/** One entry of overrides.json. */
export interface IconOverride {
  /** An index into GLYPHS, or a glyph name. */
  glyph?: number | string;
  /** An index into COLORS, a theme color name, or "#rrggbb". */
  color?: number | string;
}

/** overrides.json: lowercase space name → its override. Parsed JSON, so entries are unchecked. */
export type Overrides = Record<string, IconOverride>;

/** What iconFor() returns. */
export interface Icon {
  /** An icon name from GLYPHS (icons/<glyph>.svg). */
  glyph: string;
  /** A theme color name, or "#rrggbb". */
  color: string;
}

/** theme(): color name → hex color. */
export type Theme = Record<string, import("gpui-kit").Color>;
