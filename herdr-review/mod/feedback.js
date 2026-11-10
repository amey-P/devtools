// Annotations -> the markdown the agent receives.
// An annotation: { id, block: index | null (general, or stale), type: "comment" | "delete" | "replace" | "general" | "choice", quote, text, stale? }
// A choice (a pick in a ```choice block, see blocks.js) also has {question, picked: [labels]}; its text is the picks joined.
import { plain } from "./blocks.js";

/** @param {string} s @param {number} [n] @returns {string} */
const clip = (s, n = 70) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};
/** @param {string} s @returns {string} */
const quoted = (s) => s.split("\n").map((l) => `> ${l}`).join("\n");
/** @param {string} s @returns {string} */
const fenced = (s) => {
  const ticks = /```/.test(s) ? "````" : "```";
  return `${ticks}\n${s}\n${ticks}`;
};

/**
 * Orders annotations as they appear in the plan, general ones last.
 * @param {import("./types").Annotation[]} anns @returns {import("./types").Annotation[]}
 */
export function ordered(anns) {
  return [...anns].sort((a, b) => (a.block ?? 1e9) - (b.block ?? 1e9) || a.created - b.created);
}

/** The wording, as in config.defaults.json `prompts.feedback` (the review passes the person's settings). */
export const LABELS = {
  intro: "I've reviewed {subject} and have {count} of feedback:",
  sections: { remove: "Remove this", change: "Change this", on: "Feedback on: \"{quote}\"", decision: "Decision: \"{quote}\"", general: "General feedback", generalOnly: "Feedback" },
};
/** @param {import("./types").Text} v @param {Record<string, string>} vars @returns {string} */
const fill = (v, vars) => (Array.isArray(v) ? v.join("\n") : String(v)).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));

/**
 * `subject`: what was reviewed, for the intro ("this plan", "`docs/spec.md`", "your last reply").
 * `intro`: a string, or (count) => string, replacing the intro. `labels`: {intro, sections}, see LABELS.
 */
/**
 * @param {import("./types").Annotation[]} anns
 * @param {import("./types").MarkdownOpts} [opts]
 */
export function toMarkdown(anns, { heading = "Plan Feedback", intro, subject = "this plan", labels = LABELS } = {}) {
  const sec = { ...LABELS.sections, ...labels?.sections };
  const list = ordered(anns).filter((a) => a.type !== "general" || a.text.trim());
  if (!list.length) return "";
  const specific = list.filter((a) => a.type !== "general");
  const general = list.filter((a) => a.type === "general");
  const out = [`# ${heading}`, ""];
  const pieces = `${list.length} piece${list.length === 1 ? "" : "s"}`;
  out.push(typeof intro === "function" ? intro(list.length) : fill(intro ?? labels?.intro ?? LABELS.intro, { subject, count: pieces }), "");
  specific.forEach((a, n) => {
    const q = a.quote ?? "";
    if (a.type === "choice") {
      out.push(`## ${n + 1}. ${fill(sec.decision ?? LABELS.sections.decision, { quote: clip(a.question ?? plain(q), 90) })}`, "",
        `**Picked:** ${(a.picked ?? []).join(", ") || a.text.trim()}`, "");
    } else if (a.type === "delete") {
      out.push(`## ${n + 1}. ${fill(sec.remove, {})}`, "", fenced(q), "");
      if (a.text.trim()) out.push(a.text.trim(), "");
    } else if (a.type === "replace") {
      out.push(`## ${n + 1}. ${fill(sec.change, {})}`, "", "**From:**", fenced(q), "", "**To:**", fenced(a.text.trim()), "");
    } else {
      out.push(`## ${n + 1}. ${fill(sec.on, { quote: clip(plain(q)) })}`, "", quoted(q), "", a.text.trim(), "");
    }
  });
  if (general.length) {
    out.push(`## ${fill(specific.length ? sec.general : sec.generalOnly, {})}`, "");
    for (const a of general) out.push(a.text.trim(), "");
  }
  out.push("---");
  return out.join("\n");
}
