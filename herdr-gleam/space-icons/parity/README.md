# parity/

The frozen oracle (the mod at agentctl 434a9e9), recorder fakes, and the goldens the Gleam port must match.

- `oracle/`: byte-frozen copies, checked against `SHA256SUMS`. Never edit them.
- `fakes/`: `herdr`, `gpui-kit`/`gpui-base`, `fs/promises`, wired in through `vitest.config.js` aliases.
- `corpus.js`: the deterministic inputs. `golden.js` builds the goldens from the oracle. `oracle-run.js` drives the oracle's `init`/`render`.
- `golden/`: committed outputs. `npm run golden` rewrites them, and `npx vitest run` fails if a fresh build differs.
