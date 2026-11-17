// Builds every golden from the frozen oracle. `npm run golden` writes them; golden.test.js checks
// that a fresh build matches what is committed (so the goldens can always be regenerated).
import { createHash } from "node:crypto";
import { names, corpusOverridesText, OVERRIDE_CASES, viewCases } from "./corpus.js";
import { decodeOverrides, renderOracle, iconFor, geoIcon, fnv1a } from "./oracle-run.js";

export const FAMILIES = ["tiles", "radial", "rings", "stripes", "orbit", "overlap"];
/** "" = no family forced (the seed picks it). */
export const REQUESTS = ["", ...FAMILIES];
/** How many names keep their full SVG text in geo-full.json (the rest store a SHA-256 prefix). */
export const FULL_SVGS = 200;

export const sha16 = (/** @type {string} */ s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
/** @param {{ glyph: string | null, seed: string, family?: string }} ic */
const row = (ic) => [ic.glyph, ic.seed, ic.family ?? null];

/** Corpus (a): iconFor for every name, without overrides and with corpus overrides. */
export async function buildIcons() {
  const ns = names();
  const overridesText = corpusOverridesText(ns);
  const { overrides, logs } = await decodeOverrides(overridesText);
  if (logs.length) throw new Error(`corpus overrides did not decode: ${logs}`);
  return {
    names: ns,
    icons: { overridesText, plain: ns.map((n) => row(iconFor(n))), withOverrides: ns.map((n) => row(iconFor(n, overrides))) },
  };
}

/** Targeted override cases: decoded through the oracle's init, then iconFor. */
export async function buildOverrideCases() {
  const out = [];
  for (const c of OVERRIDE_CASES) {
    const { overrides, logs } = await decodeOverrides(c.text, { fail: c.fail });
    out.push({ ...c, icon: row(iconFor(c.name, overrides)), logs });
  }
  return out;
}

/**
 * Corpus (b): geoIcon for every name x every family request.
 * rows: [name index, requested family ("" = auto), family, file name, sha16(svg)].
 * @param {string[]} ns
 */
export function buildGeo(ns) {
  /** @type {(string | number)[][]} */ const rows = [];
  /** @type {Record<string, Record<string, string>>} */ const full = {};
  ns.forEach((n, i) => {
    for (const req of REQUESTS) {
      const g = geoIcon(n, req ? { family: req } : {});
      rows.push([i, req, g.family, `${fnv1a(g.svg).toString(36)}.svg`, sha16(g.svg)]);
      if (i < FULL_SVGS) (full[i] ??= {})[req || "auto"] = g.svg;
    }
  });
  return { rows, full };
}

/** View set (c): the oracle's recorded render tree for every matrix case. */
export async function buildViews() {
  const out = [];
  for (const c of viewCases()) out.push({ ...c, tree: await renderOracle(c) });
  return out;
}
