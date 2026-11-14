// Git as a section of the sidebar (see herdr-minimal's layout: the `git` block
// shares the sidebar's height with the space tree, so its top edge, where this
// strip sits, is the sidebar's vertical middle). The strip is four short lines:
// branch and cleanliness, an operation in progress and ahead/behind; the repo
// and the last commit (or what's changed); the upstream, tag, stashes and commit
// count; a bar of the changes by kind. A click grows the body below it in place
// (a height transition, remembered across restarts): the working tree, two
// weeks of activity, recent and incoming commits, branches, worktrees, stashes
// and remotes. Colors mean the same thing everywhere, as soft tints and thin
// left rails: accent is HEAD; green staged, ahead, unpushed, in sync; amber
// modified, behind, incoming; red conflicts, gone, missing; blue untracked and
// remotes; magenta stashes; yellow tags; dim no upstream or stale. The strip lights
// up when the workspace changes or the repo changes in a way worth noticing
// (pulse.js). Narrower than NARROW the section is a rail: the glyph over a column
// of small marks (ahead/behind, the changes as an upright bar, lines changed, two
// weeks of activity, stashes, tag, last commit's age) with the strip as a hover
// card. The commit graph is too wide for the sidebar: the graph button (or
// ctrl-shift-g) opens the full view as a window.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, HoverCard } from "gpui-base";
import { run, spaces } from "herdr";
import { ICON, ago, alpha, plural, palette, hashOf, initials, compact } from "./ui.js";
import { base, samePath, repoName, shortRemote } from "./paths.js";
import { dirtyCount, changeTotals } from "./load.js";
import { pulseColor } from "./pulse.js";

/** @import { Theme, Branch, Worktree, Stash, RecentCommit } from "./types" */
/** @import { Color, Element } from "gpui-kit" */
/** @typedef {import("./main.js").default} Git */

export const STRIP = 80;       // the strip's height, margins included
export const NARROW = 160;     // below this the sidebar is the icon rail
const HEAD = 34, SEC_HEAD = 26, SEC_ROW = 24, BANNER = 38, ACTIVITY = 68;
const DAY = 86400;
const LIST_MAX = 8 * 24;       // the status card's file list, at most
/** @typedef {import("gpui-shell").TransitionPolicy} Policy */
/** @type {Policy} */ const FADE = { duration: 180, easing: "ease-out" };
/** @type {Policy} */ const EXPAND = { duration: 260, easing: "ease-in-out" };
/** @type {Policy} */ const BAR = { duration: 360, easing: "ease-out" };
/** @type {Policy} */ const GLOW_IN = { duration: 140, easing: "ease-out" };
/** @type {Policy} */ const GLOW_OUT = { duration: 1100, easing: "ease-in-out" };
/** @type {Policy} */ const LEAVE = { duration: 110, easing: "ease-in" };
/** @type {Policy} */ const ENTER = { duration: 280, easing: "ease-out" };

/** Opens (or, pressed again, closes) the full git view as a window. */
const openFull = () => run("mod.open", { name: "git" });

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
    .child(div().absolute().right(-2).bottom(-1).size(7).rounded_full().bg(stateColor(g, t)).border(1.5).border_color(t.surface));
}

/**
 * What the strip and the rail tooltip say.
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
 * Line one: glyph, branch, operation, change count, ahead/behind, chevron.
 * @param {Git} g
 * @param {Theme} t
 * @param {boolean} open
 * @param {boolean} [chevron] draw the open/closed chevron (not in the rail's card)
 * @returns {Element}
 */
function lineBranch(g, t, open, chevron = true) {
  const m = summary(g);
  const conflicts = g.status?.conflicts.length ?? 0;
  return h_flex().h(20).gap(7).items_center()
    .child(glyph(g, t))
    .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(g.repo ? t.foreground : t.dim).when(Boolean(g.repo), (e) => e.font_medium()).child(m.branch))
    .when(Boolean(m.op), (e) => e.child(h_flex().flex_none().px(4).h(15).gap(3).items_center().rounded(4)
      .bg(alpha(t.blocked, "26")).text_color(t.blocked).text_size(9.5).font_bold()
      .child(div().size(5).rounded_full().bg(t.blocked).loop("opacity", { from: 0.3, to: 1, period: 1400 }))
      .child(m.op)))
    .when(m.dirty > 0, (e) => e.child(div().flex_none().text_size(11).text_color(conflicts ? t.ansi1 : t.blocked).child(`${m.dirty}±`)))
    .when(m.ahead > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`↑${m.ahead}`)))
    .when(m.behind > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.blocked).child(`↓${m.behind}`)))
    .when(chevron, (e) => e.child(svg(ICON(open ? "chevron" : "chevron-right")).size(11).flex_none().text_color(t.dim)));
}

/**
 * Line two: the repo, then the last commit, or what's changed while dirty.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function lineDetail(g, t) {
  const repo = g.repo, s = g.status, dirty = dirtyCount(s);
  const line = h_flex().h(15).pl(25).gap(5).items_center().text_size(11).min_w(0);
  if (!repo) return line.child(div().flex_1().min_w(0).truncate().text_color(t.dim)
    .child(g.loading ? "" : "cd into a repo in this tab"));
  const name = repoName(repo.kind === "bare" ? repo.commonDir : repo.root);
  const kind = repo.kind === "linked" ? "worktree" : repo.kind === "submodule" ? "sub" : null;
  line.child(div().flex_none().max_w(96).truncate().font_medium().text_color(t.muted).child(name))
    .when(Boolean(kind), (e) => e.child(div().flex_none().px(3).h(13).flex().items_center().rounded(3).bg(t.raised).text_size(9).text_color(t.muted).child(kind)))
    .child(div().flex_none().text_color(t.dim).child("·"));
  if (dirty && s) {
    const { add, del } = changeTotals(s);
    return line.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`${plural(dirty, "file")} changed`))
      .when(add > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`+${add}`)))
      .when(del > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi1).child(`−${del}`)));
  }
  const tip = g.tip;
  return line.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tip?.subject ?? (repo.kind === "bare" ? "bare repository" : "no commits yet")))
    .when(Boolean(tip?.at), (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(tip.at))));
}

/**
 * A small tinted chip.
 * @param {string} text
 * @param {Color} color
 * @param {string | null} [icon]
 * @returns {Element}
 */
function chip(text, color, icon = null) {
  return h_flex().flex_none().px(4).h(14).gap(3).items_center().rounded(4).bg(alpha(color, "1f")).text_color(color).text_size(9.5).font_medium()
    .when(Boolean(icon), (e) => e.child(svg(ICON(icon)).size(9)))
    .child(text);
}

/**
 * Line three: where it syncs to, the latest tag and how far past it, stashes, the commit count.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function lineSync(g, t) {
  const line = h_flex().h(15).pl(25).gap(5).items_center().text_size(10.5).min_w(0);
  const s = g.status, refs = g.refs, ins = g.insight;
  if (!g.repo) return line;
  const up = s?.upstream;
  const stashes = refs.stashes.length;
  return line
    .child(div().flex_1().min_w(0).truncate()
      .when(Boolean(up), (e) => e.text_color(t.dim).child(`⟶ ${up}`))
      .when(!up && g.repo.kind !== "bare", (e) => e.italic().text_color(alpha(t.dim, "bb")).child("local only")))
    .when(Boolean(refs.tag), (e) => e.child(chip(refs.tagSince ? `${refs.tag} +${refs.tagSince}` : refs.tag, t.ansi3, "tag")))
    .when(stashes > 0, (e) => e.child(chip(String(stashes), t.ansi5, "stash")))
    .when(Boolean(ins?.total), (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child(plural(ins.total, "commit"))));
}

/**
 * Line four: the changes by kind as one bar. Segments are pixel widths so they
 * slide when the counts change; clean, it is one quiet full-width segment.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function lineBar(g, t) {
  const s = g.status;
  const groups = [
    { id: "conflicts", color: t.ansi1, n: s?.conflicts.length ?? 0 },
    { id: "staged", color: t.ansi2, n: s?.staged.length ?? 0 },
    { id: "modified", color: t.blocked, n: s?.modified.length ?? 0 },
    { id: "untracked", color: t.ansi4, n: s?.untracked.length ?? 0 },
  ];
  const total = groups.reduce((n, x) => n + x.n, 0);
  const last = groups.map((x) => x.n > 0).lastIndexOf(true);
  // Percent widths, not pixels: the measured size is in zoomed pixels and
  // w() is not, so a pixel bar comes up short whenever the app is zoomed.
  // Each segment's slot carries the gap after it, so the slots sum to 100%.
  /** @param {string} id @param {Color} color @param {number} pct @param {boolean} gap */
  const seg = (id, color, pct, gap) => div().id(`bar-${id}`).flex_none().h(3).w(`${pct}%`).pr(gap ? 2 : 0).transition("width", BAR)
    .child(div().size_full().rounded(2).bg(color));
  const segs = groups.map((x, i) => seg(x.id, x.color, total ? (x.n / total) * 100 : 0, x.n > 0 && i < last));
  const quiet = !g.repo ? t.border : alpha(t.ansi2, "40");
  return h_flex().h(3).ml(25).mt(2).items_center().overflow_hidden()
    .children(segs)
    .child(seg("clean", quiet, total ? 0 : 100, false));
}

/**
 * The strip: three lines on a card, a glow layer over it, and the content
 * dimmed and lowered while a workspace switch is loading.
 * @param {Git} g
 * @param {Theme} t
 * @param {boolean} open
 * @returns {Element}
 */
function strip(g, t, open) {
  const glow = pulseColor(g.glowKind, t), on = g.glowOn, leaving = g.switching;
  return div().id("git-strip").relative().h(STRIP - 8).flex_none().mx(6).my(4).rounded(9).overflow_hidden().cursor_pointer()
    .bg(t.surface).border_1().border_color(open ? t.border : alpha(t.border, "aa"))
    .hover((st) => st.border_color(alpha(t.accent, "55")))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); g.toggleOpen(cx); })
    .child(div().id("git-glow").absolute().inset_0().rounded(9).bg(alpha(glow, "26")).border_1().border_color(alpha(glow, "99"))
      .opacity(on ? 1 : 0).transition("opacity", on ? GLOW_IN : GLOW_OUT))
    .child(v_flex().id("git-lines").relative().px(8).pt(6).gap(2)
      .top(leaving ? 4 : 0).opacity(leaving ? 0.3 : 1)
      .transition("top", leaving ? LEAVE : ENTER).transition("opacity", leaving ? LEAVE : ENTER)
      .child(lineBranch(g, t, open)).child(lineDetail(g, t)).child(lineSync(g, t)).child(lineBar(g, t)));
}

/**
 * The rail's hover card: the strip's lines, full width, beside the rail.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function railCard(g, t) {
  return v_flex().w(250).px(10).py(8).gap(2).rounded(9).bg(t.popover).border_1().border_color(t.border)
    .text_size(13).text_color(t.foreground)
    .child(lineBranch(g, t, false, false)).child(lineDetail(g, t)).child(lineSync(g, t))
    .when(Boolean(g.status), (e) => e.child(lineBar(g, t)));
}

/**
 * The operation in progress: its short name over its step, on an amber pill.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function railOp(g, t) {
  const op = summary(g).op;
  if (!op) return null;
  const [name, step] = op.split(" ");
  return v_flex().flex_none().px(3).py(2).gap(1).items_center().rounded(4).bg(alpha(t.blocked, "26")).text_color(t.blocked)
    .child(h_flex().gap(2).items_center()
      .child(div().size(4).rounded_full().bg(t.blocked).loop("opacity", { from: 0.3, to: 1, period: 1400 }))
      .child(div().text_size(8.5).font_bold().child(name)))
    .when(Boolean(step), (e) => e.child(div().text_size(9).child(step)));
}

/**
 * Ahead over behind.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function railSync(g, t) {
  const { ahead, behind } = summary(g);
  if (!ahead && !behind) return null;
  return v_flex().flex_none().items_center().text_size(10).font_medium()
    .when(ahead > 0, (e) => e.child(div().text_color(t.ansi2).child(`↑${compact(ahead)}`)))
    .when(behind > 0, (e) => e.child(div().text_color(t.blocked).child(`↓${compact(behind)}`)));
}

/**
 * The changes by kind as an upright bar (lineBar turned on its side), the count
 * under it; clean, a short quiet stub. Percent heights, for the reason lineBar gives.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function railChanges(g, t) {
  const s = g.status;
  if (!s) return null;
  const groups = [
    { id: "conflicts", color: t.ansi1, n: s.conflicts.length },
    { id: "staged", color: t.ansi2, n: s.staged.length },
    { id: "modified", color: t.blocked, n: s.modified.length },
    { id: "untracked", color: t.ansi4, n: s.untracked.length },
  ];
  const total = groups.reduce((n, x) => n + x.n, 0);
  if (!total) return div().flex_none().w(3).h(10).rounded(2).bg(alpha(t.ansi2, "55"));
  const last = groups.map((x) => x.n > 0).lastIndexOf(true);
  const segs = groups.map((x, i) => div().id(`rail-bar-${x.id}`).flex_none().w(3).h(`${(x.n / total) * 100}%`)
    .pb(x.n > 0 && i < last ? 2 : 0).transition("height", BAR)
    .child(div().size_full().rounded(2).bg(x.color)));
  return v_flex().flex_none().gap(3).items_center()
    .child(v_flex().w(3).h(36).overflow_hidden().children(segs))
    .child(div().text_size(10).font_medium().text_color(s.conflicts.length ? t.ansi1 : t.blocked).child(compact(total)));
}

/**
 * Lines added over lines removed, while dirty.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function railDelta(g, t) {
  const { add, del } = changeTotals(g.status);
  if (!add && !del) return null;
  return v_flex().flex_none().items_center().text_size(9)
    .when(add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${compact(add)}`)))
    .when(del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${compact(del)}`)));
}

/**
 * Two weeks of commits as an upright sparkline: a row per day, oldest at the
 * top, today at the bottom in full accent; quiet days are faint dots.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function railActivity(g, t) {
  const days = g.insight?.activity;
  if (!days?.length) return null;
  const max = Math.max(1, ...days), W = 22;
  return v_flex().flex_none().w(W).gap(1)
    .children(days.map((n, i) => {
      const today = i === days.length - 1;
      const a = n ? Math.round(0x44 + (n / max) * 0x88).toString(16) : "";
      const color = !n ? t.border : today ? t.accent : alpha(t.accent, a);
      return div().id(`rail-act-${i}`).h(2).rounded(1).bg(color)
        .w(n ? Math.max(4, Math.round((n / max) * W)) : 2).transition("width", BAR);
    }));
}

/**
 * Stashes: the icon and the count.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function railStash(g, t) {
  const n = g.refs.stashes.length;
  if (!n) return null;
  return h_flex().flex_none().gap(2).items_center().text_color(t.ansi5)
    .child(svg(ICON("stash")).size(9)).child(div().text_size(9.5).child(compact(n)));
}

/**
 * The latest tag: its icon, and how far past it HEAD is.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function railTag(g, t) {
  if (!g.refs.tag) return null;
  const since = g.refs.tagSince;
  return v_flex().flex_none().items_center().text_color(since ? alpha(t.ansi3, "bb") : t.ansi3)
    .child(svg(ICON("tag")).size(10))
    .when(since > 0, (e) => e.child(div().text_size(8.5).child(`+${compact(since)}`)));
}

/**
 * How long ago the last commit was.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function railAge(g, t) {
  const at = g.tip?.at;
  if (!at) return null;
  const old = age(at, t);
  return div().flex_none().text_size(9.5).text_color(old.color).opacity(old.opacity).child(ago(at));
}

/**
 * The rail (narrow sidebar): the glyph, ringed while it glows, and under it a
 * column of small marks: an operation in progress, ahead/behind, the changes as
 * an upright bar with their count, lines added/removed, two weeks of activity,
 * stashes, the tag and the last commit's age. Marks with nothing to say are
 * left out. Hovering shows the strip's lines as a card; a click opens the full view.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
function rail(g, t) {
  const glow = pulseColor(g.glowKind, t), on = g.glowOn;
  const tile = div().relative().size(28).flex_none().rounded(7).flex().items_center().justify_center().bg(t.surface)
    .child(div().id("git-rail-glow").absolute().inset_0().rounded(7).bg(alpha(glow, "26")).border(1.5).border_color(glow)
      .opacity(on ? 1 : 0).transition("opacity", on ? GLOW_IN : GLOW_OUT))
    .child(glyph(g, t));
  const marks = g.repo
    ? [railOp(g, t), railSync(g, t), railChanges(g, t), railDelta(g, t), railActivity(g, t), railStash(g, t), railTag(g, t), railAge(g, t)]
    : [];
  const leaving = g.switching;
  const column = v_flex().id("git-rail").w(36).flex_none().items_center().gap(8).py(8).rounded(9).cursor_pointer()
    .hover((st) => st.bg(t.hover))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); openFull(); })
    .child(tile)
    .child(v_flex().id("git-rail-marks").relative().items_center().gap(8)
      .top(leaving ? 4 : 0).opacity(leaving ? 0.3 : 1)
      .transition("top", leaving ? LEAVE : ENTER).transition("opacity", leaving ? LEAVE : ENTER)
      .children(marks.filter((m) => m !== null)));
  return h_flex().w_full().flex_none().justify_center().pt(4)
    .child(HoverCard.new("git-rail-card").anchor("left_center").open_delay(250).close_delay(200)
      .trigger(column).content(railCard(g, t)));
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
 * @param {Color} color the section's color, tinting its count
 * @param {Theme} t
 * @returns {Element}
 */
function sectionHead(g, id, label, count, color, t) {
  const open = !g.folded[id];
  return h_flex().id(`sec-${id}`).h(SEC_HEAD).flex_none().px(8).gap(6).items_center().cursor_pointer().rounded(6)
    .hover((st) => st.bg(t.hover))
    .on_click((_e, cx) => { g.fold(id, open); cx.notify(); })
    .child(svg(ICON(open ? "chevron" : "chevron-right")).size(10).text_color(t.dim))
    .child(div().text_size(10.5).font_semibold().text_color(t.muted).child(label.toUpperCase()))
    .child(div().px(5).h(14).flex().items_center().rounded(7).bg(alpha(color, "1a")).text_size(9.5).font_medium().text_color(color).child(String(count)));
}

/**
 * A row with a thin colored rail at its left edge: the one way rows show their state.
 * @param {Element} row
 * @param {Color} color
 * @returns {Element}
 */
function railed(row, color) {
  return row.relative().child(div().absolute().left(12).top(5).bottom(5).w(2).rounded(1).bg(color));
}

/**
 * How stale a time is, as a text color and opacity: fresh reads, old recedes.
 * @param {number} at seconds
 * @param {Theme} t
 * @returns {{ color: Color, opacity: number }}
 */
function age(at, t) {
  const d = Date.now() / 1000 - at;
  if (!at) return { color: t.dim, opacity: 1 };
  if (d < DAY) return { color: t.muted, opacity: 1 };
  if (d < 30 * DAY) return { color: t.dim, opacity: 1 };
  return { color: t.dim, opacity: 0.55 };
}

/**
 * The branch's tracking state as a color.
 * @param {Branch} b
 * @param {Theme} t
 * @returns {Color}
 */
function trackColor(b, t) {
  if (b.gone) return t.ansi1;
  if (b.behind > 0) return t.blocked;
  if (b.ahead > 0) return t.ansi2;
  if (b.upstream) return alpha(t.ansi2, "55");
  return t.border;
}

/**
 * @param {Git} g
 * @param {Branch} b
 * @param {Theme} t
 * @returns {Element}
 */
function branchRow(g, b, t) {
  const elsewhere = b.worktree && !samePath(b.worktree, g.repo?.root) ? base(b.worktree) : null;
  const old = age(b.at, t);
  return railed(h_flex().id(`br-${b.name}`).h(SEC_ROW).flex_none().pl(24).pr(8).gap(6).items_center().text_size(12).rounded(6)
    .hover((st) => st.bg(t.hover)).cursor_pointer().tooltip(b.subject || b.name)
    .on_click(() => openFull())
    .child(div().flex_1().min_w(0).truncate().text_color(b.head ? t.accent : t.foreground).opacity(b.head ? 1 : Math.max(old.opacity, 0.75)).when(b.head, (e) => e.font_semibold()).child(b.name))
    .when(Boolean(elsewhere), (e) => e.child(svg(ICON("worktree")).size(10).flex_none().text_color(t.dim)))
    .when(b.ahead > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`↑${b.ahead}`)))
    .when(b.behind > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.blocked).child(`↓${b.behind}`)))
    .when(b.gone, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi1).child("gone")))
    .when(!b.upstream && !b.gone, (e) => e.child(div().flex_none().text_size(9.5).text_color(alpha(t.dim, "bb")).child("local")))
    .child(div().w(24).flex_none().text_right().text_size(10.5).text_color(old.color).opacity(old.opacity).child(b.at ? ago(b.at) : "")),
  b.head ? t.accent : trackColor(b, t));
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
  const color = here ? t.accent : w.prunable ? t.ansi1 : (w.dirty ?? 0) > 0 ? t.blocked : t.border;
  return railed(h_flex().id(`wt-${w.path}`).h(SEC_ROW).flex_none().pl(24).pr(8).gap(6).items_center().text_size(12).rounded(6)
    .hover((st) => st.bg(t.hover)).cursor_pointer().tooltip(w.path)
    .on_click(() => openWorktree(g, w))
    .child(div().flex_none().max_w(110).truncate().text_color(here ? t.foreground : t.muted).when(here, (e) => e.font_medium())
      .child(w.branch ?? (w.head ? `@ ${w.head.slice(0, 7)}` : "?")))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(base(w.path)))
    .when((w.dirty ?? 0) > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.blocked).child(`${w.dirty}±`)))
    .when(w.locked, (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child("locked")))
    .when(w.prunable, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi1).child("missing"))),
  color);
}

/**
 * @param {Stash} s
 * @param {Theme} t
 * @returns {Element}
 */
function stashRow(s, t) {
  return railed(h_flex().h(SEC_ROW).flex_none().pl(24).pr(8).gap(6).items_center().text_size(12)
    .child(div().flex_none().text_size(10.5).text_color(t.ansi5).child(s.ref.replace(/^stash@/, "")))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(s.subject))
    .child(div().w(24).flex_none().text_right().text_size(10.5).text_color(t.dim).child(s.at ? ago(s.at) : "")),
  alpha(t.ansi5, "99"));
}

/**
 * One recent or incoming commit: author initials, subject, age. Unpushed rows
 * carry a green rail and ↑, incoming ones an amber rail, tint and ↓.
 * @param {RecentCommit} c
 * @param {"head" | "recent" | "incoming"} kind
 * @param {Theme} t
 * @returns {Element}
 */
function commitRow(c, kind, t) {
  const pal = palette(t), who = pal[hashOf(c.email || c.author) % pal.length];
  const incoming = kind === "incoming";
  const mark = incoming ? t.blocked : c.unpushed ? t.ansi2 : null;
  const row = h_flex().id(`cm-${kind}-${c.hash}`).h(SEC_ROW).flex_none().pl(24).pr(8).gap(6).items_center().text_size(12).rounded(6)
    .when(incoming, (e) => e.bg(alpha(t.blocked, "0f")))
    .hover((st) => st.bg(t.hover)).cursor_pointer().tooltip(`${c.hash} · ${c.author}\n${c.subject}`)
    .on_click(() => openFull())
    .child(div().size(15).flex_none().rounded_full().flex().items_center().justify_center()
      .bg(alpha(who, "2e")).text_color(who).text_size(7.5).font_bold().child(initials(c.author || "?")))
    .child(div().flex_1().min_w(0).truncate()
      .text_color(kind === "head" ? t.foreground : incoming ? t.muted : alpha(t.foreground, "cc"))
      .when(kind === "head", (e) => e.font_medium())
      .child(c.subject))
    .when(Boolean(mark), (e) => e.child(div().flex_none().text_size(10.5).text_color(mark).child(incoming ? "↓" : "↑")))
    .child(div().w(24).flex_none().text_right().text_size(10.5).text_color(t.dim).child(c.at ? ago(c.at) : ""));
  return mark ? railed(row, mark) : row;
}

/**
 * Two weeks of commits as a row of bars, today's in full accent, quiet days faint.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element | null}
 */
function activity(g, t) {
  const days = g.insight?.activity;
  if (!days?.length) return null;
  const max = Math.max(1, ...days), sum = days.reduce((n, x) => n + x, 0);
  const H = 22;
  const bars = days.map((n, i) => {
    const today = i === days.length - 1;
    const h = n ? Math.max(3, Math.round((n / max) * H)) : 2;
    const a = n ? Math.round(0x44 + (n / max) * 0x88).toString(16) : "";
    const color = !n ? t.border : today ? t.accent : alpha(t.accent, a);
    return div().flex_1().h(H).flex().flex_col().justify_end().tooltip(`${plural(n, "commit")} ${today ? "today" : `${days.length - 1 - i}d ago`}`)
      .child(div().id(`act-${i}`).w_full().h(h).rounded(2).bg(color).transition("height", BAR));
  });
  const tip = g.tip;
  return v_flex().mx(12).mb(10).px(10).pt(8).pb(6).gap(5).flex_none().rounded(10).bg(t.surface).border_1().border_color(t.border)
    .child(h_flex().h(H).gap(2).items_end().children(bars))
    .child(h_flex().h(14).gap(5).items_center().text_size(10.5)
      .child(div().text_color(sum ? t.muted : t.dim).child(sum ? plural(sum, "commit") : "No commits"))
      .child(div().text_color(t.dim).child("· 14 days"))
      .child(div().flex_1())
      .when(Boolean(tip?.at), (e) => e.child(div().text_color(t.dim).child(`last ${ago(tip.at)} ago`))));
}

/**
 * @param {Git} g
 * @param {string} name
 * @param {string} url
 * @param {Theme} t
 * @returns {Element}
 */
function remoteRow(g, name, url, t) {
  const up = g.status?.upstream?.startsWith(name + "/") ?? false;
  return h_flex().id(`rm-${name}`).h(SEC_ROW).flex_none().pl(24).pr(8).gap(6).items_center().text_size(12).rounded(6)
    .hover((st) => st.bg(t.hover)).tooltip(url)
    .child(div().size(6).flex_none().rounded_full().bg(up ? t.ansi4 : alpha(t.ansi4, "66")))
    .child(div().flex_none().max_w(80).truncate().text_color(up ? t.foreground : t.muted).when(up, (e) => e.font_medium()).child(name))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(shortRemote(url)));
}

/**
 * Commits, branches, worktrees, stashes and remotes, folded independently; with their natural height.
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
  const ins = g.insight, remotes = Object.entries(g.refs.remotes);
  const commits = ins ? ins.incoming.length + ins.recent.length : 0;
  /** @type {[string, string, number, Color, () => Element[]][]} */
  const list = [
    ["commits", "Commits", commits, ins?.incoming.length ? t.blocked : ins?.recent.some((c) => c.unpushed) ? t.ansi2 : t.accent,
      () => [...ins.incoming.map((c) => commitRow(c, "incoming", t)), ...ins.recent.map((c, i) => commitRow(c, i === 0 ? "head" : "recent", t))]],
    ["branches", "Branches", branches.length, t.accent, () => branches.slice(0, 40).map((b) => branchRow(g, b, t))],
    ["worktrees", "Worktrees", worktrees.length, t.blocked, () => worktrees.map((w) => worktreeRow(g, w, t))],
    ["stashes", "Stashes", g.refs.stashes.length, t.ansi5, () => g.refs.stashes.slice(0, 20).map((s) => stashRow(s, t))],
    ["remotes", "Remotes", remotes.length, t.ansi4, () => remotes.map(([name, url]) => remoteRow(g, name, url, t))],
  ];
  for (const [id, label, count, color, make] of list) {
    // One checkout and no stashes say nothing: leave those sections out.
    if (!count || (id === "worktrees" && count < 2 && g.repo?.kind !== "bare")) continue;
    rows.push(sectionHead(g, id, label, count, color, t));
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
  const act = activity(g, t);
  if (act) { parts.push(act); height += ACTIVITY; }
  const sec = sections(g, t);
  if (sec.rows.length) { parts.push(v_flex().px(6).pb(6).children(sec.rows)); height += sec.height + 6; }
  return { parts, height };
}

/**
 * The whole section: the strip at the top of the block (the sidebar's middle),
 * and below it the body, whose height eases open and shut within the block.
 * The rest of the block stays empty (it drags the window, like the sidebar).
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
export function sidebar(g, t) {
  const root = v_flex().size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13);
  if (g.size.width < NARROW) return root.child(rail(g, t));
  const open = g.open;
  // The body stays mounted while it closes, so the shrink has something to show.
  const b = g.bodyShown ? body(g, t) : null;
  // The body asks for its full height and may shrink: flexbox caps it at the
  // space under the strip, in the same (zoomed) units it draws with. Clamping
  // against g.size here mixed zoomed and unzoomed pixels.
  const h = open && b ? b.height + 4 : 0;
  return root.child(strip(g, t, open))
    .child(div().id("git-body").flex_grow(0).flex_shrink(1).min_h(0).relative().overflow_hidden().h(h).opacity(open ? 1 : 0)
      .transition("height", EXPAND).transition("opacity", FADE)
      .when(Boolean(b), (e) => e
        .child(v_flex().id("git-scroll").absolute().inset_0().overflow_y_scroll().children(b.parts))
        .child(Scrollbar.vertical("git-scroll").absolute().inset_0())));
}
