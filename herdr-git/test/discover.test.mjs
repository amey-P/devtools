// node --test herdr-git/test   (dev-only; the installer doesn't copy test/)
// Pure checks of path handling, discovery and parsers. With HERDR_GIT_FIXTURES=<dir>
// (built by a fixture script) it also runs discovery against real repos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { norm, base, dir, join, samePath, within, resolve, repoName } from "../paths.js";
import { discover } from "../discover.js";
import { parseWorktrees, parseBranches, parseTrack, classifyChange, loadOperation } from "../load.js";

test("paths: windows and posix", () => {
  assert.equal(norm("C:\\Users\\a\\repo\\"), "C:/Users/a/repo");
  assert.equal(norm("C:\\"), "C:/");
  assert.equal(base("C:\\Users\\a\\repo"), "repo");
  assert.equal(dir("C:/repo"), "C:/");
  assert.equal(dir("/repo"), "/");
  assert.equal(join("C:/a", "b/", "c"), "C:/a/b/c");
  assert.ok(samePath("c:\\Users\\A", "C:/users/a"));
  assert.ok(!samePath("/Users/A", "/users/a"));
  assert.ok(within("C:/a/b", "c:/A"));
  assert.ok(!within("/ab", "/a"));
  assert.equal(resolve("../x/.git", "/r/.git/worktrees/x"), "/r/.git/worktrees/x/.git");
  assert.equal(resolve("D:/w/.git", "/r"), "D:/w/.git");
  assert.equal(repoName("/x/proj/.bare"), "proj");
  assert.equal(repoName("C:/x/thing.git"), "thing");
});

/** canned git: map "args joined" → stdout */
const canned = (table) => async (args) => {
  const k = args.filter((a) => a !== "--path-format=absolute").join(" ");
  const hit = Object.entries(table).find(([p]) => k.startsWith(p));
  return hit ? { code: 0, stdout: hit[1], stderr: "" } : { code: 128, stdout: "", stderr: "fatal" };
};
const noFile = async () => null;

test("discover: windows linked worktree", async () => {
  const git = canned({
    "rev-parse --is-bare": "false\ntrue\nfalse\nC:/src/app/.git/worktrees/feat\r\nC:/src/app/.git\r\n",
    "rev-parse --show-toplevel": "C:/src/feat\r\n",
  });
  const r = await discover("C:\\src\\feat", git, noFile);
  assert.deepEqual(r, { kind: "linked", root: "C:/src/feat", gitDir: "C:/src/app/.git/worktrees/feat", commonDir: "C:/src/app/.git", superproject: null, linked: true });
});

test("discover: bare and inside .git", async () => {
  const bare = await discover("/p", canned({ "rev-parse --is-bare": "true\nfalse\nfalse\n/p/.bare\n/p/.bare\n" }), noFile);
  assert.equal(bare.kind, "bare");
  assert.equal(bare.root, null);
  const calls = [];
  const git = async (args, cwd) => {
    calls.push(cwd);
    if (cwd === "/r/.git/refs") return { code: 0, stdout: "false\nfalse\ntrue\n/r/.git\n/r/.git\n", stderr: "" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: "/r\n", stderr: "" };
    return { code: 0, stdout: "false\ntrue\nfalse\n/r/.git\n/r/.git\n", stderr: "" };
  };
  const inside = await discover("/r/.git/refs", git, noFile);
  assert.equal(inside.kind, "main");
  assert.equal(inside.root, "/r");
});

test("discover: old git without --path-format", async () => {
  const git = async (args) => args.includes("--path-format=absolute")
    ? { code: 128, stdout: "", stderr: "unknown option --path-format" }
    : args.includes("--show-toplevel") ? { code: 0, stdout: "/r\n", stderr: "" }
    : { code: 0, stdout: "false\ntrue\nfalse\n/r/.git\n../.git\n", stderr: "" };
  const r = await discover("/r/sub", git, noFile);
  assert.equal(r.commonDir, "/r/.git");
  assert.equal(r.kind, "main");
});

test("parsers", () => {
  assert.deepEqual(parseTrack("ahead 2, behind 1"), { ahead: 2, behind: 1, gone: false });
  assert.deepEqual(parseTrack("gone"), { ahead: 0, behind: 0, gone: true });
  const wts = parseWorktrees("worktree /b.git\0bare\0\0worktree C:\\w\0HEAD abc\0branch refs/heads/feat\0locked\0\0");
  assert.equal(wts.length, 2);
  assert.ok(wts[0].bare);
  assert.equal(wts[1].path, "C:/w");
  assert.equal(wts[1].branch, "feat");
  assert.ok(wts[1].locked);
  const [b] = parseBranches("main\x1forigin/main\x1fbehind 3\x1f100\x1fabc\x1f/r\x1f*\x1fsubj\r\n");
  assert.equal(b.behind, 3);
  assert.ok(b.head);
  assert.equal(b.subject, "subj");
});

test("classifyChange", () => {
  const repo = { kind: "linked", root: "/w", gitDir: "/r/.git/worktrees/w", commonDir: "/r/.git", superproject: null, linked: true };
  assert.equal(classifyChange("/w/src/a.js", repo), "status");
  assert.equal(classifyChange("/r/.git/worktrees/w/HEAD", repo), "refs");
  assert.equal(classifyChange("/r/.git/refs/heads/w", repo), "refs");
  assert.equal(classifyChange("/r/.git/objects/ab/cd", repo), "ignore");
  assert.equal(classifyChange("/r/.git/index.lock", repo), "ignore");
});

test("loadOperation: rebase step", async () => {
  const files = { "/g/rebase-merge/head-name": "refs/heads/t\n", "/g/rebase-merge/msgnum": "2\n", "/g/rebase-merge/end": "3\n", "/g/rebase-merge/onto": "abcdef1234\n" };
  const op = await loadOperation({ gitDir: "/g" }, async (p) => files[p] ?? null);
  assert.deepEqual(op, { op: "rebase", step: 2, total: 3, branch: "t", onto: "abcdef1" });
});

const FX = process.env.HERDR_GIT_FIXTURES;
test("discover against fixture repos", { skip: !FX && "set HERDR_GIT_FIXTURES" }, async () => {
  const git = (args, cwd) => new Promise((res) => execFile("git", args, { cwd }, (e, stdout, stderr) => res({ code: e ? (e.code ?? 1) : 0, stdout, stderr })));
  const read = (p) => readFile(p, "utf8").catch(() => null);
  const kind = async (d) => (await discover(`${FX}/${d}`, git, read))?.kind ?? null;
  assert.equal(await kind("normal"), "main");
  assert.equal(await kind("normal/.git/refs"), "main");
  assert.equal(await kind("bare.git"), "bare");
  assert.equal(await kind("bare-wt"), "linked");
  assert.equal(await kind("proj"), "bare");
  assert.equal(await kind("proj/topic"), "linked");
  assert.equal(await kind("normal-linked"), "linked");
  assert.equal(await kind("super/sub"), "submodule");
  assert.equal(await kind("super/.git/modules/sub"), "submodule");
  assert.equal(await kind("."), null);
  const r = await discover(`${FX}/normal/.git/worktrees/normal-linked`, git, read);
  assert.equal(r?.kind, "linked");
});

test("tip: last commit subject and time", async () => {
  const { parseTip } = await import("../load.js");
  assert.deepEqual(parseTip("fix: the thing\x1f1700000000\n"), { subject: "fix: the thing", at: 1700000000 });
  assert.equal(parseTip(""), null);
});

test("pulse: what lights the strip up", async () => {
  const { substantial, snapshot } = await import("../pulse.js");
  const base = { gitDir: "/r/.git", branch: "main", oid: "a", op: null, conflicts: 0, dirty: 0, ahead: 0, behind: 0 };
  const at = (/** @type {object} */ o) => ({ ...base, ...o });
  assert.equal(substantial(base, base), null);
  assert.equal(substantial(base, at({ gitDir: "/s/.git" })), "switch");
  assert.equal(substantial(base, at({ branch: "dev" })), "switch");
  assert.equal(substantial(base, at({ op: "rebase" })), "alert");
  assert.equal(substantial(base, at({ conflicts: 1, dirty: 1 })), "alert");
  assert.equal(substantial(base, at({ oid: "b" })), "commit");
  assert.equal(substantial(base, at({ ahead: 1 })), "sync");
  assert.equal(substantial(base, at({ dirty: 1 })), "change");          // clean → dirty
  assert.equal(substantial(at({ dirty: 2 }), at({ dirty: 3 })), null);  // one more file saved
  assert.equal(substantial(at({ dirty: 2 }), at({ dirty: 7 })), "change");
  const s = snapshot({ repo: { gitDir: "/r/.git" }, head: { branch: "main", oid: "a" }, op: null,
    status: { conflicts: [], staged: [1], modified: [1, 2], untracked: [], ahead: 2, behind: 0 } });
  assert.equal(s.dirty, 3); assert.equal(s.ahead, 2);
});

test("sidebar extras: describe, recent, day buckets, remote names", async () => {
  const { parseDescribe, parseRecent, bucketDays } = await import("../load.js");
  const { shortRemote } = await import("../paths.js");
  assert.deepEqual(parseDescribe("v1.2-5-gabc1234\n"), { tag: "v1.2", since: 5 });
  assert.deepEqual(parseDescribe("release-2024-01-0-g0f0f0f0"), { tag: "release-2024-01", since: 0 });
  assert.equal(parseDescribe("fatal: no names found"), null);

  const rec = parseRecent("abc1234\x1fAda\x1fada@x\x1f1700000000\x1ffix: a thing\ndef5678\x1fBo\x1f\x1f0\x1f\n");
  assert.equal(rec.length, 2);
  assert.deepEqual(rec[0], { hash: "abc1234", author: "Ada", email: "ada@x", at: 1700000000, subject: "fix: a thing", unpushed: false });
  assert.equal(rec[1].subject, "");

  const noon = new Date(2026, 10, 14, 12).getTime() / 1000;
  const days = bucketDays([noon, noon - 3600, noon - 86400, noon - 13 * 86400, noon - 20 * 86400], noon, 14);
  assert.equal(days.length, 14);
  assert.equal(days[13], 2);
  assert.equal(days[12], 1);
  assert.equal(days[0], 1);
  assert.equal(days.reduce((a, b) => a + b, 0), 4);

  assert.equal(shortRemote("git@github.com:o/r.git"), "github.com/o/r");
  assert.equal(shortRemote("https://user@github.com/o/r/"), "github.com/o/r");
  assert.equal(shortRemote("ssh://git@host.xz:2222/o/r.git"), "host.xz/o/r");
  assert.equal(shortRemote("/srv/git/thing.git"), "thing");
  assert.equal(shortRemote("C:/repos/thing"), "thing");
});

test("changeTotals sums staged, modified and conflicted lines; untracked and binaries add nothing", async () => {
  const { changeTotals } = await import("../load.js");
  assert.deepEqual(changeTotals(null), { add: 0, del: 0 });
  const s = { branch: "main", oid: "a", upstream: null, ahead: 0, behind: 0,
    staged: [{ path: "a", code: "M", add: 3, del: 1 }],
    modified: [{ path: "b", code: "M", add: 2, del: 5 }, { path: "img", code: "M", binary: true }],
    untracked: [{ path: "c", code: "?" }],
    conflicts: [{ path: "d", code: "U", add: 1, del: 0 }] };
  assert.deepEqual(changeTotals(s), { add: 6, del: 6 });
});

test("compact keeps counts to four characters", async () => {
  const { compact } = await import("../ui.js");
  assert.equal(compact(0), "0");
  assert.equal(compact(999), "999");
  assert.equal(compact(1000), "1k");
  assert.equal(compact(1234), "1.2k");
  assert.equal(compact(1299), "1.2k");
  assert.equal(compact(12345), "12k");
  assert.equal(compact(999999), "999k");
  assert.equal(compact(2500000), "2.5m");
});

// ── Worktree overview ────────────────────────────────────────────────────

test("worktrees: .git file, left-right counts", async () => {
  const { parseGitFile, parseLeftRight } = await import("../load.js");
  assert.equal(parseGitFile("gitdir: /r/.git/worktrees/feat\n", "/w/feat"), "/r/.git/worktrees/feat");
  assert.equal(parseGitFile("gitdir: ../r/.git/worktrees/x\r\n", "/w/x"), "/w/r/.git/worktrees/x");
  assert.equal(parseGitFile("gitdir: C:\\r\\.git\\worktrees\\x", "C:/w/x"), "C:/r/.git/worktrees/x");
  assert.equal(parseGitFile(null, "/w"), null);
  assert.equal(parseGitFile("not a pointer", "/w"), null);
  assert.deepEqual(parseLeftRight("12\t3\n"), { behind: 12, ahead: 3 });
  assert.equal(parseLeftRight("fatal: bad revision"), null);
});

test("loadBase: config, then origin/HEAD, then main/master/trunk", async () => {
  const { loadBase } = await import("../load.js");
  const git = (table) => async (args) => {
    const hit = table[args.join(" ")];
    return hit != null ? { code: 0, stdout: hit, stderr: "" } : { code: 1, stdout: "", stderr: "" };
  };
  assert.equal(await loadBase(git({ "config --get herdr.base": "develop\n", "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n" })), "develop");
  assert.equal(await loadBase(git({ "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n" })), "origin/main");
  assert.equal(await loadBase(git({ "rev-parse --verify --quiet refs/heads/master": "abc\n" })), "master");
  assert.equal(await loadBase(git({})), null);
  assert.equal(await loadBase(async () => { throw new Error("offline"); }), null);
});

test("loadWorktreeSummary: status, lines, base delta, a rebase in that worktree", async () => {
  const { loadWorktreeSummary } = await import("../load.js");
  const repo = { kind: "main", root: "/r", gitDir: "/r/.git", commonDir: "/r/.git", superproject: null, linked: false };
  const status = "# branch.oid abc\0# branch.head feat\0# branch.upstream origin/feat\0# branch.ab +1 -0\0"
    + "1 .M N... 100644 100644 100644 a b src/a.js\0u UU N... 1 1 1 1 a b c src/b.js\0? new.txt\0";
  const out = { "status": status, "diff": "3\t1\tsrc/a.js\0" + "2\t0\tsrc/b.js\0", "rev-list": "4\t2\n", "log": "wip: thing\x1f1700000000\n" };
  const calls = [];
  const gitAt = async (path, args) => { calls.push(path); return { code: 0, stdout: out[args[0]] ?? "", stderr: "" }; };
  const files = { "/w/feat/.git": "gitdir: /r/.git/worktrees/feat\n", "/r/.git/worktrees/feat/rebase-merge/msgnum": "2\n", "/r/.git/worktrees/feat/rebase-merge/end": "5\n" };
  const read = async (p) => files[p] ?? null;
  const w = { path: "/w/feat", head: "abc", branch: "feat", bare: false, detached: false, locked: false, prunable: false, dirty: null };
  const s = await loadWorktreeSummary(w, repo, "main", gitAt, read);
  assert.ok(calls.every((p) => p === "/w/feat"));
  assert.equal(s.gitDir, "/r/.git/worktrees/feat");
  assert.equal(s.status.modified.length, 1);
  assert.equal(s.status.conflicts.length, 1);
  assert.equal(s.status.untracked.length, 1);
  assert.deepEqual([s.add, s.del], [5, 1]);
  assert.deepEqual(s.base, { ref: "main", behind: 4, ahead: 2 });
  assert.equal(s.tip.subject, "wip: thing");
  assert.equal(s.op?.op, "rebase");
  assert.equal(s.op?.step, 2);
  assert.equal(s.merged, false);

  // Clean, nothing the base lacks: merged. The main checkout's .git is a folder: the shared git dir.
  const clean = { "status": "# branch.oid abc\0# branch.head done\0", "diff": "", "rev-list": "7\t0\n", "log": "x\x1f1\n",
    "reflog": "merge done: Fast-forward\nbranch: Created from main\n" };
  const m = await loadWorktreeSummary({ ...w, path: "/w/done", branch: "done" }, repo, "main",
    async (_p, args) => ({ code: 0, stdout: clean[args[0]] ?? "", stderr: "" }), async () => { throw new Error("EISDIR"); });
  assert.equal(m.gitDir, "/r/.git");
  assert.ok(m.merged);
  assert.equal(m.fresh, false);
  // Same counts, but the branch was only ever created: an agent's new worktree, not a merged one.
  const fresh = await loadWorktreeSummary({ ...w, path: "/w/new", branch: "new" }, repo, "main",
    async (_p, args) => ({ code: 0, stdout: args[0] === "reflog" ? "branch: Created from main\n" : clean[args[0]] ?? "", stderr: "" }), async () => null);
  assert.equal(fresh.merged, false);
  assert.ok(fresh.fresh);
  // The base branch itself is never "merged".
  const b = await loadWorktreeSummary({ ...w, branch: "main" }, repo, "origin/main",
    async (_p, args) => ({ code: 0, stdout: clean[args[0]] ?? "", stderr: "" }), async () => null);
  assert.equal(b.merged, false);
  // Missing folders aren't read.
  const gone = await loadWorktreeSummary({ ...w, prunable: true }, repo, "main", async () => { throw new Error("no"); }, async () => null);
  assert.equal(gone.status, null);
});

test("pool runs everything, a few at a time", async () => {
  const { pool } = await import("../load.js");
  let live = 0, peak = 0;
  const done = [];
  await pool([1, 2, 3, 4, 5, 6, 7], async (n) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); done.push(n); live--; }, 3);
  assert.equal(done.length, 7);
  assert.ok(peak <= 3);
  await pool([], async () => { throw new Error("never"); });
});

test("agentsByWorktree: deepest worktree wins, other machines and plain shells don't count", async () => {
  const { agentsByWorktree } = await import("../worktrees.js");
  const spaces = [{ machine: null, tabs: [{ id: "t1" }] }, { machine: "box", tabs: [{ id: "t2" }] }];
  const agent = { agent: true };
  const panes = [
    { pane: "a", terminal: "1", tab: "t1", cwd: "/r/src", status: "working", program: agent },
    { pane: "b", terminal: "2", tab: "t1", cwd: "/r/.worktrees/feat/lib", status: "blocked", program: agent },
    { pane: "c", terminal: "3", tab: "t2", cwd: "/r/src", status: "working", program: agent },
    { pane: "d", terminal: "4", tab: "t1", cwd: "/r", status: null, program: { agent: false } },
    { pane: "e", terminal: "5", tab: "t1", cwd: "/elsewhere", status: "idle", program: agent },
    { pane: "f", terminal: null, tab: "t1", cwd: null, status: null, program: agent, mod: "git" },
  ];
  const m = agentsByWorktree(["/r", "/r/.worktrees/feat"], panes, spaces, null);
  assert.deepEqual(m.get("/r").map((p) => p.pane), ["a"]);
  assert.deepEqual(m.get("/r/.worktrees/feat").map((p) => p.pane), ["b"]);
  const remote = agentsByWorktree(["/r"], panes, spaces, "box");
  assert.deepEqual(remote.get("/r").map((p) => p.pane), ["c"]);
});

test("attention and order: conflicts, blocked, done, dirty, ahead, clean, merged", async () => {
  const { attention, sortWorktrees, totals } = await import("../worktrees.js");
  const st = (o = {}) => ({ branch: "x", oid: "a", upstream: null, ahead: 0, behind: 0, staged: [], modified: [], untracked: [], conflicts: [], ...o });
  const wt = (path, o = {}) => ({ path, head: "a", branch: path, bare: false, detached: false, locked: false, prunable: false, dirty: null,
    gitDir: null, status: st(), add: 0, del: 0, base: { ref: "main", ahead: 0, behind: 0 }, merged: false, fresh: false, tip: { subject: "", at: 0 }, op: null, error: null, ...o });
  const list = [
    wt("merged", { merged: true }),
    wt("clean"),
    wt("ahead", { base: { ref: "main", ahead: 2, behind: 0 } }),
    wt("dirty", { status: st({ modified: [{ path: "a", code: "M" }] }) }),
    wt("done"),
    wt("blocked"),
    wt("rebasing", { op: { op: "rebase", step: 1, total: 2, branch: null, onto: null } }),
    wt("gone", { prunable: true }),
  ];
  const agents = new Map([["done", [{ status: "done" }]], ["blocked", [{ status: "blocked" }, { status: "working" }]]]);
  assert.equal(attention(list[6], []), 0);
  assert.equal(attention(list[5], agents.get("blocked")), 1);
  const order = sortWorktrees(list, agents, null).map((w) => w.path);
  assert.deepEqual(order.slice(0, 6), ["rebasing", "blocked", "done", "dirty", "ahead", "clean"]);
  assert.deepEqual(order.slice(6).sort(), ["gone", "merged"]);
  // The checkout you're in comes first whatever its state.
  assert.equal(sortWorktrees(list, agents, "merged")[0].path, "merged");
  assert.deepEqual(totals(list, agents), { count: 8, dirty: 1, conflicted: 1, blocked: 1, working: 1 });
  // Sidebar rows carry a dirty count instead of a status.
  assert.equal(totals([{ path: "a", dirty: 3, prunable: false }, { path: "b", dirty: 0, prunable: false }], new Map()).dirty, 1);
});
