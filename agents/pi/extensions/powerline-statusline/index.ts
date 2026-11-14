/**
 * Powerline status line for pi — wiring only.
 *
 * Layout, pill semantics, colors and data sources are documented in
 * README.md. Toggle: /powerline-status.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { renderRow } from "./render";
import { GitWatcher } from "./values/git";
import { ModeFeed } from "./values/mode";
import { TokpsTracker } from "./values/tokps";

export default function powerlineStatusline(pi: ExtensionAPI) {
	let enabled = true;
	let tui: TUI | null = null;
	let git: GitWatcher | null = null;
	const tokps = new TokpsTracker();

	const requestRender = () => tui?.requestRender();

	tokps.attach(pi, requestRender);

	// mode-manager publishes its mode over pi.events; the parsed status text
	// stays the fallback until the first event (see values/mode.ts).
	const modeFeed = new ModeFeed();
	modeFeed.attach(pi.events, requestRender);

	// Refresh dirty counts after each turn: commits/edits from within or outside
	// pi don't change the branch, so onBranchChange alone leaves counts stale.
	// The 250 ms throttle and in-flight guard keep this cheap.
	pi.on("agent_end", (_event, c) => {
		git?.schedule(c.cwd);
	});

	// --- footer install / removal -------------------------------------------

	function install(c: ExtensionContext) {
		if (c.mode !== "tui") return;
		// session_tree re-installs over a live footer: dispose the previous
		// watcher first so its timer and in-flight read cannot leak.
		remove();
		git = new GitWatcher(requestRender);

		c.ui.setFooter((t, theme, footerData) => {
			tui = t;
			const unsubBranch = footerData.onBranchChange(() => {
				git?.schedule(c.cwd);
				requestRender();
			});
			return {
				dispose() {
					unsubBranch();
					tui = null;
				},
				invalidate() {
					// Re-read, but keep the cached counts on screen until the
					// result lands — clearing them flashes a clean pill.
					git?.schedule(c.cwd);
				},
				render(width: number): string[] {
					if (!git) return [];
					// A throw here would propagate into the TUI render loop;
					// drop the footer row for this frame instead.
					try {
						return [renderRow({ ctx: c, theme, footerData, git, tokps, modeFeed }, width)];
					} catch {
						return [];
					}
				},
			};
		});

		git.schedule(c.cwd);
		// A footer installed after mode-manager's last event asks for the state.
		modeFeed.requestStatus(pi.events, requestRender);
	}

	function remove() {
		git?.dispose();
		git = null;
		tui = null;
	}

	// --- command -------------------------------------------------------------

	pi.registerCommand("powerline-status", {
		description: "Toggle the powerline status line footer",
		handler: async (_args, c) => {
			enabled = !enabled;
			if (enabled) {
				install(c);
			} else {
				remove();
				c.ui.setFooter(undefined);
			}
			c.ui.notify(
				enabled ? "Powerline status line enabled" : "Powerline status line off — default footer restored",
				"info",
			);
		},
	});

	// --- lifecycle -----------------------------------------------------------

	pi.on("session_start", (_event, c) => {
		if (enabled) install(c);
	});

	pi.on("session_tree", (_event, c) => {
		if (enabled) install(c);
	});

	pi.on("session_shutdown", (_event, c) => {
		remove();
		c.ui.setFooter(undefined);
	});
}
