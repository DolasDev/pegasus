# Domain reference — A1, the order & service lifecycle: COMPLETE

**Landed 2026-09-23.** Deliverable 2 of `plans/completed/domain-reference-a8-authority-rows.md`'s
successor plan — the first of the six unwritten area comparisons. A2 and A5 carry forward in
`plans/in-progress/domain-reference-areas-a2-a5.md`.

## The headline

**A1 is the best-supported detail area in the corpus after A8, and it needed almost no design.** Six
sources score `C1 = 3` and three score `C3 = 3`; the shared layer had already minted the three record
types and fixed four of the rules. So A1's work was to **settle five named owed items** and to run
the corpus against them — not to author a shape, which is what A3 had to do.

The deliverable is `docs/domain-reference/analysis/A1-order-service-lifecycle.md` (≈1200 lines), plus
one projection, one reason code, and a version bump to `0.4.0`.

## The five owed items, and how each closed

| #   | Owed by              | Settled                                                                                                                                                 |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [SD §4.7.2e]         | X12 element 558 mapped: `A` → `COMPLETED`, **`B` → `COMPLETED_WITH_EXCEPTION`**, **`C` → `NOT_COMPLETED`**, `D` → `orderCancellation`, a different type |
| 2   | [`fork-order` §5.3]  | The stage is a **projection** — `orderStageAt`, rule `ORDER-STAGE-AT` v1, five stages and an `UNKNOWN` with six named reasons                           |
| 3   | rubric, the A1 row   | **book** is the award+response seen from one side (A8-SELF); **estimate** is an absent fact class and stays absent; **complete** is owed, with a reason |
| 4   | rubric, criterion C3 | A permission table, `A1-PERM-1/2/3`, from `src:dtr-part-iv` and `src:cfr-49-375`, with permission kept strictly apart from [A8]'s authority             |
| 5   | [A4 §3] rule 4       | One mint — `DEADLINE_LAPSED` — and an argument for why the other three candidates belong to A7, A8 and [SD §4.7.3] rather than to the reason vocabulary |

## The decisions worth remembering

- **The discriminator for `B` vs `C` is "does a commitment stand?", and the fold is its test.** `A`
  and `B` map to different outcome members and to the **same stage**. If they ever diverged, the
  outcome axis would not be encoding what §3.2 says it encodes. That equality is asserted in a test.
- **Three refusals to mint are better analysis than three mints would have been.** `COST_NOT_AGREED`
  is a `charge` at `aspect = PROPOSED` ([A8 §5 row 11]) — a reason code for it would carry the same
  disagreement on two axes, which is the duplication [A4 §4.1] collapsed `MQP`/`MQT` to remove.
  `NOT_WITHIN_SCOPE` is a standing property of a **party**, and the party entity does not exist
  ([A8 §9 items 1, 5]). `TRANSIT_TIME_TOO_SHORT` is a property of the **award** — DP3's "short fuse"
  — so it is a precondition on a permission, not an explanation after the fact.
- **Permission ≠ authority, and holding the line is what produced the A8 finding below.**
- **The fold has two rules that could have been guessed.** Rule 3 (a refused cancellation does not
  govern — so a refused cancellation leaves the order `ACCEPTED`) is [SD §4.7.2e] item 3 executed.
  Rule 5 (`RESPONSE_WITHOUT_AWARD`) is **[ORIGINAL]** — the commitment-side twin of [SD §4.8.3]'s C5,
  refusing to let a commitment exist on one party's word alone. Both were tamper-proved.

## The A8 finding — a correction to the ledger's reasoning, not a row

[A8 §9 item 8(b)] says of the three order types: _"no source in the corpus attaches an authority to
it."_ A1 read the corpus for exactly that and found the sentence is **too strong in one direction and
not specific enough in the other**. A1 wrote no row.

- **(a) The corpus does attach a party to every order transition.** `src:dtr-part-iv` A-402 §C-§F
  names one on every edge; `src:atlas-world-group-api` captures `bookedBy` / `accepted_by` /
  `cancelledBy` / `cancelRequestor`; `src:milmove-mymove` **enforces** which actor may make which
  transition; `src:project44` says "caused by either party". That is **permission**, not assertional
  authority — but it is the same kind of material [A8 §10] says rows 1-5, 8 and 11 were built from
  ("converting a recording duty into assertional authority is authored in every one of them").
- **(b) The `context[]` argument does not reach a fixed-role row.** DTR's actors are fixed **by the
  transition kind**, not read off the record. [A8 §5 row 11] already names a literal role
  (`accountParty` for `DECIDED`) with no key read behind it.
- **(c) So the blocker is a `boundBy` gap, and it differs per row.** A8 publishes six members and
  none means "a fixed role resolved outside this fact". `orderResponse` and `orderCancellation`
  resolve their role through **the order's own award** — structurally `ASSIGNMENT` one aggregate
  over, and A8 has no member for it. **`orderAward` alone is blocked by A8's own mint principle**
  ("`orderAward` mints the principal relation, so it cannot be `PRINCIPAL`"), and `KEY` cannot rescue
  it because its actor is in `context[]` — for that one row A8's stated reason is exactly right.

**So the ledger entry wants three lines, not one, and the question it asks A8 is a _schema_ question
— does the table need a seventh `boundBy` member? — not a research one.**

**And A8 was amended in the same PR, because it outranks A1.** Leaving the finding only in A1 would
have left a reader following [SD §0] rule 6's precedence with the sentence A1 refutes: `[A8 §9 item
8(b)]` now carries the three-line split as `(b-i)`, `[A8 §11]` gains revision 8, the corpus-blocked
count drops from twelve to nine, and the generated Owed blurb in the glossary — which said the same
thing — was rewritten at its source in `generate-glossary.ts`. Rule 5: a disagreement between two
binding documents is a defect, not a difference of emphasis.

Two worked cases were handed over with it: `src:dtr-part-iv` §C.4.a's refusal-permitted-only-for-
short-fuse is the cleanest published `A8-UNAUTH` case in the corpus, and `src:dcsa`'s JIT
`classifierCode` ("`EST`, `PLN` and `ACT` can only be used by the Service Provider; `REQ` only by the
Service Consumer") is the nearest published thing to the plan-change binding [SD §4.7.1] says nobody
publishes — it was not cited when that sentence was written.

## The defect A1 found in its own §3.5, and what it is really about

A1-PERM-2 places the cancellation's **requestor** on `reasons[].attribution` (Atlas's
`cancelRequestor`). [SD §2.3] invariant 2 **forbids** `reasons[]` at `outcome = COMPLETED` — so on a
cancellation that **succeeded**, the field does not exist. `src:dtr-part-iv` §C.6.a-b makes the
requestor the thing that decides **who is charged**, so it is not cosmetic.

`tests/scenarios/cancelled-after-packing-before-loading.test.ts` had already asserted it as a
FINDING before A1 read it. A1's contribution is to say which two sections produce it
([SD §4.7.2e] item 2 meets [SD §2.3] invariant 2 on a record neither considered) and what the two
fixes cost. **Both change the shared layer, so A1 wrote neither.** Recorded owed at [A1 §6] and
handed to [SD] at [A1 §Cross-area].

**The lesson: the existing test suite knew something the prose did not.** The first draft of
A1-PERM-2 said the model "already has the fields" and was confidently wrong; reading the scenario
test that touches the same record is what caught it.

## The documentation defect, and which copy rotted

`catalog/index.json`'s generated owed note read _"the authority rows, 19 of 31 of which are owed"_
beside a generated `counts.authorityRows` of **14**. [catalog §2.4] carried the same stale pair plus
a stale `0.2.0`; `docs/domain-reference/README.md` carried a **third** stale version; [A4 §7] carried
a fourth stale count.

**The interesting part is which copies rotted.** [catalog §5] carries the same five counts and they
were **correct**, because `tests/conformance/catalog.test.ts` reads them out of that section and
compares them with `collectOwedInventory()`. Three ungated copies drifted across two releases; the
one gated copy did not.

So the rule is **not** "write the number once" — §5's copy earns its place. It is **gate it or delete
it**. The generator's note now points at the counts beside it, [catalog §2.4] carries a bump table
and no counts, both READMEs stop restating the version, [A4 §7] says it records the version _at A4_,
and [catalog §5] says outright that its five are the only counts the document may carry.

## What shipped

| What              | Where                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| The area document | `docs/domain-reference/analysis/A1-order-service-lifecycle.md`                    |
| The fold          | `orderStageAt` in `packages/domain-reference/src/rules/order-stage.ts`            |
| Its tests         | `tests/conformance/order-stage.test.ts` (26), plus two in scenario 6              |
| The reason code   | `DEADLINE_LAPSED` in `src/outcomes.ts` + `data/reasons.json`, and [A4 §3]'s table |
| The version       | `CATALOG_VERSION = '0.4.0'`, `newClosedEnumMember`, read from the schema diff     |
| Registration      | `A1` in `DOCUMENTS` and `orderStageAt` in `RULES`, both in `generate-glossary.ts` |
| The rubric note   | `docs/domain-reference/rubric.md` — A1 is no longer in the unwritten list         |

Gates green: `tsc` silent · **336 tests in 19 files** · lint clean · Alloy every command as expected ·
glossary and catalog regenerated and prettier fixed points · `npx prettier --check` clean over both
trees.

## Gates tampered and watched to fail

Four, restored after each: drop `DEADLINE_LAPSED` from `data/reasons.json` (the set check — ten tests
fail, naming "the 24 members"); make a refused cancellation govern (three tests flip, one of them not
about rule 3); delete rule 5's branch (two tests flip `UNKNOWN` → `ACCEPTED`). The glossary, catalog
and `documents.test.ts` gates all failed **for real** before the artifacts were regenerated — the
documents gate in particular caught that A4's own evidence table did not name the new code, which is
why it now does.

## One gate needed fixing rather than satisfying

`data-tables.test.ts` asserted `/exactly the 23 members of REASON_CODES/` as a **literal**, where
`src/data.ts` derives the number from `REASON_CODES.length`. A hard-coded count in a tamper test is
the same failure mode as the catalog note above, one layer down. Now derived.
