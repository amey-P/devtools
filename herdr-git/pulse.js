// What makes the sidebar strip light up. Pure (no Herdr imports) so it can be tested in Node.
// After each refresh the view takes a snapshot and compares it with the last
// one: a change worth noticing returns a kind, and the strip glows in that
// kind's color. Ordinary edits (one file saved) return null.

/** @import { Theme } from "./types" */
/** @import { Color } from "gpui-kit" */

/**
 * @typedef {{ gitDir: string | null, branch: string | null, oid: string | null, op: string | null,
 *   conflicts: number, dirty: number, ahead: number, behind: number }} Snapshot
 * @typedef {"switch" | "alert" | "commit" | "sync" | "change"} Pulse
 */

/** A dirty count that moves by this much in one refresh is worth a glow. */
export const BIG_CHANGE = 5;

/**
 * The state the strip shows, reduced to what matters for a glow.
 * @param {{ repo: { gitDir: string } | null, head: { branch: string | null, oid: string | null },
 *   op: { op: string } | null, status: { conflicts: unknown[], staged: unknown[], modified: unknown[], untracked: unknown[], ahead: number, behind: number } | null }} g
 * @returns {Snapshot}
 */
export function snapshot(g) {
  const s = g.status;
  return {
    gitDir: g.repo?.gitDir ?? null,
    branch: g.head?.branch ?? null,
    oid: g.head?.oid ?? null,
    op: g.op?.op ?? null,
    conflicts: s?.conflicts.length ?? 0,
    dirty: s ? s.staged.length + s.modified.length + s.untracked.length + s.conflicts.length : 0,
    ahead: s?.ahead ?? 0,
    behind: s?.behind ?? 0,
  };
}

/**
 * The most important change between two snapshots, or null.
 * @param {Snapshot} a before
 * @param {Snapshot} b after
 * @returns {Pulse | null}
 */
export function substantial(a, b) {
  if (a.gitDir !== b.gitDir || a.branch !== b.branch) return "switch";
  if (a.op !== b.op || (b.conflicts > 0 && a.conflicts === 0)) return "alert";
  if (a.oid !== b.oid) return "commit";
  if (a.ahead !== b.ahead || a.behind !== b.behind) return "sync";
  if ((a.dirty === 0) !== (b.dirty === 0) || Math.abs(a.dirty - b.dirty) >= BIG_CHANGE) return "change";
  return null;
}

/**
 * A pulse's glow color.
 * @param {Pulse | null} kind
 * @param {Theme} t
 * @returns {Color}
 */
export function pulseColor(kind, t) {
  switch (kind) {
    case "alert": return t.blocked;
    case "commit": return t.ansi2;
    case "sync": return t.ansi4;
    case "change": return t.blocked;
    default: return t.accent;
  }
}
