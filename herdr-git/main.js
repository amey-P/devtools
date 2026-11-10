// Git: the repo's commit graph and working-tree status, read-only.
// Opens as a pane beside the terminals (ctrl-shift-g). It shows the repo of
// the terminal in its own tab, or `props().folder` when given.
import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, props, exec, watchFolder, theme, settings, nextCommand } from "herdr";
import { layout, rowPaths, ROW, MID } from "./graph.js";

/** @import { Commit, Detail, NumStat, Ref, Status, Theme } from "./types" */
/** @import { AsyncContext, Color, Context, Element } from "gpui-kit" */
/** @import { Props } from "gpui-shell" */

/** @type {(name: string) => string} */
const ICON = (name) => `mods/git/${name}.svg`;
// Reads write nothing under .git (no index refresh, lock or fsmonitor
// cookie), so the folder watch never sees our own reads.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "color.ui=false"];
const LIMIT = 400;
const US = "\x1f", RS = "\x1e";

/**
 * A theme color with a new hex-alpha suffix: (#rrggbb, "1f") → #rrggbb1f.
 * @param {Color} c
 * @param {string} a
 * @returns {Color}
 */
const alpha = (c, a) => (typeof c === "string" && c.startsWith("#") ? /** @type {Color} */ (c.slice(0, 7) + a) : c);
/**
 * The lane colors for a theme, in graph order.
 * @param {Theme} t
 * @returns {Color[]}
 */
const palette = (t) => [t.accent, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi4, t.ansi1, t.ansi13, t.ansi14, t.ansi10];
/** @type {(s: string) => number} */
const hashOf = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
/** @param {string} name */
const initials = (name) => (name.trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("") || "?").toUpperCase();

/** @param {number} sec @returns {string} */
function ago(sec) {
  const d = Date.now() / 1000 - sec;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`;
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))}mo`;
  return `${Math.floor(d / (86400 * 365))}y`;
}

/**
 * The folder this copy of the mod watches and the machine it runs commands on.
 * @returns {{ cwd: string | null, on: string | null }}
 */
function location() {
  const p = props() ?? {};
  if (p.folder) return { cwd: p.folder, on: p.on ?? null };
  const all = panes(), me = p.pane ? all.find((x) => x.pane === p.pane) : null;
  const tab = me?.tab ?? focused()?.tab;
  const space = spaces().find((s) => s.tabs.some((t) => t.id === tab)) ?? spaces().find((s) => s.active);
  const term = all.find((x) => x.tab === tab && x.terminal && x.cwd);
  return { cwd: term?.cwd || space?.folder || null, on: space?.machine ?? null };
}
/** @type {() => string} */
const key = () => JSON.stringify(location());

/** @param {string} text @returns {Status} */
function parseStatus(text) {
  /** @type {Status} */
  const out = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, staged: [], modified: [], untracked: [], conflicts: [] };
  const parts = text.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith("# ")) {
      const [, k, ...v] = line.split(" ");
      if (k === "branch.head") out.branch = v.join(" ") === "(detached)" ? null : v.join(" ");
      else if (k === "branch.oid") out.oid = v[0] === "(initial)" ? null : v[0];
      else if (k === "branch.upstream") out.upstream = v.join(" ");
      else if (k === "branch.ab") { out.ahead = Math.abs(+v[0]); out.behind = Math.abs(+v[1]); }
      continue;
    }
    const f = line.split(" ");
    if (f[0] === "1" || f[0] === "2") {
      const xy = f[1], path = f.slice(f[0] === "1" ? 8 : 9).join(" ");
      if (f[0] === "2") i++; // the original path follows as its own entry
      if (xy[0] !== ".") out.staged.push({ path, code: xy[0] });
      if (xy[1] !== ".") out.modified.push({ path, code: xy[1] });
    } else if (f[0] === "u") out.conflicts.push({ path: f.slice(10).join(" "), code: "U" });
    else if (f[0] === "?") out.untracked.push({ path: line.slice(2), code: "?" });
  }
  return out;
}

/** @param {string} text @returns {Record<string, NumStat>} */
function parseNumstat(text) {
  /** @type {Record<string, NumStat>} */
  const stats = {};
  for (const entry of text.split("\0")) {
    const [a, d, ...rest] = entry.split("\t");
    if (!rest.length) continue;
    stats[rest.join("\t").replace(/^\n/, "")] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
  }
  return stats;
}

/**
 * @param {string} text the %D decorate list
 * @param {string[]} remotes remote names from `git remote`
 * @returns {Ref[]}
 */
function parseRefs(text, remotes) {
  /** @type {Ref[]} */
  const refs = [];
  for (const raw of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (raw.startsWith("HEAD -> ")) refs.push({ kind: "head", name: raw.slice(8) });
    else if (raw === "HEAD") refs.push({ kind: "detached", name: "HEAD" });
    else if (raw.startsWith("tag: ")) refs.push({ kind: "tag", name: raw.slice(5) });
    else {
      const remote = remotes.find((r) => raw.startsWith(r + "/"));
      if (remote) { if (!raw.endsWith("/HEAD")) refs.push({ kind: "remote", remote, name: raw.slice(remote.length + 1) }); }
      else refs.push({ kind: "local", name: raw });
    }
  }
  // A remote branch on the same commit as its local twin rides inside the local pill.
  for (const r of refs) if (r.kind === "remote") {
    const twin = refs.find((l) => (l.kind === "local" || l.kind === "head") && l.name === r.name);
    if (twin) { twin.synced = (twin.synced ?? []).concat(r.remote); r.hidden = true; }
  }
  const order = { head: 0, detached: 0, local: 1, remote: 2, tag: 3 };
  return refs.filter((r) => !r.hidden).sort((a, b) => order[a.kind] - order[b.kind]);
}

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
    this.reset();
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
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

  reset() {
    this.root = null; this.on = null; this.error = null; this.status = null; this.commits = /** @type {Commit[]} */ ([]); this.graph = null;
    this.stash = 0; this.sel = null; this.detail = null; this.watched = null; this.loaded = false;
  }

  /**
   * @param {string} root
   * @param {Context} cx
   */
  watch(root, cx) {
    if (this.on || /** @type {string | null} */ (this.watched) === root) return;
    /** @type {string | null} */
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  /**
   * @param {Context} cx
   */
  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      /** @type {string | undefined} */
      this.context = context; this.reset(); }
    if (!cwd) { this.error = "No folder"; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.reset(); this.error = "Not a git repository"; this.cwd = cwd; return; }
        const root = top.stdout.trim();
        /** @param {string[]} args */
        const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const [st, staged, unstaged, remotes, stash] = await Promise.all([
          git(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--no-renames"]),
          git(["diff", "--cached", "--numstat", "-z", "--no-renames"]),
          git(["diff", "--numstat", "-z", "--no-renames"]),
          git(["remote"]),
          git(["stash", "list", "--format=%h"]),
        ]);
        if (st.code !== 0) throw new Error(st.stderr.trim());
        const status = parseStatus(st.stdout);
        const sStats = parseNumstat(staged.stdout), uStats = parseNumstat(unstaged.stdout);
        for (const f of status.staged) Object.assign(f, sStats[f.path] ?? {});
        for (const f of [...status.modified, ...status.conflicts]) Object.assign(f, uStats[f.path] ?? {});
        const remoteNames = remotes.stdout.split("\n").map((s) => s.trim()).filter(Boolean);

        /** @type {Commit[]} */
        let commits = [];
        if (status.oid) {
          const log = await git(["log", this.all ? "--all" : "HEAD", "--topo-order", "-n", String(LIMIT),
            `--format=${RS}%H${US}%P${US}%an${US}%ae${US}%at${US}%D${US}%s`]);
          if (log.code === 0) commits = log.stdout.split(RS).map((r) => r.replace(/^\n+|\n+$/g, "")).filter(Boolean).map((r) => {
            const [hash, parents, author, email, at, refs, subject] = r.split(US);
            return { hash, parents: parents ? parents.split(" ") : [], author, email, at: +at, refs: parseRefs(refs ?? "", remoteNames), subject: subject ?? "", head: hash === status.oid };
          });
        }
        const dirty = status.staged.length + status.modified.length + status.untracked.length + status.conflicts.length;
        if (dirty && status.oid) commits.unshift({ hash: "wip", wip: true, parents: [status.oid], refs: [], subject: "Uncommitted changes", author: "", email: "", at: 0 });
        if (key() !== context) return;

        const sameHistory = this.graph && this.commits.length === commits.length && this.commits.every((c, i) => c.hash === commits[i].hash && c.parents.join() === commits[i].parents.join());
        this.root = root; this.on = on; this.status = status; this.stash = stash.code === 0 ? stash.stdout.split("\n").filter(Boolean).length : 0;
        this.error = null; this.loaded = true;
        if (!sameHistory) {
          this.graph = layout(commits);
          const L = this.graph.cols <= 8 ? 14 : this.graph.cols <= 16 ? 12 : 10;
          this.lane = L; this.graphWidth = this.graph.cols * L + 12;
        } else commits.forEach((c, i) => { c.row = this.commits[i].row; });
        this.commits = commits;
        this.commits.forEach((c, i) => { c.row = this.graph.rows[i]; });
        if (this.sel && !commits.some((c) => c.hash === this.sel)) { this.sel = null; this.detail = null; }
        this.watch(root, cx);
      } catch (e) { if (key() === context) this.error = String(e.message ?? e); }
      finally {
        this.loading = false; cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
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
    const root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      /** @param {string[]} args */
      const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
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
    const s = this.status, name = this.root ? this.root.split("/").pop() : "Git";
    const branch = s ? (s.branch ?? (s.oid ? `detached @ ${s.oid.slice(0, 7)}` : "no commits yet")) : null;
    return h_flex().h(52).flex_none().px(16).gap(10).items_center()
      .child(div().size(28).flex_none().rounded(8).flex().items_center().justify_center()
        .bg(alpha(t.accent, "22")).border_1().border_color(alpha(t.accent, "44"))
        .child(svg(ICON("branch")).size(15).text_color(t.accent)))
      .child(v_flex().min_w(0).gap(1)
        .child(div().text_size(14).font_semibold().truncate().child(name))
        .when(Boolean(branch), (e) => e.child(h_flex().gap(5).items_center().text_size(11).min_w(0)
          .child(div().text_color(t.accent).font_medium().truncate().child(branch))
          .when(Boolean(s?.upstream), (e) => e.child(div().text_color(t.dim).truncate().child(`⟶ ${s.upstream}`))))))
      .child(div().flex_1())
      .when(Boolean(s?.ahead), (e) => e.child(this.chip("up", String(s.ahead), t.ansi2, t)))
      .when(Boolean(s?.behind), (e) => e.child(this.chip("down", String(s.behind), t.blocked, t)))
      .when(this.stash > 0, (e) => e.child(this.chip("stash", String(this.stash), t.ansi5, t)))
      .child(div().id("git-refresh").size(26).flex_none().rounded(7).flex().items_center().justify_center().cursor_pointer()
        .text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.refresh(cx))
        .child(this.loading ? svg(ICON("spinner")).size(14).spin(900) : svg(ICON("refresh")).size(14)));
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
        .on_click((_e, cx) => { this.folded[g.id] = open; cx.notify(); })
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
    const box = v_flex().h(Math.min(260, this.size.height * 0.38)).flex_none().border_t(1).border_color(t.border).bg(t.surface);
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
    if (!this.root) {
      return root.child(this.header(t)).child(div().flex_1().relative().child(
        this.loading || !this.error ? this.empty(t, "Reading repository…", "")
          : this.empty(t, this.error, this.error === "Not a git repository" ? `${this.cwd ?? "This folder"} isn't inside a git repo. cd into one in this tab's terminal.` : "")));
    }
    const card = this.statusCard(t), details = this.details(t);
    return root.child(this.header(t)).when(Boolean(card), (e) => e.child(card)).child(this.history(t)).when(Boolean(details), (e) => e.child(details));
  }
}
