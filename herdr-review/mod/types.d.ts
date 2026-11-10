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

/** theme(): color name → hex color. */
export type Theme = Record<string, import("gpui-kit").Color>;

// ---- settings (config-core.js, ui.js readConfig) -----------------------------------------------------------

/** A text setting: one string, or an array of lines (config-core text() joins them). */
export type Text = string | string[];

/**
 * A parsed JSON object as config-core walks it (config.json, config.defaults.json): raw and unvalidated, so its
 * values really can be anything until problem() has checked them.
 */
export type RawTree = Record<string, any>;

/** A rule beyond "same type as the default": the test, and what to say when it fails (config-core RULES). */
export type Rule = [test: (value: any) => boolean, says: string];

export type Place = "float" | "right" | "down" | "tab";
export type Arrival = "open" | "inbox";
export type SidebarMode = "auto" | "open" | "closed";

/** A heading + subject pair (prompts.feedback.plan / reply / file). */
export interface FeedbackKindText { heading: Text; subject: Text }

/** config.defaults.json "prompts". */
export interface Prompts {
  deny: Text;
  approvedWithNotes: Text;
  feedback: {
    intro: Text;
    plan: FeedbackKindText;
    reply: FeedbackKindText;
    file: FeedbackKindText;
    sections: Record<"remove" | "change" | "on" | "decision" | "general" | "generalOnly", Text>;
  };
  notes: { plan: { heading: Text; intro: Text }; other: { heading: Text; intro: Text } };
  pi: { planMode: Text; planOff: Text };
}

/** The settings in effect (ui.js readConfig(): config-core merge() of the defaults and config.json). */
export interface ReviewConfig {
  window: { place: Place; width: number; height: number; focus: boolean; arrive: Arrival };
  ui: { font: string; textSize: number; contentWidth: number; sidebarWidth: number; sidebar: SidebarMode; readingTime: boolean };
  /** null only when config.defaults.json can't be read (ui.js FALLBACK). */
  prompts: Prompts | null;
}

// ---- the spool: <app home>/data/review/<id>/ (see the top of bin/bridge.mjs) --------------------------------

export type ReviewKind = "plan" | "ask" | "choice" | "file" | "reply";
export type ReviewMode = "decision" | "send";

/** One question of a choice review (AskUserQuestion's shape). */
export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string; preview?: string }[];
}

/** request.json, written by bin/bridge.mjs openReview(). */
export interface ReviewRequest {
  id: string;
  kind: ReviewKind;
  mode: ReviewMode;
  agent: string | null;
  /** The hc terminal that asked. */
  terminal: string;
  /** Where send-mode feedback is typed. */
  target: string;
  cwd: string;
  title: string;
  content: string;
  file: string | null;
  session: string | null;
  version: number;
  /** ms since the epoch */
  created: number;
  space: string;
  tab: string;
  parent: { app: string | null; space_name: string | null; tab_name: string | null; name: string | null };
  place: Place;
  questions?: Question[];
  /** Older requests carried the plan here instead of in content. */
  plan?: string;
}

/** decision.json (the mod writes it). */
export type Decision =
  | { decision: "approve" | "deny" | "dismissed"; feedback?: string; notes?: string; at: number }
  | { decision: "answer"; answers: Record<string, string>; notes?: Record<string, string>; at: number };

/** seen.json: when the person opened the review / put it off. */
export interface Seen { opened_at?: number; deferred_at?: number }

/** sent.json: the last send of a send-mode review. */
export interface SentRecord { at: number; md: string; to: string }

/** readReview()'s states. "orphaned" is set by the inbox when a pending review's agent is gone. */
export type ReviewState =
  | "pending" | "orphaned" | "draft" | "open" | "approved" | "changes" | "answered" | "sent" | "dismissed" | "replaced" | "interrupted";

/** One review as ui.js readReview() returns it. The inbox adds `live` and `versions` afterwards. */
export interface ReviewRecord {
  id: string;
  dir: string;
  req: ReviewRequest;
  state: ReviewState;
  decision: Decision | null;
  sent: SentRecord | null;
  seen: Seen | null;
  /** Unsent annotations in draft.json. */
  notes: number;
  at: number;
  needsYou: boolean;
  /** inbox.js: its agent's terminal is still running. */
  live?: boolean;
  /** inbox.js: how many versions this review's group has (the newest is shown). */
  versions?: number;
}

// ---- the document (blocks.js) --------------------------------------------------------------------------------

export type BlockKind = "heading" | "item" | "code" | "table" | "quote" | "rule" | "para" | "choice";

/** One annotatable block from splitBlocks(). A choice block also carries its question. */
export interface Block {
  kind: BlockKind;
  src: string;
  /** 0-based line where it starts. */
  line: number;
  /** List nesting depth (0 for everything but items). */
  level: number;
  question?: string;
  options?: { label: string; description?: string }[];
  multi?: boolean;
}
