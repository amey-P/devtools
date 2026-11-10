#!/usr/bin/env node
// agent-usage scanner: reads coding agents' local session logs (and, with
// --limits, plan-limit usage) and prints one JSON object on stdout.
//
//   node scan.mjs            tokens and cost for today and the last 7 days
//   node scan.mjs --limits   also plan limits (Claude: api.anthropic.com; Codex: its
//                            logs; OpenCode Go: opencode.ai/zen/go/v1/usage)
//
// Which services are tracked comes from services.json next to this file: swap
// one in/out (or set "enabled": false) there and both sides follow — main.js
// renders whatever this script reports. Log-type services are read from their
// local logs; api-type services (OpenCode Go) have no local logs — their usage
// is server-side, fetched with the plan's API key.
//
// Logs are read incrementally: a cache in ~/.cache/herdr-agent-usage remembers how
// far into each (append-only) session file we got, so later runs only read new
// lines, and the last api usage seen. Secrets (Claude OAuth token, Go API key)
// are read, never refreshed, never printed. Always exits 0 with valid JSON;
// failures are reported per provider as `error`.
//
//   node scan.mjs --services a,b   scan only these services (keys from services.json). The
//                                  widget passes the ones enabled in the person's settings —
//                                  this script never reads data/agent-usage/config.json.
//   node scan.mjs --reset-cache    delete the cache and exit (the settings screen's "Clear & rescan";
//                                  the widget's next scan rebuilds it)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** @import { Limits, LimitWindow, ProviderUsage, ScanResult, Totals } from "./types.js" */

// One session-log line, parsed into: [day, model, in, out, cacheWrite5m, cacheWrite1h, cacheRead, cost|null, dedupeKey|null].
/** @typedef {[string, string, number, number, number, number, number, number | null, string | null]} Rec */
// Codex's per-window rate limits, as reported in event lines (raw API fields, optional until checked).
/** @typedef {{ used_percent?: number, window_minutes?: number, resets_at?: number, resets_in_seconds?: number }} CodexRLWin */
/** st.limits for codex: the API's rate_limits object plus the timestamp it was seen at. */
/** @typedef {{ at: string, primary?: CodexRLWin, secondary?: CodexRLWin, plan_type?: string }} CodexRL */
/** What a provider's per-file state (st) accumulates across parse() calls. */
/** @typedef {{ model?: string, limits?: CodexRL }} FileState */
/** One cache entry for a session file: provider key, inode, bytes consumed, records kept, st. */
/** @typedef {{ p: string, ino: number, off: number, recs: Rec[], st: FileState }} FileEnt */
/** The scan cache in ~/.cache/herdr-agent-usage/scan.json. */
/** @typedef {{ v: number, files: Record<string, FileEnt>, services: Record<string, { at: string, limits: Limits }> }} Cache */
/** One services.json entry as scan.mjs reads it: `key` is all it requires. */
/** @typedef {{ key: string, label?: string, icon?: string, brand?: string, program?: string, enabled?: boolean, apps?: string[] }} ServiceEntry */
/** A provider: log providers read dirs/ with parse(); the api provider (opencode-go) fetches from limits(). */
/** @typedef {{ dirs?: string[], parse?: (o: any, st: FileState) => Rec | null, api?: boolean, limits?: () => Promise<Limits> }} ProviderDef */
/** [session file, its stat] pairs, as walk() returns them. */
/** @typedef {[string, import("node:fs").Stats][]} FileHits */
/** Claude Code's stored OAuth credential (.claudeAiOauth in .credentials.json / the Keychain). */
/** @typedef {{ accessToken: string, expiresAt?: number, subscriptionType?: string }} Credential */
/** One api.anthropic.com/api/oauth/usage window (raw API fields). */
/** @typedef {{ utilization?: number, resets_at?: string }} ClaudeWin */
/** @typedef {{ five_hour?: ClaudeWin, seven_day?: ClaudeWin, seven_day_opus?: ClaudeWin, seven_day_sonnet?: ClaudeWin }} ClaudeUsage */
/** One opencode.ai/zen/go/v1/usage window, keyed "rolling"|"weekly"|"monthly". resetsAt: epoch seconds or ISO. */
/** @typedef {{ percent?: number, resetsAt?: string | number }} GoWin */
/** @typedef {{ usage?: Record<string, GoWin> }} GoUsage */
/** What rollup() contributes to one provider's entry. */
/** @typedef {Pick<ProviderUsage, "today" | "week" | "daily" | "models" | "estimated">} Rollup */

const HOME = os.homedir();
const DAYS = 7;
const KEEP_MS = (DAYS + 1) * 86400_000;
const CACHE_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(HOME, ".cache"), "herdr-agent-usage");
const CACHE_FILE = path.join(CACHE_DIR, "scan.json");
const CACHE_VERSION = 2;
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} name @returns {string | null | undefined} */
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// ---------------------------------------------------------------- services
// Which services to scan: --services a,b when given (the widget's enabled set), else every
// services.json entry not marked "enabled": false. Without services.json, every known provider.
/** @param {Set<string> | null} only @returns {ServiceEntry[]} */
function loadServices(only) {
  /** @type {ServiceEntry[] | null} */
  let list = null;
  try {
    /** @type {{ services?: ServiceEntry[] }} */
    const j = JSON.parse(fs.readFileSync(path.join(HERE, "services.json"), "utf8"));
    list = Array.isArray(j.services) ? j.services.filter((s) => s && typeof s.key === "string") : null;
  } catch {}
  if (!list || !list.length) list = Object.keys(providers).map((key) => ({ key }));
  if (only) return list.filter((s) => only.has(s.key));
  return list.filter((s) => s.enabled !== false);
}

// $ per million tokens: [input, output, cache write 5m, cache write 1h, cache read].
// First matching prefix wins. Estimates only (API list prices).
/** @type {Array<[string, [number, number, number, number, number]]>} */
const PRICES = [
  ["claude-fable", [10, 50, 12.5, 20, 0.25]],
  ["claude-mythos", [10, 50, 12.5, 20, 0.25]],
  ["claude-opus-5-5", [4, 20, 5, 8, 0.2]],
  ["claude-opus-4-5", [5, 25, 6.25, 10, 0.5]],
  ["claude-opus-4-1", [15, 75, 18.75, 30, 1.5]],
  ["claude-opus-4-0", [15, 75, 18.75, 30, 1.5]],
  ["claude-opus-4-2", [15, 75, 18.75, 30, 1.5]],
  ["claude-opus", [5, 25, 6.25, 10, 0.5]],
  ["claude-sonnet-4-6", [3, 15, 3.75, 6, 0.3]],
  ["claude-sonnet-4", [3, 15, 3.75, 6, 0.3]],
  ["claude-sonnet", [2, 10, 2.5, 4, 0.2]],
  ["claude-haiku-5", [0.1, 0.5, 0.125, 0.2, 0.01]],
  ["claude-haiku", [1, 5, 1.25, 2, 0.1]],
];
/** @type {(model: string) => [number, number, number, number, number] | null} */
const priceFor = (model) => (PRICES.find(([p]) => (model || "").startsWith(p)) || [null, null])[1];

/** @type {(ts: number) => string | null} */
const dayOf = (ts) => {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- providers
// Each parser turns one JSON line into a record or null:
//   [day, model, in, out, cacheWrite5m, cacheWrite1h, cacheRead, cost|null, dedupeKey|null]
// Codex lines can also carry rate limits (returned via `limits`).

/** @type {Record<string, ProviderDef>} */
const providers = {
  claude: {
    dirs: [path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude"), "projects")],
    parse(o) {
      const u = o?.message?.usage;
      if (o?.type !== "assistant" || !u) return null;
      const day = dayOf(o.timestamp);
      if (!day) return null;
      const cw = u.cache_creation_input_tokens || 0;
      const cw1h = u.cache_creation?.ephemeral_1h_input_tokens || 0;
      const key = o.message.id ? `${o.message.id}:${o.requestId || ""}` : null;
      return [day, o.message.model || "", u.input_tokens || 0, u.output_tokens || 0,
        Math.max(0, cw - cw1h), cw1h, u.cache_read_input_tokens || 0, null, key];
    },
  },
  pi: {
    dirs: [path.join(HOME, ".pi", "agent", "sessions")],
    parse(o) {
      const u = o?.message?.usage;
      if (o?.type !== "message" || o.message.role !== "assistant" || !u) return null;
      const day = dayOf(o.timestamp);
      if (!day) return null;
      const model = [o.message.provider, o.message.model].filter(Boolean).join("/");
      return [day, model, u.input || 0, u.output || 0, u.cacheWrite || 0, 0, u.cacheRead || 0,
        typeof u.cost?.total === "number" ? u.cost.total : null, o.id ? `pi:${o.id}` : null];
    },
  },
  codex: {
    dirs: [path.join(process.env.CODEX_HOME || path.join(HOME, ".codex"), "sessions")],
    // Codex reports running totals per session; we record the per-turn delta.
    parse(o, st) {
      const p = o?.payload;
      if (o?.type === "turn_context" && p?.model) { st.model = p.model; return null; }
      if (o?.type !== "event_msg" || p?.type !== "token_count") return null;
      if (p.rate_limits) st.limits = { at: o.timestamp, ...p.rate_limits };
      const last = p.info?.last_token_usage;
      const day = dayOf(o.timestamp);
      if (!last || !day) return null;
      const cached = last.cached_input_tokens || 0;
      return [day, st.model || "codex", Math.max(0, (last.input_tokens || 0) - cached),
        (last.output_tokens || 0), 0, 0, cached, null, null];
    },
  },
  "opencode-go": {
    // OpenCode Go (opencode.ai/console/go) is a flat subscription whose usage
    // limits — rolling 5h, weekly, monthly — live server-side. No local logs;
    // the numbers come from an authenticated API call (see goLimits below).
    api: true,
    limits: goLimits,
  },
};

// ---------------------------------------------------------------- files

/** @param {string} dir @param {number} cutoff @param {FileHits} out @returns {FileHits} */
function walk(dir, cutoff, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, cutoff, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) {
      try { const s = fs.statSync(p); if (s.mtimeMs >= cutoff) out.push([p, s]); } catch {}
    }
  }
  return out;
}

/** @param {string} file @param {number} offset @param {number} size @returns {string} */
function readFrom(file, offset, size) {
  const len = size - offset;
  if (len <= 0) return "";
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = fs.readSync(fd, buf, got, len - got, offset + got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(0, got).toString("utf8");
  } finally { fs.closeSync(fd); }
}

/** @returns {Cache} */
function loadCache() {
  try {
    /** @type {any} */ // the cache file as raw JSON (type-checked by `v` below)
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (c.v === CACHE_VERSION) return c;
  } catch {}
  return { v: CACHE_VERSION, files: {}, services: {} };
}

/** @param {Cache} c @returns {void} */
function saveCache(c) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(c));
    fs.renameSync(tmp, CACHE_FILE);
  } catch {}
}

// Scans one provider; updates cache.files in place. Returns codex limits if seen.
/** @param {string} name @param {ProviderDef} prov @param {Cache} cache @param {number} now @returns {CodexRL | null} */
function scanProvider(name, prov, cache, now) {
  const cutoff = now - KEEP_MS;
  const keepDay = dayOf(cutoff);
  /** @type {Set<string>} */
  const seen = new Set();
  let limits = null, newestLimitsAt = 0;
  for (const dir of prov.dirs) {
    for (const [file, st] of walk(dir, cutoff, [])) {
      seen.add(file);
      let ent = cache.files[file];
      if (!ent || ent.p !== name || st.size < ent.off || st.ino !== ent.ino) {
        ent = cache.files[file] = { p: name, ino: st.ino, off: 0, recs: [], st: {} };
      }
      if (st.size > ent.off) {
        const text = readFrom(file, ent.off, st.size);
        const end = text.lastIndexOf("\n");
        if (end >= 0) {
          for (const line of text.slice(0, end).split("\n")) {
            if (!line) continue;
            let o; try { o = JSON.parse(line); } catch { continue; }
            const r = prov.parse(o, ent.st);
            if (r && r[0] >= keepDay && r[1] !== "<synthetic>") ent.recs.push(r);
          }
          ent.off += Buffer.byteLength(text.slice(0, end + 1), "utf8");
        }
      }
      ent.recs = ent.recs.filter((r) => r[0] >= keepDay);
      const la = ent.st.limits ? Date.parse(ent.st.limits.at) || 0 : 0;
      if (la > newestLimitsAt) { newestLimitsAt = la; limits = ent.st.limits; }
    }
  }
  // Forget files that aged out or vanished.
  for (const [f, ent] of Object.entries(cache.files)) if (ent.p === name && !seen.has(f)) delete cache.files[f];
  return limits;
}

/** @param {string} name @param {Cache} cache @param {number} now @returns {Rollup} */
function rollup(name, cache, now) {
  /** @type {string[]} */
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) days.push(dayOf(now - i * 86400_000));
  const byDay = Object.fromEntries(days.map((d) => [d, { in: 0, out: 0, cw: 0, cr: 0, cost: 0, msgs: 0 }]));
  /** @type {Record<string, { tokens: number, cost: number }>} */
  const models = {};
  /** @type {Map<string, Rec>} */
  const latest = new Map(); // dedupe: last record per key wins (streamed lines repeat usage)
  /** @type {Rec[]} */
  const plain = [];
  for (const ent of Object.values(cache.files)) {
    if (ent.p !== name) continue;
    for (const r of ent.recs) { if (r[8]) latest.set(r[8], r); else plain.push(r); }
  }
  let priced = true;
  for (const r of [...latest.values(), ...plain]) {
    const b = byDay[r[0]];
    if (!b) continue;
    const [, model, i, o, w5, w1, cr, cost] = r;
    let c = cost;
    if (c == null) {
      const pr = priceFor(model);
      if (pr) c = (i * pr[0] + o * pr[1] + w5 * pr[2] + w1 * pr[3] + cr * pr[4]) / 1e6;
      else { c = 0; if (i + o > 0) priced = false; }
    }
    b.in += i; b.out += o; b.cw += w5 + w1; b.cr += cr; b.cost += c; b.msgs += 1;
    const m = (models[model] ??= { tokens: 0, cost: 0 });
    m.tokens += i + o + w5 + w1 + cr; m.cost += c;
  }
  /** @type {(list: string[]) => Totals} */
  const total = (list) => list.reduce((a, d) => {
    const b = byDay[d];
    for (const k of /** @type {(keyof Totals)[]} */ (Object.keys(a))) a[k] += b[k];
    return a;
  }, { in: 0, out: 0, cw: 0, cr: 0, cost: 0, msgs: 0 });
  const top = Object.entries(models).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 4)
    .map(([model, v]) => ({ model, ...v }));
  return {
    today: total([days[days.length - 1]]),
    week: total(days),
    daily: days.map((d) => { const b = byDay[d]; return { day: d, tokens: b.in + b.out + b.cw + b.cr, cost: b.cost }; }),
    models: top,
    estimated: name === "claude" || !priced,
  };
}

// ---------------------------------------------------------------- limits

/** @returns {Credential | null} */
function claudeCredentials() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
  /** @type {(t: string) => Credential | null} */
  const tryParse = (t) => { try { return JSON.parse(t)?.claudeAiOauth ?? null; } catch { return null; } };
  // Claude Code keeps its live token in the macOS Keychain; the file can be a
  // stale leftover. Use whichever copy expires last.
  /** @type {(Credential | null)[]} */
  const found = [];
  try { found.push(tryParse(fs.readFileSync(path.join(base, ".credentials.json"), "utf8"))); } catch {}
  if (process.platform === "darwin") {
    try {
      found.push(tryParse(execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] })));
    } catch {}
  }
  return found.filter((c) => c?.accessToken).sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0))[0] ?? null;
}

/** @returns {Promise<Limits>} */
async function claudeLimits() {
  const c = claudeCredentials();
  if (!c?.accessToken) return { state: "signed-out" };
  const plan = c.subscriptionType || null;
  if (c.expiresAt && c.expiresAt < Date.now()) return { state: "stale", plan };
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${c.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "herdr-agent-usage",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return { state: "stale", plan };
    if (!res.ok) return { state: "error", plan, error: `HTTP ${res.status}` };
    /** @type {ClaudeUsage} */
    const j = /** @type {ClaudeUsage} */ (await res.json());
    /** @type {(w: ClaudeWin | undefined, label: string, minutes: number) => LimitWindow | null} */
    const win = (w, label, minutes) => (w && typeof w.utilization === "number")
      ? { label, pct: w.utilization, resets_at: w.resets_at || null, minutes } : null;
    /** @type {LimitWindow[]} */
    const windows = [
      win(j.five_hour, "5h", 300),
      win(j.seven_day, "week", 10080),
      win(j.seven_day_opus, "week · opus", 10080),
      win(j.seven_day_sonnet, "week · sonnet", 10080),
    ].filter(Boolean);
    return { state: "ok", plan, windows };
  } catch (e) {
    return { state: "error", plan, error: String(e?.message || e) };
  }
}

/** @param {CodexRL | null} rl @returns {(Limits & { as_of: string }) | null} */
function codexLimits(rl) {
  if (!rl) return null;
  /** @type {(w: CodexRLWin | undefined, fallback: string) => LimitWindow | null} */
  const win = (w, fallback) => {
    if (!w || typeof w.used_percent !== "number") return null;
    const m = w.window_minutes || 0;
    const label = m >= 10000 ? "week" : m >= 60 ? `${Math.round(m / 60)}h` : fallback;
    let resets = null;
    if (typeof w.resets_at === "number") resets = new Date(w.resets_at * 1000).toISOString();
    else if (typeof w.resets_in_seconds === "number") resets = new Date(Date.parse(rl.at) + w.resets_in_seconds * 1000).toISOString();
    return { label, pct: w.used_percent, resets_at: resets, minutes: m };
  };
  const windows = [win(rl.primary, "primary"), win(rl.secondary, "secondary")].filter(Boolean);
  return windows.length ? { state: "ok", plan: rl.plan_type || null, windows, as_of: rl.at } : null;
}

// The Go plan's API key, from the first source that has one: env vars, then pi's
// and the opencode CLI's auth stores (both map provider name → { type, key }).
// Read, never printed.
function goApiKey() {
  for (const v of [process.env.OPENCODE_GO_API_KEY, process.env.OPENCODE_API_KEY, process.env.OPENCODE_ZEN_API_KEY]) {
    if (v) return v;
  }
  const files = [
    path.join(HOME, ".pi", "agent", "auth.json"),
    path.join(process.env.OPENCODE_CONFIG_DIR || path.join(HOME, ".local", "share", "opencode"), "auth.json"),
  ];
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
    for (const name of ["opencode-go", "opencode-zen", "opencode"]) {
      const k = j?.[name]?.key;
      if (typeof k === "string" && k) return k;
    }
  }
  return null;
}

/** @type {[string, string, number][]} */
const GO_WINDOWS = [["rolling", "5h", 300], ["weekly", "week", 10080], ["monthly", "month", 43200]];

/** @returns {Promise<Limits>} */
async function goLimits() {
  const key = goApiKey();
  if (!key) return { state: "signed-out" };
  try {
    const res = await fetch("https://opencode.ai/zen/go/v1/usage", {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "herdr-agent-usage" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return { state: "stale" };
    if (!res.ok) return { state: "error", error: `HTTP ${res.status}` };
    /** @type {GoUsage} */
    const j = /** @type {GoUsage} */ (await res.json());
    /** @type {Record<string, GoWin>} */
    const u = j?.usage ?? {};
    /** @type {LimitWindow[]} */
    const windows = GO_WINDOWS.flatMap(([name, label, minutes]) => {
      const w = u[name];
      if (!w || typeof w.percent !== "number") return [];
      const at = w.resetsAt ? (typeof w.resetsAt === "number" ? new Date(w.resetsAt * 1000) : new Date(w.resetsAt)) : null;
      return [{ label, pct: Math.max(0, Math.min(100, w.percent)),
        resets_at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null, minutes }];
    });
    if (!windows.length) return { state: "error", error: "no usage windows in response" };
    return { state: "ok", windows };
  } catch (e) {
    return { state: "error", error: String(e?.message || e) };
  }
}

// ---------------------------------------------------------------- main

/** @returns {Promise<void>} */
async function main() {
  const wantLimits = process.argv.includes("--limits");
  if (process.argv.includes("--reset-cache")) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true }); // throws → exit 1, reported by the caller
    return;
  }
  const servicesArg = argValue("--services");
  const only = servicesArg == null ? null : new Set(servicesArg.split(",").map((s) => s.trim()).filter(Boolean));
  const now = Date.now();
  const cache = loadCache();
  cache.services ??= {};
  /** @type {ScanResult} */
  const out = { at: new Date(now).toISOString(), providers: {} };
  /** @type {{ v?: CodexRL | null }} */
  const codexRL = {};
  for (const svc of loadServices(only)) {
    const prov = providers[svc.key];
    const meta = {
      label: svc.label ?? svc.key, icon: svc.icon ?? null, brand: svc.brand ?? null, api: !!prov?.api,
      program: svc.program ?? null, apps: Array.isArray(svc.apps) ? svc.apps : [],
    };
    try {
      if (prov?.api) {
        // Server-side usage only: fetch on --limits runs (and the first run, so a
        // fresh install doesn't wait 5 minutes), serve the last result between.
        if (wantLimits || !cache.services[svc.key]) {
          cache.services[svc.key] = { at: new Date(now).toISOString(), limits: await prov.limits() };
        }
        const hit = cache.services[svc.key];
        out.providers[svc.key] = { meta, ...(hit
          ? { limits: hit.limits, limits_at: hit.at }
          : { limits: { state: "signed-out" } }) };
        continue;
      }
      if (!prov || !prov.dirs.some((d) => fs.existsSync(d))) continue;
      const rl = scanProvider(svc.key, prov, cache, now);
      if (svc.key === "codex") codexRL.v = rl;
      out.providers[svc.key] = { meta, ...rollup(svc.key, cache, now) };
    } catch (e) {
      out.providers[svc.key] = { meta, error: String(e?.message || e) };
    }
  }
  saveCache(cache);
  if (wantLimits) {
    if (out.providers.claude) out.providers.claude.limits = await claudeLimits();
    if (out.providers.codex) out.providers.codex.limits = codexLimits(codexRL.v);
  }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => {
  if (process.argv.includes("--reset-cache")) { process.stderr.write(`${e?.message || e}\n`); process.exitCode = 1; return; }
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), error: String(e?.message || e), providers: {} }));
});
