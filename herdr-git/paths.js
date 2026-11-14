// Path helpers that hold up on Windows. Git prints forward slashes everywhere
// (C:/Users/x), while Herdr's cwd can arrive as C:\Users\x. Everything the
// mod compares or shows goes through norm() first. Pure: no herdr imports.

/** A drive-letter path (C:/…) or a UNC path (//server/…). @type {RegExp} */
const WIN = /^(?:[A-Za-z]:\/|\/\/[^/])/;

/**
 * Forward slashes, no trailing slash (except a root: "/", "C:/").
 * @param {string | null | undefined} p
 * @returns {string}
 */
export function norm(p) {
  if (!p) return "";
  let s = p.replace(/\\/g, "/");
  if (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) s = s.replace(/\/+$/, "") || "/";
  return s;
}

/** @param {string} p @returns {boolean} */
export const isWin = (p) => WIN.test(norm(p));

/**
 * The last path segment, either slash.
 * @param {string | null | undefined} p
 * @returns {string}
 */
export function base(p) {
  const s = norm(p);
  return s.split("/").filter(Boolean).pop() ?? s;
}

/**
 * The parent folder ("" for a root).
 * @param {string} p
 * @returns {string}
 */
export function dir(p) {
  const s = norm(p), i = s.lastIndexOf("/");
  if (i < 0) return "";
  if (i === 0) return "/";
  if (/^[A-Za-z]:$/.test(s.slice(0, i))) return s.slice(0, i + 1);
  return s.slice(0, i);
}

/**
 * Joins segments with "/". An absolute later segment does not reset the path.
 * @param {...string} parts
 * @returns {string}
 */
export function join(...parts) {
  return norm(parts.filter(Boolean).map((p, i) => (i ? norm(p).replace(/^\/+/, "") : norm(p))).join("/"));
}

/**
 * Same folder? Windows paths compare case-insensitively.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function samePath(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return isWin(x) || isWin(y) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * `child` is `parent` or inside it.
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
export function within(child, parent) {
  const c = norm(child), p = norm(parent);
  if (!c || !p) return false;
  const [cc, pp] = isWin(c) || isWin(p) ? [c.toLowerCase(), p.toLowerCase()] : [c, p];
  return cc === pp || cc.startsWith(pp.endsWith("/") ? pp : pp + "/");
}

/**
 * An absolute path stays; a relative one resolves against `from`.
 * @param {string} p
 * @param {string} from
 * @returns {string}
 */
export function resolve(p, from) {
  const s = norm(p);
  if (s.startsWith("/") || WIN.test(s)) return s;
  /** @type {string[]} */
  const out = [];
  const root = norm(from);
  for (const seg of [...root.split("/"), ...s.split("/")]) {
    if (seg === "..") { if (out.length > 1) out.pop(); }
    else if (seg !== "." && (seg || !out.length)) out.push(seg);
  }
  return out.join("/") || "/";
}

/**
 * A short name for a repo folder: "x.git" → "x", "proj/.bare" → "proj".
 * @param {string} p
 * @returns {string}
 */
export function repoName(p) {
  let b = base(p);
  if (b === ".git" || b === ".bare") b = base(dir(p));
  return b.replace(/\.git$/, "") || b;
}

/**
 * Shortens a path under `home` to ~/….
 * @param {string} p
 * @param {string | null | undefined} home
 * @returns {string}
 */
export function tilde(p, home) {
  const s = norm(p), h = norm(home);
  return h && within(s, h) ? "~" + s.slice(h.length) : s;
}

/**
 * A remote URL as host/owner/repo: "git@github.com:o/r.git" and
 * "https://user@github.com/o/r" → "github.com/o/r". Local paths stay as their last folder.
 * @param {string} url
 * @returns {string}
 */
export function shortRemote(url) {
  const u = url.trim().replace(/\.git\/?$/, "").replace(/\/+$/, "");
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(u);
  if (scp && !/^[A-Za-z]$/.test(scp[1])) return `${scp[1]}/${scp[2]}`;
  const web = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u);
  if (web) return `${web[1]}/${web[2]}`;
  return base(u) || u;
}
