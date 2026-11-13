// Finds the repository for a folder, with no herdr imports: callers pass in
// how to run git and read files, so tests can feed canned output.
//
// Plain `rev-parse --show-toplevel` breaks in a bare repo, in a linked
// worktree (the real git dir is elsewhere), and inside .git. One rev-parse
// call first classifies the repo, then a second asks for the work tree only
// when there is one.
import { norm, dir, base, join, resolve, samePath } from "./paths.js";

/** @import { Repo, RunGit, ReadFile } from "./types" */

const PROBE = ["--is-bare-repository", "--is-inside-work-tree", "--is-inside-git-dir", "--absolute-git-dir", "--git-common-dir"];

/**
 * @param {string} text
 * @returns {string[]}
 */
const lines = (text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/**
 * Classifies the repo that holds `cwd`, or returns null when there is none.
 * @param {string} cwd
 * @param {RunGit} git runs git with these args in a folder
 * @param {ReadFile} read reads a text file, null when missing
 * @returns {Promise<Repo | null>}
 */
export async function discover(cwd, git, read) {
  let r = await git(["rev-parse", "--path-format=absolute", ...PROBE], cwd);
  let relative = false;
  // git < 2.31 has no --path-format: --git-common-dir may then be relative to cwd.
  if (r.code !== 0 && /path-format/.test(r.stderr)) { r = await git(["rev-parse", ...PROBE], cwd); relative = true; }
  if (r.code !== 0) return null;
  const out = lines(r.stdout);
  if (out.length < 5) return null;
  const [bareS, inWtS, , gitDirRaw, commonRaw] = out;
  const gitDir = norm(gitDirRaw);
  const commonDir = relative ? resolve(commonRaw, cwd) : norm(commonRaw);
  const bare = bareS === "true", inWorkTree = inWtS === "true";

  /** @type {Repo} */
  const repo = { kind: "main", root: null, gitDir, commonDir, superproject: null, linked: gitDir !== commonDir };

  if (bare) {
    repo.kind = "bare";
    return repo;
  }
  if (inWorkTree) {
    const t = await git(["rev-parse", "--show-toplevel", "--show-superproject-working-tree"], cwd);
    if (t.code !== 0) return null;
    const [top, superproject] = lines(t.stdout);
    repo.root = norm(top);
    repo.superproject = superproject ? norm(superproject) : null;
    repo.kind = repo.superproject ? "submodule" : repo.linked ? "linked" : "main";
    return repo;
  }
  // Inside .git (or a submodule's git dir, where git reports all three as
  // false because core.worktree is set): describe the work tree it belongs to.
  const root = await ownerOf(gitDir, git, read);
  if (root && !samePath(root, cwd)) {
    const again = await discover(root, git, read);
    if (again) return again;
  }
  repo.kind = "bare";
  return repo;
}

/**
 * The work tree a git dir belongs to, when it has one.
 * @param {string} gitDir
 * @param {RunGit} git
 * @param {ReadFile} read
 * @returns {Promise<string | null>}
 */
export async function ownerOf(gitDir, git, read) {
  // <wt>/.git
  if (base(gitDir) === ".git") return dir(gitDir);
  // <common>/worktrees/<name>/gitdir holds "<wt>/.git".
  const pointer = await read(join(gitDir, "gitdir"));
  if (pointer && pointer.trim()) return dir(resolve(pointer.trim(), gitDir));
  // Submodules: <super>/.git/modules/<x> with core.worktree set.
  const c = await git(["config", "--get", "core.worktree"], gitDir);
  if (c.code === 0 && c.stdout.trim()) return resolve(c.stdout.trim(), gitDir);
  return null;
}

/**
 * Tries each folder in turn and returns the first repo found.
 * @param {(string | null | undefined)[]} candidates
 * @param {RunGit} git
 * @param {ReadFile} read
 * @returns {Promise<{ repo: Repo, cwd: string } | null>}
 */
export async function discoverFirst(candidates, git, read) {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const c of candidates) {
    const cwd = norm(c);
    if (!cwd || seen.has(cwd)) continue;
    seen.add(cwd);
    const repo = await discover(c, git, read);
    if (repo) return { repo, cwd };
  }
  return null;
}
