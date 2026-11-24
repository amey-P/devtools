// Runs effects against Herdr. Generic: each op is one Herdr capability. While `herdr-app check`
// runs (`checking()`), nothing runs at all (spec G6). An op with an answer runs in `cx.spawn`, and
// its result (or `String(error)`) goes back through `dispatch` with the task's own `cx`.
import { checking, openOverlay, readTextFile, run } from "herdr";
import * as fs from "fs/promises";
import type { AsyncContext, Context } from "gpui-kit";
import type { Effect } from "./gleam.ts";
import type { Dispatch } from "./interpret.ts";

type Args = Record<string, any>;

const ops: Record<string, (a: Args) => unknown> = {
  read_text: (a) => readTextFile(a.path),
  mkdir_list: async (a) => {
    await fs.mkdir(a.dir, { recursive: true });
    return fs.readdir(a.dir);
  },
  write_file: (a) => fs.writeFile(a.path, a.content),
  run: (a) => (a.args === null ? run(a.name) : run(a.name, a.args)),
  open_overlay: (a) => openOverlay(a.spec),
  log: (a) => console.log(a.message),
};

export function runEffects<Ev>(effects: Effect<Ev>[], cx: Context, dispatch: Dispatch<Ev>): void {
  if (checking()) return;
  for (const e of effects) {
    const op = ops[e.op];
    if (!op) throw new Error(`effects: unknown op ${e.op}`);
    const { ok, err } = e;
    if (!ok || !err) {
      op(e.args);
      continue;
    }
    cx.spawn(async (cx: AsyncContext) => {
      let next: Ev;
      try {
        next = ok(await op(e.args));
      } catch (error) {
        next = err(String(error));
      }
      dispatch(next, cx);
    });
  }
}
