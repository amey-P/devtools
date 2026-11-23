# State layout

```
$NOTES/learning/<topic>/        NOTES defaults to ~/Documents/Notes
  contract.md     why, trigger, priors, outcomes + evidence, pieces, resources, cadence, bar, validator
  log.md          one row per session
  reviews.md      the review queue: the learner's own prompts and their schedule
  questions.md    questions in the learner's words, and the reading pointers given
  sources.md      resources: the learner's, plus pointers they kept
  notes/          the learner's notes: never written by the system
  sessions/       peruse documents (Herdr only): YYYY-MM-DD-<step>.md
```

Use plain markdown with no YAML frontmatter, so it reads cleanly in Obsidian. Text in `«»` below marks
where the learner's words go, verbatim. Create files from these templates on first use.

## contract.md

```md
# «Topic» learning contract
Started: YYYY-MM-DD · Session: 0 · Bar: «80 % over ≥ 2 prompts» · Validator: «name / self»
Cadence: «minutes» per sitting, «n» per week, target «date»

## Why
«…»

## Trigger
«…»

## Priors
- P1 «what I know / can do / believe»

## Outcomes
| # | By the end I can… | Evidence | Status |
|---|---|---|---|
| O1 | «…» | «…» | open / evidence ready / validated |

## Pieces
| # | Piece | Needs | For | Status |
|---|---|---|---|---|
| K1 | «…» | — | O1 | not started / started / meets bar |

## Resources
- «…»

## History
(previous versions of edited sections, dated)
```

## log.md

```md
| # | Date | Min | Did | Pretest | Pretest held? | Where / how / next | Change to how I learn |
|---|---|---|---|---|---|---|---|
```

## reviews.md

```md
| ID | Piece | Kind | Prompt | Interval | Due at session | History |
|---|---|---|---|---|---|---|
| R1 | K1 | recall | «…» | 1 | 2 | — |
| R2 | K1 | transfer | «…» | 3 | 5 | s2 ✓ |
```

- `Interval` steps through 1 → 3 → 7 → `milestone`. A miss sets it back to 1.
- `Due at session` = current session + interval.
- `History`: `s<n> ✓` for a pass, `s<n> ✗` for a miss, as self-marked.
- A prompt whose piece meets the bar stays in the queue at `milestone`.
- IDs are never reused. A prompt the learner replaces is marked `retired` in History.

## questions.md

```md
## Open
- Q1 (s3) «question as asked» — rung reached: 4
  - pointer: «Title», Author/Site, <link> — why it fits: «one line»

## Closed
- Q0 (s1 → s2) «question» — closed by learner: «their words, optional»
```

## sources.md

```md
- «Title», Author/Site, <link> — added by learner / pointer for Q1
```
