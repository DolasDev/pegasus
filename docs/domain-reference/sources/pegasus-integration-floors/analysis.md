---
source: src:pegasus-integration-floors
analyzed: 2026-09-17
evidence_grade: A
material: |
  Read in full (pegasus-domain-reference worktree, paths relative to repo root):
  - apps/api/src/integration-validation/floors/shipment-status-update.floor.ts
  - apps/api/src/integration-validation/floors/shipment-lifecycle-event.floor.ts
  - apps/api/src/integration-validation/floors/sales-lead.floor.ts
  - apps/api/src/integration-validation/floors/financial-settlement.floor.ts
  - apps/api/src/integration-validation/floors/document-record.floor.ts
  - apps/api/src/integration-validation/canonical-demo-partner.ts
  - apps/api/src/integration-validation/facts/demo-partner-facts.ts
  - apps/api/src/integration-validation/rules/demo-partner.rules.ts
  - apps/api/src/integration-validation/transform/demo-partner.transform.ts
  - apps/api/src/integration-validation/overlays/allied-status.overlay.ts
  - apps/api/src/integration-validation/types.ts
  - apps/api/src/integration-validation/{validate.ts,gate-pipeline.ts,summaries.ts} (headers)
  Skimmed for native-side vocabulary:
  - apps/api/src/integration-validation/floors/generic-inbound-floors.test.ts
  - apps/api/src/integration-validation/__corpus__/demo_partner/*.json
  Cross-repo (pegasus-workflows), the one live overlay on these floors:
  - platform/integrations/weichert/{README.md,mapping.json,corpus.json}
  - sdk-feedback/0040, 0041, 0042, 0045 (excerpts)
---

# Pegasus integration-validation floors (type abstractions) — analysis

## What it is

Our own code. A **"floor"** is the reusable, partner-neutral half of an
integration: a canonical Zod shape, a pure fact-derivation function, a fact
catalog with one-line `factDocs` per fact, the legal input field roots a mapping
may read, a default action, and an optional projection/correlation binding
(`apps/api/src/integration-validation/types.ts:65-97`). The partner-specific half
— native→canonical `mapping`, behavioral `rules`, `displayName`, and the
partner's own external output shape — is an **overlay**, authorable either as code
or as a published, versioned `IntegrationConfig` row (`types.ts:124-154`). A
runtime definition is the composition of the two (`registry.ts:108-123`).

- **S1 kind:** `internal-system` (functionally also an internal canonical
  vocabulary / message contract for partner traffic).
- **S2 adoption:** 1 — five floors exist; exactly one has a live production
  overlay (Weichert, GLOBAL v8 / nw TENANT v10,
  `pegasus-workflows:platform/integrations/weichert/README.md:291-293`). Four are
  scaffolded from Sirva ADE feeds and exercised only by tests
  (`floors/generic-inbound-floors.test.ts`).
- **S3 openness:** `internal`.
- **S4 evidence grade: A.** Every floor file, the canonical schema, the fact
  derivation, the built-in rules and both overlays were read in full. Nothing in
  this source was inaccessible.

**Caveat on what this source *is*.** Four of the five floors are deliberately
*empty of domain meaning*: they expose "only GENERIC facts — presence booleans and
raw field values" and "bake in NO partner-specific value sets"
(`floors/shipment-lifecycle-event.floor.ts:11-14`, `sales-lead.floor.ts:6-8`,
`financial-settlement.floor.ts:5-7`, `document-record.floor.ts:5-7`). Their
vocabulary is a *field list*, not a domain model. Only `shipment_status_update`
carries real semantics, and it inherited them from a fictional "Demo Partner"
example (`canonical-demo-partner.ts:1-13`) later pressed into service for a real
customer. Read it as *what we have already committed to on the wire*, not as an
analyzed domain model.

## Model summary

Five floors, in the source's own framing:

| Floor id | Subject, in the floor's words | Projection entity | Natural key |
| --- | --- | --- | --- |
| `shipment_status_update` | "shipment / order status-update notifications: an order with a service-status lifecycle and a list of shipments carrying cost/date/weight fields" (`shipment-status-update.floor.ts:11-13`) | `order` | `serviceOrderNumber` (`:44-47`) |
| `shipment_lifecycle_event` | "a shipment / move OPERATIONAL EVENT: a shipment identified by a reference, with a lifecycle status, parties, origin/destination, key dates, measures, and assigned resources" (`shipment-lifecycle-event.floor.ts:2-5`) | `shipment` | `{Brand}:{Number}:{Year}` (`:113-122`) |
| `sales_lead` | "a sales LEAD / opportunity: a prospective move with a contact, addresses, a move profile, a status, and free-form notes/activities" (`sales-lead.floor.ts:2-5`) | `lead` | `OpportunityId \|\| LeadId` (`:118-127`) |
| `financial_settlement` | "a financial SETTLEMENT / compensation statement: a subject (a shipment) with a paying/paid party, credit/debit/net totals, and line items" (`financial-settlement.floor.ts:2-5`) | `settlement` | `{Id}:{PartyId}` (`:99-107`) |
| `document_record` | "a DOCUMENT metadata record: an identified document with a kind, a file format, references, and metadata" (`document-record.floor.ts:2-4`) | `document` | `{Id}` (`:79-83`) |

The **order → shipments** containment on `shipment_status_update` is the only
aggregate relationship any floor declares: `DemoPartnerOrderSchema` holds
`shipments: z.array(DemoPartnerShipmentSchema)` (`canonical-demo-partner.ts:108`).
`financial_settlement` is the only floor declaring a *relationship to a Pegasus
entity*: `correlation: { localEntityType: 'shipment' }`, with the comment "A
settlement is always ABOUT a shipment … so a settlement record binds to exactly
one Pegasus shipment" (`financial-settlement.floor.ts:92-98`).

Pipeline, verbatim from `validate.ts:6-9`:

```
native order  --transform-->  canonical
canonical     --contract-->   structural issues (and stop if shape is broken)
context       --facts-->      neutral facts
facts         --rules-->      behavioral issues
```

## Vocabulary

Terms as the source spells them. Canonical (post-mapping) names unless marked
*native*.

| Term | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `serviceOrderNumber` | Order key on `shipment_status_update`; the *partner's* service-order number (e.g. `O-198870`), not our internal id. Also the projection key and the URL path parameter of the outbound POST. | A9 | `shipment-status-update.floor.ts:44-47`; `weichert/README.md:34-42` |
| `supplierShipmentId` | Per-shipment identifier — "the doc defines *that* one as the supplier's own identifier", i.e. **ours**, opposite side to `serviceOrderNumber`. | A9 | `canonical-demo-partner.ts:67`; `weichert/README.md:41-42` |
| `serviceStatus` | Order-level status. Enum: `Requested, Accepted, Submitted, Awarded, In Progress, Delivered, Declined, Canceled, Completed`. | A1 | `canonical-demo-partner.ts:18-28` |
| `SUPPLIER_SETTABLE_STATUSES` | The subset a supplier may set: `Accepted, Submitted, In Progress, Delivered, Completed`. | A1, A8 | `canonical-demo-partner.ts:30-37` |
| `SUPPLIER_FORBIDDEN_STATUSES` | `Requested, Awarded, Canceled, Declined` — "network-controlled". | A1, A8 | `canonical-demo-partner.ts:39-40` |
| `shipmentStatus` | Per-shipment picklist, "distinct from the order-level serviceStatus": `Under Review, In Process, In Storage, Delivered, Completed, Canceled`. | A2, A5 | `canonical-demo-partner.ts:42-50` |
| `milestoneDate` | `{ estimated, actual }` pair. "`estimated` (the planned date, `KeyMoveDates.<milestone>.Planned` on the legacy side) and `actual`." | A4 | `canonical-demo-partner.ts:56-64` |
| `surveyDate` (order) / `surveyDate` (shipment) | Two different fields: order-level survey date and a per-shipment one — "partners model the survey as a shipment milestone with its own plan/actual pair". | A4, A10 | `canonical-demo-partner.ts:71-76`, `:99` |
| `packDate1` / `loadDate1` / `deliveryDate1` | The three move milestones, each a `milestoneDate`. The `1` implies slots 2/3 the floor does not declare. | A4 | `canonical-demo-partner.ts:77-79`; `sdk-feedback/0040:119-124` |
| `netWeight` | `{ estimated, actual }` on a shipment. | A2 | `canonical-demo-partner.ts:69` |
| `surveyedStorageCostFirstDay` / `…AdditionalDays` / `…DeliveryOut` | Three surveyed storage charges — the SIT rate structure, as costs only. | A5, A7 | `canonical-demo-partner.ts:80-82` |
| `surveyedThirdPartyCrateAndUncrateCosts` / `surveyedThirdPartyCosts` / `surveyedThirdPartyOtherCosts` | Third-party accessorial charges. | A7 | `canonical-demo-partner.ts:83-85` |
| `estimatedTotalCost` | Order-level total. "the six summed components are storage / third-party / crate-uncrate **ADD-ONS**: a partner whose native payload carries one core transport total has no way to express it as those components". Mapped value wins over the sum, explicit `0` included. | A7 | `facts/demo-partner-facts.ts:9-15`, `:121-122`; `canonical-demo-partner.ts:100-107` |
| `action` | The operation being validated — `save \| cancel \| status-change`; each floor declares a `defaultAction` (`'save'` on all five). | A1 | `types.ts:45`, `:87-88` |
| `prior` | "The order's current persisted state (native shape), for transition rules." Auto-resolved from the cached projection when the floor declares one. | A1, A7 | `types.ts:36-43`, `:192-198` |
| `degraded` | "the validator itself failed internally and we FAILED OPEN — the order was NOT actually checked." | A6 (evidence) | `types.ts:26-33`; `validate.ts:10-14` |
| `Reference.{Brand, Number, Year}` | Shipment identity triple on `shipment_lifecycle_event`; `Brand` values in the test overlay are `AVL` / `NVL`. | A9 | `shipment-lifecycle-event.floor.ts:43-45`, `:113-122`; `generic-inbound-floors.test.ts:71-76` |
| `Reference.CarrierRef` / `Reference.TripId` | The only trip-side identifiers anywhere in this source. | A3 | `shipment-lifecycle-event.floor.ts:44` |
| `Lifecycle.{EventType, EventId, EventDateTime, Status}` | The event quadruple. No value set declared — "Value sets are partner business rules, so author them in the overlay." | A4 | `shipment-lifecycle-event.floor.ts:46-48`, `:80-83` |
| `Parties.{Shipper, Consignee}` | Two named party slots, each `{Identity:{FirstName,LastName}, PhoneNumber}`. | A8 | `shipment-lifecycle-event.floor.ts:27-30`, `:49` |
| `Addresses.{Origin, Destination}` | City/State/PostalCode/Country only — no street, no stop sequence. | A3, A8 | `shipment-lifecycle-event.floor.ts:31-36`, `:50` |
| `Dates.{Registration, Load, Delivery}` | Each `{ Actual }` **only** — no planned half on this floor. | A4 | `shipment-lifecycle-event.floor.ts:25`, `:51` |
| `Resources[]` | `{Id, Name, Type, Owner}` — "assigned resources". | A3, A8 | `shipment-lifecycle-event.floor.ts:37`, `:60` |
| `Totals.{Credit, Debit, Net}` / `LineItems[].{Code, Description, Credit, Debit, Driver1, Driver2, Group}` | Settlement money shape; `Driver1`/`Driver2` are the only driver references in the source. | A7, A13 | `financial-settlement.floor.ts:19-27`, `:34` |
| `Subject.{BilledWeight, BilledMileage, ActualLoadDate, ActualDeliveryDate, AgreementReference, TransactionDateTime}` | What a settlement is *about* — a shipment restated, not referenced. | A7, A9 | `financial-settlement.floor.ts:36-50` |
| `MoveProfile.{MoveType, RequestedMoveDate, ExpectedDeliveryDate, BusinessChannel}` | The lead's prospective move. `MoveType` value set undeclared. | A1, A10 | `sales-lead.floor.ts:64-71` |
| `Kind` / `Category` / `Format` / `Date` / `DateIn` / `Reference.{ReferenceNumber, BatchNumber, ScanLocation}` | Document metadata. No document-type vocabulary — "the floor accepts any". | A6 | `document-record.floor.ts:21-35`, `:51-53` |
| `projection` / `correlation` | "a cached-projection binding (keyed off the canonical order)" vs "Declares that records on this floor can be bound to a Pegasus entity, so the cached projection is reachable by OUR id instead of only the partner's key". | A9 | `types.ts:89-96`, `:224-263` |
| `inputFieldRoots` | "Top-level input field roots an overlay mapping may read" — a code-owned allowlist over the *native* payload. | A9 | `types.ts:71-72`; `transform/demo-partner.transform.ts:72-84` |
| `floor` / `overlay` | The type/partner seam. "A new partner on an existing floor is thus authorable as an overlay alone." | A8 / extensibility | `types.ts:99-106` |

## Lifecycles & events

**`shipment_status_update` is the only floor with a lifecycle.** It has three
layers, worth keeping distinct:

1. **Structural enum** — `serviceStatus` must be one of nine values; a bad value
   is a `structural-contract` issue, not a rule failure
   (`canonical-demo-partner.ts:97`; `validate.ts:44-53`). Per-shipment
   `shipmentStatus` is likewise enum-enforced (`rules/demo-partner.rules.ts:13-14`).
2. **Authority** — who may set what. `SUPPLIER_FORBIDDEN_STATUSES` encodes
   "network-controlled" transitions; rule `service-status-not-supplier-settable`
   fires on them (`rules/demo-partner.rules.ts:20-32`).
3. **Preconditions** — a decision table keyed on the *target* status:

   | Target status | Required | Rule id |
   | --- | --- | --- |
   | `Submitted` | supplier contact, contact-made date, survey date, `estimatedTotalCost > 0` | `submit-requires-*` (`rules/demo-partner.rules.ts:41-87`) |
   | `In Progress` | pack + load actual on **the same** shipment | `in-progress-requires-pack-load-actuals` (`:88-100`) |
   | `Delivered` / `Completed` | pack + load + delivery actual on the same shipment | `delivered-requires-pack-load-delivery-actuals` (`:101-114`) |

**There is no transition graph.** Rules test the *current* state, not an asserted
from→to. The live overlay found this out the hard way and deleted the authority
rule for exactly that reason: "the status we hand to `/validate` is the order's
**current state**, not an asserted transition — so enforcing it rejected orders
that merely sit in one of those statuses" (`weichert/README.md:220-224`).

**The milestone-fact catalog is the most carefully reasoned part of the source.**
Six counts exist because "which dates make up a milestone is partner-varying
policy the overlay owns" (`facts/demo-partner-facts.ts:20-34`):

- *composite* `shipmentsWithPackLoadActual`, `shipmentsWithPackLoadDeliveryActual`
- *per date* `shipmentsWithPackActual`, `shipmentsWithLoadActual`, `shipmentsWithDeliveryActual`
- *paired* `shipmentsWithLoadDeliveryActual`

and the reason is domain, not engineering: "load-without-pack moves are real: the
shipper packs, the crew only loads, so a Pack Date 1 Actual never exists"
(`facts/demo-partner-facts.ts:22-24`; adopted by the live overlay,
`weichert/README.md:226-231`). The `factDocs` also flag the counting trap: AND-ed
count predicates evaluate independently, so with 2+ shipments "load on one and
delivery on another satisfies both" (`facts/demo-partner-facts.ts:103-104`).

**The live overlay adds transition-direction rules the floor does not have.**
`pre-in-progress-forbids-{pack,load,delivery}-actual` reject an actual date while
status is `Requested/Awarded/Accepted/Submitted`, on the reasoning that "an actual
date asserts work that has happened, so it cannot exist on an order that has not
started" (`weichert/README.md:233-249`). This is the closest thing in our estate
to a *temporal invariant between status and evidence*, and it is authored in an
overlay, not in the model.

**Reason codes: none, anywhere.** No floor has an exception, delay, or
cancellation-reason vocabulary. Rule *failures* carry `ruleId` + `field` +
`message` + `sourceRef` (`types.ts:11-21`; `rules/demo-partner.rules.ts:27-28`),
which is a reason code for a *validation refusal*, not for a domain event.

**Other floors:** `shipment_lifecycle_event` carries `Lifecycle.Status` and
`Lifecycle.EventType` as free strings with no declared values; the *test* overlay
supplies `REGISTERED / LOADED / DELIVERED` and rejects `IN_LIMBO`
(`generic-inbound-floors.test.ts:117-155`). `sales_lead` likewise: the test
overlay's status set is `Converted, Dead, New, Unqualified, Working`
(`generic-inbound-floors.test.ts:171-180`). **These value sets are fixtures, not
contracts** — the floors bake in none by design.

## Time, identity, evidence

**Time.** The floors model exactly two tenses: `estimated` and `actual`
(`canonical-demo-partner.ts:64`). `estimated` is *defined as* the legacy `Planned`
value (`:58-59`) — planned and estimated are deliberately conflated. Facts derive
from `.actual` alone, so "a planned-but-not-actual date still counts as an absent
actual; adding `estimated` is deliberately fact-neutral" (`:61-63`). Windows were
considered and **rejected**: `Earliest`/`Latest` were declared out of scope
because they have no partner counterpart (`sdk-feedback/0040:126-128`). There is
no time zone anywhere and no date-vs-instant distinction on the floor — the live
overlay solves that in mapping with `coerce: "toDateOnly"`, which "truncates
wall-clock fields and never converts timezones, so a `Z`-suffixed evening
timestamp cannot roll the day forward" (`weichert/README.md:70-76`).
`shipment_lifecycle_event` has only `{Actual}` per date
(`shipment-lifecycle-event.floor.ts:25`) plus one `Lifecycle.EventDateTime` — so
on that floor a shipment has no plan at all.

**Identity.** The source's strongest contribution, stated as principle rather than
field list. `types.ts:236-263` argues a partner payload *cannot* carry our id: "a
partner payload carries the PARTNER's identifiers, and the floors that exist prove
it — `financial_settlement`'s canonical shape exposes `Id` and
`Reference.PartyId` (both theirs) and nothing of ours." Hence the floor declares
only "WHICH KIND of Pegasus entity its records describe", the id is supplied by
the caller that holds it, and the declaration is load-bearing because the write
path validates the caller's `localEntityType` against it "so a workflow cannot
bind a settlement to a `vehicle` by typo". Each floor derives a **natural key**
from the canonical record (table above). The live use proves the two-sided
identity problem is real: mapping the partner-facing `serviceOrderNumber` from our
internal `Id` produced a live `404 "The resource specified has no entity"`
(`weichert/README.md:34-42`).

**Provenance and correction.** Thin, and honestly so:

- Facts have no asserter. `deriveFacts` is a pure function of the payload
  (`types.ts:73-75`); nothing records who said a date is true.
- The only provenance is on **rules**: `sourceRef` names the partner-API behavior
  a rule reproduces (`rules/demo-partner.rules.ts:27-28`), and the live overlay
  uses it to mark a rule as *ours* rather than the vendor's ("its `sourceRef` says
  so rather than citing the vendor", `weichert/README.md:237-239`). Provenance of
  a *policy* — a pattern worth keeping.
- Correction semantics exist only for the **binding**, not the facts: a
  correlation write returns `created / unchanged / rebound / conflict / rejected /
  unsupported`, and "A correlation problem never fails the write — the state is
  the durable artifact, the binding is an index into it"
  (`pegasus-workflows:CLAUDE.md`, projection-cache section).
- Projection state itself is an **unvalidated blob**: live testing showed
  pegII-native, partner-external, and deliberate garbage all accepted as
  successive versions, and a free-form `entityType` accepted despite the floor
  declaring one (`sdk-feedback/0045:97-120`). Versioning exists (`version:
  1,2,3`), so a projection is an append-of-versions — but with no shape, no actor
  and no assertion timestamp in evidence.
- `degraded: true` is a genuine evidence primitive: the validator can report "I
  did not actually check this" rather than a false pass (`types.ts:26-33`).

## Scores

Weights are a phase-3 decision; these are raw per-criterion scores. `n/a` where
the criterion does not apply to the area.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 3 | Nine-value enum covers request/accept/submit/award/progress/deliver/decline/cancel/complete (`canonical-demo-partner.ts:18-28`); who-may-set explicit (`:30-40`); preconditions per target status (`rules/demo-partner.rules.ts:41-114`). No transition graph, no "booked", no cancellation reasons; C3 capped at 2 because rules read current state, not an asserted transition (`weichert/README.md:220-224`). C8=3 for the floor/overlay seam + versioned configs (`types.ts:99-154`). |
| A2 Shipment structure | 2 | 2 | 2 | 1 | n/a | 3 | 1 | 3 | Order→`shipments[]` containment (`canonical-demo-partner.ts:108`); estimated/actual `netWeight` (`:69`); the two status picklists explicitly distinguished (`:9-13`, `:42-50`). **No shipment types** (HHG/vehicle/PPM/storage), **no services-ordered list** ⇒ C1=2, C4=1 (`In Storage` is the sole HHG-native shipment state). C6=3: `supplierShipmentId` vs `serviceOrderNumber` is a maintained, load-bearing distinction (`weichert/README.md:34-42`). C5 scored under A4. |
| A3 Trip, stop & assignment | 1 | 0 | 0 | 0 | 0 | 2 | 0 | 3 | Only `Reference.TripId` + `CarrierRef` (`shipment-lifecycle-event.floor.ts:44`) and `Resources[]{Id,Name,Type,Owner}` (`:37`). `Addresses.{Origin,Destination}` is a city/state pair, not a stop list (`:31-36`). No stop sequence, legs, consolidation, or equipment/driver assignment model, and no definitions ⇒ C2/C3/C4/C5=0. C6=2 for trip/carrier cross-refs alongside the shipment triple. |
| A4 Execution events & tracking | 2 | 3 | 2 | 2 | 2 | 2 | 1 | 3 | C2=3 earned: `factDocs` define composite-vs-per-date-vs-paired milestone semantics and the independent-count trap (`facts/demo-partner-facts.ts:95-104`, `:20-34`). C1=2 — pack/load/delivery/survey/registration actuals and an `EventType/EventId/EventDateTime/Status` quadruple (`shipment-lifecycle-event.floor.ts:46-48`), but no arrive/depart, no ETA, no exception or delay reasons anywhere. C5=2: estimated/actual pair, but estimated *is* planned by definition (`canonical-demo-partner.ts:58-59`), windows explicitly out of scope (`sdk-feedback/0040:126-128`), no time zone. C7=1: no actor on any date. |
| A5 Storage-in-transit | 1 | 1 | 1 | 2 | 0 | n/a | 0 | 3 | The entire SIT model is three *cost* fields — first day / additional days / delivery out (`canonical-demo-partner.ts:80-82`) — plus the `In Storage` shipment status (`:48`). C4=2 because that triple **is** the HHG SIT charge structure. **No SIT-in or SIT-out date, no duration, no warehouse party or stop, no permanent-storage boundary** ⇒ C5=0, C1=1. |
| A6 Documents & evidence | 2 | 1 | 0 | 0 | 1 | 2 | 1 | 3 | `document_record` covers Id/Kind/Category/Title/Description/Format/PageCount/FileSize/Date/DateIn (`document-record.floor.ts:21-35`). C4=0: no BOL, weight ticket, POD, inventory or order-for-service vocabulary; "the floor accepts any" format (`:51-53`). C3=0: no document lifecycle. C5=1: `Date` vs `DateIn` is a real capture-vs-event distinction, undefined. C7=1: `ScanLocation`+`DateIn`+`BatchNumber` are capture provenance (`:23`) and `degraded` marks an unverified check (`types.ts:26-33`); **nothing links a document to the event it evidences.** |
| A7 Charges & billing hooks | 2 | 2 | 1 | 2 | 1 | 2 | 1 | 3 | Six surveyed components + order-level `estimatedTotalCost` (`canonical-demo-partner.ts:80-85`, `:100-107`); settlement `Totals{Credit,Debit,Net}` + typed `LineItems` (`financial-settlement.floor.ts:19-34`). C2=2 on one very precise definition: the six components are *add-ons*, a core transport total cannot be expressed as them (`facts/demo-partner-facts.ts:9-15`) — evidenced live, CoreCost 10590.87 vs 970 of add-ons (`weichert/README.md:144-151`). C3=1: a cost gate at submit, no invoice issued/paid lifecycle. C4=2: storage + third-party + crate/uncrate is an HHG accessorial taxonomy. |
| A8 Parties & roles | 2 | 1 | 2 | 1 | n/a | 2 | 1 | 3 | Slots: `ShipperEmployer`, `Coordinator` (`transform/demo-partner.transform.ts:15-21`), `Parties.{Shipper,Consignee}` (`shipment-lifecycle-event.floor.ts:49`), settlement `Reference.PartyId` (`financial-settlement.floor.ts:33`), `LineItems[].Driver1/Driver2` (`:25`), `Resources[].Owner` (lifecycle floor `:37`), lead `Contact` (`sales-lead.floor.ts:54-62`). **No booking/origin/hauling/destination agent, no crew, no warehouse, no van line** ⇒ C1=2, C4=1. C3=2 for the one genuine authority model: supplier-settable vs network-controlled statuses (`canonical-demo-partner.ts:30-40`). C2=1: roles are slot names with no definitions, and `ShipperEmployer` is semantically overloaded — it carries the *order number*, not a party (`transform/demo-partner.transform.ts:15`). |
| A9 Identity & cross-references | 3 | 3 | 2 | 2 | n/a | 3 | 2 | 3 | Every floor derives a **natural key** from the canonical record (five distinct key strategies, table above). C2=3 for `types.ts:236-263` — an explicit, reasoned account of why our id cannot be derived from a partner payload. C3=2: the binding has a real outcome vocabulary (`created/unchanged/rebound/conflict/rejected/unsupported`), but a declared `projection.entityType` is silently unenforced and the documented type of `correlation` is wrong (`sdk-feedback/0045:52-120`). C4=2: `{Brand}:{Number}:{Year}` is the van-line registration-number convention (`shipment-lifecycle-event.floor.ts:113-122`). C7=2: `rebound`/`conflict` are correction semantics for the binding. |

**S5 — fit to Pegasus data.** pegII column is evidenced in `src:pegii-order`;
Cloud is not addressed by this source and is left to its own entry (`unknown`
throughout).

| Area | pegII | Note |
| --- | --- | --- |
| A1 | partial | One free-form `Survey.SerivceStatus`; the nine-value enum is *ours*, and pegII reports current state only. |
| A2 | partial | Weights yes (`Financials`); one sale maps to exactly one shipment via `$each` over the root (`weichert/mapping.json:27-29`); no shipment typing. |
| A3 | no | Nothing on these floors is fed by pegII; trips are `src:pegii-longhaul`. |
| A4 | partial | `KeyMoveDates.<milestone>.{Planned,Actual}` feed the milestone pairs; discrete events, ETA and exceptions have no source. |
| A5 | partial | Storage *costs* map from `Survey.Storage*`; storage *dates* have no mapped source. |
| A6 | no | `document_record` has no pegII feed; pegII documents surface as rendered PDFs (`apps/api/src/gateways/pegii-report.gateway.ts:40-45`). |
| A7 | partial | `Survey.CoreCost` + six components map; the settlement floor has no pegII feed. |
| A8 | partial | Only `ShipperEmployer` and `Coordinator` are mapped, and the coordinator's **email is not native** — a workflow enrichment pass writes it before mapping (`weichert/README.md:99-104`). |
| A9 | yes | Both sides of the identity pair exist natively and are mapped. |

## Strengths worth adopting

1. **The floor/overlay seam itself** — "the reusable, partner-neutral half" vs
   "everything partner-specific" (`types.ts:58-63`, `:99-106`). The reference
   model should draw the same line: a domain milestone is ours; *which* dates
   constitute a partner's notion of that milestone is theirs.
2. **`factDocs` — one line of meaning per derived quantity, served over the API**
   (`types.ts:76-86`; `facts/demo-partner-facts.ts:85-106`). "A name + type alone
   doesn't say what a fact counts." The event catalog should carry the same
   obligation: every published field ships with the distinction it encodes.
3. **Per-date *and* composite *and* paired milestone predicates.** Refusing to
   hardcode "a milestone is pack+load" because load-without-pack moves are real
   (`facts/demo-partner-facts.ts:20-34`) is the most HHG-literate decision in the
   source. Define pack, load and delivery as independent observations and let
   policy compose them.
4. **Identity as a two-sided problem, stated as principle** (`types.ts:236-263`)
   — a record carries *their* ids; ours is supplied by whoever holds it; the
   record type is declared so a mis-binding is caught. Adopt wholesale for A9,
   including natural-key-per-record-type.
5. **A binding outcome vocabulary separate from the write outcome**
   (`created/unchanged/rebound/conflict/rejected/unsupported`), with the rule that
   a correlation failure never fails the state write. Correction semantics for
   *cross-references* are usually forgotten; this has them.
6. **`sourceRef` on every rule**, including the ability to say "this one is ours,
   not the vendor's" (`rules/demo-partner.rules.ts:27-28`;
   `weichert/README.md:237-239`). Cheap provenance-of-policy the model should
   require on every invariant it states.
7. **`degraded` — "the gate did not run"** as a first-class result distinct from
   pass and fail (`types.ts:26-33`). The evidence model (A6) needs this
   three-valued shape.
8. **Additive-by-construction schema evolution.** Every new canonical field is
   nullish specifically so existing overlays produce byte-identical output
   (`canonical-demo-partner.ts:59-64`, `:71-76`, `:104-107`). This is the
   versioning discipline the event catalog will need.

## Weaknesses / traps

1. **The canonical shape is a fictional partner's, not a domain model.** It began
   as "a fictional example supplier integration … a generic supplier 'service
   order'" (`canonical-demo-partner.ts:1-8`) and a real customer was later mapped
   onto it. Its field names (`supplierContactEmail`,
   `surveyedThirdPartyCrateAndUncrateCosts`, `packDate1`) are one partner's
   contract. **Do not lift this shape into `model/`.**
2. **`serviceStatus` conflates three lifecycles in one string**:
   `Requested/Awarded/Declined` are *award* states, `Accepted/Submitted` are
   *estimate* states, `In Progress/Delivered/Completed` are *execution* states
   (`canonical-demo-partner.ts:18-28`). The reference model should separate them —
   this is the clearest example in our estate of why.
3. **`estimated` is defined as `planned`** (`canonical-demo-partner.ts:58-59`).
   The rubric's C5 distinction (planned *vs* estimated *vs* actual) is collapsed
   at the source, and windows (`Earliest`/`Latest`) were deliberately discarded
   (`sdk-feedback/0040:126-128`) even though pegII supplies them. Following this
   source would bake a two-tense time model into the catalog.
4. **A date is the only evidence of an event.** No event record, no asserter, no
   observation time vs occurrence time. "Delivered" is inferred from the presence
   of `deliveryDate1.actual`. Corrections are overwrites.
5. **Status is current state, never an asserted transition** — and the live
   overlay had to delete its authority rule because of it
   (`weichert/README.md:220-224`). Any model built from these floors inherits an
   inability to say *who changed what, when*.
6. **Storage is money, not time.** A model taking A5 from here would have SIT
   charges and no SIT.
7. **`ShipperEmployer` means "the order number lives here"**
   (`transform/demo-partner.transform.ts:15`). A party slot used as an identifier
   carrier. Do not copy the name or the shape.
8. **Four of the five floors are deliberately empty of vocabulary.** Treat their
   test fixtures (`AVL`/`NVL`, `REGISTERED/LOADED/DELIVERED`,
   `Converted/Dead/New/Unqualified/Working`) as *examples from Sirva ADE*, not as
   contracts — the floors say so themselves
   (`shipment-lifecycle-event.floor.ts:11-14`).
9. **Declared-but-unenforced surfaces exist.** `projection.entityType` is declared
   and ignored; the documented type of `correlation` is wrong; the projection
   state has no shape at all (`sdk-feedback/0045:97-120`). Do not read a
   declaration in this source as a guarantee without checking.
10. **`shipment_lifecycle_event` has only actuals** — no planned half
    (`shipment-lifecycle-event.floor.ts:25`, `:51`) — while
    `shipment_status_update` has both. The two floors disagree about the shape of
    a date, which is exactly the inconsistency a reference model exists to fix.

## Out-of-v1 material

- **A10 (survey & estimating).** A survey is modeled twice — order-level
  `surveyDate` and a per-shipment `surveyDate{estimated,actual}` milestone
  (`canonical-demo-partner.ts:71-76`, `:99`) — and a survey *date* is a
  precondition for submitting an estimate (`rules/demo-partner.rules.ts:64-74`).
  The `Survey.*` native root supplies the cost side. **No estimate typing**
  (binding / non-binding / not-to-exceed) and **no inventory items** anywhere.
- **A11 (claims & valuation).** Absent entirely. No floor, field, or fact.
- **A12 (rating & tariffs).** Absent. Charges are flat surveyed amounts; no tariff
  reference, rate structure or accessorial catalog. `Subject.BilledWeight` and
  `Subject.BilledMileage` (`financial-settlement.floor.ts:43-44`) are the only
  rating *inputs* present.
- **A13 (crew, driver & settlement).** `financial_settlement` is a whole floor for
  it: `Totals{Credit,Debit,Net}`, `LineItems[]{Code, Description, Credit, Debit,
  Driver1, Driver2, Group}`, `Reference.PartyId` = the party being settled with,
  and `Subject.AgreementReference` (`financial-settlement.floor.ts:19-50`). The
  test overlay maps `PartyId ← AgentNbr`, `Id ← ShipmentNbr`
  (`generic-inbound-floors.test.ts:225-232`), revealing the intended grain: **one
  settlement per agent per shipment**. Two driver slots per line item suggests
  revenue splits are per-line, not per-settlement. Best A13 starting point we own.
- **Sales/CRM.** `sales_lead` carries
  `Notes[]{RowId,Note,Source,DateTime,CreatedBy}` and
  `Activities[]{RowId,Description,AssignedTo,Type,StartDate,EndDate,Duration,Status}`
  (`sales-lead.floor.ts:27-43`). `Notes[].CreatedBy` + `Source` + `DateTime` is
  **the only per-record provenance triple in the entire source** — a lead note
  knows who wrote it; a delivery date does not.

## Open questions

1. **Which of these floors are contracts we must keep?** `shipment_status_update`
   is live with an external partner (Weichert GLOBAL v8). The other four have no
   production overlay. Are their shapes negotiable when the reference model
   contradicts them?
2. **Is `serviceStatus` a Weichert contract or a Pegasus vocabulary?** The
   nine-value enum sits in the *floor* (code), so every partner on this floor
   inherits it, yet it originated from one fictional partner
   (`canonical-demo-partner.ts:1-13`).
3. **Where is a shipment's *type*?** Nothing in any floor distinguishes HHG from
   vehicle, storage, or PPM. Does any partner feed carry it, or is it purely a
   pegII concept? (User / `src:pegii-order` question.)
4. **What does `Resources[]{Id,Name,Type,Owner}` actually carry on the Sirva ADE
   feed** — drivers, trucks, trailers, crews? `Owner` implies agent-owned
   equipment, which would be our only equipment-assignment evidence (A3).
5. **Is `Lifecycle.EventType` ever populated distinctly from `Lifecycle.Status`?**
   If a partner sends both an event type and a resulting status, that is the
   event-vs-state distinction the catalog needs — the first real example of it in
   our estate.
6. **Why does `shipment_lifecycle_event` model only actuals?** Absent from the
   source feed, or dropped in design? It determines whether an inbound partner
   event can ever restate a plan.
7. **Does any partner send a delay/exception with a reason code?** No floor has
   one; if Sirva ADE or a visibility platform does, A4 needs a reason-code
   vocabulary none of our existing shapes can hold.
8. **Should the canonical shape be extensible per-overlay for non-fact-bearing
   output fields?** Raised inside the source itself as the way to retire a whole
   class of "the floor had to ship first" blockers (`sdk-feedback/0040:104-110`).
   The answer shapes how the event catalog versions.
