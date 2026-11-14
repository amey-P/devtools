---
name: explainer
description: A generic framework for writing anything meant to make a particular reader understand, do or decide something (explanations, tutorials, docs, runbooks, proposals, summaries, notes). A writer subagent applies literature-backed writing and learning principles. Fresh, isolated cold-reader subagents matched to the target audience then read the draft and try to use it, and the writer revises from their feedback until the material fits that audience. Use when asked to explain X to <audience>, write something for a specific reader, or "make this understandable to…". Needs some way to spawn subagents.
---

# Explainer

Material is only as good as its fit to the person who will read it, so test it on a stand-in for that person before it ships.

## Fixed parts

Only these are fixed:

1. **The writer applies `references/principles.md`** (cognitive load, multimedia learning, desirable difficulties, analogy and structure research), using whatever serves the intent and reader.
2. **Cold readers match the audience.** Each one knows what the target reader knows, believes what they believe (misconceptions included), and is in their situation (time, pressure, role). Each is **fresh every time** and sees **only the reader profile and the material**: never the brief, the principles, the writer's notes, earlier drafts or other readers' reports. Never role-play a reader yourself, because you have seen the brief. `references/runtime.md` covers how to get this isolation on whatever harness you're on.
3. **When more than one model is available, at least one reader runs on a weaker model** as a check on legibility and cognitive load. If it fails something stronger readers manage, the text is relying on reader intelligence to fill a gap it should close itself.

Everything else is your call, and this skill says nothing about it: form, structure, length, how many readers and in what roles, how many rounds, what counts as good enough, file names and layout.

## The loop

1. **Recon.** Ask the user only what you can't infer: the intent (what the reader should understand, be able to do or decide afterwards), the audience (what they know, what they believe, their likely misconceptions or objections, their time and situation), constraints, and sources.
2. **Brief and reader profile.** Write a brief for the writer. Write a first-person profile for the readers: what I know, what I believe (phrased as beliefs, never labelled as wrong), my situation. Leave out goals, scope and anything that would tell the reader what the material is supposed to achieve.
3. **Draft.** Spawn the writer (`agents/author.md`). It produces the draft plus notes containing `## Expected takeaways`, the yardstick.
4. **Cold read.** Turn the intent into a concrete **Check**: what the reader should be able to restate, do or decide after reading. Spawn readers (`agents/validator.md`) with their role line, the Check, the reader profile and the draft.
5. **Synthesize.** Compare the reports against Expected takeaways, and give the writer one deduplicated feedback document: where readers stalled, guessed or got it wrong (with quotes); in-scope questions left unanswered; out-of-scope questions to point elsewhere; what readers valued and must keep; and, from round two on, whether earlier issues are fixed. Don't pass raw reports on to the writer.
6. **Revise and re-test** with fresh readers until they can do what the intent requires with no unresolved confusion, or until further rounds stop helping. Then deliver the material and tell the user what was tested, how readers did, and what remains open.
