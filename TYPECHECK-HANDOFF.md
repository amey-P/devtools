# Handoff: add JSDoc types until `npm run typecheck` passes

You are the **orchestrator**. You split the work, delegate it to cheaper pi subagents through Herdr's `hc` CLI, check every result mechanically, and integrate it with git so any step can be rolled back. You don't write most of the types yourself. You define shared shapes, write the prompts, run the checks and decide what gets merged.

Read the whole document before starting. Sections 1–3 are the rules and the tooling. Section 4 is the workflow you follow. Sections 5–6 are reference material you pass on to subagents.

---

## 1. Goal and starting point

Every mod in this repo is plain JavaScript. Types go in JSDoc comments, and TypeScript checks them. The tooling exists and is committed (`a97e59d`). What's left is typing the existing code until this passes:

```sh
npm run typecheck    # must end with "All 9 projects pass."
```

Baseline on `main` @ `09dc1ce` (2026-11-10), from `npm run typecheck -- --by-file`:

| Project (typecheck name) | Errors | Files (errors) |
|---|---|---|
| `herdr-review/mod` | 461 | main.js 164 · settings.js 65 · choice.js 57 · inbox.js 52 · ui.js 48 · config-core.js 44 · pill.js 16 · blocks.js 9 · feedback.js 6 |
| `node scripts (*.mjs)` | 271 | mod/bin/bridge.mjs 73 · agent-usage/scan.mjs 57 · install.mjs 54 · *config-core.js 44 (owned by herdr-review/mod)* · bin/config.mjs 12 · scripts/config-schema.mjs 9 · claude-ask/stop/hook.mjs 6/6/5 · bin/ask.mjs 3 · bin/review.mjs 2 |
| `herdr-usage/agent-usage` | 224 | main.js 107 · settings.js 78 · config.js 39 |
| `herdr-git` | 151 | main.js 110 · graph.js 41 |
| `herdr-sidebar/space-tree` | 99 | main.js 94 · glyphs.js 5 |
| `herdr-minimal/space-icons` | 15 | main.js 10 · glyphs.js 5 |
| `herdr-review/mod-inbox`, `mod-settings`, `herdr-usage/usage-settings` | 0 | — |

About 90% of these are untyped parameters (TS7006 and the other TS70xx codes). The rest (about 100) were all read: none is a real bug. They come from values TypeScript can't infer, and they go away once the code is typed. Still read each one. The pilot found one real bug this way: `launch` in `herdr-review/mod/main.js` was both a method and a field.

## 2. Hard rules (for you and every subagent)

1. **Keep the files `.js`.** Herdr runs mods on QuickJS, which only loads `main.js` and has no TypeScript support. No build step, no `.ts` files.
2. **Don't change runtime behavior.** Add comments and JSDoc only. `scripts/same-runtime.mjs` enforces this mechanically (section 4.6). Only you, the orchestrator, can approve an exception (a rename, a guard): commit it on its own with a `fix(...)` message and log it in the ledger.
3. **Never edit `gpui-kit.d.ts`.** Herdr regenerates it on every check and git ignores it. Fixes for gaps in Herdr's types go in `types/herdr.d.ts`, which only you edit.
4. **Don't weaken the config.** Don't touch `tsconfig*.json`, and don't add `// @ts-nocheck` or `// @ts-ignore`. Use `// @ts-expect-error <reason>` only for a runtime pattern TypeScript can't express, and only with your approval.
5. **Don't type things as `any` to silence errors.** It's acceptable for raw `JSON.parse` output before validation, an opaque `cx`, or a value that really can be anything. Otherwise write the real type.
6. **Never touch `main`.** Don't commit to it, reset it, push it or run destructive commands in the primary checkout. All work happens in worktrees on `tc/*` branches. The owner merges `tc/integrate` into `main` after reviewing it.
7. **Don't push anything** unless the owner asks.
8. **Don't install.** `./install.sh` copies the repo into `~/.config/herdr-app`, which is the owner's live Herdr. Ask before the final install (section 4.9).

## 3. Tooling reference

| File | Role |
|---|---|
| `package.json` (root) | Dev-only: `typescript`, `@types/node`. `npm ci` once per worktree. |
| `scripts/typecheck.mjs` | `npm run typecheck [-- <filter>] [-- --by-file]`. For each mod folder (a `tsconfig.json` next to a `main.js`) it runs `herdr-app check` (regenerating `gpui-kit.d.ts`), then `tsc -p`, then checks the root project. `<filter>` matches the project name: `space-icons`, `herdr-review/mod`, `node` (root project). `--by-file` prints error counts per file. |
| `scripts/same-runtime.mjs` | `node scripts/same-runtime.mjs <base-ref> [path...]`. Strips comments, normalizes the formatting of each changed `.js`/`.mjs` file, and compares the result to `<base-ref>`. Exit 0 means only comments changed. Exit 1 shows the first differing line. |
| `tsconfig.mod.json` | Shared mod options: `lib: ES2022`, no Node types, `checkJs`, `strict`, **`noImplicitAny` on**, `strictNullChecks` off (view state is assigned in `init()`), `useUnknownInCatchVariables` off, `skipLibCheck`. |
| `<mod>/tsconfig.json` | Extends the shared file. Includes `*.js`, `*.d.ts`, `types/herdr.d.ts`. Top-level files only. |
| `tsconfig.json` (root) | Node scripts: `**/*.mjs`, `NodeNext`, `@types/node`. It follows imports, which is why `herdr-review/mod/config-core.js` (imported by `bin/config.mjs`) appears in both projects. |
| `types/herdr.d.ts` | Shared patches to the `"herdr"` module (`theme()`, `settings()`). Orchestrator-only. |
| `herdr-review/mod/types.d.ts` | The review mod's shared shapes (`BtnOpts`, `MarkdownOpts`, `Annotation`, `Motion`). The template for other mods' `types.d.ts`. |

A new `<mod>/types.d.ts` must be un-ignored to be committed: add `!<path>/types.d.ts` to `.gitignore` in the same commit. The installers never copy `tsconfig.json` or `*.d.ts`.

---

## 4. Orchestration workflow

### 4.1 Roles and models

You control subagents with **`hc`** (herdr-core, the CLI of the Herdr desktop app this repo targets). Don't use the older `herdr` terminal-multiplexer CLI: inside the app, `HERDR_ENV` is unset and `herdr agent …` doesn't apply. Run `hc --skill` once to read its manual.

Both subagent models run in **pi** (`/opt/homebrew/bin/pi`, v1.5.2) through the **opencode-go** provider. Both were checked on 2026-11-10: `pi auth check` reports `ready` for both, and each answered a test prompt when launched through `hc` with the exact commands below.

| Role | Model (exact) | pi flags | Why |
|---|---|---|---|
| **Implementer** (writes JSDoc) | `opencode-go/glm-5.3-flash` · 1M context · 131K max output · thinking | `--provider opencode-go --model glm-5.3-flash --thinking medium --start-mode yolo` | Full tools (read, edit, bash) with no approval prompts. Its bash lets it `hc send` its report to you. |
| **Reviewer** (checks the types are true) | `opencode-go/deepseek-v4.1-flash` · 1M context · 384K max output · thinking | `--provider opencode-go --model deepseek-v4.1-flash --thinking medium --start-mode review` | Read-only (read, grep, find, ls). A different model family from the implementer, so its mistakes don't line up with the implementer's. |
| **Fallback implementer** | `opencode-go/deepseek-v4.1-flash` with the implementer flags | `--provider opencode-go --model deepseek-v4.1-flash --thinking medium --start-mode yolo` | For a task GLM failed twice (section 4.8). When it implements, review with GLM in `review` mode. |

Notes:
- The DeepSeek flash model on opencode-go is named **`deepseek-v4.1-flash`**. `deepseek-flash` is the separate `deepseek` provider, which you don't use. Always pass both `--provider` and `--model` explicitly; never rely on pi's default (`zai/glm-5.3-flash`).
- `review` mode has no bash, so a reviewer **can't** `hc send` or run `git`. You give it a diff file to read and collect its answer with `hc send --wait` + `hc read`.
- Never use `pi -p` (print mode). Subagents stay interactive so you can watch, steer and reuse them.
- Subagents must not start agents of their own. Every prompt says so.

### 4.2 Pre-flight (stop and ask the owner if any check fails)

```sh
cd /Volumes/amey/Users/amey/workspace/devtools/herdr-app
test -n "$HC_TERMINAL_ID" && echo "orchestrator = $HC_TERMINAL_ID"   # you must run inside Herdr
git status --short                     # must print nothing. Anything else → ask the owner, don't stash or commit it
git branch --show-current              # main
git log --oneline -1                   # note the SHA: this is BASE
pi auth check --provider opencode-go --model glm-5.3-flash --json         # "status":"ready"
pi auth check --provider opencode-go --model deepseek-v4.1-flash --json   # "status":"ready"
herdr-app --version && hc --version
git worktree list                      # no leftover tc/* worktrees, else ask before removing them
```

### 4.3 Git topology

```
main  (owner only; never touched)
 └─ tc/integrate                    worktree ../herdr-app-wt/integrate       (you merge here)
     ├─ tc/space-icons              worktree ../herdr-app-wt/space-icons
     ├─ tc/space-tree               worktree ../herdr-app-wt/space-tree
     ├─ tc/git                      worktree ../herdr-app-wt/git
     ├─ tc/agent-usage              worktree ../herdr-app-wt/agent-usage
     ├─ tc/node-scripts             worktree ../herdr-app-wt/node-scripts
     └─ tc/review-mod               worktree ../herdr-app-wt/review-mod
```

```sh
R=/Volumes/amey/Users/amey/workspace/devtools/herdr-app
WT=/Volumes/amey/Users/amey/workspace/devtools/herdr-app-wt
mkdir -p "$WT/_diffs"
git -C "$R" worktree add -b tc/integrate "$WT/integrate" main
# per project, when you start it (branch from the CURRENT tc/integrate, so it includes shared-type changes):
git -C "$R" worktree add -b tc/<slug> "$WT/<slug>" tc/integrate
(cd "$WT/<slug>" && npm ci --silent)
```

- **One project = one worktree = one branch.** Projects own disjoint files (section 4.4), so their branches merge without conflicts.
- **One task = one commit** on the project branch, made by **you** after the task passes every gate. Subagents never run `git commit`, `git checkout`, `git reset`, `git stash` or `git restore`. The only git commands they may use are `git diff` and `git status`. This keeps every commit verified and lets you undo any one task.
- **Ledger.** Keep `$WT/LEDGER.md` outside the repo, one line per task: `project | file[:range] | status (todo/active/passed/failed/escalated) | commit | errors before→after | notes / approved exceptions`. Update it after every state change. If your context is compacted or you restart, rebuild your state from the ledger plus `git log tc/<slug>`, not from memory.

### 4.4 Projects, ownership and lanes

| Slug | Typecheck filter | Owns (may edit) | Notes |
|---|---|---|---|
| `space-icons` | `space-icons` | `herdr-minimal/space-icons/*.js` | Calibration project (4.5). |
| `space-tree` | `space-tree` | `herdr-sidebar/space-tree/*.js` | |
| `git` | `herdr-git` | `herdr-git/*.js` | `statusCard` is the known slow spot (section 6). |
| `agent-usage` | `agent-usage` | `herdr-usage/agent-usage/*.js` | Not `scan.mjs`: that belongs to node-scripts. |
| `node-scripts` | `node` | every `*.mjs`, incl. `herdr-usage/agent-usage/scan.mjs`, `herdr-review/mod/bin/*.mjs`, `herdr-review/install.mjs` | **Must not edit `herdr-review/mod/config-core.js`.** Its 44 errors here disappear when review-mod merges. Ignore that file in this project's gates. |
| `review-mod` | `herdr-review/mod` | `herdr-review/mod/*.js` (incl. `config-core.js`), `herdr-review/mod/types.d.ts` | The largest. Also matches `mod-inbox` and `mod-settings`, which already pass. |

Shared files that **only you** edit, on `tc/integrate`: `types/herdr.d.ts`, `tsconfig*.json`, `scripts/*`, `.gitignore`, `package*.json`, `README.md`.

**Concurrency: at most 3 implementers at once**, one per lane. Each lane works through its projects in order:

| Lane | Projects in order | Errors |
|---|---|---|
| A | review-mod | 461 |
| B | agent-usage → git | 375 |
| C | node-scripts → space-tree | 326 (excl. config-core.js) |

space-icons comes first and alone, before any lane starts (4.5).

### 4.5 Phases

**Phase 0: calibration, sequential, one implementer.** Run the full task loop (4.6) on `space-icons` (2 files, 15 errors) with a single implementer and a single reviewer. Watch it closely: read the implementer's screen (`hc read impl-space-icons --lines 150`) while it works. Adjust the prompt templates (4.7) based on what it gets wrong. Merge it into `tc/integrate` (4.9). Only then start the lanes.

**Phase 1, per project: shared shapes first (you do this yourself).** Before handing out any file task in a project:
1. Read the project's code enough to find the shapes that get passed around: theme `t`, status/config objects, option bags, records parsed from JSON, view state.
2. Write them in `<mod>/types.d.ts`, or for `node-scripts` in JSDoc `@typedef`s at the top of each file. Mirror `herdr-review/mod/types.d.ts`. Un-ignore a new `types.d.ts` in `.gitignore`.
3. Commit on the project branch: `types(<slug>): shared shapes`. Typing shapes is the step with the most leverage and needs the most judgment, so don't delegate it.
4. If a gap in Herdr's own types blocks progress, fix it in `types/herdr.d.ts` on `tc/integrate`, commit it, then `git -C "$WT/<slug>" merge --no-edit tc/integrate` in every active project worktree.

**Phase 2: file tasks.** One task = one file. If a file has **more than 80 errors** (review-mod `main.js`, agent-usage `main.js`, herdr-git `main.js`, space-tree `main.js`), split it into line ranges of about 250 lines at top-level function or method boundaries, and run those tasks one after another in the same worktree. Order tasks within a project: helpers and small modules first (they give `main.js` typed imports), then `main.js`.

**Phase 3: integration** (4.9) after each project passes.

### 4.6 The task loop (repeat per task)

Variables: `S` = slug, `F` = file path (repo-relative), `P` = typecheck filter, `D="$WT/$S"`.

1. **Snapshot.**
   ```sh
   cd "$D" && git status --short          # must be empty (the last task was committed or rolled back)
   npm run -s typecheck -- "$P" --by-file > "$WT/_diffs/$S.before.txt"
   ```
2. **Launch the implementer** once per project, then reuse it for that project's tasks. Restart it after about 6 tasks, or sooner if it gets confused.
   ```sh
   hc run --bg --name "impl-$S" --cwd "$D" pi --provider opencode-go --model glm-5.3-flash --thinking medium --start-mode yolo --name "impl-$S"
   hc wait "impl-$S" --timeout 60            # wait until it's idle before sending
   hc read "impl-$S" --lines 0               # check there's no trust or other dialog; if blocked, read it and ask the owner
   ```
3. **Send the task** with the implementer template (4.7): `hc send "impl-$S" "<prompt>"`. Read `hc get "impl-$S"` to confirm it's `working`. If it isn't, `hc read` before resending: a send to an agent that's still booting can be dropped, and a resend can duplicate the task.
4. **Wait without blocking yourself.** `hc wait --children any`. While lanes run, handle whichever child reported. An implementer report arrives as `<hc from="… impl-<slug>">DONE …</hc>`. A report is a claim, not proof: run the gates.
5. **Gates. All must pass, in this order:**
   ```sh
   cd "$D"
   # G1 scope: only the task's file changed (plus nothing untracked)
   git status --short                                   # exactly " M $F"
   # G2 runtime unchanged: comments only
   node scripts/same-runtime.mjs HEAD "$F"              # exit 0
   # G3 progress: the file is done, nothing else got worse
   npm run -s typecheck -- "$P" --by-file > "$WT/_diffs/$S.after.txt"
   #   - $F is absent from after.txt (for a range task: no errors with line numbers in the range;
   #     check with: npm run -s typecheck -- "$P" | grep "$F(" )
   #   - every other file's count in after.txt ≤ its count in before.txt
   #   - (node-scripts: ignore herdr-review/mod/config-core.js)
   # G4 no forbidden shortcuts
   git diff HEAD -- "$F" | grep -nE '^\+.*(@ts-ignore|@ts-nocheck|@ts-expect-error|\{any\}|\{\*\})' || echo "none"
   #   any hit: accept only if justified by rule 5, else send it back
   # G5 review
   git diff HEAD -- "$F" > "$WT/_diffs/$S-$(basename "$F").diff"
   ```
   For G5, launch the reviewer once per project and reuse it:
   ```sh
   hc run --bg --name "rev-$S" --cwd "$D" pi --provider opencode-go --model deepseek-v4.1-flash --thinking medium --start-mode review --name "rev-$S"
   hc wait "rev-$S" --timeout 60
   hc send --wait "rev-$S" "<reviewer prompt, 4.7>"     # returns when its turn ends; on "reason":"timeout" (180 s default) run `hc wait "rev-$S"` again
   hc read "rev-$S" --lines 120                          # its verdict: PASS, or numbered findings
   ```
   Judge each finding yourself and drop false ones. Valid findings go back to the implementer as one feedback message (4.7).
6. **Commit or roll back.**
   - All gates pass: `git -C "$D" commit -qam "types($S): $F"` (add `:<range>` for range tasks), then update the ledger.
   - A gate failed: send feedback (4.7) and go back to step 4. **At most 2 feedback rounds per task.** After that, roll back (4.8).

### 4.7 Prompt templates

Fill in everything in `<…>`. `$HC_TERMINAL_ID` is **your** ID: expand it when you send. Each subagent's own environment has a different value.

**Implementer task:**
```
You are adding JSDoc type annotations to one file in a JavaScript repo checked by TypeScript (checkJs, strict, noImplicitAny).
Working directory: <D> (a git worktree; stay inside it).
FILE: <F>          RANGE: <all | lines A–B: only annotate functions/methods starting in this range>
Check command: npm run -s typecheck -- <P> 2>&1 | grep '<F>('
Current errors in this file: <N>

Rules (breaking any one means the work is rejected):
1. Edit ONLY <F>. Add or modify COMMENTS only: JSDoc (@param, @returns, @type, @typedef, @template, @import). Do not change, reorder, reformat or delete any code, even whitespace inside code lines.
2. Do not edit tsconfig*.json, *.d.ts, package*.json, or any other file. If a shared type is missing, stop and report it (see 7).
3. No @ts-ignore, @ts-nocheck or @ts-expect-error. No {any} unless the value truly can be anything (raw JSON.parse output, an opaque cx); write the real type.
4. Types must be TRUE to how the code uses the value: look at the callers and the body. A value that can be null/undefined gets `|null` / `|undefined`, or is marked optional with [] in @param.
5. Do not run git except `git diff` and `git status`. Never commit, stash, checkout, reset or restore.
6. Do not start other agents or subagents.
7. Herdr's API types are in gpui-kit.d.ts in the mod folder (22k lines): grep it, never read it whole. Shared shapes for this project: <path to types.d.ts or "typedefs at the top of the file">. Import them with /** @import { Name } from "./types" */.
Patterns:
  /** @param {string} id @param {Opts} [opts] @returns {import("gpui-kit").Element} */
  A destructured parameter needs its own @param line, in position, with every parameter before it documented too.
  Arrays filled by push need a type: /** @type {import("gpui-kit").Element[]} */ const rows = [];
  Hex colors: import("gpui-kit").Color. Motion constants: import("gpui-shell").TransitionPolicy.
When the check command prints nothing for <F> (or nothing inside your range), run it once more to confirm, then report:
  hc send <ORCH_ID> "DONE <S> <F>: <N> -> 0 errors. Notes: <shared types you wished existed, or anything odd>"
If you are stuck after a real attempt, report instead of guessing:
  hc send <ORCH_ID> "STUCK <S> <F>: <the exact error text and what you tried>"
```

**Reviewer:**
```
Review a type-annotation-only change. Read the diff: <WT>/_diffs/<S>-<file>.diff
and the full file for context: <D>/<F> (and its callers if needed; grep is fine).
The change must add JSDoc types and nothing else. Check that each new type is TRUE:
- a parameter typed narrower than what callers actually pass (e.g. string, but some caller passes null/undefined or a number)
- a missing |null / |undefined, or an optional parameter not marked [optional]
- {any} where a real type was obvious, or a type so wide it checks nothing
- a @returns that doesn't match every return path
- any change to code (not comments)
Reply with exactly "PASS" if there's nothing to fix. Otherwise reply with a numbered list:
"<n>. line <L>: <what is wrong> → <the correct type>". No other commentary.
```

**Feedback to the implementer** (one message, every valid finding, gate output pasted verbatim):
```
Not accepted yet for <F>. Fix these, same rules as before, then report DONE again:
<G1/G2/G3/G4 output, or the reviewer findings you validated>
```

### 4.8 Failure handling and rollback

| Situation | Action |
|---|---|
| G2 fails (code changed) | Send it back once with the `same-runtime` output. If it happens again, roll back. |
| 2 feedback rounds used, still failing | `git -C "$D" restore -- "$F"` (you, not the subagent). Ledger: `failed`. Retry the task once with the **fallback implementer** (deepseek-v4.1-flash, yolo) in a fresh terminal, reviewed by GLM in review mode. |
| Fallback also fails | Ledger: `escalated`. Do it yourself, or split the range smaller. Never lower the gates. |
| `STUCK` report | Read it. Usually a shared shape or Herdr type is missing: add it (Phase 1 step 2 or 4), commit, then tell the implementer to continue. |
| Subagent `blocked` or `error` | `hc read <t> --lines 80`. Don't answer a permission dialog yourself; ask the owner. `hc interrupt <t>` stops a runaway turn without killing the process. |
| A committed task turns out wrong later | `git -C "$D" revert --no-edit <sha>` (a new commit; history stays intact). Re-queue the task. |
| A merge into `tc/integrate` breaks the full check | Before anything else is merged on top: `git -C "$WT/integrate" reset --hard ORIG_HEAD` (allowed: it's your branch, never pushed). Fix on the project branch, then merge again. If something has already been merged on top: `git revert -m 1 <merge-sha>`. |
| A typecheck suddenly takes > 30 s | It's the inference trap (section 6). Stop that task and find the slow function. |
| A subagent edited a file it doesn't own | Roll back that file (`git restore`). Repeat rule 2 in the next message. If it happens twice, replace the subagent. |

### 4.9 Integration and final verification

When every task in a project is committed and `npm run -s typecheck -- "$P"` passes in its worktree (node-scripts: everything except `config-core.js`):

```sh
cd "$WT/integrate"
git merge --no-ff --no-edit "tc/$S"                      # one merge commit per project = one revert point
npm ci --silent                                          # first time only
npm run -s typecheck -- --by-file                        # this project ✓; no other project's counts went up
node scripts/same-runtime.mjs main                       # every .js/.mjs ✓, except fixes you approved and logged
```

Then remove the worktree (`git -C "$R" worktree remove "$WT/$S"`; keep the branch until the owner merges), kill and remove that project's subagents (`hc kill impl-$S; hc rm impl-$S; hc kill rev-$S; hc rm rev-$S`), and start the lane's next project, branched from the updated `tc/integrate`.

**Final, after all six projects are merged:**
1. In `$WT/integrate`: `npm run typecheck` prints `All 9 projects pass.` and `node scripts/same-runtime.mjs main` passes except for the logged exceptions.
2. `herdr-app check <folder>` passes for each of the 8 mod folders in `$WT/integrate`.
3. **Ask the owner** before installing. With approval, install from the integrate worktree: `"$WT/integrate/install.sh" install`. Check that `herdr-app status` shows `"errors": []` and ask the owner to click through each mod: the git panel, the sidebar, the space icons, the usage widget and settings, a review (ctrl-shift-r), the review inbox (ctrl-shift-i).
4. Report to the owner: the `tc/integrate` log, per-project before/after counts, every approved code change and `@ts-expect-error` with its reason, every escalation. Hand over the ledger. The owner merges `tc/integrate` into `main`.
5. Clean up: `hc ls` shows none of your subagents left, and `git worktree list` shows only `integrate`, plus `main`'s checkout.

---

## 5. Typing patterns (give these to subagents as needed)

```js
/**
 * @param {string} id
 * @param {Theme} t
 * @param {{ label?: string, onClick?: (cx: any) => void, disabled?: boolean }} [opts]
 * @returns {import("gpui-kit").Element}
 */
function btn(id, t, { label, onClick, disabled = false } = {}) { … }

/** @import { Annotation, BtnOpts } from "./types" */                   // TS 5.5+: type-only import
/** @typedef {{ id: string, label: string, files: FileEntry[] }} Group */  // a local shape
/** @type {import("gpui-kit").Element[]} */ const rows = [];             // inline import
```

Herdr's types live in the modules `"gpui-kit"` (elements, `Color`, `Length`), `"gpui-base"`, `"gpui-shell"` (`TransitionPolicy`, `MotionEasing`) and `"herdr"` (`theme`, `openOverlay`, `OverlaySpec`, …). Grep the mod's generated `gpui-kit.d.ts` for a name.

| Error | Cause | Fix |
|---|---|---|
| `TS7006 Parameter 'x' implicitly has an 'any' type` | Untyped parameter | `@param` |
| `TS8024 JSDoc '@param' tag has name 'opts', but there is no parameter…` | A destructured parameter's `@param` is out of position | Document every parameter, in order |
| `TS7034/TS7005` on `const rows = []` | Array whose type comes from later `push`es | `/** @type {X[]} */` |
| `'string' is not assignable to '#${string}'` | A color from a helper typed `string` | `@returns {import("gpui-kit").Color}` on the helper (`theme()` is already fixed) |
| `{ duration, easing: string }` not assignable to `TransitionPolicy` | `"ease-out"` widened to `string` | `/** @type {import("gpui-shell").TransitionPolicy} */` on the constant |
| `Property 'x' does not exist on type '{}'` | Defaulted `= {}` parameter, or an untyped `JSON.parse` result | Type the parameter or the parsed value |
| Property missing on an object literal type | A field added after construction (`r.live = …`) | A typedef that includes the later field |
| `kind: string` not assignable to `"window" \| …` | A config constant widened | `/** @type {import("herdr").OverlaySpec} */` |
| A Herdr function typed `Record<string, unknown>` | Gap in Herdr's generated types | Orchestrator: an overload in `types/herdr.d.ts` |

## 6. The inference trap

**Give every array filled by `push` inside loops an explicit type.** In `herdr-git/main.js` `statusCard`, one untyped `const rows = []` built from long chained element calls made tsc take about 10 minutes for that one file. One `@type` line fixed it. If a check takes more than about 30 seconds:

- copy the mod's files into a scratch folder,
- replace method bodies one at a time with `return null;`,
- run tsc with a time limit: `perl -e 'alarm(30); exec(@ARGV)' node_modules/.bin/tsc …` (exit 142 or signal 14 means it hit the limit).

The method whose stub makes it fast again is the culprit.

## 7. Definition of done

- In `tc/integrate`, `npm run typecheck` prints `All 9 projects pass.`
- `node scripts/same-runtime.mjs main` passes except for the approved, logged code changes.
- No `@ts-ignore` or `@ts-nocheck`. Every `@ts-expect-error` and every unavoidable `any` has a reason next to it.
- Every mod passes `herdr-app check`. After the owner-approved install, `herdr-app status` shows no errors and the owner has clicked through the mods.
- Every task is its own commit, every project is its own merge commit, and the ledger matches `git log`.
- No subagent terminals or extra worktrees are left. `main` is untouched.
