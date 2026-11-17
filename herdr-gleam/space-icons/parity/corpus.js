// Deterministic inputs for the goldens: names (corpus a/b), overrides texts, and the view matrix (c).
// Same code, same output: a fixed-seed PRNG drives every random choice. Changing this file changes
// the goldens; regenerate them with `npm run golden`.

/** mulberry32: the corpus's own PRNG (test infrastructure, not the oracle's). @param {number} a */
function prng(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHITESPACE = [" ", "\t", "\n", "\r", "\v", "\f", " ", " ", " ", " ", " ", " ", " ", " ", " ", "　", "﻿"];
const NOT_WHITESPACE = ["᠎", "​", "‍", "\u0085"];
const POOLS = {
  ascii: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./~ @#".split(""),
  ws: WHITESPACE.concat(NOT_WHITESPACE),
  emoji: ["🚀", "👩‍💻", "🏳️‍🌈", "❤️", "👍🏽", "🇮🇳", "🐈", "🧪"],
  cjk: ["漢", "字", "日", "本", "語", "한", "국", "中", "文", "ｱ"],
  combining: ["é", "ä", "́", "̈", "Å", "Å", "ñ"],
  special: ["İ", "ß", "Σ", "ς", "ΌΣΟΣ", "ǅ", "ﬁ", "K", "Ω", "ẞ", "Ⅻ", "ŉ"],
  lone: ["\ud800", "\udc00", "\udbff", "\udfff", "\udc00\ud800"],
};

/** Hand-picked names that must be in the corpus. */
export const FIXED_NAMES = [
  "", " ", "   ", "\t\n", "　", "﻿", " x ",
  "herdr-app", "Herdr-App", "  herdr-app  ", "HERDR-APP", "dotfiles", "notes-2026", "agentctl", "~",
  "a", "A", "z", "0", "-", "my repo", "My Repo", "my  repo",
  "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "Constructor", "  __proto__ ",
  "🚀", "👩‍💻 work", "日本語", "한국어", "中文 repo", "é", "é", "Å", "Å",
  "İstanbul", "STRASSE", "straße", "ΌΣΟΣ", "ǅ", "Kelvin",
  "\ud800", "\udc00", "x\ud800y", "\udc00\ud800", "\ud83d", "\ude80", "🚀\ud800",
  "᠎mongolian", "​zwsp", "\u0085nel", "tab\tinside", "line\nbreak",
  "a".repeat(200), "Z".repeat(64) + " " + "y".repeat(64),
];

/** @param {number} count */
export function names(count = 10_000) {
  const rnd = prng(0x5eed1234);
  const pick = (/** @type {string[]} */ xs) => xs[Math.floor(rnd() * xs.length)];
  const keys = /** @type {(keyof typeof POOLS)[]} */ (Object.keys(POOLS));
  const out = [...FIXED_NAMES];
  while (out.length < count) {
    // Mostly ASCII-ish repo names, with a share of every hard category.
    const main = rnd() < 0.55 ? "ascii" : pick(keys);
    const len = Math.floor(rnd() * 24);
    let s = "";
    for (let i = 0; i < len; i++) s += pick(POOLS[rnd() < 0.8 ? main : pick(keys)]);
    if (rnd() < 0.2) s = pick(WHITESPACE) + s;
    if (rnd() < 0.2) s = s + pick(WHITESPACE);
    if (rnd() < 0.15) s = s.toUpperCase();
    out.push(s);
  }
  return out;
}

/** JSON object text from raw [key, valueText] pairs (keeps "1.0", duplicates and order as written). @param {[string, string][]} entries */
export const objectText = (entries) => "{" + entries.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(",") + "}";

/** Value texts that exercise every decoding branch of iconFor. */
const VALUES = [
  `{"glyph":0}`, `{"glyph":63}`, `{"glyph":64}`, `{"glyph":-1}`, `{"glyph":1.5}`, `{"glyph":1.0}`, `{"glyph":2e0}`,
  `{"glyph":"rocket"}`, `{"glyph":"Rocket"}`, `{"glyph":"nope"}`, `{"glyph":""}`, `{"glyph":null}`, `{"glyph":true}`, `{"glyph":[1]}`,
  `{"seed":"abc"}`, `{"seed":"  "}`, `{"seed":""}`, `{"seed":" Mixed Seed "}`, `{"seed":5}`, `{"seed":null}`,
  `{"family":"tiles"}`, `{"family":"radial"}`, `{"family":"rings"}`, `{"family":"stripes"}`, `{"family":"orbit"}`, `{"family":"overlap"}`,
  `{"family":"Tiles"}`, `{"family":"nope"}`, `{"family":""}`, `{"family":3}`,
  `{"glyph":"cat","seed":"x","family":"orbit"}`, `{"glyph":"nope","seed":"y","family":"rings"}`, `{"glyph":7,"color":4,"extra":true}`,
  `null`, `"str"`, `7`, `true`, `[]`, `[{"glyph":1}]`, `{}`,
];

/**
 * The overrides.json text for corpus (a): every 7th name gets an override, its key written with
 * changed case and whitespace so the init's trim+lowercase matters. Normalized keys never collide
 * here (collisions are their own cases in overrideCases).
 * @param {string[]} ns
 */
export function corpusOverridesText(ns) {
  const rnd = prng(0x0e11);
  /** @type {Set<string>} */ const used = new Set();
  /** @type {[string, string][]} */ const entries = [];
  let v = 0;
  for (let i = 0; i < ns.length; i += 7) {
    const key = ns[i].trim().toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    let raw = rnd() < 0.5 ? ns[i].toUpperCase() : ns[i];
    if (raw.toLowerCase() !== ns[i].toLowerCase()) raw = ns[i]; // toUpperCase can change the lowercased key (ß, ΌΣΟΣ)
    if (rnd() < 0.3) raw = ` ${raw}\t`;
    entries.push([raw, VALUES[v++ % VALUES.length]]);
  }
  for (const k of ["__proto__", "constructor"]) if (!used.has(k)) entries.push([k, `{"glyph":"ghost","seed":"proto"}`]);
  return objectText(entries);
}

/**
 * Targeted override cases (phase 4 gate list): one name and one overrides.json text each.
 * `text: null` = no file; `fail: true` = the read rejects.
 * @type {{ note: string, name: string, text: string | null, fail?: boolean }[]}
 */
export const OVERRIDE_CASES = [
  { note: "no file", name: "repo", text: null },
  { note: "read fails", name: "repo", text: null, fail: true },
  { note: "glyph index", name: "repo", text: `{"repo":{"glyph":3}}` },
  { note: "glyph index 0", name: "repo", text: `{"repo":{"glyph":0}}` },
  { note: "glyph index last", name: "repo", text: `{"repo":{"glyph":63}}` },
  { note: "glyph index out of range", name: "repo", text: `{"repo":{"glyph":64}}` },
  { note: "glyph index negative", name: "repo", text: `{"repo":{"glyph":-1}}` },
  { note: "glyph 1.0 is an integer", name: "repo", text: `{"repo":{"glyph":1.0}}` },
  { note: "glyph 1.5 ignored", name: "repo", text: `{"repo":{"glyph":1.5}}` },
  { note: "glyph name", name: "repo", text: `{"repo":{"glyph":"rocket"}}` },
  { note: "glyph name wrong case", name: "repo", text: `{"repo":{"glyph":"Rocket"}}` },
  { note: "glyph name invalid", name: "repo", text: `{"repo":{"glyph":"nope"}}` },
  { note: "glyph bool ignored", name: "repo", text: `{"repo":{"glyph":true}}` },
  { note: "seed", name: "repo", text: `{"repo":{"seed":"other"}}` },
  { note: "seed kept untrimmed", name: "repo", text: `{"repo":{"seed":"  Other Seed "}}` },
  { note: "seed blank", name: "repo", text: `{"repo":{"seed":"   "}}` },
  { note: "seed empty", name: "repo", text: `{"repo":{"seed":""}}` },
  { note: "seed unicode blank", name: "repo", text: `{"repo":{"seed":"\\u3000\\u00a0"}}` },
  { note: "seed number ignored", name: "repo", text: `{"repo":{"seed":42}}` },
  { note: "family", name: "repo", text: `{"repo":{"family":"orbit"}}` },
  { note: "family unknown kept", name: "repo", text: `{"repo":{"family":"nope"}}` },
  { note: "family empty ignored", name: "repo", text: `{"repo":{"family":""}}` },
  { note: "color ignored at HEAD", name: "repo", text: `{"repo":{"color":4}}` },
  { note: "all three", name: "repo", text: `{"repo":{"glyph":"cat","seed":"s","family":"tiles"}}` },
  { note: "key trimmed and lowercased", name: "my repo", text: `{"  My Repo\\t":{"glyph":"cat"}}` },
  { note: "name trimmed and lowercased", name: "  MY REPO ", text: `{"my repo":{"glyph":"cat"}}` },
  { note: "value null", name: "repo", text: `{"repo":null}` },
  { note: "value string", name: "repo", text: `{"repo":"rocket"}` },
  { note: "value number", name: "repo", text: `{"repo":7}` },
  { note: "value array", name: "repo", text: `{"repo":[{"glyph":1}]}` },
  { note: "root array, index key", name: "0", text: `[{"glyph":"cat"}]` },
  { note: "root null", name: "repo", text: `null` },
  { note: "root string", name: "repo", text: `"repo"` },
  { note: "root number", name: "repo", text: `12` },
  { note: "root true", name: "repo", text: `true` },
  { note: "invalid json", name: "repo", text: `{"repo":` },
  { note: "empty text", name: "repo", text: `` },
  { note: "empty object", name: "repo", text: `{}` },
  { note: "__proto__ override", name: "__proto__", text: `{"__proto__":{"glyph":"ghost"}}` },
  { note: "constructor, no override", name: "constructor", text: `{"repo":{"glyph":1}}` },
  { note: "constructor override", name: "constructor", text: `{"constructor":{"glyph":"ghost"}}` },
  { note: "toString, no override", name: "toString", text: `{}` },
  { note: "collision: last written wins", name: "foo", text: `{"Foo":{"glyph":"cat"},"foo":{"glyph":"dog"}}` },
  { note: "collision: reversed", name: "foo", text: `{"foo":{"glyph":"dog"},"Foo":{"glyph":"cat"}}` },
  { note: "collision: index key sorts first", name: "1", text: `{"1 ":{"glyph":"cat"},"1":{"glyph":"dog"}}` },
  { note: "duplicate raw key", name: "repo", text: `{"repo":{"glyph":"cat"},"repo":{"glyph":"dog"}}` },
];

// --- view matrix (c) ------------------------------------------------------------------------

export const THEME_FULL = {
  accent: "#c6a0f6", chrome: "#1e2030", foreground: "#cad3f5", muted: "#a5adcb", dim: "#6e738d",
  selected: "#363a4f", border: "#494d64", surface: "#24273a", hover: "#2e3248",
  working: "#eed49f", blocked: "#ed8796", done: "#a6da95", unknown: "#8087a2", idle: "#5b6078",
};
/** No per-status colors: a loud dot falls back to `unknown`. */
export const THEME_NO_STATUS = Object.fromEntries(Object.entries(THEME_FULL).filter(([k]) => !["working", "blocked", "done", "idle"].includes(k)));

export const WINDOWS = {
  macos: { platform: "macos", titlebar: "none", buttons: true, fullscreen: false },
  "macos-fullscreen": { platform: "macos", titlebar: "none", buttons: true, fullscreen: true },
  linux: { platform: "linux", titlebar: "none", buttons: true, fullscreen: false },
  null: null,
};

/** Overrides for the view cases: one pinned glyph, one forced family + seed. */
export const VIEW_OVERRIDES = objectText([[" Pinned Space", `{"glyph":"rocket"}`], ["forced", `{"family":"rings","seed":"reroll"}`]]);

const AXES = {
  count: [1, 7],
  status: ["idle", "working", "blocked", "done", "weird-status"],
  active: [true, false],
  machine: [null, "vps"],
  icon: ["geo-ready", "geo-missing", "pinned"],
  window: Object.keys(WINDOWS),
  theme: ["full", "no-status"],
};

/** Greedy all-pairs over AXES (deterministic: first best candidate wins). */
export function pairwise() {
  const names = /** @type {(keyof typeof AXES)[]} */ (Object.keys(AXES));
  /** @type {Record<string, any>[]} */ let all = [{}];
  for (const n of names) all = all.flatMap((c) => AXES[n].map((v) => ({ ...c, [n]: v })));
  const key = (/** @type {string} */ a, /** @type {unknown} */ x, /** @type {string} */ b, /** @type {unknown} */ y) => JSON.stringify([a, x, b, y]);
  /** @type {Set<string>} */ const todo = new Set();
  names.forEach((a, i) => names.slice(i + 1).forEach((b) => AXES[a].forEach((x) => AXES[b].forEach((y) => todo.add(key(a, x, b, y))))));
  const covers = (/** @type {Record<string, any>} */ c) => {
    /** @type {string[]} */ const ks = [];
    names.forEach((a, i) => names.slice(i + 1).forEach((b) => ks.push(key(a, c[a], b, c[b]))));
    return ks;
  };
  /** @type {Record<string, any>[]} */ const out = [];
  while (todo.size) {
    let best = all[0], gain = -1;
    for (const c of all) {
      const g = covers(c).filter((k) => todo.has(k)).length;
      if (g > gain) (best = c), (gain = g);
    }
    covers(best).forEach((k) => todo.delete(k));
    out.push(best);
  }
  return out;
}

const SUBJECT_NAME = { "geo-ready": "alpha-repo", "geo-missing": "beta-repo", pinned: " Pinned Space" };
/** The 6 other spaces in a 7-space case: every status, machine and icon kind, none active. */
const OTHERS = [
  { name: "forced", status: "working", machine: null, ready: true },
  { name: "dotfiles", status: "blocked", machine: "vps", ready: true },
  { name: "notes", status: "done", machine: null, ready: false },
  { name: "日本語", status: "idle", machine: null, ready: true },
  { name: "🚀 launch", status: "weird-status", machine: "vps", ready: false },
  { name: "PINNED SPACE  ", status: "idle", machine: null, ready: true },
];

/**
 * The view cases: pairwise over AXES, plus every window x theme with no spaces.
 * @returns {{ id: string, spaces: import("./fakes/herdr.js").FakeSpace[], theme: Record<string,string>, window: object | null, overridesText: string | null, readyNames: string[] }[]}
 */
export function viewCases() {
  /** @type {ReturnType<typeof viewCases>} */ const out = [];
  for (const w of Object.keys(WINDOWS))
    for (const th of ["full", "no-status"])
      out.push({ id: `0-spaces/${w}/${th}`, spaces: [], theme: th === "full" ? THEME_FULL : THEME_NO_STATUS, window: /** @type {any} */ (WINDOWS)[w], overridesText: VIEW_OVERRIDES, readyNames: [] });
  pairwise().forEach((c, i) => {
    const subject = { id: "s-subject", name: SUBJECT_NAME[/** @type {keyof typeof SUBJECT_NAME} */ (c.icon)], status: c.status, active: c.active, machine: c.machine };
    const spaces = [subject];
    const readyNames = c.icon === "geo-ready" ? [subject.name] : [];
    if (c.count === 7) {
      const others = OTHERS.map((o, j) => ({ id: `s-${j}`, name: o.name, status: o.status, active: false, machine: o.machine }));
      spaces.splice(0, 1, ...others.slice(0, 3), subject, ...others.slice(3));
      readyNames.push(...OTHERS.filter((o) => o.ready).map((o) => o.name));
    }
    out.push({
      id: `pair-${String(i).padStart(2, "0")}/${c.count}/${c.status}/${c.active ? "active" : "inactive"}/${c.machine ?? "local"}/${c.icon}/${c.window}/${c.theme}`,
      spaces, theme: c.theme === "full" ? THEME_FULL : THEME_NO_STATUS, window: /** @type {any} */ (WINDOWS)[c.window], overridesText: VIEW_OVERRIDES, readyNames,
    });
  });
  return out;
}
