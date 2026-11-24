// Phase 7: the core's view, run through the shell's interpreter against the recorder fakes, must
// record the same tree as the oracle for every case in view set (c). A handler label is what the
// handler does when it runs once, so the click, right-click and new-space arguments (I7) are
// compared too: they go core event -> update -> effect -> the fake herdr `run` / `openOverlay`.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { G } from "./gleam.js";
import { fake, reset } from "./fakes/herdr.js";
import { tree } from "./fakes/recorder.js";
import { iconFor, geoFile, decodeOverrides } from "./oracle-run.js";
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
