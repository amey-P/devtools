// Turns a rendered tree into GPUI builders: one builder call per attr, in order, then the
// children. Generic: it knows the four element kinds and three argument markers, nothing else.
import { div, svg } from "gpui-kit";
import type { Context, NativeElement } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Rendered } from "./gleam.ts";

export interface Attr {
  m: string;
  a: unknown[];
}

export interface Tree {
  kind: string;
  args: unknown[];
  attrs: Attr[];
  children: Tree[];
}

/** Sends a handler's event into the app, with the handler's own `cx`. */
export type Dispatch<Ev> = (event: Ev, cx: Context) => void;

type Builder = Record<string, (...args: unknown[]) => Builder>;

function make(t: Tree): Builder {
  switch (t.kind) {
    case "div":
      return div() as unknown as Builder;
    case "svg":
      return svg(t.args[0] as string) as unknown as Builder;
    case "h_flex":
      return h_flex() as unknown as Builder;
    case "v_flex":
      return v_flex() as unknown as Builder;
    default:
      throw new Error(`interpret: unknown element kind ${t.kind}`);
  }
}

function arg<Ev>(a: unknown, events: Ev[], dispatch: Dispatch<Ev>): unknown {
  if (a === null || typeof a !== "object" || !("$" in a)) return a;
  const m = a as { $: string; i?: number };
  switch (m.$) {
    case "undefined":
      return undefined;
    case "stop":
      return (_e: unknown, cx: Context) => cx.stop_propagation();
    case "event": {
      const ev = events[m.i as number];
      return (_e: unknown, cx: Context) => dispatch(ev, cx);
    }
    default:
      throw new Error(`interpret: unknown marker ${m.$}`);
  }
}

function apply<Ev>(el: Builder, attrs: Attr[], events: Ev[], dispatch: Dispatch<Ev>): Builder {
  for (const { m, a } of attrs) {
    if (m === "hover") {
      const style = a[0] as Attr[];
      el = el.hover((st: unknown) => apply(st as Builder, style, events, dispatch));
    } else el = el[m](...a.map((x) => arg(x, events, dispatch)));
  }
  return el;
}

function build<Ev>(t: Tree, events: Ev[], dispatch: Dispatch<Ev>): Builder {
  let el = apply(make(t), t.attrs, events, dispatch);
  for (const c of t.children) el = el.child(build(c, events, dispatch));
  return el;
}

export function interpret<Ev>(r: Rendered<Ev>, dispatch: Dispatch<Ev>): NativeElement {
  return build(r.tree, r.events, dispatch) as unknown as NativeElement;
}
