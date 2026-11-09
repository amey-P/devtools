// Review settings: the merge rules, shared by the mod (ui.js) and node (bin/config.mjs, so the bridge, the hooks and
// the installer). No imports, so both runtimes can load it.
//
// Defaults: config.defaults.json (next to this file). The person's settings: <herdr-app home>/data/review/config.json,
// written by the Settings screen (settings.js) or `node install.mjs config`. It holds only what differs from the
// defaults, nested the same way. A value whose type doesn't match the default's, or that breaks a rule below, is ignored.
// Text values may be a string or an array of lines; text() joins them and fills {placeholders}.
// Legacy: the old flat keys (place, width, height, focus, arrive) are read as window.*.

export const PLACES = ["float", "right", "down", "tab"];
export const ARRIVALS = ["open", "inbox"];
export const SIDEBARS = ["auto", "open", "closed"];
export const LEGACY = { place: "window.place", width: "window.width", height: "window.height", focus: "window.focus", arrive: "window.arrive" };
export const SCHEMA_REF = "../../mods/review/config.schema.json";

const size = (n) => n > 0 && (n <= 1 || n >= 200);
const between = (lo, hi) => (n) => n >= lo && n <= hi;
const oneOf = (list) => (v) => list.includes(v);
/** Extra rules beyond "same type as the default", with what to say when one fails. */
export const RULES = {
  "window.place": [oneOf(PLACES), `one of ${PLACES.join(", ")}`],
  "window.arrive": [oneOf(ARRIVALS), `one of ${ARRIVALS.join(", ")}`],
  "window.width": [size, "px (200 or more) or a share of the window (0 to 1)"],
  "window.height": [size, "px (200 or more) or a share of the window (0 to 1)"],
  "ui.textSize": [(n) => n === 0 || (n >= 9 && n <= 24), "0 (the theme's size) or between 9 and 24"],
  "ui.contentWidth": [between(400, 4000), "between 400 and 4000"],
  "ui.sidebarWidth": [between(200, 800), "between 200 and 800"],
  "ui.sidebar": [oneOf(SIDEBARS), `one of ${SIDEBARS.join(", ")}`],
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function get(obj, path) {
  let o = obj;
  for (const k of path.split(".")) { if (!isObj(o)) return undefined; o = o[k]; }
  return o;
}
export function set(obj, path, value) {
  const ks = path.split(".");
  let o = obj;
  for (const k of ks.slice(0, -1)) { if (!isObj(o[k])) o[k] = {}; o = o[k]; }
  o[ks[ks.length - 1]] = value;
  return obj;
}
/** Removes `path`, and any objects it leaves empty. */
export function unset(obj, path) {
  const ks = path.split(".");
  const walk = (o, i) => {
    if (!isObj(o)) return;
    if (i === ks.length - 1) { delete o[ks[i]]; return; }
    walk(o[ks[i]], i + 1);
    if (isObj(o[ks[i]]) && !Object.keys(o[ks[i]]).length) delete o[ks[i]];
  };
  walk(obj, 0);
  return obj;
}

/** Every setting's dotted path, in the defaults' order. */
export function leaves(defaults, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(defaults)) {
    if (k.startsWith("$")) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) out.push(...leaves(v, p)); else out.push(p);
  }
  return out;
}

/** Why `value` can't be the setting at `path` (null when it can). */
export function problem(defaults, path, value) {
  const def = get(defaults, path);
  if (def === undefined || isObj(def)) return `unknown setting "${path}"`;
  if (isText(def)) { if (!isText(value)) return `${path} must be text`; }
  else if (typeof def === "number") { if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`; }
  else if (typeof value !== typeof def) return `${path} must be ${typeof def}`;
  const rule = RULES[path];
  if (rule && !rule[0](value)) return `${path} must be ${rule[1]}`;
  return null;
}

/** Parses a value typed as text (the CLI) into the setting's type; throws with what's allowed. */
export function parse(defaults, path, input) {
  const def = get(defaults, path);
  let v = input;
  if (typeof def === "number") v = Number(input);
  else if (typeof def === "boolean") {
    const s = String(input).toLowerCase();
    v = ["true", "1", "yes", "on"].includes(s) ? true : ["false", "0", "no", "off"].includes(s) ? false : input;
  } else if (typeof input === "string" && path in RULES) v = input.toLowerCase();
  const why = problem(defaults, path, v);
  if (why) throw new Error(why);
  return v;
}

/** The old flat keys, moved into `window` (a nested value wins). Returns a copy. */
export function migrate(raw) {
  const out = isObj(raw) ? JSON.parse(JSON.stringify(raw)) : {};
  for (const [flat, path] of Object.entries(LEGACY)) {
    if (!(flat in out)) continue;
    if (get(out, path) === undefined) set(out, path, out[flat]);
    delete out[flat];
  }
  return out;
}

/** The settings in effect: the defaults, with each valid value from `raw` (the person's config.json) on top. */
export function merge(defaults, raw) {
  const user = migrate(raw);
  const walk = (def, prefix) => {
    const out = {};
    for (const [k, d] of Object.entries(def)) {
      if (k.startsWith("$")) continue;
      const p = prefix ? `${prefix}.${k}` : k;
      if (isObj(d)) { out[k] = walk(d, p); continue; }
      const v = get(user, p);
      out[k] = v !== undefined && !problem(defaults, p, v) ? v : d;
    }
    return out;
  };
  return walk(defaults, "");
}

/** Where each setting comes from: "config" when config.json sets it (validly), else "default". */
export function sources(defaults, raw) {
  const user = migrate(raw);
  const out = {};
  for (const p of leaves(defaults)) {
    const v = get(user, p);
    out[p] = v !== undefined && !problem(defaults, p, v) ? "config" : "default";
  }
  return out;
}

/** What config.json should hold for settings `cfg`: only what differs from the defaults, plus `$schema`.
 *  `raw`: the current file; keys this version doesn't know are kept. */
export function toFile(defaults, cfg, raw = {}) {
  const known = new Set(leaves(defaults));
  const out = migrate(raw);
  for (const p of known) unset(out, p);
  for (const p of known) {
    const v = get(cfg, p);
    if (v !== undefined && !same(v, get(defaults, p))) set(out, p, v);
  }
  return { $schema: SCHEMA_REF, ...Object.fromEntries(Object.entries(out).filter(([k]) => k !== "$schema")) };
}

/** A text setting as one string, with {placeholders} filled from `vars` (unknown ones are left as they are). */
export function text(value, vars = {}) {
  const s = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}
