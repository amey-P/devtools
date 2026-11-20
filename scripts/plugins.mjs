// The `plugins` install target: coding-agent plugins from plugins/*, each installable into
// one or more agents. Opt-in only: nothing here runs unless you name the `plugins` target.
//
//   node install.mjs install plugins                       refresh the plugins already installed
//   node install.mjs install plugins <name> [claude|pi]    opt in (every agent on PATH, or one)
//   node install.mjs status plugins [name]
//   node install.mjs uninstall plugins [name] [claude|pi]
//   node install.mjs bump <name> patch|minor|major         version in every manifest of that plugin
//
// A plugin is a folder under plugins/ with a package.json. Its targets come from what's in it:
//   claude  .claude-plugin/plugin.json → Claude Code marketplace "agentctl" (.claude-plugin/marketplace.json
//           at the repo root). Claude runs a cached copy, so changes need a version bump (or --force).
//   pi      a "pi" field in package.json → pi package, loaded live from the folder.
// package.json "agentctl": { "requires": [mod…], "legacyNames": [old names…] }. A required Herdr
// mod is only checked (with a warning), never installed from here.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGINS_DIR = join(REPO, "plugins");
const MARKETPLACE = "agentctl";
const MARKETPLACE_FILE = join(REPO, ".claude-plugin", "marketplace.json");
/** Marketplaces this repo's plugins came from before; dropped on install once nothing of theirs is left. */
const LEGACY_MARKETS = ["herdr-local"];
const PI_SETTINGS = join(homedir(), ".pi", "agent", "settings.json");
const WIN = process.platform === "win32";
export const AGENTS = /** @type {const} */ (["claude", "pi"]);

/** @typedef {"claude" | "pi"} Agent */
/**
 * @typedef {object} Plugin
 * @property {string} name        folder name, what the CLI takes
 * @property {string} dir
 * @property {string} pkg         package.json name (pi) and plugin.json name (claude)
 * @property {string} version
 * @property {Agent[]} targets
 * @property {string[]} requires  Herdr mods it loads at run time
 * @property {string[]} legacyNames
 */
/** @typedef {{ id: string, version: string, installPath: string, enabled: boolean }} ClaudePlugin */
/** @typedef {{ name: string, path: string }} ClaudeMarket */
/** @typedef {{ raw: string, abs: string }} PiEntry */
/** @typedef {{ installed: boolean, current?: boolean, line: string }} Status */
/**
 * @typedef {object} IO
 * @property {(s: string) => void} say
 * @property {(s: string) => void} warn
 * @property {(s: string) => string} ok
 * @property {(s: string) => string} dim
 * @property {(s: string) => never} die
 */

/** @type {(p: string) => any} */
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
/** @type {(p: string, v: unknown) => void} */
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

// ---------------------------------------------------------------- discovery

/** @returns {Plugin[]} */
export function discover() {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PLUGINS_DIR, e.name, "package.json")))
    .map((e) => {
      const dir = join(PLUGINS_DIR, e.name), p = readJson(join(dir, "package.json"));
      /** @type {Agent[]} */
      const targets = [];
      if (existsSync(join(dir, ".claude-plugin", "plugin.json"))) targets.push("claude");
      if (p.pi) targets.push("pi");
      return { name: e.name, dir, pkg: p.name, version: p.version, targets,
        requires: p.agentctl?.requires ?? [], legacyNames: p.agentctl?.legacyNames ?? [] };
    });
}

// ---------------------------------------------------------------- programs

/**
 * spawnSync that also starts Windows .cmd/.bat shims (claude, pi from npm are shims, and
 * Node won't run those without a shell). Missing programs still report ENOENT.
 * @param {string} cmd @param {string[]} args
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

/** @type {(cmd: string) => boolean} */
export const hasAgent = (cmd) => /** @type {NodeJS.ErrnoException | undefined} */ (spawnCompat(cmd, ["--version"]).error)?.code !== "ENOENT";

/** @param {IO} io @param {string} cmd @param {string[]} args @param {{ quiet?: boolean, allowFail?: boolean }} [opts] */
function sh(io, cmd, args, { quiet = false, allowFail = false } = {}) {
  const r = spawnCompat(cmd, args);
  if (/** @type {NodeJS.ErrnoException} */ (r.error)?.code === "ENOENT") {
    if (allowFail) return { ok: false, stdout: "", stderr: `${cmd} not found` };
    io.die(`${cmd} not found on PATH`);
  }
  const ok = r.status === 0;
  if (!quiet && (r.stdout || "").trim()) io.say(io.dim((r.stdout || "").trim().replace(/^/gm, "    ")));
  if (!ok && !allowFail) io.die(`${cmd} ${args.join(" ")} failed:\n${(r.stderr || r.stdout || "").trim()}`);
  return { ok, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// ---------------------------------------------------------------- hashing

/** @param {string} dir @param {string} [base] @returns {string[]} */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".DS_Store" || e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out.sort();
}
/** @param {string} dir */
function treeHash(dir) {
  const h = createHash("sha256");
  for (const f of walk(dir)) h.update(f).update("\0").update(createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")).update("\0");
  return h.digest("hex");
}

// ---------------------------------------------------------------- claude

/** @param {IO} io @param {Plugin} pl */
function claudeState(io, pl) {
  /** @type {ClaudePlugin[]} */
  const plugins = JSON.parse(sh(io, "claude", ["plugin", "list", "--json"], { quiet: true }).stdout || "[]");
  /** @type {ClaudeMarket[]} */
  const markets = JSON.parse(sh(io, "claude", ["plugin", "marketplace", "list", "--json"], { quiet: true }).stdout || "[]");
  const legacyIds = LEGACY_MARKETS.flatMap((m) => [pl.pkg, ...pl.legacyNames].map((n) => `${n}@${m}`));
  return {
    plugins, markets,
    plugin: plugins.find((p) => p.id === `${pl.pkg}@${MARKETPLACE}`),
    market: markets.find((m) => m.name === MARKETPLACE),
    legacy: plugins.filter((p) => legacyIds.includes(p.id)),
  };
}

/** @param {IO} io @param {Plugin} pl @returns {Status} */
function claudeStatus(io, pl) {
  const id = `${pl.pkg}@${MARKETPLACE}`;
  const { plugin, market, legacy } = claudeState(io, pl);
  if (!plugin && legacy.length) return { installed: true, current: false, line: `${legacy.map((p) => `${p.id} ${p.version}`).join(", ")} (old marketplace; install replaces it)` };
  if (!plugin) return { installed: false, line: market ? "not installed" : "not installed (marketplace not added)" };
  /** @type {string[]} */
  const parts = [`${id} ${plugin.version}${plugin.enabled ? "" : " (disabled)"}`];
  const marketOk = market?.path === REPO;
  if (!marketOk) parts.push(market ? `marketplace points at ${market.path}` : "marketplace missing");
  const stale = plugin.version === pl.version && existsSync(plugin.installPath) && treeHash(pl.dir) !== treeHash(plugin.installPath);
  if (plugin.version !== pl.version) parts.push(`repo is ${pl.version}`);
  if (stale) parts.push("files changed without a version bump");
  return { installed: true, current: marketOk && plugin.version === pl.version && !stale && plugin.enabled, line: parts.join("; ") };
}

/** Drops legacy marketplaces nothing is installed from any more. @param {IO} io */
function dropLegacyMarkets(io) {
  const plugins = /** @type {ClaudePlugin[]} */ (JSON.parse(sh(io, "claude", ["plugin", "list", "--json"], { quiet: true }).stdout || "[]"));
  const markets = /** @type {ClaudeMarket[]} */ (JSON.parse(sh(io, "claude", ["plugin", "marketplace", "list", "--json"], { quiet: true }).stdout || "[]"));
  for (const m of LEGACY_MARKETS) {
    if (!markets.some((x) => x.name === m) || plugins.some((p) => p.id.endsWith(`@${m}`))) continue;
    sh(io, "claude", ["plugin", "marketplace", "remove", m], { quiet: true, allowFail: true });
    io.say(`    removed old marketplace ${m}`);
  }
}

/** @param {IO} io @param {Plugin} pl @param {{ force?: boolean }} opts */
function claudeInstall(io, pl, { force }) {
  const id = `${pl.pkg}@${MARKETPLACE}`;
  let { plugin, market, legacy } = claudeState(io, pl);
  for (const p of legacy) {
    sh(io, "claude", ["plugin", "uninstall", p.id], { quiet: true, allowFail: true });
    io.say(`    removed old ${p.id}`);
  }
  dropLegacyMarkets(io);
  if (market && market.path !== REPO) {
    io.say(`    repointing marketplace ${MARKETPLACE}: ${market.path} → ${REPO}`);
    sh(io, "claude", ["plugin", "marketplace", "remove", MARKETPLACE]);
    market = null;
    plugin = claudeState(io, pl).plugin;
  }
  if (!market) sh(io, "claude", ["plugin", "marketplace", "add", REPO]);
  else sh(io, "claude", ["plugin", "marketplace", "update", MARKETPLACE]);

  if (plugin && plugin.version === pl.version && existsSync(plugin.installPath)
      && treeHash(pl.dir) !== treeHash(plugin.installPath) && !force) {
    io.die(`${pl.name}: Claude plugin files changed but the version is still ${pl.version}; Claude keeps its cached copy.\n`
      + `  Run: ./install.sh bump ${pl.name} patch   (or pass --force to reinstall at the same version)`);
  }
  if (!plugin) sh(io, "claude", ["plugin", "install", id]);
  else if (force && plugin.version === pl.version) {
    sh(io, "claude", ["plugin", "uninstall", id]);
    sh(io, "claude", ["plugin", "install", id]);
  } else if (plugin.version !== pl.version) sh(io, "claude", ["plugin", "update", id]);
  else { io.say(io.dim(`    ${id} ${plugin.version} already current`)); if (plugin.enabled) return; }
  if (plugin && !plugin.enabled) sh(io, "claude", ["plugin", "enable", id]);
  io.say(`    ${io.ok(`${id} ${pl.version}`)} (restart Claude sessions to load hook changes)`);
}

/** @param {IO} io @param {Plugin} pl */
function claudeUninstall(io, pl) {
  const id = `${pl.pkg}@${MARKETPLACE}`;
  const { plugin, legacy } = claudeState(io, pl);
  if (plugin) { sh(io, "claude", ["plugin", "uninstall", id], { quiet: true }); io.say(`    removed ${id}`); }
  for (const p of legacy) { sh(io, "claude", ["plugin", "uninstall", p.id], { quiet: true, allowFail: true }); io.say(`    removed old ${p.id}`); }
  dropLegacyMarkets(io);
  // The marketplace goes once none of this repo's plugins are installed from it.
  const { plugins, market } = claudeState(io, pl);
  if (market && !plugins.some((p) => p.id.endsWith(`@${MARKETPLACE}`))) {
    sh(io, "claude", ["plugin", "marketplace", "remove", MARKETPLACE], { quiet: true });
    io.say(`    removed marketplace ${MARKETPLACE}`);
  }
}

// ---------------------------------------------------------------- pi

/** A pi `packages` entry: a path string, or {source, extensions…}. @typedef {string | { source?: string, [kind: string]: any }} PiRaw */
/** @param {PiRaw} p @returns {string | null} */
const piSource = (p) => (typeof p === "string" ? p : typeof p?.source === "string" ? p.source : null);
/** @param {string} src */
const piAbs = (src) => resolve(dirname(PI_SETTINGS), src.replace(/^~(?=[\\/])/, homedir()));

/** pi settings entries that are this plugin: its folder, a package of the same (or an old) name,
 *  or one of the folders it lived in before plugins/. @param {Plugin} pl @returns {PiEntry[]} */
function piEntries(pl) {
  const names = [pl.pkg, ...pl.legacyNames];
  const oldHomes = [...names.map((n) => join(n, "integrations", "pi")), join("mods", "review", "integrations", "pi")];
  /** @type {{ packages?: PiRaw[] }} */
  const s = readJson(PI_SETTINGS);
  return (s?.packages ?? []).flatMap((p) => {
    const src = piSource(p);
    if (!src || /^(npm|git|https?|ssh):/.test(src)) return [];
    const abs = piAbs(src);
    const ours = abs === pl.dir || names.includes(readJson(join(abs, "package.json"))?.name) || oldHomes.some((h) => abs.endsWith(h));
    return ours ? [{ raw: JSON.stringify(p), abs }] : [];
  });
}

/** @param {Plugin} pl @returns {Status} */
function piStatus(pl) {
  if (!existsSync(PI_SETTINGS)) return { installed: false, line: `no ${PI_SETTINGS}` };
  const entries = piEntries(pl);
  if (!entries.length) return { installed: false, line: "not in pi settings" };
  const dead = entries.flatMap((e) => deadFilters(pl, JSON.parse(e.raw)));
  if (entries.length === 1 && entries[0].abs === pl.dir && dead.length) return { installed: true, current: false, line: `filters name missing files: ${dead.join(", ")}` };
  const current = entries.length === 1 && entries[0].abs === pl.dir;
  return { installed: true, current, line: current ? `live from ${relative(REPO, pl.dir)}` : `entries: ${entries.map((e) => e.abs).join(", ")}` };
}

/** Removes matching entries from pi's settings directly: `pi remove` resolves relative paths
 *  against the cwd and can't match an entry whose folder is gone.
 *  @param {IO} io @param {Plugin} pl @param {(e: PiEntry) => boolean} pred */
function dropPiEntries(io, pl, pred) {
  const drop = new Set(piEntries(pl).filter(pred).map((e) => e.raw));
  if (!drop.size) return;
  /** @type {{ packages: PiRaw[] }} */
  const s = readJson(PI_SETTINGS);
  s.packages = s.packages.filter((p) => !drop.has(JSON.stringify(p)));
  writeJson(PI_SETTINGS, s);
  for (const raw of drop) io.say(`    removed pi entry ${raw}`);
}

/** An entry pointing at a folder that's gone now points at the plugin, keeping its shape (extension filters).
 *  @param {IO} io @param {Plugin} pl */
function repointPiEntries(io, pl) {
  if (piEntries(pl).some((e) => e.abs === pl.dir)) return;
  const old = piEntries(pl).find((e) => !existsSync(e.abs));
  if (!old) return;
  /** @type {{ packages: PiRaw[] }} */
  const s = readJson(PI_SETTINGS);
  const rel = relative(dirname(PI_SETTINGS), pl.dir);
  s.packages = s.packages.map((p) => JSON.stringify(p) !== old.raw ? p : typeof p === "string" ? rel : { ...p, source: rel });
  writeJson(PI_SETTINGS, s);
  io.say(`    pi entry ${old.abs} now points at ${pl.dir}`);
}

const PI_KINDS = ["extensions", "skills", "prompts", "themes"];
/** Exact-path filters (`+path`, `-path`) in an entry that name a file the package no longer has:
 *  a `+index.ts` left from before a move would load nothing. Globs are kept.
 *  @param {Plugin} pl @param {PiRaw} p @returns {string[]} */
function deadFilters(pl, p) {
  if (typeof p !== "object" || !p) return [];
  return PI_KINDS.flatMap((k) => (Array.isArray(p[k]) ? p[k] : []))
    .filter((f) => /^[+-]/.test(f) && !/[*?[]/.test(f) && !existsSync(join(pl.dir, f.slice(1))));
}

/** Drops dead filters from the plugin's entry; a filter list left empty goes too (so everything loads).
 *  @param {IO} io @param {Plugin} pl */
function fixPiFilters(io, pl) {
  /** @type {{ packages: PiRaw[] }} */
  const s = readJson(PI_SETTINGS);
  let changed = false;
  s.packages = s.packages.map((p) => {
    const src = piSource(p), dead = deadFilters(pl, p);
    if (!src || piAbs(src) !== pl.dir || !dead.length || typeof p !== "object") return p;
    const next = { ...p };
    for (const k of PI_KINDS) {
      if (!Array.isArray(next[k]) || !next[k].length) continue;
      next[k] = next[k].filter((f) => !dead.includes(f));
      if (!next[k].length) delete next[k];
    }
    io.say(`    dropped pi filters for files no longer in the package: ${dead.join(", ")}`);
    changed = true;
    // Nothing left but the source: the plain string form, which pi doesn't list as "(filtered)".
    return Object.keys(next).length === 1 ? next.source : next;
  });
  if (changed) writeJson(PI_SETTINGS, s);
}

/** @param {IO} io @param {Plugin} pl */
function piInstall(io, pl) {
  repointPiEntries(io, pl);
  dropPiEntries(io, pl, (e) => e.abs !== pl.dir);
  fixPiFilters(io, pl);
  if (!piEntries(pl).some((e) => e.abs === pl.dir)) sh(io, "pi", ["install", pl.dir], { quiet: true });
  io.say(`    ${io.ok(`pi loads ${relative(REPO, pl.dir)}`)} (restart pi sessions to reload)`);
}

/** @param {IO} io @param {Plugin} pl */
function piUninstall(io, pl) {
  dropPiEntries(io, pl, () => true);
}

// ---------------------------------------------------------------- per agent

/** @type {Record<Agent, { status: (io: IO, pl: Plugin) => Status, install: (io: IO, pl: Plugin, o: { force?: boolean }) => void, uninstall: (io: IO, pl: Plugin) => void }>} */
const IMPL = {
  claude: { status: claudeStatus, install: claudeInstall, uninstall: claudeUninstall },
  pi: { status: (_io, pl) => piStatus(pl), install: (io, pl) => piInstall(io, pl), uninstall: piUninstall },
};

/** @param {IO} io @param {Plugin} pl @param {Agent} a @returns {Status} */
const statusOf = (io, pl, a) => (hasAgent(a) ? IMPL[a].status(io, pl) : { installed: false, line: `${a} not on PATH` });

/** @param {IO} io @param {string | undefined} name @returns {Plugin[]} */
function pick(io, name) {
  const all = discover();
  if (!name) return all;
  const pl = all.find((p) => p.name === name || p.pkg === name);
  if (!pl) io.die(`unknown plugin '${name}' (plugins: ${all.map((p) => p.name).join(" | ") || "none"})`);
  return [pl];
}

/** @param {IO} io @param {Plugin} pl @param {string} appHome */
function checkRequires(io, pl, appHome) {
  for (const mod of pl.requires) {
    if (!existsSync(join(appHome, "mods", mod))) io.warn(`    needs the ${mod} mod, which isn't installed: ./install.sh install ${mod}`);
  }
}

/**
 * Whether any target of any plugin is installed (for the mod uninstaller's warning).
 * @param {IO} io @param {string} mod @returns {string[]} "<plugin> (<agent>)" entries that need it
 */
export function dependents(io, mod) {
  return discover().filter((pl) => pl.requires.includes(mod))
    .flatMap((pl) => pl.targets.filter((a) => statusOf(io, pl, a).installed).map((a) => `${pl.name} (${a})`));
}

// ---------------------------------------------------------------- commands

/**
 * With no name: refresh every plugin target that's installed (never adds one).
 * With a name: install it into `agent`, or every target whose agent is on PATH.
 * @param {IO} io @param {{ name?: string, agent?: Agent, force?: boolean, appHome: string }} o
 */
export function installPlugins(io, { name, agent, force, appHome }) {
  io.say("plugins:");
  let did = 0;
  for (const pl of pick(io, name)) {
    const targets = agent ? [agent] : pl.targets;
    for (const a of targets) {
      if (!pl.targets.includes(a)) { io.warn(`  ${pl.name}: no ${a} target`); continue; }
      if (!hasAgent(a)) { if (name) io.warn(`  ${pl.name} → ${a}: ${a} not on PATH; skipped`); continue; }
      if (!name && !IMPL[a].status(io, pl).installed) continue;
      io.say(`  ${pl.name} → ${a}`);
      checkRequires(io, pl, appHome);
      IMPL[a].install(io, pl, { force });
      did++;
    }
  }
  if (!did && !name) io.say(io.dim(`  nothing opted in; install one with: ./install.sh install plugins <${discover().map((p) => p.name).join("|")}> [claude|pi]`));
}

/** @param {IO} io @param {{ name?: string, agent?: Agent, mark: (s: Status) => string }} o @returns {boolean} all opted-in targets current */
export function statusPlugins(io, { name, agent, mark }) {
  let ok = true;
  for (const pl of pick(io, name)) {
    io.say(`  ${pl.name} ${io.dim(pl.version)}`);
    for (const a of pl.targets) {
      if (agent && a !== agent) continue;
      const s = statusOf(io, pl, a);
      if (s.installed && !s.current) ok = false;
      io.say(`    ${mark(s)} ${a.padEnd(6)} ${s.installed ? s.line : io.dim(`${s.line}`)}`);
    }
  }
  return ok;
}

/** @param {IO} io @param {{ name?: string, agent?: Agent }} o */
export function uninstallPlugins(io, { name, agent }) {
  io.say("plugins:");
  for (const pl of pick(io, name)) {
    for (const a of pl.targets) {
      if (agent && a !== agent) continue;
      if (!hasAgent(a) || !IMPL[a].status(io, pl).installed) continue;
      io.say(`  ${pl.name} → ${a}`);
      IMPL[a].uninstall(io, pl);
    }
  }
}

// ---------------------------------------------------------------- versions

/** @param {IO} io @param {string} name @param {string} kind patch | minor | major | x.y.z */
export function bumpPlugin(io, name, kind) {
  const [pl] = pick(io, name);
  const [a, b, p] = pl.version.split(".").map(Number);
  const v = /^\d+\.\d+\.\d+$/.test(kind) ? kind
    : /** @type {Record<string, string | undefined>} */ ({ major: `${a + 1}.0.0`, minor: `${a}.${b + 1}.0`, patch: `${a}.${b}.${p + 1}` })[kind];
  if (!v) io.die("bump <plugin> patch|minor|major|x.y.z");
  for (const f of ["package.json", join(".claude-plugin", "plugin.json")]) {
    const path = join(pl.dir, f), j = readJson(path);
    if (!j) continue;
    j.version = v;
    writeJson(path, j);
  }
  const m = readJson(MARKETPLACE_FILE);
  for (const e of m?.plugins ?? []) if (e.name === pl.pkg) e.version = v;
  if (m) writeJson(MARKETPLACE_FILE, m);
  io.say(`${pl.name} ${pl.version} → ${v}`);
}
