#!/usr/bin/env node
// Proves a change only touched comments (JSDoc types): each changed .js/.mjs file, with comments stripped and
// formatting normalized by the TypeScript printer, must be identical to the same file at <base>.
//
//   node scripts/same-runtime.mjs <base-ref> [path...]
//
// Without paths it checks every .js/.mjs file that differs from <base> (committed or not). Exit 0: all the same.
// Exit 1: lists each file whose code changed, with the first differing line. A deliberate code change (a rename,
// a guard) fails here by design: the orchestrator approves it explicitly instead.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ts = createRequire(import.meta.url)(join(ROOT, "node_modules", "typescript"));
const [base, ...paths] = process.argv.slice(2);
if (!base) { console.error("usage: node scripts/same-runtime.mjs <base-ref> [path...]"); process.exit(2); }

/** @param {string[]} args @returns {string} */
const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

/** Code with comments removed, printed in one canonical format. @param {string} name @param {string} text @returns {string} */
function normalize(name, text) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}

const files = paths.length ? paths
  : git(["diff", "--name-only", base, "--", "*.js", "*.mjs"]).split("\n").filter(Boolean);
let changed = 0;
for (const f of files) {
  const now = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), "utf8") : null;
  let before = null;
  try { before = git(["show", `${base}:${f}`]); } catch {}
  if (now === null || before === null) { console.log(`✗ ${f}: ${now === null ? "deleted" : "new file"}`); changed++; continue; }
  const a = normalize(f, before).split("\n"), b = normalize(f, now).split("\n");
  const i = a.findIndex((l, k) => l !== b[k]);
  if (i === -1 && a.length === b.length) { console.log(`✓ ${f}`); continue; }
  changed++;
  const k = i === -1 ? Math.min(a.length, b.length) : i;
  console.log(`✗ ${f}: code changed (normalized line ${k + 1})\n    before: ${(a[k] ?? "<end>").trim()}\n    after:  ${(b[k] ?? "<end>").trim()}`);
}
if (!files.length) console.log("no .js/.mjs changes");
process.exit(changed ? 1 : 0);
