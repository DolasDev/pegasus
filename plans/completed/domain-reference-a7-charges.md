# Domain reference — A7, charges & billing hooks: COMPLETE

**Landed 2026-09-28.** The deliverable of `plans/in-progress/domain-reference-areas-a7.md` — the
fifth of the unwritten area comparisons, after A1, A5, A2 and A6. A9 carries forward in
`plans/in-progress/domain-reference-areas-a9.md`.

## The headline

**A7's decisions change no published byte — and the version moved anyway, because the round's
_audit_ found `chargeValue` owed to the wrong area and `owedTo` is emitted as a schema `const`.**

A2 and A6 each made decisions and moved nothing on the wire. A7 inverts the pattern. `[A7 §3.2]`
mints no aggregate, `[A7 §3.3]` and `[A7 §3.4]` publish no vocabulary, and `chargeCollection` is one
more member of the owed inventory — which `[catalog §5]` already distinguishes from a change to what
is published. What moved `0.5.0` → `0.6.0` is a one-line diff in each emitted schema that **no
decision in the document put there**.

The deliverable is `docs/domain-reference/analysis/A7-charges-billing.md` (≈1450 lines), one named
rule, one absent fact class, one seven-row data table, one compile-time gate, and a new change class
at `[catalog §2.3]`.

## The nine owed items, and how each closed

| #   | Owed by                                                      | Settled                                                                                                                                                   |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `[A2 §3.6]`'s instruction to A6, A7 and A9; the rubric's row | **Propose, decide and rate have records; bill, collect and pay do not** — and the blocker is that `[SD §1.2]` has no `invoice` and no `payment` aggregate |
| 2   | §2's eleven disagreeing publishers                           | **Refused**, and the projection refused harder — a `chargeStateAt` would be **B-STAGE a third time**                                                      |
| 3   | the rubric's first clause; `[A3 §Cross-area]`                | **No charge-type vocabulary.** The five names in App. A cut on ≥3 facets; the causal **scope** is already declared in `context[]` and is not the taxonomy |
| 4   | `[A2 §Cross-area]` (a)                                       | **A2's placement OVERTURNED** — `[SD §4.4]` answered it before A2 asked, with a **billing** rule                                                          |
| 5   | `[A1 §Cross-area]`                                           | **`PRINCIPAL` reaches it.** `[A8 §4.3]`'s definition resolves against a party and names no record. Nothing asked of A8                                    |
| 6   | `[A6 §Cross-area]`; a comment in a passing scenario test     | **A-COLLECT** — D-CITE generalised past documents. Four of seven rows gate on something that is not a document                                            |
| 7   | `[SD §6.3]`                                                  | **Three of four fit.** A reimbursement does not need the door; the **cross-subject set-off** is a silence, recorded not closed                            |
| 8   | `[A4 §4.6]`'s confidence row; a live docstring in `src/`     | **Discharged.** No capture-time tariff classification — Item 28.4's exclusions turn on facts the recording party does not hold                            |
| 9   | `[A5 §Cross-area]`; `[SD §8.4]`'s confidence row             | Four of A5's five go to A12; the fifth was item 4. **`[SD §8.4]` ratified on an independent premise and its reversal window closed**                      |

## Two §1 audit findings, which is now a four-round pattern

1. **Two of the nine were discharged before A7 opened them, and one by `[SD]` itself.**
   `[A2 §3.6]` argued that a billable weight is not one of `[SD §4.2]`'s five bases — correct — and
   concluded it must be a `charge`. Two passages in `[SD]` that A2 did not read against its own
   question say otherwise: **`[SD §4.1]`'s `measure` row quotes element 187 with `B` billed beside
   `G`, `N` and `T`** (the axis the model maps to `type`, not the one it maps to `basis`), and
   **`[SD §4.4]`'s `R-WEIGHT-LOWER` is sourced by `src:dp3-400ng` Item 4.11.d — _"invoice on the
   lesser weight"_**. So in the reweigh case all three of A2's sources are about, the billed weight
   is `weight.net` **resolved**, which is why `weight.net`'s authority row reads `boundBy = NONE`.
   And owed item 5 is answered by `[A8 §4.3]`'s own definition of `PRINCIPAL` rather than by row
   11's summary.
2. **The plan was wrong in three places, each checkable in under a minute.**
   - It lists `src:sirva-ade` among "six of our own systems… **all** `mapping-only`". The registry
     says `role: model-evidence` — an external partner contract whose `areas:` names A7, scoring
     C1=3/C4=3/C7=3 on it. Five of our own systems are mapping-only; the sixth item is the **S5 fit
     row inside** sirva-ade's analysis, which describes our `financial_settlement` floor.
   - It predicts _"only `cfr-49-375` was primary for A6 — the same will be true for A7."_ **Five**
     A7 sources have a `captured/` directory.
   - It describes A7 as inheriting _"a type with no family and no value"_ and omits that `charge`'s
     **authority row is assigned** (`boundBy = PRINCIPAL`, `[A8 §5]` row 11) and that its
     `context[]` already carries all six scopings the inbound hand-offs need.
3. **The plan named four inbound hand-offs; there are eight.** Two of the extra four are in code:
   `src/outcomes.ts`'s `INSTRUCTED_CHANGE` docstring and `data/reasons.json` both publish "leaves
   the classification to A7", and a **passing** `[A6]` assertion in
   `tests/scenarios/reweighed-in-transit-…test.ts` carries the sentence that handed §3.7 over.

**Audit what a plan says is owed before designing around it** now has four instances — `[A4]`'s
blind owed ledger, `[A2]`'s already-applied "seventeen-item backlog", `[A6]`'s owed item 6, and
these.

## The decisions worth remembering

- **The rubric's second clause is not expressible, and the blocker is an aggregate.** No act on a
  charge has a record, and unlike A2's gap (no act) and A6's gap (no act, answerable authority),
  **the subject is missing too** — so the question never reaches `[A8 §9 item 8]`'s ledger. The
  model's other instance of that shape is `placeRef`.
- **The invoice grain disagreement is the _reason_ not to mint, and it is better evidence than
  absence would have been.** Seven publishers, seven groupings, and two of them (`SummaryInvoice`,
  the SIRVA half-month statement) group **across shipments**, which no `[SD §1.2]` aggregate can be
  a subject of.
- **A payment does not collapse into `aspect = DECIDED`.** It names a counterparty the charge does
  not (`src:nmfta-ebol`'s `billTo` + `payment.terms` ∈ Prepaid | Collect | **Third Party**), an
  instrument the charge does not (`src:dtr-part-iv`'s DD 139 vs DD 1131 by pay status), and a
  reversal link to another payment. `[SD §4.7.2b]` fixes the three aspects' values as "an amount, an
  approval and a price"; a payment is none of them. **This is the round's one compile-time gate.**
- **Charge state refused on the A2 §3.3 pattern, with more publishers and a worse disagreement.**
  Eleven positions and no two the same — and they disagree about the **grain** as well as the
  values. Three have no lifecycle at all; `src:atlas-world-group-api` has **three untyped status
  fields** for the one question; `src:dp3-400ng`'s own analysis records its five values as
  _"referenced but never enumerated"_; `src:cfr-49-375` has a **credit** ladder instead.
- **`context[]` expresses the causal scope and is not the taxonomy, and the residue is the finding.**
  Running App. A's five names against the six declared members: four land cleanly and **three do
  not** — a fuel surcharge and a valuation charge are indistinguishable from line-haul, and an
  advanced charge cuts across. Saying so is the point; a reader who took the scoping for the
  taxonomy would conclude the model can separate things it cannot.
- **A-COLLECT, and it is D-CITE's argument one aggregate over.** Collectability is a rule over a
  **(charge, gating fact)** pair, not a property of the charge, not an `{aspect}` value, and not
  carried in `evidence[]`. The corpus publishes seven such rules — and **§375.519(d) gates the
  freight bill**, which §3.2 establishes the model cannot express, so the corpus's cleanest
  collection rule names a document on one side and a missing artefact on the other.
- **The publisher base is thinner than the row count, and A7 says so.** Seven rows, **three**
  sources, and two of the three are the same DP3 programme — so the genuinely independent count is
  **two**. Caught by counting the table rather than trusting the draft, which had written "four
  independent publishers"; both counts are now gated.

## Gates tampered and watched to fail

**Eight, restored after each**, and the ones worth repeating:

1. **A fourth `{aspect}` member** → `charges.ts: TS2322: Type 'true' is not assignable to type
'never'`. The round's only compile-time gate, and without the tamper there would be no evidence
   the `Exact<>` is not another tautology. It is not: the three names are re-declared in A7's own
   module, and `data.ts`'s `QUALIFIER_VALUES` only `satisfies` a type built from `QualifierByType`,
   which checks membership and **not exhaustiveness**.
2. **`'invoice'` added to `AGGREGATE_KINDS`**, then **`'chargeCollection'` to `RECORD_TYPES`** →
   `charge-collection-refuses.ts` reports `TS2578` each time. This also proves the refuses file is
   in the typecheck, verified separately with `tsc --listFiles`.
3. **A row deleted from `collection-preconditions.json`**, and separately **one `gatingFactAbout`
   changed** → three and two assertions fail **by name**. `[A1 §9]`'s enumerate-don't-count rule
   working in the direction it was written for.
4. **`chargeCollection` renamed in `[SD §4.7.3]`** → fires, **but only when both mentions are
   renamed**. **A6's half-tamper finding reproduced exactly**: the gate is a substring search over
   the section, not over the bullet. Worth knowing before relying on it, and worth re-testing
   because a finding about a gate is only true of the gate as it stands.

The other two: `[catalog §5]`'s count reverted to 15, and `stay` removed from `charge`'s `context[]`.

## The emitted schema diff is NOT empty, and that is the round's sharpest finding

A2 and A6 both shipped with an empty diff and the emptiness was the evidence. A7's reasoning had
started the same way — an owed marker's owner _feels_ internal — and **the diff said otherwise**:

```
-  "owedTo": { "const": "A11 — charge facts [SD §4.7.3]" }
+  "owedTo": { "const": "A7 / A12 — the corpus publishes gross/net/discount as field names …" }
```

one line in `captured.schema.json`, one in `queried.schema.json`, plus `absentFactClasses` 15 → 16
in `index.json`. **`owedTo` is rendered as a `const` on both faces**, so correcting an owed item's
owner is a published change, and every future owner-correction will cost a bump for the same reason.

Classified **`repointedOwedOwner`**, additive, `0.5.0` → `0.6.0` — a new class at `[catalog §2.3]`,
and the third use of the argument A4's `publishedOwedVocabulary` and A5's `publishedOwedShape` share.
It is the **weakest** of the three and the document says so: A4 and A5 each closed a gap; A7
corrected a gap's label and left the gap open. Two consequences are recorded and neither is closed —
**`[catalog §2.3]` has no rule for a breaking change while pre-1.0** (not needed, since this is
additive), and the `const` problem above.

"A compatibility classification argued from which fields feel published is a classification waiting
to be wrong — read the emitted `$defs`" is now operative for the **third** time, after A8's
`keySideRole` and after A2's and A6's empty diffs.

## `chargeValue` was owed to the wrong area

`A11` is _"released vs full value protection, claims lifecycle"_, and **the value of a charge is not
a claim**. The likely cause is one word wide: `src:cfr-49-375` App. A defines a **valuation
charge** — a charge _for_ the liability level — which genuinely is A11's neighbour.

Re-pointed to **`A7 / A12`** on `conditionValue`'s precedent (`'A4 / A10 — …'`, where A4 is written
and **A10 is context-map-only**), so the convention names the areas whose **subject** it is, not the
area that will publish it next. The reason half names the blocker the way `[A8 §5]`'s corpus-blocked
rows do: the corpus publishes gross / net / discount as **field names** and defines them nowhere —
`src:sirva-ade`'s own analysis calls its trio _"genuinely ambiguous"_.

> **An owed inventory is a set of claims like any other and is auditable like any other.** The
> counts have been gated since `[A1 §9]`; the **contents** had never been checked against the areas
> they name. This was the one entry A7 audited, and it was wrong.

## What shipped

| What                    | Where                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The area document       | `docs/domain-reference/analysis/A7-charges-billing.md`                                                                          |
| **A-COLLECT**           | `COLLECTABILITY_IS_A_RULE_OVER_PAIRS` + `COLLECTION_PRECONDITION_SUBJECTS` in `src/rules/charges.ts`                            |
| The seven rules         | `data/collection-preconditions.json` + `loadCollectionPreconditions` in `src/data.ts`                                           |
| The state refusal       | `CHARGE_STATE_IS_NOT_COMPUTABLE` — a plain `= true`, with the docstring saying why it is not a gate                             |
| **The aspect refusal**  | `ChargeAspectsAreTheThree` + its assignment — **a gate**, tampered                                                              |
| The type-level refusals | `tests/conformance/charge-collection-refuses.ts` — `invoice`, `payment`, `chargeCollection`                                     |
| The absent class        | `chargeCollection` in `ABSENT_AND_OWED` + `[SD §4.7.3]` prose + the `AS_WRITTEN` entry                                          |
| The owed-target fix     | `src/assertions.ts`, `src/ids.ts`, `src/vocabulary.ts`, `src/rules/corrections.ts`'s TODO, `[SD §4.7.3]`, one scenario          |
| Version                 | **`0.5.0` → `0.6.0`**, `repointedOwedOwner`, with the class at `[catalog §2.3]` and the row at `[catalog §2.4]`                 |
| Registration            | `A7` in `DOCUMENTS`; `A-COLLECT` in `RULES` — `tools/generate-glossary.ts`; `src/rules/charges.ts` exported from `src/index.ts` |
| Amended peers           | `[SD]` ×3, `[catalog]` ×4, `[A1]`, `[A2]` ×3, `[A4]` ×2, `[A5]`, `[A6]`, `rubric.md` ×3                                         |
| Tests                   | New `tests/conformance/charges.test.ts` (15)                                                                                    |

Gates green: `tsc` silent · vitest **384 passed** · lint clean · Alloy every command as expected ·
glossary and catalog regenerated and prettier fixed points · `npx prettier --check` clean over both
trees **except** `packages/domain-reference/alloy/run.mjs`, which fails on `main` already — verified
with `git show main:` and `git diff main --stat`, which shows the file untouched by this round.

## Three drafting defects, caught before the PR rather than after

A6's post-mortem says every defect it shipped had one shape: something that looked right and that
nothing could contradict. A7 budgeted the deliberate review pass A6 recommended, and it earned its
place three times:

1. **"Four independent publishers"** in §3.7 and in the A6 hand-off. Counting the table gives
   **three** sources — and two of those are the same DP3 programme, so the honest number is **two**.
   The neighbouring "five of the seven are DoD rules" was also wrong (four). **All three counts are
   now gated** rather than corrected, which is `[A1 §9]`'s rule.
2. **Three overclaimed superlatives.** "A7 weights C3 highest, which no area has done" — `[A1 §3.7]`
   already did. "`PRINCIPAL` is the **only** binding resolvable before any record exists" — `SCHEME`
   and `NONE` are too; the honest form is a split, not a superlative. "A fourth kind of blocker" —
   an ordinal that depends on which of three documents is counting.
3. **The `owedTo` string broke the house shape.** The first draft wrote the blocker where the
   convention puts the **owner**, which would have rendered in the glossary as _"owed to blocked on
   the corpus"_. Every other `Owed<>` in `src/` reads `Owner — reason`.

> **All three are the same failure as A6's, caught one step earlier**: a claim nothing in the suite
> could contradict. The counts were prose, the superlatives were prose, and the `owedTo` shape was a
> convention no test reads. What found them was reading the rendered diff and re-counting the table
> — which is exactly the step `plans/in-progress/domain-reference-areas-a7.md` §4 items 10 and 15
> were written to force.

## One observation handed on rather than resolved

**The cross-subject set-off.** `src:dp3-tender-of-service` NTS §5.8.2: when a line-haul carrier
fails to collect a lot, the DD 1164 is amended to name that failure as the cause and the PPSO
**sets off against that carrier on its own BL**. `OffsettingRecord.offsets` is an `EventId` and says
nothing about whether the two assertions share a subject — so this is a **silence**, not a refusal,
and A7 neither widens nor narrows it. Two things make it worth recording: `src:sirva-ade`'s zero-out
invariant is stated **per shipment**, which a cross-subject set-off would break, and
`cancellationZeroesOut`'s existing TODO already wants to move to the fact key — so the set-off is an
argument for that TODO's direction. `[A8 §5]` row 11 already names a **`SetoffAgent`**, so the party
is not the blocker.
