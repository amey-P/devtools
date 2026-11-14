/**
 * Row composition: values + color mode → the powerline string. The only module
 * that knows what each pill contains. Pure — services are passed in via deps,
 * no timers, no event subscriptions.
 *
 * Zones: left = mode › folder › git, center = tok/s › other extension
 * statuses, right = context › model.
 *
 * Design follows the classic powerline conventions validated against powerline,
 * oh-my-posh, powerlevel10k, starship, and ccusage-style statuslines:
 * - Icons from stable Nerd Fonts ranges only (Powerline E0A0–E0D4, Font
 *   Awesome F000–F2FF — never Material Design F500+, which v3 moved).
 * - Git counts use p10k/starship symbols, conflict bucket first:
 *   branch ~conflicts +staged !unstaged ?untracked, zero counts omitted.
 * - State is a background swap (git green→amber when dirty, slate plus a
 *   warning glyph when the status read failed; context
 *   green→amber≥70%→red≥90%), never a new element.
 * - The mode pill is always visible while mode-manager publishes a mode —
 *   an element appearing/disappearing, like the git pill appearing in a repo.
 *   Colors come from this pill's fixed palette (yolo red, plan magenta,
 *   careful green, custom modes slate). They do not mirror mode-manager:
 *   its statusText() paints yolo with theme `error`, careful with `success`,
 *   and both plan and custom modes with `accent`; the pill keeps plan and
 *   custom apart. The label is the mode's emoji plus its uppercase name, plus
 *   a compact plannotator phase suffix when it adds information
 *   (`PLAN·exec 3/5`, `YOLO·plan`).
 * - Other extensions' footer statuses (hidden otherwise: this footer replaces
 *   pi's built-in one) share one dark pill in the center zone, truncated to
 *   the space the other zones leave, and omitted when too little is left.
 */

import { basename } from "node:path";
import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { abbrevHome, fmtTokens, layoutRow } from "./layout";
import { makeStyle, pillChain, type ColorMode, type Pill, type PillColor } from "./pills";
import { GIT_UNKNOWN, type GitWatcher } from "./values/git";
import { type ModeFeed, otherStatuses, plannotatorSuffix, readMode } from "./values/mode";
import type { TokpsTracker } from "./values/tokps";

// --- Icons (stable Nerd Fonts codepoints) -------------------------------------

const ICON_FOLDER = "\uF07B"; // nf-fa-folder
const ICON_BRANCH = "\uE0A0"; // nf-pl-branch
const ICON_BOLT = "\uF0E7"; // nf-fa-bolt
const ICON_GAUGE = "\uF0E4"; // nf-fa-tachometer (gauge)
const ICON_CHIP = "\uF2DB"; // nf-fa-microchip
const ICON_WARN = "\uF071"; // nf-fa-exclamation_triangle (git status unknown)

// --- Mode emoji (escape sequences, not raw glyphs — avoids encoding typos) ----

const EMOJI_YOLO = "\u{1F680}"; // rocket, U+1F680
const EMOJI_PLAN = "\u{1F4CB}"; // clipboard, U+1F4CB
const EMOJI_CAREFUL = "\u{1F6E1}\u{FE0F}"; // shield + VS16, U+1F6E1 U+FE0F
const EMOJI_OTHER = "\u{2699}\u{FE0F}"; // gear + VS16, U+2699 U+FE0F

export interface RowDeps {
	ctx: ExtensionContext;
	theme: ThemeLike;
	footerData: ReadonlyFooterDataProvider;
	git: GitWatcher;
	tokps: TokpsTracker;
	/** mode-manager's event feed; the parsed status text is used without it. */
	modeFeed?: Pick<ModeFeed, "state">;
}

/** Narrowest useful status slot text (below this the slot is omitted). */
const STATUS_SLOT_MIN = 6;
/** Widest status slot text, so it never crowds the row. */
const STATUS_SLOT_MAX = 40;
/** Columns a pill adds around its text: two caps + two padding spaces. */
const PILL_CHROME = 4;

/** Only the theme surface we consume. */
interface ThemeLike {
	getColorMode(): ColorMode;
}

/** Compact model display name: display name or id basename, date suffix stripped. */
function shortModelName(model: { name?: string; id: string } | undefined): string | undefined {
	if (!model) return undefined;
	let name = (model.name ?? "").trim();
	if (!name) {
		name = model.id;
		const slash = name.lastIndexOf("/");
		if (slash >= 0) name = name.slice(slash + 1);
	}
	name = name
		// strip -20250929 date suffixes; lookahead keeps the ":" for the split
		.replace(/-20\d{6}(?=:|$)/, "")
		.split(":")[0]; // strip :thinking-level suffix
	return name.length > 24 ? `${name.slice(0, 23)}…` : name || undefined;
}

/**
 * Mode name → palette slot. Fixed pill colors, not mode-manager's theme
 * colors (it uses `accent` for both plan and custom modes).
 */
function modeColor(name: string): PillColor {
	switch (name.toLowerCase()) {
		case "yolo":
			return "modeYolo";
		case "plan":
			return "modePlan";
		case "careful":
			return "modeCareful";
		default:
			return "modeOther";
	}
}

/** Mode name → label emoji (fallback gear for custom modes). */
function modeEmoji(name: string): string {
	switch (name.toLowerCase()) {
		case "yolo":
			return EMOJI_YOLO;
		case "plan":
			return EMOJI_PLAN;
		case "careful":
			return EMOJI_CAREFUL;
		default:
			return EMOJI_OTHER;
	}
}

export function renderRow(deps: RowDeps, width: number): string {
	const { ctx, footerData } = deps;
	const mode = deps.theme.getColorMode();

	// Left: mode pill (active mode-manager mode) › folder pill › git pill
	// (branch + dirty counts). The mode pill renders leftmost.
	const leftPills: Pill[] = [];
	const modeState = readMode(deps.modeFeed, footerData);
	if (modeState) {
		const modeName = modeState.mode;
		const suffix = plannotatorSuffix(modeState, footerData);
		leftPills.push({
			style: makeStyle(mode, modeColor(modeName)),
			text: `${modeEmoji(modeName)} ${modeName.toUpperCase()}${suffix ? `·${suffix}` : ""}`,
		});
	}
	const dir = abbrevHome(ctx.cwd);
	leftPills.push({ style: makeStyle(mode, "folder"), text: `${ICON_FOLDER} ${basename(dir) || dir}` });

	const branch = footerData.getGitBranch();
	const gv = deps.git.value;
	if (gv === GIT_UNKNOWN) {
		// Status read failed (timeout, huge output, git error): never claim clean.
		leftPills.push({
			style: makeStyle(mode, "gitUnknown"),
			text: `${ICON_BRANCH} ${branch ?? ""} ${ICON_WARN}`.replace(/ {2,}/g, " "),
		});
	} else if (branch || gv) {
		const gc = gv;
		const dirty =
			!!gc && (gc.staged > 0 || gc.unstaged > 0 || gc.conflicts > 0 || gc.untracked > 0);
		const bits: string[] = [`${ICON_BRANCH} ${branch ?? ""}`.trimEnd()];
		if (gc) {
			if (gc.conflicts > 0) bits.push(`~${gc.conflicts}`);
			if (gc.staged > 0) bits.push(`+${gc.staged}`);
			if (gc.unstaged > 0) bits.push(`!${gc.unstaged}`);
			if (gc.untracked > 0) bits.push(`?${gc.untracked}`);
		}
		if (bits.length > 0 && bits.some((b) => b.trim())) {
			leftPills.push({ style: makeStyle(mode, dirty ? "gitDirty" : "gitClean"), text: bits.join(" ") });
		}
	}
	const left = pillChain(leftPills);

	// Center: tokens/sec — live while a message streams (baseline-corrected, so
	// 0 means "no measurable rate yet"); otherwise the last settled rate,
	// including between messages of a busy turn (tool runs, TTFB).
	const centerPills: Pill[] = [];
	const streaming = !ctx.isIdle();
	const tok = deps.tokps.snapshot();
	const showLive = streaming && tok.live > 0;
	const tps = showLive ? tok.live : tok.started ? 0 : tok.last;
	if (tps > 0) {
		const color: PillColor = showLive ? "rateLive" : "rateIdle";
		centerPills.push({ style: makeStyle(mode, color), text: `${ICON_BOLT} ${tps.toFixed(1)} tok/s` });
	} else if (streaming && tok.started) {
		// Streaming but no measurable growth yet — show the pending state.
		centerPills.push({ style: makeStyle(mode, "rateLive"), text: `${ICON_BOLT} … tok/s` });
	}

	// Right: context usage pill, then the model pill at the extreme right.
	const rightPills: Pill[] = [];
	const usage = ctx.getContextUsage();
	if (usage && usage.contextWindow > 0) {
		const pct = usage.percent;
		const used = usage.tokens === null ? "?" : fmtTokens(usage.tokens);
		const pctText = pct === null ? "?" : `${Math.round(pct)}%`;
		const color: PillColor =
			pct === null ? "usageUnknown" : pct >= 90 ? "usageError" : pct >= 70 ? "usageWarn" : "usageOk";
		rightPills.push({
			style: makeStyle(mode, color),
			text: `${ICON_GAUGE} ${used}/${fmtTokens(usage.contextWindow)} · ${pctText}`,
		});
	}
	const modelName = shortModelName(ctx.model as { name?: string; id: string } | undefined);
	if (modelName) {
		rightPills.push({ style: makeStyle(mode, "model"), text: `${ICON_CHIP} ${modelName}` });
	}
	const right = pillChain(rightPills);

	// Center, continued: other extensions' statuses, fitted into what the
	// other pills leave (one space around the center zone, one between pills).
	const others = otherStatuses(footerData);
	if (others) {
		const used =
			visibleWidth(left) +
			visibleWidth(right) +
			visibleWidth(pillChain(centerPills)) +
			2 +
			(centerPills.length > 0 ? 1 : 0) +
			PILL_CHROME;
		const room = Math.min(STATUS_SLOT_MAX, width - used);
		if (room >= STATUS_SLOT_MIN) {
			centerPills.push({ style: makeStyle(mode, "extStatus"), text: truncateToWidth(others, room, "…") });
		}
	}
	const center = pillChain(centerPills);

	return truncateToWidth(layoutRow(left, center, right, width), width, "");
}
