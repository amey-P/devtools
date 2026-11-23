// Phase 5: shape, the 6 geo families, geo_icon and geo_file against corpus (b) and the oracle.
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { priv } from "./oracle-private.js";
import { geoIcon } from "./oracle/geo.js";
import { geoFile } from "./oracle-run.js";
import { FAMILIES, FULL_SVGS, sha16 } from "./golden.js";
import { G } from "./gleam.js";

const geo = await G("geo");
const read = (/** @type {string} */ f) => readFileSync(new URL(`./golden/${f}`, import.meta.url));
/** @type {string[]} */ const names = JSON.parse(read("names.json").toString("utf8"));
/** @type {Record<string, Record<string, string>>} */ const full = JSON.parse(read("geo-full.json").toString("utf8"));
/** rows: [name index, requested family ("" = auto), family, file name, sha16(svg)] (golden.js buildGeo). */
/** @type {[number, string, string, string, string][]} */
const rows = gunzipSync(read("geo.jsonl.gz")).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));

/** The port's icon for a corpus request ("" = no family). @param {string} name @param {string} req */
const port = (name, req) => geo.geo_icon(name, G.some(req || null));

/** Checks every corpus (b) row of one request: family, file name, SVG hash. @param {string} req */
function corpus(req) {
  const mine = rows.filter((r) => r[1] === req);
  /** @type {unknown[]} */ const bad = [];
  for (const [i, , family, file, sha] of mine) {
    const g = port(names[i], req);
    const got = [g.family, geo.geo_file(names[i], G.some(req || null)), sha16(g.svg)];
    if (got[0] !== family || got[1] !== file || got[2] !== sha) bad.push({ i, name: names[i], want: [family, file, sha], got });
  }
  expect(bad.slice(0, 5)).toEqual([]);
  expect(bad.length).toBe(0);
  return mine.length;
}

/** The full SVG text of the first FULL_SVGS names, diffed as text. @param {string} req */
function fullText(req) {
  for (let i = 0; i < FULL_SVGS; i++) expect(port(names[i], req).svg, `${i} ${JSON.stringify(names[i])}`).toBe(full[i][req || "auto"]);
}

describe("shape", () => {
  const cxy = fc.double({ min: -4, max: 28, noNaN: true });
  const kind = fc.oneof(fc.constant("circle"), fc.integer({ min: 3, max: 8 }));
  test("same text as the oracle for circle and 3..8 sides", () => {
    fc.assert(
      fc.property(kind, cxy, cxy, fc.double({ min: 0.5, max: 12, noNaN: true }), fc.double({ min: -7, max: 7, noNaN: true }), fc.constantFrom("", ` opacity="0.42"`), (k, cx, cy, r, rot, attrs) =>
        geo.shape(k === "circle" ? new geo.Circle() : new geo.Sides(k), cx, cy, r, rot, attrs) === priv.shape(k, cx, cy, r, rot, attrs),
      ),
      { numRuns: 5000 },
    );
  });
});

for (const fam of FAMILIES) {
  describe(fam, () => {
    test("corpus (b): family, file name and SVG hash for every name", () => {
      expect(corpus(fam)).toBe(names.length);
    });
    test(`full SVG text, first ${FULL_SVGS} names`, () => fullText(fam));
  });
}

describe("auto (family picked by the seed)", () => {
  test("corpus (b): family, file name and SVG hash for every name", () => {
    expect(corpus("")).toBe(names.length);
  });
  test(`full SVG text, first ${FULL_SVGS} names`, () => fullText(""));
  test("None and an unknown family pick it like the oracle", () => {
    const odd = ["", "nope", "Tiles", " tiles", "TILES", "overlap ", "constructor", "__proto__"];
    for (let i = 0; i < 300; i++) {
      const n = names[i];
      const none = geo.geo_icon(n, G.some(null));
      expect([none.svg, none.family]).toEqual([geoIcon(n).svg, geoIcon(n).family]);
      expect(geo.geo_file(n, G.some(null))).toBe(geoFile(n));
      for (const f of odd) {
        const o = geoIcon(n, { family: f });
        const g = geo.geo_icon(n, G.some(f));
        expect([g.svg, g.family], `${JSON.stringify(n)} ${JSON.stringify(f)}`).toEqual([o.svg, o.family]);
        expect(geo.geo_file(n, G.some(f))).toBe(geoFile(n, f));
      }
    }
  });
  test("seed is trimmed and lower-cased (any string)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 16 }), fc.constantFrom(null, ...FAMILIES), (s, f) => {
        const o = geoIcon(s, f ? { family: f } : {});
        const g = geo.geo_icon(s, G.some(f));
        return g.svg === o.svg && g.family === o.family;
      }),
      { numRuns: 3000 },
    );
  });
});
