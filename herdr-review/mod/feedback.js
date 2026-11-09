// Annotations -> the markdown the agent receives.
// An annotation: { id, block: index | null (general, or stale), type: "comment" | "delete" | "replace" | "general", quote, text, stale? }
import { plain } from "./blocks.js";

const clip = (s, n = 70) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};
const quoted = (s) => s.split("\n").map((l) => `> ${l}`).join("\n");
const fenced = (s) => {
  const ticks = /```/.test(s) ? "````" : "```";
  return `${ticks}\n${s}\n${ticks}`;
};

/** Orders annotations as they appear in the plan, general ones last. */
export function ordered(anns) {
  return [...anns].sort((a, b) => (a.block ?? 1e9) - (b.block ?? 1e9) || a.created - b.created);
}

/**
 * `subject`: what was reviewed, for the intro ("this plan", "`docs/spec.md`", "your last reply").
 * `intro`: a string, or (count) => string, replacing the default intro.
 */
export function toMarkdown(anns, { heading = "Plan Feedback", intro, subject = "this plan" } = {}) {
  const list = ordered(anns).filter((a) => a.type !== "general" || a.text.trim());
  if (!list.length) return "";
  const specific = list.filter((a) => a.type !== "general");
  const general = list.filter((a) => a.type === "general");
  const out = [`# ${heading}`, ""];
  const pieces = `${list.length} piece${list.length === 1 ? "" : "s"}`;
  out.push(typeof intro === "function" ? intro(list.length) : intro ?? `I've reviewed ${subject} and have ${pieces} of feedback:`, "");
  specific.forEach((a, n) => {
    const q = a.quote ?? "";
    if (a.type === "delete") {
      out.push(`## ${n + 1}. Remove this`, "", fenced(q), "");
      if (a.text.trim()) out.push(a.text.trim(), "");
    } else if (a.type === "replace") {
      out.push(`## ${n + 1}. Change this`, "", "**From:**", fenced(q), "", "**To:**", fenced(a.text.trim()), "");
    } else {
      out.push(`## ${n + 1}. Feedback on: "${clip(plain(q))}"`, "", quoted(q), "", a.text.trim(), "");
    }
  });
  if (general.length) {
    out.push(specific.length ? "## General feedback" : "## Feedback", "");
    for (const a of general) out.push(a.text.trim(), "");
  }
  out.push("---");
  return out.join("\n");
}
