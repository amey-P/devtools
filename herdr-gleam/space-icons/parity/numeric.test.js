// Phase 3: the numeric core (fnv1a, mulberry32, int/pick/chance, n2, poly) against the oracle.
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { priv } from "./oracle-private.js";
import { G } from "./gleam.js";

const hash = await G("hash");
const rng = await G("rng");
const num = await G("num");
const geo = await G("geo");

/** Any UTF-16 string, lone surrogates included. */
const utf16 = fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)), maxLength: 40 });
const u32 = fc.integer({ min: 0, max: 0xffffffff });
const RUNS = { numRuns: 5000 };

describe("fnv1a", () => {
  test("same hash as the oracle for any UTF-16 string", () => {
    fc.assert(fc.property(utf16, (s) => hash.fnv1a(s) === priv.fnv1a(s)), RUNS);
  });
  test("full-unicode strings (astral, emoji)", () => {
    fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 30 }), (s) => hash.fnv1a(s) === priv.fnv1a(s)), RUNS);
  });
});

describe("mulberry32 + tools", () => {
  test("the first 64 draws match for any u32 seed", () => {
    fc.assert(
      fc.property(u32, (seed) => {
        const o = priv.mulberry32(seed);
        let r = rng.new$(seed);
        for (let i = 0; i < 64; i++) {
          const [x, next] = rng.next(r);
          if (x !== o()) return false;
          r = next;
        }
        return true;
      }),
      { numRuns: 2000 },
    );
  });
  test("int, pick and chance draw the same values in the same order", () => {
    fc.assert(
      fc.property(u32, fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 30 }), (seed, ops) => {
        const t = priv.tools(priv.mulberry32(seed));
        let r = rng.new$(seed);
        const xs = ["a", "b", "c", "d", "e"].slice(0, 1 + (seed % 5));
        for (const op of ops) {
          let mine, theirs;
          if (op % 3 === 0) ([mine, r] = rng.int(r, op), (theirs = t.int(op)));
          else if (op % 3 === 1) ([mine, r] = rng.pick(r, G.list(xs)), (theirs = t.pick(xs)));
          else ([mine, r] = rng.chance(r, op / 10), (theirs = t.chance(op / 10)));
          if (mine !== theirs) return false;
        }
        return true;
      }),
      RUNS,
    );
  });
});

describe("n2 + js_num (number text)", () => {
  test("String(n2(v)) for any double", () => {
    fc.assert(fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }), (v) => num.n2_text(v) === String(priv.n2(v))), RUNS);
  });
});

describe("poly", () => {
  test("same points text as the oracle", () => {
    const cxy = fc.double({ min: 0, max: 24, noNaN: true });
    fc.assert(
      fc.property(cxy, cxy, fc.double({ min: 0.5, max: 12, noNaN: true }), fc.integer({ min: 3, max: 8 }), fc.double({ min: -7, max: 7, noNaN: true }), (cx, cy, r, sides, rot) =>
        geo.poly(cx, cy, r, sides, rot) === priv.poly(cx, cy, r, sides, rot),
      ),
      RUNS,
    );
  });
});
