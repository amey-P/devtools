// node --test herdr-sidebar/space-tree/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoIcon, FAMILIES } from "../geo.js";
import { iconFor } from "../glyphs.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

test("same seed, same svg", () => {
  assert.equal(geoIcon("herdr-app").svg, geoIcon("herdr-app").svg);
  assert.equal(geoIcon("  Herdr-App ").svg, geoIcon("herdr-app").svg);
  assert.notEqual(geoIcon("herdr-app").svg, geoIcon("dotfiles").svg);
});

test("600 seeds: well-formed, every family used", () => {
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    const g = geoIcon(`space-${i}`);
    assert.doesNotMatch(g.svg, /NaN|undefined|Infinity/, `seed space-${i}`);
    assert.match(g.svg, /^<svg [^>]*viewBox="0 0 24 24"[^>]*>.*<\/svg>$/);
    seen.add(g.family);
  }
  assert.deepEqual([...seen].sort(), [...FAMILIES].sort());
});

test("forced family", () => {
  for (const f of FAMILIES) assert.equal(geoIcon("x", { family: f }).family, f);
  assert.equal(geoIcon("x", { family: "nope" }).family, geoIcon("x").family);
});

test("both mods ship identical geo.js, geocache.js, glyphs.js", () => {
  for (const f of ["geo.js", "geocache.js", "glyphs.js"]) {
    assert.equal(
      readFileSync(here(`../${f}`), "utf8"),
      readFileSync(here(`../../../herdr-minimal/space-icons/${f}`), "utf8"),
      `${f} differs between space-tree and space-icons`,
    );
  }
});

test("iconFor: geometric by default, no colour of its own", () => {
  const ic = iconFor(" Herdr-App ");
  assert.equal(ic.glyph, null);
  assert.equal(ic.seed, "herdr-app");
  assert.equal("color" in ic, false);
});

test("iconFor: overrides", () => {
  const o = {
    "a": { glyph: "rocket" },
    "b": { seed: "b-2" },
    "c": { family: "radial" },
    "d": { glyph: "not-a-glyph" },
  };
  assert.equal(iconFor("a", o).glyph, "rocket");
  assert.equal(iconFor("b", o).seed, "b-2");
  assert.notEqual(geoIcon(iconFor("b", o).seed).svg, geoIcon("b").svg);
  assert.equal(iconFor("c", o).family, "radial");
  assert.equal(iconFor("d", o).glyph, null);
});
