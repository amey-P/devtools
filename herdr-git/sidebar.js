// Git as a section of the sidebar (see herdr-minimal's layout: the `git` block
// between the space tree and usage). Closed, the block is one summary row:
// branch and cleanliness, an operation in progress, changes, ahead/behind.
// A click grows the block (to its content, at most 45% of the window) with `layout.resize` (Herdr saves the size, so it
// stays open across restarts) and the body fades in: the working tree,
// branches, worktrees and stashes. The commit graph is too wide for the
// sidebar: the graph button (or ctrl-shift-g) opens the full view as a window.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { run, spaces } from "herdr";
import { ICON, ago, alpha } from "./ui.js";
import { base, samePath, repoName } from "./paths.js";
import { dirtyCount } from "./load.js";

/** @import { Theme, Branch, Worktree, Stash } from "./types" */
/** @import { Color, Element } from "gpui-kit" */
/** @typedef {import("./main.js").default} Git */

export const CLOSED = 36;      // the summary row: the block's closed height
export const NARROW = 160;     // below this the sidebar is the icon rail
const HEAD = 34, SEC_HEAD = 26, SEC_ROW = 24, BANNER = 38;
const LIST_MAX = 8 * 24;       // the status card's file list, at most
/** @type {import("gpui-shell").TransitionPolicy} */
const FADE = { duration: 160, easing: "ease-out" };

/** Opens (or, pressed again, closes) the full git view as a window. */
const openFull = () => run("mod.open", { name: "git" });

/**
 * Logical window height, from Herdr's saved window bounds and zoom; 900 without one.
 * Herdr tells a mod only its own block's size, so this caps how far the section opens.
 * @param {string | null} windowJson the text of <appHome>/window.json
 * @param {number | undefined} zoom settings().zoom
 * @returns {number}
 */
export function windowHeight(windowJson, zoom) {
  let h = 0;
  try { const b = JSON.parse(windowJson ?? "null")?.bounds; if (Array.isArray(b)) h = +b[3] || 0; } catch { /* no hint */ }
  const z = zoom && zoom > 0 ? zoom : 1;
  return h ? Math.max(400, h / z) : 900;
}

/**
 * The state dot's color: no repo, conflicts, dirty, clean.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Color}
 */
function stateColor(g, t) {
  const s = g.status;
  if (!g.repo) return t.dim;
  if (s?.conflicts.length) return t.ansi1;
  return dirtyCount(s) ? t.blocked : t.ansi2;
}

/**
 * The branch glyph with the state dot in its corner.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function glyph(g, t) {
  return div().relative().size(18).flex_none().flex().items_center().justify_center()
    .child(g.loading && !g.repo ? svg(ICON("spinner")).size(13).spin(900).text_color(t.muted)
      : svg(ICON("branch")).size(14).text_color(g.repo ? t.accent : t.dim))
    .child(div().absolute().right(-2).bottom(-1).size(7).rounded_full().bg(stateColor(g, t)).border(1.5).border_color(t.chrome));
}

/**
 * What the closed row and the rail tooltip say.
 * @param {Git} g
 * @returns {{ branch: string, op: string | null, dirty: number, ahead: number, behind: number }}
 */
function summary(g) {
  const s = g.status, h = g.head, op = g.op;
  const branch = !g.repo ? (g.loading ? "Reading repository…" : "No git repository")
    : g.repo.kind === "bare" ? `${repoName(g.repo.commonDir)} (bare)`
    : h.branch ?? (h.oid ? `@ ${h.oid.slice(0, 7)}` : "no commits yet");
  const opText = op ? (op.op === "cherry-pick" ? "PICK" : op.op.slice(0, 3).toUpperCase()) + (op.step != null && op.total != null ? ` ${op.step}/${op.total}` : "") : null;
  return { branch, op: opText, dirty: dirtyCount(s), ahead: s?.ahead ?? 0, behind: s?.behind ?? 0 };
}

/**
 * The closed row (also the open section's title bar).
 * @param {Git} g
 * @param {Theme} t
 * @param {boolean} open
 * @returns {Element}
 */
function row(g, t, open) {
  const m = summary(g);
  const conflicts = g.status?.conflicts.length ?? 0;
  return h_flex().id("git-row").h(CLOSED).flex_none().mx(6).px(6).gap(7).items_center().rounded(6).cursor_pointer()
    .text_size(12.5).hover((st) => st.bg(t.hover))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); g.toggleSidebar(open); })
    .child(glyph(g, t))
    .child(div().flex_1().min_w(0).truncate().text_color(g.repo ? t.foreground : t.dim).when(Boolean(g.repo), (e) => e.font_medium()).child(m.branch))
    .when(Boolean(m.op), (e) => e.child(div().flex_none().px(4).h(15).flex().items_center().rounded(4)
      .bg(alpha(t.blocked, "26")).text_color(t.blocked).text_size(9.5).font_bold().child(m.op)))
    .when(m.dirty > 0, (e) => e.child(div().flex_none().text_size(11).text_color(conflicts ? t.ansi1 : t.blocked).child(`${m.dirty}±`)))
    .when(m.ahead > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`↑${m.ahead}`)))
    .when(m.behind > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.blocked).child(`↓${m.behind}`)))
    .child(svg(ICON(open ? "chevron" : "chevron-right")).size(11).flex_none().text_color(t.dim));
}

/**
 * The rail (narrow sidebar): only the glyph; a click opens the full view.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function rail(g, t) {
  const m = summary(g);
  const tip = [m.branch, m.op, m.dirty ? `${m.dirty} changed` : null, m.ahead ? `↑${m.ahead}` : null, m.behind ? `↓${m.behind}` : null].filter(Boolean).join(" · ");
  return h_flex().id("git-rail").h(CLOSED).flex_none().w_full().justify_center().items_center().cursor_pointer()
    .tooltip(tip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); openFull(); })
    .child(div().size(26).rounded(6).flex().items_center().justify_center().hover((st) => st.bg(t.hover)).child(glyph(g, t)));
}

/**
 * A small square button.
 * @param {string} id
 * @param {Element} icon
 * @param {string} tip
 * @param {(cx: import("gpui-kit").Context) => void} act
 * @param {Theme} t
 * @returns {Element}
 */
function button(id, icon, tip, act, t) {
  return div().id(id).size(22).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer()
    .text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); act(cx); })
    .child(icon);
}

/**
 * Repo name, kind, upstream or tag, and the graph and refresh buttons.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function head(g, t) {
  const repo = g.repo, s = g.status;
  const name = repo ? repoName(repo.kind === "bare" ? repo.commonDir : repo.root) : "Git";
  const kind = repo?.kind === "linked" ? "worktree" : repo?.kind === "main" ? null : repo?.kind;
  const where = s?.upstream ? `⟶ ${s.upstream}` : g.refs.tag ?? "";
  const stashes = g.refs.stashes.length;
  return h_flex().h(HEAD).flex_none().px(12).gap(6).items_center().text_size(11.5)
    .child(div().flex_none().max_w(110).truncate().font_semibold().text_color(t.muted).child(name))
    .when(Boolean(kind), (e) => e.child(div().flex_none().px(4).h(14).flex().items_center().rounded(4).bg(t.raised).text_size(9.5).text_color(t.muted).child(kind)))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(where))
    .when(stashes > 0, (e) => e.child(h_flex().flex_none().gap(2).items_center().text_size(10.5).text_color(t.ansi5)
      .child(svg(ICON("stash")).size(10)).child(String(stashes))))
    .child(button("git-graph", svg(ICON("branch")).size(12), "Commit graph (ctrl-shift-g)", openFull, t))
    .child(button("git-refresh", g.loading ? svg(ICON("spinner")).size(12).spin(900) : svg(ICON("refresh")).size(12), "Refresh", (cx) => g.refresh(cx), t));
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
  return h_flex().id(`sec-${id}`).h(SEC_HEAD).flex_none().px(8).gap(6).items_center().cursor_pointer().rounded(6)
    .hover((st) => st.bg(t.hover))
    .on_click((_e, cx) => { g.fold(id, open); cx.notify(); })
    .child(svg(ICON(open ? "chevron" : "chevron-right")).size(10).text_color(t.dim))
    .child(div().text_size(10.5).font_semibold().text_color(t.muted).child(label.toUpperCase()))
    .child(div().text_size(10).text_color(t.dim).child(String(count)));
}

/**
 * @param {Git} g
 * @param {Branch} b
 * @param {Theme} t
 * @returns {Element}
 */
function branchRow(g, b, t) {
  const elsewhere = b.worktree && !samePath(b.worktree, g.repo?.root) ? base(b.worktree) : null;
  return h_flex().id(`br-${b.name}`).h(SEC_ROW).flex_none().pl(24).pr(8).gap(6).items_center().text_size(12).rounded(6)
    .hover((st) => st.bg(t.hover)).cursor_pointer().tooltip(b.subject || b.name)
    .on_click(() => openFull())
    .child(div().flex_1().min_w(0).truncate().text_color(b.head ? t.accent : t.foreground).when(b.head, (e) => e.font_semibold()).child(b.name))
    .when(Boolean(elsewhere), (e) => e.child(svg(ICON("worktree")).size(10).flex_none().text_color(t.dim)))
    .when(b.ahead > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`↑${b.ahead}`)))
    .when(b.behind > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.blocked).child(`↓${b.behind}`)))
    .when(b.gone, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi1).child("gone")))
    .child(div().w(24).flex_none().text_right().text_size(10.5).text_color(t.dim).child(b.at ? ago(b.at) : ""));
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
  return h_flex().id(`wt-${w.path}`).h(SEC_ROW).flex_none().pl(24).pr(8).gap(6).items_center().text_size(12).rounded(6)
    .hover((st) => st.bg(t.hover)).cursor_pointer().tooltip(w.path)
    .on_click(() => openWorktree(g, w))
    .child(div().size(6).flex_none().rounded_full().bg(here ? t.accent : (w.dirty ?? 0) > 0 ? t.blocked : t.border))
    .child(div().flex_none().max_w(110).truncate().text_color(here ? t.foreground : t.muted).when(here, (e) => e.font_medium())
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
  return h_flex().h(SEC_ROW).flex_none().pl(24).pr(8).gap(6).items_center().text_size(12)
    .child(div().flex_none().text_size(10.5).text_color(t.ansi5).child(s.ref.replace(/^stash@/, "")))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(s.subject))
    .child(div().w(24).flex_none().text_right().text_size(10.5).text_color(t.dim).child(s.at ? ago(s.at) : ""));
}

/**
 * Branches, worktrees and stashes, folded independently; with their natural height.
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
    ["branches", "Branches", branches.length, () => branches.slice(0, 40).map((b) => branchRow(g, b, t))],
    ["worktrees", "Worktrees", worktrees.length, () => worktrees.map((w) => worktreeRow(g, w, t))],
    ["stashes", "Stashes", g.refs.stashes.length, () => g.refs.stashes.slice(0, 20).map((s) => stashRow(s, t))],
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
 * The open body's parts and the height they want.
 * @param {Git} g
 * @param {Theme} t
 * @returns {{ parts: Element[], height: number }}
 */
function body(g, t) {
  /** @type {Element[]} */
  const parts = [head(g, t)];
  let height = HEAD;
  if (!g.repo) {
    parts.push(div().px(14).pb(10).text_size(11.5).text_color(t.dim)
      .child(g.loading ? "Reading repository…" : g.error === "Not a git repository" || !g.error ? "The focused terminal isn't in a git repo." : g.error));
    return { parts, height: height + 30 };
  }
  const banner = g.opBanner(t);
  if (banner) { parts.push(banner); height += BANNER; }
  const card = g.repo.kind === "bare" ? g.worktreeCard(t) : g.statusCard(t, { maxList: LIST_MAX });
  if (card) { parts.push(card); height += g.repo.kind === "bare" ? 34 + 10 : g.statusCardHeight(); }
  const sec = sections(g, t);
  if (sec.rows.length) { parts.push(v_flex().px(6).pb(6).children(sec.rows)); height += sec.height + 6; }
  return { parts, height };
}

/**
 * How tall the open section wants to be, the summary row included.
 * @param {Git} g
 * @param {Theme} t
 * @returns {number}
 */
export function naturalHeight(g, t) {
  return CLOSED + body(g, t).height + 4;
}

/**
 * The whole section: the summary row, and below it, while the block is open,
 * the body in a scroll area that fades in.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
export function sidebar(g, t) {
  const narrow = g.size.width < NARROW;
  const open = !narrow && g.size.height > CLOSED + 4;
  const root = v_flex().size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13).border_t(1).border_color(t.border);
  if (narrow) return root.child(rail(g, t));
  // The body stays mounted (empty while closed) so its opacity eases in after a resize.
  return root.child(row(g, t, open)).child(div().id("git-body").flex_1().min_h(0).relative().opacity(open ? 1 : 0).transition("opacity", FADE)
    .when(open, (e) => e
      .child(v_flex().id("git-scroll").absolute().inset_0().overflow_y_scroll().children(body(g, t).parts))
      .child(Scrollbar.vertical("git-scroll").absolute().inset_0())));
}
