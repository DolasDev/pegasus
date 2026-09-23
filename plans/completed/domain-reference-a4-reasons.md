# Domain reference — A4 reason vocabulary: COMPLETE

**Landed 2026-09-22.** Deliverable 1 of `plans/in-progress/domain-reference-a4-reasons.md`. The other
two deliverables (A8's owed authority rows, the unwritten area comparisons) were **not** started and
carry forward in `plans/in-progress/domain-reference-a8-and-areas.md`.

## What shipped

The A4 reason vocabulary — **23 members** — plus the area document that decided it. The catalog went
to `specVersion` **0.2.0**.

| What                                                             | Where                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| The decision document                                            | `docs/domain-reference/analysis/A4-execution-events.md`       |
| The names + evidence, one JSDoc per member                       | `REASON_CODES` in `packages/domain-reference/src/outcomes.ts` |
| The per-code discipline (scope, `partyRequired`, remedy, marker) | `packages/domain-reference/data/reasons.json`                 |
| The typed remedy                                                 | `NewWindow` in `src/outcomes.ts`                              |
| The new compatibility class                                      | `publishedOwedVocabulary` in `src/catalog.ts`                 |

`ReasonCode` stopped being `OwedCode<'reasonCode'>` and became a closed union, so `reasonCode()` is a
real boundary parser and `Portion.basis` is now constrained to a published member.

Gates green: `tsc` silent · **307 tests in 18 files** · lint clean · Alloy every command as expected ·
glossary and catalog both regenerated and prettier fixed points.

## The decisions worth remembering

- **Rule 1 (reasons orthogonal to outcomes) is the whole design, and it needs a reader.** The
  type-level `ReasonCodesAreOutcomeFree` and the run-time `outcomeWordIn` only catch a code containing
  an outcome member's _name_. Two placeholder literals got past both: `PARTIAL_LOAD` (names a scope of
  performance, which IS the outcome) and `ALREADY_PERFORMED` (a completion verb). Renamed to `OVERFLOW`
  and `OUT_OF_SEQUENCE`.
- **All three of [SD §2.6]'s worked literals were unpublishable, each for a different reason.**
  `CONSIGNEE_ABSENT` bakes a role into the code, which **rule 6** forbids → `PARTY_ABSENT`.
  `REFUSED_DAMAGE` hides an outcome in a verb (rule 1) → `GOODS_DAMAGED`. `SHORT` reads as a magnitude
  → `GOODS_MISSING`. The loader independently forbids publishing an `illustrativeOnly` code, so the
  renames were forced as well as right. [SD §2.6] now carries a footnote with the mapping.
- **`MQP`/`MQT` collapsed into one code.** Magnitude belongs to the outcome axis plus `appliesTo`;
  carrying it on both axes is how a producer ends up choosing between two codes that mean the same
  thing.
- **The "HHG authoring gap" was narrower than [SD §2.4]'s examples suggested — this is the biggest
  finding.** [SD §2.4] says the `SITE`/`ADMINISTRATIVE` examples are "none of which **Shippeo** has",
  which is true and is about Shippeo. It had been read as "no source publishes these". It is not:
  - `src:dp3-400ng` **Item 125.1 enumerates the valid shuttle causes** (building structure, highway
    inaccessibility, unsafe road, overhead obstructions, narrow gates, sharp turns, trees, roadway
    deterioration, the nature of an article) and **Item 33** adds impractical operations. Regulation
    grade. `SITE_INACCESSIBLE` carries **no marker**.
  - `src:cfr-49-375` §375.401(f) names "elevators, long carries" as accessorials — but requires them
    determined _before_ the BOL, so reading them as an execution-time reason is **[SYNTHESIS]**.
  - `AUTHORISATION_MISSING` is the best-sourced `ADMINISTRATIVE` member: 400NG gates shuttle,
    attempted delivery and SIT entry on pre-approval; Atlas carries `nO_Prior_OPS_Approval`.
  - Only **parking permit** is genuinely `[ORIGINAL]`, and COI-not-on-file is an _instance_ of
    `DOCUMENT_MISSING_OR_INCORRECT`, not a member of its own.
    Only **3 of 23** members carry a marker: `GOODS_MISSING` and `SITE_HANDLING_EXCESS` `[SYNTHESIS]`,
    `OUT_OF_SEQUENCE` `[ORIGINAL]`.
- **Publishing an owed vocabulary is not `newClosedEnumMember`.** It narrows `string` → enum, which is
  a **restriction on the captured face**. Classified additive as `publishedOwedVocabulary` because the
  `x-owed` marker was itself published, so no conforming producer could have relied on a code being
  accepted. The restriction is recorded with the class rather than absorbed. [A4 §7], [catalog §2.3].

## A disclosure defect in A4's own §0, caught before the PR

`A4 §0` rule 2 claimed a consumer reading `catalog/index.json` sees each member's marker "without
reading this file". Nothing emitted them. It was fixed by making the claim true rather than by
softening it, because the same gap hid a real one: **`attribution.party` and `remedy` are
schema-optional on every code**, so the emitted schemas admit a `PARTY_ABSENT` with no remedy — a
record A4 calls incomplete. JSON Schema cannot express a per-code obligation, so `index.json` now
carries a `reasons` block with the whole per-code discipline. The type-level fix (a third `Reason`
branch excluding the remedy-requiring codes) is owed at `A4 §5` item 4, because it changes the
published `Reason` shape and that is `[catalog §2.3]`'s call.

Worth knowing before the next `publishedOwedVocabulary`: **the owed code's `$defs` entry
disappears.** `ReasonCode.reasonCode` was a named string schema; a closed union of string literals
inlines as an `enum` on the property, so a consumer pinning that `$ref` loses it.

## Two things found on the way that were not in the brief

1. **The owed ledger could not see an owed vocabulary.** It read `owed(name, owedTo)` and
   `Owed<Name, Owner>` only — never `OwedCode<'x'>` — so the inventory reported 21 owed values and
   **zero owed vocabularies** while four closed enums had no members. Landing A4 was supposed to shrink
   the inventory and did not, which is how it surfaced. Fixed: `owedVocabulariesFromCode` in
   `generate-glossary.ts`, a new glossary section and an `owed.vocabularies` field in
   `catalog/index.json`. Three remain: `roleClass`, `unitOfMeasure`, `identityScheme`.
2. **The glossary counted corpus citations but never rendered them**, so an entry whose whole evidence
   was external read as "_no document citation in the docstring_" — exactly backwards for a model built
   from external sources. Eleven of the 23 reason codes hit it. Fixed with a **Corpus** fact line.

## Also fixed (warm-up items from the plan)

- `docs/domain-reference/README.md` advertised a `model/` and a `mappings/` layer, neither of which
  exists. Now describes what exists (the executable specification, the generated glossary), records the
  three pieces of `model/` that genuinely are missing — **the context map, the command side, the
  aggregate lifecycles** — and says `mappings/` is absent deliberately. The Process table's statuses
  were stale and are now honest.
- `docs/domain-reference/rubric.md` marked all nine areas "modeled in detail" with nothing saying which
  actually were. A note now states it: A3 and A8 have full documents, A4 has a vocabulary-only one, and
  **A1, A2, A5, A6, A7, A9 have no area analysis at all**.

## What A4 left owed, deliberately

- **`attribution.roleClass`** → [A8 §9 item 2]. Per-code discipline is a boolean (`partyRequired`),
  never a role-class literal, so nothing guesses a member of an enum that does not exist.
  **A4 hands A8 one concrete requirement: the enum needs an explicit non-party member**, because
  `FORCE_MAJEURE` and `CAUSE_UNKNOWN` both attribute to nobody and `roleClass` is mandatory.
- **Every remedy shape beyond `newWindow`**, of which the one that matters **opens a SIT stay** → A5.
- **The A4 area comparison itself** — the eight-criteria scoring of the execution-event and tracking
  model. Only the vocabulary is done.
