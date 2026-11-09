// Lane layout for a commit graph: pure data, no drawing.
//
// Commits arrive newest first in topological order. Each column ("lane")
// waits for one commit hash. A row records which lanes run through its top
// half (into the row's node or straight past it) and its bottom half (out of
// the node to its parents, or straight past), so a row draws by itself and
// rows tile into continuous lines.

export const ROW = 28;          // row height, px
export const MID = ROW / 2;

export function layout(commits) {
  const lanes = [];   // hash each column waits for, or null
  const color = [];   // palette index per column
  const dash = [];    // the line in this column is dashed (uncommitted → HEAD)
  let nextColor = 0, maxCols = 1;
  const free = () => { const i = lanes.indexOf(null); return i < 0 ? lanes.length : i; };
  const index = new Map();

  const rows = commits.map((c, n) => {
    index.set(c.hash, n);
    let col = lanes.indexOf(c.hash);
    const tip = col < 0;
    if (tip) { col = free(); lanes[col] = c.hash; color[col] = c.wip ? 0 : nextColor++; dash[col] = false; }

    const top = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] == null) continue;
      if (lanes[i] === c.hash) { if (!(tip && i === col)) top.push({ from: i, to: col, color: color[i], dash: dash[i] }); }
      else top.push({ from: i, to: i, color: color[i], dash: dash[i] });
    }
    const nodeColor = color[col];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.hash && i !== col) lanes[i] = null;

    const out = []; // segments leaving the node
    const parents = c.parents;
    if (!parents.length) lanes[col] = null;
    parents.forEach((p, k) => {
      const at = lanes.indexOf(p);
      if (k === 0) {
        if (at >= 0 && at !== col) { lanes[col] = null; out.push({ from: col, to: at, color: color[at], dash: dash[at] }); }
        else { lanes[col] = p; dash[col] = Boolean(c.wip); out.push({ from: col, to: col, color: color[col], dash: dash[col] }); }
      } else if (at >= 0) {
        out.push({ from: col, to: at, color: color[at], dash: dash[at] });
      } else {
        const j = free();
        lanes[j] = p; color[j] = nextColor++; dash[j] = false;
        out.push({ from: col, to: j, color: color[j], dash: false });
      }
    });

    const bottom = [...out];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] == null || out.some((s) => s.to === i)) continue;
      bottom.push({ from: i, to: i, color: color[i], dash: dash[i] });
    }
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();

    let cols = col + 1;
    for (const s of top) cols = Math.max(cols, s.from + 1, s.to + 1);
    for (const s of bottom) cols = Math.max(cols, s.from + 1, s.to + 1);
    maxCols = Math.max(maxCols, cols);
    return { col, color: nodeColor, top, bottom, cols, merge: parents.length > 1, paths: null };
  });
  return { rows, cols: maxCols, index };
}

// Groups a row's segments by (color, dash) into stroke paths. `x(col)` is the
// lane's center. Built once per row and kept: the result only names palette
// indexes, so a theme change recolors without rebuilding.
export function rowPaths(row, x, PathBuilder) {
  const groups = new Map();
  const seg = (s, y0, y1) => {
    const k = `${s.color}:${s.dash ? 1 : 0}`;
    if (!groups.has(k)) groups.set(k, { color: s.color, dash: s.dash, segs: [] });
    groups.get(k).segs.push([x(s.from), y0, x(s.to), y1]);
  };
  for (const s of row.top) seg(s, 0, MID);
  for (const s of row.bottom) seg(s, MID, ROW);
  return [...groups.values()].map(({ color, dash, segs }) => {
    let b = PathBuilder.stroke(dash ? 1.6 : 2);
    if (dash) b = b.dash_array([3, 3]);
    for (const [x0, y0, x1, y1] of segs) {
      b = b.move_to(x0, y0);
      if (x0 === x1) b = b.line_to(x1, y1);
      else {
        const m = (y0 + y1) / 2;
        b = b.cubic_bezier_to(x1, y1, x0, m, x1, m);
      }
    }
    return { color, path: b.build() };
  });
}
