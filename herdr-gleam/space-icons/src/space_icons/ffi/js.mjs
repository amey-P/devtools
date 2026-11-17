// The only FFI in the core. Policy (docs/decisions.md): each function is at most 3 lines and has a
// test in test/ffi_test.gleam. These exist because Gleam's own versions differ from what the
// oracle's JavaScript does: UTF-16 code units, 32-bit integer ops, JS number text, Math.*.
import { toList } from "../../gleam.mjs";

export function utf16_units(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return toList(out);
}
export const imul = (a, b) => Math.imul(a, b);
export const to_u32 = (x) => x >>> 0;
export const to_i32 = (x) => x | 0;
export const js_num = (x) => String(x);
export const n2 = (v) => +v.toFixed(2);
export const cos = (x) => Math.cos(x);
export const sin = (x) => Math.sin(x);
export const pi = () => Math.PI;
export const to_base36 = (n) => n.toString(36);
