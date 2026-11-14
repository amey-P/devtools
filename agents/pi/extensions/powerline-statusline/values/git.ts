/**
 * Git status value service: reads dirty-state counts for the session cwd,
 * throttled to at most one `git status` per window and never more than one
 * process at a time. Knows nothing about rendering — consumers read `value`
 * and get repaint notifications via the onChange callback.
 *
 * Correctness notes (validated against porcelain v1 semantics):
 * - `--no-optional-locks` keeps the poller from refreshing/locking the index
 *   (avoids index.lock contention with editors and other sessions).
 * - Unmerged entries (AA/DD/UU/AU/UA/UD/DU) go to their own `conflicts`
 *   bucket — porcelain sets both X and Y for them, which would otherwise
 *   inflate both the staged and unstaged counters.
 * - Filenames are never parsed, so quoted entries (e.g. names with newlines,
 *   which porcelain C-quotes onto one physical line) cannot corrupt counts —
 *   no `-z` needed.
 * - A failed read (timeout, output over maxBuffer, git crash) is reported as
 *   `GIT_UNKNOWN`, never as "no changes": a huge repo must not show a clean
 *   pill just because `git status` could not finish.
 */

import { execFile } from "node:child_process";

export interface GitCounts {
	staged: number;
	unstaged: number;
	conflicts: number;
	untracked: number;
}

/** Sentinel for "inside a repo, but the status read failed". */
export const GIT_UNKNOWN = "unknown";

/**
 * What the watcher knows: counts, `GIT_UNKNOWN` after a failed read, or
 * `undefined` when there is nothing to show (not a repo, not read yet).
 */
export type GitValue = GitCounts | typeof GIT_UNKNOWN | undefined;

/** Reads the git state of a directory (injectable for tests). */
export type GitReader = (cwd: string) => Promise<GitValue>;

/** Minimal execFile surface used by readGitCounts (injectable for tests). */
export type ExecFileLike = (
	file: string,
	args: string[],
	options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
	callback: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

/** Window for coalescing refresh requests into one read. */
const THROTTLE_MS = 250;
/** Kill `git status` after this long; the pill then shows unknown. */
const GIT_TIMEOUT_MS = 5000;
/** Porcelain output limit (default 1 MB overflows on big untracked trees). */
const GIT_MAX_BUFFER = 16 << 20;

/** Fold `git status --porcelain` (v1) output into per-state counts. */
export function parsePorcelain(stdout: string): GitCounts {
	let staged = 0;
	let unstaged = 0;
	let conflicts = 0;
	let untracked = 0;
	for (const line of stdout.split("\n")) {
		if (!line) continue;
		const x = line[0];
		const y = line[1];
		if (x === "?" && y === "?") {
			untracked += 1;
			continue;
		}
		if (x === "U" || y === "U" || ((x === "A" || x === "D") && (y === "A" || y === "D"))) {
			conflicts += 1;
			continue;
		}
		if (x && x !== " " && x !== "?") staged += 1;
		if (y && y !== " ") unstaged += 1;
	}
	return { staged, unstaged, conflicts, untracked };
}

/**
 * Map a failed `git status` to a value: "not a git repository" means there is
 * nothing to show; anything else (timeout, maxBuffer overflow, missing git,
 * corrupt repo) is an unknown state that must not render as clean.
 */
export function classifyGitError(stderr: string): GitValue {
	return /not a git repository/i.test(stderr) ? undefined : GIT_UNKNOWN;
}

/** Run `git status --porcelain` in cwd and fold it into a GitValue. */
export function readGitCounts(cwd: string, exec: ExecFileLike = execFile as unknown as ExecFileLike): Promise<GitValue> {
	return new Promise((resolve) => {
		exec(
			"git",
			["--no-optional-locks", "status", "--porcelain"],
			// LC_ALL=C: classifyGitError matches git's English message; a
			// localized "not a git repository" would show as unknown.
			{ cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, LC_ALL: "C" } },
			(err, stdout, stderr) => {
				resolve(err ? classifyGitError(String(stderr ?? "")) : parsePorcelain(String(stdout)));
			},
		);
	});
}

function sameValue(a: GitValue, b: GitValue): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object") return false;
	return (
		a.staged === b.staged &&
		a.unstaged === b.unstaged &&
		a.conflicts === b.conflicts &&
		a.untracked === b.untracked
	);
}

export interface GitWatcherOptions {
	read?: GitReader;
	throttleMs?: number;
}

/**
 * Throttled git poller.
 *
 * - Throttle, not debounce: the first schedule() opens a fixed window and the
 *   read fires when it closes; schedules inside the window only update the
 *   cwd. A trailing debounce would keep postponing the read under a steady
 *   stream of events, so the pill could go stale indefinitely; the throttle
 *   guarantees a refresh within one window.
 * - In-flight guard: at most one git process at a time. A read requested while
 *   one is running sets a rerun flag, and exactly one more read runs after the
 *   current one finishes (with the latest cwd).
 * - A result read for a cwd that has since changed is dropped (the rerun
 *   covers the new cwd).
 */
export class GitWatcher {
	private state: GitValue;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private cwd: string | undefined;
	private inFlight = false;
	private rerun = false;
	private disposed = false;
	private readonly read: GitReader;
	private readonly throttleMs: number;

	constructor(
		private readonly onChange: () => void,
		options: GitWatcherOptions = {},
	) {
		this.read = options.read ?? ((cwd) => readGitCounts(cwd));
		this.throttleMs = options.throttleMs ?? THROTTLE_MS;
	}

	get value(): GitValue {
		return this.state;
	}

	/**
	 * Request a read of the given directory. Cached counts stay visible until
	 * the new result lands (no clean flicker in between).
	 */
	schedule(cwd: string): void {
		if (this.disposed) return;
		this.cwd = cwd; // a pending timer reads this at fire time
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.refresh();
		}, this.throttleMs);
	}

	dispose(): void {
		this.disposed = true;
		this.rerun = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	private async refresh(): Promise<void> {
		if (this.disposed) return;
		if (this.inFlight) {
			this.rerun = true;
			return;
		}
		const cwd = this.cwd;
		if (!cwd) return;
		this.inFlight = true;
		let next: GitValue;
		try {
			next = await this.read(cwd);
		} catch {
			next = GIT_UNKNOWN;
		} finally {
			this.inFlight = false;
		}
		if (this.disposed) return;
		if (cwd === this.cwd && !sameValue(next, this.state)) {
			this.state = next;
			this.onChange();
		}
		if (this.rerun) {
			this.rerun = false;
			void this.refresh();
		}
	}
}
