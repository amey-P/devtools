// Phase 8: the runtime against the fake herdr / fs / gpui modules (vitest.config.js aliases).
import { beforeEach, describe, expect, test } from "vitest";
// @ts-ignore: plain JS test helpers
import { G } from "../parity/gleam.js";
// @ts-ignore
import { fake, reset } from "../parity/fakes/herdr.js";
// @ts-ignore
import { tree } from "../parity/fakes/recorder.js";
// @ts-ignore
import { renderOracle } from "../parity/oracle-run.js";
import { bindGleam } from "./gleam.ts";
import { mount } from "./runtime.ts";

const core = await G("core");
const model = await G("model");
const app = bindGleam(core, G.prelude);
const views = JSON.parse(
  (await import("node:fs")).readFileSync(new URL("../parity/golden/views.json", import.meta.url), "utf8"),
);

/** A fake cx: records spawned tasks, timers and notifies. */
function fakeCx() {
  const tasks: Promise<unknown>[] = [];
  const timers: { ms: number; handler: (cx: any) => void }[] = [];
  const counts = { notify: 0 };
  const cx: any = {
    spawn: (f: (cx: any) => Promise<unknown>) => void tasks.push(f(cx)),
    timer: { every: (ms: number, handler: (cx: any) => void) => void timers.push({ ms, handler }) },
    notify: () => void counts.notify++,
    stop_propagation: () => {},
  };
  /** Runs every spawned task to the end, including tasks those tasks spawn. */
  const settle = async () => {
    while (tasks.length) await tasks.shift();
  };
  const tick = async () => {
    for (const t of timers) t.handler(cx);
    await settle();
  };
  return { cx, timers, counts, settle, tick };
}

function boot(modName = "space-icons-g") {
  const Mod = mount(app, modName);
  const view: any = new Mod();
  const f = fakeCx();
  view.init(undefined, f.cx);
  return { view, ...f };
}

const geoDir = (mod: string) => `${fake.home}/mods/${mod}/geo`;
const logs: string[] = [];
const realLog = console.log;

beforeEach(() => {
  reset();
  logs.length = 0;
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  return () => void (console.log = realLog);
});

describe("check mode (G6)", () => {
  test("checking(): init and render make no herdr or fs calls and start no timer", async () => {
    fake.checking = true;
    fake.spaces = [{ id: "a", name: "alpha", status: "idle", active: true, machine: null }];
    const { view, timers, counts, settle } = boot();
    await settle();
    const t = tree(view.render());
    expect(fake.log).toEqual([]);
    expect(timers).toEqual([]);
    expect(counts.notify).toBe(0);
    expect(t.kind).toBe("v_flex");
  });

  test("checking(): a handler runs no effect", () => {
    fake.checking = true;
    const { view, cx } = boot();
    view.dispatch(model.Event$ClickedNewSpace(), cx);
    view.dispatch(model.Event$ClickedSpace("a"), cx);
    expect(fake.log).toEqual([]);
  });
});

describe("runtime", () => {
  test("init reads overrides and lists the geo folder; one 150 ms timer, through cx.timer only", async () => {
    const { timers, settle } = boot();
    await settle();
    expect(fake.log).toEqual([
      ["readTextFile", `${fake.home}/mods/space-icons-g/overrides.json`],
      ["fs.mkdir", geoDir("space-icons-g")],
      ["fs.readdir", geoDir("space-icons-g")],
    ]);
    expect(timers.map((t) => t.ms)).toEqual([150]);
  });

  test("a tick writes each missing file once, then notifies; a quiet tick does not notify", async () => {
    fake.spaces = [
      { id: "a", name: "alpha", status: "idle", active: false, machine: null },
      { id: "b", name: "beta", status: "idle", active: false, machine: null },
      { id: "c", name: "ALPHA ", status: "idle", active: false, machine: null },
    ];
    const { counts, settle, tick } = boot();
    await settle();
    fake.log = [];
    const before = counts.notify;
    await tick();
    const writes = fake.log.filter((e: unknown[]) => e[0] === "fs.writeFile");
    expect(writes.length).toBe(2);
    expect(counts.notify).toBeGreaterThan(before);
    for (const [, path] of writes) expect(fake.files.get(path)).toMatch(/^<svg /);
    fake.log = [];
    const quiet = counts.notify;
    await tick();
    expect(fake.log).toEqual([]);
    expect(counts.notify).toBe(quiet);
  });

  test("a failed write logs once and is written again on the next tick (I4)", async () => {
    fake.spaces = [{ id: "a", name: "alpha", status: "idle", active: false, machine: null }];
    const { view, settle, tick } = boot();
    await settle();
    fake.log = [];
    // Fail every write under the geo dir for one tick.
    const dir = geoDir("space-icons-g");
    const files = () => fake.log.filter((e: unknown[]) => e[0] === "fs.writeFile").map((e: unknown[]) => e[1] as string);
    const orig = fake.failing;
    fake.failing = { has: (p: string) => p.startsWith(dir + "/") } as unknown as Set<string>;
    await tick();
    const failed = files();
    expect(failed.length).toBe(1);
    expect(logs.filter((l) => l.startsWith("geo: write "))).toHaveLength(1);
    fake.failing = orig;
    fake.log = [];
    await tick();
    expect(files()).toEqual(failed);
    expect(fake.files.has(failed[0])).toBe(true);
    expect(view.render()).toBeTruthy();
  });

  test.each([
    views.find((c: any) => c.spaces.length === 7 && c.window?.platform === "macos"),
    views.find((c: any) => c.spaces.length === 1 && c.window === null),
  ])("boot + tick renders the oracle's tree: $id", async (c: any) => {
    // Everything the rail draws is on disk once the ticks have run, so compare with the oracle
    // given every name as ready.
    const expected = await renderOracle({ ...c, readyNames: c.spaces.map((s: any) => s.name) });
    reset();
    fake.spaces = c.spaces;
    fake.theme = c.theme;
    fake.window = c.window;
    fake.files.set(`${fake.home}/mods/space-icons/overrides.json`, c.overridesText);
    const { view, settle, tick } = boot("space-icons");
    await settle();
    await tick();
    fake.log = [];
    expect(tree(view.render())).toEqual(expected);
    expect(fake.log).toEqual([]);
  });
});
