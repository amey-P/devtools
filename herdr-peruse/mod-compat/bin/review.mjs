#!/usr/bin/env node
// Old path of peruse.mjs (skills written before the rename): runs it with the same arguments.
// @ts-ignore: resolves where it is installed (mods/review next to mods/peruse), not in the repo
await import("../../peruse/bin/peruse.mjs");
