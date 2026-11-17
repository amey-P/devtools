// Fake "gpui-kit" and "gpui-base": builders that record (see recorder.js).
import { make } from "./recorder.js";

export class View {}
export const div = () => make("div", []);
/** @param {string} path */
export const svg = (path) => make("svg", [path]);
export const v_flex = () => make("v_flex", []);
export const h_flex = () => make("h_flex", []);
