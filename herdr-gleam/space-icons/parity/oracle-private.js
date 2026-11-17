// The oracle's private helpers (mulberry32, tools, n2, poly, shape, optical), for property tests.
// geo.js is never edited: its frozen text is loaded with one export line appended.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./oracle/geo.js", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(src + "\nexport { mulberry32, tools, n2, poly, shape, optical };\n").toString("base64");

/** @type {{ mulberry32: (a: number) => () => number, tools: Function, n2: (v: number) => number, poly: Function, shape: Function, optical: Function, fnv1a: (s: string) => number }} */
export const priv = await import(/* @vite-ignore */ url);
