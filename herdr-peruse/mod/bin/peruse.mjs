#!/usr/bin/env node
// Show a document in the Herdr app to read and annotate.
//
//   node peruse.mjs <file | -> [--title T] [--wait] [--place float|right|down|tab]     an agent publishes a document
//   node peruse.mjs open <file> [--title T] [--place float|right|down|tab]              the person opens any file
//
// Agents (the first form): a file opens as a document to read (kind doc), text on stdin as a review request (ask).
//   Without --wait: it opens and this exits; the person's notes are typed into this terminal later, as the next prompt.
//   With --wait: blocks until the person decides and prints the feedback (or "LGTM") on stdout.
//   Closing the window only puts it off (it stays in the inbox, ctrl-shift-i); --wait keeps waiting.
// The person (open): the file opens at once and reloads when it changes. Notes go to the agent in this tab; with no
//   agent there, Save notes appends them to <file>.notes.md.
// --place: where it opens this time (default: config.json's place, see config.mjs; float unless set).
// Exit: 0 ok · 1 usage / unreadable file · 2 dismissed (or interrupted) · 3 not inside the Herdr app.
/** @import { Place } from "../types.js" */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { openDoc } from "./bridge.mjs";
import { PLACES } from "./config.mjs";

const USAGE = "usage: peruse.mjs <file | -> [--title T] [--wait] [--place float|right|down|tab]\n"
  + "       peruse.mjs open <file> [--title T] [--place float|right|down|tab]\n";
/** @param {number} code @returns {never} */
function usage(code) {
  process.stderr.write(USAGE);
  process.exit(code);
}

const args = process.argv.slice(2);
const person = args[0] === "open";
if (person) args.shift();
let wait = false, title = null, src = null, place = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if ((a === "--wait" || a === "-w") && !person) wait = true;
  else if (a === "--title" || a === "-t") title = args[++i] ?? null;
  // Both place assignments are checked on their own line, so the stored value is provably a place; `place` then
  // stays Place | null into openDoc() (null = "use the settings").
  else if (a === "--place" || a === "-p") { place = /** @type {Place} */ (args[++i] ?? ""); if (!PLACES.includes(place)) usage(1); }
  else if (a.startsWith("--place=")) { place = /** @type {Place} */ (a.slice(8)); if (!PLACES.includes(place)) usage(1); }
  else if (a === "-h" || a === "--help") usage(0);
  else if (src === null) src = a;
  else usage(1);
}
if (src === null || (person && src === "-")) usage(1);

let content, file = null;
try {
  if (src === "-") {
    content = "";
    for await (const chunk of process.stdin) content += chunk;
  } else {
    file = resolve(src);
    if (!statSync(file).isFile()) throw new Error("not a file");
    content = readFileSync(file, "utf8");
  }
} catch (e) {
  process.stderr.write(`peruse: can't read ${src}: ${e.message}\n`);
  process.exit(1);
}
if (!content.trim()) { process.stderr.write("peruse: nothing to show (empty)\n"); process.exit(1); }

if (person) {
  const r = await openDoc({ kind: "file", mode: "send", content, file, title, agent: null, place, target: null, opener: "person" });
  if (!r) { process.stderr.write("peruse: not inside a Herdr app terminal.\n"); process.exit(3); }
  process.exit(0);
}

const r = await openDoc({
  kind: file ? "doc" : "ask", mode: wait ? "decision" : "send", content, file, title, agent: null, place, handleSignals: wait,
});
if (!r) { process.stderr.write("peruse: not inside a Herdr app terminal; ask for feedback in chat instead.\n"); process.exit(3); }
if (!wait) { process.stdout.write("It's open in Herdr. The user's notes will arrive as their next message.\n"); process.exit(0); }
if (r.decision === "approve") { process.stdout.write((r.notes?.trim() ? r.notes.trim() : "LGTM") + "\n"); process.exit(0); }
if (r.decision === "deny") { process.stdout.write((r.feedback ?? "").trim() + "\n"); process.exit(0); }
process.stdout.write("dismissed\n");
process.exit(2);
