// Recorder for GPUI builder chains. Every builder call becomes { m, a } in a tree:
//   { kind, args, attrs: [{ m, a }], children: [node | { text }] }
// - `.when(c, f)` applies f or skips; it is not recorded (it is control flow, not a builder call).
// - `.child(x)` and `.children(xs)` both append to `children`.
// - `.hover(f)` records { m: "hover", a: [[...style calls]] }.
// - A function argument (a handler) becomes a label: what it does when called once with a fake
//   event and cx, as a list of herdr calls and cx calls (see herdr.js `capture`).
// - `undefined` becomes "$undefined" so JSON keeps it.
// Every attr must come before the first child; the recorder throws otherwise. This is what lets the
// core's `El(kind, attrs, children)` describe the same tree.

import { capture } from "./herdr.js";

export const UNDEF = "$undefined";
const NODE = Symbol("node");

/** @param {unknown} v */
function enc(v) {
  if (v === undefined) return UNDEF;
  if (typeof v === "function") return { handler: capture(/** @type {Function} */ (v)) };
  return v;
}

/** @param {(m: string, a: unknown[]) => void} onCall */
function chain(onCall) {
  const proxy = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        return (/** @type {unknown[]} */ ...args) => {
          onCall(prop, args);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

/** @param {string} kind @param {unknown[]} args */
export function make(kind, args) {
  const node = { kind, args: args.map(enc), attrs: /** @type {object[]} */ ([]), children: /** @type {object[]} */ ([]) };
  /** @param {unknown} x */
  const add = (x) => {
    if (typeof x === "string") node.children.push({ text: x });
    else if (x && /** @type {any} */ (x)[NODE]) node.children.push(/** @type {any} */ (x)[NODE]);
    else throw new Error(`child: not an element: ${String(x)}`);
  };
  const proxy = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === NODE) return node;
        if (prop === "toJSON") return () => node;
        if (typeof prop === "symbol" || prop === "then") return undefined;
        if (prop === "when") return (/** @type {unknown} */ c, /** @type {Function} */ f) => (c ? f(proxy) : proxy);
        if (prop === "child") return (/** @type {unknown} */ x) => (add(x), proxy);
        if (prop === "children") return (/** @type {unknown[]} */ xs) => (xs.forEach(add), proxy);
        return (/** @type {unknown[]} */ ...args) => {
          if (node.children.length) throw new Error(`${kind}.${prop}() after a child: the tree format needs attrs first`);
          if (prop === "hover") {
            /** @type {object[]} */ const style = [];
            /** @type {Function} */ (args[0])(chain((m, a) => style.push({ m, a: a.map(enc) })));
            node.attrs.push({ m: "hover", a: [style] });
          } else node.attrs.push({ m: prop, a: args.map(enc) });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

/** A plain JSON copy of a recorded tree. @param {unknown} el */
export const tree = (el) => JSON.parse(JSON.stringify(el));
