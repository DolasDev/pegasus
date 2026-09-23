# Domain reference — A2, shipment structure: COMPLETE

**Landed 2026-09-23.** The deliverable of `plans/in-progress/domain-reference-areas-a2.md` — the
third of the unwritten area comparisons, after A1 and A5. A6, A7 and A9 carry forward in
`plans/in-progress/domain-reference-areas-a6.md`.

## The headline

**A2 closes the oldest open item in the model and finds a hole older than the item.** `[SD §10.4]`
bullet 1 — shipment identity across a terminated SIT stay — had been open since the shared layer was
written, deferred by three documents in turn. A5 closed the stay half. A2 closes the shipment half,
and the answer needed no new commitment: `[fork-order §3.1]` already defines a shipment as _"the set
of goods committed to move under one transport **undertaking**"_, and that sentence decides it. What
had kept it looking open for three revisions is that the corpus's one decisive source states the
discriminant's **evidence** (a new bill of lading) rather than the discriminant.

Then, looking for where to put the answer in code, A2 found that **the `shipment` aggregate has no
record of its own coming into existence.** `[SD §4.7.1]` carries nineteen act types and every one
presupposes a shipment that already exists. That is the largest single consequence of any absent
class in the model and it had been invisible because no area owned the shipment.

The deliverable is `docs/domain-reference/analysis/A2-shipment-structure.md` (≈700 lines), one named
rule, one absent fact class, and **no version bump** — the first release that changes no published
byte.

## The five owed items, and how each closed

| #   | Owed by                                                            | Settled                                                                                                                                                                       |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [SD §10.4] b1; [`fork-order` §4] #7, §6.7, §7; [A5], [A3]          | Rule **B-ONWARD**. Diversion, split and delivery-out keep the shipment; **reshipment after termination is a second shipment**; permanent storage leaves the model             |
| 2   | [`fork-order` §3.1]'s unpublished _"type from a closed enum (P1)"_ | **Withdrawn, not filled.** Six sources publish a shipment-type enum and no two decompose into the same facets. `shipmentType` is absent and owed                              |
| 3   | [A1 §Cross-area], [A1 §3.4], [`fork-order` §5.3]                   | **The zero-shipment order needs no reading beyond §5.3's** — `orderStageAt` never counts shipments. A1's `COMPLETE` fork is blocked by `shipmentCommitment` and A4, not by A2 |
| 4   | [SD §11]'s mandatory Portion revisit check                         | **Run, and it passes.** No published HHG model keeps the two membership forms as different entities; 400NG Item 17.13 requires **both of one subset**                         |
| 5   | rubric, the A2 row                                                 | Shipment-vs-order already decided; types → item 2; weights already exist with two named gaps; services ordered is the **order's** by binding text; one new absent class       |

## The decisions worth remembering

- **The discriminant is the undertaking; the document is its record.** `src:dtr-part-iv` #81 defines
  a bill of lading as _"a contract between the shipper and the TSP whereby the TSP agrees to furnish
  transportation services"_, so §E.4(4)(c)'s new bill of lading for a reshipment **is** a new
  undertaking — by `fork-order`'s own definition, with no rule about documents needed.
  **[SYNTHESIS]**, two sentences of one grade-A source.
- **B-DOC is sharpened, not reversed — and A2 found a second reason it is [ORIGINAL].** The system
  B-DOC was read off **separates the commitment from the document**: DPS offers and the TSP accepts
  in 24 hours (§C.4), the survey follows, and _"the BL cannot be printed until pre-move survey weight
  and agreed pack/pickup dates are in DPS"_ (§F.1 NOTE). A rule that reads identity off the document
  is not DoD's rule either; it happens to give DoD's answers because DoD issues one document per
  undertaking. `fork-order` §3.2.2 carried only the first reason.
- **"Split Shipment" is a name-trap, and the corpus refutes it three ways.** Both definitions are
  grammatically singular (`src:dtr-part-iv` #662, `src:dp3-400ng` Item 17.9); what the increments are
  documented separately **by** is a weight ticket and a SIT control number, **not** a new bill of
  lading; and Item 17.9.b.2 applies the 1,000-lb minimum to the **combined** weight. One shipment,
  N Portions, N stays — which makes the corpus's hardest split case **positive evidence** for
  `[SD §3]`'s P-IDENTITY rather than a strain on it.
- **Every published shipment-type enum is a rating key wearing an ontology's clothes.** Six of them,
  six facet sets, and three of the facets are other aggregates' facts: `PPM` and `shipperType` are
  `partyRole` (who performs, who pays), `NTS`/`NTSR`/`LTS` are the programme boundary A5 already ruled
  **out of the model**, `JobType` is services ordered, and DTR's Code of Service openly _"fixes mode,
  containerization and **rate family**"_. A union would be a cross-product and still wrong for the
  seventh publisher — and `[catalog §2.3]` makes a published member's spelling a **breaking change**.
- **The rubric-vs-binding-text conflict on services ordered is surfaced, not resolved by preference.**
  The rubric puts it in A2; `[fork-order §3.1]` puts the named set of services on the **order** and
  `[SD §Precedence]` outranks the rubric. A2 does not create an owed class for something a binding
  document has already placed, and hands the open half to A7.

## The structural finding, which is A2's largest output

`shipmentCommitment` — the act that mints a shipment — is named by three sources (`src:sirva-ade`'s
`Register`, `src:milmove-mymove`'s two-actor submission, `src:cfr-49-375`'s pre-BOL pricing sequence)
and carried by no `[SD §4.7.1]` row. Three things are decidable in prose and not in code because of
it: **B-ONWARD**, `[fork-order §5.2]`'s **B-STAGE** (a projection with no input records since it was
written), and the shipment set an `[A1 §3.4]` `COMPLETE` rule would quantify over.

**Its blocker is not A5's.** A5's three storage classes are blocked on `[A8 §9 item 1]` — no party
entity. A2's is blocked on `[A8 §4.3]`'s `boundBy` enum having no member meaning _"resolved by the
order's own award"_, which is **exactly the gap A1 found** under `orderResponse` and
`orderCancellation`. **A8 is not asked for a row; it is asked for one enum member, and the count of
things waiting on that member is now four.**

## No version bump, and that is the decision

`CATALOG_VERSION` stays at `0.5.0`. `git diff` over `captured.schema.json` and `queried.schema.json`
is **empty**; the only published change is `absentFactClasses` 13 → 14 in `index.json`.
`[catalog §5]` already recorded of A8's round that a moving owed inventory _"alone would not have
moved `specVersion`"_, because §2.3 classifies changes to what is **published** and an owed count is a
change to what is admitted to be **missing**. A version bumped for a release that changes no published
byte would tell a consumer to re-validate for nothing. §2.4's table carries the non-bump as a row.

## `[SD §10.2]`'s seventeen-item backlog was already discharged

The resumption plan's §6 item 4 called `fork-order-shipment-cardinality.md` _"the largest single
backlog attached to any unwritten area."_ **It is not a backlog.** All seventeen items are applied
across the document's revisions 2–5, each citing the §10.2 item it answers; `[A2 §1]` carries the
item-to-revision mapping as a table. What A2 inherited was four **open questions**, not repair work.

Two housekeeping defects came with it and are fixed as **revision 6**: the frontmatter read
`revision: 2` / `revised: 2026-09-18` over a body carrying revisions 3, 4 and 5, and the revision note
claimed §10.2 required _"nine"_ changes. The count is **deleted** rather than corrected — no gate
reads it, which is `[A1 §9]`'s rule.

## What shipped

| What                        | Where                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The area document           | `docs/domain-reference/analysis/A2-shipment-structure.md`                                                                    |
| **B-ONWARD**                | `shipmentContinuity` + `ONWARD_MOVEMENTS` in `packages/domain-reference/src/rules/shipment-continuity.ts`                    |
| The undetermined cases      | `SHIPMENT_CONTINUITY_UNDETERMINED_REASONS` — `COMMITMENT_NOT_PUBLISHED`, `LEAVES_THE_MODEL`                                  |
| The B-STAGE gap, assertable | `SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE`                                                                                  |
| The absent class            | `shipmentCommitment` in `ABSENT_AND_OWED` + the prose in `[SD §4.7.3]` + the `AS_WRITTEN` entry                              |
| Version                     | **Unchanged at `0.5.0`**, with the non-bump recorded at `[catalog §2.4]` and the count at `[catalog §5]`                     |
| Registration                | `A2` in `DOCUMENTS`; two vocabularies in `VOCABULARIES`; `B-ONWARD` in `RULES` — `tools/generate-glossary.ts`                |
| Amended peers               | `[SD §10.4]` b1 **closed** and `[SD §4.7.3]` +1; `fork-order` revision 6 (six edits); `A3` ×3; `A1 §6`; `A5` ×3; `rubric` ×4 |
| Tests rewritten             | scenario 2's A2 to-do became A2's decision plus its limit; scenario 9 gained the `[SD §11]` check; scenario 6 gained B-STAGE |

Gates green: `tsc` silent · vitest 344 passed · lint clean · Alloy every command as expected ·
glossary and catalog regenerated and prettier fixed points · `npx prettier --check` clean over both
trees **except** `packages/domain-reference/alloy/run.mjs`, which fails on `main` already (verified
against `git show main:`, not assumed).

## Gates tampered and watched to fail

Six, restored after each.

1. A sixth `ONWARD_MOVEMENTS` member with no verdict row → `TS2741: Property … is missing`.
2. A verdict row for a member `ONWARD_MOVEMENTS` no longer carries → `TS2353: Object literal may only
specify known properties`.
3. `shipmentCommitment` renamed in `[SD §4.7.3]` → `documents.test.ts` names the member and the phrase.
4. `[catalog §5]`'s absent count reverted to 13 → `catalog.test.ts` names the expected string.
5. `RESHIPMENT_AFTER_TERMINATION` flipped to `SAME_SHIPMENT` → scenario 2 fails.
6. The glossary's `shipmentCommitment` line edited → the staleness gate fails.

## An assigned `Exact<>` can still be a tautology — the next case along from `[A5 §9]`

A5 established that a bare `Exact<>` alias is a comment until something is assigned to it. A2's first
draft followed that rule faithfully — assigned `true` on the next line — and **the tamper showed the
assignment does not repair this one, because the assertion cannot fail.** `VERDICT_BY_CAUSE` is a
**mapped type over `OnwardMovement`**, so `keyof typeof VERDICT_BY_CAUSE` **is** `OnwardMovement` by
construction; no edit to either side can make them differ.

The real gate was the mapped type, and tampers 1 and 2 prove it bites in both directions. The `Exact`
was **deleted** rather than kept, with the reason written where it stood.

> **The generalisation:** an `Exact` earns its place only between two things declared
> **independently**. Between a mapped type and its own key set there is nothing to drift, and a
> decorative assertion beside a gate that already bites is worse than nothing — it tells the next
> reader the coverage is checked twice.

## One observation handed on rather than resolved

`[A5 §3.4(b)]`'s table lists _"leaves the customer entitled to delivery out of storage"_ under
**termination**, citing `src:dtr-part-iv` §D.5.c(1) NOTE. The sentence the source analysis quotes is
conditioned differently — _"**when converted to customer expense**, the customer is still entitled…"_
— and conversion to customer expense is precisely what A5 §3.4(a) keeps **apart** from termination.
Both readings live in the same secondary text and **the primary is not in the corpus** (no capture for
`dtr-part-iv`, and the extractors are gone). Recorded at `[A2 §3.2(f)]` and as a note in A5's own
table; **nothing in either document rests on it**. What neither can supply is the terminal act of a
shipment whose warehouse has become its final destination — there is no record type for it.

## One observation about the rubric itself

`src:dtr-part-iv` scores `C3 = 1` **on A2** and decided the whole of `[A2 §3.2]`, because the
diversion / termination / reshipment trichotomy is scored under **A1**, where the same source scores
`C3 = 3`. **An operation on a shipment's identity is scored in one area and lives in another.** A
property of per-area scoring rather than a defect in either row, but a reader comparing area scores
to decide where the evidence is will be misled by it. Recorded in `rubric.md`.
