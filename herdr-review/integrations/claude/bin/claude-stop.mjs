// Claude Code Stop hook: remember Claude's last reply so the Herdr review pane can open it
// (ctrl-shift-r beside the agent). Inside herdr-app terminals only; prints nothing, never blocks.
/** Claude's stdin payload for a Stop hook: what the assistant just said, and Claude's transcript JSONL, where
 *  the full conversation (and so the last reply, past the tool blocks) is read from. */
/** @typedef {{ last_assistant_message?: string; transcript_path?: string }} ClaudeStopHook */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.HC_TERMINAL_ID) process.exit(0);
const appHome = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const bridgePath = join(appHome, "mods", "review", "bin", "bridge.mjs");

let input = "";
for await (const chunk of process.stdin) input += chunk;
/** @type {ClaudeStopHook} */
let hook = {};
try { hook = JSON.parse(input); } catch { process.exit(0); }

/** The assistant text written since the last prompt the person typed.
 *  @param {string} path @returns {string} */
function fromTranscript(path) {
  let lines;
  try { lines = readFileSync(path, "utf8").split("\n"); } catch { return ""; }
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.isSidechain) continue;
    const content = e.message?.content;
    if (e.type === "user") {
      // A real prompt (not a tool result) ends the turn.
      const isPrompt = typeof content === "string" || (Array.isArray(content) && content.some((c) => c.type === "text"));
      if (isPrompt && !e.isMeta) break;
      continue;
    }
    if (e.type === "assistant" && Array.isArray(content)) {
      const text = content.filter((c) => c.type === "text").map((c) => c.text).join("\n\n").trim();
      if (text) parts.unshift(text);
    }
  }
  return parts.join("\n\n");
}

const text = (typeof hook.last_assistant_message === "string" && hook.last_assistant_message.trim())
  ? hook.last_assistant_message
  : hook.transcript_path ? fromTranscript(hook.transcript_path) : "";
if (!text.trim()) process.exit(0);

try {
  const bridge = await import(pathToFileURL(bridgePath).href);
  bridge.recordReply(process.env.HC_TERMINAL_ID, "claude", text);
} catch {}
