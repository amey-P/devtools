// The only FFI in the core (see docs/decisions.md, "FFI policy"). Each function: <= 3 lines, a parity test.

export function js_num(x) {
  return String(x);
}
