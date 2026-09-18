---
source: src:pegii-order
analyzed: 2026-09-17
evidence_grade: B
material: |
  There is NO complete native pegII order on disk. This analysis reconstructs the
  shape from five partial, indirect sources, all read in full:
  - pegasus-domain-reference:apps/api/src/gateways/pegii-order.gateway.ts
  - pegasus-domain-reference:apps/api/src/gateways/pegii/pegii-order.dto.ts
  - pegasus-domain-reference:apps/api/src/gateways/pegii/pegii-order.mapper.ts
  - pegasus-domain-reference:apps/api/src/gateways/pegii/__tests__/pegii-order.mapper.test.ts
  - pegasus-domain-reference:apps/api/src/gateways/pegii/pegii-salesman.dto.ts (the joined party record)
  - pegasus-domain-reference:apps/api/src/services/pegii-orders.ts (the projected OrderRecord)
  - pegasus-domain-reference:apps/api/src/integration-validation/transform/demo-partner.transform.ts (native input roots)
  - pegasus-domain-reference:apps/api/src/integration-validation/__corpus__/demo_partner/*.json (synthetic native fixtures)
  - pegasus-workflows:sdk-feedback/0029 (native-shape excerpts from live orders 464377/490574/490317)
  - pegasus-workflows:sdk-feedback/0028, 0039, 0040, 0042, 0044, 0045 (field-level excerpts)
  - pegasus-workflows:platform/integrations/weichert/{README.md,mapping.json,corpus.json}
  - pegasus-workflows:platform/weichert-milestone-update/weichert_milestone_update/workflow.py
  NOT read (does not exist / not accessible from here): any complete native order
  payload; the pegII API's own schema or documentation; the MoveManager database
  schema. No live API call was made from this session.
---

# Pegasus II (legacy MoveManager) sale / order — analysis

## What it is

The authoritative order record of **Pegasus II**, the legacy on-prem system.
pegII "calls an order a **Sale** internally, so the serialized payload is the
legacy Sale record" (`apps/api/src/gateways/pegii/pegii-order.dto.ts:6-7`),
served over a WireGuard tunnel at
`GET /api/v1/pegii/serialized/orders/:id` — "pegII calls the entity a 'Sale'
internally, but the serialized endpoint's supported entity name is 'orders'"
(`pegii-order.gateway.ts:7-9`). Payloads arrive in a
`{data, error, code, correlationId}` envelope
(`weichert/README.md:30-32`; `pegii-report.dto.ts:8-13`), nested and PascalCase,
"as legacy .NET serialization emits" (`pegii-order.dto.ts:8`).

- **S1 kind:** `internal-system` (form-and-save CRUD over a legacy .NET domain).
- **S2 adoption:** 3 within our estate — it is the system of record for every
  customer tenant's orders. 0 externally.
- **S3 openness:** `internal`.
- **S4 evidence grade: B — and the grade is the finding.** No complete native
  order exists in either repo. What exists is: (a) our own **provisional**
  anti-corruption DTO, whose header says "⚠️ PROVISIONAL CONTRACT" and admits
  `OrderDate`/`ModifiedDate`/`ShipperName` are "best-effort from the pasted real
  record" (`pegii-order.dto.ts:10-18`); (b) a **published mapping** that reads
  ~20 native paths and was audited field-by-field against live order 490317
  (`weichert/mapping.json`, `weichert/README.md:86-96`, `:144-151`); (c) **quoted
  fragments** of three live orders in sdk-feedback specs; (d) **synthetic
  fixtures** shaped like the native payload but authored by us
  (`__corpus__/demo_partner/*.json`, `weichert/corpus.json`). Every statement
  below is one of those; none is a reading of pegII's own schema.

**What we could not read, explicitly:** the full top-level key set of the Sale
object; the full contents of `InvolvedParties`, `KeyMoveDates`,
`SettlementUniqueInfo`, `CommissionUniqueInfo`, `LocalDispatchUniqueInfo`,
`WarehouseSummary`, `UnusedFields`; any value domain (status codes, milestone
keys, document types); and anything about write semantics. See **Open questions**
— that list is the request to the user.

## Model summary

One **Sale** = one order = (as far as every mapping treats it) **one shipment**.
The Weichert mapping builds the canonical `shipments` array with
`{"$from": ".", "$each": {…}}` — "the move object IS the single shipment; `$each`
wraps the root object into a one-element shipments array"
(`transform/demo-partner.transform.ts:6-8`; `weichert/mapping.json:27-29`). The
workflow relies on this: "a pegII order produces exactly one shipment whose
`supplierShipmentId` is the pegII order id" (`workflow.py:436-440`). **Nothing in
the evidence shows a shipment as a distinct entity inside a Sale.**

Top-level roots observed (each with a cite; contents beyond the named leaves are
unknown):

| Root | What is evidenced | Cite |
| --- | --- | --- |
| `Id` | pegII's own sale id — `490317`, `464377`, `490574`. Serialized as number or string. | `sdk-feedback/0029:19-23`, `:118-120`; `pegii-order.dto.ts:37-38` |
| `Survey` | Status + shipper name + the whole cost block + comment fields. | below |
| `InvolvedParties` | `ShipperEmployer`, `Coordinator` (only two keys evidenced). | `transform/demo-partner.transform.ts:15-21` |
| `KeyMoveDates` | Keyed milestone → `{Planned, Earliest, Latest, Actual}`. | `sdk-feedback/0040:60-70` |
| `Financials` | `EstimatedWeight`, `ActualWeight`. | `transform/demo-partner.transform.ts:31-32` |
| `DocumentationDates` | A **positional array** of dates, no legend. | `weichert/README.md:93-95` |
| `SettlementUniqueInfo` | `Actual{Pack,Load,Deliver}Date`. | `sdk-feedback/0029:122-123`, `:132` |
| `CommissionUniqueInfo` | The same three actuals, duplicated. | `weichert/README.md:86-91` |
| `LocalDispatchUniqueInfo` | `{Earliest,Latest}{Pack,Load,Deliver}Date`. | `weichert/README.md:83-84`; `sdk-feedback/0040:126-128` |
| `WarehouseSummary` | **Root name only — contents never seen.** | `sdk-feedback/0029:41-42`, `:122` |
| `UnusedFields` | The .NET serializer's junk drawer: `survey_received`, `survey_confirm`, `truck_name`, "dispatch/labor dates, etc." | `sdk-feedback/0028:26-28`, `:95` |
| `OrderDate` / `ModifiedDate` | Record creation / last-modified timestamps. Marked best-effort. | `pegii-order.dto.ts:17-18`, `:58-61` |

A joined record, not part of the Sale: the **Salesman**
(`/api/v1/pegii/serialized/salesmen/:id`), reached by
`InvolvedParties.Coordinator.Identity.Code` (`workflow.py:227-234`). Its shape is
grade-A evidenced from a live sample of salesman 213056
(`pegii-salesman.dto.ts:11-14`): `code, avlCode, firstName, lastName, title,
extension, email, branch, agencyCode, roles ("SM"), employeeType ("S"), isActive,
startDate, dateTerminated`.

A second adjacent surface: **reports**, `GET /api/v1/pegii/reports/:reportType/:id`
returning `{reportType, id, fileName, contentType: "application/pdf",
contentBase64}` — e.g. `order-profile` (`pegii-report.dto.ts:24-30`;
`pegii-report.gateway.ts:40-45`). Documents exist in pegII as *rendered reports*,
not as document records.

## Vocabulary

Native names exactly as they serialize. **Every spelling below is load-bearing**,
including the misspelling.

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `Sale` | pegII's internal name for an order. The serialized entity is exposed as `orders`. | A1 | `pegii-order.dto.ts:6-7`; `pegii-order.gateway.ts:7-9` |
| `Id` | The sale's own identifier — **ours**, not a partner's. "This is **our** identifier for the record, and it is not the same thing as `serviceOrderNumber`". | A9 | `workflow.py:386-393` |
| `Survey.SerivceStatus` | The order's service status. **pegII's own misspelling of "ServiceStatus"**, emitted that way by the serializer; "do not 'correct' it here or the projection silently stops resolving." Free-form string. Observed values: `Delivered`, `Submitted`. | A1 | `pegii-order.dto.ts:26-28`, `:41-43`; `sdk-feedback/0029:122-123`; `weichert/corpus.json` case 21 |
| `Survey.ShipmentStatus` | A per-shipment status **code** on the same block. "Atlas's `ShipmentStatus` code has no supplied legend, so it maps `null` until a code→enum translation is provided." | A2 | `weichert/README.md:106-109`; `workflow.py:468-470` |
| `Survey.ShipperName` | The customer / shipper display name, e.g. `"HOUSTON, TY"`. | A8 | `pegii-order.dto.ts:43-44`; `sdk-feedback/0029:118-119` |
| `Survey.CoreCost` | The order's **core transport cost** — `10590.87` on order 490317. Distinct from, and not overlapping with, the add-on components. | A7 | `weichert/README.md:141-151` |
| `Survey.Storage1stDay` / `StorageAdditionalDays` / `StorageOut` | Surveyed storage charges: first day, additional days, delivery out. | A5, A7 | `weichert/mapping.json:96-107` |
| `Survey.ThirdPartyCrate` / `ThirdPartyCost` / `ThirdPartyOtherCost` | Surveyed third-party charges (crate/uncrate, other). `820` and `150` on 490317, "both itemized in `Survey.OtherCostComments`". | A7 | `weichert/mapping.json:108-119`; `weichert/README.md:158-161` |
| `Survey.NotIncludedComments` / `OtherCostComments` / `GeneralComments` | Free-text comment slots on the survey. | A10 | `weichert/mapping.json:120-122` |
| `InvolvedParties.ShipperEmployer.Identity.Description` | **The customer's service order number** (`O-198870`, `O-100003`, `O-60232`) — not a party name. "Weichert's own service order number …, *not* pegII's internal sale id." | A9, A8 | `weichert/README.md:34-42` |
| `InvolvedParties.Coordinator.Identity.Description` | The coordinator's display name (e.g. `"Suzanne Polo"`). | A8 | `transform/demo-partner.transform.ts:16`; `__corpus__/demo_partner/01-valid-accepted.json` |
| `InvolvedParties.Coordinator.Identity.Code` | The coordinator's **salesman code** — the join key to the Salesman record. | A8, A9 | `workflow.py:227-234` |
| `InvolvedParties.Coordinator.EmailAddress` | **Not native.** "a native pegII sale carries the coordinator's *code* and display name … no email"; a workflow enrichment pass writes this key before mapping. | A8 | `workflow.py:18-21`, `:243-246`; `weichert/README.md:99-104` |
| `KeyMoveDates.<milestone>` | A **keyed** milestone object, "`{ Planned: …, Earliest: …, Latest: …, Actual: … }`". Milestones evidenced: `Survey`, `Pack`, `Load`, `DelResidence`. | A4 | `sdk-feedback/0040:60-70` |
| `DelResidence` | The delivery milestone key — literally "delivery to residence". | A4, A5 | `weichert/mapping.json:82`, `:89` |
| `Financials.EstimatedWeight` / `ActualWeight` | Shipment weight, estimated and actual. | A2 | `transform/demo-partner.transform.ts:31-32` |
| `DocumentationDates` | A positional array of dates. On 490317 "indices 0, 2, 4, 5, 8" carry real dates "with no legend". Index 0 is mapped as the contact-made date. | A6 | `weichert/README.md:93-95`; `weichert/mapping.json:13-19` |
| `SettlementUniqueInfo.Actual{Pack,Load,Deliver}Date` | The three actuals again, on the settlement block. | A4, A13 | `sdk-feedback/0029:122-123`, `:132` |
| `CommissionUniqueInfo.*` | The three actuals a third time, on the commission block. | A4, A13 | `weichert/README.md:88-90` |
| `LocalDispatchUniqueInfo.{Earliest,Latest}{Pack,Load,Deliver}Date` | Dispatch-side date **windows** per milestone. | A3, A4 | `weichert/README.md:83-84` |
| `WarehouseSummary` | A top-level root. **Meaning unknown** — the name is all the evidence there is, and it is the most likely home of storage/SIT. | A5 | `sdk-feedback/0029:41-42` |
| `UnusedFields` | "Pegii's junk-drawer, where the .NET serializer parks a large tail of legacy fields" — `survey_received`, `survey_confirm`, `truck_name`, "dispatch/labor dates". | A6, A10 | `sdk-feedback/0028:26-28`, `:95` |
| `0001-01-01T00:00:00` | The **.NET `DateTime.MinValue` sentinel**: "means 'unset' in the source but reads as a real date downstream." | A4 | `weichert/README.md:50-54` |
| `Salesman` | The sales user tied to an order — `code`, `avlCode`, `branch`, `agencyCode`, `roles` ("SM"), `employeeType`, `isActive`, `startDate`, `dateTerminated`. | A8 | `pegii-salesman.dto.ts:20-47` |
| `order-profile` | A report type rendered as PDF for an order id. | A6 | `pegii-report.dto.ts:25-26` |

## Lifecycles & events

**There is one status field and no lifecycle.** `Survey.SerivceStatus` is a
free-form string; pegII supplies no state machine, no transition log, no actor,
and no status-change timestamp in any evidence. Two consequences are documented
rather than inferred:

- **It is current state, not an asserted transition.** "the status we hand to
  `/validate` is the order's **current state**, not an asserted transition — so
  enforcing it rejected orders that merely sit in one of those statuses"
  (`weichert/README.md:220-224`). A transition-authority rule had to be deleted
  because of this.
- **Our own projection collapses it to three values, silently.**
  `mapPegiiOrderToRecord` narrows the free string onto
  `'booked' | 'in_progress' | 'completed'` — matching `inprogress/active/packing/
  intransit → in_progress`, `completed/complete/closed/delivered → completed`,
  `booked/open/confirmed → booked`, and **"any unrecognized value falls back to
  'booked'"** (`pegii-order.mapper.ts:32-57`; test matrix
  `__tests__/pegii-order.mapper.test.ts:51-65`). That synonym list is **our
  guess**, not pegII's vocabulary — it is the strongest single hint at pegII's
  value domain, and it is unverified.

**Milestones, not events.** What pegII records is a *date per milestone*, keyed:
`Survey`, `Pack`, `Load`, `DelResidence`, each `{Planned, Earliest, Latest,
Actual}` (`sdk-feedback/0040:60-70`). Setting an actual is the only way pegII
says something happened. There is no arrive/depart, no ETA, no exception, no
delay reason, and no event id or sequence in any evidence.

**The same actual is stored in three places.** "Audited against order 490317, the
three actuals appear in *three* places with identical values —
`SettlementUniqueInfo.Actual{Pack,Load,Deliver}Date`, `CommissionUniqueInfo.*`,
and `KeyMoveDates.<milestone>.Actual`" (`weichert/README.md:86-91`). No master is
declared; the mapping chose `KeyMoveDates` "because it is the only one that is
keyed (not positional), carries the `Planned` half … and covers every milestone
including the survey."

**Write side: read-only.** "The pegII bridge is read-only for orders — `GET
/api/v1/pegii/orders/{id}` is the whole surface, `PATCH`/`PUT`/`POST` on it hit
the unmatched-route fallback" (`workflow.py:547-551`; spec'd in
`sdk-feedback/0044`). The write-back that *would* be issued patches
`{"Survey": {"SerivceStatus": …, "ShipmentStatus": …}}` — "exactly where the
Weichert mapping reads them from, so a write-back followed by a re-map
round-trips instead of drifting" (`workflow.py:466-472`). So the only two
mutable-by-us fields in the whole record are the two statuses.

**Reason codes:** none observed, for anything.

## Time, identity, evidence

**Time.** pegII's milestone object is, on the evidence, the **richest time model
in our estate**: four tenses per milestone — `Planned` (the plan), `Earliest` /
`Latest` (a window), `Actual` (what happened)
(`sdk-feedback/0040:60-70`), with the dispatch window duplicated at
`LocalDispatchUniqueInfo.{Earliest,Latest}{Pack,Load,Deliver}Date`
(`weichert/README.md:83-84`). Three caveats, all evidenced:

1. **Two of the four tenses are discarded downstream by choice.**
   `Earliest`/`Latest` were declared out of scope for the canonical shape because
   "they have no counterpart on Weichert's update payload"
   (`sdk-feedback/0040:126-128`). The data exists; our model throws it away.
2. **Values are naive wall-clock ISO strings** — `"2026-07-16T16:42:45.013"`,
   `"2018-05-04"`, `"2026-07-01T00:00:00"` (`sdk-feedback/0029:19-23`,
   `:118-119`). No offset, no zone, nothing saying whose local time. The mapping
   compensates with `toDateOnly`, which "truncates wall-clock fields and never
   converts timezones, so a `Z`-suffixed evening timestamp cannot roll the day
   forward" (`weichert/README.md:70-76`) — i.e. we treat them as date-only
   because we cannot know the zone.
3. **"Unset" is `0001-01-01T00:00:00`**, not null (`weichert/README.md:50-54`).
   Every date leaf in the published mapping carries
   `"$map": {"0001-01-01T00:00:00": null}` with a deliberate absence of
   `default`, "since a `$map` miss falls back to `default` when declared and would
   null every real date too."

Record-level time: `OrderDate` (creation) and `ModifiedDate` (last touch) — both
flagged best-effort (`pegii-order.dto.ts:17-18`). `ModifiedDate` is a row
timestamp, not a domain event time; in the 0029 bug it was the one field that
populated while every identity field was a placeholder
(`sdk-feedback/0029:29-30`).

**Identity.** pegII carries **two ids that must never be conflated**, and the
distinction is the best-documented fact about this source:

- `Id` — pegII's internal sale id (`490317`). **Ours.**
- `InvolvedParties.ShipperEmployer.Identity.Description` — the customer's service
  order number (`O-198870`). **Theirs.** "This one is load-bearing: it is both
  the body field and the **URL path parameter**, so getting it wrong means
  POSTing to a resource Weichert does not have. Mapping it from `Id` produced a
  live `404 "The resource specified has no entity"` on 2026-08-12"
  (`weichert/README.md:34-42`).

Our own projection exposes both as `id` and `orderNumber`
(`services/pegii-orders.ts:29-39`), deriving `SO-<id>` when the order number is
missing (`pegii-order.mapper.ts:75-77`). Further identifiers: the salesman `code`
(join key), plus `avlCode`, `branch`, `agencyCode` on the salesman record
(`pegii-salesman.dto.ts:22-38`). No SCAC, no BOL/PRO, no registration number in
any evidence.

**Evidence and provenance: effectively none.** Nothing in the observed shape
records who asserted a value, when it was asserted, or from what document.
Corrections are field overwrites — there is no revision, no supersession, no
reversal. The two weak signals that exist are (a) the sentinel, which
distinguishes "never set" from "set", and (b) `UnusedFields.survey_received` /
`survey_confirm`, whose names imply a received-vs-confirmed distinction on the
survey that no one has decoded (`sdk-feedback/0028:26-28`).

The one provenance lesson this source *did* teach is negative and worth keeping:
a projection that silently substituted placeholders returned `id: "undefined"`,
`orderNumber: "SO-undefined"`, epoch timestamps **as a 200**, so "a caller can't
tell a real order from a missing one" (`sdk-feedback/0029:15-37`). The fix was to
make unresolvability loud — "a payload with no real `Id` yields `null`, not a
placeholder record" → 404 (`pegii-order.mapper.ts:13-17`).

## Scores

Scored on the evidence available, not on what pegII might contain. Grade B does
not cap C2/C3 under the rubric, but pegII supplies almost no definitions of its
own, which is why those columns are low.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 2 | 1 | 1 | 1 | 1 | 2 | 0 | 1 | One free-form `Survey.SerivceStatus` (`pegii-order.dto.ts:41-43`) plus `OrderDate`/`ModifiedDate` (`:58-61`). C2=1: no value domain is published; the only enumeration is our own synonym table, which defaults unknown values to `booked` (`pegii-order.mapper.ts:40-56`). C3=1: no transitions, no actor, no status history — and the status is current state, not an assertion (`weichert/README.md:220-224`). C7=0. C8=1: `UnusedFields` is an accidental extension point (`sdk-feedback/0028:26-28`) and the contract is unversioned — `KeyMoveDates` was re-serialized under us ("The newly-keyed `KeyMoveDates` serialization", `sdk-feedback/0040:57`). |
| A2 Shipment structure | 1 | 0 | 0 | 0 | n/a | 1 | 0 | 1 | Weights exist (`Financials.{Estimated,Actual}Weight`) and a `Survey.ShipmentStatus` code exists with **no legend** (`weichert/README.md:106-109`). **A Sale has no shipment sub-entity in any evidence** — every mapping treats the order root as the single shipment (`transform/demo-partner.transform.ts:6-8`; `workflow.py:436-440`). No shipment type (HHG / vehicle / storage / PPM), no services-ordered list ⇒ C1=1, C4=0. |
| A3 Trip, stop & assignment | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **Absent from the evidence.** The only adjacent traces are `LocalDispatchUniqueInfo` date windows (`weichert/README.md:83-84`) and `UnusedFields.truck_name` (`sdk-feedback/0028:95`) — a field name, nothing more. Trip planning belongs to `src:pegii-longhaul`; whether a Sale references a trip at all is an open question. |
| A4 Execution events & tracking | 2 | 1 | 0 | 2 | 2 | 1 | 0 | 1 | C1=2: four keyed milestones with actuals (`Survey`, `Pack`, `Load`, `DelResidence`, `sdk-feedback/0040:60-70`) — but milestone **dates**, never events; no arrive/depart, ETA, exception or delay. C4=2: survey / pack / load / delivery-to-residence is the HHG milestone spine, and load-without-pack is observable in it (`weichert/README.md:226-231`). C5=2: `{Planned, Earliest, Latest, Actual}` per milestone is a plan + window + actual model — docked for naive timezone-less strings, the `0001-01-01` sentinel, and the same actual stored in three places with no declared master (`weichert/README.md:86-91`). C2=1: milestone keys are undefined; `DelResidence` has to be read as "delivery to residence". C7=0: no actor, no evidence link, corrections are overwrites. |
| A5 Storage-in-transit | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | Storage exists only as **three surveyed charges** — `Survey.Storage1stDay`, `StorageAdditionalDays`, `StorageOut` (`weichert/mapping.json:96-107`) — which is the SIT rate structure (C4=1) with no dates, no duration, no warehouse, no in/out. `WarehouseSummary` is a top-level root whose **contents were never seen** (`sdk-feedback/0029:41-42`) and is the single most likely place SIT lives: **unknown, not absent.** |
| A6 Documents & evidence | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | `DocumentationDates` is a **positional, unlabeled array** — "indices 0, 2, 4, 5, 8 on 490317 … with no legend" (`weichert/README.md:93-95`) — so pegII records *when* documents happened without saying *which*. Documents themselves surface only as rendered PDFs from a separate report endpoint (`pegii-report.dto.ts:24-30`). No document record, no metadata, nothing linking a document to an event ⇒ C4=0, C7=0. |
| A7 Charges & billing hooks | 2 | 1 | 0 | 2 | 0 | 0 | 0 | 1 | `Survey.CoreCost` (core transport) + six add-on components (`weichert/mapping.json:96-119`). C2=1 / C4=2 on one hard-won distinction, evidenced live: CoreCost `10590.87` against `970` of add-ons on 490317 — "the six components summed to 970 against a real total of 10590.87, missing 90.8% of the cost. CoreCost is core transport; the six are add-ons; they do not overlap" (`weichert/README.md:144-151`). No invoice, no charge event, no line-haul/accessorial split by name, no dates on money ⇒ C3/C5=0. `SettlementUniqueInfo` / `CommissionUniqueInfo` exist but only their date leaves were seen. |
| A8 Parties & roles | 1 | 0 | 0 | 1 | n/a | 2 | 0 | 1 | Only **two** party slots are evidenced: `ShipperEmployer` (which actually carries the order number, not a party) and `Coordinator` (`transform/demo-partner.transform.ts:15-21`); the customer appears as a display string, `Survey.ShipperName`. C6=2 for the real cross-reference: `Coordinator.Identity.Code` joins to a Salesman record carrying `branch`, `agencyCode`, `roles`, `employeeType` (`pegii-salesman.dto.ts:20-47`; `workflow.py:227-234`) — the only party *record* in the evidence. C4=1: an agency/branch code hints at agent structure. **The `InvolvedParties` root certainly has more keys than the two we read** — see Open questions. |
| A9 Identity & cross-references | 2 | 2 | n/a | 1 | n/a | 2 | 0 | 1 | C2=2 for the sharpest documented distinction in the source: `Id` (ours) vs `InvolvedParties.ShipperEmployer.Identity.Description` (theirs), with a live `404` proving the consequence of conflating them (`weichert/README.md:34-42`; `workflow.py:386-393`). Plus the salesman `code` / `avlCode` / `agencyCode` chain. C4=1: no SCAC, BOL/PRO, or registration number anywhere. C7=0: no correction semantics on a reference. |
| A10 Survey, estimating & inventory *(context-map only)* | 2 | 1 | 0 | 2 | 2 | 0 | 0 | 1 | Recorded because pegII is the richest survey source we have: a whole `Survey` root (costs + three comment fields + status), `KeyMoveDates.Survey.{Planned,Actual}` as a first-class milestone, and `UnusedFields.{survey_received, survey_confirm}` (`sdk-feedback/0028:26-28`). Confirmed **absent** on 490317: any `SurveyResults` root (`weichert/README.md:144-146`). No estimate typing, no inventory items in any evidence. |

**S5 — fit to Pegasus data (pegII column).** This source *is* the S5 answer for
pegII; Cloud is `unknown` throughout and belongs to its own entry.

| Area | pegII can supply? | Note |
| --- | --- | --- |
| A1 | **partial** | A current status string, an order date and a modified date. No transitions, no actor, no history, no cancellation reason. Only two fields (`Survey.SerivceStatus`, `Survey.ShipmentStatus`) are even writable by us, and the write endpoint does not exist yet (`sdk-feedback/0044`; `workflow.py:547-551`). |
| A2 | **partial** | Weights yes. Shipment-as-entity **no** — one Sale is one shipment by construction. Shipment type unknown. `Survey.ShipmentStatus` exists but is an undecodable code. |
| A3 | **no** (from this record) | Nothing. Trips are `src:pegii-longhaul`; whether a Sale even references one is unknown. |
| A4 | **partial** | Milestone dates yes, and with a plan + window + actual. Discrete events, ETA, exceptions, telemetry: no. |
| A5 | **unknown** | Costs yes, dates no — but `WarehouseSummary` is unread, so this is genuinely unknown rather than negative. **Highest-value unknown in the list.** |
| A6 | **partial** | *When* a document event happened (positional array, no legend) and a rendered PDF on request. Not *which* document, not as a record. |
| A7 | **partial** | An estimate-side cost breakdown (core + six add-ons). No invoice, no actual billing, no charge events. |
| A8 | **partial** | Two party slots read, a joinable salesman record, a shipper name string. The agent-role taxonomy (booking / origin / hauling / destination) is **unknown, probably present** under `InvolvedParties`. |
| A9 | **yes** | Both sides of the identity pair are native and stable, and the failure mode of conflating them is documented. |
| A10 | **partial** | The survey block is real and rich on the cost side; inventory is absent. |
| A13 | **unknown** | `SettlementUniqueInfo` and `CommissionUniqueInfo` are real roots; only their date leaves have been seen. |

## Strengths worth adopting

1. **The four-tense milestone object.** `{Planned, Earliest, Latest, Actual}` per
   keyed milestone (`sdk-feedback/0040:60-70`) is a better time model than
   anything downstream of it, and it is what the rubric's C5 asks for: a plan, a
   window, and an actual, per milestone, distinguishable. The reference model
   should keep all four; our canonical shape currently keeps two.
2. **Keyed, not positional.** The reason `KeyMoveDates` beat the alternatives —
   "it is the only one that is keyed (not positional), carries the `Planned` half
   … and covers every milestone including the survey" (`weichert/README.md:86-91`)
   — is the general lesson. `DocumentationDates`, the positional array, is the
   counter-example and is still unreadable a year later.
3. **`DelResidence` as a milestone name.** Delivery-to-*residence* implies the
   existence of sibling delivery milestones (SIT delivery-out, delivery to
   storage). That naming is a real HHG distinction and a hint the model should
   chase down (see Open questions).
4. **Core cost vs add-on costs as separate quantities.** The 490317 audit
   (`weichert/README.md:144-151`) is the evidence that a total and its
   accessorials must be separately representable — a model that only sums
   components loses 90% of the money.
5. **An explicit "unset" marker.** The `0001-01-01T00:00:00` sentinel is ugly but
   it distinguishes *never set* from *set to nothing* — a distinction the
   canonical shape has to reconstruct. The model should have a first-class way to
   say "not yet known".
6. **Fail loud on an unresolvable projection.** "a payload with no resolvable
   `Id` yields `null`, not a placeholder record" → 404
   (`pegii-order.mapper.ts:13-17`). The 0029 incident is the argument for never
   letting a mapping substitute defaults for identity.

## Weaknesses / traps

1. **The shape is only partly known, and our own DTO is wrong in at least one
   place.** `pegii-order.dto.ts:56` declares `KeyMoveDates.Delivery`, and the
   built-in example mapping reads `KeyMoveDates.Delivery.Actual`
   (`transform/demo-partner.transform.ts:39`) — but the **production** mapping
   reads `KeyMoveDates.DelResidence` (`weichert/mapping.json:82`, `:89`), and the
   real payload quoted in `sdk-feedback/0040:60-70` shows `DelResidence`, with no
   `Delivery` key. Anything reading delivery through the DTO gets `null`. **Do
   not treat `pegii-order.dto.ts` as the native contract** — it says so itself
   ("⚠️ PROVISIONAL", `:10`).
2. **Our status projection invents a vocabulary and hides failure.**
   `mapStatus` collapses a free-form string to three values and **defaults every
   unrecognized value to `booked`** (`pegii-order.mapper.ts:40-56`). An unknown
   pegII status is therefore indistinguishable from a booked order. Do not read
   `booked | in_progress | completed` as pegII's lifecycle — it is ours.
3. **`InvolvedParties.Coordinator.EmailAddress` is not a pegII field.** It is
   grafted on by a workflow before mapping (`workflow.py:243-246`). Anything in
   our corpus or mapping that reads it is reading enriched, not native, data —
   including `weichert/corpus.json`, whose cases all carry it.
4. **The corpus fixtures are synthetic.** `__corpus__/demo_partner/*.json` and
   most of `weichert/corpus.json` are hand-authored in the native *shape* with
   invented values (`SHIP-1`, `O-60232`, `noreply@demopartner.example`). Only
   case 21 claims real provenance ("real 490317"), and even that one carries an
   enriched email and an `O-100003` order number. **A fixture is not a sample.**
5. **Three copies of every actual date, no declared master**
   (`weichert/README.md:86-91`). Any model that ingests pegII must pick one and
   record why; if they ever disagree, nothing in pegII says which is right.
6. **`UnusedFields` is a real part of the contract.** A junk drawer holding
   `survey_received`, `survey_confirm`, `truck_name`, "dispatch/labor dates"
   (`sdk-feedback/0028:26-28`) means **domain data lives outside the modeled
   shape**. Any completeness claim about a pegII order is false until that root
   is inventoried.
7. **Timezone-less timestamps.** Every date is naive wall-clock
   (`sdk-feedback/0029:19-23`). There is no safe way to turn one into an instant,
   which is why the mapping refuses to try (`weichert/README.md:70-76`). The
   model must decide whether a milestone is a *local date at a stop* — pegII
   cannot tell us.
8. **Read-only, so the model cannot yet round-trip.** No order write endpoint
   exists (`workflow.py:547-551`; `sdk-feedback/0044`). Any catalog event that
   implies pegII state change is currently aspirational.
9. **Nothing about a Sale is evidently versioned.** The serialization changed
   under us at least once (`KeyMoveDates` was re-keyed, `sdk-feedback/0040:57`)
   with no version marker to detect it by.

## Out-of-v1 material

- **A10 — survey & estimating.** `Survey` is the richest block in the record:
  status, shipper name, `CoreCost`, six surveyed component costs, three comment
  fields (`NotIncludedComments`, `OtherCostComments`, `GeneralComments`)
  (`weichert/mapping.json:96-122`), a `Survey` milestone with `Planned` and
  `Actual` halves (`sdk-feedback/0040:60-70`), and
  `UnusedFields.{survey_received, survey_confirm}` — names implying a
  received-vs-confirmed survey distinction no one has decoded
  (`sdk-feedback/0028:26-28`). Confirmed absent on 490317: any `SurveyResults`
  root (`weichert/README.md:144-146`). **No inventory items anywhere**, and no
  binding / non-binding / not-to-exceed estimate typing.
- **A11 — claims & valuation.** Nothing observed. Not evidence of absence: the
  root inventory is incomplete.
- **A12 — rating & tariffs.** Nothing observed. Costs appear as flat surveyed
  amounts with no tariff, rate or accessorial-code reference.
- **A13 — crew, driver & settlement.** Two dedicated roots exist —
  `SettlementUniqueInfo` and `CommissionUniqueInfo` — and both were seen to carry
  `Actual{Pack,Load,Deliver}Date` (`sdk-feedback/0029:122-123`;
  `weichert/README.md:88-90`). **Their actual settlement/commission fields have
  never been read.** A third, `LocalDispatchUniqueInfo`, carries dispatch date
  windows. The salesman record adds `branch`, `agencyCode`, `roles`,
  `employeeType`, `startDate`, `dateTerminated` (`pegii-salesman.dto.ts:20-47`).
  Together these are the pegII side of A13 and are almost entirely unexplored.
- **Warehouse operations.** `WarehouseSummary` — a root, a name, nothing else.

## Open questions

These are the **request to the user**, in priority order. Every one is a thing
the evidence cannot answer and a reader of a native order could answer in
minutes.

1. **A complete native order, sanitized.** Ideally three, as the registry already
   asks: a local move, a long-haul with SIT, and a cancelled one. Everything
   below follows from having one. (Registry `obtain:` note already proposes
   `get_order(shape="native")` on the `nw` profile into a gitignored `local/`.)
2. **The full top-level key set of a Sale.** Eleven roots are named here; the
   phrase "a large tail of legacy fields" (`sdk-feedback/0028:26-28`) says there
   are many more.
3. **`WarehouseSummary` — what is in it?** This is the A5 question. If SIT
   in/out dates, warehouse identity and storage duration live anywhere in pegII,
   this is where.
4. **`InvolvedParties` — the complete role list.** Is there a booking agent,
   origin agent, hauling agent, destination agent, van line, driver, crew, or
   warehouse party? Only `ShipperEmployer` and `Coordinator` have ever been read.
   This is the A8 question and probably the second most valuable answer.
5. **`KeyMoveDates` — the complete milestone key list.** `Survey`, `Pack`,
   `Load`, `DelResidence` are known. Is there a storage-in, storage-out, second
   pack/load/delivery, or reweigh key? And **is the delivery key `DelResidence`
   or `Delivery`?** Our DTO and the built-in mapping say one thing, production
   says the other (see Traps #1).
6. **`DocumentationDates` — the legend.** Which document is at each index? "That
   array holds several real dates (indices 0, 2, 4, 5, 8 on 490317) with no
   legend" (`weichert/README.md:93-95`). Decoding this converts a positional
   array into the A6 document-evidence backbone.
7. **`Survey.ShipmentStatus` — the code legend.** Currently mapped to `null`
   because "Atlas's `ShipmentStatus` code has no supplied legend"
   (`weichert/README.md:106-109`). Given the tenants are Allied and Atlas agents,
   this is likely a van-line code set.
8. **`Survey.SerivceStatus` — the full value domain**, and whether pegII records
   *when* and *by whom* a status changed (an audit table, a history row,
   anything). This decides whether the catalog can publish real transition events
   or only state snapshots.
9. **`SettlementUniqueInfo`, `CommissionUniqueInfo`, `LocalDispatchUniqueInfo` —
   full field sets.** The A13 and A3 questions.
10. **`UnusedFields` — an inventory.** What is actually parked there? It is known
    to contain survey and dispatch/labor dates, i.e. domain data.
11. **Can a Sale ever be more than one shipment?** Every mapping assumes not
    (`workflow.py:436-440`). If a booked order can carry a vehicle shipment or a
    separate storage shipment, the whole A2 model changes.
12. **What zone are the naive timestamps in** — the agent's local time, the
    server's, or the origin stop's? And **which of the three copies of an actual
    date is the master?**
13. **Does a Sale reference a trip, a driver, or a truck at all?**
    `UnusedFields.truck_name` is the only hint. If not, A3 for pegII is answered
    by `src:pegii-longhaul` alone.
14. **Inventory, valuation and claims — do roots for them exist?** Absent from
    what we have read, which is not the same as absent.
