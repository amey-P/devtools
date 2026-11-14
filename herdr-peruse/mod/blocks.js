// Splits a markdown plan into annotatable blocks.
//   splitBlocks(text) -> [{ kind, src, line, level }]
// Kinds: heading, item (one list item, any depth, with its continuation lines), code, table,
//        quote, rule, para, choice. `level`: list nesting depth (0 for everything else).
// A choice is a fence with the info string `choice` (or `choice multi`): a question the reader answers by picking.
//   ```choice
//   Which storage backend?
//   - Postgres: durable, needs a server
//   - SQLite: zero setup
//   ```
// It carries {question, options: [{label, description}], multi}.
/** @import { Block, BlockKind } from "./types" */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE = /^\s*\|/;
const QUOTE = /^ {0,3}>/;

/** Splits a markdown plan into annotatable blocks (skipping front matter).
 *  @param {string} text @returns {Block[]} */
export function splitBlocks(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  /** @type {Block[]} */
  const out = [];
  let i = 0;
  // Front matter is not part of the plan's prose.
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) i = end + 1;
  }
  /** @param {BlockKind} kind @param {number} from @param {number} to @param {number} [level] */
  const push = (kind, from, to, level = 0) => {
    const src = lines.slice(from, to).join("\n").replace(/\s+$/, "");
    if (src.trim()) out.push({ kind, src, line: from, level });
  };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const fence = FENCE.exec(l);
    if (fence) {
      const mark = fence[1];
      let j = i + 1;
      while (j < lines.length && !lines[j].trimStart().startsWith(mark)) j++;
      const info = l.trim().slice(mark.length).trim().toLowerCase().split(/\s+/);
      const choice = info[0] === "choice" ? parseChoice(lines.slice(i + 1, j), info.includes("multi")) : null;
      if (choice) out.push({ kind: "choice", src: lines.slice(i, Math.min(j + 1, lines.length)).join("\n"), line: i, level: 0, ...choice });
      else push("code", i, Math.min(j + 1, lines.length));
      i = j + 1;
      continue;
    }
    if (HEADING.test(l)) { push("heading", i, i + 1); i++; continue; }
    if (RULE.test(l)) { push("rule", i, i + 1); i++; continue; }
    if (TABLE.test(l)) {
      let j = i + 1;
      while (j < lines.length && TABLE.test(lines[j])) j++;
      push("table", i, j); i = j; continue;
    }
    if (QUOTE.test(l)) {
      let j = i + 1;
      while (j < lines.length && QUOTE.test(lines[j])) j++;
      push("quote", i, j); i = j; continue;
    }
    const item = ITEM.exec(l);
    if (item) {
      const indent = item[1].replace(/\t/g, "    ").length;
      let j = i + 1;
      // Continuation: lines indented past the marker (fences inside too), or lazy paragraph lines.
      while (j < lines.length) {
        const n = lines[j];
        if (!n.trim()) {
          let k = j + 1;
          while (k < lines.length && !lines[k].trim()) k++;
          if (k < lines.length && leading(lines[k]) > indent && !ITEM.test(lines[k])) { j = k; continue; }
          break;
        }
        if (ITEM.test(n)) break;
        if (leading(n) > indent) {
          const f = FENCE.exec(n.trimStart());
          if (f) { j++; while (j < lines.length && !lines[j].trimStart().startsWith(f[1])) j++; }
          j++;
          continue;
        }
        if (HEADING.test(n) || FENCE.test(n) || TABLE.test(n) || QUOTE.test(n) || RULE.test(n)) break;
        j++;
      }
      const level = Math.floor(indent / 2);
      const src = lines.slice(i, j).map((x) => x.slice(Math.min(indent, leading(x)))).join("\n").replace(/\s+$/, "");
      out.push({ kind: "item", src, line: i, level });
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && !FENCE.test(lines[j]) && !HEADING.test(lines[j]) &&
      !ITEM.test(lines[j]) && !TABLE.test(lines[j]) && !QUOTE.test(lines[j]) && !RULE.test(lines[j])) j++;
    push("para", i, j); i = j;
  }
  return out;
}

/** A choice fence's body: question lines, then `- label: description` options. Null without a question and an option.
 *  @param {string[]} body @param {boolean} multi
 *  @returns {{ question: string; options: { label: string; description?: string }[]; multi: boolean } | null} */
function parseChoice(body, multi) {
  /** @type {string[]} */
  const q = [];
  /** @type {{ label: string; description?: string }[]} */
  const options = [];
  for (const raw of body) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(l);
    if (m) {
      const t = m[1].replace(/^\*\*(.+?)\*\*/, "$1");
      const k = t.search(/:\s|\s[—–-]\s/);
      options.push(k > 0 ? { label: t.slice(0, k).trim(), description: t.slice(k).replace(/^(:|\s[—–-])\s*/, "").trim() } : { label: t.trim() });
    } else if (!options.length) q.push(l.replace(/^#+\s*/, ""));
  }
  return q.length && options.length ? { question: q.join(" "), options, multi } : null;
}

/** Indentation of `s` in spaces (tabs count as 4).
 *  @param {string} s @returns {number} */
const leading = (s) => s.replace(/\t/g, "    ").length - s.replace(/\t/g, "    ").trimStart().length;

/** Plain text of a block, for quotes and labels.
 *  @param {string} src @returns {string} */
export function plain(src) {
  return src
    .replace(/^ {0,3}#{1,6}\s+/, "")
    .replace(/^(\s*)([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .trim();
}
