// Binds a Gleam core that speaks the shell protocol (see src/space_icons/core.gleam) to plain
// JavaScript shapes. It uses only Gleam's public JS API: the `List$…` helpers from the prelude and
// the `Type$Variant$field` accessors Gleam generates. Nothing here knows what the core draws.
import type { Tree } from "./interpret.ts";

/** One effect: an op name, its JSON arguments, and how to answer it (absent: no answer). */
export interface Effect<Ev> {
  op: string;
  args: Record<string, unknown>;
  ok?: (value: unknown) => Ev;
  err?: (error: string) => Ev;
}

export interface Step<S, Ev> {
  state: S;
  effects: Effect<Ev>[];
}

/** A rendered tree, and the events its `{"$": "event", "i": n}` markers point at. */
export interface Rendered<Ev> {
  tree: Tree;
  events: Ev[];
}

export interface App<S, Ev> {
  init(modName: string, appHome: string): Step<S, Ev>;
  update(state: S, event: Ev): Step<S, Ev>;
  tick(state: S, snapshot: unknown): Ev;
  view(state: S, snapshot: unknown): Rendered<Ev>;
  changed(a: S, b: S): boolean;
}

/** A Gleam `List` (walked with the prelude's `List$…` helpers). */
type GleamList = unknown;

/** The compiled core module (`core.mjs`) plus the prelude (`gleam.mjs`) it was built with. */
export interface GleamCore {
  init(modName: string, appHome: string): unknown;
  update(state: unknown, event: unknown): unknown;
  tick(state: unknown, snapshot: unknown): unknown;
  view(state: unknown, snapshot: unknown): unknown;
  changed(a: unknown, b: unknown): boolean;
  Step$Step$state(s: unknown): unknown;
  Step$Step$effects(s: unknown): GleamList;
  Out$Out$op(o: unknown): string;
  Out$Out$args(o: unknown): string;
  Out$Out$reply(o: unknown): unknown;
  Reply$isReply(r: unknown): boolean;
  Reply$Reply$ok(r: unknown): (v: unknown) => unknown;
  Reply$Reply$err(r: unknown): (e: string) => unknown;
  Rendered$Rendered$tree(r: unknown): string;
  Rendered$Rendered$events(r: unknown): GleamList;
}

export interface GleamPrelude {
  List$isNonEmpty(l: unknown): boolean;
  List$NonEmpty$first(l: unknown): unknown;
  List$NonEmpty$rest(l: unknown): unknown;
}

export function toArray(prelude: GleamPrelude, list: unknown): unknown[] {
  const out: unknown[] = [];
  for (let l = list; prelude.List$isNonEmpty(l); l = prelude.List$NonEmpty$rest(l)) out.push(prelude.List$NonEmpty$first(l));
  return out;
}

export function bindGleam<S = unknown, Ev = unknown>(core: GleamCore, prelude: GleamPrelude): App<S, Ev> {
  const effect = (o: unknown): Effect<Ev> => {
    const reply = core.Out$Out$reply(o);
    const e: Effect<Ev> = { op: core.Out$Out$op(o), args: JSON.parse(core.Out$Out$args(o)) };
    if (core.Reply$isReply(reply)) {
      e.ok = core.Reply$Reply$ok(reply) as (v: unknown) => Ev;
      e.err = core.Reply$Reply$err(reply) as (e: string) => Ev;
    }
    return e;
  };
  const step = (s: unknown): Step<S, Ev> => ({
    state: core.Step$Step$state(s) as S,
    effects: toArray(prelude, core.Step$Step$effects(s)).map(effect),
  });
  return {
    init: (modName, appHome) => step(core.init(modName, appHome)),
    update: (state, event) => step(core.update(state, event)),
    tick: (state, snapshot) => core.tick(state, snapshot) as Ev,
    view: (state, snapshot) => {
      const r = core.view(state, snapshot);
      return { tree: JSON.parse(core.Rendered$Rendered$tree(r)), events: toArray(prelude, core.Rendered$Rendered$events(r)) as Ev[] };
    },
    changed: (a, b) => core.changed(a, b),
  };
}
