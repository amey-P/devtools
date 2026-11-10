// Claude Code PermissionRequest hook for AskUserQuestion: the questions open in the Herdr app as a quick decision
// (options to click, Other, notes), and the answers go back to Claude as the tool's `answers`.
// Prints nothing (Claude's own question dialog shows) when not inside herdr-app, when the bridge is too old to know
// choices, or when the person dismisses it. Closing the window (✕, Esc) only puts it off: the hook keeps waiting.
//
// HERDR_REVIEW_ASK=deny: hand the answers back as a denial message instead (for Claude versions that don't take
// `answers` from a hook's updatedInput). The model reads them either way.
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const appHome = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const bridgePath = join(appHome, "mods", "review", "bin", "bridge.mjs");

let input = "";
for await (const chunk of process.stdin) input += chunk;

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
const out = (decision) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision },
}));

if (process.env.HERDR_REVIEW_ASK === "deny") {
  out({ behavior: "deny", message: "The user answered in the Herdr app (no need to ask again):\n"
    + bridge.answersText(bridge.normalizeQuestions(questions), answers, result.notes) });
} else {
  // AskUserQuestion takes the answers as input ({question text: answer}); notes travel as annotations.
  const annotations = {};
  for (const [q, n] of Object.entries(result.notes ?? {})) annotations[q] = { notes: n };
  out({ behavior: "allow", updatedInput: { ...hook.tool_input, answers,
    ...(Object.keys(annotations).length ? { annotations } : {}) } });
}
