import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { makeStyle, type Pill, pillChain } from "./pills";

const RESET = "\x1b[0m";
const RESET_BG = "\x1b[49m";
const ROUND_LEFT = "";
const ROUND_RIGHT = "";

describe("makeStyle", () => {
	test("truecolor: dark background gets white text, cap matches bg", () => {
		assert.deepEqual(makeStyle("truecolor", "folder"), {
			bg: "\x1b[48;2;0;95;135m",
			fg: "\x1b[38;2;255;255;255m",
			cap: "\x1b[38;2;0;95;135m",
		});
	});

	test("truecolor: light background gets near-black text", () => {
		assert.deepEqual(makeStyle("truecolor", "gitClean"), {
			bg: "\x1b[48;2;95;175;0m",
			fg: "\x1b[38;2;28;28;28m",
			cap: "\x1b[38;2;95;175;0m",
		});
	});

	test("256color: uses xterm indices for bg, text and cap", () => {
		assert.deepEqual(makeStyle("256color", "folder"), {
			bg: "\x1b[48;5;24m",
			fg: "\x1b[38;5;231m",
			cap: "\x1b[38;5;24m",
		});
		assert.deepEqual(makeStyle("256color", "gitDirty"), {
			bg: "\x1b[48;5;172m",
			fg: "\x1b[38;5;234m",
			cap: "\x1b[38;5;172m",
		});
	});
});

describe("pillChain", () => {
	test("empty list renders nothing", () => {
		assert.equal(pillChain([]), "");
	});

	test("single pill: rounded caps around padded text, then reset", () => {
		const s = makeStyle("truecolor", "folder");
		assert.equal(
			pillChain([{ style: s, text: "pi" }]),
			`${s.cap}${ROUND_LEFT}${s.bg}${s.fg} pi ${RESET_BG}${s.cap}${ROUND_RIGHT}${RESET}`,
		);
	});

	test("pills are joined by a reset and one default-colored space", () => {
		const a = makeStyle("truecolor", "folder");
		const b = makeStyle("truecolor", "gitClean");
		const pills: Pill[] = [
			{ style: a, text: "A" },
			{ style: b, text: "B" },
		];
		const pa = `${a.cap}${ROUND_LEFT}${a.bg}${a.fg} A ${RESET_BG}${a.cap}${ROUND_RIGHT}`;
		const pb = `${b.cap}${ROUND_LEFT}${b.bg}${b.fg} B ${RESET_BG}${b.cap}${ROUND_RIGHT}`;
		assert.equal(pillChain(pills), `${pa}${RESET} ${pb}${RESET}`);
	});
});
