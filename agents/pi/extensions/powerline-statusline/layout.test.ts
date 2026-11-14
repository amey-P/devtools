import assert from "node:assert/strict";
import { homedir } from "node:os";
import { describe, test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { abbrevHome, fmtTokens, layoutRow } from "./layout";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("abbrevHome", () => {
	const home = homedir();

	test("home itself becomes ~", () => {
		assert.equal(abbrevHome(home), "~");
	});

	test("paths under home are abbreviated", () => {
		assert.equal(abbrevHome(`${home}/code/pi`), "~/code/pi");
	});

	test("paths outside home are unchanged", () => {
		assert.equal(abbrevHome("/tmp/project"), "/tmp/project");
	});

	test("a sibling sharing the home prefix is not abbreviated", () => {
		assert.equal(abbrevHome(`${home}-other/x`), `${home}-other/x`);
	});
});

describe("fmtTokens", () => {
	const cases: Array<[number, string]> = [
		[0, "0"],
		[950, "950"],
		[999, "999"],
		[1_000, "1.0k"],
		[1_234, "1.2k"],
		[45_000, "45k"],
		[123_456, "123k"],
		[1_300_000, "1.3M"],
		[45_000_000, "45M"],
	];
	for (const [n, expected] of cases) {
		test(`${n} → ${expected}`, () => {
			assert.equal(fmtTokens(n), expected);
		});
	}
});

describe("layoutRow", () => {
	test("non-positive width yields empty string", () => {
		assert.equal(layoutRow("L", "C", "R", 0), "");
		assert.equal(layoutRow("L", "C", "R", -5), "");
	});

	test("centers the middle zone when everything fits", () => {
		const row = layoutRow("L", "C", "R", 11);
		assert.equal(row, "L    C    R");
		assert.equal(visibleWidth(row), 11);
	});

	test("odd gaps put the extra space right of center", () => {
		assert.equal(layoutRow("L", "C", "R", 8), "L  C   R");
	});

	test("drops the center zone when it does not fit", () => {
		const row = layoutRow("LL", "CCCC", "RR", 7);
		assert.equal(row, "LL   RR");
	});

	test("shrinks left and keeps right anchored when left+right overflow", () => {
		const row = layoutRow("LEFTLEFT", "C", "RR", 6);
		assert.equal(stripAnsi(row), "LE… RR");
		assert.equal(visibleWidth(row), 6);
	});

	test("result never exceeds width", () => {
		for (let width = 1; width <= 30; width++) {
			const row = layoutRow("left-zone-text", "center", "right-zone", width);
			assert.ok(visibleWidth(row) <= width, `width ${width}: got ${visibleWidth(row)}`);
		}
	});
});
