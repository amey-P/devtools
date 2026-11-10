// Hand-written types for the git mod (dev-only: tsc reads it, the installers don't copy it).
// The shared fixes to Herdr's own types are in /types/herdr.d.ts.

/** theme(): color name → hex color. */
export type Theme = Record<string, import("gpui-kit").Color>;

// ---- git output (main.js parsers) ------------------------------------------------------------------------------

/** One changed file from `git status --porcelain=v2`, with numstat counts merged in when git reported them. */
export interface FileChange {
  path: string;
  /** The porcelain status letter: "M", "A", "D", … , "U" (conflict), "?" (untracked). */
  code: string;
  add?: number;
  del?: number;
  binary?: boolean;
}

/** parseStatus(): the branch header and the changed files. */
export interface Status {
  /** null when detached. */
  branch: string | null;
  /** null before the first commit. */
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileChange[];
  modified: FileChange[];
  untracked: FileChange[];
  conflicts: FileChange[];
}

/** One file's line counts from `git diff --numstat`. */
export interface NumStat { add: number; del: number; binary: boolean }

/** A ref decorating a commit (parseRefs()). */
export interface Ref {
  kind: "head" | "detached" | "tag" | "remote" | "local";
  name: string;
  /** remote refs: the remote's name. */
  remote?: string;
  /** local / head refs: remotes whose branch of the same name points at the same commit. */
  synced?: string[];
  /** A remote ref shown inside its local twin's pill instead. */
  hidden?: boolean;
}

/** One commit in the graph, newest first. The "wip" pseudo-commit stands for uncommitted changes. */
export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  /** Author time, seconds since the epoch (0 for wip). */
  at: number;
  refs: Ref[];
  subject: string;
  /** It is HEAD's commit. */
  head?: boolean;
  wip?: boolean;
  /** Its graph row, attached after layout(). */
  row?: GraphRow;
}

/** The selected commit's details panel. */
export interface Detail {
  hash: string;
  wip?: boolean;
  loading?: boolean;
  message?: string;
  date?: string;
  committer?: string;
  files?: (NumStat & { path: string })[];
}

// ---- graph.js ----------------------------------------------------------------------------------------------------

/** A line segment through one half of a row, from lane `from` to lane `to`. color: a palette index. */
export interface Segment { from: number; to: number; color: number; dash: boolean }

/** A row's stroke paths, grouped by color and dash (rowPaths()). color: a palette index. */
export interface RowPath { color: number; path: import("gpui-kit").Path }

/** One row of the laid-out graph. */
export interface GraphRow {
  /** The commit's lane. */
  col: number;
  /** The node's palette index. */
  color: number;
  /** Segments in the top half (into the node or straight past). */
  top: Segment[];
  /** Segments in the bottom half (out to the parents or straight past). */
  bottom: Segment[];
  /** Lanes this row uses. */
  cols: number;
  merge: boolean;
  /** rowPaths() output, built on first draw and kept. */
  paths: RowPath[] | null;
}

/** layout(): the rows, the widest row's lane count, and each commit's row index by hash. */
export interface Graph { rows: GraphRow[]; cols: number; index: Map<string, number> }

/** What layout() reads from a commit. */
export type GraphCommit = Pick<Commit, "hash" | "parents" | "wip">;
