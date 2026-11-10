// @ts-nocheck
// Herdr plan review for pi.
//
// Plan mode is on while mode-manager's mode is "plan" (`/mode plan`, Alt+M) or after `/plan` here.
// While planning: write/edit are limited to markdown files inside the working directory, and the
// model is told to write the plan to a file and call `submit_plan`. submit_plan opens the plan in a
// Herdr app pane beside this terminal (mods/review) and waits: approve ends planning, feedback
// comes back as the tool result so the model revises and submits again.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "@earendil-works/pi-ai";

const APP_HOME = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const BRIDGE = join(APP_HOME, "mods", "review", "bin", "bridge.mjs");
const MODE_CHANGED = "mode-manager:changed";
const MODE_REQUEST = "mode-manager:request";
const TOOL = "submit_plan";

// Fallbacks: the text normally comes from the review settings (bridge.prompts(), config.json `prompts`).
const FRAMING = [
  "You are in PLAN MODE. Deeply understand the problem and produce a plan for review before changing anything.",
  "- Explore the code thoroughly before proposing anything. Do not assume.",
  "- Writes and edits are limited to markdown files inside the working directory: only write the plan.",
  `- Write the plan to a markdown file (e.g. PLAN.md), then call ${TOOL} with its path.`,
  "- The user reviews it in the Herdr app and approves it or sends feedback.",
  "- Feedback is not failure: edit the same file to address ALL of it, then call submit_plan again.",
  "- Do not implement anything until submit_plan reports approval.",
].join("\n");
const PLAN_OFF = "Plan mode is over. You may now edit files and run commands normally.";

function insideCwd(path, cwd) {
  const full = resolve(cwd, path);
  const rel = relative(cwd, full);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
/** The review settings' agent text (null when the Herdr review isn't installed). Read on each use, so edits apply. */
async function prompts() {
  try { return (await import(pathToFileURL(BRIDGE).href)).prompts?.({ tool: TOOL }) ?? null; } catch { return null; }
}
const isPlanFile = (path, cwd) => /\.mdx?$/i.test(path ?? "") && insideCwd(path, cwd);

export default function (pi) {
  let modePlan = false;   // mode-manager says "plan"
  let ownPlan = false;    // toggled with /plan
  let approved = false;   // the plan was approved; planning stays off until it's entered again
  let framed = false;     // framing delivered for this planning phase
  let offNotice = false;  // tell the model planning ended, once

  const planning = () => (modePlan || ownPlan) && !approved;
  const status = (ctx) => ctx?.ui?.setStatus?.("herdr-plan", planning() ? "📝 plan → Herdr review" : undefined);
  const enter = () => { approved = false; framed = false; };
  const leave = () => { if (framed) offNotice = true; framed = false; };

  pi.events.on(MODE_CHANGED, (s) => {
    const p = s?.mode === "plan";
    if (p && !modePlan) enter();
    if (!p && modePlan && !ownPlan) leave();
    modePlan = p;
  });

  pi.on("session_start", async (_e, ctx) => {
    pi.events.emit(MODE_REQUEST, {
      action: "status",
      respond: (r) => { if (r?.status === "handled") { modePlan = r.result?.mode === "plan"; status(ctx); } },
    });
    status(ctx);
  });

  pi.registerCommand("plan", {
    description: "Toggle plan mode: plans are reviewed in a Herdr app pane before implementing",
    handler: async (_args, ctx) => {
      if (planning()) { ownPlan = false; approved = true; leave(); }
      else { ownPlan = true; enter(); }
      status(ctx);
      ctx.ui.notify(planning() ? "Plan mode on: the plan opens in Herdr for review." : "Plan mode off.", "info");
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!planning()) return;
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const path = event.input?.path;
    if (!isPlanFile(path, ctx.cwd)) {
      return { block: true, reason: `Plan mode: writes and edits are limited to markdown files inside the working directory. Blocked: ${path}` };
    }
  });

  pi.on("before_agent_start", async () => {
    if (planning() && !framed) {
      framed = true;
      const content = (await prompts())?.planMode ?? FRAMING;
      return { message: { customType: "herdr-review", content, display: false, details: { planning: true } } };
    }
    if (!planning() && offNotice) {
      offNotice = false;
      const content = (await prompts())?.planOff ?? PLAN_OFF;
      return { message: { customType: "herdr-review", content, display: false, details: { planning: false } } };
    }
  });

  // Remember the last reply, so the Herdr review pane can open it (ctrl-shift-r beside the agent).
  pi.on("agent_end", async (event) => {
    const terminal = process.env.HC_TERMINAL_ID;
    if (!terminal) return;
    const msgs = event?.messages ?? [];
    const parts = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.role === "user") break;
      if (m?.role !== "assistant") continue;
      const c = m.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x?.type === "text").map((x) => x.text).join("\n\n") : "";
      if (text.trim()) parts.unshift(text.trim());
    }
    if (!parts.length) return;
    try { (await import(pathToFileURL(BRIDGE).href)).recordReply(terminal, "pi", parts.join("\n\n")); } catch {}
  });

  pi.registerTool({
    name: "request_review",
    label: "Request review",
    executionMode: "sequential",
    description:
      "Ask the user to review and annotate a markdown/text file in the Herdr app (a draft, spec, design note, long answer). " +
      "Not for plans: use submit_plan in plan mode. With wait=true, blocks until the user sends feedback and returns it " +
      "(or LGTM). With wait=false, the review opens and you continue; the feedback arrives later as the user's next message.",
    parameters: Type.Object({
      filePath: Type.String({ description: "Path to the file to review, relative to the working directory." }),
      title: Type.Optional(Type.String({ description: "A short title for the review." })),
      wait: Type.Optional(Type.Boolean({ description: "Block until the user responds (default true)." })),
      place: Type.Optional(Type.Union(["float", "right", "down", "tab"].map((p) => Type.Literal(p)), {
        description: "Where the review opens. Leave it out to use the user's setting (a floating window unless they changed it).",
      })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const text = (t) => ({ content: [{ type: "text", text: t }], details: undefined });
      const path = String(params?.filePath ?? "").trim();
      const full = resolve(ctx.cwd, path);
      if (!path || !existsSync(full) || !statSync(full).isFile()) return text(`Error: ${path || "(nothing)"} does not exist.`);
      const content = readFileSync(full, "utf8");
      if (!content.trim()) return text(`Error: ${path} is empty.`);
      const wait = params?.wait !== false;
      let bridge;
      try { bridge = await import(pathToFileURL(BRIDGE).href); }
      catch { return text("The Herdr review isn't installed here. Ask the user for feedback in chat."); }
      let r;
      try {
        r = await bridge.openReview({ kind: "ask", mode: wait ? "decision" : "send", agent: "pi", content, file: full,
          title: params?.title, place: params?.place, cwd: ctx.cwd, signal });
      } catch (e) {
        if (signal?.aborted) return text("The review was interrupted.");
        throw e;
      }
      if (!r) return text("Not running inside the Herdr app. Ask the user for feedback in chat.");
      if (!wait) return text("The review is open in Herdr. Continue; the feedback will arrive as the user's next message.");
      if (r.decision === "approve") return text(r.notes?.trim() ? `The user approved, with notes:\n\n${r.notes.trim()}` : "LGTM: the user approved it without changes.");
      if (r.decision === "deny") return text(`The user's feedback:\n\n${(r.feedback ?? "").trim()}\n\nAddress all of it.`);
      return text("The user closed the review without responding. Ask them in chat how to proceed.");
    },
  });

  pi.registerTool({
    name: "ask_user",
    label: "Ask the user",
    executionMode: "sequential",
    description:
      "Ask the user one or more quick questions with options to pick, in the Herdr app (a decision between approaches, " +
      "a choice of library, which items to include). Blocks until they answer. They can always answer in their own words " +
      "(Other) and add a note. Use it instead of asking in prose when you have concrete options; keep options short and distinct.",
    parameters: Type.Object({
      questions: Type.Array(Type.Object({
        question: Type.String({ description: "The full question, ending with a question mark." }),
        header: Type.Optional(Type.String({ description: "A very short label for it (max 12 chars), e.g. \"Database\"." })),
        multiSelect: Type.Optional(Type.Boolean({ description: "Allow several options (default false)." })),
        options: Type.Array(Type.Object({
          label: Type.String({ description: "The option, 1-5 words." }),
          description: Type.Optional(Type.String({ description: "What picking it means, trade-offs." })),
          preview: Type.Optional(Type.String({ description: "Markdown shown beside the options while this one is focused (code, a mockup)." })),
        }), { minItems: 2, maxItems: 9 }),
      }), { minItems: 1, maxItems: 4 }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const text = (t) => ({ content: [{ type: "text", text: t }], details: undefined });
      let bridge;
      try { bridge = await import(pathToFileURL(BRIDGE).href); }
      catch { return text("The Herdr review isn't installed here. Ask the user in chat."); }
      if (typeof bridge.askChoice !== "function") return text("The installed Herdr review is too old for questions. Ask the user in chat.");
      let r;
      try {
        r = await bridge.askChoice({ questions: params?.questions, agent: "pi", cwd: ctx.cwd,
          session: ctx.sessionManager?.getSessionFile?.() ?? null, signal });
      } catch (e) {
        if (signal?.aborted) return text("The question was interrupted.");
        throw e;
      }
      if (!r) return text("Not running inside the Herdr app (or no valid questions). Ask the user in chat.");
      if (r.decision !== "answer") return text("The user dismissed the question without answering. Ask them in chat how to proceed.");
      return text(`The user answered:\n\n${bridge.answersText(bridge.normalizeQuestions(params?.questions), r.answers, r.notes)}`);
    },
  });

  pi.registerTool({
    name: TOOL,
    label: "Submit plan",
    executionMode: "sequential",
    description:
      "Submit your plan for the user's review in the Herdr app. Write the plan as a markdown file inside the working " +
      "directory first, then pass its path. Blocks until the user decides: approval means implement the plan now; " +
      "otherwise the result is their feedback: edit the same file to address all of it and call this again.",
    parameters: Type.Object({
      filePath: Type.String({ description: "Path to the markdown plan file, relative to the working directory (e.g. PLAN.md)." }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const path = String(params?.filePath ?? "").trim();
      const text = (t) => ({ content: [{ type: "text", text: t }], details: undefined });
      if (!isPlanFile(path, ctx.cwd)) return text(`Error: the plan must be a .md file inside the working directory. Got: ${path || "(nothing)"}`);
      const full = resolve(ctx.cwd, path);
      if (!existsSync(full) || !statSync(full).isFile()) return text(`Error: ${path} does not exist. Write the plan first, then call ${TOOL} again.`);
      const plan = readFileSync(full, "utf8");
      if (!plan.trim()) return text(`Error: ${path} is empty.`);

      let bridge;
      try { bridge = await import(pathToFileURL(BRIDGE).href); }
      catch { return text("The Herdr plan review isn't installed here. Show the user the plan path and ask them to review it in chat before implementing."); }

      let result;
      try {
        result = await bridge.requestReview({ agent: "pi", plan, cwd: ctx.cwd, session: ctx.sessionManager?.getSessionFile?.() ?? null, signal });
      } catch (e) {
        if (signal?.aborted) return text("The review was interrupted.");
        throw e;
      }
      if (!result) return text("Not running inside the Herdr app, so no review pane opened. Ask the user to review the plan in chat before implementing.");
      if (result.decision === "approve") {
        approved = true;
        ownPlan = false;
        leave();
        offNotice = false;
        status(ctx);
        const said = bridge.prompts?.({ tool: TOOL }) ?? { approvedWithNotes: bridge.NOTES_PREFIX, deny: bridge.DENY_PREFIX };
        const notes = result.notes?.trim() ? `\n\n${said.approvedWithNotes}${result.notes.trim()}` : "";
        return text(`Plan approved. Plan mode is over: implement the plan in ${path} now.${notes}`);
      }
      if (result.decision === "deny") return text((bridge.prompts?.({ tool: TOOL })?.deny ?? bridge.DENY_PREFIX) + (result.feedback ?? "").trim() + `\n\nEdit ${path}, then call ${TOOL} again.`);
      return text("The user dismissed the review without deciding. Ask them in chat how to proceed.");
    },
  });
}
