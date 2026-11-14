// Seeded geometric icons: any string -> a 24x24 SVG drawn in currentColor, so
// gpui's svg() tints it like the Lucide glyphs. Same seed, same icon, forever.
// Everything is built from bold shapes (no strokes under 1.8 units) so it still
// reads at 17px on the rail.
//
// Order matters: changing FAMILIES or any rng call order reshuffles every icon.

export const FAMILIES = ["tiles", "radial", "rings", "stripes", "orbit", "overlap"];

const TAU = Math.PI * 2;
const FADE = 0.42;

// 32-bit FNV-1a.
/** @param {string} text */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** @param {number} a @returns {() => number} uniform in [0, 1) */
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {() => number} rnd */
function tools(rnd) {
  return {
    rnd,
    int: (/** @type {number} */ n) => Math.floor(rnd() * n),
    pick: (/** @type {any[]} */ xs) => xs[Math.floor(rnd() * xs.length)],
    chance: (/** @type {number} */ p) => rnd() < p,
  };
}

const n2 = (/** @type {number} */ v) => +v.toFixed(2);

// Regular polygon points, first vertex straight up (then turned by `rot`
// radians), shifted so its bounding box (not its centroid) sits on cx,cy.
/** @param {number} cx @param {number} cy @param {number} r @param {number} sides @param {number} [rot] */
function poly(cx, cy, r, sides, rot = 0) {
  /** @type {number[]} */ const xs = [];
  /** @type {number[]} */ const ys = [];
  for (let i = 0; i < sides; i++) {
    const a = rot - Math.PI / 2 + (i * TAU) / sides;
    xs.push(r * Math.cos(a));
    ys.push(r * Math.sin(a));
  }
  const ox = (Math.max(...xs) + Math.min(...xs)) / 2, oy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return xs.map((x, i) => `${n2(cx + x - ox)},${n2(cy + ys[i] - oy)}`).join(" ");
}

// A filled shape by name: "circle" or a side count 3..8.
/** @param {string|number} kind @param {number} cx @param {number} cy @param {number} r @param {number} rot @param {string} [attrs] */
function shape(kind, cx, cy, r, rot, attrs = "") {
  if (kind === "circle") return `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(r)}"${attrs}/>`;
  return `<polygon points="${poly(cx, cy, r, /** @type {number} */ (kind), rot)}"${attrs}/>`;
}

// Polygons look smaller than a circle of the same radius; scale them up a touch.
/** @param {string|number} kind */
const optical = (kind) => (kind === "circle" ? 1 : kind === 3 ? 1.22 : kind === 4 ? 1.1 : 1.04);

// --- families -------------------------------------------------------------

// A 3x3 grid of Bauhaus tiles, mirrored left-right.
/** @param {ReturnType<typeof tools>} r */
function tiles(r) {
  const C = 7, O = 1.5;
  const sides = ["sq", "dot", "quarter", "quarter", "tri", "half", null];
  const middles = ["sq", "dot", "half", null];
  /** @type {{ k: string|null, q: number, fade: boolean }[]} */
  let cells = [];
  for (let tries = 0; tries < 12; tries++) {
    cells = [];
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 2; col++) {
        const k = col === 0 ? r.pick(sides) : r.pick(middles);
        const q = col === 1 && k === "half" ? r.int(2) * 2 : r.int(4);
        cells.push({ k, q, fade: r.chance(0.18) });
      }
    const filled = cells.reduce((n, c, i) => n + (c.k ? (i % 2 === 0 ? 2 : 1) : 0), 0);
    if (filled >= 5 && filled <= 8) break;
  }
  /** @param {string} k */
  const body = (k) =>
    k === "sq" ? `<rect width="${C}" height="${C}" rx="0.8"/>`
    : k === "dot" ? `<circle cx="${C / 2}" cy="${C / 2}" r="${C / 2 - 0.3}"/>`
    : k === "quarter" ? `<path d="M0 0H${C}A${C} ${C} 0 0 1 0 ${C}Z"/>`
    : k === "tri" ? `<path d="M0 0H${C}L0 ${C}Z"/>`
    : `<rect width="${C}" height="${C / 2}"/>`;
  /** @type {string[]} */
  const out = [];
  cells.forEach((c, i) => {
    if (!c.k) return;
    const row = Math.floor(i / 2), col = i % 2;
    const y = O + row * C;
    const inner = `<g transform="rotate(${c.q * 90} ${C / 2} ${C / 2})"${c.fade ? ` opacity="${FADE}"` : ""}>${body(c.k)}</g>`;
    out.push(`<g transform="translate(${O + col * C} ${y})">${inner}</g>`);
    if (col === 0) out.push(`<g transform="translate(${O + 3 * C} ${y}) scale(-1 1)">${inner}</g>`);
  });
  return out.join("");
}

// n petals turned around the centre.
/** @param {ReturnType<typeof tools>} r */
function radial(r) {
  const n = r.pick([3, 4, 5, 6, 8]);
  const petal = r.pick(["leaf", "wedge", "dot", "bar"]);
  const rot = r.int(2) * (180 / n);
  const narrow = Math.sin(Math.PI / n);
  let one;
  if (petal === "leaf") one = `<ellipse cx="12" cy="6" rx="${n2(Math.min(3.2, 5.6 * narrow))}" ry="5"/>`;
  else if (petal === "wedge") { const w = Math.min(4.5, 8.5 * narrow); one = `<path d="M12 9.5L${n2(12 - w)} 1.5H${n2(12 + w)}Z"/>`; }
  else if (petal === "dot") one = `<circle cx="12" cy="4.5" r="${n2(Math.min(3.4, 6.5 * narrow))}"/>`;
  else { const w = Math.min(2.6, 5 * narrow); one = `<rect x="${n2(12 - w / 2)}" y="1.5" width="${n2(w)}" height="7.5" rx="${n2(w / 2)}"/>`; }
  const out = [];
  for (let i = 0; i < n; i++) out.push(`<g transform="rotate(${n2(rot + (i * 360) / n)} 12 12)">${one}</g>`);
  const hub = r.pick(["dot", "ring", "fade", null]);
  if (hub === "dot") out.push(`<circle cx="12" cy="12" r="2.4"/>`);
  else if (hub === "ring") out.push(`<circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>`);
  else if (hub === "fade") out.push(`<circle cx="12" cy="12" r="10.5" opacity="${FADE * 0.5}"/>`);
  return out.join("");
}

// An outlined outer shape holding a different solid one.
/** @param {ReturnType<typeof tools>} r */
function rings(r) {
  const kinds = ["circle", 3, 4, 5, 6, 8];
  const outer = r.pick(kinds);
  let inner = r.pick(kinds);
  if (inner === outer) inner = kinds[(kinds.indexOf(inner) + 1 + r.int(kinds.length - 1)) % kinds.length];
  const oRot = outer === 4 && r.chance(0.5) ? Math.PI / 4 : 0;
  const ring = shape(outer, 12, 12, 9.6 * optical(outer), oRot, ` fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"`);
  const solid = shape(inner, 12, 12, r.pick([3.6, 4.6]) * optical(inner), r.int(4) * (Math.PI / 4));
  const tint = r.chance(0.4) ? shape(outer, 12, 12, 9.6 * optical(outer), oRot, ` opacity="${FADE * 0.5}"`) : "";
  return tint + ring + solid;
}

// A silhouette filled with parallel bands.
/** @param {ReturnType<typeof tools>} r @param {string} id */
function stripes(r, id) {
  const kind = r.pick(["circle", 6, 4, 3, "diamond"]);
  const k = r.pick([2, 3, 3, 4]);
  const angle = r.pick([0, 45, 90, 135]);
  const sil =
    kind === "diamond" ? shape(4, 12, 12, 11, 0)
    : kind === 4 ? `<rect x="2.5" y="2.5" width="19" height="19" rx="3"/>`
    : shape(kind, 12, 12, 10.3 * optical(kind), 0);
  const w = 24 / (2 * k + 1);
  const bands = [];
  for (let i = 0; i < k; i++) bands.push(`<rect x="-6" y="${n2(w + i * 2 * w)}" width="36" height="${n2(w)}"/>`);
  const outline = sil.replace("/>", ` fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`);
  return `<clipPath id="${id}">${sil}</clipPath><g clip-path="url(#${id})"><g transform="rotate(${angle} 12 12)">${bands.join("")}</g></g>${outline}`;
}

// A body (often a crescent) with satellites on a track.
/** @param {ReturnType<typeof tools>} r @param {string} id */
function orbit(r, id) {
  const out = [];
  const track = r.chance(0.5);
  const R = track ? 6 : 7.5;
  const body = r.pick(["moon", "circle", 6, 4]);
  if (body === "moon") {
    const a = r.int(8) * (TAU / 8);
    out.push(`<mask id="${id}"><rect width="24" height="24" fill="#fff"/><circle cx="${n2(12 + Math.cos(a) * R * 0.75)}" cy="${n2(12 + Math.sin(a) * R * 0.75)}" r="${n2(R * 0.85)}" fill="#000"/></mask>`);
    out.push(`<circle cx="12" cy="12" r="${R}" mask="url(#${id})"/>`);
  } else out.push(shape(body, 12, 12, R * optical(body), body === 4 ? Math.PI / 4 : 0));
  if (track) out.push(`<circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" stroke-width="1.8" opacity="${FADE + 0.2}"/>`);
  const count = r.pick([1, 2, 3]);
  const start = r.int(8) * (TAU / 8);
  for (let i = 0; i < count; i++) {
    const a = start + (i * TAU) / count;
    const d = track ? 9.6 : 9.4;
    out.push(`<circle cx="${n2(12 + Math.cos(a) * d)}" cy="${n2(12 + Math.sin(a) * d)}" r="${track ? 2.4 : 2.1}"/>`);
  }
  return out.join("");
}

// Two big shapes offset on a diagonal: one solid, one faded or outlined.
/** @param {ReturnType<typeof tools>} r */
function overlap(r) {
  const kinds = ["circle", 3, 4, 6, "circle"];
  const a = r.pick(kinds), b = r.pick(kinds);
  const dir = r.int(4) * (Math.PI / 2) + Math.PI / 4;
  const dx = Math.cos(dir) * 3.6, dy = Math.sin(dir) * 3.6;
  const back = r.chance(0.5) ? ` opacity="${FADE}"` : ` fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"`;
  return (
    shape(a, 12 - dx, 12 - dy, 7 * optical(a), 0, back) +
    shape(b, 12 + dx, 12 + dy, 7 * optical(b), b === 4 ? Math.PI / 4 : 0)
  );
}

// --- entry ------------------------------------------------------------------

/**
 * @param {string} seed any string; trimmed and lower-cased like space names
 * @param {{ family?: string }} [opts] force a family (else chosen by the seed)
 * @returns {{ svg: string, family: string, hash: number }}
 */
export function geoIcon(seed, opts = {}) {
  const key = String(seed ?? "").trim().toLowerCase();
  const hash = fnv1a(key);
  const r = tools(mulberry32(hash));
  const fam = FAMILIES.includes(opts.family ?? "") ? /** @type {string} */ (opts.family) : FAMILIES[r.int(FAMILIES.length)];
  const id = `g${hash.toString(36)}`;
  const body =
    fam === "tiles" ? tiles(r)
    : fam === "radial" ? radial(r)
    : fam === "rings" ? rings(r)
    : fam === "stripes" ? stripes(r, id)
    : fam === "orbit" ? orbit(r, id)
    : overlap(r);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">${body}</svg>`;
  return { svg, family: fam, hash };
}
