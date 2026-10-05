# Evaluation rubric

Fixed **before** any source is analyzed, so the first detailed source read does not
become the frame everything else is judged against.

Sources are scored **per domain area**, not overall. No single source is expected
to win everywhere — a message standard, a reference model, and a vendor API answer
different questions. Phase 3 picks a best source per area.

**Only external sources shape the model.** Our own systems are not evidence for what the
domain _is_; they are subjects of a later mapping exercise. Partner contracts (Weichert,
SIRVA ADE, Atlas) stay in as external evidence — they describe how counterparties behave —
but our configs and code that implement them do not.

## Domain areas

| Id  | Area                           | v1 detail   | Covers                                                                                                                |
| --- | ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| A1  | Order & service lifecycle      | yes         | offer/award, accept/decline, book, estimate submitted, cancel, complete; who may cause each transition                |
| A2  | Shipment structure             | yes         | shipment vs order, shipment types (HHG, storage, vehicle, PPM/self-move…), weights, services ordered                  |
| A3  | Trip, stop & assignment        | yes         | vehicle journey, stop sequence, consolidation of several shipments on one trip, legs, equipment + driver assignment   |
| A4  | Execution events & tracking    | yes         | arrive/depart, pack/load/unload/deliver, ETA, exceptions/delays with reasons; where telemetry stops and events begin  |
| A5  | Storage-in-transit             | yes         | SIT in/out, warehouse as a stop, duration, delivery-out leg, permanent storage boundary                               |
| A6  | Documents & evidence           | yes         | order for service, estimate, inventory, BOL, weight tickets, POD, photos; documents as evidence for events            |
| A7  | Charges & billing hooks        | yes         | line-haul vs accessorials, charge events, invoice issued/paid (detail of rating out of scope)                         |
| A8  | Parties & roles                | yes         | shipper/transferee, account/RMC, van line, booking/origin/hauling/destination agent, carrier, driver, crew, warehouse |
| A9  | Identity & cross-references    | yes         | each party's identifiers (order no., registration no., SCAC, BOL/PRO, service order no.), correlation between them    |
| A10 | Survey, estimating & inventory | context map | survey types, estimate types (binding/non-binding/not-to-exceed), inventory items & condition                         |
| A11 | Claims & valuation             | context map | released vs full value protection, claims lifecycle                                                                   |
| A12 | Rating & tariffs               | context map | tariffs (400N, 400NG), rate structures, accessorial catalogs                                                          |
| A13 | Crew, driver & settlement      | context map | crew scheduling, driver/agent compensation, revenue splits                                                            |

> **The `v1 detail` column is the plan, not the state.** Nine areas are _intended_ to be modelled in
> detail; what exists is what `analysis/` holds. **As things stand the two have converged**: eight of
> the nine — **A1**, **A2**, **A3**, **A5**, **A6**, **A7**, **A8** and **A9** — have full area
> documents, and the ninth, **A4**, is the exception described below.
> A1 is at [`analysis/A1-order-service-lifecycle.md`](analysis/A1-order-service-lifecycle.md),
> which records its weights at §3.7 and its owed items at §6, and A5 at
> [`analysis/A5-storage-in-transit.md`](analysis/A5-storage-in-transit.md), which records its weights
> at §3.7 and its owed items at §6 and is the first area to weight **C4** highest, and A2 at
> [`analysis/A2-shipment-structure.md`](analysis/A2-shipment-structure.md), which records its weights
> at §3.7 and its owed items at §6 and is the first area to weight **C2** highest — because A2's
> problem is disagreement rather than absence: more sources say something about shipment structure
> than about any other v1 area, and no two of the six that publish a shipment-type enum decompose it
> into the same facets ([A2 §2.12], [A2 §3.3]); **A4** has a
> decision document covering its reason vocabulary only
> ([`analysis/A4-execution-events.md`](analysis/A4-execution-events.md), whose own scope note says
> so), and its execution-event and tracking model is not yet scored; and **A6** has a full area
> document at [`analysis/A6-documents-evidence.md`](analysis/A6-documents-evidence.md), which records
> its weights at §3.9 and its owed items at §6 and is the first area to weight **C7** highest — the
> obvious call, since every one of its decisions is a provenance decision — with **C6** second, which
> is not obvious: [A6 §3.2]'s identity rule is decidable only because two sources score `C6 = 3` on
> A6. **A7** has a full area document at
> [`analysis/A7-charges-billing.md`](analysis/A7-charges-billing.md), which records its weights at
> §3.11 and its owed items at §6 and weights **C3** highest, as [A1 §3.7] does — because every one
> of its decisions turns on whether a published rule is testable, and because here the heaviest
> criterion and the best-evidenced one are the same one, which [A2 §3.7]'s weighting shows is not
> the usual case. **A9** has a full area document at
> [`analysis/A9-identity-cross-references.md`](analysis/A9-identity-cross-references.md), which
> records its weights at §4 and its owed items at §6 and weights **C6** highest — the obvious call,
> since C6 _is_ this area's criterion — with **C4** second, and that half is not obvious: `C2 = 3`
> is nearly universal on A9 and therefore discriminates nothing, while `C4` is the axis every
> decision in §3 turns on — [A5 §3.7] is the only other area to put **C4** that high, and
> [A9 §4] notes that the _"A8 weights C4/C6"_ example under **Scoring rules** below is an
> illustration written before the areas were, not a weighting [A8] ever recorded.
> **With A9 written the unwritten-area phase is over**, and the one part of a `v1 detail`
> area still unscored is A4's execution-event and tracking model.
> A10-A13 are context-map-only by design and are not gaps. Recorded here because a column reading
> "yes" for all nine invites exactly the assumption [SD §0] forbids.

> **One warning about the A6 row specifically, from [A6 §3.8].** The row reads as a list of eight
> document classes to model — _"order for service, estimate, inventory, BOL, weight tickets, POD,
> photos; documents as evidence for events"_ — and it is not. **Two of the eight are A6's** (the bill
> of lading, and `evidence[]` itself); four are other areas' or are already carried as `context[]` on
> a row of [SD §4.7.1]; and one, "order for service", **appears zero times** in `src:cfr-49-375`'s
> captured text and is the excluded permanent-storage programme's ordering document in DP3. A reader
> who took the row literally would mint six things the model does not need. The `Covers` column is a
> prompt, not an inventory — which is the same caution as the `v1 detail` column's above.

> **And one about the A7 row, from [A7 §3.10], which is the second instance of the same caution.**
> The row reads as three deliverables — _"line-haul vs accessorials, charge events, invoice
> issued/paid"_ — and it is one deliverable, one refusal and one absence. Charge **events** split:
> propose, decide and rate are records that already exist, and bill, collect and pay are absent
> ([A7 §3.2]). Line-haul versus accessorials is **refused as a vocabulary** — `src:cfr-49-375`
> Appendix A's five names cut on at least three different facets, so a shipment can carry one charge
> that is three of the five at once ([A7 §3.4]). Invoice issued/paid is **not expressible**, and the
> blocker is an aggregate rather than a field. **The parenthesis does more work in this row than any
> other in the table**: _"detail of rating out of scope"_ removes the part of the area the corpus
> covers best — every source scoring `C1 = 3` on A7 scores it on rating — which is why A7's honest
> output is shorter than its evidence.

> **And one about the A9 row, from [A9 §3.8], where the residue runs BOTH ways.** The row reads as
> five identifiers — _"order no., registration no., SCAC,
> BOL/PRO, service order no."_ Outward, the corpus witnesses twelve more schemes the column does not
> name, including every constructed scheme and every one at the `item`, `resource`, `stay` and
> `trip` grain — among them the SIT control number that [SD §7.4] already depends on. **Inward is
> the half a reader will not notice**: three of the five names cover more than one scheme, because
> [SD §7.1] makes a naming system `(scheme, authority)` and the column has only names. _"BOL/PRO"_ is
> three schemes; _"registration no."_ is two with different authorities, one of which — the van
> line's — has **exactly one external witness in the whole corpus**, a partner contract with no
> capture, while the other is primary and captured. Both halves are enumerated in
> `identity-schemes.test.ts` rather than counted here.

> **And one that is not in this file at all.** [A9 §1] found `sources/registry.yaml`'s `areas:`
> field being read as an inventory of which areas a source bears on, when it is a discovery hint
> written before any source was analysed — and the gap exists for every one of the thirteen areas.
> The registry's own schema comment now says so. **Three fields in this corpus are routing hints of
> that kind** — the `v1 detail` column above, the `Covers` column, and `areas:` — and the pattern is
> the thing to carry rather than a count of the readings: **a field written to decide where to look
> gets read as a record of what was found.**

> **And one about the resumption plan rather than the rubric, recorded here because a later reader
> will meet it here first.** A6's own resumption plan named
> `src:dtr-part-iv` as A6's best source and did not name `src:dp3-tender-of-service`, which scores
> the same or better on every A6 criterion and is **grade A** where `dtr-part-iv` is grade B
> ([A6 §1]). Score rows are per area and evidence grade is per source; comparing the first without
> reading the second is how the strongest source in an area gets left off a list. (The plan itself is
> **gone** — this effort rewrites a finished round's plan as the next round's, so the record is
> `plans/completed/domain-reference-a6-documents.md` and the live plan is
> [`../../plans/in-progress/domain-reference-roleclass.md`](../../plans/in-progress/domain-reference-roleclass.md).)

> **One observation about per-area scoring itself, from [A2 §3.7].** `src:dtr-part-iv` scores
> `C3 = 1` **on A2** and decided the whole of [A2 §3.2] — because its A2 row scores the shipment
> _structure_ it does not have, while the diversion / termination / reshipment trichotomy that
> answers A2's hardest question is scored under **A1**, where the same source scores `C3 = 3`. **An
> operation on a shipment's identity is scored in one area and lives in another.** That is a
> property of scoring per area rather than a defect in either row, but a reader who compares area
> scores to decide where the evidence is will be misled by it.

## Per-area criteria (score 0–3 each)

| Id  | Criterion                              | 0                          | 3                                                                                                   |
| --- | -------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| C1  | **Coverage**                           | area absent                | all core concepts of the area present                                                               |
| C2  | **Semantic precision**                 | names only, no definitions | defined terms with the distinctions that matter (e.g. _loaded_ vs _departed_, _shipment_ vs _trip_) |
| C3  | **Lifecycle rigor**                    | status strings             | explicit states, allowed transitions, invariants, who may cause them                                |
| C4  | **HHG fidelity**                       | generic freight only       | moving-specific concepts native (agent roles, SIT, survey, reweigh, valuation)                      |
| C5  | **Time model**                         | single timestamp           | planned vs estimated vs actual, windows, date-only vs instant, time zone of the stop                |
| C6  | **Identity & references**              | one opaque id              | multiple party references, typed, with correlation                                                  |
| C7  | **Evidence, provenance & corrections** | none                       | source/actor of each fact, evidence type, correction or reversal semantics                          |
| C8  | **Extensibility & versioning**         | closed                     | explicit extension points, versioned vocabulary                                                     |

A criterion that does not apply to an area is `n/a`, not 0.

## Per-source attributes (recorded once)

| Id  | Attribute                           | Values                                                                                                                        |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Kind**                            | `reference-model` · `message-standard` · `vendor-api` · `regulation` · `tariff` · `ontology` · `internal-system` · `glossary` |
| S2  | **Adoption / maturity**             | 0 (niche/draft) – 3 (industry-wide, stable)                                                                                   |
| S3  | **Openness**                        | `public` · `free-registration` · `gated-partner` · `paid` · `licensed` · `internal`                                           |
| S4  | **Evidence grade** of _our_ reading | **A** full spec/source read · **B** partial docs, samples, implementation guides · **C** marketing, secondhand, or inferred   |

> **S5 (fit to Pegasus data) was removed on 2026-09-17.** The model is an **ideal target**, derived
> from external sources only — see [README § Scope](README.md#scope). Asking "can pegII or Cloud
> supply this?" while shaping the model biases it toward what we already have. That question is
> real, but it belongs to [`mappings/`](mappings/), after the model exists. Round-1 analyses still
> carry S5 lines; ignore them when comparing, and harvest them in the mapping phase.

## Scoring rules

- **Cite every score.** Each non-zero score points at a section, path, or URL.
  An uncited score is treated as 0.
- **Evidence grade caps confidence.** A grade-C reading may flag a concept as
  present but cannot score above 1 on C2/C3.
- **Analyze all sources in an area before scoring it**, so order of reading does
  not set the scale.
- **Weighting is decided in phase 3, per area** — e.g. A4 weights C5/C7 heavily,
  A8 weights C4/C6. Record the weights in the area's analysis file.
- **Don't reward size.** A huge spec that covers everything shallowly scores on C1,
  not on C2/C3.
