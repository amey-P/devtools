// Review settings for node (the bridge, the agent hooks, the installer). The rules live in ../config-core.js and the
// defaults in ../config.defaults.json; the mod reads the same files (ui.js readConfig).
//
// File: <herdr-app home>/data/review/config.json, nested like the defaults, holding only what differs from them:
//   window   place "float" | "right" | "down" | "tab" · width / height (px, or a share of the window up to 1) · focus · arrive "open" | "inbox"
//   ui       font · textSize · contentWidth · sidebarWidth · sidebar "auto" | "open" | "closed" · readingTime
//   prompts  what the agent is told: deny, approvedWithNotes, feedback.*, notes.*, pi.*
// Precedence for window.place: defaults < config.json < $HERDR_REVIEW_PLACE < a per-call `place`.
/** @import { Place, RawTree, ReviewConfig, Text } from "../types.js" */

/** A settings object with any subset of the headings and any subset of the settings inside each heading
 *  (writeConfig fills in whatever's missing from the defaults). */
/** @typedef {Partial<{ window: Partial<ReviewConfig["window"]>; ui: Partial<ReviewConfig["ui"]>; prompts: Partial<ReviewConfig["prompts"]> }>} PartialConfig */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../config-core.js";

export { PLACES, text } from "../config-core.js";

const APP_HOME = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
export const CONFIG_FILE = join(APP_HOME, "data", "review", "config.json");
const DEFAULTS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "config.defaults.json");
/** The defaults, read straight from config.defaults.json (their raw JSON, typed as the settings they are). */
/** @type {Readonly<ReviewConfig>} */
export const DEFAULTS = Object.freeze(JSON.parse(readFileSync(DEFAULTS_FILE, "utf8")));

/** config.json as written (an empty object when it's missing or unreadable). `strict`: throw when it exists but
 *  isn't valid JSON, so a write doesn't replace a hand edit with a typo in it.
 *  @param {{ strict?: boolean }} [opts] @returns {RawTree} */
export function readConfigFile({ strict = false } = {}) {
  let text;
  try { text = readFileSync(CONFIG_FILE, "utf8"); } catch { return {}; }
  try { const raw = JSON.parse(text); return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}; }
  catch (e) {
    if (strict) throw new Error(`${CONFIG_FILE} isn't valid JSON (${e.message}); fix it or delete it first`);
    return {};
  }
}

/** The settings in effect. `place`: a per-call override (ignored when not a known place).
 *  @param {{ place?: Place }} [opts] @returns {ReviewConfig} */
export function loadConfig({ place } = {}) {
  const cfg = /** @type {ReviewConfig} */ (core.merge(DEFAULTS, readConfigFile()));
  const env = process.env.HERDR_REVIEW_PLACE?.toLowerCase();
  if (env && core.PLACES.includes(env)) cfg.window.place = /** @type {Place} */ (env);
  const p = place && String(place).toLowerCase();
  if (p && core.PLACES.includes(p)) cfg.window.place = /** @type {Place} */ (p);
  return cfg;
}

/** Every setting's dotted path, its value in effect and where it comes from (default, config or $HERDR_REVIEW_PLACE).
 *  @returns {{ path: string; value: Text | number | boolean; from: "default" | "config" | "$HERDR_REVIEW_PLACE" }[]} */
export function describeConfig() {
  const raw = readConfigFile();
  const cfg = loadConfig();
  const src = /** @type {{ [path: string]: "config" | "default" }} */ (core.sources(DEFAULTS, raw));
  return /** @type {string[]} */ (core.leaves(DEFAULTS)).map((path) => {
    /** @type {"default" | "config" | "$HERDR_REVIEW_PLACE"} */
    let from = src[path];
    if (path === "window.place" && cfg.window.place !== /** @type {ReviewConfig} */ (core.merge(DEFAULTS, raw)).window.place) from = "$HERDR_REVIEW_PLACE";
    return { path, value: core.get(cfg, path), from };
  });
}

/** A dotted path, or an old flat key (place → window.place).
 *  @param {string} key @returns {string} */
export const resolvePath = (key) => /** @type {Record<string, string>} */ (core.LEGACY)[key] ?? key;

/** Writes settings `cfg` (a full or partial nested object) to config.json, keeping only what differs from the defaults.
 *  @param {PartialConfig} cfg @returns {RawTree} */
export function writeConfig(cfg) {
  const raw = readConfigFile({ strict: true });
  const next = core.toFile(DEFAULTS, core.merge(DEFAULTS, cfg), raw);
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, CONFIG_FILE);
  return next;
}

/** Sets one setting (a dotted path or a flat key). `value`: text to parse into the setting's type, or null for the
 *  default. Throws with what's allowed. Returns what config.json now holds.
 *  @param {string} key @param {string | null} value @returns {RawTree} */
export function setConfig(key, value) {
  const path = resolvePath(key);
  const cur = core.merge(DEFAULTS, readConfigFile({ strict: true }));
  if (value === null) {
    if (core.get(DEFAULTS, path) === undefined) throw new Error(`unknown setting "${key}"`);
    core.set(cur, path, core.get(DEFAULTS, path));
  } else core.set(cur, path, core.parse(DEFAULTS, path, value));
  return writeConfig(cur);
}

/** Creates config.json (just `$schema`) when there isn't one, so an editor can open it with completion.
 *  @returns {string} */
export function ensureConfigFile() {
  if (!existsSync(CONFIG_FILE)) writeConfig({});
  return CONFIG_FILE;
}
