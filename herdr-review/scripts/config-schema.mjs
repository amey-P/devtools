// Regenerates mod/config.schema.json from mod/config.defaults.json (run after adding or changing a setting):
//   node scripts/config-schema.mjs
/** @import { RawTree, Text } from "../mod/types.js" */

/** A JSON-Schema node for one setting or heading (config.schema.json): a heading's object schema, or a leaf's
 *  type/enum/anyOf constraints. Carries the description, the default and the legacy-key metadata too. */
/** @typedef {object} Schema
 *  @property {string} [type]
 *  @property {boolean} [additionalProperties]
 *  @property {{ [k: string]: Schema }} [properties]
 *  @property {{ type: string }} [items]
 *  @property {Schema[]} [anyOf]
 *  @property {number} [const]
 *  @property {number} [minimum]
 *  @property {number} [maximum]
 *  @property {number} [exclusiveMinimum]
 *  @property {string[]} [enum]
 *  @property {string} [description]
 *  @property {Text | number | boolean} [default]
 *  @property {string} [$schema]
 *  @property {string} [title]
 *  @property {boolean} [deprecated] */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "mod");
const d = JSON.parse(readFileSync(join(dir, "config.defaults.json"), "utf8"));
const core = await import(join(dir, "config-core.js"));
const text = { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] };
const size = { type: "number", anyOf: [{ exclusiveMinimum: 0, maximum: 1 }, { minimum: 200 }] };
/** @type {Record<string, string>} */
const DESC = {
  window: "Where and how a review opens.",
  "window.place": "float: a floating window · right / down: a split beside the agent · tab: a new tab. $HERDR_REVIEW_PLACE and a per-review place override it.",
  "window.width": "Floating window width: px (200 or more), or a share of the Herdr window (0 to 1).",
  "window.height": "Floating window height: px (200 or more), or a share of the Herdr window (0 to 1).",
  "window.focus": "The review takes the keyboard when it opens.",
  "window.arrive": "open: a new review opens where place says · inbox: a toast, and it waits in the review inbox.",
  ui: "How the review and the inbox look.",
  "ui.font": "Font family for the review and inbox (\"\" = the theme's). Code blocks keep the theme's code font.",
  "ui.textSize": "Document text size in px (0 = the theme's). Notes and the sidebar scale with it.",
  "ui.contentWidth": "The widest the document column gets, in px.",
  "ui.sidebarWidth": "Width of the annotations sidebar, in px.",
  "ui.sidebar": "Whether the sidebar shows, until toggled (the toggle is remembered): auto opens it when the window is wide.",
  "ui.readingTime": "Show \"N min read\" above the document.",
  prompts: "What the agent is told. Text may be a string or an array of lines; {placeholders} are filled in.",
  "prompts.deny": "Before your feedback when a plan is sent back.",
  "prompts.approvedWithNotes": "Before your notes when a plan is approved with notes.",
  "prompts.feedback": "The feedback markdown.",
  "prompts.feedback.intro": "{subject}: what was reviewed · {count}: e.g. \"3 pieces\".",
  "prompts.feedback.plan": "For a plan.", "prompts.feedback.reply": "For an agent's last reply.",
  "prompts.feedback.file": "For a file or an agent's review request. {name}: file name or title · {path}: file path.",
  "prompts.feedback.sections": "Section headings, one per annotation.",
  "prompts.feedback.sections.on": "A comment. {quote}: the start of the annotated text.",
  "prompts.feedback.sections.decision": "A pick in a ```choice block. {quote}: its question.",
  "prompts.notes": "Approve with notes: the notes' heading and intro.",
  "prompts.pi": "pi's plan mode.",
  "prompts.pi.planMode": "Told to pi when plan mode starts. {tool}: the submit tool.",
  "prompts.pi.planOff": "Told to pi when plan mode ends.",
  "prompts.pi.approved": "Told to pi when its plan is approved (your notes follow). {path}: the plan file · {tool}: the submit tool.",
};
/** @type {Record<string, string[]>} */
const ENUMS = { "window.place": core.PLACES, "window.arrive": core.ARRIVALS, "ui.sidebar": core.SIDEBARS };
/** @type {Record<string, Schema>} */
const RANGES = { "ui.textSize": { anyOf: [{ const: 0 }, { minimum: 9, maximum: 24 }] }, "ui.contentWidth": { minimum: 400, maximum: 4000 }, "ui.sidebarWidth": { minimum: 200, maximum: 800 } };
/** Builds the schema subtree for a defaults value: headings recurse, leaves get their type, enum, range and
 *  description.
 *  @param {string | string[] | number | boolean | RawTree} v
 *  @param {string} path
 *  @returns {Schema} */
function node(v, path) {
  /** @type {Schema} */
  let s;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    s = { type: "object", additionalProperties: false, properties: {} };
    for (const [k, c] of Object.entries(v)) if (!k.startsWith("$")) s.properties[k] = node(c, path ? `${path}.${k}` : k);
  } else if (typeof v === "string" && (ENUMS[path] || path.startsWith("ui."))) s = { type: "string" };
  else if (typeof v === "string" || Array.isArray(v)) s = { ...text };
  else if (path === "window.width" || path === "window.height") s = { ...size };
  else s = { type: typeof v, ...(RANGES[path] ?? {}) };
  if (ENUMS[path]) s.enum = ENUMS[path];
  if (DESC[path]) s.description = DESC[path];
  if (!(v && typeof v === "object" && !Array.isArray(v))) s.default = /** @type {Text | number | boolean} */ (v);
  return s;
}
const root = node(d, "");
root.$schema = "http://json-schema.org/draft-07/schema#";
root.title = "herdr-review settings";
root.description = "<herdr-app home>/data/review/config.json. Holds only what differs from mods/review/config.defaults.json; the review's ⚙ Settings screen writes it.";
root.additionalProperties = true;
root.properties.$schema = { type: "string" };
for (const [flat, path] of Object.entries(core.LEGACY)) {
  const [g, k] = path.split(".");
  root.properties[flat] = { ...root.properties[g].properties[k], deprecated: true, description: `Old name for ${path}.` };
}
const ordered = { $schema: root.$schema, title: root.title, description: root.description, ...root };
writeFileSync(join(dir, "config.schema.json"), JSON.stringify(ordered, null, 2) + "\n");
console.log("ok");
