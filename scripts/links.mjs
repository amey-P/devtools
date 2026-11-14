// The `links` install target: symlink this repo's agent configs (agents/) into the
// places each coding agent reads them from, so edits in the repo apply at once.
// Unlike Herdr mods these load fine through a symlink.
//
//   node install.mjs install links     create or re-point the links (an existing real file
//                                      or folder is moved aside to <name>.bak first)
//   node install.mjs status links      which links are in place
//   node install.mjs uninstall links   remove the links (any .bak is left for you)
//
// Windows: folders become junctions (no admin needed); files need Developer Mode for a
// symlink, so they're copied instead, with a warning.
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const H = homedir();
const WIN = platform() === "win32";

/** repo source → where the agent looks for it. @type {{ src: string, dst: string }[]} */
export const LINKS = [
  { src: "agents/claude/statusline.sh", dst: join(H, ".claude", "statusline.sh") },
  { src: "agents/pi/extensions/powerline-statusline", dst: join(H, ".pi", "agent", "extensions", "powerline-statusline") },
  { src: "agents/skills/explainer", dst: join(H, ".agents", "skills", "explainer") },
  { src: "agents/skills/git", dst: join(H, ".agents", "skills", "git") },
];

/** @param {string} p */
const lstat = (p) => { try { return lstatSync(p); } catch { return null; } };

/** @param {{ src: string, dst: string }} l @returns {"current" | "missing" | "elsewhere" | "real"} */
export function linkState({ src, dst }) {
  const st = lstat(dst);
  if (!st) return "missing";
  if (!st.isSymbolicLink()) return "real";
  return resolve(dirname(dst), readlinkSync(dst)) === resolve(REPO, src) ? "current" : "elsewhere";
}

/** @param {string} dst */
function moveAside(dst) {
  let bak = `${dst}.bak`;
  if (lstat(bak)) bak = `${dst}.bak-${Date.now()}`;
  renameSync(dst, bak);
  return bak;
}

/** @param {(s: string) => void} say @param {(s: string) => void} warn */
export function installLinks(say, warn) {
  say("links:");
  for (const l of LINKS) {
    const src = join(REPO, l.src);
    if (!existsSync(src)) { warn(`  ${l.src} missing from the repo; skipped`); continue; }
    const state = linkState(l);
    if (state === "current") { say(`  ${l.dst} (already linked)`); continue; }
    if (state === "elsewhere") unlinkSync(l.dst);
    if (state === "real") say(`  moved existing ${l.dst} → ${moveAside(l.dst)}`);
    mkdirSync(dirname(l.dst), { recursive: true });
    const isDir = lstatSync(src).isDirectory();
    if (WIN && !isDir) {
      copyFileSync(src, l.dst);
      warn(`  copied ${l.src} → ${l.dst} (Windows: re-run after editing it)`);
      continue;
    }
    symlinkSync(src, l.dst, isDir ? (WIN ? "junction" : "dir") : "file");
    say(`  ${l.dst} → ${l.src}`);
  }
}

/** @param {(label: string, state: string) => boolean} show @returns {boolean} */
export function statusLinks(show) {
  let ok = true;
  for (const l of LINKS) ok = show(l.dst.replace(H, "~"), linkState(l)) && ok;
  return ok;
}

/** @param {(s: string) => void} say */
export function uninstallLinks(say) {
  for (const l of LINKS) {
    const s = linkState(l);
    if (s === "current") { unlinkSync(l.dst); say(`removed ${l.dst}`); }
    else if (s !== "missing") say(`left ${l.dst} (${s === "real" ? "not a link" : "links elsewhere"})`);
  }
}
