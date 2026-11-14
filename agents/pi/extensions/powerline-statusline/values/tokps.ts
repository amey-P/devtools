/**
 * Tokens/sec value service: tracks output token rate by listening to pi's
 * message events. Knows nothing about rendering — the renderer polls
 * `snapshot()`.
 *
 * Measurement model (validated against pi-ai's provider adapters):
 * - Providers disagree wildly about mid-stream usage. Google updates
   `usage.output` on every chunk; OpenAI-compatible endpoints (zai, MiniMax,
   …) only attach usage to the final chunk; Anthropic seeds `output_tokens: 1`
   at message_start and reports again only at the closing message_delta. So
   `partial.usage.output` alone cannot drive a live rate — raw `output /
   elapsed` decays to a fake "0.0 tok/s" (or never leaves the pending state)
   on most providers.
 * - Fix: count streamed delta characters and estimate tokens as
 *   `chars / charsPerToken`, calibrated by an EWMA against the real
 *   `usage.output` reported at each `message_end` (reset when the model
 *   changes). When a provider *does* report mid-stream growth ≥
 *   MIN_STREAMED_TOKENS, the exact usage count wins over the estimate.
 * - The clock anchors at the first counted delta of EACH assistant message,
 *   excluding network/TTFB and tool execution time between messages. Whatever
 *   that first delta carried (chars and usage) is subtracted as a baseline:
 *   it was produced before the clock started.
 * - `usage.output` includes hidden reasoning on some providers (OpenAI
 *   Responses `output_tokens`, Google `thoughtsTokenCount`). Those tokens are
 *   generated before the first delta, outside the measured window, so the
 *   settled rate only trusts `usage.output` when its chars/token ratio is
 *   plausible; otherwise it falls back to the char estimate.
 * - Requiring ≥ MIN_STREAMED_TOKENS before displaying keeps early spikes
 *   (tiny elapsed denominators) out of the pill.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LIVE_RENDER_INTERVAL_MS = 200;
/** Minimum counted tokens before trusting the live rate. */
const MIN_STREAMED_TOKENS = 8;
/** Initial chars-per-token guess; typical for code + prose. */
const DEFAULT_CHARS_PER_TOKEN = 4;
/** EWMA weight for recalibration at each message_end. */
const CALIB_ALPHA = 0.25;
/** Need this many real output tokens (and chars) before recalibrating. */
const CALIB_MIN_TOKENS = 16;
const CALIB_MIN_CHARS = 64;
/** Sanity band for calibrated chars/token; outside → skip the sample. */
const CALIB_MIN_CPT = 1.5;
const CALIB_MAX_CPT = 12;

export interface TokpsSnapshot {
	/** Live rate while streaming (tokens/sec); 0 until measurable growth. */
	live: number;
	/** Last settled rate from a completed assistant message. */
	last: number;
	/** True while the current assistant message is producing output. */
	started: boolean;
}

export class TokpsTracker {
	private firstAt = 0;
	private lastDeltaAt = 0;
	private baseOutput = 0;
	private baseChars = 0;
	private chars = 0;
	private usageStreamed = false;
	private live = 0;
	private last = 0;
	private lastLiveRender = 0;
	private charsPerToken = DEFAULT_CHARS_PER_TOKEN;
	private modelKey = "";

	private readonly now: () => number;

	/** `now` is injectable for tests; must be monotonic milliseconds. */
	constructor(now: () => number = () => performance.now()) {
		this.now = now;
	}

	/** Subscribe to the pi events that drive the rate. */
	attach(pi: ExtensionAPI, onChange: () => void): void {
		pi.on("turn_start", () => {
			this.live = 0;
			this.lastLiveRender = 0;
			onChange();
		});

		// Anchor the clock per assistant message, not per turn: turns with tool
		// calls span multiple LLM calls, and tool runtime must not pollute the
		// rate of the message now streaming.
		pi.on("message_start", (event) => {
			const m = event.message as AssistantMessage | undefined;
			if (m?.role !== "assistant") return;
			// Tokenizers differ per model: don't carry a calibration across.
			const key = `${m.provider ?? ""}/${m.model ?? ""}`;
			if (key !== this.modelKey) {
				this.modelKey = key;
				this.charsPerToken = DEFAULT_CHARS_PER_TOKEN;
			}
			this.reset();
			onChange();
		});

		pi.on("message_update", (event) => {
			const a = event.assistantMessageEvent;
			if (a.type !== "text_delta" && a.type !== "thinking_delta" && a.type !== "toolcall_delta") {
				return;
			}
			const now = this.now();
			this.chars += a.delta?.length ?? 0;
			const output = a.partial?.usage?.output ?? 0;
			if (!this.firstAt) {
				// Everything in the first delta predates the clock: baseline it.
				this.firstAt = now;
				this.baseOutput = output;
				this.baseChars = this.chars;
			}
			this.lastDeltaAt = now;
			const elapsed = (now - this.firstAt) / 1000;
			if (elapsed <= 0) return;
			// Exact usage growth wins when the provider streams usage; otherwise
			// estimate from delta volume (calibrated by past messages).
			const usageGrowth = output - this.baseOutput;
			if (usageGrowth >= MIN_STREAMED_TOKENS) this.usageStreamed = true;
			const tokens = this.usageStreamed ? usageGrowth : this.estimatedTokens();
			if (tokens >= MIN_STREAMED_TOKENS) this.live = tokens / elapsed;
			if (now - this.lastLiveRender >= LIVE_RENDER_INTERVAL_MS) {
				this.lastLiveRender = now;
				onChange();
			}
		});

		pi.on("message_end", (event) => {
			const m = event.message as AssistantMessage | undefined;
			if (m?.role !== "assistant") return;
			const output = m.usage?.output ?? 0;
			const sampled = output > 0 ? this.chars / output : 0;
			const plausible = sampled >= CALIB_MIN_CPT && sampled <= CALIB_MAX_CPT;
			if (output > 0 && this.firstAt) {
				const elapsed = (this.lastDeltaAt - this.firstAt) / 1000;
				let tokens: number;
				if (this.usageStreamed) tokens = output - this.baseOutput;
				// Usage matches the streamed text: scale out the baselined first delta.
				else if (plausible) tokens = (output * (this.chars - this.baseChars)) / this.chars;
				// Usage includes hidden reasoning: only the estimate fits the window.
				else tokens = this.estimatedTokens();
				if (elapsed > 0 && tokens >= MIN_STREAMED_TOKENS) this.last = tokens / elapsed;
			}
			// Recalibrate the estimator against the real token count. Aborted,
			// truncated or hidden-reasoning messages fail the sanity band and are
			// skipped.
			if (output >= CALIB_MIN_TOKENS && this.chars >= CALIB_MIN_CHARS && plausible) {
				this.charsPerToken += CALIB_ALPHA * (sampled - this.charsPerToken);
			}
			// Between messages (tool runs, next TTFB) fall back to `last` rather
			// than showing this message's live rate as if still streaming.
			this.reset();
			onChange();
		});

		// Repaint once the run truly goes idle so the settled `last` rate shows
		// immediately (turn_end can fire while the agent is still looping).
		pi.on("agent_end", () => {
			onChange();
		});
	}

	snapshot(): TokpsSnapshot {
		return { live: this.live, last: this.last, started: this.firstAt > 0 };
	}

	private estimatedTokens(): number {
		return (this.chars - this.baseChars) / this.charsPerToken;
	}

	private reset(): void {
		this.firstAt = 0;
		this.lastDeltaAt = 0;
		this.baseOutput = 0;
		this.baseChars = 0;
		this.chars = 0;
		this.usageStreamed = false;
		this.live = 0;
		this.lastLiveRender = 0;
	}
}
