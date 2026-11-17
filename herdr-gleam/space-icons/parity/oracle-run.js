// Drives the frozen oracle against the fakes. Not part of the oracle (which is never edited).
import SpaceIcons from "./oracle/main.js";
import { iconFor } from "./oracle/glyphs.js";
import { geoIcon, fnv1a } from "./oracle/geo.js";
import { fake, reset } from "./fakes/herdr.js";
import { tree } from "./fakes/recorder.js";

export const MOD = "space-icons";
export const overridesPath = (/** @type {string} */ home) => `${home}/mods/${MOD}/overrides.json`;
export const geoDir = (/** @type {string} */ home) => `${home}/mods/${MOD}/geo`;

/** The geo file name the oracle uses for an icon (geocache.js). @param {string} seed @param {string} [family] */
export function geoFile(seed, family) {
  return `${fnv1a(geoIcon(seed, { family }).svg).toString(36)}.svg`;
}

/** A fake init cx: collects spawned tasks so a test can await them. */
function initCx() {
  /** @type {Promise<unknown>[]} */ const tasks = [];
  const cx = {
    spawn: (/** @type {Function} */ f) => void tasks.push(f(cx)),
    timer: { every: () => {} },
    notify: () => {},
  };
  return { cx, tasks };
}

/**
 * Runs the oracle's init (overrides read + geo listing) and returns the view instance.
 * @param {{ overridesText?: string | null, overridesFail?: boolean, ready?: string[] }} env
 */
export async function bootOracle(env) {
  if (env.overridesText != null) fake.files.set(overridesPath(fake.home), env.overridesText);
  if (env.overridesFail) fake.failing.add(overridesPath(fake.home));
  for (const f of env.ready ?? []) fake.files.set(`${geoDir(fake.home)}/${f}`, "<svg/>");
  const view = /** @type {any} */ (new SpaceIcons());
  const { cx, tasks } = initCx();
  view.init(undefined, cx);
  await Promise.all(tasks);
  return view;
}

/**
 * What the oracle's init decodes from overrides.json `text` (null: no file), and what it logged.
 * @param {string | null} text @param {{ fail?: boolean }} [opts]
 * @returns {Promise<{ overrides: Record<string, any>, logs: string[] }>}
 */
export async function decodeOverrides(text, opts = {}) {
  reset();
  /** @type {string[]} */ const logs = [];
  const log = console.log;
  console.log = (/** @type {unknown[]} */ ...a) => void logs.push(a.join(" "));
  try {
    const view = await bootOracle({ overridesText: text, overridesFail: opts.fail });
    return { overrides: view.overrides, logs };
  } finally {
    console.log = log;
  }
}

/**
 * One view-matrix case through the oracle: its recorded render tree.
 * @param {{ spaces: import("./fakes/herdr.js").FakeSpace[], theme: Record<string,string>, window: object | null,
 *           overridesText: string | null, readyNames: string[] }} c
 */
export async function renderOracle(c) {
  reset();
  fake.spaces = c.spaces;
  fake.theme = c.theme;
  fake.window = c.window;
  const { overrides } = await decodeOverrides(c.overridesText);
  reset();
  fake.spaces = c.spaces;
  fake.theme = c.theme;
  fake.window = c.window;
  const ready = c.readyNames.map((n) => {
    const ic = iconFor(n, overrides);
    return geoFile(ic.seed, ic.family);
  });
  const view = await bootOracle({ overridesText: c.overridesText, ready });
  return tree(view.render());
}

export { iconFor, geoIcon, fnv1a };
