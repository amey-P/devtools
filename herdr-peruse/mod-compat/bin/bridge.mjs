// Old path of the peruse bridge (herdr-review's hooks and pi extension load mods/review/bin/bridge.mjs): the same
// module, so an agent started before the rename keeps working until it restarts with the new plugin.
// @ts-ignore: resolves where it is installed (mods/review next to mods/peruse), not in the repo
export * from "../../peruse/bin/bridge.mjs";
