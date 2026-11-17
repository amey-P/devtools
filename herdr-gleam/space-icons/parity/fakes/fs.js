// Fake "fs/promises": an in-memory folder tree on top of herdr.js `fake.files`.
import { fake, note } from "./herdr.js";

/** @param {string} dir */
export async function mkdir(dir) {
  note(["fs.mkdir", dir]);
  if (fake.failingDirs.has(dir)) throw new Error(`EACCES: mkdir ${dir}`);
}

/** @param {string} dir */
export async function readdir(dir) {
  note(["fs.readdir", dir]);
  if (fake.failingDirs.has(dir)) throw new Error(`EACCES: readdir ${dir}`);
  const prefix = dir + "/";
  return [...fake.files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")).map((p) => p.slice(prefix.length)).sort();
}

/** @param {string} path @param {string} text */
export async function writeFile(path, text) {
  note(["fs.writeFile", path]);
  if (fake.failing.has(path)) throw new Error(`EACCES: write ${path}`);
  fake.files.set(path, text);
}
