/**
 * Text fitting and formatting for the status row. Pure string math — no ANSI
 * painting (see pills.ts), no data access, no timers.
 */

import { homedir } from "node:os";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const spaces = (n: number) => " ".repeat(Math.max(0, n));

/** Abbreviate $HOME to ~ for display. */
export function abbrevHome(p: string): string {
	const home = homedir();
	if (home && (p === home || p.startsWith(home + "/"))) {
		return `~${p.slice(home.length)}`;
	}
	return p;
}

/** Compact token count: 950, 1.2k, 45k, 1.3M, 45M. */
export function fmtTokens(n: number): string {
	if (n < 1_000) return String(n);
	if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

/**
 * Three-zone layout: left-anchored, centered middle, right-anchored.
 * Degrades: centered → drop center → shrink left, right stays anchored.
 * The returned line always fits exactly within `width` columns.
 */
export function layoutRow(left: string, center: string, right: string, width: number): string {
	if (width <= 0) return "";
	const wl = visibleWidth(left);
	const wc = visibleWidth(center);
	const wr = visibleWidth(right);

	// 1. Centered with at least one space on each side of the middle zone.
	if (wl + wc + wr + 2 <= width) {
		const gap = width - wl - wc - wr;
		const lp = Math.max(1, Math.floor(gap / 2));
		return left + spaces(lp) + center + spaces(gap - lp) + right;
	}

	// 2. Drop the center zone, keep left + right with a gap.
	if (center && wl + 1 + wr <= width) {
		return left + spaces(width - wl - wr) + right;
	}

	// 3. Left and right alone overflow: shrink left, keep right anchored.
	const squeezedLeft = truncateToWidth(left, Math.max(1, width - wr - 1), "…");
	return truncateToWidth(squeezedLeft + spaces(width - visibleWidth(squeezedLeft) - wr) + right, width, "");
}
