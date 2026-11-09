// Claude Code PermissionRequest hook for ExitPlanMode: review the plan in the Herdr app.
// Prints nothing (Claude's normal prompt shows) when not inside herdr-app or when the
// person dismisses the review. Closing the window (✕, Esc) only puts it off: the hook keeps
// waiting until the person decides from the review inbox.
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const appHome = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const bridgePath = join(appHome, "mods", "review", "bin", "bridge.mjs");

let input = "";
for await (const chunk of process.stdin) input += chunk;

let hook = {};
try { hook = JSON.parse(input); } catch { process.exit(0); }
const plan = hook.tool_input?.plan;
if (typeof plan !== "string" || !plan.trim()) process.exit(0);

let bridge;
try { bridge = await import(pathToFileURL(bridgePath).href); } catch { process.exit(0); }

const out = (decision) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision },
}));

// What the agent is told comes from the review settings (bridge.prompts, newer bridges); the constants are the fallback.
const text = bridge.prompts?.() ?? { deny: bridge.DENY_PREFIX, approvedWithNotes: bridge.NOTES_PREFIX };

let result = null;
try {
  result = await bridge.requestReview({
    agent: "claude", plan, cwd: hook.cwd, session: hook.session_id, handleSignals: true,
  });
} catch { process.exit(0); }

if (!result || result.decision === "dismissed") process.exit(0);
if (result.decision === "approve") {
  // ExitPlanMode needs updatedInput with "allow", or Claude still shows its own plan dialog.
  // Leave plan mode into auto mode rather than Claude's default acceptEdits.
  out({
    behavior: "allow", updatedInput: hook.tool_input,
    updatedPermissions: [{ type: "setMode", mode: "auto", destination: "session" }],
  });
  // Claude's allow carries no message: queue the notes as the next prompt.
  if (result.notes?.trim()) bridge.sendLater(process.env.HC_TERMINAL_ID, text.approvedWithNotes + result.notes.trim());
} else {
  out({ behavior: "deny", message: text.deny + (result.feedback ?? "").trim() });
}
