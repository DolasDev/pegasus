# A3 — Dispatch confirmation & finalization of a day of service (scoped enrichment)

Cited elsewhere as **[A3-DCF §x]**.

> **Status.** A **scoped enrichment**, not an A3 decision document and not a new record type. It
> carves out exactly the question a downstream consumer asked — *does the domain have a
> confirm→finalize sign-off lifecycle for a day of service, and who may advance or reverse it?* — and
> answers it from already-registered sources. It does **not** add a record type to [SD §4.7.1], does
> **not** add an [A8 §5] authority row, and does **not** touch the executable specification. Where it
> would conflict with [`00-shared-decisions.md`](00-shared-decisions.md) (**[SD]**),
> [`A3-trip-stop-assignment.md`](A3-trip-stop-assignment.md) or
> [`A8-authority-skeleton.md`](A8-authority-skeleton.md), those win. In particular it does **not**
> discharge the owed trip-scoped authority row ([A8 §9 item 8]); it explains why the concept the
> consumer found rests *on* that same gap.

> **Scope.** Three adjacent areas meet here and the note reads only as far as the consumer's question
> and stops. The **operational sign-off** of a dispatched day — a trip-scoped state and who asserts it
> — is **A3** (trip, stop & assignment). The **commitment of a service date to the shipper** that the
> "confirm" act reflects is **A1/A6** (order for service, bill of lading). The **settlement lock** that
> the "finalize" act reflects is **A7/A13** (charges; crew/driver settlement — context-map-only). This
> note classifies the two acts and stops at each area's edge; it does not build the trip state machine,
> the booking amendment flow, or the settlement arithmetic.

---

## 0. Rules this document is written under

[SD §0]'s three, unchanged:

1. **External sources only.** Our own systems are `role: mapping-only` in `sources/registry.yaml`
   and are never cited for what the domain _is_. In particular, pegII's `LocalDispatchJobMaster`
   `IsConfirmed`/`IsFinal` flags and the longhaul `MasterTripStatus` (…→`Finalized`) are **not
   evidence**; they are the subject of the mapping workstream, and §4 is written for that consumer
   without treating its code as a source.
2. **Every claim cites a source that says that thing, or is marked [ORIGINAL].**
3. **No guessing to make a type tidy.** Where the corpus settles the _shape_ of an act but not the
   predicate or the asserting role, §3 says so rather than inventing it.

All sources cited here are already registered and analyzed; this enrichment adds none.

## 1. What the corpus settles

**1.1 A local day of service is already expressible — as a Trip with one Stop, carrying no sign-off
state.** [SD §8.4] decided that "a day of service performed at one place with no linehaul is a Trip
with one Stop", on the strength of `src:open-trip-model`: a Stop "models visiting a certain location
at a certain time and potentially doing several other actions at that location"
(`otm5.8-docs-llm.md:302`) and a Trip "is **optionally** coupled to a Vehicle"
(`:244`). What that trip carries is **execution acts** — `arrival`, `departure`, `loading`,
`unloading` (the `_LocalDispatch` authority row, symptom-index). It carries **no confirmation and no
finalization field**: [SD] forbids a mutable current-state field on the envelope (§1.1), and A3's own
lifecycle "Offered → accepted → loaded → in-transit → unloaded" is published as *act rows*, with
`in-transit` explicitly "**not a record at all** … a projection" ([SD §4.7.2d]). So the model holds
the *performance* of a local day; it holds no operational sign-off *on* it.

**1.2 The "confirm" act corresponds to a sourced concept: the agreed service date is a documented,
mutually-agreed commitment.** `src:cfr-49-375`'s time model is "*agreed date or period*, not
planned/estimated/actual": the bill of lading carries "the agreed date or period of time for
pickup… and the agreed date or period of time for the delivery" (§375.505(b)(6)) **separately from**
"The actual date of pickup" (§375.505(b)(8)), and the BOL is "both the receipt and the contract"
(§375.103). The agreed date is changeable only **by mutual agreement and only before loading**
(§375.401(i)). So "confirming a day to the customer" is a real domain act — the carrier and shipper
**commit** to an agreed date, recorded on the order/BOL — and it is a *commitment* fact (A1/A6), not an
operational trip state.

**1.3 The "finalize" act corresponds to a sourced concept: a post-performance close that locks the
record for settlement.** `src:milmove-mymove` carries a payment request whose `isFinal` flag
"**closes the task order**" (`pkg/models/payment_request.go:65-90`), and it times the review of
performed quantities after the fact — `billable_weights_reviewed_at` beside `approved_at`
(`move.go:59-89`). So "finalizing" a performed day — a terminal close that gates billing/settlement
and presupposes the work happened — is a real domain act (A7/A13-adjacent).

**1.4 Dispatch systems in the corpus model operational progress as a forward sequence, and approval as
a narrowly-scoped supervisor act — not as a general day-of-service sign-off with reversal.**
`src:sirva-ade`'s `ShipmentStatus` is "Operational status of shipment" in `REGISTERED`, `CANCELLED`,
`PLANNED`, `ASSIGNED`, `LOADED`, `DELIVERED` (GSD p.8) — a **forward** operational sequence, with no
reversal mechanism and no reason codes recorded. `src:atlas-world-group-api` does carry an explicit
approval pair — `supervisor_approval_by`/`supervisor_approval_on` beside `auto_authorized`
(`atlasorder-v1.json:13215`) — but **scoped to SIT authorization**, not to signing off a day of
service. So the corpus shows (a) operational milestones that move forward, and (b) a supervisor
approval that exists for a *specific* gated act, and neither is a confirm↔finalize sign-off on a
dispatched day.

## 2. The synthesis

**There is no single "confirmed / final" day-of-service sign-off lifecycle in the corpus** — the pair
is not a published state machine anywhere. What the corpus settles is **two distinct acts**, each with
a stable reading, plus the fact that the model has **no trip-scoped state field and no role bound to
asserting one**:

> A **dispatch confirmation** is the carrier/shipper **commitment to an agreed service date**
> [1.2] — an order/BOL commitment fact (A1/A6), amendable only before the work starts. A **dispatch
> finalization** is a **terminal post-performance close** that locks the day's record for settlement
> [1.3] — presupposing the work was performed (A7/A13). The domain models the *performance* of the day
> as execution acts on a one-stop Trip [1.1] and models operational progress elsewhere as a forward
> sequence [1.4]; it does **not** bind the two acts into one lifecycle on the Trip, and it supplies
> **no asserting role** for advancing or reversing such a state.

This is **[SYNTHESIS]** across `src:cfr-49-375` (the agreed-date commitment), `src:milmove-mymove`
(the finalizing close) and `src:sirva-ade`/`src:atlas-world-group-api` (operational progress as a
forward sequence; approval as a narrowly-scoped supervisor act). No single source states it.

## 3. What the corpus does NOT settle — and must not be guessed

The corpus gives the **shape** of the two acts (a date commitment; a settlement-locking close) but
**not** the operational lifecycle a dispatcher runs, and in one respect it is *affirmatively* silent:

- **It supplies no asserting/authorizing role for a trip-scoped sign-off.** This is not merely
  unaddressed — it is the **already-recorded owed gap**: trip-scoped records are "**owed** to
  [A8 §9 item 8]" because "[A8 §5] has no trip row, and no source in the corpus binds a plan change to
  an asserting role." So "**who may confirm, and who may reverse a confirmation or a finalization**"
  has **no source**. Under [SD §0] it must not be reverse-engineered from the legacy form. This is the
  same shape as the **`claim` refusal** ([SD §4.7.3]): the carrier *receives* a claim and
  `contractingCarrier` names that party, "but the one who **decides** it is an adjuster, and no member
  of the cast names a decider." Here the act (confirm/finalize) is real; the **role that asserts or
  reverses it is owed**, exactly as the claim *decider* is.
- **It does not fix a two-boolean predicate on a day-of-service job.** "`IsConfirmed` then `IsFinal`,
  confirm-requires-not-final, final-requires-confirmed" is one reasonable *realization* of [2]'s two
  acts; the corpus supplies neither it nor a competing one. It is **[ORIGINAL]** at the predicate
  level.
- **It does not state the temporal invariant.** "You may finalize only on or after the service date"
  is **[ORIGINAL]**, though *domain-consistent* with [1.3] (finalization presupposes performance;
  MilMove reviews performed weight after the fact).
- **The customer-confirmation email is an operational side effect, not a domain fact.** That marking a
  day confirmed notifies the shipper is consistent with the [1.2] commitment being a shipper-facing
  agreement, but the corpus models the **agreement**, not a message emission.

## 4. For the mapping / implementation consumer (pegII `LocalDispatchJobOld`)

Written for the mapping workstream and the pegII `movemanager` change that prompted the enrichment.
It is **guidance for mapping, not part of the model** (it names our systems, which §0.1 bars from the
model itself).

- **`IsConfirmed` is the [1.2] service-date commitment; `IsFinal` is the [1.3] settlement-locking
  close.** Reading them as "the agreed day is committed to the customer" and "the performed day is
  closed for settlement" is faithful to the domain. The forward-only transition default (you move
  toward confirmed, then final) matches the [1.4] forward operational sequence.
- **The two-boolean predicate and the finalize-on/after-service-date rule are [§3] [ORIGINAL] local
  realizations — defensible, and owned by the implementation.** They are domain-consistent; the model
  owns only the shape of the two acts, not this predicate.
- **The restriction of *reversal* (un-confirm / un-final) to Wizard / OperationsAdmin is [§3]
  owed, not sourced.** The corpus binds no role to asserting or reversing a trip-scoped state
  ([A8 §9 item 8]). Gating reversal to a supervisor is a reasonable local policy — and rhymes with
  `src:atlas-world-group-api`'s `supervisor_approval_*` for its one gated act [1.4] — but it is a
  *local* authority decision, not one the model can hand you. Record it as such; do not cite it to a
  source.
- **The mapping-only longhaul `MasterTripStatus` (…→`Finalized`, which "cannot reach Finalized while
  any activity lacks `actual_date`") is the sibling realization, not evidence.** It corroborates that
  *our own systems* independently arrived at a finalize-after-performance rule; under §0.1 it is input
  to mapping, never a citation for the domain.
- **What stays out.** The settlement arithmetic (A13), the booking-amendment flow for the agreed date
  (A1), and a general trip state machine (A3 proper) are not built here; this note classifies the two
  acts only.

## 5. Owed

- The **asserting/reversing role** for a trip-scoped sign-off is `[ORIGINAL]`/owed and is **the same
  debt** the context map already records for trip-scoped records at [A8 §9 item 8] — "[A8 §5] has no
  trip row, and no source … binds a plan change to an asserting role." A source that binds a dispatch
  sign-off (or its reversal) to a party role would discharge it; until then it is a local authority
  decision. This note adds nothing to [A8 §5] and discharges none of that debt.
- The **two-boolean predicate** [§3] and the **finalize-on/after-service-date** invariant are
  `[ORIGINAL]` and owed a source if one ever enters the corpus that defines a day-of-service sign-off
  operationally.
- Should a later phase need the **confirmation** as a first-class fact (e.g. to publish a
  shipper-facing date commitment and its amendment), that belongs in **A1/A6** under the order/BOL,
  anchored to `src:cfr-49-375` §375.505 / §375.401(i) — not as a trip state.
