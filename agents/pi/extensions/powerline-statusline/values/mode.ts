/**
 * Mode reader: the active mode-manager mode, plannotator's phase, and other
 * extensions' footer statuses, for the mode pill and the status slot.
 *
 * Mode source, in order:
 * 1. `mode-manager:changed` events (ModeFeed). mode-manager emits one on every
 *    transition and restore, and answers `mode-manager:request {action:
 *    "status"}`, which install() sends so a footer that starts late still
 *    learns the current mode.
 * 2. Fallback while no event has been seen (older mode-manager, or a
 *    replacement mode extension): mode-manager's `ctx.ui.setStatus` text under
 *    MODE_STATUS_KEY (`Ⓜ <mode>`), parsed out of pi's extension-status map.
 *    If the key is absent there is no pill.
 *
 * Plannotator's phase comes from its own status text (key
 * PLANNOTATOR_STATUS_KEY): plannotator rewrites it on every phase change and
 * checklist step (`⏸ plan` while planning, `📋 3/5` while executing), and
 * every setStatus triggers a footer render, so it is always current.
 *
 * Why terminal sequences are stripped: statuses are written through
 * `ctx.ui.theme.fg`, so the raw text arrives wrapped in SGR sequences (and a
 * status could carry others, e.g. OSC 8 hyperlinks). pi-tui's
 * stripTerminalSequences removes CSI, OSC and APC sequences, not just CSI. The
 * powerline pill painter repaints from its own fixed palette, which must stay
 * authoritative — leftover color codes would leak theme escapes into the
 * width calculation and the painted cells.
 */

import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

// Duplicated from mode-manager/events.ts (extensions are loaded separately and
// must not import each other). Keep both sides in sync.
/** mode-manager's setStatus key (`Ⓜ <mode>`). */
export const MODE_STATUS_KEY = "mode-manager";
/** Emitted by mode-manager on every mode transition and restore. */
export const MODE_CHANGED_CHANNEL = "mode-manager:changed";
/** mode-manager answers `{ action: "status", respond }` here. */
export const MODE_REQUEST_CHANNEL = "mode-manager:request";

/** Plannotator's setStatus key (@plannotator/pi-extension index.ts, updateStatus). */
export const PLANNOTATOR_STATUS_KEY = "plannotator";

/** Statuses already represented on the mode pill, not repeated in the status slot. */
const REPRESENTED_KEYS = new Set([MODE_STATUS_KEY, PLANNOTATOR_STATUS_KEY]);

const SUFFIX_MAX = 12;

export type PlannotatorPhase = "idle" | "planning" | "executing";

/** mode-manager's ModeState (mode-manager/events.ts). */
export interface ModeState {
	mode: string;
	/** Whether the mode drives plannotator's plan mode. */
	plannotator?: boolean;
	plannotatorPhase?: PlannotatorPhase;
}

interface EventBusLike {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

function parseModeState(data: unknown): ModeState | null {
	const d = data as Partial<ModeState> | null;
	if (!d || typeof d.mode !== "string" || !d.mode.trim()) return null;
	const phase = d.plannotatorPhase;
	return {
		mode: sanitize(d.mode),
		plannotator: d.plannotator === true,
		...(phase === "idle" || phase === "planning" || phase === "executing" ? { plannotatorPhase: phase } : {}),
	};
}

/** Latest mode state published by mode-manager over pi.events. */
export class ModeFeed {
	state: ModeState | null = null;

	/** Subscribe to mode-manager:changed. Returns the unsubscribe function. */
	attach(events: EventBusLike, onChange: () => void): () => void {
		return events.on(MODE_CHANGED_CHANNEL, (data) => {
			const state = parseModeState(data);
			if (!state) return;
			this.state = state;
			onChange();
		});
	}

	/**
	 * Ask mode-manager for its current state (for a footer installed after
	 * mode-manager's last event). Silently does nothing if nobody answers.
	 */
	requestStatus(events: EventBusLike, onChange: () => void): void {
		events.emit(MODE_REQUEST_CHANNEL, {
			action: "status",
			respond: (response: unknown) => {
				const r = response as { status?: unknown; result?: unknown } | null;
				const state = r?.status === "handled" ? parseModeState(r.result) : null;
				if (!state) return;
				this.state = state;
				onChange();
			},
		});
	}
}

/** Sanitize like pi's default footer: control chars → space, collapse, trim. */
function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ {2,}/g, " ").trim();
}

function clean(raw: string | undefined): string | null {
	if (raw === undefined) return null;
	const text = sanitize(stripTerminalSequences(raw));
	return text.length > 0 ? text : null;
}

/**
 * Read the active mode name from mode-manager's status text, cleaned for pill
 * painting. Returns `null` when mode-manager has not published a mode (key
 * absent) or the label is empty after cleaning — both mean "no pill".
 */
export function readModeStatus(footerData: ReadonlyFooterDataProvider): string | null {
	const text = clean(footerData.getExtensionStatuses().get(MODE_STATUS_KEY));
	if (text === null) return null;
	const label = text.replace(/^Ⓜ\s*/, "");
	return label.length > 0 ? label : null;
}

/** The mode to paint: the event feed when it has spoken, else the status text. */
export function readMode(feed: Pick<ModeFeed, "state"> | undefined, footerData: ReadonlyFooterDataProvider): ModeState | null {
	if (feed?.state) return feed.state;
	const mode = readModeStatus(footerData);
	return mode === null ? null : { mode };
}

/**
 * Compact plannotator phase suffix for the mode pill, or null for none:
 * - executing with a checklist (`📋 3/5`) → `exec 3/5`
 * - any other plannotator status (e.g. the `⏸ plan` planning label) → the
 *   label without leading symbols, unless the mode itself drives plannotator
 *   (a PLAN pill already says "planning"; YOLO·plan flags a mismatch)
 * - no status (idle) → null
 */
export function plannotatorSuffix(mode: ModeState, footerData: ReadonlyFooterDataProvider): string | null {
	const text = clean(footerData.getExtensionStatuses().get(PLANNOTATOR_STATUS_KEY));
	if (text === null) return null;
	const progress = text.match(/(\d+)\s*\/\s*(\d+)/);
	if (progress) return `exec ${progress[1]}/${progress[2]}`;
	const drivesPlannotator = mode.plannotator ?? mode.mode.toLowerCase() === "plan";
	if (drivesPlannotator) return null;
	const label = text.replace(/^[^\p{L}\p{N}]+/u, "");
	if (!label) return null;
	return label.length > SUFFIX_MAX ? `${label.slice(0, SUFFIX_MAX - 1)}…` : label;
}

/**
 * Other extensions' footer statuses (the custom footer replaces pi's built-in
 * one, which would otherwise show them), cleaned, in key order, joined with
 * " · ". Statuses already on the mode pill are skipped. "" when none.
 */
export function otherStatuses(footerData: ReadonlyFooterDataProvider): string {
	return [...footerData.getExtensionStatuses().entries()]
		.filter(([key]) => !REPRESENTED_KEYS.has(key))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, raw]) => clean(raw))
		.filter((text): text is string => text !== null)
		.join(" · ");
}
