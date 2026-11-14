import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import {
	MODE_CHANGED_CHANNEL,
	MODE_REQUEST_CHANNEL,
	MODE_STATUS_KEY,
	ModeFeed,
	otherStatuses,
	PLANNOTATOR_STATUS_KEY,
	plannotatorSuffix,
	readMode,
	readModeStatus,
} from "./mode";

function fakeFooter(statuses: Record<string, string>): ReadonlyFooterDataProvider {
	return {
		getExtensionStatuses: () => new Map(Object.entries(statuses)),
	} as unknown as ReadonlyFooterDataProvider;
}

describe("readModeStatus", () => {
	test("returns null when mode-manager has not published", () => {
		assert.equal(readModeStatus(fakeFooter({})), null);
		assert.equal(readModeStatus(fakeFooter({ other: "Ⓜ plan" })), null);
	});

	test("strips the Ⓜ prefix", () => {
		assert.equal(readModeStatus(fakeFooter({ [MODE_STATUS_KEY]: "Ⓜ yolo" })), "yolo");
	});

	test("strips theme ANSI color codes", () => {
		assert.equal(readModeStatus(fakeFooter({ [MODE_STATUS_KEY]: "\x1b[38;5;127mⓂ plan\x1b[39m" })), "plan");
	});

	test("strips OSC sequences (hyperlinks, BEL and ST terminated)", () => {
		assert.equal(
			readModeStatus(fakeFooter({ [MODE_STATUS_KEY]: "\x1b]8;;https://x.dev\x07Ⓜ plan\x1b]8;;\x07" })),
			"plan",
		);
		assert.equal(
			readModeStatus(fakeFooter({ [MODE_STATUS_KEY]: "\x1b]0;title\x1b\\Ⓜ \x1b[1mreview\x1b[22m" })),
			"review",
		);
	});

	test("sanitizes control whitespace and collapses spaces", () => {
		assert.equal(readModeStatus(fakeFooter({ [MODE_STATUS_KEY]: "Ⓜ  my\tcustom\n  mode " })), "my custom mode");
	});

	test("label without the prefix is kept as-is", () => {
		assert.equal(readModeStatus(fakeFooter({ [MODE_STATUS_KEY]: "careful" })), "careful");
	});

	test("empty label after cleaning returns null", () => {
		assert.equal(readModeStatus(fakeFooter({ [MODE_STATUS_KEY]: "" })), null);
		assert.equal(readModeStatus(fakeFooter({ [MODE_STATUS_KEY]: "\x1b[31mⓂ \x1b[0m" })), null);
	});
});

function fakeBus() {
	const listeners = new Map<string, Array<(data: unknown) => void>>();
	return {
		emit(channel: string, data: unknown) {
			for (const listener of listeners.get(channel) ?? []) listener(data);
		},
		on(channel: string, listener: (data: unknown) => void) {
			listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
			return () => listeners.set(channel, (listeners.get(channel) ?? []).filter((l) => l !== listener));
		},
	};
}

describe("ModeFeed", () => {
	test("tracks mode-manager:changed and ignores malformed payloads", () => {
		const bus = fakeBus();
		const feed = new ModeFeed();
		let renders = 0;
		const unsubscribe = feed.attach(bus, () => renders++);
		bus.emit(MODE_CHANGED_CHANNEL, { mode: "plan", plannotator: true, plannotatorPhase: "planning" });
		assert.deepEqual(feed.state, { mode: "plan", plannotator: true, plannotatorPhase: "planning" });
		bus.emit(MODE_CHANGED_CHANNEL, { mode: "" });
		bus.emit(MODE_CHANGED_CHANNEL, null);
		bus.emit(MODE_CHANGED_CHANNEL, { mode: "yolo", plannotatorPhase: "bogus" });
		assert.deepEqual(feed.state, { mode: "yolo", plannotator: false });
		assert.equal(renders, 2);
		unsubscribe();
		bus.emit(MODE_CHANGED_CHANNEL, { mode: "careful" });
		assert.equal(feed.state?.mode, "yolo");
	});

	test("requestStatus learns the state of an already running mode-manager", () => {
		const bus = fakeBus();
		bus.on(MODE_REQUEST_CHANNEL, (data) => {
			const request = data as { action: string; respond: (r: unknown) => void };
			if (request.action === "status") request.respond({ status: "handled", result: { mode: "careful", plannotator: false } });
		});
		const feed = new ModeFeed();
		let renders = 0;
		feed.requestStatus(bus, () => renders++);
		assert.deepEqual(feed.state, { mode: "careful", plannotator: false });
		assert.equal(renders, 1);
	});

	test("requestStatus without mode-manager leaves the fallback in place", () => {
		const feed = new ModeFeed();
		feed.requestStatus(fakeBus(), () => assert.fail("no answer expected"));
		assert.equal(feed.state, null);
	});
});

describe("readMode", () => {
	test("prefers the event feed over the status text", () => {
		const footer = fakeFooter({ [MODE_STATUS_KEY]: "Ⓜ yolo" });
		assert.deepEqual(readMode({ state: { mode: "plan", plannotator: true } }, footer), { mode: "plan", plannotator: true });
	});

	test("falls back to the parsed status text when no event has been seen", () => {
		assert.deepEqual(readMode({ state: null }, fakeFooter({ [MODE_STATUS_KEY]: "Ⓜ careful" })), { mode: "careful" });
		assert.deepEqual(readMode(undefined, fakeFooter({ [MODE_STATUS_KEY]: "Ⓜ careful" })), { mode: "careful" });
		assert.equal(readMode(undefined, fakeFooter({})), null);
	});
});

describe("plannotatorSuffix", () => {
	const plan = { mode: "plan", plannotator: true };
	const yolo = { mode: "yolo", plannotator: false };
	const suffix = (mode: { mode: string; plannotator?: boolean }, status?: string) =>
		plannotatorSuffix(mode, fakeFooter(status === undefined ? {} : { [PLANNOTATOR_STATUS_KEY]: status }));

	test("idle plannotator (no status) adds nothing", () => {
		assert.equal(suffix(plan), null);
		assert.equal(suffix(yolo), null);
	});

	test("executing checklist progress becomes exec n/m", () => {
		assert.equal(suffix(plan, "\x1b[36m📋 3/5\x1b[39m"), "exec 3/5");
		assert.equal(suffix(yolo, "📋 0/12"), "exec 0/12");
	});

	test("planning label is implied by a plannotator mode, shown for others", () => {
		assert.equal(suffix(plan, "\x1b[33m⏸ plan\x1b[39m"), null);
		assert.equal(suffix({ mode: "plan" }, "⏸ plan"), null, "fallback: the plan mode drives plannotator");
		assert.equal(suffix(yolo, "⏸ plan"), "plan");
		assert.equal(suffix({ mode: "draft", plannotator: true }, "⏸ plan"), null);
	});

	test("long custom labels are truncated", () => {
		assert.equal(suffix(yolo, "⏸ a very long planning label"), "a very long…");
	});
});

describe("otherStatuses", () => {
	test("skips mode-manager and plannotator, cleans and orders by key", () => {
		const footer = fakeFooter({
			[MODE_STATUS_KEY]: "Ⓜ plan",
			[PLANNOTATOR_STATUS_KEY]: "⏸ plan",
			zeta: "\x1b[32mlast\x1b[39m",
			alpha: " first\n line ",
			empty: "\x1b[0m",
		});
		assert.equal(otherStatuses(footer), "first line · last");
	});

	test("empty when nothing else is published", () => {
		assert.equal(otherStatuses(fakeFooter({ [MODE_STATUS_KEY]: "Ⓜ yolo" })), "");
	});
});
