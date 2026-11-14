#!/usr/bin/env node
// Ask the person a quick question in the Herdr app: options to click, and waits for the answer.
//
//   node ask.mjs "Which database?" -o Postgres -o "SQLite:zero setup" [--multi] [--header DB] [--title T] [--place P] [--text]
//   node ask.mjs spec.json | -                                                       [--title T] [--place P] [--text]
//
// The quick form asks one question; each -o is an option, "label:description" adds a description.
// A spec (a file, or stdin with -) asks several, in Claude's AskUserQuestion shape:
//   {"questions": [{"question": "…", "header": "DB", "multiSelect": false,
//                   "options": [{"label": "Postgres", "description": "…", "preview": "markdown shown beside the options"}]}]}
//   (a bare array of questions works too).
// The person can always answer "Other" with their own text, and add a note to any question.
// Prints the answers as JSON, {"<question>": "<label>" | "A, B" | "<their text>"}, plus "notes" when they wrote any;
// --text prints them as a markdown list instead.
// Exit: 0 answered · 1 usage / bad spec · 2 dismissed (or interrupted) · 3 not inside the Herdr app.
// Closing the window only puts the question off (it waits in the inbox, ctrl-shift-i): this keeps waiting.
/** @import { Place } from "../types.js" */

import { readFileSync } from "node:fs";
import { askChoice, answersText, normalizeQuestions } from "./bridge.mjs";
import { PLACES } from "./config.mjs";

const USAGE = "usage: ask.mjs \"question\" -o A -o B [--multi] [--header H] | ask.mjs <spec.json | ->   [--title T] [--place float|right|down|tab] [--text]\n";
/** @param {number} code */
const usage = (code) => { process.stderr.write(USAGE); process.exit(code); };

/** @param {string} msg */
const fail = (msg) => { process.stderr.write(`ask: ${msg}\n`); process.exit(1); };

const args = process.argv.slice(2);
let src = null, title = null, place = null, header = "", multi = false, asText = false;
const opts = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const val = () => { if (i + 1 >= args.length) usage(1); return args[++i]; };
  if (a === "-o" || a === "--option") opts.push(val());
  else if (a === "--multi" || a === "-m") multi = true;
  else if (a === "--header") header = val();
  else if (a === "--title" || a === "-t") title = val();
  // The one place assignment: the check on this line makes the stored value a place, so `place` stays
  // Place | null all the way into the askChoice() call (null = "use the settings").
  else if (a === "--place" || a === "-p") { place = /** @type {Place} */ (val()); if (!PLACES.includes(place)) usage(1); }
  else if (a === "--text") asText = true;
  else if (a === "-h" || a === "--help") usage(0);
  else if (src === null) src = a;
  else usage(1);
}
if (src === null) usage(1);

let questions;
if (opts.length) {
  questions = [{ question: src, header, multiSelect: multi, options: opts.map((o) => {
    const k = o.indexOf(":");
    return k > 0 ? { label: o.slice(0, k).trim(), description: o.slice(k + 1).trim() } : { label: o.trim() };
  }) }];
} else {
  let text;
  try {
    if (src === "-") { text = ""; for await (const chunk of process.stdin) text += chunk; }
    else text = readFileSync(src, "utf8");
  } catch (e) { fail(`can't read ${src}: ${e.message}`); }
  let spec;
  try { spec = JSON.parse(text); } catch (e) { fail(`the spec isn't JSON (${e.message}). For one question, pass options with -o.`); }
  questions = Array.isArray(spec) ? spec : spec?.questions;
}
const qs = normalizeQuestions(questions);
if (!qs.length) fail("nothing to ask: each question needs text and at least one option");

const r = await askChoice({ questions: qs, title, place, handleSignals: true });
if (!r) { process.stderr.write("ask: not inside a Herdr app terminal; ask in chat instead.\n"); process.exit(3); }
if (r.decision !== "answer") { process.stdout.write("dismissed\n"); process.exit(2); }
if (asText) process.stdout.write(answersText(qs, r.answers, r.notes) + "\n");
else process.stdout.write(JSON.stringify(r.notes ? { ...r.answers, notes: r.notes } : r.answers) + "\n");
process.exit(0);
