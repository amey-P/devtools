#!/usr/bin/env node
// herdr-peruse installer: one repo, three targets.
//
//   herdr   mod/                  → $HERDR_APP_HOME/mods/peruse   (copy, or --link for a symlink)
//           mod-inbox/            → $HERDR_APP_HOME/mods/peruse-inbox   (the inbox toggle, ctrl-shift-i)
//           mod-settings/         → $HERDR_APP_HOME/mods/peruse-settings   (opens the settings window)
//           mod-compat/           → $HERDR_APP_HOME/mods/review   (forwards the old mod name, e.g. Herdr's markdown
//                                   viewer's Review button, to peruse)
//   claude  .claude-plugin/ + integrations/claude  → Claude Code marketplace "herdr-local"
//   pi      integrations/pi       → pi package (loaded live from this repo)
//
// Usage: node install.mjs <command> [herdr|claude|pi|all] [--link] [--force]
//   install | sync     install or bring a target up to date (default target: all)
//   status             what's installed where, and whether it's current
//   installed <target> exit 0 if that target is installed (for scripts)
//   uninstall          remove from a target (the spool in data/peruse is kept)
//   open <file> [--place P]   open any markdown file to read and annotate (the installed mods/peruse/bin/peruse.mjs)
//   version <x.y.z>    set the version in every manifest
//   bump patch|minor|major
//   config [key [value|--reset]]   show or set a setting (window.place, ui.font, prompts.deny, …; see README)
//   config path | edit             print the settings file, or open it in $EDITOR
//
// Every integration loads the bridge from $HERDR_APP_HOME/mods/peruse/bin/bridge.mjs,
// so the herdr target must be installed for claude and pi to work.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync,
  renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, describeConfig, ensureConfigFile, loadConfig, resolvePath, setConfig } from "./mod/bin/config.mjs";

/** @import { RawTree } from "./mod/types.js" */

/** `status` line for one target. `current`/`stale` only exist when it's installed. */
/** @typedef {{ installed: boolean, current?: boolean, stale?: boolean, line: string }} Status */
/** An entry of @see MODS, or the bundle piped into modInstall. */
/** @typedef {{ name: string, src: string, dest: string }} ModInfo */
/** `claude plugin list --json` entry. */
/** @typedef {{ id: string, version: string, installPath: string, enabled: boolean }} ClaudePlugin */
/** `claude plugin marketplace list --json` entry. */
/** @typedef {{ name: string, path: string }} ClaudeMarket */
/** A pi settings entry: the raw setting and where it resolves to. */
/** @typedef {{ raw: string, abs: string }} PiEntry */

const REPO = dirname(fileURLToPath(import.meta.url));
const APP_HOME = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const MOD_NAME = "peruse";
const MOD_DEST = join(APP_HOME, "mods", MOD_NAME);
// Every Herdr mod folder this repo installs.
const MODS = [
  { name: MOD_NAME, src: join(REPO, "mod"), dest: MOD_DEST },
  { name: "peruse-inbox", src: join(REPO, "mod-inbox"), dest: join(APP_HOME, "mods", "peruse-inbox") },
  { name: "peruse-settings", src: join(REPO, "mod-settings"), dest: join(APP_HOME, "mods", "peruse-settings") },
  // The old mod name: Herdr's markdown viewer (and old key bindings) still open mod "review".
  { name: "review (compat)", src: join(REPO, "mod-compat"), dest: join(APP_HOME, "mods", "review") },
];
// What herdr-review installed before the rename: removed on install. (mods/review itself becomes the compat shim.)
const LEGACY_MODS = ["review-inbox", "review-settings"].map((n) => join(APP_HOME, "mods", n));
const LEGACY_SPOOL = join(APP_HOME, "data", "review");
const SPOOL = join(APP_HOME, "data", "peruse");
const MARKETPLACE = "herdr-local";
const PLUGIN = "herdr-peruse";
const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
const LEGACY_PLUGIN_ID = `herdr-review@${MARKETPLACE}`;
const CLAUDE_SRC = join(REPO, "integrations", "claude");
const PI_SRC = join(REPO, "integrations", "pi");
const PI_SETTINGS = join(homedir(), ".pi", "agent", "settings.json");
// Files Herdr writes into a mod folder; never copied, never deleted.
// Plus the dev-only type-checking files (npm run typecheck), which the runtime never reads.
const HERDR_OWNED = new Set(["jsconfig.json", "gpui-kit.d.ts", "herdr.d.ts", ".installed.json", "tsconfig.json", "types.d.ts"]);
const MANIFESTS = [
  "package.json",
  "integrations/claude/.claude-plugin/plugin.json",
  "integrations/pi/package.json",
];
const TARGETS = ["herdr", "claude", "pi"];

/** @type {Record<"ok" | "warn" | "err" | "dim", (s: string) => string>} */
const c = process.stdout.isTTY
  ? { ok: (s) => `\x1b[32m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, err: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` }
  : { ok: (s) => s, warn: (s) => s, err: (s) => s, dim: (s) => s };
/** @type {(...a: unknown[]) => void} */
const log = (...a) => console.log(...a);
/** @type {(msg: string) => never} */
const die = (msg) => { console.error(c.err(`error: ${msg}`)); process.exit(1); };

/** A JSON file as raw JSON.parse output (null if unreadable or unparsable). */
/** @type {(p: string) => any} */
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
/** @type {(p: string, v: unknown) => void} */
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const WIN = process.platform === "win32";
/**
 * spawnSync that also starts Windows .cmd/.bat shims (claude, pi from npm are shims, and
 * Node won't run those without a shell). Missing programs still report ENOENT.
 * @param {string} cmd
 * @param {string[]} args
 */
function spawnCompat(cmd, args) {
  if (!WIN) return spawnSync(cmd, args, { encoding: "utf8" });
  const exts = (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  let exe = null;
  for (const d of (process.env.PATH || "").split(";")) {
    for (const e of exts) { const p = join(d, cmd + e); if (d && existsSync(p)) { exe = p; break; } }
    if (exe) break;
  }
  if (!exe) return spawnSync(cmd, args, { encoding: "utf8" });
  if (!/\.(cmd|bat)$/i.test(exe)) return spawnSync(exe, args, { encoding: "utf8" });
  /** @param {string} a */
  const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  return spawnSync(`"${exe}" ${args.map(q).join(" ")}`, { encoding: "utf8", shell: true });
}

/** @type {() => string} */
const version = () => readJson(join(REPO, "package.json")).version;

/** @param {string} cmd @param {string[]} args
 *  @param {{ quiet?: boolean, allowFail?: boolean }} [opts] @returns {{ ok: boolean, stdout: string, stderr: string, missing?: boolean }} */
function sh(cmd, args, { quiet = false, allowFail = false } = {}) {
  const r = spawnCompat(cmd, args);
  if (/** @type {NodeJS.ErrnoException} */ (r.error)?.code === "ENOENT") {
    if (allowFail) return { ok: false, missing: true, stdout: "", stderr: `${cmd} not found` };
    die(`${cmd} not found on PATH`);
  }
  const ok = r.status === 0;
  if (!quiet && (r.stdout || "").trim()) log(c.dim((r.stdout || "").trim()));
  if (!ok && !allowFail) die(`${cmd} ${args.join(" ")} failed:\n${(r.stderr || r.stdout || "").trim()}`);
  return { ok, stdout: r.stdout || "", stderr: r.stderr || "" };
}
/** @type {(cmd: string) => boolean} */
const has = (cmd) => /** @type {NodeJS.ErrnoException | undefined} */ (spawnCompat(cmd, ["--version"]).error)?.code !== "ENOENT";

/** Relative paths of every file under dir, skipping `skip(name)`.  @param {string} dir
 *  @param {(name: string) => boolean} [skip] @param {string} [base] @returns {string[]} */
function walk(dir, skip = () => false, base = dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip(e.name) || e.name === ".DS_Store") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, skip, base));
    else out.push(relative(base, p));
  }
  return out.sort();
}
/** @type {(p: string) => string} */
const fileHash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
/** @param {string} dir @param {(name: string) => boolean} [skip] @returns {string} */
function treeHash(dir, skip) {
  const h = createHash("sha256");
  for (const f of walk(dir, skip)) h.update(f).update("\0").update(fileHash(join(dir, f))).update("\0");
  return h.digest("hex");
}
/** @type {(name: string) => boolean} */
const skipHerdr = (name) => HERDR_OWNED.has(name);
/** @type {(p: string) => boolean} */
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

// ---------------------------------------------------------------- herdr

/** @param {ModInfo} mod @returns {Status} */
function modStatus({ name, src, dest }) {
  if (!existsSync(dest) && !isLink(dest)) return { installed: false, line: `${name}: not installed` };
  if (isLink(dest)) {
    const to = resolve(dirname(dest), readlinkSync(dest));
    const current = to === src;
    return { installed: true, current, line: `${name}: ${current ? `linked → ${to}` : `linked elsewhere → ${to}`}` };
  }
  const meta = readJson(join(dest, ".installed.json"));
  const current = treeHash(src, skipHerdr) === treeHash(dest, skipHerdr);
  const v = meta?.version ?? "unknown version";
  return { installed: true, current, line: `${name}: copy ${v}${current ? "" : ", differs from repo"}` };
}

/** @returns {Status} */
function herdrStatus() {
  const all = MODS.map(modStatus);
  const keys = inboxKeyBound() ? "" : "; ctrl-shift-i not bound";
  return { installed: all.every((s) => s.installed), current: all.every((s) => s.current), line: all.map((s) => s.line).join("; ") + keys };
}

/** @param {{ link?: boolean }} opts @returns {void} */
function herdrInstall({ link }) {
  migrateLegacy();
  for (const m of MODS) modInstall(m, { link });
  migrateKeys();
}

/** herdr-review → herdr-peruse: carry the spool (settings, drafts, replies) over and drop the old helper mods.
 *  @returns {void} */
function migrateLegacy() {
  if (existsSync(LEGACY_SPOOL) && !existsSync(SPOOL)) {
    renameSync(LEGACY_SPOOL, SPOOL);
    log(`  moved ${LEGACY_SPOOL} → ${SPOOL}`);
    // config.json's $schema pointed at the old mod folder.
    const cfg = join(SPOOL, "config.json");
    if (existsSync(cfg)) writeFileSync(cfg, readFileSync(cfg, "utf8").replace("mods/review/config.schema.json", "mods/peruse/config.schema.json"));
  }
  for (const dest of LEGACY_MODS) {
    if (!existsSync(dest) && !isLink(dest)) continue;
    rmSync(dest, isLink(dest) ? {} : { recursive: true });
    log(`  removed old ${dest}`);
  }
  // A symlinked mods/review (old --link install) points into the old repo folder: drop it so the shim can be copied in.
  const old = join(APP_HOME, "mods", "review");
  if (isLink(old)) { rmSync(old); log(`  removed old link ${old}`); }
}

/** @param {ModInfo} mod @param {{ link?: boolean }} opts @returns {void} */
function modInstall({ src: MOD_SRC, dest: MOD_DEST }, { link }) {
  mkdirSync(dirname(MOD_DEST), { recursive: true });
  if (link) {
    if (isLink(MOD_DEST)) rmSync(MOD_DEST);
    else if (existsSync(MOD_DEST)) rmSync(MOD_DEST, { recursive: true });
    symlinkSync(MOD_SRC, MOD_DEST, WIN ? "junction" : "dir"); // junctions need no admin rights on Windows
    log(`  linked ${MOD_DEST} → ${MOD_SRC}`);
  } else {
    if (isLink(MOD_DEST)) rmSync(MOD_DEST);
    mkdirSync(MOD_DEST, { recursive: true });
    const want = new Set(walk(MOD_SRC, skipHerdr));
    let changed = 0, removed = 0;
    // Mirror: drop files that left the repo (Herdr-owned ones stay).
    for (const f of walk(MOD_DEST, skipHerdr)) {
      if (!want.has(f)) { rmSync(join(MOD_DEST, f)); removed++; }
    }
    for (const entry of readdirSync(MOD_DEST, { withFileTypes: true })) {
      if (entry.isDirectory() && walk(join(MOD_DEST, entry.name)).length === 0) rmSync(join(MOD_DEST, entry.name), { recursive: true });
    }
    for (const f of want) {
      const from = join(MOD_SRC, f), to = join(MOD_DEST, f);
      if (existsSync(to) && fileHash(to) === fileHash(from)) continue;
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
      changed++;
    }
    writeJson(join(MOD_DEST, ".installed.json"), { version: version(), source: REPO, at: new Date().toISOString() });
    log(`  ${MOD_DEST}: ${changed} updated, ${removed} removed`);
  }
  if (has("herdr-app")) {
    const r = sh("herdr-app", ["check", MOD_DEST], { quiet: true, allowFail: true });
    if (!r.ok) die(`herdr-app check failed:\n${(r.stderr || r.stdout).trim()}`);
    log(`  ${c.ok("herdr-app check passed")}`);
  } else {
    log(c.warn("  herdr-app not on PATH; skipped check"));
  }
}

// The reply key (ctrl-shift-r) used to split right; mod.open lets the review follow the place setting.
const KEYS_FILE = join(APP_HOME, "keys.json");
const OLD_REPLY_BINDING = /\{\s*"command"\s*:\s*"pane\.split"\s*,\s*"args"\s*:\s*\{\s*"direction"\s*:\s*"right"\s*,\s*"mod"\s*:\s*"review"\s*,\s*"props"\s*:\s*\{\s*"kind"\s*:\s*"reply"\s*\}\s*\}\s*\}/g;
// The inbox key: ctrl-shift-i toggles the review inbox.
const INBOX_KEY = "ctrl-shift-i";
const INBOX_BINDING = '{ "command": "mod.open", "args": { "name": "peruse-inbox" } }';
function inboxKeyBound() {
  const k = readJson(KEYS_FILE)?.global?.[INBOX_KEY];
  return k?.command === "mod.open" && k?.args?.name === "peruse-inbox";
}
/** @returns {void} */
function migrateKeys() {
  if (!existsSync(KEYS_FILE)) return;
  const text = readFileSync(KEYS_FILE, "utf8");
  let next = text;
  /** @type {string[]} */
  const did = [];
  if (OLD_REPLY_BINDING.test(next)) {
    next = next.replace(OLD_REPLY_BINDING, '{ "command": "mod.open", "args": { "name": "peruse" } }');
    did.push("reply review binding now follows the place setting");
  }
  // herdr-review → herdr-peruse: mod.open {name: "review" | "review-inbox" | "review-settings"}, and review.* commands.
  const renamed = next
    .replace(/("command"\s*:\s*"mod\.open"\s*,\s*"args"\s*:\s*\{\s*"name"\s*:\s*")review(-inbox|-settings)?"/g, '$1peruse$2"')
    .replace(/"review\.(submit|send|approve|deny|general|sidebar|refresh|settings)"/g, '"peruse.$1"');
  if (renamed !== next) { next = renamed; did.push("review bindings now open peruse"); }
  let keys = null;
  try { keys = JSON.parse(next); } catch {}
  const bound = keys?.global?.[INBOX_KEY]?.command === "mod.open" && keys?.global?.[INBOX_KEY]?.args?.name === "peruse-inbox";
  if (keys && !bound) {
    if (keys.global?.[INBOX_KEY] !== undefined) log(c.warn(`  keys.json: ${INBOX_KEY} is already bound; bind mod.open {"name": "peruse-inbox"} to another key for the inbox`));
    else if (/"global"\s*:\s*\{/.test(next)) {
      // Insert as text so the file keeps its formatting.
      next = next.replace(/"global"\s*:\s*\{/, (m) => `${m}\n    "${INBOX_KEY}": ${INBOX_BINDING},`);
      did.push(`${INBOX_KEY} opens the review inbox`);
    }
  }
  if (next === text) return;
  try { JSON.parse(next); } catch { log(c.warn("  keys.json: couldn't update the peruse bindings (left as is)")); return; }
  writeFileSync(`${KEYS_FILE}.bak-peruse`, text);
  writeFileSync(KEYS_FILE, next);
  log(`  keys.json: ${did.join("; ")} (backup: keys.json.bak-peruse)`);
}

/** @returns {void} */
function showConfig() {
  log(`${c.dim(CONFIG_FILE)}  ${c.dim("(or ⚙ Settings in a review)")}`);
  const rows = describeConfig();
  /** @type {(p: string) => string} */
  const sub = (p) => p.slice(p.indexOf(".") + 1);
  const w = Math.max(...rows.map((r) => sub(r.path).length));
  let group = null;
  for (const { path, value, from } of rows) {
    const g = path.split(".")[0];
    if (g !== group) { group = g; log(`${g}`); }
    const shown = typeof value === "string" || Array.isArray(value)
      ? JSON.stringify(Array.isArray(value) ? value.join("\n") : value)
      : String(value);
    const v = shown.length > 52 ? `${shown.slice(0, 51)}…` : shown;
    log(`  ${sub(path).padEnd(w)}  ${(from === "default" ? c.dim : c.ok)(v.padEnd(53))} ${c.dim(from)}`);
  }
}

function herdrUninstall() {
  for (const { dest } of MODS) {
    if (isLink(dest)) rmSync(dest);
    else if (existsSync(dest)) rmSync(dest, { recursive: true });
    log(`  removed ${dest}`);
  }
  log(`  (spool in ${join(APP_HOME, "data", "peruse")} kept; key bindings in keys.json left as they are)`);
}

// ---------------------------------------------------------------- claude

/** @returns {{ plugin?: ClaudePlugin, market?: ClaudeMarket, legacy?: ClaudePlugin }} */
function claudeState() {
  /** @type {ClaudePlugin[]} */
  const plugins = JSON.parse(sh("claude", ["plugin", "list", "--json"], { quiet: true }).stdout || "[]");
  /** @type {ClaudeMarket[]} */
  const markets = JSON.parse(sh("claude", ["plugin", "marketplace", "list", "--json"], { quiet: true }).stdout || "[]");
  return { plugin: plugins.find((p) => p.id === PLUGIN_ID), market: markets.find((m) => m.name === MARKETPLACE),
    legacy: plugins.find((p) => p.id === LEGACY_PLUGIN_ID) };
}

/** @returns {Status} */
function claudeStatus() {
  if (!has("claude")) return { installed: false, line: "claude not on PATH" };
  const { plugin, market, legacy } = claudeState();
  // Still the plugin's old name: opted in, and out of date until `install` swaps it.
  if (!plugin && legacy) return { installed: true, current: false, line: `${LEGACY_PLUGIN_ID} ${legacy.version} (old name; install replaces it)` };
  if (!market) return { installed: false, line: "marketplace not added" };
  /** @type {string[]} */
  const parts = [];
  const marketOk = market.path === REPO;
  if (!marketOk) parts.push(`marketplace points at ${market.path}`);
  if (!plugin) return { installed: false, line: [...parts, "plugin not installed"].join("; ") };
  const stale = plugin.version === version() && existsSync(plugin.installPath)
    && treeHash(CLAUDE_SRC) !== treeHash(plugin.installPath);
  const current = marketOk && plugin.version === version() && !stale && plugin.enabled;
  parts.unshift(`${plugin.version}${plugin.enabled ? "" : " (disabled)"}`);
  if (plugin.version !== version()) parts.push(`repo is ${version()}`);
  if (stale) parts.push("plugin files changed without a version bump");
  return { installed: true, current, stale, line: parts.join("; ") };
}

/** @param {{ force?: boolean }} opts @returns {void} */
function claudeInstall({ force }) {
  if (!has("claude")) { log(c.warn("  claude not on PATH; skipped")); return; }
  let { plugin, market } = claudeState();
  if (market && market.path !== REPO) {
    log(`  repointing marketplace ${MARKETPLACE}: ${market.path} → ${REPO}`);
    sh("claude", ["plugin", "marketplace", "remove", MARKETPLACE]);
    market = null;
    plugin = claudeState().plugin;
  }
  if (!market) sh("claude", ["plugin", "marketplace", "add", REPO]);
  else sh("claude", ["plugin", "marketplace", "update", MARKETPLACE]);
  // The plugin was called herdr-review before the rename: its hooks would answer plans twice.
  if (claudeState().legacy) {
    sh("claude", ["plugin", "uninstall", LEGACY_PLUGIN_ID], { allowFail: true });
    log(`  removed old ${LEGACY_PLUGIN_ID}`);
  }

  if (plugin && plugin.version === version() && existsSync(plugin.installPath)
      && treeHash(CLAUDE_SRC) !== treeHash(plugin.installPath) && !force) {
    die(`Claude plugin files changed but the version is still ${version()}; Claude keeps its cached copy.\n`
      + `  Run: node install.mjs bump patch   (or pass --force to reinstall at the same version)`);
  }
  if (!plugin) sh("claude", ["plugin", "install", PLUGIN_ID]);
  else if (force && plugin.version === version()) {
    sh("claude", ["plugin", "uninstall", PLUGIN_ID]);
    sh("claude", ["plugin", "install", PLUGIN_ID]);
  } else if (plugin.version !== version()) sh("claude", ["plugin", "update", PLUGIN_ID]);
  else { log(c.dim(`  ${PLUGIN_ID} ${plugin.version} already current`)); if (plugin.enabled) return; }
  if (plugin && !plugin.enabled) sh("claude", ["plugin", "enable", PLUGIN_ID]);
  log(`  ${c.ok(`${PLUGIN_ID} ${version()}`)} (restart Claude sessions to load hook changes)`);
}

/** @returns {void} */
function claudeUninstall() {
  if (!has("claude")) return;
  const { plugin, market, legacy } = claudeState();
  if (plugin) sh("claude", ["plugin", "uninstall", PLUGIN_ID]);
  if (legacy) sh("claude", ["plugin", "uninstall", LEGACY_PLUGIN_ID], { allowFail: true });
  if (market) sh("claude", ["plugin", "marketplace", "remove", MARKETPLACE]);
  log("  removed plugin and marketplace");
}

// ---------------------------------------------------------------- pi

/** A pi `packages` entry: a path string, or {source, extensions…}. @typedef {string | { source?: string }} PiRaw */
/** @param {PiRaw} p @returns {string | null} */
const piSource = (p) => (typeof p === "string" ? p : typeof p?.source === "string" ? p.source : null);
/** @param {string} src @returns {string} */
const piAbs = (src) => resolve(dirname(PI_SETTINGS), src.replace(/^~(?=[\\/])/, homedir()));

/** pi settings entries that are this package (this repo, the old herdr-review folder, or the old in-mod location).
 *  @returns {PiEntry[]} */
function piEntries() {
  /** @type {{ packages?: PiRaw[] }} */
  const s = readJson(PI_SETTINGS);
  return (s?.packages ?? []).flatMap((p) => {
    const src = piSource(p);
    if (!src || /^(npm|git|https?|ssh):/.test(src)) return [];
    const abs = piAbs(src);
    const ours = abs === PI_SRC || [PLUGIN, "herdr-review"].includes(readJson(join(abs, "package.json"))?.name)
      || abs.endsWith(join("mods", "review", "integrations", "pi")) || abs.endsWith(join("herdr-review", "integrations", "pi"));
    return ours ? [{ raw: JSON.stringify(p), abs }] : [];
  });
}

/** @returns {Status} */
function piStatus() {
  if (!existsSync(PI_SETTINGS)) return { installed: false, line: `no ${PI_SETTINGS}` };
  const entries = piEntries();
  if (!entries.length) return { installed: false, line: "not in pi settings" };
  const current = entries.length === 1 && entries[0].abs === PI_SRC;
  return { installed: true, current, line: current ? `live from ${PI_SRC}` : `entries: ${entries.map((e) => e.abs).join(", ")}` };
}

/** Remove matching entries from pi's settings directly: `pi remove` resolves relative
 *  paths against the cwd and can't match an entry whose folder is gone. */
/** @param {(e: PiEntry) => boolean} pred @returns {void} */
function dropPiEntries(pred) {
  const drop = new Set(piEntries().filter(pred).map((e) => e.raw));
  if (!drop.size) return;
  /** @type {{ packages: PiRaw[] }} */
  const s = readJson(PI_SETTINGS);
  s.packages = s.packages.filter((p) => !drop.has(JSON.stringify(p)));
  writeJson(PI_SETTINGS, s);
  for (const raw of drop) log(`  removed pi entry ${raw}`);
}

/** Entries pointing at the old herdr-review folder now point here, keeping their shape (extension filters).
 *  @returns {void} */
function repointPiEntries() {
  if (piEntries().some((e) => e.abs === PI_SRC)) return;
  const old = piEntries()[0];
  if (!old || existsSync(old.abs)) return;
  /** @type {{ packages: PiRaw[] }} */
  const s = readJson(PI_SETTINGS);
  const rel = relative(dirname(PI_SETTINGS), PI_SRC);
  s.packages = s.packages.map((p) => JSON.stringify(p) !== old.raw ? p : typeof p === "string" ? rel : { ...p, source: rel });
  writeJson(PI_SETTINGS, s);
  log(`  pi entry now points at ${PI_SRC}`);
}

/** @returns {void} */
function piInstall() {
  if (!has("pi")) { log(c.warn("  pi not on PATH; skipped")); return; }
  repointPiEntries();
  dropPiEntries((e) => e.abs !== PI_SRC);
  if (!piEntries().some((e) => e.abs === PI_SRC)) sh("pi", ["install", PI_SRC]);
  log(`  ${c.ok(`pi loads ${PI_SRC}`)} (restart pi sessions to reload)`);
}

/** @returns {void} */
function piUninstall() {
  if (!has("pi")) return;
  dropPiEntries(() => true);
  log("  removed from pi settings");
}

// ---------------------------------------------------------------- versions

/** @param {string} v @returns {void} */
function setVersion(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v)) die(`not a version: ${v}`);
  for (const f of MANIFESTS) {
    const p = join(REPO, f), j = readJson(p);
    j.version = v;
    writeJson(p, j);
  }
  const mp = join(REPO, ".claude-plugin", "marketplace.json"), m = readJson(mp);
  for (const p of m.plugins) if (p.name === PLUGIN) p.version = v;
  writeJson(mp, m);
  log(`version ${v} written to ${MANIFESTS.length + 1} manifests`);
}

/** @param {string} kind @returns {void} */
function bump(kind) {
  const [a, b, p] = version().split(".").map(Number);
  const next = /** @type {Record<string, string | undefined>} */ ({ major: `${a + 1}.0.0`, minor: `${a}.${b + 1}.0`, patch: `${a}.${b}.${p + 1}` })[kind];
  if (!next) die("bump patch|minor|major");
  setVersion(next);
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [cmd, arg] = argv.filter((a) => !a.startsWith("--"));
const targets = !arg || arg === "all" ? TARGETS : TARGETS.includes(arg) ? [arg] : null;
const opts = { link: flags.has("--link"), force: flags.has("--force") };
/** @type {Record<string, { status: () => Status, install: () => void, uninstall: () => void }>} */
const impl = {
  herdr: { status: herdrStatus, install: () => herdrInstall(opts), uninstall: herdrUninstall },
  claude: { status: claudeStatus, install: () => claudeInstall(opts), uninstall: claudeUninstall },
  pi: { status: piStatus, install: piInstall, uninstall: piUninstall },
};

switch (cmd) {
  case "install":
  case "sync":
    if (!targets) die(`unknown target ${arg}`);
    log(`herdr-peruse ${version()}`);
    for (const t of targets) { log(`${t}:`); impl[t].install(); }
    break;
  case "status": {
    if (!targets) die(`unknown target ${arg}`);
    log(`herdr-peruse ${version()}  ${c.dim(REPO)}`);
    let ok = true;
    for (const t of targets) {
      const s = impl[t].status();
      const mark = !s.installed ? c.warn("○") : s.current ? c.ok("●") : c.warn("◐");
      if (!s.installed || !s.current) ok = false;
      log(`  ${mark} ${t.padEnd(6)} ${s.line}`);
    }
    process.exit(ok ? 0 : 2);
  }
  case "installed":
    // Exit 0 when the target is installed (current or not): how ../install.sh tells opted-in agents apart.
    if (!targets || targets.length !== 1) die("installed herdr|claude|pi");
    process.exit(impl[targets[0]].status().installed ? 0 : 1);
  case "uninstall":
    if (!targets) die(`unknown target ${arg}`);
    for (const t of [...targets].reverse()) { log(`${t}:`); impl[t].uninstall(); }
    break;
  case "version":
    if (!arg) { log(version()); break; }
    setVersion(arg);
    break;
  case "bump":
    bump(arg ?? "patch");
    break;
  case "open": {
    // Delegates to the installed CLI, which loads the installed bridge (the same one the agents use).
    const r = spawnSync(process.execPath, [join(MOD_DEST, "bin", "peruse.mjs"), "open", ...argv.slice(1)], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  case "config": {
    const rest = argv.slice(1).filter((a) => a !== "--reset");
    const [key, ...vals] = rest;
    if (key === "path") { log(CONFIG_FILE); break; }
    if (key === "edit") {
      const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
      const file = ensureConfigFile();
      const r = spawnSync(editor, [file], { stdio: "inherit", shell: process.platform === "win32" });
      if (r.error) die(`couldn't run ${editor}: ${r.error.message}`);
      break;
    }
    // A value may have spaces (prompts): the rest of the line. "\n" in it is a new line.
    const value = vals.length ? vals.join(" ").replace(/\\n/g, "\n") : undefined;
    try {
      if (key && flags.has("--reset")) setConfig(key, null);
      else if (key && value !== undefined) setConfig(key, value);
      else if (key) {
        const path = resolvePath(key);
        // An arbitrary node of the config file (its raw JSON), walked by the dotted key.
        /** @type {any} */
        const v = path.split(".").reduce((o, k) => (o && typeof o === "object" ? /** @type {RawTree} */ (o)[k] : undefined), loadConfig());
        if (v === undefined) die(`unknown setting "${key}"`);
        log(typeof v === "object" ? JSON.stringify(v, null, 2) : Array.isArray(v) ? v.join("\n") : String(v));
        break;
      }
    } catch (e) { die(e.message); }
    showConfig();
    break;
  }
  default:
    log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 25).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith("//"))).slice(0, -2).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(cmd ? 1 : 0);
}
