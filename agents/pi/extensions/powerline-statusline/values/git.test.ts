import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	classifyGitError,
	type ExecFileLike,
	GIT_UNKNOWN,
	type GitCounts,
	type GitValue,
	GitWatcher,
	parsePorcelain,
	readGitCounts,
} from "./git";

const counts = (c: Partial<GitCounts> = {}): GitCounts => ({
	staged: 0,
	unstaged: 0,
	conflicts: 0,
	untracked: 0,
	...c,
});

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** A reader whose calls stay pending until the test resolves them. */
function controlledReader() {
	const calls: { cwd: string; resolve: (v: GitValue) => void }[] = [];
	let active = 0;
	let maxActive = 0;
	const read = (cwd: string) =>
		new Promise<GitValue>((resolve) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			calls.push({
				cwd,
				resolve: (v) => {
					active -= 1;
					resolve(v);
				},
			});
		});
	return { read, calls, maxActive: () => maxActive };
}

describe("parsePorcelain", () => {
	test("empty output is clean", () => {
		assert.deepEqual(parsePorcelain(""), counts());
	});

	test("buckets staged, unstaged, untracked and conflicts", () => {
		const out = ["M  a", " M b", "MM c", "?? d", "A  e", "UU f", "AA g", "DD h", "R  i -> j", ""].join("\n");
		assert.deepEqual(parsePorcelain(out), counts({ staged: 4, unstaged: 2, conflicts: 3, untracked: 1 }));
	});
});

describe("classifyGitError", () => {
	test("not a repository means nothing to show", () => {
		assert.equal(classifyGitError("fatal: not a git repository (or any of the parent directories): .git\n"), undefined);
	});

	test("any other failure is unknown, not clean", () => {
		assert.equal(classifyGitError(""), GIT_UNKNOWN);
		assert.equal(classifyGitError("fatal: index file corrupt"), GIT_UNKNOWN);
	});
});

describe("readGitCounts", () => {
	test("passes a timeout, a large maxBuffer and the C locale", async () => {
		let seen: Parameters<ExecFileLike>[2] | undefined;
		const exec: ExecFileLike = (_f, _a, opts, cb) => {
			seen = opts;
			cb(null, "?? x\n", "");
		};
		assert.deepEqual(await readGitCounts("/repo", exec), counts({ untracked: 1 }));
		assert.equal(seen?.timeout, 5000);
		assert.equal(seen?.maxBuffer, 16 << 20);
		assert.equal(seen?.env.LC_ALL, "C", "classifyGitError matches git's English messages");
		assert.equal(seen?.env.PATH, process.env.PATH, "the rest of the environment is kept");
	});

	test("maxBuffer overflow or timeout yields unknown", async () => {
		const exec: ExecFileLike = (_f, _a, _o, cb) => cb(new Error("stdout maxBuffer length exceeded"), "?? x\n", "");
		assert.equal(await readGitCounts("/repo", exec), GIT_UNKNOWN);
	});

	test("outside a repo yields undefined", async () => {
		const exec: ExecFileLike = (_f, _a, _o, cb) => cb(new Error("exit 128"), "", "fatal: not a git repository");
		assert.equal(await readGitCounts("/tmp", exec), undefined);
	});
});

describe("GitWatcher", () => {
	test("coalesces schedules inside the throttle window into one read", async () => {
		const r = controlledReader();
		const w = new GitWatcher(() => {}, { read: r.read, throttleMs: 0 });
		w.schedule("/a");
		w.schedule("/a");
		w.schedule("/b");
		await tick();
		assert.equal(r.calls.length, 1);
		assert.equal(r.calls[0].cwd, "/b");
		w.dispose();
	});

	test("never overlaps reads; a request during a read runs once more after", async () => {
		const r = controlledReader();
		let changes = 0;
		const w = new GitWatcher(() => changes++, { read: r.read, throttleMs: 0 });
		w.schedule("/a");
		await tick();
		assert.equal(r.calls.length, 1);

		// Two more requests while the first read is in flight.
		w.schedule("/a");
		await tick();
		w.schedule("/a");
		await tick();
		assert.equal(r.calls.length, 1, "no second process while one is running");

		r.calls[0].resolve(counts({ unstaged: 1 }));
		await tick();
		assert.equal(r.calls.length, 2, "exactly one follow-up read");
		assert.equal(r.maxActive(), 1);
		assert.deepEqual(w.value, counts({ unstaged: 1 }));

		r.calls[1].resolve(counts({ unstaged: 2 }));
		await tick();
		assert.equal(r.calls.length, 2);
		assert.deepEqual(w.value, counts({ unstaged: 2 }));
		assert.equal(changes, 2);
		w.dispose();
	});

	test("rescheduling keeps the cached counts until the new read lands", async () => {
		const r = controlledReader();
		const w = new GitWatcher(() => {}, { read: r.read, throttleMs: 0 });
		w.schedule("/a");
		await tick();
		r.calls[0].resolve(counts({ staged: 3 }));
		await tick();
		w.schedule("/a");
		await tick();
		assert.deepEqual(w.value, counts({ staged: 3 }));
		r.calls[1].resolve(counts());
		await tick();
		assert.deepEqual(w.value, counts());
		w.dispose();
	});

	test("a failed read becomes unknown, and a throwing reader too", async () => {
		const w = new GitWatcher(() => {}, { read: async () => GIT_UNKNOWN, throttleMs: 0 });
		w.schedule("/a");
		await tick();
		assert.equal(w.value, GIT_UNKNOWN);
		w.dispose();

		const t = new GitWatcher(() => {}, {
			read: async () => {
				throw new Error("boom");
			},
			throttleMs: 0,
		});
		t.schedule("/a");
		await tick();
		assert.equal(t.value, GIT_UNKNOWN);
		t.dispose();
	});

	test("identical results do not trigger a repaint", async () => {
		let changes = 0;
		const w = new GitWatcher(() => changes++, { read: async () => counts({ untracked: 1 }), throttleMs: 0 });
		w.schedule("/a");
		await tick();
		w.schedule("/a");
		await tick();
		assert.equal(changes, 1);
		w.dispose();
	});

	test("a result for a stale cwd is dropped and the new cwd is read", async () => {
		const r = controlledReader();
		const w = new GitWatcher(() => {}, { read: r.read, throttleMs: 0 });
		w.schedule("/old");
		await tick();
		w.schedule("/new");
		await tick();
		r.calls[0].resolve(counts({ staged: 9 }));
		await tick();
		assert.equal(w.value, undefined);
		assert.equal(r.calls[1].cwd, "/new");
		r.calls[1].resolve(counts({ untracked: 1 }));
		await tick();
		assert.deepEqual(w.value, counts({ untracked: 1 }));
		w.dispose();
	});

	test("dispose drops in-flight results and pending timers", async () => {
		const r = controlledReader();
		let changes = 0;
		const w = new GitWatcher(() => changes++, { read: r.read, throttleMs: 0 });
		w.schedule("/a");
		await tick();
		w.dispose();
		r.calls[0].resolve(counts({ staged: 1 }));
		w.schedule("/a");
		await tick();
		assert.equal(changes, 0);
		assert.equal(r.calls.length, 1);
	});
});
