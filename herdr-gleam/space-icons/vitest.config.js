// Vitest runs the parity and shell tests in Node. Herdr's modules are aliased to recorder fakes,
// so both the frozen oracle (parity/oracle/main.js) and the new shell load against the same fakes.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fake = (/** @type {string} */ f) => fileURLToPath(new URL(`./parity/fakes/${f}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^herdr$/, replacement: fake("herdr.js") },
      { find: /^gpui-kit$/, replacement: fake("gpui.js") },
      { find: /^gpui-base$/, replacement: fake("gpui.js") },
      { find: /^fs\/promises$/, replacement: fake("fs.js") },
    ],
  },
  test: {
    include: ["parity/**/*.test.{js,ts}", "shell/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
