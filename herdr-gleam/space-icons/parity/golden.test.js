// Golden files: GOLDEN=write rebuilds and writes them; otherwise a fresh build must equal the
// committed files (regenerable), and the oracle copies must still match their checksums (frozen).
import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { buildIcons, buildOverrideCases, buildGeo, buildViews } from "./golden.js";

const here = (/** @type {string} */ p) => fileURLToPath(new URL(p, import.meta.url));
const WRITE = process.env.GOLDEN === "write";
const json = (/** @type {unknown} */ v) => JSON.stringify(v, null, 1) + "\n";

/** @param {string} name @param {string} text */
function check(name, text) {
  const path = here(`golden/${name}`);
  if (WRITE) {
    mkdirSync(here("golden"), { recursive: true });
    writeFileSync(path, name.endsWith(".gz") ? gzipSync(text, { level: 9 }) : text);
    return;
  }
  const raw = readFileSync(path);
  const committed = name.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  expect(committed === text, `${name} differs from a fresh build: run npm run golden and review the diff`).toBe(true);
}

describe("oracle", () => {
  test("frozen copies match SHA256SUMS", () => {
    for (const line of readFileSync(here("oracle/SHA256SUMS"), "utf8").trim().split("\n")) {
      const [sum, file] = line.split(/\s+/);
      expect(createHash("sha256").update(readFileSync(here(`oracle/${file}`))).digest("hex"), file).toBe(sum);
    }
  });
});

describe("goldens", () => {
  test("corpus (a): names + iconFor", async () => {
    const { names, icons } = await buildIcons();
    expect(names.length).toBeGreaterThanOrEqual(10_000);
    check("names.json", json(names));
    check("icons.json", json(icons));
  });

  test("corpus (a): override cases", async () => {
    check("override-cases.json", json(await buildOverrideCases()));
  });

  test("corpus (b): geoIcon x families", async () => {
    const { names } = await buildIcons();
    const { rows, full } = buildGeo(names);
    check("geo.jsonl.gz", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    check("geo-full.json", json(full));
  });

  test("view set (c): render trees", async () => {
    const views = await buildViews();
    expect(views.length).toBeGreaterThan(20);
    check("views.json", json(views));
  });
});
