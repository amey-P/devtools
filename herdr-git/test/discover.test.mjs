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
