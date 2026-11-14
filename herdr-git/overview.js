// The worktree overview: the window's first page when a repo has more than one
// checkout. One card per worktree, the one you're in first, then whatever needs
// you (a conflict or a rebase stopped, an agent blocked or finished, uncommitted
// work, commits the base lacks), merged and missing ones last. Each card shows
// the agents whose terminals are in it; a click on one focuses that agent. A
// click on the card drills into the full view (status, graph, details) for that
// worktree; Esc or Back comes back here.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { run, spaces, panes } from "herdr";
import { ICON, ago, alpha, plural, compact } from "./ui.js";
import { base, samePath, repoName } from "./paths.js";
import { dirtyCount, isBaseBranch } from "./load.js";
import { agentsByWorktree, sortWorktrees, attention, totals } from "./worktrees.js";

/** @import { Theme, WorktreeSummary, Worktree, Operation } from "./types" */
/** @import { Color, Element } from "gpui-kit" */
/** @import { PaneInfo } from "herdr" */
/** @typedef {import("./main.js").default} Git */

/**
 * Opens a worktree: the space already showing it, else a new space there.
 * @param {string | null} on the machine
 * @param {Pick<Worktree, "path" | "branch">} w
 */
export function openWorktree(on, w) {
  const hit = spaces().find((s) => s.folder && samePath(s.folder, w.path) && (s.machine ?? null) === (on ?? null));
  if (hit) run("space.select", { id: hit.id });
  else run("space.new", { name: w.branch ?? base(w.path), folder: w.path, ...(on ? { machine: on } : {}) });
}

/**
 * Agents by worktree path, from the live panes.
 * @param {Git} g
 * @param {string[]} paths
 * @returns {Map<string, PaneInfo[]>}
 */
export function agentsFor(g, paths) {
  return agentsByWorktree(paths, panes(), spaces(), g.on ?? null);
}

/**
 * The overview's cards in display order (also what j/k walk).
 * @param {Git} g
 * @returns {{ list: WorktreeSummary[], agents: Map<string, PaneInfo[]> }}
 */
export function ordered(g) {
  const agents = agentsFor(g, g.overview.map((w) => w.path));
  return { list: sortWorktrees(g.overview, agents, g.repo?.root ?? null), agents };
}

/**
 * An operation's short form: "REB 2/5", "MERGE", "PICK".
 * @param {Operation} op
 * @returns {string}
 */
export function opShort(op) {
  const name = op.op === "cherry-pick" ? "PICK" : op.op === "merge" ? "MERGE" : op.op.slice(0, 3).toUpperCase();
  return name + (op.step != null && op.total != null ? ` ${op.step}/${op.total}` : "");
}

/**
 * An agent status's color.
 * @param {string | null} status
 * @param {Theme} t
 * @returns {Color}
 */
export function agentColor(status, t) {
  if (status === "blocked") return t.blocked;
  if (status === "done") return t.ansi2;
  if (status === "working") return t.accent;
  return t.dim;
}

/**
 * The agent's program glyph with its status dot; working pulses.
 * @param {PaneInfo} a
 * @param {Theme} t
 * @param {number} [size]
 * @returns {Element}
 */
export function agentGlyph(a, t, size = 16) {
  const color = agentColor(a.status, t), icon = a.program?.icon;
  const glyph = icon ? (a.program.tint ? svg(icon).size(size - 4).text_color(t.muted) : image(icon).size(size - 4))
    : div().text_size(size * 0.55).font_bold().text_color(t.muted).child((a.program?.name ?? "?").slice(0, 1).toUpperCase());
  return div().relative().size(size).flex_none().rounded(4).flex().items_center().justify_center().bg(t.raised)
    .child(glyph)
    .child(div().absolute().right(-2).bottom(-2).size(7).rounded_full().bg(color).border(1.5).border_color(t.surface)
      .when(a.status === "working", (e) => e.loop("opacity", { from: 0.35, to: 1, period: 1400 })));
}

/**
 * One agent: glyph, program, title, status. A click focuses it.
 * @param {PaneInfo} a
 * @param {Theme} t
 * @param {string} id
 * @returns {Element}
 */
export function agentRow(a, t, id) {
  const color = agentColor(a.status, t);
  return h_flex().id(id).h(22).flex_none().px(6).gap(7).items_center().rounded(5).text_size(11.5).cursor_pointer()
    .hover((st) => st.bg(t.hover)).tooltip("Focus this agent")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: a.terminal }); })
    .child(agentGlyph(a, t, 15))
    .child(div().flex_none().font_medium().text_color(t.foreground).child(a.program?.name ?? a.app ?? "agent"))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(a.title ?? ""))
    .child(div().flex_none().text_size(10.5).text_color(color).child(a.status ?? ""));
}

/**
 * A small tinted chip.
 * @param {string} text
 * @param {Color} color
 * @param {string | null} [icon]
 * @returns {Element}
 */
function chip(text, color, icon = null) {
  return h_flex().flex_none().px(5).h(16).gap(3).items_center().rounded(4).bg(alpha(color, "1f")).text_color(color).text_size(10).font_medium()
    .when(Boolean(icon), (e) => e.child(svg(ICON(icon)).size(10)))
    .child(text);
}

/**
 * The base branch's short name: "origin/main" → "main".
 * @param {string} ref
 * @returns {string}
 */
const shortBase = (ref) => ref.replace(/^[^/]+\//, "");

/**
 * The rail color for an attention rank.
 * @param {number} rank
 * @param {WorktreeSummary} w
 * @param {Theme} t
 * @returns {Color}
 */
function rankColor(rank, w, t) {
  if (w.prunable || w.error) return t.ansi1;
  return [t.ansi1, t.blocked, t.ansi2, t.blocked, t.ansi2, alpha(t.ansi2, "55"), t.border][rank] ?? t.border;
}

/**
 * The changes by kind as a thin bar; clean, one quiet segment.
 * @param {WorktreeSummary} w
 * @param {Theme} t
 * @returns {Element}
 */
function changeBar(w, t) {
  const s = w.status;
  const groups = [
    { color: t.ansi1, n: s?.conflicts.length ?? 0 },
    { color: t.ansi2, n: s?.staged.length ?? 0 },
    { color: t.blocked, n: s?.modified.length ?? 0 },
    { color: t.ansi4, n: s?.untracked.length ?? 0 },
  ].filter((x) => x.n > 0);
  const bar = h_flex().w(56).h(4).flex_none().gap(2).rounded(2).overflow_hidden();
  if (!groups.length) return bar.child(div().size_full().rounded(2).bg(s ? alpha(t.ansi2, "40") : t.border));
  return bar.children(groups.map((x) => div().h_full().rounded(2).bg(x.color).flex_basis(0).flex_grow(x.n)));
}

/**
 * One worktree's card.
 * @param {Git} g
 * @param {WorktreeSummary} w
 * @param {PaneInfo[]} agents
 * @param {Theme} t
 * @returns {Element}
 */
function card(g, w, agents, t) {
  const s = w.status, here = samePath(w.path, g.repo?.root), selected = g.overviewSel === w.path;
  const rank = attention(w, agents), rail = rankColor(rank, w, t);
  const dirty = dirtyCount(s), conflicts = s?.conflicts.length ?? 0;
  const branch = w.branch ?? (w.head ? `@ ${w.head.slice(0, 7)}` : "?");
  const isBase = isBaseBranch(w.branch, w.base?.ref ?? null);

  const line1 = h_flex().h(20).gap(7).items_center().min_w(0)
    .when(agents.length > 0, (e) => e.child(h_flex().flex_none().gap(3).children(agents.slice(0, 4).map((a) => agentGlyph(a, t)))))
    .child(div().flex_none().max_w(260).truncate().text_size(13).font_semibold().text_color(here ? t.accent : t.foreground).child(branch))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(base(w.path)))
    .when(here, (e) => e.child(chip("here", t.accent)))
    .when(Boolean(w.op), (e) => e.child(chip(opShort(w.op), t.blocked)))
    .when(conflicts > 0, (e) => e.child(chip(plural(conflicts, "conflict"), t.ansi1)))
    .when(Boolean(w.base) && !isBase && (w.base.ahead > 0 || w.base.behind > 0), (e) => e.child(h_flex().flex_none().gap(4).items_center().text_size(10.5)
      .when(w.base.ahead > 0, (e) => e.child(div().text_color(t.ansi2).child(`↑${compact(w.base.ahead)}`)))
      .when(w.base.behind > 0, (e) => e.child(div().text_color(t.blocked).child(`↓${compact(w.base.behind)}`)))
      .child(div().text_color(t.dim).child(shortBase(w.base.ref)))))
    .when(Boolean(s?.upstream) && ((s?.ahead ?? 0) > 0 || (s?.behind ?? 0) > 0), (e) => e.child(chip(
      [s.ahead ? `↑${s.ahead}` : "", s.behind ? `↓${s.behind}` : ""].filter(Boolean).join(" ") + " remote", t.ansi4)))
    .when(Boolean(s) && !s?.upstream && !isBase && Boolean(w.branch), (e) => e.child(div().flex_none().text_size(10).italic().text_color(alpha(t.dim, "bb")).child("local only")))
    .when(w.merged, (e) => e.child(chip("merged", t.ansi2, "check")))
    .when(w.fresh && !isBase, (e) => e.child(chip("no commits yet", t.dim)))
    .when(w.locked, (e) => e.child(chip("locked", t.dim)))
    .when(w.prunable, (e) => e.child(chip("missing", t.ansi1)))
    .child(div().id(`ov-open-${w.path}`).size(20).flex_none().rounded(5).flex().items_center().justify_center().cursor_pointer()
      .text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Open in a space")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); openWorktree(g.on, w); })
      .child(svg(ICON("worktree")).size(11)));

  const line2 = h_flex().h(16).gap(7).items_center().text_size(11).min_w(0);
  if (w.error) line2.child(div().flex_1().min_w(0).truncate().text_color(t.ansi1).child(w.error));
  else if (w.prunable) line2.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child("folder is gone · git worktree prune removes it"));
  else line2
    .child(changeBar(w, t))
    .child(div().flex_none().text_color(dirty ? (conflicts ? t.ansi1 : t.blocked) : t.dim).child(dirty ? plural(dirty, "file") : "clean"))
    .when(w.add > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`+${compact(w.add)}`)))
    .when(w.del > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi1).child(`−${compact(w.del)}`)))
    .child(div().flex_none().text_color(t.dim).child("·"))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(w.tip?.subject ?? "no commits yet"))
    .when(Boolean(w.tip?.at), (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(w.tip.at))));

  return v_flex().id(`ov-${w.path}`).relative().mx(12).mb(8).pl(16).pr(10).py(8).gap(4).flex_none().rounded(10).cursor_pointer()
    .bg(selected ? t.selected : t.surface).border_1().border_color(selected ? alpha(t.accent, "66") : t.border)
    .hover((st) => st.border_color(alpha(t.accent, "55")))
    .on_click((_e, cx) => { g.overviewSel = w.path; g.drill(w, cx); })
    .child(div().absolute().left(6).top(10).bottom(10).w(3).rounded(2).bg(rail))
    .child(line1).child(line2)
    .when(agents.length > 0, (e) => e.child(v_flex().pt(2).gap(1).children(agents.map((a, i) => agentRow(a, t, `ov-ag-${w.path}-${i}`)))));
}

/**
 * The page: header, then the cards.
 * @param {Git} g
 * @param {Theme} t
 * @returns {Element}
 */
export function overview(g, t) {
  const { list, agents } = ordered(g);
  const sum = totals(list, agents);
  const repo = g.repo;
  const name = repo ? repoName(repo.commonDir) : "Git";
  const stashes = g.refs.stashes.length;
  const facts = [plural(sum.count, "worktree"), sum.dirty ? `${sum.dirty} dirty` : "", sum.conflicted ? `${sum.conflicted} need attention` : "",
    sum.blocked ? `${plural(sum.blocked, "agent")} blocked` : "", sum.working ? `${sum.working} working` : ""].filter(Boolean);
  const header = h_flex().h(52).flex_none().px(16).gap(10).items_center()
    .child(div().size(28).flex_none().rounded(8).flex().items_center().justify_center()
      .bg(alpha(t.accent, "22")).border_1().border_color(alpha(t.accent, "44"))
      .child(svg(ICON("worktree")).size(15).text_color(t.accent)))
    .child(v_flex().min_w(0).gap(1)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().text_size(14).font_semibold().truncate().child(name))
        .when(Boolean(g.base), (e) => e.child(div().flex_none().px(5).h(15).flex().items_center().rounded(4).bg(t.raised).text_size(9.5).font_medium().text_color(t.muted).child(`vs ${g.base}`))))
      .child(div().text_size(11).text_color(sum.blocked || sum.conflicted ? t.blocked : t.dim).truncate().child(facts.join(" · "))))
    .child(div().flex_1())
    .when(stashes > 0, (e) => e.child(h_flex().flex_none().px(7).h(20).gap(4).items_center().rounded(10).bg(alpha(t.ansi5, "1f")).text_color(t.ansi5).text_size(11).font_medium()
      .tooltip("Stashes (shared by every worktree)").child(svg(ICON("stash")).size(11)).child(String(stashes))))
    .child(div().id("ov-refresh").size(26).flex_none().rounded(7).flex().items_center().justify_center().cursor_pointer()
      .text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Refresh (r)")
      .on_click((_e, cx) => g.refresh(cx))
      .child(g.loading || g.overviewLoading ? svg(ICON("spinner")).size(14).spin(900) : svg(ICON("refresh")).size(14)));

  const body = div().flex_1().min_h(0).relative();
  if (!list.length) return v_flex().size_full().child(header).child(body.child(g.empty(t, g.overviewLoading ? "Reading worktrees…" : "No worktrees", "")));
  return v_flex().size_full().child(header)
    .child(h_flex().h(26).flex_none().px(16).gap(8).items_center().border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim)
      .child(div().font_semibold().text_color(t.muted).child("WORKTREES"))
      .child(div().flex_1())
      .child(div().child("enter open · o space · r refresh")))
    .child(body
      .child(v_flex().id("ov-list").absolute().inset_0().overflow_y_scroll().pt(8).pb(4)
        .children(list.map((w) => card(g, w, agents.get(w.path) ?? [], t))))
      .child(Scrollbar.vertical("ov-list").absolute().inset_0()));
}
