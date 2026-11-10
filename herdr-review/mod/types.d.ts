// Hand-written types for the review mod (dev-only: tsc reads it, install.mjs doesn't copy it).
// The shared fixes to Herdr's own types are in /types/herdr.d.ts.

/** Options for ui.js btn(). */
export interface BtnOpts {
  label?: string;
  ic?: string;
  /** ghost (default) | outline | solid */
  variant?: "ghost" | "outline" | "solid";
  /** Tints outline and solid. */
  color?: import("gpui-kit").Color;
  kbd?: string;
  disabled?: boolean;
  active?: boolean;
  tooltip?: string;
  onClick?: (cx: any) => unknown;
  /** The left half of a split button. */
  split?: boolean;
}

/** Options for feedback.js toMarkdown(). */
export interface MarkdownOpts {
  heading?: string;
  /** Replaces the intro: a string with {subject}/{count}, or (count) => string. */
  intro?: string | ((count: number) => string);
  subject?: string;
  labels?: { intro?: string | string[]; sections?: Partial<Record<"remove" | "change" | "on" | "decision" | "general" | "generalOnly", string>> };
}

export type Motion = import("gpui-shell").TransitionPolicy;

/** An annotation (see the top of feedback.js). */
export interface Annotation {
  id: string;
  /** Block index, or null for general (or stale) annotations. */
  block: number | null;
  type: "comment" | "delete" | "replace" | "general" | "choice";
  quote?: string;
  text: string;
  stale?: boolean;
  created?: number;
  /** choice only */
  question?: string;
  picked?: string[];
}
