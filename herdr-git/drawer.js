// The git drawer: a floating block with `peek` (see herdr-minimal's layout).
// Herdr slides it out on hover. While closed, only the strip on the edge side
// shows, so that strip carries the at-a-glance state: branch and cleanliness,
// changes, ahead/behind, an operation in progress, worktrees, stashes. The
// layout never changes on hover (that keeps the slide smooth); only the
// history loads lazily the first time it opens.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { run, spaces } from "herdr";
import { ROW } from "./graph.js";
import { ICON, ago } from "./ui.js";
import { base, samePath, repoName } from "./paths.js";
import { dirtyCount } from "./load.js";

/** @import { Theme, Branch, Worktree, Stash } from "./types" */
/** @import { Color, Element } from "gpui-kit" */
/** @typedef {import("./main.js").default} Git */
/** @typedef {NonNullable<ReturnType<typeof import("herdr").placement>>} Placement */

export const STRIP = 40;      // the peek width: what shows while closed
export const BODY = 384;      // the rest, shown on hover
const SEC_HEAD = 28, SEC_ROW = 24;

/**
 * Logical height the drawer may use, from Herdr's saved window bounds and zoom.
 * Herdr gives a floating mod no size of its own, so this is a hint; 820 without one.
 * @param {string | null} windowJson the text of <appHome>/window.json
 * @param {number | undefined} zoom settings().zoom
 * @returns {number}
 */
export function drawerAvail(windowJson, zoom) {
  let h = 0;
  try { const b = JSON.parse(windowJson ?? "null")?.bounds; if (Array.isArray(b)) h = +b[3] || 0; } catch { /* no hint */ }
  const z = zoom && zoom > 0 ? zoom : 1;
  // Minus the tab bar, the work area's padding and the float's own margins.
  const avail = h ? h / z - 42 - 16 - 34 : 820;
  return Math.max(360, Math.min(avail, 1400));
}

/**
 * One cell of the strip: an icon over a short label.
 * @param {string} id
 * @param {Element} icon
 * @param {string | null} label
 * @param {Color} color
 * @param {Theme} t
 * @returns {Element}
 */
function cell(id, icon, label, color, t) {
  return v_flex().id(id).w(STRIP).h(label ? 40 : 30).flex_none().items_center().justify_center().gap(2).text_color(color)
    .child(icon)
    .when(Boolean(label), (e) => e.child(div().text_size(9.5).font_semibold().child(label)));
}

/**
 * The always-visible strip.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function strip(g, t) {
  const s = g.status, op = g.op, refs = g.refs;
  const dirty = dirtyCount(s), conflicts = s?.conflicts.length ?? 0;
  const state = !g.repo ? t.dim : conflicts ? t.ansi1 : dirty ? t.blocked : t.ansi2;
  const worktrees = refs.worktrees.filter((w) => !w.bare).length;
  /** @type {Element[]} */
  const cells = [];
  cells.push(v_flex().w(STRIP).h(44).flex_none().items_center().justify_center()
    .child(div().relative().size(22).flex().items_center().justify_center()
      .child(g.loading && !g.repo ? svg(ICON("spinner")).size(15).spin(900).text_color(t.muted) : svg(ICON("branch")).size(16).text_color(g.repo ? t.accent : t.dim))
      .child(div().absolute().right(-2).bottom(-1).size(8).rounded_full().bg(state).border(1.5).border_color(t.background))));
  if (op) cells.push(cell("s-op", div().text_size(9).font_bold().child(op.op === "cherry-pick" ? "PICK" : op.op.slice(0, 3).toUpperCase()),
    op.step != null && op.total != null ? `${op.step}/${op.total}` : null, t.blocked, t));
  if (dirty) cells.push(cell("s-dirty", div().size(6).rounded_full().bg(conflicts ? t.ansi1 : t.blocked), String(dirty), conflicts ? t.ansi1 : t.blocked, t));
  if (s?.ahead) cells.push(cell("s-up", svg(ICON("up")).size(12), String(s.ahead), t.ansi2, t));
  if (s?.behind) cells.push(cell("s-down", svg(ICON("down")).size(12), String(s.behind), t.blocked, t));
  if (worktrees > 1) cells.push(cell("s-wt", svg(ICON("worktree")).size(12), String(worktrees), t.muted, t));
  if (refs.stashes.length) cells.push(cell("s-stash", svg(ICON("stash")).size(12), String(refs.stashes.length), t.ansi5, t));
  return v_flex().w(STRIP).flex_none().items_center().pt(2).children(cells);
}

/**
 * A foldable section header.
 * @param {Git} g
 * @param {string} id
 * @param {string} label
 * @param {number} count
 * @param {Theme} t
 * @returns {Element}
 */
function sectionHead(g, id, label, count, t) {
  const open = !g.folded[id];
  return h_flex().id(`sec-${id}`).h(SEC_HEAD).flex_none().px(10).gap(6).items_center().cursor_pointer().rounded(6)
    .hover((st) => st.bg(t.hover))
    .on_click((_e, cx) => { g.fold(id, open); cx.notify(); })
    .child(svg(ICON(open ? "chevron" : "chevron-right")).size(11).text_color(t.dim))
    .child(div().text_size(11).font_semibold().text_color(t.muted).child(label.toUpperCase()))
    .child(div().text_size(10.5).text_color(t.dim).child(String(count)));
}

/**
 * @param {Git} g
 * @param {Branch} b
 * @param {Theme} t
 * @returns {Element}
 */
function branchRow(g, b, t) {
  const elsewhere = b.worktree && !samePath(b.worktree, g.repo?.root) ? base(b.worktree) : null;
  return h_flex().id(`br-${b.name}`).h(SEC_ROW).flex_none().pl(27).pr(10).gap(6).items_center().text_size(12).rounded(6)
    .hover((st) => st.bg(t.hover)).cursor_pointer()
    .on_click((_e, cx) => { const c = g.commits.find((x) => x.hash.startsWith(b.oid)); if (c) g.select(c.hash, cx, { toggle: false, reveal: true }); })
    .child(div().flex_none().max_w(170).truncate().text_color(b.head ? t.accent : t.foreground).when(b.head, (e) => e.font_semibold()).child(b.name))
    .when(Boolean(elsewhere), (e) => e.child(h_flex().flex_none().gap(3).items_center().text_size(10).text_color(t.dim)
      .child(svg(ICON("worktree")).size(10)).child(div().max_w(80).truncate().child(elsewhere))))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(b.subject))
    .when(b.ahead > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`↑${b.ahead}`)))
    .when(b.behind > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.blocked).child(`↓${b.behind}`)))
    .when(b.gone, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi1).child("gone")))
    .child(div().w(26).flex_none().text_right().text_size(10.5).text_color(t.dim).child(b.at ? ago(b.at) : ""));
}

/**
 * Opens a worktree: the space already showing it, else a new space there.
 * @param {Git} g
 * @param {Worktree} w
 */
function openWorktree(g, w) {
  const hit = spaces().find((s) => s.folder && samePath(s.folder, w.path) && (s.machine ?? null) === (g.on ?? null));
  if (hit) run("space.select", { id: hit.id });
  else run("space.new", { name: w.branch ?? base(w.path), folder: w.path, ...(g.on ? { machine: g.on } : {}) });
}

/**
 * @param {Git} g
 * @param {Worktree} w
 * @param {Theme} t
 * @returns {Element}
 */
function worktreeRow(g, w, t) {
  const here = samePath(w.path, g.repo?.root);
  return h_flex().id(`wt-${w.path}`).h(SEC_ROW).flex_none().pl(27).pr(10).gap(6).items_center().text_size(12).rounded(6)
    .hover((st) => st.bg(t.hover)).cursor_pointer()
    .on_click(() => openWorktree(g, w))
    .child(div().size(6).flex_none().rounded_full().bg(here ? t.accent : (w.dirty ?? 0) > 0 ? t.blocked : t.border))
    .child(div().flex_none().max_w(150).truncate().text_color(here ? t.foreground : t.muted).when(here, (e) => e.font_medium())
      .child(w.branch ?? (w.head ? `@ ${w.head.slice(0, 7)}` : "?")))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(base(w.path)))
    .when((w.dirty ?? 0) > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.blocked).child(`${w.dirty}±`)))
    .when(w.locked, (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child("locked")))
    .when(w.prunable, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi1).child("missing")));
}

/**
 * @param {Stash} s
 * @param {Theme} t
 * @returns {Element}
 */
function stashRow(s, t) {
  return h_flex().h(SEC_ROW).flex_none().pl(27).pr(10).gap(6).items_center().text_size(12)
    .child(div().flex_none().text_size(10.5).text_color(t.ansi5).child(s.ref.replace(/^stash@/, "")))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(s.subject))
    .child(div().w(26).flex_none().text_right().text_size(10.5).text_color(t.dim).child(s.at ? ago(s.at) : ""));
}

/**
 * Branches, worktrees and stashes, folded independently; with its natural height.
 * @param {Git} g
 * @param {Theme} t
 * @returns {{ rows: Element[], height: number }}
 */
function sections(g, t) {
  /** @type {Element[]} */
  const rows = [];
  let height = 0;
  const branches = [...g.refs.branches].sort((a, b) => Number(b.head) - Number(a.head) || b.at - a.at);
  const worktrees = g.refs.worktrees.filter((w) => !w.bare);
  /** @type {[string, string, number, () => Element[]][]} */
  const list = [
    ["branches", "Branches", branches.length, () => branches.slice(0, 60).map((b) => branchRow(g, b, t))],
    ["worktrees", "Worktrees", worktrees.length, () => worktrees.map((w) => worktreeRow(g, w, t))],
    ["stashes", "Stashes", g.refs.stashes.length, () => g.refs.stashes.slice(0, 30).map((s) => stashRow(s, t))],
  ];
  for (const [id, label, count, make] of list) {
    // One checkout and no stashes say nothing: leave those sections out.
    if (!count || (id === "worktrees" && count < 2 && g.repo?.kind !== "bare")) continue;
    rows.push(sectionHead(g, id, label, count, t));
    height += SEC_HEAD;
    if (g.folded[id]) continue;
    const items = make();
    rows.push(...items);
    height += items.length * SEC_ROW;
  }
  return { rows, height };
}

/**
 * The whole drawer: the strip plus the body, one fixed layout.
 * @param {Git} g
 * @param {Theme} t
 * @param {Placement} place
 * @returns {Element}
 */
export function drawer(g, t, place) {
  const avail = g.avail;
  g.size = { width: BODY, height: avail };
  const right = place.edge === "right";

  /** @type {Element[]} */
  const body = [];
  let used = 52; // header
  body.push(g.header(t));
  if (!g.repo) {
    body.push(div().h(120).relative().child(g.loading || !g.error ? g.empty(t, "Reading repository…", "")
      : g.empty(t, g.error, g.error === "Not a git repository" ? "Focus a terminal inside a repo." : "")));
    return frame(strip(g, t), v_flex().w(BODY).flex_none().children(body), right, t);
  }
  const banner = g.opBanner(t);
  if (banner) { body.push(banner); used += 38; }
  if (g.repo.kind !== "bare") {
    const card = g.statusCard(t);
    if (card) { body.push(card); used += g.statusCardHeight(); }
  }
  const sec = sections(g, t);
  if (sec.rows.length) {
    const h = Math.min(sec.height + 8, Math.max(SEC_HEAD * 3, Math.round((avail - used) * 0.4)));
    body.push(div().mx(8).mb(6).h(h).flex_none().relative()
      .child(v_flex().id("git-sections").absolute().inset_0().overflow_y_scroll().py(4).children(sec.rows))
      .child(Scrollbar.vertical("git-sections").absolute().inset_0()));
    used += h + 6;
  }
  const details = g.details(t);
  const detailsH = details ? g.detailsHeight() : 0;
  // History: as many rows as fit (at least a few), or all of them.
  const want = Math.max(1, g.commits.length) * ROW + 34;
  const histH = Math.max(34 + ROW * 4, Math.min(want, avail - used - detailsH));
  body.push(div().h(histH).flex_none().flex().flex_col().child(g.awake ? g.history(t)
    : v_flex().flex_1().items_center().justify_center().text_size(11).text_color(t.dim).child(`${repoName(g.root)} · history loads on open`)));
  if (details) body.push(details);
  return frame(strip(g, t), v_flex().w(BODY).flex_none().children(body), right, t);
}

/**
 * Puts the strip on the edge side (mirrored on the right edge).
 * @param {Element} s
 * @param {Element} b
 * @param {boolean} right
 * @param {Theme} t
 * @returns {Element}
 */
function frame(s, b, right, t) {
  const edge = right ? div().flex_none().self_stretch().border_l(1).border_color(t.border).child(s) : div().flex_none().self_stretch().border_r(1).border_color(t.border).child(s);
  return h_flex().items_start().text_color(t.foreground).text_size(13).children(right ? [b, edge] : [edge, b]);
}
