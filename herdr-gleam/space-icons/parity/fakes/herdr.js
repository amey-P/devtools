// Fake "herdr" module. Tests set `fake` (spaces, theme, window, files, checking) before a run and
// read `fake.log` after. `capture(fn)` runs a handler once and returns what it did.

/** @typedef {{ id: string, name: string, status: string | null, active: boolean, machine: string | null }} FakeSpace */

export const fake = {
  /** @type {FakeSpace[]} */ spaces: [],
  /** @type {Record<string, string>} */ theme: {},
  /** @type {object | null} */ window: null,
  home: "/HOME",
  checking: false,
  /** path -> text; a missing path reads as null */
  /** @type {Map<string, string>} */ files: new Map(),
  /** paths that reject when read or written */
  /** @type {Set<string>} */ failing: new Set(),
  /** dirs that reject on mkdir/readdir */
  /** @type {Set<string>} */ failingDirs: new Set(),
  /** every herdr / fs call, in order */
  /** @type {unknown[][]} */ log: [],
  /** @type {unknown[][] | null} */ sink: null,
};

export function reset() {
  fake.spaces = [];
  fake.theme = {};
  fake.window = null;
  fake.checking = false;
  fake.files = new Map();
  fake.failing = new Set();
  fake.failingDirs = new Set();
  fake.log = [];
  fake.sink = null;
}

/** @param {unknown[]} entry */
export function note(entry) {
  (fake.sink ?? fake.log).push(entry);
}

/** A fake cx for handlers: records the calls a handler makes on it. */
export const handlerCx = {
  stop_propagation: () => note(["cx.stop_propagation"]),
  notify: () => note(["cx.notify"]),
};

/** Runs a handler once with a fake event and cx and returns what it did. @param {Function} fn */
export function capture(fn) {
  const outer = fake.sink;
  /** @type {unknown[][]} */ const calls = [];
  fake.sink = calls;
  try {
    fn({ button: "fake" }, handlerCx);
  } finally {
    fake.sink = outer;
  }
  return calls;
}

export const spaces = () => fake.spaces;
export const theme = () => fake.theme;
export const window = () => fake.window;
export const appHome = () => fake.home;
export const checking = () => fake.checking;
/** @param {string} name @param {Record<string, unknown>} [args] */
export const run = (name, args) => (note(args === undefined ? ["run", name] : ["run", name, args]), null);
/** @param {object} spec */
export const openOverlay = (spec) => (note(["openOverlay", spec]), "overlay-1");
/** @param {string} path */
export async function readTextFile(path) {
  note(["readTextFile", path]);
  if (fake.failing.has(path)) throw new Error(`EACCES: ${path}`);
  return fake.files.get(path) ?? null;
}
