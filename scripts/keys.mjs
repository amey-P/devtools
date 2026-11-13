#!/usr/bin/env node
// Manages one key binding in Herdr's keys.json "global" map, idempotently.
//
//   node scripts/keys.mjs ensure <key> <command-json> [--replace <old-json>] [--tag <name>]
//       bind <key> unless it's taken by something else; a binding equal to --replace is migrated.
//       Backs keys.json up once (keys.json.bak-<tag>) before the first change.
//   node scripts/keys.mjs remove <key> <command-json>   unbind only if it still holds <command-json>
//   node scripts/keys.mjs state  <key> <command-json>   prints current | missing | bound to something else
//
// No keys.json yet (Herdr hasn't run): ensure does nothing and says so. Herdr treats the file
// as the whole key map, so a file holding only our key would drop every default.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const FILE = process.env.KEYS_FILE || join(HOME, "keys.json");

/**
 * @param {string[]} argv
 * @param {string} [file] keys.json (default: $KEYS_FILE, else <HERDR_APP_HOME>/keys.json)
 * @returns {string} a line to print ("" for nothing; lines starting "warn" are warnings)
 */
export function keys(argv, file = FILE) {
  const FILE = file;
  const [cmd, key, wantRaw, ...rest] = argv;
  if (!cmd || !key || !wantRaw) throw new Error("usage: keys.mjs ensure|remove|state <key> <command-json> [--replace <json>] [--tag <name>]");
  const want = JSON.parse(wantRaw);
  const opt = (/** @type {string} */ name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const old = opt("--replace") ? JSON.parse(/** @type {string} */ (opt("--replace"))) : undefined;
  const tag = opt("--tag") ?? (typeof want.args?.name === "string" ? want.args.name : key);
  const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b);

  /** @type {any} */
  let j = null;
  try { j = JSON.parse(readFileSync(FILE, "utf8")); } catch { j = null; }
  const valid = j && typeof j === "object" && !Array.isArray(j);

  if (cmd === "state") {
    const cur = valid ? j.global?.[key] : undefined;
    return cur === undefined ? "missing" : same(cur, want) ? "current" : "bound to something else";
  }
  if (cmd === "remove") {
    if (!valid || !same(j.global?.[key] ?? null, want)) return "";
    delete j.global[key];
    writeFileSync(FILE, JSON.stringify(j, null, 2) + "\n");
    return `unbound ${key} from keys.json`;
  }
  if (cmd !== "ensure") throw new Error(`unknown command ${cmd}`);
  if (!existsSync(FILE)) return `warn    no keys.json yet: start Herdr once, then re-run install (or bind ${key} to ${wantRaw} by hand)`;
  if (!valid) return "warn    keys.json isn't a valid JSON object; not touching it";
  if (!j.global || typeof j.global !== "object") j.global = {};
  const cur = j.global[key];
  if (same(cur ?? null, want)) return `        keys.json already binds ${key}`;
  const migrating = cur !== undefined && old !== undefined && same(cur, old);
  if (cur !== undefined && !migrating) return `warn    keys.json already uses ${key} for ${JSON.stringify(cur)}; leaving it`;
  const bak = `${FILE}.bak-${tag}`;
  let note;
  if (existsSync(bak)) note = `kept the earlier backup keys.json.bak-${tag}`;
  else { copyFileSync(FILE, bak); note = `backup: keys.json.bak-${tag}`; }
  j.global[key] = want;
  writeFileSync(FILE, JSON.stringify(j, null, 2) + "\n");
  return `${migrating ? "rebound" : "bound  "} ${key} -> ${wantRaw} in keys.json (${note})`;
}

if (process.argv[1] && /keys\.mjs$/.test(process.argv[1])) {
  try { const out = keys(process.argv.slice(2)); if (out) console.log(out); }
  catch (e) { console.error(String(/** @type {Error} */ (e).message ?? e)); process.exit(1); }
}
