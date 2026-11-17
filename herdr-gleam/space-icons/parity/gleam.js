// Loads the Gleam core's compiled modules (run `gleam build` first) and converts lists.
const BASE = new URL("../build/dev/javascript/space_icons/", import.meta.url);

/** @param {string} mod e.g. "hash" for src/space_icons/hash.gleam */
export async function G(mod) {
  return import(/* @vite-ignore */ new URL(`space_icons/${mod}.mjs`, BASE).href);
}

const prelude = await import(/* @vite-ignore */ new URL("gleam.mjs", BASE).href);
/** A JS array as a Gleam list. @param {unknown[]} xs */
G.list = (xs) => prelude.toList(xs);
/** A Gleam list as a JS array. @param {{ toArray(): unknown[] }} l */
G.array = (l) => l.toArray();
G.prelude = prelude;
