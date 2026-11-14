// Reads repository state with git, no herdr imports: each loader gets a
// `git(args)` already bound to the repo's folder and machine. Parsers are pure.
import { norm, join, base, samePath } from "./paths.js";

/** @import { Repo, RunIn, ReadFile, Status, NumStat, Ref, Commit, Branch, Worktree, Stash, Operation, RefsState, RecentCommit, Insight } from "./types" */

// Reads write nothing under .git (no index refresh, lock or fsmonitor
// cookie), so the folder watch never sees our own reads.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "color.ui=false", "-c", "core.quotepath=false"];
export const LIMIT = 400;
const US = "\x1f", RS = "\x1e";

/** @param {string} text @returns {string[]} */
const lines = (text) => text.split(/\r?\n/).filter(Boolean);

/** @param {string} text @returns {Status} */
export function parseStatus(text) {
  /** @type {Status} */
  const out = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, staged: [], modified: [], untracked: [], conflicts: [] };
  const parts = text.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith("# ")) {
      const [, k, ...v] = line.split(" ");
      if (k === "branch.head") out.branch = v.join(" ") === "(detached)" ? null : v.join(" ");
      else if (k === "branch.oid") out.oid = v[0] === "(initial)" ? null : v[0];
      else if (k === "branch.upstream") out.upstream = v.join(" ");
      else if (k === "branch.ab") { out.ahead = Math.abs(+v[0]); out.behind = Math.abs(+v[1]); }
      continue;
    }
    const f = line.split(" ");
    if (f[0] === "1" || f[0] === "2") {
      const xy = f[1], path = f.slice(f[0] === "1" ? 8 : 9).join(" ");
      if (f[0] === "2") i++; // the original path follows as its own entry
      if (xy[0] !== ".") out.staged.push({ path, code: xy[0] });
      if (xy[1] !== ".") out.modified.push({ path, code: xy[1] });
    } else if (f[0] === "u") out.conflicts.push({ path: f.slice(10).join(" "), code: "U" });
    else if (f[0] === "?") out.untracked.push({ path: line.slice(2), code: "?" });
  }
  return out;
}

/** @param {string} text @returns {Record<string, NumStat>} */
export function parseNumstat(text) {
  /** @type {Record<string, NumStat>} */
  const stats = {};
  for (const entry of text.split("\0")) {
    const [a, d, ...rest] = entry.split("\t");
    if (!rest.length) continue;
    stats[rest.join("\t").replace(/^\r?\n/, "")] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
  }
  return stats;
}

/**
 * @param {string} text the %D decorate list
 * @param {string[]} remotes remote names from `git remote`
 * @returns {Ref[]}
 */
export function parseRefs(text, remotes) {
  /** @type {Ref[]} */
  const refs = [];
  for (const raw of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (raw.startsWith("HEAD -> ")) refs.push({ kind: "head", name: raw.slice(8) });
    else if (raw === "HEAD") refs.push({ kind: "detached", name: "HEAD" });
    else if (raw.startsWith("tag: ")) refs.push({ kind: "tag", name: raw.slice(5) });
    else {
      const remote = remotes.find((r) => raw.startsWith(r + "/"));
      if (remote) { if (!raw.endsWith("/HEAD")) refs.push({ kind: "remote", remote, name: raw.slice(remote.length + 1) }); }
      else refs.push({ kind: "local", name: raw });
    }
  }
  // A remote branch on the same commit as its local twin rides inside the local pill.
  for (const r of refs) if (r.kind === "remote") {
    const twin = refs.find((l) => (l.kind === "local" || l.kind === "head") && l.name === r.name);
    if (twin) { twin.synced = (twin.synced ?? []).concat(r.remote); r.hidden = true; }
  }
  const order = { head: 0, detached: 0, local: 1, remote: 2, tag: 3 };
  return refs.filter((r) => !r.hidden).sort((a, b) => order[a.kind] - order[b.kind]);
}

/**
 * `%(upstream:track,nobracket)`: "ahead 2, behind 1", "gone" or "".
 * @param {string} text
 * @returns {{ ahead: number, behind: number, gone: boolean }}
 */
export function parseTrack(text) {
  const a = /ahead (\d+)/.exec(text), b = /behind (\d+)/.exec(text);
  return { ahead: a ? +a[1] : 0, behind: b ? +b[1] : 0, gone: text.trim() === "gone" };
}

export const BRANCH_FORMAT = ["%(refname:short)", "%(upstream:short)", "%(upstream:track,nobracket)", "%(committerdate:unix)",
  "%(objectname:short)", "%(worktreepath)", "%(HEAD)", "%(contents:subject)"].join("%1f");

/** @param {string} text @returns {Branch[]} */
export function parseBranches(text) {
  return lines(text).map((l) => {
    const [name, upstream, track, at, oid, worktree, head, subject] = l.split(US);
    return { name, upstream: upstream || null, ...parseTrack(track ?? ""), at: +at || 0, oid: oid ?? "",
      worktree: worktree ? norm(worktree) : null, head: head === "*", subject: subject ?? "" };
  });
}

/** `git worktree list --porcelain -z`. @param {string} text @returns {Worktree[]} */
export function parseWorktrees(text) {
  /** @type {Worktree[]} */
  const out = [];
  /** @type {Worktree | null} */
  let cur = null;
  for (const field of text.split("\0")) {
    if (!field) { cur = null; continue; }
    const sp = field.indexOf(" ");
    const k = sp < 0 ? field : field.slice(0, sp), v = sp < 0 ? "" : field.slice(sp + 1);
    if (k === "worktree") { cur = { path: norm(v), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false, dirty: null }; out.push(cur); continue; }
    if (!cur) continue;
    if (k === "HEAD") cur.head = v;
    else if (k === "branch") cur.branch = v.replace(/^refs\/heads\//, "");
    else if (k === "bare") cur.bare = true;
    else if (k === "detached") cur.detached = true;
    else if (k === "locked") cur.locked = true;
    else if (k === "prunable") cur.prunable = true;
  }
  return out;
}

/** @param {string} text @returns {Stash[]} */
export function parseStashes(text) {
  return lines(text).map((l) => { const [ref, subject, at] = l.split(US); return { ref, subject: subject ?? "", at: +at || 0 }; });
}

/** `git remote -v` → name → fetch URL. @param {string} text @returns {Record<string, string>} */
export function parseRemotes(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const l of lines(text)) {
    const [name, url, kind] = l.split(/\s+/);
    if (name && url && (kind === "(fetch)" || !(name in out))) out[name] = url;
  }
  return out;
}

/** @param {string} text @returns {Commit[]} */
export function parseLog(text, /** @type {string[]} */ remotes, /** @type {string | null} */ headOid) {
  return text.split(RS).map((r) => r.replace(/^[\r\n]+|[\r\n]+$/g, "")).filter(Boolean).map((r) => {
    const [hash, parents, author, email, at, refs, subject] = r.split(US);
    return { hash, parents: parents ? parents.split(" ") : [], author, email, at: +at, refs: parseRefs(refs ?? "", remotes), subject: subject ?? "", head: hash === headOid };
  });
}

/** @param {Status} s @returns {number} */
export const dirtyCount = (s) => (s ? s.staged.length + s.modified.length + s.untracked.length + s.conflicts.length : 0);

/**
 * Lines added and removed across staged, modified and conflicted files (untracked have no counts).
 * @param {Status | null} s
 * @returns {{ add: number, del: number }}
 */
export function changeTotals(s) {
  let add = 0, del = 0;
  if (s) for (const f of [...s.staged, ...s.modified, ...s.conflicts]) { add += f.add ?? 0; del += f.del ?? 0; }
  return { add, del };
}

// ── Loaders ──────────────────────────────────────────────────────────────

/**
 * Working-tree status with line counts. Bare repos have none.
 * @param {Repo} repo
 * @param {RunIn} git
 * @returns {Promise<Status | null>}
 */
export async function loadStatus(repo, git) {
  if (!repo.root) return null;
  const [st, staged, unstaged] = await Promise.all([
    git(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--no-renames"]),
    git(["diff", "--cached", "--numstat", "-z", "--no-renames"]),
    git(["diff", "--numstat", "-z", "--no-renames"]),
  ]);
  if (st.code !== 0) throw new Error(st.stderr.trim() || "git status failed");
  const status = parseStatus(st.stdout);
  const sStats = parseNumstat(staged.stdout), uStats = parseNumstat(unstaged.stdout);
  for (const f of status.staged) Object.assign(f, sStats[f.path] ?? {});
  for (const f of [...status.modified, ...status.conflicts]) Object.assign(f, uStats[f.path] ?? {});
  return status;
}

/**
 * Where HEAD points, for repos without a status (bare).
 * @param {RunIn} git
 * @returns {Promise<{ branch: string | null, oid: string | null }>}
 */
export async function loadHead(git) {
  const [b, o] = await Promise.all([git(["symbolic-ref", "--quiet", "--short", "HEAD"]), git(["rev-parse", "--verify", "--quiet", "HEAD"])]);
  return { branch: b.code === 0 ? b.stdout.trim() || null : null, oid: o.code === 0 ? o.stdout.trim() || null : null };
}

/**
 * `git log -1 --format=%s%x1f%ct` output → the last commit's subject and time.
 * @param {string} text
 * @returns {{ subject: string, at: number } | null}
 */
export function parseTip(text) {
  const [subject, at] = text.trim().split("\x1f");
  return subject ? { subject: subject.trim(), at: Number(at) || 0 } : null;
}

/**
 * The commit HEAD points at, for the sidebar strip (which never loads the log).
 * @param {RunIn} git
 * @returns {Promise<{ subject: string, at: number } | null>}
 */
export async function loadTip(git) {
  const r = await git(["log", "-1", "--format=%s%x1f%ct", "HEAD"]);
  return r.code === 0 ? parseTip(r.stdout) : null;
}

/**
 * Branches, worktrees, stashes, remotes and the latest tag.
 * @param {Repo} repo
 * @param {RunIn} git
 * @param {(path: string, args: string[]) => ReturnType<RunIn>} gitAt runs git in another folder on the same machine
 * @returns {Promise<RefsState>}
 */
export async function loadRefs(repo, git, gitAt) {
  const [br, wt, st, rm, tag] = await Promise.all([
    git(["for-each-ref", "refs/heads", `--format=${BRANCH_FORMAT}`]),
    git(["worktree", "list", "--porcelain", "-z"]),
    git(["stash", "list", "--format=%gd%x1f%s%x1f%ct"]),
    git(["remote", "-v"]),
    git(["describe", "--tags", "--long"]),
  ]);
  const described = tag.code === 0 ? parseDescribe(tag.stdout) : null;
  const branches = br.code === 0 ? parseBranches(br.stdout) : [];
  // A bare repo's own entry is "checked out" nowhere: drop worktreepath that is the repo itself.
  for (const b of branches) if (b.worktree && samePath(b.worktree, repo.commonDir)) b.worktree = null;
  const worktrees = wt.code === 0 ? parseWorktrees(wt.stdout) : [];
  // Dirty counts for the other checkouts (a few, in parallel).
  await Promise.all(worktrees.filter((w) => !w.bare && !w.prunable && !samePath(w.path, repo.root)).slice(0, 8).map(async (w) => {
    try {
      const r = await gitAt(w.path, ["status", "--porcelain", "-z", "--untracked-files=no"]);
      if (r.code === 0) w.dirty = r.stdout.split("\0").filter(Boolean).length;
    } catch { /* unreachable folder: leave unknown */ }
  }));
  return {
    branches, worktrees,
    stashes: st.code === 0 ? parseStashes(st.stdout) : [],
    remotes: rm.code === 0 ? parseRemotes(rm.stdout) : {},
    tag: described?.tag ?? null,
    tagSince: described?.since ?? 0,
  };
}

/**
 * `git describe --tags --long` → the tag and how many commits HEAD is past it.
 * @param {string} text e.g. "v1.2-5-gabc1234" (tags may contain dashes)
 * @returns {{ tag: string, since: number } | null}
 */
export function parseDescribe(text) {
  const m = /^(.+)-(\d+)-g[0-9a-f]+$/.exec(text.trim());
  return m ? { tag: m[1], since: +m[2] } : null;
}

const RECENT_FORMAT = ["%h", "%an", "%ae", "%ct", "%s"].join("%x1f");

/** @param {string} text @returns {RecentCommit[]} */
export function parseRecent(text) {
  return lines(text).map((l) => {
    const [hash, author, email, at, subject] = l.split(US);
    return { hash, author: author ?? "", email: email ?? "", at: +at || 0, subject: subject ?? "", unpushed: false };
  }).filter((c) => c.hash);
}

/**
 * Commits per local calendar day for the last `days` days, oldest first (the last is today).
 * @param {number[]} times seconds since the epoch
 * @param {number} nowSec
 * @param {number} [days]
 * @returns {number[]}
 */
export function bucketDays(times, nowSec, days = 14) {
  const out = new Array(days).fill(0);
  const today = new Date(nowSec * 1000); today.setHours(0, 0, 0, 0);
  const start = today.getTime() / 1000;
  for (const t of times) {
    const back = t >= start ? 0 : Math.ceil((start - t) / 86400);
    if (back < days) out[days - 1 - back]++;
  }
  return out;
}

/**
 * What the sidebar shows beyond the status: recent and incoming commits, the
 * last two weeks' activity and the commit count. Every read falls back to empty.
 * @param {RunIn} git
 * @param {Status | null} status
 * @returns {Promise<Insight>}
 */
export async function loadInsight(git, status) {
  /** @param {string[]} args */
  const out = (args) => git(args).then((r) => (r.code === 0 ? r.stdout : ""), () => "");
  const [recent, incoming, times, total] = await Promise.all([
    out(["log", "-n", "6", `--format=${RECENT_FORMAT}`, "HEAD"]),
    status?.behind ? out(["log", "-n", "4", `--format=${RECENT_FORMAT}`, "HEAD..@{u}"]) : Promise.resolve(""),
    out(["log", "--since=14.days.ago", "--format=%ct", "HEAD"]),
    out(["rev-list", "--count", "HEAD"]),
  ]);
  const rec = parseRecent(recent);
  rec.forEach((c, i) => { c.unpushed = Boolean(status?.upstream) && i < (status?.ahead ?? 0); });
  return {
    recent: rec,
    incoming: parseRecent(incoming),
    activity: bucketDays(lines(times).map(Number).filter(Boolean), Date.now() / 1000),
    total: Number(total.trim()) || 0,
  };
}

/**
 * A rebase, merge, cherry-pick, revert or bisect in progress, from files in the git dir.
 * @param {Repo} repo
 * @param {ReadFile} read
 * @returns {Promise<Operation | null>}
 */
export async function loadOperation(repo, read) {
  /** @type {(name: string) => Promise<string | null>} */
  const at = (name) => Promise.resolve(read(join(repo.gitDir, name))).catch(/** @returns {null} */ () => null);
  const [rmHead, rmNum, rmEnd, rmOnto, raNext, raLast, raHead, merge, pick, revert, bisect] = await Promise.all([
    at("rebase-merge/head-name"), at("rebase-merge/msgnum"), at("rebase-merge/end"), at("rebase-merge/onto"),
    at("rebase-apply/next"), at("rebase-apply/last"), at("rebase-apply/head-name"),
    at("MERGE_HEAD"), at("CHERRY_PICK_HEAD"), at("REVERT_HEAD"), at("BISECT_LOG"),
  ]);
  /** @param {string | null} s */
  const num = (s) => (s && /\d/.test(s) ? +s.trim() : null);
  /** @param {string | null} s */
  const branch = (s) => (s ? s.trim().replace(/^refs\/heads\//, "") : null);
  if (rmHead != null || rmNum != null) return { op: "rebase", step: num(rmNum), total: num(rmEnd), branch: branch(rmHead), onto: rmOnto ? rmOnto.trim().slice(0, 7) : null };
  if (raNext != null) return { op: "rebase", step: num(raNext), total: num(raLast), branch: branch(raHead), onto: null };
  if (merge != null) return { op: "merge", step: null, total: null, branch: null, onto: merge.trim().slice(0, 7) };
  if (pick != null) return { op: "cherry-pick", step: null, total: null, branch: null, onto: pick.trim().slice(0, 7) };
  if (revert != null) return { op: "revert", step: null, total: null, branch: null, onto: revert.trim().slice(0, 7) };
  if (bisect != null) return { op: "bisect", step: null, total: null, branch: null, onto: null };
  return null;
}

/**
 * The commit list for the graph, newest first, with a pseudo-commit for uncommitted changes.
 * @param {Repo} repo
 * @param {RunIn} git
 * @param {{ all: boolean, oid: string | null, dirty: number, remotes: string[] }} opts
 * @returns {Promise<Commit[]>}
 */
export async function loadLog(repo, git, { all, oid, dirty, remotes }) {
  /** @type {Commit[]} */
  let commits = [];
  const wide = all || repo.kind === "bare";
  if (oid || wide) {
    const log = await git(["log", wide ? "--all" : "HEAD", "--topo-order", "-n", String(LIMIT),
      `--format=${RS}%H${US}%P${US}%an${US}%ae${US}%at${US}%D${US}%s`]);
    if (log.code === 0) commits = parseLog(log.stdout, remotes, oid);
  }
  if (dirty && oid && repo.root) commits.unshift({ hash: "wip", wip: true, parents: [oid], refs: [], subject: "Uncommitted changes", author: "", email: "", at: 0 });
  return commits;
}

/**
 * What a changed path means: "ignore", "status" (work tree) or "refs" (HEAD, refs, index, an operation).
 * @param {string} path
 * @param {Repo} repo
 * @returns {"ignore" | "status" | "refs"}
 */
export function classifyChange(path, repo) {
  const p = norm(path);
  if (p.endsWith(".lock")) return "ignore";
  for (const g of [repo.gitDir, repo.commonDir]) {
    const gg = norm(g);
    if (p === gg) return "refs"; // a root path: refresh everything
    if (p.startsWith(gg + "/")) {
      const rest = p.slice(gg.length + 1);
      if (/^(objects|logs|hooks|info|lfs)(\/|$)/.test(rest) || /^(FETCH_HEAD|COMMIT_EDITMSG|gc\.pid|AUTO_MERGE)$/.test(rest)) return "ignore";
      return "refs";
    }
  }
  if (repo.root && p === norm(repo.root)) return "refs";
  // A work tree's own .git dir (when gitDir is elsewhere this is a pointer file, rarely touched).
  if (/\/\.git(\/|$)/.test(p)) return base(p) === "index" ? "refs" : "ignore";
  return "status";
}
