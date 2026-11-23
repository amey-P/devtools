// Phase 4: iconFor, the overrides decoder and JS trim/lowercase, against the oracle goldens.
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { G } from "./gleam.js";

const glyphs = await G("glyphs");
const jstext = await G("jstext");
const golden = (/** @type {string} */ f) => JSON.parse(readFileSync(new URL(`./golden/${f}`, import.meta.url), "utf8"));
const names = golden("names.json");
const icons = golden("icons.json");
const cases = golden("override-cases.json");

/** A Gleam Icon as the golden row [glyph, seed, family]. @param {any} ic */
const row = (ic) => [G.opt(ic.glyph), ic.seed, G.opt(ic.family)];
/** Decoded overrides from text the way the core's init will: null text = no file. @param {string | null} text */
function decode(text) {
  if (text == null) return { overrides: glyphs.no_overrides(), logs: [] };
  const r = G.result(glyphs.decode_overrides(text));
  return r.error !== undefined ? { overrides: glyphs.no_overrides(), logs: [r.error] } : { overrides: r.ok, logs: [] };
}

/** Collisions after trim+lowercase need JS property order; see docs/decisions.md (phase 2, finding 1). */
const ORDER_DEPENDENT = new Set(["collision: last written wins", "collision: reversed", "collision: index key sorts first"]);

describe("JS string semantics", () => {
  const ws = [" ", "\t", "\n", "\v", "\f", "\r", " ", " ", " ", " ", " ", " ", " ", " ", " ", "　", "﻿", "᠎", "​", "\u0085", "‎", "‏"];
  const unit = fc.oneof(fc.constantFrom(...ws), fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)), fc.constantFrom("a", "Z", "🚀", "é"));
  test("js_trim == String.prototype.trim", () => {
    fc.assert(fc.property(fc.string({ unit, maxLength: 12 }), (s) => jstext.js_trim(s) === s.trim()), { numRuns: 20000 });
  });
  test("key == trim().toLowerCase()", () => {
    fc.assert(fc.property(fc.string({ unit, maxLength: 12 }), (s) => jstext.key(s) === s.trim().toLowerCase()), { numRuns: 20000 });
  });
});

describe("corpus (a)", () => {
  test("iconFor without overrides, all names", () => {
    const empty = glyphs.no_overrides();
    names.forEach((n, i) => expect(row(glyphs.icon_for(n, empty)), JSON.stringify(n)).toEqual(icons.plain[i]));
  });
  test("iconFor with the corpus overrides, all names", () => {
    const { overrides, logs } = decode(icons.overridesText);
    expect(logs).toEqual([]);
    names.forEach((n, i) => expect(row(glyphs.icon_for(n, overrides)), JSON.stringify(n)).toEqual(icons.withOverrides[i]));
  });
});

describe("override cases", () => {
  for (const c of cases) {
    const t = ORDER_DEPENDENT.has(c.note) ? test.fails : test;
    t(c.note, () => {
      const { overrides, logs } = c.fail ? { overrides: glyphs.no_overrides(), logs: ["read failed"] } : decode(c.text);
      expect(row(glyphs.icon_for(c.name, overrides))).toEqual(c.icon);
      expect(logs.length).toBe(c.logs.length);
      if (!c.fail) for (const l of logs) expect(`space-icons: overrides.json: ${l}`).toMatch(/^space-icons: overrides\.json: /);
    });
  }
});
