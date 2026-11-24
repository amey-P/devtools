// Phase 7: the core's view, run through the shell's interpreter against the recorder fakes, must
// record the same tree as the oracle for every case in view set (c). A handler label is what the
// handler does when it runs once, so the click, right-click and new-space arguments (I7) are
// compared too: they go core event -> update -> effect -> the fake herdr `run` / `openOverlay`.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { G } from "./gleam.js";
import { fake, reset } from "./fakes/herdr.js";
import { tree } from "./fakes/recorder.js";
import { iconFor, geoFile, decodeOverrides, renderOracle } from "./oracle-run.js";
import { bindGleam } from "../shell/gleam.ts";
import { interpret } from "../shell/interpret.ts";
import { runEffects } from "../shell/effects.ts";

const core = await G("core");
const model = await G("model");
const app = bindGleam(core, G.prelude);
const views = JSON.parse(readFileSync(new URL("./golden/views.json", import.meta.url), "utf8"));
const { Ok } = G.prelude;

describe("view set (c)", () => {
  test.each(views.map((/** @type {any} */ c) => [c.id, c]))("%s", async (_id, c) => {
    // The files on disk: the oracle's own file names for the ready spaces, under its own overrides.
    const { overrides } = await decodeOverrides(c.overridesText);
    const ready = c.readyNames.map((/** @type {string} */ n) => {
      const ic = iconFor(n, overrides);
      return geoFile(ic.seed, ic.family);
    });
    reset();
    fake.spaces = c.spaces;
    fake.theme = c.theme;
    fake.window = c.window;
    let state = app.init("space-icons", fake.home).state;
    state = app.update(state, model.Event$OverridesRead(new Ok(G.some(c.overridesText)))).state;
    state = app.update(state, model.Event$GeoDirListed(new Ok(G.list(ready)))).state;
    const snap = { spaces: fake.spaces, theme: fake.theme, window: fake.window };
    /** @param {unknown} ev @param {any} cx */
    const dispatch = (ev, cx) => runEffects(app.update(state, ev).effects, cx, dispatch);
    const el = interpret(app.view(state, snap), dispatch);
    expect(tree(el)).toEqual(c.tree);
    expect(fake.log, "render ran no herdr calls").toEqual([]);
  });
});

// Real `spaces()` entries (herdr.d.ts SpaceInfo): `status` is null when no agent runs, `machine`
// is null for this computer, and there are fields the rail does not read. Found live in Phase 9:
// a string-only status decoder dropped every space. Compared against the oracle rendered live.
describe("SpaceInfo as Herdr sends it", () => {
  const theme = views[0].theme;
  const info = (/** @type {any} */ s) => ({ index: 0, named: false, folder: "/x", branch: null, tabs: [], ...s });
  const spacesCases = [
    ["null status", [info({ id: "a", name: "alpha", status: null, active: true, machine: null })]],
    ["mixed", [
      info({ id: "a", name: "alpha", status: null, active: false, machine: null }),
      info({ id: "b", name: "beta", status: "working", active: true, machine: "vps" }),
      info({ id: "c", name: "_example-lucide", status: "idle", active: false, machine: "" }),
    ]],
  ];
  test.each(spacesCases)("%s", async (_name, spaces) => {
    const overridesText = views[0].overridesText;
    const c = { spaces, theme, window: views[0].window, overridesText, readyNames: [/** @type {any} */ (spaces)[0].name] };
    const expected = await renderOracle(c);
    const { overrides } = await decodeOverrides(overridesText);
    const ready = c.readyNames.map((n) => {
      const ic = iconFor(n, overrides);
      return geoFile(ic.seed, ic.family);
    });
    reset();
    let state = app.init("space-icons", fake.home).state;
    state = app.update(state, model.Event$OverridesRead(new Ok(G.some(overridesText)))).state;
    state = app.update(state, model.Event$GeoDirListed(new Ok(G.list(ready)))).state;
    /** @param {unknown} ev @param {any} cx */
    const dispatch = (ev, cx) => runEffects(app.update(state, ev).effects, cx, dispatch);
    const el = interpret(app.view(state, { spaces, theme, window: c.window }), dispatch);
    expect(tree(el)).toEqual(expected);
  });
});
