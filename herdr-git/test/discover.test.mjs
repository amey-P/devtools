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
