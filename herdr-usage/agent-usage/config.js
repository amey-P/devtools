// Usage config: defaults, merge, validation and the one write path, shared by the mod (main.js,
// settings.js). The person's settings live in <herdr app home>/data/agent-usage/config.json and hold
// only what differs from the defaults:
//   { scan: { everyMinutes, limitsEveryMinutes }, services: { <key>: { enabled?, hidden? } } }
// This file is the only place that interprets that file. scan.mjs never reads it: main.js works
// out the enabled services here and passes them as `scan.mjs --services a,b`.
// No imports: file access comes in through `io`, so a node test can stub it.

export const SCAN_DEFAULTS = { everyMinutes: 1, limitsEveryMinutes: 5 };
// limitsEveryMinutes ≥ 5: plan limits come from rate-limited server APIs (Claude, OpenCode Go).
export const RANGES = { everyMinutes: [1, 60], limitsEveryMinutes: [5, 60] };
// What a services.<key> override may set; everything else about a service is services.json's.
export const SERVICE_FIELDS = ["enabled", "hidden"];
export const SCHEMA_REF = "../../mods/agent-usage/config.schema.json";

// Used when services.json can't be read (keep in step with it).
export const DEFAULT_SERVICES = [
  { key: "claude", label: "Claude", icon: "icons/claude.svg", brand: "#d97757", enabled: true, program: "claude", apps: ["claude"] },
  { key: "codex", label: "Codex", icon: "icons/codex.svg", brand: "#7c8cf8", enabled: true, program: "codex", apps: ["codex"] },
  { key: "pi", label: "pi", icon: "icons/pi.svg", brand: "#4fb8b2", enabled: true, program: "pi", apps: ["pi"] },
  { key: "opencode-go", label: "Go", icon: "mods/agent-usage/icons/opencode.svg", brand: "#a78bfa", enabled: true, program: "opencode", apps: ["opencode"], api: true },
];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));

export const configDir = (appHome) => `${appHome}/data/agent-usage`;
export const configPath = (appHome) => `${configDir(appHome)}/config.json`;

/** Lenient parse of config.json text: { value } ({} when absent/blank) or { error }. */
export function parseRaw(text) {
  if (text == null || String(text).trim() === "") return { value: {} };
  try {
    const v = JSON.parse(text);
    return isObj(v) ? { value: v } : { error: "not a JSON object" };
  } catch (e) { return { error: String(e?.message || e) }; }
}

/** services.json text → its service list (DEFAULT_SERVICES when unreadable). */
export function parseServices(text) {
  try {
    const list = JSON.parse(text ?? "null")?.services;
    if (Array.isArray(list)) {
      const ok = list.filter((s) => isObj(s) && typeof s.key === "string" && s.key);
      if (ok.length) return ok;
    }
  } catch {}
  return DEFAULT_SERVICES;
}

/** The scan cadence from a raw config: whole minutes in range, anything else → the default. */
export function scanOf(raw) {
  const scan = {};
  for (const [k, range] of Object.entries(RANGES)) {
    const v = raw?.scan?.[k];
    scan[k] = isInt(v) ? clamp(v, range) : SCAN_DEFAULTS[k];
  }
  return scan;
}

/** A service's defaults (its services.json entry, before the person's overrides). */
export const serviceDefaults = (svc) => ({ enabled: svc?.enabled !== false, hidden: false });

/** { enabled, hidden } for a service: a boolean override wins, anything else is the default. */
export function serviceOf(svc, raw) {
  const def = serviceDefaults(svc);
  const over = raw?.services?.[svc.key];
  const out = {};
  for (const f of SERVICE_FIELDS) out[f] = typeof over?.[f] === "boolean" ? over[f] : def[f];
  return out;
}

/** Everything the widget and the settings page read: { scan, services: { key: {enabled, hidden} } }. */
export function effective(services, raw) {
  const out = { scan: scanOf(raw), services: {} };
  for (const svc of services) out.services[svc.key] = serviceOf(svc, raw);
  return out;
}

/** The default at `path` ("scan.everyMinutes", "services.<key>.hidden"). */
export function defaultAt(services, path) {
  const [head, key, field] = path.split(".");
  if (head === "scan") return SCAN_DEFAULTS[key];
  return serviceDefaults(services.find((s) => s.key === key))[field];
}

/** Why `value` can't be the setting at `path` — null when it can. */
export function problem(path, value) {
  const parts = path.split(".");
  if (parts[0] === "scan" && parts.length === 2) {
    const range = RANGES[parts[1]];
    if (!range) return `unknown setting "${path}"`;
    if (!isInt(value)) return "a whole number";
    if (value < range[0] || value > range[1]) return `between ${range[0]} and ${range[1]}`;
    return null;
  }
  if (parts[0] === "services" && parts.length === 3 && SERVICE_FIELDS.includes(parts[2]))
    return typeof value === "boolean" ? null : "true or false";
  return `unknown setting "${path}"`;
}

/** Paths whose value differs between two effective configs. */
export function changedPaths(a, b) {
  const out = [];
  for (const k of Object.keys(RANGES)) if (a.scan[k] !== b.scan[k]) out.push(`scan.${k}`);
  for (const key of new Set([...Object.keys(a.services), ...Object.keys(b.services)]))
    for (const f of SERVICE_FIELDS)
      if (a.services[key]?.[f] !== b.services[key]?.[f]) out.push(`services.${key}.${f}`);
  return out;
}

/** Writes `value` at `path` into a raw config object, dropping it (and emptied parents) when it is
 *  the default, so the file keeps holding only differences. Unknown keys are left alone. */
export function setAt(raw, services, path, value) {
  const parts = path.split(".");
  const isDefault = value === defaultAt(services, path);
  let node = raw;
  const chain = [];
  for (const p of parts.slice(0, -1)) {
    if (!isObj(node[p])) { if (isDefault) return raw; node[p] = {}; }
    chain.push([node, p]);
    node = node[p];
  }
  const leaf = parts[parts.length - 1];
  if (isDefault) delete node[leaf]; else node[leaf] = value;
  for (let i = chain.length - 1; i >= 0; i--) {
    const [parent, p] = chain[i];
    if (isObj(parent[p]) && !Object.keys(parent[p]).length) delete parent[p];
  }
  return raw;
}

/**
 * The one way config.json is written. Reads the file fresh, refuses if it isn't valid JSON (a hand
 * edit is never clobbered), applies `mutate(raw)`, then writes with a compare-and-swap against the
 * text just read (Herdr's writeTextFile replaces atomically and rejects a stale snapshot) — retried
 * once if another writer got in between. Returns the raw object written.
 *   io: { readTextFile, writeTextFile, mkdir }  (herdr / fs/promises in the mod; stubs in a test)
 */
export async function updateConfig(file, dir, mutate, io) {
  await io.mkdir(dir, { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await io.readTextFile(file);
    const parsed = parseRaw(text);
    if (parsed.error) throw new Error(`config.json isn't valid JSON (${parsed.error}); fix or delete it first`);
    const raw = parsed.value;
    mutate(raw);
    if (Object.keys(raw).some((k) => k !== "$schema")) raw.$schema = SCHEMA_REF;
    else delete raw.$schema;
    const { $schema, ...rest } = raw;
    const ordered = $schema ? { $schema, ...rest } : rest;
    try {
      await io.writeTextFile(file, JSON.stringify(ordered, null, 2) + "\n", text ?? null);
      return ordered;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
