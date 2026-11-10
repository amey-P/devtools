// Fixes for gaps in the generated "herdr" module types (gpui-kit.d.ts, written by `herdr-app check`).
// Every mod's tsconfig.json includes this file. Drop an entry once Herdr's own declaration is precise.
export {};

declare module "herdr" {
  // theme() is declared Record<string, string>, but its values are hex colors, and every
  // text_color / bg / border_color takes gpui-kit's Color (`#${string}`).
  export function theme(): Record<string, import("gpui-kit").Color>;
  // settings() is declared Record<string, unknown>; these are the fields the mods read.
  export function settings(): { font_family?: string; [key: string]: unknown };
}
