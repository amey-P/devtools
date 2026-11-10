// Hand-written types for the agent-usage mod (dev-only: tsc reads it, the installers don't copy it).
// The shared fixes to Herdr's own types are in /types/herdr.d.ts.

/** theme(): color name → hex color. */
export type Theme = Record<string, import("gpui-kit").Color>;

// ---- services.json and config.json (config.js) ---------------------------------------------------------------

/** One entry of services.json (or DEFAULT_SERVICES). */
export interface Service {
  key: string;
  label: string;
  /** An svg path: relative to the mod ("icons/x.svg") or to the app home ("mods/…"). */
  icon: string;
  brand: import("gpui-kit").Color;
  enabled?: boolean;
  /** The CLI it runs as. */
  program: string;
  /** Agent app names (Herdr's terminal `app`) that count as this service. */
  apps: string[];
  /** Usage is server-side (fetched with an API key), not read from local logs. */
  api?: boolean;
}

/** The scan cadence, whole minutes. */
export interface ScanSettings { everyMinutes: number; limitsEveryMinutes: number }

/** A service's settings in effect. */
export interface ServiceSettings { enabled: boolean; hidden: boolean }

/** Everything the widget and the settings page read (config.js effective()). */
export interface UsageConfig {
  scan: ScanSettings;
  /** service key → its settings */
  services: Record<string, ServiceSettings>;
}

/**
 * config.json as parsed: only what differs from the defaults, and unvalidated (a hand edit can hold anything),
 * so its values really can be anything until config.js has checked them.
 */
export type RawConfig = Record<string, any>;

/** parseRaw(): the parsed object, or why it couldn't be parsed. */
export type ParsedRaw = { value: RawConfig; error?: undefined } | { error: string; value?: undefined };

/** File access for updateConfig(), so a node test can stub it (herdr / fs/promises in the mod). */
export interface ConfigIO {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, text: string, expected: string | null): Promise<unknown>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
}

// ---- scan.mjs output (one JSON object on stdout) ---------------------------------------------------------------

/** Token and cost totals for a period. cw: cache writes, cr: cache reads. */
export interface Totals { in: number; out: number; cw: number; cr: number; cost: number; msgs: number }

/** One plan-limit window. */
export interface LimitWindow {
  /** "5h", "week", "month", … */
  label: string;
  /** 0–100 */
  pct: number;
  /** ISO time, or null when unknown. */
  resets_at: string | null;
  minutes: number;
}

/** A service's plan limits. */
export interface Limits {
  state: "ok" | "signed-out" | "stale" | "error";
  plan?: string | null;
  windows?: LimitWindow[];
  error?: string;
}

/** What scan.mjs reports about a service's identity (from services.json). */
export interface ProviderMeta {
  label: string;
  icon: string | null;
  brand: import("gpui-kit").Color | null;
  api: boolean;
  program: string | null;
  apps: string[];
}

/** One service in the scan. Log services have the usage fields; api services have limits only; a failure has error. */
export interface ProviderUsage {
  meta: ProviderMeta;
  today?: Totals;
  week?: Totals;
  /** The last 7 days, oldest first. day: "YYYY-MM-DD". */
  daily?: { day: string; tokens: number; cost: number }[];
  /** Up to 4 models by tokens. */
  models?: { model: string; tokens: number; cost: number }[];
  /** Cost is computed from list prices, not reported. */
  estimated?: boolean;
  limits?: Limits;
  /** ISO time the api limits were fetched. */
  limits_at?: string;
  error?: string;
}

/** scan.mjs stdout. */
export interface ScanResult {
  /** ISO time of the scan. */
  at: string;
  /** service key → its usage */
  providers: Record<string, ProviderUsage>;
  /** The whole scan failed. */
  error?: string;
}
