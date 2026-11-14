import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TokpsTracker } from "./tokps";

type Handler = (event: unknown) => void;

/** Drives a tracker through fake pi events on a manual clock. */
class Harness {
	t = 0;
	private handlers = new Map<string, Handler[]>();
	readonly tracker = new TokpsTracker(() => this.t);

	constructor() {
		const pi = {
			on: (name: string, h: Handler) => {
				this.handlers.set(name, [...(this.handlers.get(name) ?? []), h]);
			},
		} as unknown as ExtensionAPI;
		this.tracker.attach(pi, () => {});
	}

	emit(name: string, event: unknown = {}) {
		for (const h of this.handlers.get(name) ?? []) h(event);
	}

	start(model = "m1") {
		this.emit("message_start", { message: { role: "assistant", provider: "p", model } });
	}

	/** One text delta of `chars` characters at the current time. */
	delta(chars: number, usageOutput = 0) {
		this.emit("message_update", {
			assistantMessageEvent: { type: "text_delta", delta: "x".repeat(chars), partial: { usage: { output: usageOutput } } },
		});
	}

	end(output: number, model = "m1") {
		this.emit("message_end", { message: { role: "assistant", provider: "p", model, usage: { output } } });
	}

	/** First delta of `first` chars at t, then `n` deltas of `each` chars every `stepMs`. */
	stream(first: number, n: number, each: number, stepMs: number) {
		this.delta(first);
		for (let i = 0; i < n; i++) {
			this.t += stepMs;
			this.delta(each);
		}
	}
}

const near = (actual: number, expected: number, tol = 0.01) =>
	assert.ok(Math.abs(actual - expected) <= tol * expected, `expected ≈${expected}, got ${actual}`);

describe("TokpsTracker", () => {
	let h: Harness;
	beforeEach(() => {
		h = new Harness();
	});

	test("first delta is baselined: a large buffered chunk does not spike the rate", () => {
		h.start();
		// 400-char first chunk at t=0, then 10 × 4 chars over 1 s → 10 tokens/s at 4 cpt.
		h.stream(400, 10, 4, 100);
		near(h.tracker.snapshot().live, 10);
	});

	test("no live rate until MIN_STREAMED_TOKENS have streamed", () => {
		h.start();
		h.stream(4, 5, 4, 100); // 20 chars after baseline = 5 tokens
		const s = h.tracker.snapshot();
		assert.equal(s.live, 0);
		assert.equal(s.started, true);
	});

	test("hidden reasoning in usage.output does not inflate the settled rate", () => {
		h.start();
		h.stream(4, 100, 4, 20); // 400 chars over 2 s ≈ 100 visible tokens
		h.end(2100); // 2000 hidden reasoning + 100 visible
		near(h.tracker.snapshot().last, 50);
	});

	test("plausible usage.output is used exactly, minus the baselined first delta", () => {
		h.start();
		h.stream(40, 10, 40, 100); // 440 chars, 400 after baseline, over 1 s
		h.end(110); // 4 cpt → 100 tokens in the window
		near(h.tracker.snapshot().last, 100);
	});

	test("streamed provider usage (Google-style) wins over the char estimate", () => {
		h.start();
		h.delta(1, 5);
		for (let i = 1; i <= 10; i++) {
			h.t += 100;
			h.delta(1, 5 + 2 * i); // 1 char per delta, but 2 real tokens
		}
		near(h.tracker.snapshot().live, 20);
		h.end(25);
		near(h.tracker.snapshot().last, 20);
	});

	test("Anthropic-style seed usage falls back to the estimate while streaming", () => {
		h.start();
		h.delta(4, 1);
		for (let i = 0; i < 10; i++) {
			h.t += 100;
			h.delta(8, 1);
		}
		near(h.tracker.snapshot().live, 20); // 80 chars / 4 cpt / 1 s
	});

	test("message_end clears live state so tool runs show the settled rate", () => {
		h.start();
		h.stream(4, 10, 8, 100);
		assert.ok(h.tracker.snapshot().live > 0);
		h.end(21);
		const s = h.tracker.snapshot();
		assert.equal(s.live, 0);
		assert.equal(s.started, false);
		assert.ok(s.last > 0);
	});

	test("calibration adapts within a model and resets on model switch", () => {
		// Teach m1 a 2 chars/token ratio.
		for (let k = 0; k < 20; k++) {
			h.start("m1");
			h.stream(4, 10, 40, 100);
			h.end(202);
		}
		h.start("m1");
		h.stream(4, 10, 8, 100); // 80 chars over 1 s
		near(h.tracker.snapshot().live, 40, 0.05); // ≈80 / 2
		h.end(42);

		h.start("m2");
		h.stream(4, 10, 8, 100);
		near(h.tracker.snapshot().live, 20); // back to 80 / 4
	});

	test("ignores non-assistant messages and non-content events", () => {
		h.emit("message_start", { message: { role: "user" } });
		h.emit("message_update", { assistantMessageEvent: { type: "start" } });
		assert.deepEqual(h.tracker.snapshot(), { live: 0, last: 0, started: false });
	});
});
