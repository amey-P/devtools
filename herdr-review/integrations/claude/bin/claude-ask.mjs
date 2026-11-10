// Claude Code PermissionRequest hook for AskUserQuestion: the questions open in the Herdr app as a quick decision
// (options to click, Other, notes), and the answers go back to Claude as the tool's `answers`.
// Prints nothing (Claude's own question dialog shows) when not inside herdr-app, when the bridge is too old to know
// choices, or when the person dismisses it. Closing the window (✕, Esc) only puts it off: the hook keeps waiting.
//
// HERDR_REVIEW_ASK=deny: hand the answers back as a denial message instead (for Claude versions that don't take
// `answers` from a hook's updatedInput). The model reads them either way.
/** Claude's stdin payload for a PermissionRequest hook: `tool_input` is the tool's input bag (the
 *  AskUserQuestion questions are inside it), `cwd` / `session_id` identify the asking session. Parsed straight
 *  from stdin, so tool_input stays an unknown-valued bag. */
/** @typedef {{ tool_input?: { [k: string]: unknown }; cwd?: string; session_id?: string }} ClaudeHook */

/** What this hook prints to stdout (the hookSpecificOutput payload Claude reads): a deny with a message, or an
 *  allow whose updatedInput carries the answers (and annotations, when the person attached notes). */
/** @typedef {{ behavior: "deny" | "allow"; message?: string; updatedInput?: { [k: string]: unknown } }} HookOut */

import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const appHome = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const bridgePath = join(appHome, "mods", "review", "bin", "bridge.mjs");

let input = "";
for await (const chunk of process.stdin) input += chunk;

/** @type {ClaudeHook} */
let hook = {};
try { hook = JSON.parse(input); } catch { process.exit(0); }
const questions = hook.tool_input?.questions;
if (!Array.isArray(questions) || !questions.length) process.exit(0);

let bridge;
try { bridge = await import(pathToFileURL(bridgePath).href); } catch { process.exit(0); }
if (typeof bridge.askChoice !== "function") process.exit(0);

let result = null;
try {
  result = await bridge.askChoice({ questions, agent: "claude", cwd: hook.cwd, session: hook.session_id, handleSignals: true });
} catch { process.exit(0); }
if (!result || result.decision !== "answer") process.exit(0);

const answers = result.answers ?? {};
/** @param {HookOut} decision */
const out = (decision) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision },
}));

if (process.env.HERDR_REVIEW_ASK === "deny") {
  out({ behavior: "deny", message: "The user answered in the Herdr app (no need to ask again):\n"
    + bridge.answersText(bridge.normalizeQuestions(questions), answers, result.notes) });
} else {
  // AskUserQuestion takes the answers as input ({question text: answer}); notes travel as annotations.
  /** Question text → the note the person attached to it. */
  /** @type {Record<string, { notes: string }>} */
  const annotations = {};
  for (const [q, n] of Object.entries(result.notes ?? {})) annotations[q] = { notes: n };
  out({ behavior: "allow", updatedInput: { ...hook.tool_input, answers,
    ...(Object.keys(annotations).length ? { annotations } : {}) } });
}
