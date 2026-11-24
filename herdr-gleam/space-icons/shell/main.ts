// The mod's entry: the generic runtime bound to this core. `MOD_NAME` (the folder under mods/) is
// set at build time by scripts/build.sh; every path the core uses is derived from it.
import * as core from "../build/dev/javascript/space_icons/space_icons/core.mjs";
import * as prelude from "../build/dev/javascript/space_icons/gleam.mjs";
import { bindGleam } from "./gleam.ts";
import { mount } from "./runtime.ts";

declare const MOD_NAME: string;

export default mount(bindGleam(core, prelude), MOD_NAME);
