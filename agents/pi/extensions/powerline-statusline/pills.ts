/**
 * Powerline pill primitives: fixed classic powerline palette → painted ANSI
 * rounded pills.
 *
 * Painting rules follow the classic powerline conventions (verified against
 * powerline's renderer.py, oh-my-posh diamond style, and powerlevel10k
 * rainbow):
 *
 * - Each pill is a standalone rounded segment: U+E0B6 cap (fg = pill bg, drawn
 *   over the default terminal bg), padded text, U+E0B4 cap (fg = pill bg).
 * - Pills are joined by a single default-colored space. Soft separators
 *   (U+E0B1) are only for same-color sub-segments — never between pills of
 *   different colors.
 * - Text color is picked by WCAG luminance contrast against the fixed
 *   background (white below L ≈ 0.204, near-black above).
 *
 * Backgrounds are truecolor SGR with a nearest xterm-256 fallback, selected by
 * the active theme's color mode so 256-color terminals stay sane.
 */

const RESET = "\x1b[0m";
const RESET_BG = "\x1b[49m";

/** Color mode carried over from the active pi theme. */
export type ColorMode = "truecolor" | "256color";

/** Fixed classic powerline palette slots (hex + nearest xterm-256 index). */
export type PillColor =
	| "folder" // blue    #005f87 / 24
	| "gitClean" // green #5faf00 / 70
	| "gitDirty" // amber #d78700 / 172
	| "gitUnknown" // slate #585858 / 240 (status read failed)
	| "rateLive" // purple #5f00af / 55
	| "rateIdle" // slate #585858 / 240
	| "usageOk" // green  #5faf00 / 70
	| "usageWarn" // amber #d78700 / 172
	| "usageError" // red #af0000 / 124
	| "usageUnknown" // slate #585858 / 240
	| "model" // gray   #444444 / 238
	| "modeYolo" // red #af0000 / 124
	| "modePlan" // magenta #af00af / 127
	| "modeCareful" // green #5faf00 / 70
	| "modeOther" // slate #585858 / 240
	| "extStatus"; // dark gray #3a3a3a / 237 (other extensions' statuses)

interface PaletteEntry {
	rgb: [number, number, number];
	x256: number;
}

const PALETTE: Record<PillColor, PaletteEntry> = {
	folder: { rgb: [0x00, 0x5f, 0x87], x256: 24 },
	gitClean: { rgb: [0x5f, 0xaf, 0x00], x256: 70 },
	gitDirty: { rgb: [0xd7, 0x87, 0x00], x256: 172 },
	gitUnknown: { rgb: [0x58, 0x58, 0x58], x256: 240 },
	rateLive: { rgb: [0x5f, 0x00, 0xaf], x256: 55 },
	rateIdle: { rgb: [0x58, 0x58, 0x58], x256: 240 },
	usageOk: { rgb: [0x5f, 0xaf, 0x00], x256: 70 },
	usageWarn: { rgb: [0xd7, 0x87, 0x00], x256: 172 },
	usageError: { rgb: [0xaf, 0x00, 0x00], x256: 124 },
	usageUnknown: { rgb: [0x58, 0x58, 0x58], x256: 240 },
	model: { rgb: [0x44, 0x44, 0x44], x256: 238 },
	modeYolo: { rgb: [0xaf, 0x00, 0x00], x256: 124 },
	modePlan: { rgb: [0xaf, 0x00, 0xaf], x256: 127 },
	modeCareful: { rgb: [0x5f, 0xaf, 0x00], x256: 70 },
	modeOther: { rgb: [0x58, 0x58, 0x58], x256: 240 },
	extStatus: { rgb: [0x3a, 0x3a, 0x3a], x256: 237 },
};

const TEXT_LIGHT_RGB = [255, 255, 255] as const; // white / xterm 231
const TEXT_DARK_RGB = [0x1c, 0x1c, 0x1c] as const; // #1C1C1C / xterm 234
const TEXT_LIGHT_256 = 231;
const TEXT_DARK_256 = 234;

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const DARK_LUMINANCE = luminance([0x1c, 0x1c, 0x1c]);

/** Pick light or dark pill text by contrast ratio against the bg. */
function textColorIsLight(rgb: [number, number, number]): boolean {
	const bg = luminance(rgb);
	const vsWhite = 1.05 / (bg + 0.05);
	const vsDark = (bg + 0.05) / (DARK_LUMINANCE + 0.05);
	return vsWhite >= vsDark;
}

/** A resolved pill paint: background, contrasting text, cap color. */
export interface PillStyle {
	/** ANSI background sequence for the pill body, e.g. \x1b[48;2;r;g;bm */
	bg: string;
	/** ANSI foreground sequence with readable contrast against bg. */
	fg: string;
	/** ANSI foreground = bg color, for rounded caps over the default bg. */
	cap: string;
}

/** A pill's visible text plus its paint. */
export interface Pill {
	style: PillStyle;
	text: string;
}

// --- Style resolution ---------------------------------------------------------

/** Resolve a palette slot into a paintable pill style for the given color mode. */
export function makeStyle(mode: ColorMode, color: PillColor): PillStyle {
	const { rgb, x256 } = PALETTE[color];
	const light = textColorIsLight(rgb);
	const text = light ? TEXT_LIGHT_RGB : TEXT_DARK_RGB;
	const textIdx = light ? TEXT_LIGHT_256 : TEXT_DARK_256;
	const fg = (c: readonly number[]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
	const bgSeq = (c: readonly number[]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
	return mode === "256color"
		? { bg: `\x1b[48;5;${x256}m`, fg: `\x1b[38;5;${textIdx}m`, cap: `\x1b[38;5;${x256}m` }
		: { bg: bgSeq(rgb), fg: fg(text), cap: fg(rgb) };
}

// --- Glyphs and painting ------------------------------------------------------

/** Powerline glyph: left rounded cap (U+E0B6). */
const ROUND_LEFT = "\uE0B6";
/** Powerline glyph: right rounded cap (U+E0B4). */
const ROUND_RIGHT = "\uE0B4";

/** One rounded pill: left cap (fg = bg over default bg), padded text, right cap. */
function paintPill(s: PillStyle, text: string): string {
	return `${s.cap}${ROUND_LEFT}${s.bg}${s.fg} ${text} ${RESET_BG}${s.cap}${ROUND_RIGHT}`;
}

/**
 * Render an ordered list of pills as one rounded powerline chain, pills
 * separated by a single default-colored space. Returns "" when empty.
 */
export function pillChain(pills: Pill[]): string {
	if (pills.length === 0) return "";
	return pills.map((p) => paintPill(p.style, p.text)).join(`${RESET} `) + RESET;
}
