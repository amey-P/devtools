#!/usr/bin/env node
// Ask the person to review a document in the Herdr app.
//
//   node review.mjs <file | -> [--title T] [--wait] [--place float|right|down|tab]
//
// Without --wait: opens the review pane beside this terminal and exits; the feedback is typed
// into this terminal later, as the next prompt.
// --place: where it opens this time (default: config.json's place, see config.mjs; float unless set).
// With --wait: blocks until the person decides and prints the feedback (or "LGTM") on stdout.
// Exit: 0 ok · 1 usage / unreadable file · 2 dismissed (or interrupted) · 3 not inside the Herdr app.
// Closing the window only puts the review off (it stays in the inbox, ctrl-shift-i); --wait keeps waiting.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openReview } from "./bridge.mjs";
import { PLACES } from "./config.mjs";

const args = process.argv.slice(2);
let wait = false, title = null, src = null, place = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--wait" || a === "-w") wait = true;
  else if (a === "--title" || a === "-t") title = args[++i] ?? null;
  else if (a === "--place" || a === "-p") { place = args[++i] ?? ""; if (!PLACES.includes(place)) usage(1); }
  else if (a.startsWith("--place=")) { place = a.slice(8); if (!PLACES.includes(place)) usage(1); }
  else if (a === "-h" || a === "--help") { usage(0); }
  else if (src === null) src = a;
  else usage(1);
}
function usage(code) {
  process.stderr.write("usage: review.mjs <file | -> [--title T] [--wait] [--place float|right|down|tab]\n");
  process.exit(code);
}
if (src === null) usage(1);

let content, file = null;
try {
  if (src === "-") {
    content = "";
    for await (const chunk of process.stdin) content += chunk;
  } else {
    file = resolve(src);
    content = readFileSync(file, "utf8");
  }
} catch (e) {
  process.stderr.write(`review: can't read ${src}: ${e.message}\n`);
  process.exit(1);
}
if (!content.trim()) { process.stderr.write("review: nothing to review (empty)\n"); process.exit(1); }

const r = await openReview({
  kind: "ask", mode: wait ? "decision" : "send", content, file, title, agent: null, place, handleSignals: wait,
});
if (!r) { process.stderr.write("review: not inside a Herdr app terminal; ask for feedback in chat instead.\n"); process.exit(3); }
if (!wait) { process.stdout.write("The review is open in Herdr. The feedback will arrive as the user's next message.\n"); process.exit(0); }
if (r.decision === "approve") { process.stdout.write((r.notes?.trim() ? r.notes.trim() : "LGTM") + "\n"); process.exit(0); }
if (r.decision === "deny") { process.stdout.write((r.feedback ?? "").trim() + "\n"); process.exit(0); }
process.stdout.write("dismissed\n");
process.exit(2);
