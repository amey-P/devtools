// Geometric icons on disk. gpui's svg() only draws files (relative to the app
// home), so each generated icon is written once to mods/<mod>/geo/<hash>.svg.
// The file name is a hash of the SVG itself: when geo.js changes, icons get
// new names, so a stale file is never drawn. The installer leaves geo/ alone.
//
// render() must not notify or spawn, so path() only queues a missing icon; a
// timer started in init (start()) writes the queue and re-renders.

import * as fs from "fs/promises";
import { appHome } from "herdr";
import { geoIcon, fnv1a } from "./geo.js";

export class GeoCache {
  /** @param {string} mod the mod's folder name under mods/ */
  constructor(mod) {
    this.rel = `mods/${mod}/geo`;
    this.dir = `${appHome()}/${this.rel}`;
    /** @type {Set<string>} file names known to be on disk */
    this.ready = new Set();
    /** @type {Map<string, { file: string, svg: string }>} seed|family -> generated icon */
    this.made = new Map();
    /** @type {Map<string, string>} file -> svg, waiting to be written */
    this.queue = new Map();
    this.loaded = false;
  }

  // Lists what's already on disk; call once from init before the first notify.
  async load() {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      for (const f of await fs.readdir(this.dir)) this.ready.add(f);
    } catch (e) {
      console.log(`geo: ${this.dir}: ${e}`);
    }
    this.loaded = true;
  }

  // Writes queued icons every `ms` and re-renders when any landed. Call from init.
  /** @param {import("gpui-kit").Context} cx @param {number} [ms] */
  start(cx, ms = 150) {
    cx.timer.every(ms, (cx) => {
      if (!this.loaded || this.queue.size === 0) return;
      const batch = [...this.queue];
      this.queue.clear();
      cx.spawn(async (cx) => {
        let wrote = false;
        for (const [file, svg] of batch) {
          try {
            await fs.writeFile(`${this.dir}/${file}`, svg);
            this.ready.add(file);
            wrote = true;
          } catch (e) {
            console.log(`geo: write ${file}: ${e}`);
          }
        }
        if (wrote) cx.notify();
      });
    });
  }

  // The icon's path for svg(), or null while it's still being written.
  /** @param {string} seed @param {string} [family] @returns {string | null} */
  path(seed, family) {
    const key = `${seed}|${family ?? ""}`;
    let m = this.made.get(key);
    if (!m) {
      const { svg } = geoIcon(seed, { family });
      m = { file: `${fnv1a(svg).toString(36)}.svg`, svg };
      this.made.set(key, m);
    }
    if (this.ready.has(m.file)) return `${this.rel}/${m.file}`;
    this.queue.set(m.file, m.svg);
    return null;
  }
}
