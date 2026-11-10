#!/usr/bin/env node
// Type-check every mod and the Node scripts with tsc (JSDoc types in plain .js; see tsconfig.mod.json).
//
//   npm run typecheck              every project
//   npm run typecheck -- review    only projects whose path contains "review"
//
// A mod is a folder with a tsconfig.json next to a main.js. Its gpui-kit.d.ts (the types of Herdr's
// built-in modules) is regenerated first with `herdr-app check`, from the Herdr that's installed, so it
// can't go stale. The repo root's tsconfig.json covers the Node scripts (*.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
const filter = process.argv[2] ?? "";

/** Folders under `dir` holding both a tsconfig.json and a main.js. @param {string} dir @returns {string[]} */
function findMods(dir) {
  /** @type {string[]} */
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (existsSync(join(p, "tsconfig.json")) && existsSync(join(p, "main.js"))) out.push(p);
    out.push(...findMods(p));
  }
  return out;
}

if (!existsSync(TSC)) {
  console.error("typescript isn't installed: run `npm install` at the repo root first.");
  process.exit(2);
}
const hasHerdr = spawnSync("herdr-app", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasHerdr) console.warn("warn: herdr-app not on PATH; using whatever gpui-kit.d.ts files are already there.\n");

const projects = [...findMods(ROOT), ROOT].filter((p) => relative(ROOT, p).includes(filter));
let failed = 0;
for (const dir of projects) {
  const name = relative(ROOT, dir) || "node scripts (*.mjs)";
  if (dir !== ROOT && hasHerdr) spawnSync("herdr-app", ["check", dir], { stdio: "ignore" });
  if (dir !== ROOT && !existsSync(join(dir, "gpui-kit.d.ts"))) {
    console.log(`✗ ${name}: no gpui-kit.d.ts (run \`herdr-app check ${relative(ROOT, dir)}\`)`);
    failed++;
    continue;
  }
  // Run from the repo root so tsc prints paths relative to it (clickable from here).
  const r = spawnSync(TSC, ["-p", join(dir, "tsconfig.json"), "--pretty", "false"], { cwd: ROOT, encoding: "utf8" });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.includes("error TS"));
  if (r.status === 0) { console.log(`✓ ${name}`); continue; }
  failed++;
  const untyped = lines.filter((l) => /error TS70\d\d/.test(l)).length;
  console.log(`✗ ${name}: ${lines.length} errors (${untyped} untyped, ${lines.length - untyped} other)`);
  for (const l of lines) console.log("    " + l);
}
console.log(failed ? `\n${failed} of ${projects.length} projects have errors.` : `\nAll ${projects.length} projects pass.`);
process.exit(failed ? 1 : 0);
