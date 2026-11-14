import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ColorMode } from "./pills";
import { makeStyle } from "./pills";
import { type RowDeps, renderRow } from "./render";
import { GIT_UNKNOWN, type GitValue } from "./values/git";
import type { ModeState } from "./values/mode";
import type { TokpsSnapshot } from "./values/tokps";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

interface Fake {
	cwd?: string;
	idle?: boolean;
	usage?: { tokens: number | null; contextWindow: number; percent: number | null };
	model?: { name?: string; id: string };
	statuses?: Record<string, string>;
	branch?: string | null;
	git?: GitValue;
	tokps?: Partial<TokpsSnapshot>;
	colorMode?: ColorMode;
	modeState?: ModeState | null;
}

function deps(f: Fake = {}): RowDeps {
	return {
		ctx: {
			cwd: f.cwd ?? "/tmp/proj",
			isIdle: () => f.idle ?? true,
			getContextUsage: () => f.usage,
			model: f.model,
		},
		theme: { getColorMode: () => f.colorMode ?? "truecolor" },
		footerData: {
			getExtensionStatuses: () => new Map(Object.entries(f.statuses ?? {})),
			getGitBranch: () => f.branch ?? null,
		},
		git: { value: f.git },
		tokps: { snapshot: () => ({ live: 0, last: 0, started: false, ...f.tokps }) },
		modeFeed: f.modeState === undefined ? undefined : { state: f.modeState },
	} as unknown as RowDeps;
}

const WIDTH = 200;
const text = (f: Fake = {}, width = WIDTH) => stripAnsi(renderRow(deps(f), width));
const bg = (color: Parameters<typeof makeStyle>[1]) => makeStyle("truecolor", color).bg;

describe("renderRow", () => {
	test("minimal row shows only the folder pill", () => {
		const row = renderRow(deps(), WIDTH);
		assert.ok(stripAnsi(row).includes(" proj"));
		assert.ok(row.includes(bg("folder")));
		assert.ok(!stripAnsi(row).includes("tok/s"));
		assert.equal(visibleWidth(row), WIDTH);
	});

	test("mode pill renders leftmost with emoji, uppercase name and mode color", () => {
		const row = renderRow(deps({ statuses: { "mode-manager": "\x1b[35mⓂ plan\x1b[39m" } }), WIDTH);
		const plain = stripAnsi(row);
		assert.ok(plain.includes("\u{1F4CB} PLAN"));
		assert.ok(plain.indexOf("PLAN") < plain.indexOf("proj"));
		assert.ok(row.includes(bg("modePlan")));
	});

	test("custom modes get the gear emoji and slate color", () => {
		const row = renderRow(deps({ statuses: { "mode-manager": "Ⓜ review" } }), WIDTH);
		assert.ok(stripAnsi(row).includes("\u{2699}\u{FE0F} REVIEW"));
		assert.ok(row.includes(bg("modeOther")));
	});

	test("clean git pill shows branch in green", () => {
		const row = renderRow(
			deps({ branch: "main", git: { staged: 0, unstaged: 0, conflicts: 0, untracked: 0 } }),
			WIDTH,
		);
		assert.ok(stripAnsi(row).includes(" main "));
		assert.ok(row.includes(bg("gitClean")));
		assert.ok(!row.includes(bg("gitDirty")));
	});

	test("dirty git pill lists non-zero counts conflict-first in amber", () => {
		const row = renderRow(
			deps({ branch: "feat", git: { staged: 2, unstaged: 1, conflicts: 4, untracked: 3 } }),
			WIDTH,
		);
		assert.ok(stripAnsi(row).includes(" feat ~4 +2 !1 ?3"));
		assert.ok(row.includes(bg("gitDirty")));
	});

	test("failed git read shows an unknown pill, never clean", () => {
		const row = renderRow(deps({ branch: "main", git: GIT_UNKNOWN }), WIDTH);
		assert.ok(stripAnsi(row).includes("\uE0A0 main \uF071"));
		assert.ok(row.includes(bg("gitUnknown")));
		assert.ok(!row.includes(bg("gitClean")));
		assert.ok(!row.includes(bg("gitDirty")));
	});

	test("unknown git state without a branch still shows the marker", () => {
		const row = renderRow(deps({ git: GIT_UNKNOWN }), WIDTH);
		assert.ok(stripAnsi(row).includes("\uE0A0 \uF071"));
		assert.ok(row.includes(bg("gitUnknown")));
	});

	test("zero counts are omitted", () => {
		const plain = text({ branch: "main", git: { staged: 0, unstaged: 5, conflicts: 0, untracked: 0 } });
		assert.ok(plain.includes(" main !5 "));
		assert.ok(!/[~+?]\d/.test(plain));
	});

	test("idle shows the last settled rate", () => {
		const row = renderRow(deps({ tokps: { last: 12.34 } }), WIDTH);
		assert.ok(stripAnsi(row).includes(" 12.3 tok/s"));
		assert.ok(row.includes(bg("rateIdle")));
	});

	test("streaming shows the live rate", () => {
		const row = renderRow(deps({ idle: false, tokps: { live: 40, last: 12, started: true } }), WIDTH);
		assert.ok(stripAnsi(row).includes("40.0 tok/s"));
		assert.ok(row.includes(bg("rateLive")));
	});

	test("busy between messages (tool run, TTFB) shows the settled rate", () => {
		const row = renderRow(deps({ idle: false, tokps: { live: 0, last: 12, started: false } }), WIDTH);
		assert.ok(stripAnsi(row).includes(" 12.0 tok/s"));
		assert.ok(row.includes(bg("rateIdle")));
	});

	test("a new message's pending state hides the previous settled rate", () => {
		assert.ok(text({ idle: false, tokps: { started: true, last: 12 } }).includes(" … tok/s"));
	});

	test("streaming before measurable growth shows the pending state", () => {
		assert.ok(text({ idle: false, tokps: { started: true } }).includes(" … tok/s"));
		assert.ok(!text({ idle: false, tokps: { started: false } }).includes("tok/s"));
	});

	test("context pill colors by usage threshold", () => {
		const cases: Array<[number, Parameters<typeof makeStyle>[1]]> = [
			[10, "usageOk"],
			[70, "usageWarn"],
			[90, "usageError"],
		];
		for (const [percent, color] of cases) {
			const row = renderRow(deps({ usage: { tokens: 45_000, contextWindow: 200_000, percent } }), WIDTH);
			assert.ok(stripAnsi(row).includes(` 45k/200k · ${percent}%`), `percent ${percent}`);
			assert.ok(row.includes(bg(color)), `percent ${percent} → ${color}`);
		}
	});

	test("unknown context usage renders question marks", () => {
		const row = renderRow(deps({ usage: { tokens: null, contextWindow: 200_000, percent: null } }), WIDTH);
		assert.ok(stripAnsi(row).includes("?/200k · ?"));
		assert.ok(row.includes(bg("usageUnknown")));
	});

	test("no context pill when the window is unknown", () => {
		assert.ok(!text({ usage: { tokens: 1, contextWindow: 0, percent: 0 } }).includes(""));
	});

	test("model pill prefers the display name and sits at the far right", () => {
		const plain = text({ model: { name: "Claude Opus", id: "anthropic/claude-opus" } }).trimEnd();
		assert.ok(plain.endsWith(" Claude Opus "));
	});

	test("model id falls back to its basename with the date suffix stripped", () => {
		assert.ok(text({ model: { id: "anthropic/claude-sonnet-4-5-20250929" } }).includes(" claude-sonnet-4-5 "));
	});

	test("date suffix before a :thinking suffix keeps the model name intact", () => {
		const plain = text({ model: { id: "anthropic/claude-sonnet-4-5-20250929:thinking" } });
		assert.ok(plain.includes(" claude-sonnet-4-5 "));
		assert.ok(!plain.includes("thinking"));
	});

	test("model id drops a :thinking suffix", () => {
		assert.ok(text({ model: { id: "openai/gpt-5:high" } }).includes(" gpt-5 "));
	});

	test("long model names are truncated to 24 columns", () => {
		const plain = text({ model: { name: "a-very-long-model-display-name-x", id: "x" } });
		assert.ok(plain.includes(` ${"a-very-long-model-displ"}… `));
	});

	test("256-color themes use xterm palette sequences", () => {
		const row = renderRow(deps({ colorMode: "256color" }), WIDTH);
		assert.ok(row.includes(makeStyle("256color", "folder").bg));
		assert.ok(!row.includes("\x1b[48;2;"));
	});

	test("never exceeds the requested width", () => {
		const f: Fake = {
			statuses: { "mode-manager": "Ⓜ careful" },
			branch: "some-long-feature-branch",
			git: { staged: 1, unstaged: 2, conflicts: 0, untracked: 3 },
			tokps: { last: 33 },
			usage: { tokens: 150_000, contextWindow: 200_000, percent: 75 },
			model: { id: "anthropic/claude-sonnet-4-5" },
		};
		for (const width of [1, 10, 20, 40, 60, 80, 120]) {
			assert.ok(visibleWidth(renderRow(deps(f), width)) <= width, `width ${width}`);
		}
	});

	test("mode-manager:changed state wins over the status text", () => {
		const plain = text({ statuses: { "mode-manager": "Ⓜ yolo" }, modeState: { mode: "careful", plannotator: false } });
		assert.ok(plain.includes("CAREFUL"));
		assert.ok(!plain.includes("YOLO"));
		assert.ok(text({ statuses: { "mode-manager": "Ⓜ yolo" }, modeState: null }).includes("YOLO"), "fallback");
	});

	test("plannotator phase is a compact suffix on the mode pill", () => {
		const executing = text({
			modeState: { mode: "plan", plannotator: true },
			statuses: { plannotator: "\x1b[36m📋 3/5\x1b[39m" },
		});
		assert.ok(executing.includes("\u{1F4CB} PLAN·exec 3/5 "));
		assert.ok(!executing.includes("📋 3/5"), "plannotator's own status is not repeated");

		const planning = text({ modeState: { mode: "plan", plannotator: true }, statuses: { plannotator: "⏸ plan" } });
		assert.ok(planning.includes("\u{1F4CB} PLAN "));
		assert.ok(!planning.includes("·"));

		const mismatch = text({ statuses: { "mode-manager": "Ⓜ yolo", plannotator: "⏸ plan" } });
		assert.ok(mismatch.includes("YOLO·plan "));
	});

	describe("other extensions' statuses", () => {
		const statuses = { "mode-manager": "Ⓜ yolo", plannotator: "⏸ plan", lsp: "\x1b[32mLSP ok\x1b[39m", mcp: "MCP 3" };

		test("share one pill in the center, excluding mode-manager and plannotator", () => {
			const row = renderRow(deps({ statuses, tokps: { last: 10 } }), WIDTH);
			const plain = stripAnsi(row);
			assert.ok(plain.includes(" LSP ok · MCP 3 "));
			assert.ok(row.includes(bg("extStatus")));
			assert.ok(plain.indexOf("tok/s") < plain.indexOf("LSP ok"));
			assert.equal(plain.match(/plan/g)?.length, 1, "plannotator only on the mode pill");
		});

		test("absent when no other extension publishes a status", () => {
			const row = renderRow(deps({ statuses: { "mode-manager": "Ⓜ yolo", plannotator: "⏸ plan" } }), WIDTH);
			assert.ok(!row.includes(bg("extStatus")));
		});

		test("truncated to the space left between the zones, dropped when too narrow", () => {
			const long = { ...statuses, zz: "a status that is far too long to fit in a narrow footer row at all" };
			const f: Fake = {
				statuses: long,
				branch: "main",
				usage: { tokens: 45_000, contextWindow: 200_000, percent: 10 },
				model: { id: "anthropic/claude-sonnet-4-5" },
			};
			const wide = stripAnsi(renderRow(deps(f), 200));
			assert.ok(wide.includes("LSP ok · MCP 3 · a status"));
			assert.ok(wide.includes("…"), "capped at the slot maximum");

			let sawTruncated = false;
			let sawDropped = false;
			for (let width = 70; width <= 140; width++) {
				const row = renderRow(deps(f), width);
				assert.equal(visibleWidth(row), width, `width ${width}`);
				const plain = stripAnsi(row);
				assert.ok(plain.includes("claude-sonnet-4-5"), `right zone stays at width ${width}`);
				if (!row.includes(bg("extStatus"))) sawDropped = true;
				else if (plain.includes("…")) sawTruncated = true;
			}
			assert.ok(sawTruncated && sawDropped);
		});
	});
});
