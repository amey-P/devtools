# Cutover proposal: `space-icons` → the Gleam build

**Status: proposal only. Nothing below has been run.** The owner's approval is the Phase 10 gate.

`H` = `~/.config/herdr-app` and `P` = `agentctl/herdr-gleam/space-icons`. Run every command from `P` unless it says otherwise.

## What changes and what doesn't

- `mods/space-icons` is in **no layout** today (only `minimal.json.bak` had it). The live user of the same icon code is `space-tree` in the sidebar, which keeps its own copies under `herdr-sidebar/`. **Nothing on screen changes at cutover** until `space-icons` is put back into a layout.
- Geo file names are hashes of the SVG text, and Phase 9 showed the new build writes the same names. `geo/` can be kept or left to regenerate; the result is the same either way.
- `overrides.json` is the user's file. The installed copy still has old `color` keys from before 434a9e9. The new decoder ignores them, as repo HEAD's does (D1).

## Preconditions

1. On the merged branch: `npm ci && npm test && npm run typecheck` (gleeunit + Vitest green).
2. `scripts/check.sh` passes for `space-icons-g`, and `herdr-app status` shows `"errors": []`.

## Cutover

```sh
# 1. Build for the final folder name. Every path (overrides.json, geo/, icons/) follows MOD_NAME.
MOD_NAME=space-icons scripts/build.sh
grep -c '"space-icons"' dist/main.js        # 1: the mount call

# 2. Keep the old install aside, whole (main.js, geo/, overrides.json): this is the rollback.
mv "$H/mods/space-icons" "$H/mods/space-icons-old"

# 3. Install the new build into the real name.
MOD_NAME=space-icons scripts/install.sh

# 4. Carry over the user's overrides and, optionally, the generated icons (same names).
cp "$H/mods/space-icons-old/overrides.json" "$H/mods/space-icons/overrides.json"
cp -R "$H/mods/space-icons-old/geo" "$H/mods/space-icons/geo"     # optional: regenerates anyway

# 5. Check.
MOD_NAME=space-icons scripts/check.sh
```

### Wire it into agentctl's installer (one commit in agentctl)

Today `install.mjs` → `SPEC.minimal.mods` mirrors `herdr-minimal/space-icons` into `mods/space-icons`, excluding `geo` and `test`. The proposed change has the installer build first, then mirror `dist/`:

```js
// ModSpec gains an optional build step, run in the repo before mirroring.
/** @typedef {{ name: string, src: string, exclude?: string[], build?: { cmd: string, env?: Record<string, string>, needs?: string[] } }} ModSpec */

minimal: {
  mods: [{
    name: "space-icons",
    src: "herdr-gleam/space-icons/dist",
    build: { cmd: "herdr-gleam/space-icons/scripts/build.sh", env: { MOD_NAME: "space-icons" }, needs: ["gleam", "npm"] },
    exclude: ["geo"],                                   // geo/: generated icons
  }],
  // files: unchanged
},
```

- `syncMod` runs `build.cmd` (with `env`) before `mirror`. If a tool in `needs` is missing, it calls `die()` with an install hint (`brew install gleam`, then `npm ci` in `P`). A missing toolchain must never leave a half-synced mod.
- `overrides.json` behaves as it does today: the mirror overwrites it from the repo copy (`P/assets/overrides.json`, the same `_example-*` entries as `herdr-minimal/space-icons/overrides.json`). Keeping a user-edited copy would be a new feature. If wanted, add `"overrides.json"` to `exclude` after the first install.
- **Rejected:** committing `dist/main.js`. That puts a 154 KB generated file in git, and it can drift from the source.
- Keep `herdr-minimal/space-icons/` in the repo through a soak period, for the rollback. Delete it later in its own commit. `parity/oracle/` keeps the frozen copy the tests need.

### After a soak period (separate step)

```sh
rm -rf "$H/mods/space-icons-old" "$H/mods/space-icons-g" "$H/mods/space-icons-base"
rm "$H/layouts/si-baseline.json" "$H/layouts/si-gleam.json"
```

## Rollback

During the soak, while `space-icons-old` exists:

```sh
rm -rf "$H/mods/space-icons"
mv "$H/mods/space-icons-old" "$H/mods/space-icons"
herdr-app check "$H/mods/space-icons" && herdr-app status
```

After the soak, or once the installer change has landed:

```sh
cd agentctl
git revert <the install.mjs SPEC commit>     # back to mirroring herdr-minimal/space-icons
node install.mjs minimal                      # re-syncs mods/space-icons from the old source
```

`geo/` needs nothing: the old and new builds use the same file names. The overrides file is untouched by both paths. In the first path it moves back with the folder; in the second, the installer rewrites it from the repo, as it does today.

## Back to the side-by-side setup

To compare again at any time: `scripts/build.sh && scripts/install.sh` (the default `MOD_NAME=space-icons-g`), then `herdr-app do layout.switch '{"name":"si-gleam"}'`.
