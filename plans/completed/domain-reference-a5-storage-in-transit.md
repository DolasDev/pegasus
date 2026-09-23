# Domain reference — A5, storage-in-transit: COMPLETE

**Landed 2026-09-23.** Deliverable 1 of `plans/in-progress/domain-reference-areas-a2-a5.md` — the
second of the six unwritten area comparisons, after A1. A2 and the rest carry forward in
`plans/in-progress/domain-reference-areas-a2.md`.

## The headline

**A5 is the corpus's best-covered detail area, and almost none of that coverage was structure it
needed.** The shared layer had already minted the `stay` aggregate, three record types on it
(`storeIn`, `sitEntryDate`, `storeOut`), and closed authority rows for all three — so A5's work was
to answer four boundary questions and to publish one value shape. It minted **no record type, no
aggregate, no projection and no reason code**, which makes it the first area document whose main
output is a set of refusals.

The deliverable is `docs/domain-reference/analysis/A5-storage-in-transit.md` (≈700 lines), one
remedy shape, one closed enum, three new **absent** fact classes, and a version bump to `0.5.0`
under a change class that did not exist before.

## The five owed items, and how each closed

| #   | Owed by                              | Settled                                                                                                                                                              |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [A4 §5] item 2 / [SD §2.4] rule 5    | `Remedy` gains `{ opensStay: { stay, location } }` and **loses its `Owed` branch**. `STAY_LOCATIONS` = `ORIGIN` \| `IN_TRANSIT` \| `DESTINATION`                     |
| 2   | [SD §9] item 2 / [SD §10.4] bullet 2 | **The question is a false alternative.** A stay is an aggregate; the warehouse _visit_ is a `stop`; neither contains the other. [A3 §5.1] had already got there      |
| 3   | [SD §10.4] bullet 1                  | Termination ends liability, not the occupancy — the stay's identity is untouched, so `storeOut` after a terminated stay names the same `stay`. **A2's half is left** |
| 4   | [SD §4.8.3] / [A3 §8] scenario 8     | **A dwell is a stay iff a stay was opened for it.** No test on duration, facility, custody or cause. [ORIGINAL]                                                      |
| 5   | rubric, the A5 row                   | Two already exist, two are somebody else's, one is not in the model, and three new fact classes are **absent and owed**                                              |

## The decisions worth remembering

- **Three endings, not one.** The corpus says "converted" in three different senses and a reader who
  collapses them gets all three wrong: **customer expense** changes the payer and nothing else (A7);
  **termination** ends the carrier's BL liability and makes the warehouse the final destination
  while the occupancy continues; **permanent storage** is a different bailment and leaves the model.
  `src:dtr-part-iv` uses two of the three phrases in one sentence (§D.5.c(1) NOTE).
- **A1's hand-off closed without A1 changing.** A1 asked whether A5 would need the commitment and the
  liability to part company. It does not: the obligation that survives termination is the **order's**
  (delivery out of storage), and an outstanding obligation is exactly what `ACCEPTED` means.
- **The corpus contradicts itself on SIT-as-a-stop and both halves were usable.**
  `src:atlas-world-group-api` (estimating side) says storage is a service at a stop and its stop-type
  enum has no storage member; `src:sirva-ade` publishes `STORAGE IN TRANSIT` as a `LocationTypeName`.
  A5 took Atlas's observation **negatively** (SIT is not a stop _type_) and ADE's positively (a
  warehouse visit is a real stop), and neither won.
- **Three refusals to mint, and they all reduce to [A8 §9 item 1], not item 8.** Authorising,
  extending and terminating a stay are done by a Government transportation office or an approving
  supervisor, and there is no party entity for either. The discriminator that makes this legible:
  **the physical acts on a stay have closed authority rows and the administrative acts cannot have
  any**, because only the physical ones have an asserter who was in the warehouse. That is a sharper
  argument for doing item 1 than the ledger currently carries, and it will repeat in A6, A7 and A10.
- **The hardest refusal was a fold, not a type.** `src:dtr-part-iv` §C.9.c publishes the SIT day
  arithmetic **verbatim** — more support than `custodyAt` or `orderStageAt` ever had — and A5 still
  did not publish it, because its principal input (`stayAllowance`) does not exist and the half that
  does compute is an accrual figure with no cap beside it, which `src:dp3-400ng` Item 17.7 exists to
  say is a different number. The equations are cited in §3.6 so nobody has to find them again.
- **Not every stay is opened by a remedy.** `src:cfr-49-375` §375.607 — the carrier tendering >24h
  early, storing "on its own account and at its own expense", retaining BL liability — is a
  `storeIn` with no failed act behind it. Noticing that is what kept an `account` member off the
  remedy and kept `remedyRequired` at `false`. **The consumer-facing consequence is recorded rather
  than fixed**: a bare `PARTY_NOT_READY` stays a valid record, and `catalog/index.json`'s `reasons`
  note does not tell a consumer that 400NG Item 17.15 compels the placement anyway. That is a
  documentation choice about the published contract, and [A5 §6] hands it to the user.

## The second-subject question, and why the answer had to be structural

A `SubjectRef` inside a remedy is exactly the shape [SD §1.1]'s "no second subject hidden inside the
payload" is worded to catch, and an argument by analogy with `appliesTo` would not have held. The
argument that does: the prohibition exists because two subjects make [SD §4.3]'s resolution rule
undecidable, and **a remedy cannot reach that rule — reasons are not facts.** Nothing inside a
`reasons[]` member is ever selected by a `FactResolved`, and the fact key reads the envelope and
never the payload. The ref is a forward reference to an aggregate that acquires its facts elsewhere;
the first record to assert anything about that stay is a `storeIn` whose **envelope** subject it is.

## A new compatibility class, and how the schema diff produced it

`0.4.0` → `0.5.0` is **`publishedOwedShape`**, a member of `ADDITIVE_CHANGES` that did not exist.
The diff is two `$defs` — `Owed.remedy` gone, `OpensStay` new — plus a swapped `anyOf` branch on
`Remedy`. It is the sibling of `publishedOwedVocabulary` one level up the type, additive on the same
ground (**the owed marker was itself published**: the removed branch's `owedTo` was a `const` naming
A5, so the wire said it was a placeholder), and distinguished from it because it does not narrow a
string to an enum. Same emitted footnote applies: the owed branch's `$defs` entry **disappears**, so
a consumer pinning that `$ref` loses it.

**The absent-class count went 10 → 13 while the declared-owed count went 19 → 18**, in the same
release. [catalog §5] now says why that pair is healthy: a gap list that only ever shrinks is a gap
list nobody is still reading the corpus against.

## What shipped

| What                      | Where                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The area document         | `docs/domain-reference/analysis/A5-storage-in-transit.md`                                                            |
| The remedy + its enum     | `OpensStay`, `STAY_LOCATIONS` in `packages/domain-reference/src/outcomes.ts`                                         |
| The union, owed-free      | `Remedy` — two members; `Owed` is no longer imported by that module                                                  |
| The shape-name gate       | `REMEDY_SHAPES` + `RemedyShapesCoverTheUnion` (an `Exact`, **assigned `true`**), and a loader check in `src/data.ts` |
| Three absent fact classes | `ABSENT_AND_OWED` in `src/vocabulary.ts` + the matching prose in [SD §4.7.3]                                         |
| The version + a new class | `CATALOG_VERSION = '0.5.0'`; `publishedOwedShape` in `ADDITIVE_CHANGES` and [catalog §2.3]                           |
| Registration              | `A5` in `DOCUMENTS`, `STAY_LOCATIONS` in `VOCABULARIES`, both in `tools/generate-glossary.ts`                        |
| Amended peers             | [SD §4.7.3] (+3 rows), [SD §10.4] (two items closed), [A4 §5] + [A4 §3] note, [catalog §2.3]/§2.4/§5, `rubric.md`    |
| Tests rewritten           | scenario 2's `OWED` block became three assertions; scenario 3's owed-remedy block became the typed second branch     |

Gates green: `tsc` silent · the vitest suite green · lint clean · Alloy every command as expected ·
glossary and catalog regenerated and prettier fixed points · `npx prettier --check` clean over both
trees except `packages/domain-reference/alloy/run.mjs`, which fails on `main` already.

## Gates tampered and watched to fail

Three deliberately, restored after each, plus four the suite caught on its own.

**Deliberate:** a `remedyShape` of `opensStayy` in `data/reasons.json` (13 tests fail naming the
path and the Remedy union); a third `Remedy` member (`tsc` errors on the `Exact` assignment); and
renaming `` `stayAllowance` `` in [SD §4.7.3] (`documents.test.ts` names the member and the phrase).

**Caught by the suite without being asked:** the catalog owed-count gate on both counts at once
(19 → 18 declared, 10 → 13 absent), the catalog staleness gate, the glossary staleness gate, and
`documents.test.ts` refusing `stayAuthorisation` before [SD §4.7.3] named it.

## One gate did not exist until it was tampered with

`RemedyShapesCoverTheUnion` was first written as a bare `export type … = Exact<RemedyShape,
RemedyKey>`. Adding a third `Remedy` member **compiled clean**: a type alias that evaluates to
`never` reports nothing. The codebase's own convention is the fix and it was three lines away —
`src/catalog.ts:51`, `src/data.ts:281`, `src/assertions.ts:209` and `src/rules/authority.ts:1019`
all follow `Exact<>` with `const _x: T = true`, and that assignment is the whole gate.

**A compile-time assertion nobody tried to break is a comment.** This one was live for about ninety
seconds of wall-clock as a comment, and only the tamper found it.
