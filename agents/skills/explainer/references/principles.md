# Writing and learning principles

These come from research on how people read, understand and remember. Treat them as a toolbox, not a template. Apply each one when it serves the intent and the reader in the brief. When two pull in different directions, the reader's needs decide.

## Cognitive load (Sweller)
- Working memory holds about 4 chunks. Keep one idea per paragraph, one idea per section and one message per visual.
- Readers understand new things by attaching them to things they already know. Tie each new idea to something the reader knows, and say what the link is.
- Cut anything that doesn't serve the intent. Extra material, however interesting, uses up attention the reader needs for the main point.

## Representation (Mayer, multimedia learning)

| Content is about… | Usually best as |
|---|---|
| Logic, sequence, argument, abstract relations | Prose |
| Structure: hierarchies, relations, processes, comparisons, parts of a system | Static diagram or table |
| Something that is inherently dynamic: motion, propagation, state changing over time | Animation storyboard |

- Pair words with visuals, but don't let the words repeat what the visual already shows (redundancy hurts).
- **Signaling**: bold key terms, number steps, highlight the part being discussed.
- **Contiguity**: put labels next to what they label, and text next to the visual it describes.
- No decoration: if removing something loses no meaning, remove it.
- Visuals must render: mermaid or SVG code blocks, tables, or precise ASCII.

## Animation (Tversky, Bétrancourt)
- Use it only for content that really is dynamic. Animating static content adds load and teaches nothing extra.
- Write it as a storyboard: frames, what changes in each frame, timing, narration, and points where the reader can pause.

## Pitch and difficulty (Vygotsky's ZPD; Bjork's desirable difficulties)
- Pitch the material just beyond what the reader can already do: reachable with effort.
- If the goal is durable understanding, some friction helps: smooth reading feels good but is forgotten. Use friction the text then resolves, never confusion it leaves open.
- If the goal is quick action or a decision, friction is a defect. Remove it.
- State prerequisites up front rather than leaving the reader to discover gaps.

## Learning techniques
- **Concreteness fading**: concrete example, then a picture or diagram, then the general or formal statement.
- **Worked examples**: show one solved case, then a partly solved one for the reader to finish.
- **Retrieval practice**: prompts that ask the reader to recall or apply an idea without looking, ideally including one new case (transfer).
- **Information gap**: open with a question or prediction the reader can almost, but not quite, answer.

## Analogies (Gentner, structure mapping)
- Map relations, not surface features ("voltage is to current as pressure is to flow").
- Say where the analogy breaks, before the reader finds out the hard way.
- One analogy per concept. Stacked metaphors interfere with each other.

## Structure for action and decisions
- **Bottom line up front / Minto pyramid**: conclusion or ask first, then the key arguments, then the evidence.
- Task-first headings named after what the reader wants to do, numbered steps, and the expected result after any step that can fail.
- Present real options with their trade-offs, and answer the reader's strongest objection before they raise it.

## Language
- Define each term where it is first used, never after it.
- Give a specific case before the general rule.
- Use connected prose for reasoning. Keep bullets for things that are actually parallel.
- Say the point, then qualify it. Hedging shouldn't hide the point.

## Anti-patterns
- Filler openers, motivational fluff, decorative images.
- Jargon that is undefined, or defined far from where it is first used.
- Walls of text, or the opposite: fragments with no reasoning connecting them.
- Over-smoothing: removing difficulty the intent actually needs.
