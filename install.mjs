#!/usr/bin/env node
// herdr-app devtools: install every Herdr mod, layout and integration in this repo.
// Node 18+, no other tools: works the same on macOS, Linux and Windows.
//
//   node install.mjs [command] [target] [plugin] [agent]
//     install    copy into Herdr's home (default command)
//     status     what's installed, and whether it matches the repo
//     watch      re-copy whenever a source file changes (Ctrl-C to stop)
//     uninstall  remove what this repo installed (layouts are left alone)
//   targets: all (default) | git | minimal | sidebar | usage | peruse | plugins | links
//   `all` is the Herdr mods and layouts only. plugins and links are opt-in and never part of it:
//   plugins  coding-agent plugins from plugins/ (see scripts/plugins.mjs):
//              install plugins <name> [claude|pi]   opt in (every agent on PATH, or one)
//              install plugins                      refresh the ones already installed
//              uninstall plugins [name] [claude|pi] opt out;  status plugins [name]
//              bump <name> patch|minor|major        after changing a plugin (Claude caches by version)
//   links    symlinks agents/ (pi and Claude statuslines, custom skills) into ~/.pi, ~/.claude
//            and ~/.agents (see scripts/links.mjs).
//   --force  reinstall a Claude plugin at the same version
//
// install.sh (macOS/Linux) and install.ps1 (Windows) bootstrap a clone and run this.
//
// Environment:
//   HERDR_APP_HOME   Herdr's home (default: what `herdr-app --help` reports, else ~/.config/herdr-app)
//
// Copies, not symlinks: Herdr neither hot-reloads nor loads mod assets (SVGs)
// through a symlinked mod folder. The repo stays the source of truth.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { keys } from "./scripts/keys.mjs";
import { installLinks, statusLinks, uninstallLinks } from "./scripts/links.mjs";
import { AGENTS, bumpPlugin, dependents, discover, installPlugins, statusPlugins, uninstallPlugins } from "./scripts/plugins.mjs";

const REPO = dirname(fileURLToPath(import.meta.url));
const WIN = platform() === "win32";
const TARGETS = ["git", "minimal", "sidebar", "usage", "peruse"]; // what `all` means

// ---------------------------------------------------------------- output

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
/** @type {(code: string) => (s: string) => string} */
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { ok: paint("32"), warn: paint("33"), err: paint("31"), dim: paint("2") };
/** @param {string} s */ const say = (s) => console.log(s);
/** @param {string} s */ const warn = (s) => console.error(c.warn(s));
/** @param {string} s @returns {never} */
const die = (s) => { console.error(c.err(`error: ${s}`)); process.exit(1); };

// ---------------------------------------------------------------- programs

/**
 * The full path of a program on PATH (PATHEXT on Windows), or null.
 * @param {string} cmd
 * @returns {string | null}
 */
export function which(cmd) {
  const exts = WIN ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
  for (const d of (process.env.PATH || "").split(delimiter)) {
    if (!d) continue;
    for (const e of WIN && /\.[a-z]+$/i.test(cmd) ? [""] : exts) {
      const p = join(d, cmd + e);
      try { if (statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}
/** @param {string} cmd */ const has = (cmd) => which(cmd) !== null;

/**
 * Runs a program without a shell; Windows .cmd/.bat shims go through cmd.exe, quoted.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ inherit?: boolean, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function run(cmd, args, { inherit = false, env } = {}) {
  const exe = cmd === process.execPath ? cmd : which(cmd) ?? cmd;
  const shim = WIN && /\.(cmd|bat)$/i.test(exe);
  /** @param {string} a */
  const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const r = shim
    ? spawnSync(`"${exe}" ${args.map(q).join(" ")}`, { shell: true, encoding: "utf8", stdio: inherit ? "inherit" : "pipe", env })
    : spawnSync(exe, args, { encoding: "utf8", stdio: inherit ? "inherit" : "pipe", env });
  return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
}

// ---------------------------------------------------------------- Herdr's home

/** @returns {string} */
function herdrHome() {
  if (process.env.HERDR_APP_HOME) return process.env.HERDR_APP_HOME;
  if (has("herdr-app")) {
    const m = /^Home:\s*(.+?)\s*(?:\(|$)/m.exec(run("herdr-app", ["--help"]).stdout);
    if (m) return m[1].replace(/^~(?=$|[\\/])/, homedir());
  }
  return join(homedir(), ".config", "herdr-app");
}
const HOME = herdrHome();

// ---------------------------------------------------------------- mirroring

// Files Herdr writes into a mod folder, plus junk: never copied, never deleted.
// tsconfig.json: dev-only type checking (npm run typecheck), never read by Herdr.
const EXCLUDES = ["jsconfig.json", "tsconfig.json", "*.d.ts", ".installed.json", ".DS_Store", "*.bak", ".gitignore"];

/**
 * @param {string} name
 * @param {string[]} patterns
 */
const excluded = (name, patterns) => patterns.some((p) => (p.startsWith("*") ? name.endsWith(p.slice(1)) : name === p));

/**
 * Relative paths of the files under dir (forward slashes), skipping excluded names at any depth.
 * @param {string} dir
 * @param {string[]} patterns
 * @returns {string[]}
 */
function files(dir, patterns) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (excluded(e.name, patterns)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** @param {string} p */
const digest = (p) => createHash("sha1").update(readFileSync(p)).digest("hex");
/** @param {string} a @param {string} b */
const same = (a, b) => { try { return statSync(a).size === statSync(b).size && digest(a) === digest(b); } catch { return false; } };
/** @param {string} p */
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

/**
 * What `mirror` would change: files to copy (new or different) and to delete.
 * @param {string} src
 * @param {string} dst
 * @param {string[]} patterns
 */
function plan(src, dst, patterns) {
  const want = files(src, patterns), have = files(dst, patterns);
  const copy = want.filter((f) => !same(join(src, f), join(dst, f)));
  const wanted = new Set(want);
  const remove = have.filter((f) => !wanted.has(f));
  return { copy, remove };
}

/**
 * Makes dst an exact copy of src (like rsync -a --delete), leaving excluded files alone.
 * @param {string} src
 * @param {string} dst
 * @param {string[]} patterns
 * @returns {number} files changed
 */
function mirror(src, dst, patterns) {
  if (isLink(dst)) unlinkSync(dst);
  mkdirSync(dst, { recursive: true });
  const { copy, remove } = plan(src, dst, patterns);
  for (const f of copy) { mkdirSync(dirname(join(dst, f)), { recursive: true }); copyFileSync(join(src, f), join(dst, f)); }
  for (const f of remove) rmSync(join(dst, f), { force: true });
  // Drop folders the deletes emptied.
  for (const f of remove) {
    let d = dirname(join(dst, f));
    while (d.startsWith(dst + sep) && readdirSync(d).length === 0) { rmdirSync(d); d = dirname(d); }
  }
  return copy.length + remove.length;
}

// ---------------------------------------------------------------- what each target holds

/** @typedef {{ name: string, src: string, exclude?: string[] }} ModSpec */
/** @typedef {{ src: string, dst: string, label: string }} FileSpec */
/** @typedef {{ key: string, cmd: object, replace?: object }} Binding */
/** @typedef {{ mods: ModSpec[], files?: FileSpec[], bindings?: Binding[], needsNode?: string }} Target */

/** @type {Record<"git" | "minimal" | "sidebar" | "usage", Target>} */
const SPEC = {
  git: {
    mods: [{ name: "git", src: "herdr-git", exclude: ["sync.sh", "test"] }],
    // The git view used to open as a split pane; it's now a section of the minimal layout's
    // sidebar, and this key opens the full view (with the graph) as a window. Only the old pane binding is migrated.
    bindings: [{ key: "ctrl-shift-g", cmd: { command: "mod.open", args: { name: "git" } },
      replace: { command: "pane.split", args: { direction: "right", mod: "git" } } }],
  },
  minimal: {
    mods: [{ name: "space-icons", src: "herdr-minimal/space-icons", exclude: ["geo", "test"] }], // geo/: generated icons
    files: [
      { src: "herdr-minimal/layouts/minimal.json", dst: "layouts/minimal.json", label: "layouts/minimal.json" },
      { src: "herdr-minimal/layouts/minimal.svg", dst: "layouts/minimal.svg", label: "layouts/minimal.svg" },
    ],
  },
  sidebar: { mods: [{ name: "space-tree", src: "herdr-sidebar/space-tree", exclude: ["geo", "test"] }] }, // geo/: generated icons
  usage: {
    mods: [{ name: "agent-usage", src: "herdr-usage/agent-usage" }, { name: "usage-settings", src: "herdr-usage/usage-settings" }],
    bindings: [{ key: "ctrl-shift-u", cmd: { command: "mod.open", args: { name: "usage-settings" } } }],
    needsNode: "the usage widget needs Node.js 18+ on PATH to read usage",
  },
};

/** @param {ModSpec} m */
const modPatterns = (m) => [...EXCLUDES, ...(m.exclude ?? [])];
const KEYS = join(HOME, "keys.json");

// herdr-peruse has its own installer (its mods, settings and CLI).
/** @param {string[]} args @param {boolean} [inherit] */
const peruse = (args, inherit = false) => run(process.execPath, [join(REPO, "herdr-peruse", "install.mjs"), ...args], { inherit, env: { ...process.env, HERDR_APP_HOME: HOME } });
/** Prints a peruse-installer result without its version header. @param {{ stdout: string, stderr: string }} r */
const relay = (r) => {
  const out = r.stdout.split(/\r?\n/).slice(1).filter(Boolean).join("\n");
  if (out) say(out);
  if (r.stderr.trim()) warn(r.stderr.trim());
};

/** @param {string} dir */
function herdrCheck(dir) {
  if (!has("herdr-app")) return;
  const r = run("herdr-app", ["check", dir]);
  if (r.code === 0) say(c.dim("        herdr-app check passed"));
  else { warn(`        herdr-app check failed for ${dir}:`); console.error((r.stdout + r.stderr).trim()); }
}

/** @param {ModSpec} m */
function syncMod(m) {
  const src = join(REPO, m.src), dst = join(HOME, "mods", m.name);
  if (!existsSync(src)) die(`no mod folder at ${src}`);
  if (isLink(dst)) say(`unlink  mods/${m.name} (was a symlink)`);
  mirror(src, dst, modPatterns(m));
  say(`synced  mods/${m.name}`);
  herdrCheck(dst);
}

/**
 * Copies one file. If Herdr changed its copy more recently (the theme picker
 * writes into layouts), adopts that copy back into the repo first and keeps
 * the old one as <src>.bak.
 * @param {FileSpec} f
 */
function syncFile(f) {
  const src = join(REPO, f.src), dst = join(HOME, f.dst);
  mkdirSync(dirname(dst), { recursive: true });
  if (isLink(dst)) unlinkSync(dst);
  if (existsSync(dst) && !same(src, dst) && statSync(dst).mtimeMs > statSync(src).mtimeMs) {
    say(`adopt   ${f.label} (changed in Herdr's home; old repo copy kept as ${f.src.split("/").pop()}.bak)`);
    copyFileSync(src, src + ".bak"); copyFileSync(dst, src); return;
  }
  if (!same(src, dst)) { copyFileSync(src, dst); say(`copied  ${f.label}`); }
}

/** @param {Binding} b */
function ensureBinding(b) {
  const args = ["ensure", b.key, JSON.stringify(b.cmd), ...(b.replace ? ["--replace", JSON.stringify(b.replace)] : [])];
  try { const out = keys(args, KEYS); if (out.startsWith("warn")) warn(out); else if (out) say(out); }
  catch (e) { warn(`  could not update keys.json: ${e.message}`); }
}

// ---------------------------------------------------------------- commands

/** @param {string} t */
function installTarget(t) {
  if (t === "links") { installLinks(say, warn); return; }
  if (t === "peruse") { say("peruse:"); relay(peruse(["install", "herdr"])); return; }
  const spec = SPEC[/** @type {keyof typeof SPEC} */ (t)];
  say(`${t}:`);
  if (spec.needsNode && !has("node")) warn(`  node not found on PATH; ${spec.needsNode} (installing anyway)`);
  for (const m of spec.mods) syncMod(m);
  for (const f of spec.files ?? []) syncFile(f);
  for (const b of spec.bindings ?? []) ensureBinding(b);
}

/**
 * @param {string} label
 * @param {string} state current | missing | anything else
 * @returns {boolean} current
 */
function show(label, state) {
  const mark = state === "current" ? c.ok("●") : state === "missing" ? c.warn("○") : c.warn("◐");
  say(`  ${mark} ${label.padEnd(22)} ${state}`);
  return state === "current";
}

/** @param {string} t */
function statusTarget(t) {
  if (t === "links") return statusLinks(show);
  let ok = true;
  if (t === "peruse") { const r = peruse(["status", "herdr"]); relay(r); return r.code === 0; }
  const spec = SPEC[/** @type {keyof typeof SPEC} */ (t)];
  for (const m of spec.mods) {
    const dst = join(HOME, "mods", m.name);
    let state;
    if (isLink(dst)) state = "symlink";
    else if (!existsSync(dst)) state = "missing";
    else { const p = plan(join(REPO, m.src), dst, modPatterns(m)); state = p.copy.length || p.remove.length ? "differs" : "current"; }
    ok = show(`mods/${m.name}`, state) && ok;
  }
  for (const f of spec.files ?? []) {
    const dst = join(HOME, f.dst);
    ok = show(f.label, isLink(dst) ? "symlink" : !existsSync(dst) ? "missing" : same(join(REPO, f.src), dst) ? "current" : "differs") && ok;
  }
  for (const b of spec.bindings ?? []) {
    let state;
    try { state = keys(["state", b.key, JSON.stringify(b.cmd)], KEYS); } catch { state = "unreadable"; }
    ok = show(`keys.json ${b.key}`, state) && ok;
  }
  return ok;
}

/** @param {string} t */
function uninstallTarget(t) {
  if (t === "links") { uninstallLinks(say); return; }
  if (t === "peruse") {
    say("peruse:");
    const on = dependents(IO, "peruse");
    if (on.length) warn(`  still installed and needing this mod: ${on.join(", ")} (remove with: uninstall plugins)`);
    relay(peruse(["uninstall", "herdr"]));
    return;
  }
  const spec = SPEC[/** @type {keyof typeof SPEC} */ (t)];
  for (const m of spec.mods) { rmSync(join(HOME, "mods", m.name), { recursive: true, force: true }); say(`removed mods/${m.name}`); }
  for (const b of spec.bindings ?? []) {
    try { const out = keys(["remove", b.key, JSON.stringify(b.cmd)], KEYS); if (out) say(out); } catch { /* unreadable keys.json: leave it */ }
  }
  if (t === "usage") say(c.dim("  kept data/agent-usage/ (your settings) and any keys.json.bak-usage-settings; delete them by hand if unwanted"));
}

/**
 * A fingerprint of every file's path and mtime under these folders.
 * @param {string[]} dirs
 */
const stamp = (dirs) => dirs.map((d) => files(d, [...EXCLUDES, "node_modules"]).map((f) => `${f}:${statSync(join(d, f)).mtimeMs}`).join("|")).join("#");

/** @param {string[]} targets */
function watch(targets) {
  /** @type {{ name: string, dirs: string[], sync: () => void, last: string }[]} */
  const jobs = [];
  for (const t of targets) {
    if (t === "links") { say(c.dim("links are symlinks: edits apply without a sync")); continue; }
    if (t === "peruse") {
      jobs.push({ name: t, dirs: ["mod", "mod-inbox", "mod-settings", "mod-compat"].map((d) => join(REPO, "herdr-peruse", d)), last: "",
        sync: () => relay(peruse(["sync", "herdr"])) });
      continue;
    }
    const spec = SPEC[/** @type {keyof typeof SPEC} */ (t)];
    const dirs = [...spec.mods.map((m) => join(REPO, m.src)), ...(spec.files ?? []).map((f) => dirname(join(REPO, f.src)))];
    jobs.push({ name: t, dirs: [...new Set(dirs)], last: "", sync: () => { for (const m of spec.mods) syncMod(m); for (const f of spec.files ?? []) syncFile(f); } });
  }
  for (const j of jobs) { j.sync(); j.last = stamp(j.dirs); }
  say(`watching ${jobs.map((j) => j.name).join(", ")} (Ctrl-C to stop)`);
  setInterval(() => {
    for (const j of jobs) {
      const now = stamp(j.dirs);
      if (now === j.last) continue;
      try { j.sync(); } catch (e) { warn(`sync failed (${e.message}); still watching`); }
      j.last = stamp(j.dirs);
    }
  }, 1000);
}

function usage() {
  const text = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  const end = text.findIndex((l) => l.startsWith("// Copies, not symlinks"));
  say(text.slice(1, end - 1).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}

/** What scripts/plugins.mjs prints and fails through. @type {import("./scripts/plugins.mjs").IO} */
const IO = { say, warn, ok: c.ok, dim: c.dim, die };
/** @param {{ installed: boolean, current?: boolean }} s */
const mark = (s) => (!s.installed ? c.dim("·") : s.current ? c.ok("●") : c.warn("◐"));

/**
 * The plugins target: `<cmd> plugins [name] [agent]`. The old `agents [claude|pi]` maps here.
 * @param {string} cmd @param {string[]} rest @param {boolean} legacy
 */
function pluginsCommand(cmd, rest, legacy) {
  const isAgent = (/** @type {string} */ a) => /** @type {readonly string[]} */ (AGENTS).includes(a);
  let [name, agent] = rest;
  if (legacy) { agent = name; name = undefined; warn("`agents` is now `plugins`: install plugins <name> [claude|pi]"); }
  else if (name && isAgent(name) && !agent) { agent = name; name = undefined; }
  if (agent && !isAgent(agent)) die(`unknown agent '${agent}' (${AGENTS.join(" | ")})`);
  const a = /** @type {"claude" | "pi" | undefined} */ (agent);
  switch (cmd) {
    case "install":
    case "sync": {
      const force = process.argv.includes("--force");
      // `install agents` used to opt into everything: name every plugin so it installs, not just refreshes.
      if (legacy) { for (const { name: n } of discover()) installPlugins(IO, { name: n, agent: a, force, appHome: HOME }); }
      else installPlugins(IO, { name, agent: a, force, appHome: HOME });
      say(c.ok("done"));
      return;
    }
    case "status":
      say("plugins:");
      process.exit(statusPlugins(IO, { name, agent: a, mark }) ? 0 : 2);
    case "uninstall":
      uninstallPlugins(IO, { name, agent: a });
      return;
    case "watch":
      say(c.dim("plugins: pi loads them live; for Claude, bump the version and run install plugins"));
      return;
    default:
      usage();
      process.exit(1);
  }
}

function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) die(`Node.js 18+ is required (this is ${process.version})`);
  const [cmd = "install", rawTarget = "all", ...rest] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const target = rawTarget === "review" ? "peruse" : rawTarget; // herdr-review was renamed herdr-peruse
  if (["-h", "--help", "help"].includes(process.argv[2] ?? "")) { usage(); return; }
  if (cmd === "bump") { bumpPlugin(IO, rawTarget, rest[0] ?? "patch"); return; }
  if (target === "plugins" || target === "agents") { pluginsCommand(cmd, rest, target === "agents"); return; }
  const valid = [...TARGETS, "plugins", "links"];
  if (target !== "all" && !valid.includes(target)) die(`unknown target '${target}' (all | ${valid.join(" | ")})`);
  if (rest.length) die(`unexpected '${rest.join(" ")}' after ${target}`);
  const targets = target === "all" ? TARGETS : [target];

  switch (cmd) {
    case "install":
    case "sync":
      if (!existsSync(HOME)) warn(`${HOME} doesn't exist yet (is the Herdr app installed?). Creating it.`);
      mkdirSync(join(HOME, "mods"), { recursive: true });
      mkdirSync(join(HOME, "layouts"), { recursive: true });
      say(c.dim(`herdr home: ${HOME}  (${process.platform})`));
      for (const t of targets) installTarget(t);
      say(c.ok("done"));
      break;
    case "status": {
      say(c.dim(`herdr home: ${HOME}`));
      let ok = true;
      for (const t of targets) ok = statusTarget(t) && ok;
      if (target === "all") say(c.dim("plugins and links are opt-in: status plugins | status links"));
      process.exit(ok ? 0 : 2);
    }
    case "watch":
      mkdirSync(join(HOME, "mods"), { recursive: true });
      watch(targets);
      break;
    case "uninstall":
      for (const t of targets) uninstallTarget(t);
      break;
    default:
      usage();
      process.exit(1);
  }
}

main();
