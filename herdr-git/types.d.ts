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

// ---- discovery and repo state (discover.js, load.js) -------------------------------------------------------------

/** What `exec` resolves with. */
export interface ExecResult { code: number; stdout: string; stderr: string }
/** Runs git with these args in a folder. */
export type RunGit = (args: string[], cwd: string) => Promise<ExecResult>;
/** Runs git in the repo's own folder. */
export type RunIn = (args: string[]) => Promise<ExecResult>;
/** Reads a text file; null (or a rejection) when it's missing. */
export type ReadFile = (path: string) => Promise<string | null>;

/**
 * A repository found by discover(). Paths use forward slashes.
 * - main: an ordinary checkout; linked: a `git worktree add` checkout;
 * - bare: no work tree (`--bare`, or the `.bare` + `.git` file layout);
 * - submodule: a checkout inside another repo.
 */
export interface Repo {
  kind: "main" | "linked" | "bare" | "submodule";
  /** The work tree, null for bare. */
  root: string | null;
  /** This checkout's own git dir (…/.git, …/.git/worktrees/<name>, …/modules/<x>). */
  gitDir: string;
  /** The shared git dir: refs, objects, config. */
  commonDir: string;
  /** For submodules, the outer repo's work tree. */
  superproject: string | null;
  /** gitDir differs from commonDir (a linked worktree). */
  linked: boolean;
}

/** A local branch (for-each-ref). */
export interface Branch {
  name: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** The upstream was deleted. */
  gone: boolean;
  /** Committer time, seconds. */
  at: number;
  oid: string;
  /** The worktree it's checked out in, if any. */
  worktree: string | null;
  /** HEAD of this checkout. */
  head: boolean;
  subject: string;
}

/** One checkout from `git worktree list`. */
export interface Worktree {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  /** Changed tracked files, null when not read. */
  dirty: number | null;
}

/** One `git stash list` entry. */
export interface Stash { ref: string; subject: string; at: number }

/** A git operation in progress. */
export interface Operation {
  op: "rebase" | "merge" | "cherry-pick" | "revert" | "bisect";
  step: number | null;
  total: number | null;
  /** The branch being rebased. */
  branch: string | null;
  /** Short oid: the rebase base, or the commit being merged/picked. */
  onto: string | null;
}

/** loadRefs(). */
export interface RefsState {
  branches: Branch[];
  worktrees: Worktree[];
  stashes: Stash[];
  /** name → fetch URL */
  remotes: Record<string, string>;
  /** Latest reachable tag. */
  tag: string | null;
  /** Commits HEAD is past that tag. */
  tagSince: number;
}

/** A commit in the sidebar's short lists (parseRecent()). */
export interface RecentCommit {
  hash: string;
  author: string;
  email: string;
  /** Committer time, seconds. */
  at: number;
  subject: string;
  /** Not on the upstream yet. */
  unpushed: boolean;
}

/** loadInsight(): what the sidebar shows beyond the status. */
export interface Insight {
  /** HEAD's latest commits, newest first. */
  recent: RecentCommit[];
  /** Upstream commits HEAD doesn't have, newest first. */
  incoming: RecentCommit[];
  /** Commits per day for the last 14 days, oldest first (the last is today). */
  activity: number[];
  /** Commits reachable from HEAD. */
  total: number;
  /** HEAD against the base branch, null when there is none. */
  base: BaseDelta | null;
}

/** A checkout against the base branch (loadBase()). */
export interface BaseDelta {
  /** The base branch, e.g. "origin/main". */
  ref: string;
  /** Commits on HEAD that the base doesn't have. */
  ahead: number;
  /** Commits on the base that HEAD doesn't have. */
  behind: number;
}

/** One checkout as the worktree overview shows it (loadWorktreeSummary()). */
export interface WorktreeSummary extends Worktree {
  /** Its own git dir (…/.git/worktrees/<name>, or the shared one for the main checkout). */
  gitDir: string | null;
  status: Status | null;
  /** Lines added and removed against HEAD, staged and not. */
  add: number;
  del: number;
  base: BaseDelta | null;
  /** On a branch with nothing the base lacks and a clean tree: done, safe to remove. */
  merged: boolean;
  /** No commits of its own yet (a branch just made for an agent), dirty or not. */
  fresh: boolean;
  tip: { subject: string; at: number } | null;
  op: Operation | null;
  /** Why it couldn't be read. */
  error: string | null;
}
