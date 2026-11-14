// Which agents work in which worktree, and which worktree needs you first.
// Pure (no herdr imports, callers pass panes() and spaces()) so it can be tested in Node.
import { norm, samePath, within } from "./paths.js";
import { dirtyCount } from "./load.js";

/** @import { WorktreeSummary } from "./types" */
/** @import { PaneInfo, SpaceInfo } from "herdr" */

/**
 * Agent terminals by the worktree their folder is in. Nested worktrees (a
 * `.worktrees/x` inside the main checkout) go to the deepest one. Only panes in
 * spaces on machine `on` count: the same path on another machine is another folder.
 * @param {string[]} paths the worktrees' folders
 * @param {PaneInfo[]} panes
 * @param {SpaceInfo[]} spaces
 * @param {string | null} on
 * @returns {Map<string, PaneInfo[]>} keyed by the path as given
 */
export function agentsByWorktree(paths, panes, spaces, on) {
  /** @type {Map<string, PaneInfo[]>} */
  const out = new Map();
  for (const p of paths) out.set(p, []);
  /** @type {Map<string, string | null>} */
  const machineOfTab = new Map();
  for (const s of spaces) for (const t of s.tabs) machineOfTab.set(t.id, s.machine ?? null);
  // Deepest first, so the first hit is the innermost worktree.
  const byDepth = [...paths].sort((a, b) => norm(b).length - norm(a).length);
  for (const p of panes) {
    if (!p.terminal || !p.cwd || !(p.status || p.program?.agent)) continue;
    if ((machineOfTab.get(p.tab) ?? null) !== (on ?? null)) continue;
    const hit = byDepth.find((w) => samePath(p.cwd, w) || within(p.cwd, w));
    if (hit) out.get(hit).push(p);
  }
  return out;
}

/**
 * How much a worktree needs you, lower first: 0 conflicts or an operation in
 * progress, 1 an agent blocked, 2 an agent done, 3 uncommitted changes, 4 commits
 * the base lacks, 5 clean, 6 merged, missing or unreadable.
 * @param {WorktreeSummary} w
 * @param {{ status: string | null }[]} agents
 * @returns {number}
 */
export function attention(w, agents) {
  if (w.prunable || w.error) return 6;
  if (w.op || (w.status?.conflicts.length ?? 0) > 0) return 0;
  if (agents.some((a) => a.status === "blocked")) return 1;
  if (agents.some((a) => a.status === "done")) return 2;
  if (dirtyCount(w.status) > 0) return 3;
  if (w.merged) return 6;
  if ((w.base?.ahead ?? 0) > 0) return 4;
  return 5;
}

/**
 * The overview's order: the current checkout first, then by attention, then the latest commit.
 * @param {WorktreeSummary[]} list
 * @param {Map<string, { status: string | null }[]>} agents
 * @param {string | null} current
 * @returns {WorktreeSummary[]}
 */
export function sortWorktrees(list, agents, current) {
  const rank = new Map(list.map((w) => [w, attention(w, agents.get(w.path) ?? [])]));
  return [...list].sort((a, b) =>
    Number(samePath(b.path, current)) - Number(samePath(a.path, current))
    || rank.get(a) - rank.get(b)
    || (b.tip?.at ?? 0) - (a.tip?.at ?? 0));
}

/**
 * Totals for the overview header and the sidebar's summary row.
 * @param {{ path: string, dirty?: number | null, status?: import("./types").Status | null, op?: unknown, prunable: boolean }[]} list
 * @param {Map<string, { status: string | null }[]>} agents
 * @returns {{ count: number, dirty: number, conflicted: number, blocked: number, working: number }}
 */
export function totals(list, agents) {
  let dirty = 0, conflicted = 0, blocked = 0, working = 0;
  for (const w of list) {
    const n = w.status ? dirtyCount(w.status) : w.dirty ?? 0;
    if (n > 0) dirty++;
    if (w.op || (w.status?.conflicts.length ?? 0) > 0) conflicted++;
    for (const a of agents.get(w.path) ?? []) {
      if (a.status === "blocked") blocked++;
      else if (a.status === "working") working++;
    }
  }
  return { count: list.length, dirty, conflicted, blocked, working };
}
