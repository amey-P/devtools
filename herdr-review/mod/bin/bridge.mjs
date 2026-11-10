// Review bridge: agents and scripts ask the herdr-app `review` mod to show something for review.
//
// Kinds: plan (an agent's plan, from the Claude hook / pi submit_plan), ask (an agent ran bin/review.mjs),
//        choice (an agent asks the person to pick between options: Claude's AskUserQuestion, pi's ask_user, bin/ask.mjs),
//        file and reply (opened by the person from Herdr; they don't go through this bridge).
// Modes: decision (the caller waits for approve / deny) or send (feedback is typed into `target` later).
//
// Spool: <herdr-app home>/data/review/<id>/
//   request.json   {id, kind, mode, agent, terminal, target, cwd, title, content, file, session, version, created, space, tab,
//                   parent: {app, space_name, tab_name, name}, place, questions?}
//                  questions (choice): AskUserQuestion's shape, [{question, header, multiSelect, options: [{label, description, preview}]}]
//   meta.json      {pane, tab} or {overlay}   where the review opened (a split / tab, or a floating window)
// Arrival queue: <spool>/.float/<id>  every new review goes to the mod's launcher (mod.open review), which knows where the
//              person is and removes the marker. It answers in meta.json:
//                {overlay}           opened as a floating window (quietly: it doesn't take the keyboard)
//                {inbox: true}       config `arrive` is "inbox": a toast, and it waits in the inbox
//                {pill: true}        the person is on another workspace: a pill at the top waits for them (mod/pill.js)
//                {here: true, back}  a split / tab on the person's workspace: the bridge opens it, then gives focus
//                                    back to pane `back`
//   draft.json     the mod's unsent annotations
//   seen.json      {opened_at, deferred_at}: when the person opened it / closed it to come back later (the mod writes it)
//   decision.json  {decision: "approve" | "deny" | "dismissed", feedback, notes, at}   (the mod writes it)
//                  choice: {decision: "answer", answers: {[question]: "Label" | "A, B" | "free text"}, notes?: {[question]: text}, at}
//   cancelled      the caller stopped waiting (interrupted, or a newer request replaced this one)
// Replies: <herdr-app home>/data/review/replies/<terminal>.json  {agent, text, at}  (agent hooks write it)
//
// States (mod/ui.js readReview; the review inbox lists them): pending (decision mode, no decision.json, no cancelled),
// draft / open (send mode, with / without unsent notes), approved, changes, answered, sent, dismissed, replaced, interrupted.
// Closing an undecided review (✕, Esc) is "later": nothing is written but seen.json, and the caller keeps waiting.
// Only Dismiss (decision.json "dismissed") lets the caller fall back to its own prompt.
//
// openReview() resolves with the decision (decision mode), {decision: "opened", id} (send mode),
// or null when this isn't a herdr-app terminal (callers fall back to their normal flow).
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { loadConfig, text } from "./config.mjs";

export const APP_HOME = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
export const SPOOL = join(APP_HOME, "data", "review");
export const REPLIES = join(SPOOL, "replies");
export const FLOAT_QUEUE = join(SPOOL, ".float");
const MOD = "review";
const POLL_MS = 400;

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), err }));
  });
}

let appBin = null;
async function herdrApp(args) {
  const candidates = appBin ? [appBin] : ["herdr-app", join(homedir(), ".local", "bin", "herdr-app"), "/usr/local/bin/herdr-app"];
  let last = null;
  for (const bin of candidates) {
    const r = await run(bin, args);
    if (r.err?.code === "ENOENT") { last = r; continue; }
    appBin = bin;
    return r;
  }
  return last ?? { ok: false, stdout: "", stderr: "herdr-app not found", err: new Error("herdr-app not found") };
}

const doCmd = (name, args) => herdrApp(["do", name, JSON.stringify(args)]);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The first `# heading` of a document, else its first line. */
export function docTitle(text, fallback = "Plan") {
  const h = /^ {0,3}#\s+(.+?)\s*#*\s*$/m.exec(text ?? "");
  if (h) return h[1].replace(/^Plan:\s*/i, "");
  return ((text ?? "").split("\n").find((l) => l.trim()) ?? fallback).trim().slice(0, 80) || fallback;
}
export const planTitle = (plan) => docTitle(plan, "Plan");

function findTerminal(ls, terminal) {
  for (const space of ls?.spaces ?? []) {
    for (const tab of space.tabs ?? []) {
      for (const t of tab.terminals ?? []) {
        if (t.terminal === terminal) return { space, tab, entry: t };
        for (const s of t.sub_agents ?? []) {
          const addr = typeof s === "string" ? s : s.terminal;
          if (addr === terminal) return { space, tab, entry: null };
        }
      }
    }
  }
  return null;
}

const isDone = (dir) => existsSync(join(dir, "decision.json")) || existsSync(join(dir, "cancelled"));

/** Earlier reviews of this kind from this terminal. */
function earlierFor(terminal, kind) {
  if (!existsSync(SPOOL)) return [];
  const out = [];
  for (const id of readdirSync(SPOOL)) {
    if (!id.startsWith("rv-") && !id.startsWith("pr-")) continue;
    const dir = join(SPOOL, id);
    const req = readJson(join(dir, "request.json"));
    if (!req || req.terminal !== terminal || (req.kind ?? "plan") !== kind) continue;
    out.push({ id, dir, req, done: isDone(dir) });
  }
  return out.sort((a, b) => a.req.created - b.req.created);
}

/** Drops finished reviews older than a week (send-mode reviews: untouched for a week; undecided ones: past the
 *  Claude hook's 4-day wait plus a margin, when nothing can be waiting on them any more). */
function gc() {
  if (!existsSync(SPOOL)) return;
  const old = Date.now() - 7 * 86400e3;
  for (const id of readdirSync(SPOOL)) {
    if (id === "replies" || id === ".float") continue;
    const dir = join(SPOOL, id);
    try {
      const req = readJson(join(dir, "request.json"));
      const done = isDone(dir) || req?.mode === "send" || id.startsWith(".send-") || id.startsWith("pane-");
      if (done && statSync(dir).mtimeMs < old) rmSync(dir, { recursive: true, force: true });
      else if (!done && /^(rv|pr)-/.test(id) && req?.created < Date.now() - 6 * 86400e3) rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

async function closePane(dir) {
  const meta = readJson(join(dir, "meta.json"));
  if (meta?.overlay) await doCmd("overlay.close", { id: meta.overlay });
  else if (meta?.pane) await doCmd("pane.close", { pane: meta.pane });
}

/** Hands review `id` to the mod's launcher; its answer (meta.json, see the top of this file), or null. */
async function openViaLauncher(id, dir) {
  mkdirSync(FLOAT_QUEUE, { recursive: true });
  const marker = join(FLOAT_QUEUE, id);
  writeFileSync(marker, String(Date.now()));
  // mod.open toggles: a launcher still open from a racing call would close instead, so try twice.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await doCmd("mod.open", { name: MOD });
    if (r.ok) {
      for (let waited = 0; waited < 1500; waited += 100) {
        const meta = answered(dir);
        if (meta) return meta;
        await sleep(100);
      }
    }
  }
  rmSync(marker, { force: true });
  return answered(dir);
}

function answered(dir) {
  const meta = readJson(join(dir, "meta.json"));
  return meta?.overlay || meta?.inbox || meta?.pill || meta?.here ? meta : null;
}

/** Opens review `id` where `place` says; falls back to a split, then a tab. False when nothing opened. */
async function openPlaced(where, id, dir, kind, place, arrive) {
  // The launcher decides (it sees where the person is): a window, a toast, a pill, or "here" for a split / tab.
  const meta = await openViaLauncher(id, dir);
  if (meta && !meta.here) return true;
  // "here": open beside the agent without moving the person's focus. No answer: the old way (show and focus).
  const gentle = !!meta?.here;
  const props = gentle ? { id, gentle: true } : { id };
  if (place !== "tab" && where.entry?.pane) {
    // Not gentle: show and focus the caller's own pane first, so the split can't land beside
    // whatever pane the person happens to be working in. Gentle: the pane is given, so no need.
    if (!gentle) await doCmd("pane.focus", { pane: where.entry.pane });
    const opened = await doCmd("pane.split", { pane: where.entry.pane, direction: place === "down" ? "down" : "right", mod: MOD, props });
    if (opened.ok && await recordOpened(dir, opened, gentle ? meta.back : undefined)) return true;
  }
  const opened = await doCmd("tab.new", { space: where.space.id, mod: MOD, props, name: TAB_NAMES[kind] ?? "Review" });
  return opened.ok && await recordOpened(dir, opened, gentle ? meta.back : undefined);
}

/** Records where the review opened. `back` (gentle): give focus back to that pane instead of focusing the review. */
async function recordOpened(dir, opened, back) {
  let made = {};
  try { made = JSON.parse(opened.stdout); } catch {}
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ pane: made.pane ?? null, tab: made.tab ?? null }));
  if (back !== undefined) { if (back) await doCmd("pane.focus", { pane: back }); }
  else if (made.pane) await doCmd("pane.focus", { pane: made.pane });
  return true;
}

function cancel(dir, reason) {
  try { writeFileSync(join(dir, "cancelled"), reason); } catch {}
}

const TAB_NAMES = { plan: "Plan review", ask: "Review", choice: "Decision", file: "Review", reply: "Review" };

// ---- choices -------------------------------------------------------------------

/** Keeps the questions the review can show (AskUserQuestion's shape): each needs text and at least one option. */
export function normalizeQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  return questions.map((q) => ({
    question: str(q?.question),
    header: str(q?.header),
    multiSelect: !!q?.multiSelect,
    options: (Array.isArray(q?.options) ? q.options : [])
      .map((o) => (typeof o === "string" ? { label: o.trim() } : { label: str(o?.label), description: str(o?.description) || undefined, preview: str(o?.preview) || undefined }))
      .filter((o) => o.label),
  })).filter((q) => q.question && q.options.length);
}

/** The questions as markdown: the review's `content` (copy, the inbox, and anything that only reads text). */
export function questionsMarkdown(questions) {
  return questions.map((q) => [
    `## ${q.header ? `${q.header}: ` : ""}${q.question}`, "",
    ...q.options.map((o) => `- ${q.multiSelect ? "[ ] " : ""}**${o.label}**${o.description ? `: ${o.description}` : ""}`),
  ].join("\n")).join("\n\n");
}

/** The answers as markdown, for agents that take text (pi, the CLI's --text, Claude's fallback). */
export function answersText(questions, answers, notes) {
  return questions.map((q) => {
    const a = answers?.[q.question];
    const n = notes?.[q.question];
    return [`- ${q.question}`, `  → ${a?.trim() ? a.trim() : "(no answer)"}`, ...(n?.trim() ? [`  Note: ${n.trim().replace(/\n/g, "\n  ")}`] : [])].join("\n");
  }).join("\n");
}

/** Asks the person to choose (kind "choice"): waits for {decision: "answer", answers, notes} or "dismissed"; null when
 *  this isn't a Herdr app terminal or there's nothing to ask. */
export function askChoice({ questions, agent = null, title, cwd, session, place, signal, handleSignals = false }) {
  const qs = normalizeQuestions(questions);
  if (!qs.length) return Promise.resolve(null);
  const t = title || (qs.length === 1 ? (qs[0].header || qs[0].question) : `${qs.length} questions`);
  return openReview({ kind: "choice", mode: "decision", agent, questions: qs, content: questionsMarkdown(qs),
    title: t.length > 80 ? t.slice(0, 79) + "…" : t, cwd, session, place, signal, handleSignals });
}

/**
 * Opens a review for the calling terminal: a floating window, a split or a tab (config.mjs; `place` overrides). In decision mode, waits for the decision.
 * `handleSignals`: a standalone process (the Claude hook, the CLI) cancels the review when killed.
 * @param {{kind?: "plan"|"ask"|"choice", mode?: "decision"|"send", agent?: string, content: string, title?: string, questions?: object[],
 *          file?: string, cwd?: string, session?: string, target?: string, place?: "float"|"right"|"down"|"tab",
 *          signal?: AbortSignal, handleSignals?: boolean}} o
 */
export async function openReview({ kind = "plan", mode = "decision", agent = null, content, title, file = null, cwd, session,
  target, place, signal, handleSignals = false, questions }) {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal || !content?.trim()) return null;
  const lsr = await herdrApp(["ls"]);
  if (!lsr.ok) return null;
  let ls;
  try { ls = JSON.parse(lsr.stdout); } catch { return null; }
  const where = findTerminal(ls, terminal);
  if (!where) return null;

  gc();
  const cfg = loadConfig({ place });
  // A resubmission replaces the open review of the same terminal and kind.
  const earlier = earlierFor(terminal, kind);
  for (const p of earlier.filter((p) => !p.done)) { cancel(p.dir, "replaced"); await closePane(p.dir); }
  const version = earlier.filter((p) => (session ? p.req.session === session : true)).length + 1;

  const id = `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(SPOOL, id);
  mkdirSync(dir, { recursive: true });
  const request = {
    id, kind, mode, agent, terminal, target: target ?? terminal, cwd: cwd ?? process.cwd(),
    title: title || (file ? basename(file) : docTitle(content, kind === "plan" ? "Plan" : "Review")),
    content, file, session: session ?? null, version, created: Date.now(), space: where.space.id, tab: where.tab.id,
    // Who asked: shown in the review's header, and kept for when that agent is gone.
    parent: { app: where.entry?.app ?? null, space_name: where.space.name ?? null, tab_name: where.tab.name ?? null,
      name: where.entry?.name ?? null },
    place: cfg.window.place,
    ...(questions ? { questions } : {}),
  };
  writeFileSync(join(dir, "request.json"), JSON.stringify(request, null, 2));

  if (!(await openPlaced(where, id, dir, kind, cfg.window.place, cfg.window.arrive))) { cancel(dir, "could not open"); return null; }

  if (mode === "send") return { decision: "opened", id };

  const stop = (reason) => cancel(dir, reason);
  const onSignal = () => { stop("interrupted"); closePane(dir).finally(() => process.exit(130)); };
  const sigs = handleSignals ? ["SIGTERM", "SIGINT", "SIGHUP"] : [];
  for (const s of sigs) process.once(s, onSignal);
  try {
    for (;;) {
      if (signal?.aborted) { stop("interrupted"); await closePane(dir); throw new Error("aborted"); }
      if (existsSync(join(dir, "cancelled"))) return { decision: "dismissed" };
      const d = readJson(join(dir, "decision.json"));
      if (d?.decision) {
        // Let the pane show what was sent for a moment, then close it.
        setTimeout(() => closePane(dir), 900).unref?.();
        await sleep(950);
        return d;
      }
      await sleep(POLL_MS);
    }
  } finally {
    for (const s of sigs) process.off(s, onSignal);
  }
}

/** An agent's plan: waits for approve / deny. Kept for the Claude hook and the pi extension. */
export function requestReview({ agent, plan, cwd, title, session, place, signal, handleSignals = false }) {
  return openReview({ kind: "plan", mode: "decision", agent, content: plan, cwd, title, session, place, signal, handleSignals });
}

/** Records an agent's last reply so the review pane can open it (ctrl-shift-r). */
export function recordReply(terminal, agent, text) {
  if (!terminal || !text?.trim()) return;
  mkdirSync(REPLIES, { recursive: true });
  const file = join(REPLIES, `${terminal.replace(/[^\w.-]/g, "_")}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ agent, terminal, text, at: Date.now() }));
  renameSync(tmp, file);
}

/** Types `text` into a terminal (queued by the agent if it's busy), after `delayMs`, detached. */
export function sendLater(terminal, text, delayMs = 1500) {
  const hc = existsSync(join(homedir(), ".local", "bin", "hc")) ? join(homedir(), ".local", "bin", "hc") : "hc";
  const file = join(SPOOL, `.send-${Date.now().toString(36)}.txt`);
  mkdirSync(SPOOL, { recursive: true });
  writeFileSync(file, text);
  const child = spawn("sh", ["-c", `sleep ${delayMs / 1000}; "$0" send "$1" "$(cat "$2")"; rm -f "$2"`, hc, terminal, file],
    { detached: true, stdio: "ignore" });
  child.unref();
}

/** What the agent is told, from the settings (config.json `prompts`, see config.mjs): read on every call, so an edit
 *  applies to the next decision. `deny` goes before the feedback when a plan is sent back; `approvedWithNotes` before
 *  the notes on an approved plan; `planMode` / `planOff` frame pi's plan mode (`tool`: its submit tool's name). */
export function prompts({ tool = "submit_plan" } = {}) {
  const p = loadConfig().prompts;
  return { deny: text(p.deny), approvedWithNotes: text(p.approvedWithNotes),
    planMode: text(p.pi.planMode, { tool }), planOff: text(p.pi.planOff, { tool }) };
}
// Kept for integrations installed before prompts() (Claude caches its plugin per version).
export const DENY_PREFIX = prompts().deny;
export const NOTES_PREFIX = prompts().approvedWithNotes;
