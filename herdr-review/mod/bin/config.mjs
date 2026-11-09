// Review settings: where the review opens and how big it is.
//
// File: <herdr-app home>/data/review/config.json  (the mod reads the same file; see main.js readConfig)
//   place   "float" (a floating window, default) | "right" | "down" (a split beside the agent) | "tab"
//   width   floating window width: px, or a share of the Herdr window up to 1
//   height  floating window height, the same way
//   focus   the review takes the keyboard when it opens
//   arrive  "open" (a new review opens where `place` says, default) | "inbox" (a toast; it waits in the review inbox)
// Precedence: defaults < config.json < $HERDR_REVIEW_PLACE < a per-call `place`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APP_HOME = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
export const CONFIG_FILE = join(APP_HOME, "data", "review", "config.json");
export const PLACES = ["float", "right", "down", "tab"];
export const ARRIVALS = ["open", "inbox"];
export const DEFAULTS = Object.freeze({ place: "float", width: 0.6, height: 0.8, focus: true, arrive: "open" });

const size = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && (n <= 1 || n >= 200) ? n : null;
};
const bool = (v) => (v === true || v === "true" || v === "1" || v === "yes" || v === "on" ? true
  : v === false || v === "false" || v === "0" || v === "no" || v === "off" ? false : null);

/** Parses one setting; returns the value, or throws with what's allowed. */
export function parseSetting(key, value) {
  if (key === "place") {
    const v = String(value).toLowerCase();
    if (!PLACES.includes(v)) throw new Error(`place must be one of ${PLACES.join(", ")}`);
    return v;
  }
  if (key === "width" || key === "height") {
    const v = size(value);
    if (v === null) throw new Error(`${key} must be px (200 or more) or a share of the window (0 to 1)`);
    return v;
  }
  if (key === "focus") {
    const v = bool(value);
    if (v === null) throw new Error("focus must be true or false");
    return v;
  }
  if (key === "arrive") {
    const v = String(value).toLowerCase();
    if (!ARRIVALS.includes(v)) throw new Error(`arrive must be one of ${ARRIVALS.join(", ")}`);
    return v;
  }
  throw new Error(`unknown setting "${key}" (known: ${Object.keys(DEFAULTS).join(", ")})`);
}

/** The settings in config.json alone (invalid entries dropped). */
export function readConfigFile() {
  let raw = {};
  try { raw = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) ?? {}; } catch {}
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (raw[k] === undefined) continue;
    try { out[k] = parseSetting(k, raw[k]); } catch {}
  }
  return out;
}

/** The settings in effect. `place`: a per-call override (ignored when not a known place). */
export function loadConfig({ place } = {}) {
  const cfg = { ...DEFAULTS, ...readConfigFile() };
  const env = process.env.HERDR_REVIEW_PLACE?.toLowerCase();
  if (env && PLACES.includes(env)) cfg.place = env;
  if (place && PLACES.includes(String(place).toLowerCase())) cfg.place = String(place).toLowerCase();
  return cfg;
}

/** Sets one setting in config.json (null removes it, back to the default). Returns the file's settings. */
export function setConfig(key, value) {
  const cur = readConfigFile();
  if (value === null) {
    if (!(key in DEFAULTS)) throw new Error(`unknown setting "${key}"`);
    delete cur[key];
  } else cur[key] = parseSetting(key, value);
  const dir = join(APP_HOME, "data", "review");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(cur, null, 2) + "\n");
  renameSync(tmp, CONFIG_FILE);
  return cur;
}
