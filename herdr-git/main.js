// Git: the repo's commit graph, working-tree status, branches and worktrees, read-only.
// Floating with `peek` it is a drawer (drawer.js); opened with mod.open it is a window.
// It follows the focused terminal's folder (falling back to the space's), or
// `props().folder` when given. Works in ordinary checkouts, linked worktrees,
// submodules and bare repos, locally or on a space's machine.
import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, props, placement, appHome, exec, readTextFile, watchFolder, theme, settings, nextCommand } from "herdr";
import { layout, rowPaths, ROW, MID } from "./graph.js";
import { discoverFirst } from "./discover.js";
import { READ, LIMIT, parseNumstat, loadStatus, loadHead, loadRefs, loadOperation, loadLog, classifyChange, dirtyCount } from "./load.js";
import { norm, base, repoName, samePath } from "./paths.js";
import { ICON, alpha, palette, hashOf, initials, ago } from "./ui.js";
import { drawer, drawerAvail } from "./drawer.js";
import { join } from "./paths.js";

/** @import { Commit, Detail, NumStat, Ref, Status, Theme, Repo, RefsState, Operation, ExecResult } from "./types" */
/** @import { AsyncContext, Color, Context, Element } from "gpui-kit" */
/** @import { Props } from "gpui-shell" */

const US = "\x1f";
/** @type {RefsState} */
const NO_REFS = { branches: [], worktrees: [], stashes: [], remotes: {}, tag: null };

/**
 * Folders to look for a repo in, best first, and the machine to run git on.
 * The focused terminal wins; a terminal cd'd out of any repo falls back to
 * the tab's other terminals, then the space's folder.
 * @returns {{ candidates: string[], on: string | null }}
 */
function location() {
  const p = props() ?? {};
  if (p.folder) return { candidates: [p.folder], on: p.on ?? null };
  const all = panes(), f = focused(), tab = f?.tab;
  const space = spaces().find((s) => s.tabs.some((t) => t.id === tab)) ?? spaces().find((s) => s.active);
  /** @type {string[]} */
  const list = [];
  if (f?.cwd && f.tab === tab) list.push(f.cwd);
  const fp = f?.pane ? all.find((x) => x.pane === f.pane) : null;
  if (fp?.cwd && fp.tab === tab) list.push(fp.cwd);
  for (const x of all) if (x.tab === tab && x.terminal && x.cwd) list.push(x.cwd);
  if (space?.folder) list.push(space.folder);
  return { candidates: list.filter((c, i) => list.findIndex((d) => samePath(c, d)) === i), on: space?.machine ?? null };
}
/**
 * Where this copy floats. `props().preview` draws the open drawer in an
 * ordinary pane, for checking its look without hovering.
 * @returns {ReturnType<typeof placement>}
 */
const place = () => placement() ?? (props()?.preview ? { edge: "left", align: "start", vertical: true, hovered: true, dragging: false } : null);
/** @type {() => string} */
const key = () => JSON.stringify(location());

/** @param {Operation} op @returns {string} */
const opLabel = (op) => {
  const verb = { rebase: "Rebasing", merge: "Merging", "cherry-pick": "Cherry-picking", revert: "Reverting", bisect: "Bisecting" }[op.op];
  const what = op.op === "rebase" ? (op.branch ? ` ${op.branch}` : "") + (op.onto ? ` onto ${op.onto}` : "") : op.onto ? ` ${op.onto}` : "";
  return verb + what;
};

export default class Git extends View {
  /**
   * @param {Props | undefined} _props
   * @param {AsyncContext} cx
   */
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.size = { width: 600, height: 800 };
    this.all = true;
    /** @type {Record<string, boolean>} */
    this.folded = {};
    try { this.folded = JSON.parse(localStorage.getItem("folded") ?? "{}") ?? {}; } catch { /* storage unavailable */ }
    // The drawer loads history the first time it opens; other views load at once.
    this.awake = !place();
    this.avail = drawerAvail(null, undefined);
    this.statusH = 0;
    cx.spawn(async () => {
      try { this.avail = drawerAvail(await readTextFile(join(appHome(), "window.json")), Number(settings().zoom) || 1); } catch { /* keep the default */ }
    });
    /** @type {"status" | "all" | null} */
    this.pending = null;
    this.reset();
    this.refresh(cx);
    // The watch covers local repos; this timer covers remote ones and anything it missed.
    cx.timer.every(10000, (cx) => this.refresh(cx, this.watched.length ? "status" : "all"));
    cx.timer.every(30000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else if (c === "refresh") this.refresh(cx);
        else if (c === "next") this.move(1, cx);
        else if (c === "prev") this.move(-1, cx);
        else if (c === "close") { this.sel = null; this.detail = null; }
        else if (c === "toggle-all") { this.all = !this.all; this.refresh(cx); }
        cx.notify();
      }
    });
  }

  /**
   * Folds or unfolds a section, remembered per copy.
   * @param {string} id
   * @param {boolean} folded
   */
  fold(id, folded) {
    this.folded[id] = folded;
    try { localStorage.setItem("folded", JSON.stringify(this.folded)); } catch { /* storage unavailable */ }
  }

  /** The status card's height as last drawn, margin included. */
  statusCardHeight() { return this.statusH; }

  /** The commit details panel's height. */
  detailsHeight() { return Math.min(260, this.size.height * 0.38); }

  reset() {
    /** @type {string | undefined} */
    this.context = this.context;
    /** @type {Repo | null} */
    this.repo = null;
    /** @type {string | null} */
    this.root = null;
    /** @type {string | null} */
    this.on = null;
    /** @type {string | null} */
    this.error = null;
    /** @type {Status | null} */
    this.status = null;
    /** @type {{ branch: string | null, oid: string | null }} */
    this.head = { branch: null, oid: null };
    /** @type {RefsState} */
    this.refs = NO_REFS;
    /** @type {Operation | null} */
    this.op = null;
    this.commits = /** @type {Commit[]} */ ([]);
    this.graph = null;
    this.sel = null; this.detail = null; this.loaded = false;
    /** @type {string[]} */
    this.watched = this.watched ?? [];
    this.unwatch();
  }

  /** Stops the folder watches (each loop ends at its next wake-up). */
  unwatch() { this.watchGen = (this.watchGen ?? 0) + 1; this.watched = []; }

  /**
   * Git for this repo, on its machine.
   * @param {Repo} repo
   * @param {string | null} on
   */
  runners(repo, on) {
    const cwd = repo.root ?? repo.gitDir;
    /** @param {string[]} args @returns {Promise<ExecResult>} */
    const git = (args) => exec("git", [...READ, ...args], { cwd, on });
    /** @param {string} path @param {string[]} args @returns {Promise<ExecResult>} */
    const gitAt = (path, args) => exec("git", [...READ, ...args], { cwd: path, on });
    /** @param {string} path */
    const read = (path) => readTextFile(path, { on });
    return { git, gitAt, read };
  }

  /**
   * Watches the work tree and both git dirs (a linked worktree's HEAD and
   * index live outside its folder). Local machines only: remote ones poll.
   * @param {Repo} repo
   * @param {Context} cx
   */
  watch(repo, cx) {
    if (this.on) return;
    const dirs = [repo.root, repo.gitDir, repo.commonDir].filter(Boolean)
      .filter((d, i, a) => a.findIndex((e) => samePath(d, e)) === i)
      // A main checkout's .git sits inside its root: one watch covers both.
      .filter((d, _i, a) => !a.some((e) => e !== d && norm(d).startsWith(norm(e) + "/")));
    if (dirs.length === this.watched.length && dirs.every((d, i) => samePath(d, this.watched[i]))) return;
    this.unwatch();
    this.watched = dirs;
    const gen = this.watchGen;
    for (const d of dirs) {
      cx.spawn(async (cx) => {
        try {
          while (this.watchGen === gen) {
            const changed = await watchFolder(d);
            if (this.watchGen !== gen || !this.repo) return;
            const kinds = changed.length ? changed.map((p) => classifyChange(p, this.repo)) : ["refs"];
            if (kinds.includes("refs")) this.schedule(cx, "all");
            else if (kinds.includes("status")) this.schedule(cx, "status");
          }
        } catch { if (this.watchGen === gen) this.watched = this.watched.filter((w) => w !== d); }
      });
    }
  }

  /**
   * Coalesces bursts of changes (a checkout touches thousands of files) into one refresh.
   * @param {Context} cx
   * @param {"status" | "all"} level
   */
  schedule(cx, level) {
    const had = this.pending;
    this.pending = had === "all" || level === "all" ? "all" : "status";
    if (had) return;
    cx.timer.after(250, (cx) => { const l = this.pending ?? "all"; this.pending = null; this.refresh(cx, l); });
  }

  /**
   * Reloads. "status" rereads only the working tree (a file saved); "all"
   * also rediscovers the repo and rereads refs, operation and history.
   * @param {Context} cx
   * @param {"status" | "all"} [level]
   */
  refresh(cx, level = "all") {
    if (this.loading) { this.again = this.again === "all" || level === "all" ? "all" : "status"; return; }
    const { candidates, on } = location(), context = key();
    if (context !== this.context) { this.context = context; level = "all"; }
    if (!candidates.length) { this.reset(); this.error = "No folder"; return; }
    if (!this.repo) level = "all";
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        /** @type {Repo} */
        let repo = this.repo;
        if (level === "all") {
          /** @type {(args: string[], cwd: string) => Promise<ExecResult>} */
          const probe = (args, cwd) => exec("git", args, { cwd, on });
          const found = await discoverFirst(candidates, probe, (p) => readTextFile(p, { on }));
          if (key() !== context) return;
          if (!found) { this.reset(); this.error = "Not a git repository"; this.cwd = candidates[0]; return; }
          repo = found.repo;
          // Another repo: start clean. The same one (focus moved within it): keep what's shown.
          if (!this.repo || !samePath(this.repo.gitDir, repo.gitDir) || this.on !== on) this.reset();
        }
        const { git, gitAt, read } = this.runners(repo, on);

        if (level === "status") {
          const status = await loadStatus(repo, git);
          if (key() !== context) return;
          const wasDirty = this.commits[0]?.wip ?? false, dirty = dirtyCount(status) > 0;
          this.status = status;
          // HEAD moved or the WIP row appears/disappears: the history changes too.
          if (status?.oid !== this.head.oid || dirty !== wasDirty) { this.again = "all"; return; }
          return;
        }

        const [status, refs, op, head] = await Promise.all([
          loadStatus(repo, git), loadRefs(repo, git, gitAt).catch(() => NO_REFS), loadOperation(repo, read), repo.root ? null : loadHead(git),
        ]);
        const oid = status ? status.oid : head?.oid ?? null;
        const commits = this.awake ? await loadLog(repo, git, { all: this.all, oid, dirty: dirtyCount(status), remotes: Object.keys(refs.remotes) }) : [];
        if (key() !== context) return;

        const sameHistory = this.graph && this.commits.length === commits.length && this.commits.every((c, i) => c.hash === commits[i].hash && c.parents.join() === commits[i].parents.join());
        this.repo = repo; this.root = repo.root ?? repo.commonDir; this.on = on;
        this.status = status; this.refs = refs; this.op = op;
        this.head = status ? { branch: status.branch, oid: status.oid } : head;
        this.error = null; this.loaded = true;
        if (!sameHistory) {
          this.graph = layout(commits);
          const L = this.graph.cols <= 8 ? 14 : this.graph.cols <= 16 ? 12 : 10;
          this.lane = L; this.graphWidth = this.graph.cols * L + 12;
        }
        this.commits = commits;
        this.commits.forEach((c, i) => { c.row = this.graph.rows[i]; });
        if (this.sel && !commits.some((c) => c.hash === this.sel)) { this.sel = null; this.detail = null; }
        this.watch(repo, cx);
      } catch (e) { if (key() === context) this.error = String(e.message ?? e); }
      finally {
        this.loading = false; cx.notify();
        if (this.again) { const l = this.again; this.again = null; this.refresh(cx, l); }
      }
    });
  }

  /**
   * @param {string} hash
   * @param {Context} cx
   * @param {{ toggle?: boolean, reveal?: boolean }} [opts]
   */
  select(hash, cx, { toggle = true, reveal = false } = {}) {
    if (toggle && this.sel === hash) { this.sel = null; this.detail = null; cx.notify(); return; }
    this.sel = hash;
    if (reveal) { const i = this.commits.findIndex((c) => c.hash === hash); if (i >= 0) this.scroll.scroll_to_item(i); }
    const commit = this.commits.find((c) => c.hash === hash);
    if (!commit || commit.wip) { this.detail = commit ? { hash, wip: true } : null; cx.notify(); return; }
    this.detail = { hash, loading: true };
    const { git } = this.runners(this.repo, this.on);
    cx.spawn(async (cx) => {
      const [body, files] = await Promise.all([
        git(["show", "-s", "--format=%B%x1f%ad%x1f%cn", "--date=format:%a %d %b %Y · %H:%M", hash]),
        git(["show", "--numstat", "--format=", "--diff-merges=first-parent", "-z", "--no-renames", hash]),
      ]);
      if (this.sel !== hash) return;
      const [message, date, committer] = body.stdout.split(US);
      const stats = parseNumstat(files.stdout);
      this.detail = { hash, message: (message ?? "").trim(), date: (date ?? "").trim(), committer: (committer ?? "").trim(),
        files: Object.entries(stats).map(([path, s]) => ({ path, ...s })) };
      cx.notify();
    });
    cx.notify();
  }

  /**
   * @param {number} delta
   * @param {Context} cx
   */
  move(delta, cx) {
    if (!this.commits.length) return;
    const i = this.commits.findIndex((c) => c.hash === this.sel);
    const next = Math.max(0, Math.min(this.commits.length - 1, i < 0 ? 0 : i + delta));
    this.select(this.commits[next].hash, cx, { toggle: false, reveal: true });
  }

  // ── Pieces ────────────────────────────────────────────────────────────

  /**
   * A colored pill with an icon and a text label.
   * @param {string} icon
   * @param {string} text
   * @param {Color} color
   * @param {Theme} t
   * @returns {Element}
   */
  chip(icon, text, color, t) {
    return h_flex().h(20).px(7).gap(4).items_center().flex_none().rounded(10).bg(alpha(color, "1f")).text_color(color).text_size(11).font_medium()
      .when(Boolean(icon), (e) => e.child(svg(ICON(icon)).size(11)))
      .child(text);
  }

  /**
   * @param {Theme} t
   * @returns {Element}
   */
  header(t) {
    const s = this.status, h = this.head, repo = this.repo;
    const name = repo ? repoName(repo.kind === "bare" ? repo.commonDir : repo.root) : "Git";
    const branch = repo ? (h.branch ?? (h.oid ? `detached @ ${h.oid.slice(0, 7)}` : "no commits yet")) : null;
    const kind = repo?.kind === "linked" ? "worktree" : repo?.kind === "main" ? null : repo?.kind;
    const stashes = this.refs.stashes.length;
    return h_flex().h(52).flex_none().px(16).gap(10).items_center()
      .child(div().size(28).flex_none().rounded(8).flex().items_center().justify_center()
        .bg(alpha(t.accent, "22")).border_1().border_color(alpha(t.accent, "44"))
        .child(svg(ICON("branch")).size(15).text_color(t.accent)))
      .child(v_flex().min_w(0).gap(1)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().text_size(14).font_semibold().truncate().child(name))
          .when(Boolean(kind), (e) => e.child(div().flex_none().px(5).h(15).flex().items_center().rounded(4).bg(t.raised).text_size(9.5).font_medium().text_color(t.muted).child(kind))))
        .when(Boolean(branch), (e) => e.child(h_flex().gap(5).items_center().text_size(11).min_w(0)
          .child(div().text_color(t.accent).font_medium().truncate().child(branch))
          .when(Boolean(s?.upstream), (e) => e.child(div().text_color(t.dim).truncate().child(`⟶ ${s.upstream}`)))
          .when(!s?.upstream && Boolean(this.refs.tag), (e) => e.child(div().text_color(t.dim).truncate().child(this.refs.tag))))))
      .child(div().flex_1())
      .when(Boolean(s?.ahead), (e) => e.child(this.chip("up", String(s.ahead), t.ansi2, t)))
      .when(Boolean(s?.behind), (e) => e.child(this.chip("down", String(s.behind), t.blocked, t)))
      .when(stashes > 0, (e) => e.child(this.chip("stash", String(stashes), t.ansi5, t)))
      .child(div().id("git-refresh").size(26).flex_none().rounded(7).flex().items_center().justify_center().cursor_pointer()
        .text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.refresh(cx))
        .child(this.loading ? svg(ICON("spinner")).size(14).spin(900) : svg(ICON("refresh")).size(14)));
  }

  /**
   * A banner while a rebase, merge, cherry-pick, revert or bisect is in progress.
   * @param {Theme} t
   * @returns {Element | null}
   */
  opBanner(t) {
    const op = this.op;
    if (!op) return null;
    const conflicts = this.status?.conflicts.length ?? 0;
    return h_flex().mx(12).mb(8).h(30).px(10).gap(8).flex_none().items_center().rounded(8)
      .bg(alpha(t.blocked, "1a")).border_1().border_color(alpha(t.blocked, "44")).text_size(11.5)
      .child(div().size(7).flex_none().rounded_full().bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 1400 }))
      .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(opLabel(op)))
      .when(op.step != null && op.total != null, (e) => e.child(div().flex_none().text_color(t.blocked).font_medium().child(`${op.step}/${op.total}`)))
      .when(conflicts > 0, (e) => e.child(div().flex_none().text_color(t.ansi1).child(`${conflicts} conflict${conflicts === 1 ? "" : "s"}`)));
  }

  /**
   * A bare repo has no working tree: list its checkouts instead.
   * @param {Theme} t
   * @returns {Element | null}
   */
  worktreeCard(t) {
    const wts = this.refs.worktrees.filter((w) => !w.bare);
    const card = v_flex().mx(12).mb(10).flex_none().rounded(10).bg(t.surface).border_1().border_color(t.border).overflow_hidden();
    const title = h_flex().h(34).px(12).gap(8).items_center().text_size(12)
      .child(div().font_semibold().child("Bare repository"))
      .child(div().px(6).h(17).flex().items_center().rounded(5).bg(t.raised).text_size(10.5).text_color(t.muted)
        .child(`${wts.length} worktree${wts.length === 1 ? "" : "s"}`));
    if (!wts.length) return card.child(title);
    return card.child(title).child(v_flex().border_t(1).border_color(t.border).p(4).children(wts.slice(0, 12).map((w) =>
      h_flex().h(24).px(10).gap(8).items_center().text_size(12).rounded(6)
        .child(div().flex_none().text_color(t.accent).font_medium().child(w.branch ?? (w.head ? w.head.slice(0, 7) : "?")))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(base(w.path)))
        .when((w.dirty ?? 0) > 0, (e) => e.child(div().text_size(10.5).text_color(t.blocked).child(`${w.dirty} changed`)))
        .when(w.locked, (e) => e.child(div().text_size(10.5).text_color(t.dim).child("locked"))))));
  }

  /**
   * @param {Theme} t
   * @returns {Element | null}
   */
  statusCard(t) {
    const s = this.status;
    if (!s) return null;
    const groups = [
      { id: "conflicts", label: "Conflicts", color: t.ansi1, files: s.conflicts },
      { id: "staged", label: "Staged", color: t.ansi2, files: s.staged },
      { id: "modified", label: "Changes", color: t.blocked, files: s.modified },
      { id: "untracked", label: "Untracked", color: t.ansi4, files: s.untracked },
    ].filter((g) => g.files.length);
    const total = groups.reduce((n, g) => n + g.files.length, 0);
    const card = v_flex().mx(12).mb(10).flex_none().rounded(10).bg(t.surface).border_1().border_color(t.border).overflow_hidden();
    if (!total) {
      this.statusH = 50;
      return card.child(h_flex().h(40).px(12).gap(8).items_center().text_size(12)
        .child(svg(ICON("check")).size(15).text_color(t.ansi2))
        .child(div().text_color(t.foreground).font_medium().child("Working tree clean"))
        .child(div().flex_1())
        .child(div().text_color(t.dim).text_size(11).child(s.oid ? s.oid.slice(0, 7) : "")));
    }
    const add = [...s.staged, ...s.modified].reduce((n, f) => n + (f.add ?? 0), 0);
    const del = [...s.staged, ...s.modified].reduce((n, f) => n + (f.del ?? 0), 0);

    const summary = v_flex().px(12).pt(10).pb(8).gap(7).flex_none()
      .child(h_flex().gap(8).items_center().text_size(12)
        .child(div().font_semibold().child("Working tree"))
        .child(div().px(6).h(17).flex().items_center().rounded(5).bg(t.raised).text_size(10.5).text_color(t.muted).child(`${total} file${total === 1 ? "" : "s"}`))
        .child(div().flex_1())
        .when(add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)))
        .when(del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${del}`))))
      .child(h_flex().h(6).w_full().rounded(3).overflow_hidden().gap(2)
        .children(groups.map((g) => div().h_full().rounded(3).bg(g.color).flex_basis(0).flex_grow(g.files.length))));

    // Typed on purpose: inferring this array from the pushes below takes tsc ~10 minutes.
    /** @type {import("gpui-kit").Element[]} */
    const rows = [];
    let height = 0;
    for (const g of groups) {
      const open = !this.folded[g.id];
      rows.push(h_flex().id(`grp-${g.id}`).h(26).flex_none().px(10).gap(6).items_center().cursor_pointer().rounded(6)
        .hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { this.fold(g.id, open); cx.notify(); })
        .child(svg(ICON(open ? "chevron" : "chevron-right")).size(11).text_color(t.dim))
        .child(div().size(7).rounded_full().bg(g.color))
        .child(div().text_size(11.5).font_medium().text_color(t.foreground).child(g.label))
        .child(div().text_size(10.5).text_color(t.dim).child(String(g.files.length))));
      height += 26;
      if (!open) continue;
      for (const f of g.files.slice(0, 300)) {
        const parts = f.path.split("/"), file = parts.pop();
        const color = f.code === "D" ? t.ansi1 : f.code === "A" || f.code === "?" ? t.ansi2 : f.code === "U" ? t.ansi1 : t.blocked;
        rows.push(h_flex().h(24).flex_none().pl(28).pr(10).gap(8).items_center().text_size(12).rounded(6).hover((st) => st.bg(t.hover)).id(`f-${g.id}-${f.path}`)
          .child(div().size(16).flex_none().rounded(4).flex().items_center().justify_center().bg(alpha(color, "22")).text_color(color).text_size(9.5).font_bold()
            .child(f.code === "?" ? "U" : f.code === "U" ? "!" : f.code))
          .child(h_flex().flex_1().min_w(0)
            .child(div().min_w(0).truncate().text_color(t.dim).child(parts.length ? parts.join("/") + "/" : ""))
            .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(file)))
          .when((f.add ?? 0) > 0, (e) => e.child(div().text_size(10.5).text_color(t.ansi2).child(`+${f.add}`)))
          .when((f.del ?? 0) > 0, (e) => e.child(div().text_size(10.5).text_color(t.ansi1).child(`−${f.del}`)))
          .when(Boolean(f.binary), (e) => e.child(div().text_size(10.5).text_color(t.dim).child("bin"))));
        height += 24;
      }
    }
    const max = Math.max(90, this.size.height * (this.detail ? 0.2 : 0.34));
    this.statusH = 50 + Math.min(height + 8, max) + 12;
    return card.child(summary).child(div().h(Math.min(height + 8, max)).relative().border_t(1).border_color(t.border)
      .child(v_flex().id("git-status-list").absolute().inset_0().overflow_y_scroll().p(4).children(rows))
      .child(Scrollbar.vertical("git-status-list").absolute().inset_0()));
  }

  /**
   * @param {Ref} r
   * @param {Commit} commit
   * @param {Theme} t
   * @param {Color[]} pal
   * @returns {Element}
   */
  refPill(r, commit, t, pal) {
    const lane = pal[commit.row.color % pal.length];
    const pill = h_flex().h(18).px(6).gap(4).items_center().flex_none().rounded(5).text_size(10.5).font_medium();
    /** @param {Element} e */
    const synced = (e) => e.when(Boolean(r.synced), (e) => e.child(div().text_size(9.5).opacity(0.7).child(r.synced.join(" "))));
    if (r.kind === "head") return synced(pill.bg(t.solid).text_color(t.solid_foreground).child(svg(ICON("branch")).size(10)).child(r.name));
    if (r.kind === "detached") return pill.bg(t.solid).text_color(t.solid_foreground).child("HEAD");
    if (r.kind === "local") return synced(pill.bg(alpha(lane, "24")).border_1().border_color(alpha(lane, "55")).text_color(lane).child(r.name));
    if (r.kind === "remote") return pill.border_1().border_color(t.border).text_color(t.muted).child(h_flex().child(div().text_color(t.dim).child(`${r.remote}/`)).child(r.name));
    return pill.bg(alpha(t.blocked, "1f")).text_color(t.blocked).child(svg(ICON("tag")).size(10)).child(r.name);
  }

  /**
   * @param {Commit} commit
   * @param {Theme} t
   * @param {Color[]} pal
   * @param {number} width
   * @returns {Element}
   */
  graphCell(commit, t, pal, width) {
    const row = commit.row, L = this.lane, x = (/** @type {number} */ c) => 10 + c * L;
    if (!row.paths) row.paths = rowPaths(row, x, PathBuilder);
    const cx0 = x(row.col), color = pal[row.color % pal.length];
    const cell = div().relative().h(ROW).w(width).flex_none().overflow_hidden()
      .children(row.paths.map((p) => window.paint_path(p.path, pal[p.color % pal.length]).absolute().top(0).left(0).size_full()));
    /** @param {number} size */
    const dot = (size) => div().absolute().left(cx0 - size / 2).top(MID - size / 2).size(size).rounded_full();
    if (commit.wip) return cell.child(dot(12).border(2).border_dashed().border_color(t.muted).bg(t.background));
    if (commit.head) return cell
      .child(dot(22).bg(alpha(color, "40")).loop("opacity", { from: 0.25, to: 0.9, period: 2000 }))
      .child(dot(13).bg(color).border(2).border_color(t.background))
      .child(dot(5).bg(t.background));
    if (row.merge) return cell.child(dot(10).bg(t.background).border(2).border_color(color));
    return cell.child(dot(9).bg(color));
  }

  /**
   * @param {Commit} commit
   * @param {Theme} t
   * @param {Color[]} pal
   * @param {boolean} narrow
   * @param {string} mono
   * @param {number} width
   * @returns {Element}
   */
  commitRow(commit, t, pal, narrow, mono, width) {
    const selected = this.sel === commit.hash;
    const r = h_flex().id(`c-${commit.hash}`).w_full().h(ROW).items_center().relative().pr(12)
      .when(selected, (e) => e.bg(t.selected))
      .hover((s) => s.bg(selected ? t.selected : t.hover))
      .when(selected, (e) => e.child(div().absolute().left(0).top(4).w(2).h(ROW - 8).rounded(1).bg(t.accent)))
      .child(this.graphCell(commit, t, pal, width));
    if (commit.wip) {
      const s = this.status, n = s.staged.length + s.modified.length + s.untracked.length + s.conflicts.length;
      return r.child(div().flex_1().min_w(0).truncate().text_size(12).italic().text_color(t.muted).child("Uncommitted changes"))
        .child(div().px(6).h(17).flex().items_center().rounded(5).bg(alpha(t.blocked, "1f")).text_color(t.blocked).text_size(10.5).child(`${n} changed`));
    }
    const refs = commit.refs.slice(0, narrow ? 1 : 3), more = commit.refs.length - refs.length;
    const avatar = pal[hashOf(commit.email || commit.author) % pal.length];
    return r
      .child(h_flex().gap(4).flex_none().mr(refs.length ? 8 : 0).children(refs.map((ref) => this.refPill(ref, commit, t, pal)))
        .when(more > 0, (e) => e.child(div().text_size(10).text_color(t.dim).child(`+${more}`))))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5)
        .text_color(commit.head || selected ? t.foreground : alpha(t.foreground, "d9"))
        .when(commit.head, (e) => e.font_medium())
        .child(commit.subject))
      .when(!narrow, (e) => e
        .child(div().size(18).ml(10).flex_none().rounded_full().flex().items_center().justify_center().bg(alpha(avatar, "33")).text_color(avatar).text_size(8.5).font_bold().child(initials(commit.author)))
        .child(div().w(30).flex_none().text_right().text_size(11).text_color(t.dim).child(ago(commit.at)))
        .child(div().w(58).flex_none().text_right().font_family(mono).text_size(10.5).text_color(t.dim).child(commit.hash.slice(0, 7))));
  }

  /**
   * @param {Theme} t
   * @returns {Element}
   */
  history(t) {
    const pal = palette(t), narrow = this.size.width < 440, mono = settings().font_family ?? "JetBrains Mono";
    /** @param {string} id @param {string} label @param {boolean} on */
    const seg = (id, label, on) => div().id(id).h(20).px(8).flex().items_center().rounded(5).text_size(11).cursor_pointer()
      .when(on, (e) => e.bg(t.raised).text_color(t.foreground).shadow_sm())
      .when(!on, (e) => e.text_color(t.dim).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => { if (this.all !== (id === "seg-all")) { this.all = id === "seg-all"; this.refresh(cx); } })
      .child(label);
    const count = this.commits.filter((c) => !c.wip).length;
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(34).flex_none().px(16).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().text_size(11).font_semibold().text_color(t.muted).child("HISTORY"))
        .child(div().text_size(11).text_color(t.dim).child(count >= LIMIT ? `latest ${LIMIT}` : String(count)))
        .child(div().flex_1())
        .child(h_flex().p(2).gap(2).rounded(7).bg(t.background).border_1().border_color(t.border)
          .child(seg("seg-all", "All branches", this.all)).child(seg("seg-head", "Current", !this.all))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_virtual_list("git-graph", this.commits.length, ROW, (i) => this.commits[i].hash,
          (range) => {
            // The graph column fits the lanes on screen, so a busy stretch far below doesn't push every row right.
            const shown = this.commits.slice(range.start, range.end);
            const near = this.commits.slice(Math.max(0, range.start - 6), range.end + 6);
            const cols = Math.max(1, ...near.map((c) => c.row.cols));
            const width = Math.min(cols * this.lane + 12, 240, Math.max(60, this.size.width * 0.3));
            return shown.map((c) => this.commitRow(c, t, pal, narrow, mono, width));
          })
          .size_full().track_scroll(this.scroll)
          .on_item_click((hash, cx) => { this.handle.focus(); this.select(hash, cx); }))
        .child(Scrollbar.vertical("git-graph").absolute().inset_0())
        .when(!this.commits.length && this.loaded, (e) => e.child(this.empty(t, "No commits yet", "Make the first commit and the graph starts here."))));
  }

  /**
   * @param {Theme} t
   * @returns {Element | null}
   */
  details(t) {
    const d = this.detail;
    if (!d) return null;
    const commit = this.commits.find((c) => c.hash === d.hash);
    if (!commit) return null;
    const pal = palette(t), mono = settings().font_family ?? "JetBrains Mono";
    const box = v_flex().h(this.detailsHeight()).flex_none().border_t(1).border_color(t.border).bg(t.surface);
    /** @param {Element} label */
    const bar = (label) => h_flex().h(36).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border).child(label)
      .child(div().flex_1())
      .child(div().id("git-close").px(6).h(20).flex().items_center().rounded(5).text_size(10.5).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { this.sel = null; this.detail = null; cx.notify(); }).child("Esc"));
    if (d.wip) {
      const s = this.status, files = [...s.conflicts, ...s.staged, ...s.modified, ...s.untracked];
      return box.child(bar(div().text_size(12).font_semibold().child("Uncommitted changes")))
        .child(this.fileList("git-wip-files", files.map((f) => ({ path: f.path, add: f.add ?? 0, del: f.del ?? 0, binary: f.binary })), t));
    }
    const avatar = pal[hashOf(commit.email || commit.author) % pal.length];
    const [subject, ...rest] = (d.message ?? commit.subject).split("\n");
    const body = rest.join("\n").trim();
    return box
      .child(bar(h_flex().gap(8).items_center().min_w(0)
        .child(div().px(6).h(18).flex().items_center().rounded(5).bg(t.raised).font_family(mono).text_size(10.5).text_color(t.accent).child(commit.hash.slice(0, 10)))
        .child(div().size(18).flex_none().rounded_full().flex().items_center().justify_center().bg(alpha(avatar, "33")).text_color(avatar).text_size(8.5).font_bold().child(initials(commit.author)))
        .child(div().text_size(12).font_medium().truncate().child(commit.author))
        .child(div().text_size(11).text_color(t.dim).truncate().child(d.date ?? ""))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("git-detail").absolute().inset_0().overflow_y_scroll().px(16).py(10).gap(8)
          .child(div().text_size(13).font_semibold().child(subject))
          .when(Boolean(body), (e) => e.child(div().text_size(12).text_color(t.muted).child(body)))
          .when(Boolean(d.loading), (e) => e.child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim).child(svg(ICON("spinner")).size(12).spin(900)).child("Loading…")))
          .when(Boolean(d.files), (e) => e.child(this.files(d.files, commit, t))))
        .child(Scrollbar.vertical("git-detail").absolute().inset_0()));
  }

  /**
   * @param {(NumStat & { path: string })[]} files
   * @param {Commit} commit
   * @param {Theme} t
   * @returns {Element}
   */
  files(files, commit, t) {
    const max = Math.max(1, ...files.map((f) => f.add + f.del));
    const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
    return v_flex().gap(2).pt(2)
      .child(h_flex().gap(8).pb(4).text_size(11).text_color(t.dim)
        .child(div().child(files.length ? `${files.length} file${files.length === 1 ? "" : "s"} changed` : commit.row.merge ? "Merge commit · no changes against the first parent" : "No file changes"))
        .when(add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${add}`)))
        .when(del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${del}`))))
      .children(files.slice(0, 200).map((f) => this.fileRow(f, max, t)));
  }

  /**
   * @param {string} id
   * @param {{ path: string, add: number, del: number, binary?: boolean }[]} files
   * @param {Theme} t
   * @returns {Element}
   */
  fileList(id, files, t) {
    const max = Math.max(1, ...files.map((f) => f.add + f.del));
    return div().flex_1().min_h(0).relative()
      .child(v_flex().id(id).absolute().inset_0().overflow_y_scroll().px(16).py(8).gap(2).children(files.slice(0, 300).map((f) => this.fileRow(f, max, t))))
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  /**
   * @param {{ path: string, add: number, del: number, binary?: boolean }} f
   * @param {number} max
   * @param {Theme} t
   * @returns {Element}
   */
  fileRow(f, max, t) {
    const parts = f.path.split("/"), file = parts.pop();
    const w = 48, a = Math.round((f.add / max) * w), d = Math.round((f.del / max) * w);
    return h_flex().h(22).flex_none().gap(8).items_center().text_size(12)
      .child(h_flex().flex_1().min_w(0)
        .child(div().min_w(0).truncate().text_color(t.dim).child(parts.length ? parts.join("/") + "/" : ""))
        .child(div().flex_none().max_w(260).truncate().child(file)))
      .child(div().w(36).flex_none().text_right().text_size(10.5).text_color(t.ansi2).child(f.add ? `+${f.add}` : ""))
      .child(div().w(36).flex_none().text_right().text_size(10.5).text_color(t.ansi1).child(f.del ? `−${f.del}` : f.binary ? "bin" : ""))
      .child(h_flex().w(w).h(5).flex_none().rounded(3).overflow_hidden().bg(t.raised)
        .child(div().h_full().w(a).bg(t.ansi2)).child(div().h_full().w(d).bg(t.ansi1)));
  }

  /**
   * @param {Theme} t
   * @param {string} title
   * @param {string} body
   * @returns {Element}
   */
  empty(t, title, body) {
    return v_flex().absolute().inset_0().items_center().justify_center().gap(8).p(24)
      .child(div().size(44).rounded(12).flex().items_center().justify_center().bg(t.raised).child(svg(ICON("branch")).size(20).text_color(t.dim)))
      .child(div().text_size(13).font_semibold().child(title))
      .child(div().text_size(12).text_color(t.dim).text_center().child(body));
  }

  /**
   * @param {Context} cx
   * @returns {Element}
   */
  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme();
    const where = place();
    if (where?.hovered && !this.awake) { this.awake = true; this.refresh(cx); }
    const root = v_flex().id("git").size_full().min_h(0).relative().bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "down" || k === "j") this.move(1, cx);
        else if (k === "up" || k === "k") this.move(-1, cx);
        else if (k === "escape" && this.detail) { this.sel = null; this.detail = null; cx.notify(); }
        else if (k === "r") this.refresh(cx);
        else if (k === "a") { this.all = !this.all; this.refresh(cx); }
        else return;
        cx.stop_propagation();
      });
    if (where) return root.size_full().child(drawer(this, t, where));
    if (!this.root) {
      return root.child(this.header(t)).child(div().flex_1().relative().child(
        this.loading || !this.error ? this.empty(t, "Reading repository…", "")
          : this.empty(t, this.error, this.error === "Not a git repository" ? `${this.cwd ?? "This folder"} isn't inside a git repo. cd into one in this tab's terminal.` : "")));
    }
    const banner = this.opBanner(t), card = this.repo?.kind === "bare" ? this.worktreeCard(t) : this.statusCard(t), details = this.details(t);
    return root.child(this.header(t)).when(Boolean(banner), (e) => e.child(banner)).when(Boolean(card), (e) => e.child(card))
      .child(this.history(t)).when(Boolean(details), (e) => e.child(details));
  }
}
