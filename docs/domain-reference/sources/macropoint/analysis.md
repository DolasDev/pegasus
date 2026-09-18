---
source: src:macropoint
analyzed: 2026-09-17
evidence_grade: B
material: >
  All paths relative to `sources/macropoint/local/`. Retrieved 2026-09-17 by an earlier run
  of this workflow (killed mid-flight; **no `capture-log.tsv` rows were written for this
  source** — see Open questions).

  `mp-shipper-collection.json` (4,642,571 B, sha256 bf8fd1367919…) — the **"Descartes
  MacroPoint Visibility" customer/shipper Postman collection**, whose per-request
  `description` fields carry the integration guide as embedded HTML. Read: the collection
  description; the `API Integration` and `Load Visibility Order Creation` folder
  descriptions; `Create Order`; and — in full — the four data-retrieval callbacks that
  carry the vocabularies (`Trip Events`, `Order Status`, `Schedule Alerts`,
  `Enhanced Shipment Status`), plus `Notification Center Alerts` and the Flat-File
  `Trip Event` / `Order Status` specs.

  `mp-carrier-collection.json` (104,836 B, sha256 76aa3b9a29c2…) — the **"Descartes
  MacroPoint Visibility Carrier Integration"** collection. The `API - JSON` folder read in
  full (`Location Update`, `Location + Temperature Update`, `Event Update`,
  `Tracking Assignment`, `Enhanced Shipment Status`, `Form/Document Upload`), including
  request bodies.

  `macropoint-statuses.pdf` (464,596 B, sha256 ba1a0265d803…; 3 pages) — "An overview of the
  tracking statuses within the Descartes MacroPoint portal", read in full via
  `pdf2txt.py`. Originally sourced from
  `https://cdn2.hubspot.net/hubfs/3839244/Tracking%20Statuses%20vFinal-Updated.pdf`
  (per `registry.yaml:932`).

  **Not read:** the `API - XML` and `Flat File` folders of the carrier collection (the XML
  folder mirrors the JSON one; spot-checked, not read); the ocean / air / rail
  `Create Order` variants; Cold Chain temperature alerts; FraudGuard; Carrier Wishlist /
  Partner Status / Good Truck / Send Message; the `Best Practice Procedures` reference
  folders (IP addresses, time zones, country codes, ocean SCAC, airline prefixes); and the
  documentation sites themselves — `https://docs.macropoint.com/` and
  `https://carrierdocs.macropoint.com/` were **not** fetched in this pass.

  Grade **B**: vendor integration documentation and a portal help PDF, read directly and in
  depth on the vocabulary questions, but no formal schema, no OpenAPI, no samples of live
  traffic, and two documentation sites unvisited.
---

# Descartes MacroPoint — analysis

## What it is

Descartes MacroPoint is a North American **freight visibility network**. A shipper or
broker creates a *tracking session* ("order") against a load; MacroPoint then acquires the
truck's position — from the driver's phone app, from the carrier's telematics, from a
carrier API integration, or from an LTL/parcel/ocean carrier's own status feed — and pushes
locations, events, statuses and ETAs back to the customer by webhook callback or SFTP file.

**S1 kind: `vendor-api`.** **S3 openness: `public`** — the two Postman collections and the
status PDF are published without registration, though `docs.macropoint.com` /
`carrierdocs.macropoint.com` may gate more. **S2 adoption: 3 within North American
truckload visibility** — MacroPoint is one of the two default answers (with project44) when
a US broker asks a carrier for tracking; it is *not* an industry standard in the sense a
code list or reference model is, and it has no presence in household goods.

Our reading covered **both sides of the network** (what a shipper receives, what a carrier
sends) and **all four published code sets**. It did not cover the mode-specific order
creation, the cold-chain and fraud subsystems, or the two documentation sites.

**Why this source was fetched:** the registry records it as *"EDI 214-style status codes
(X3/AF/X1/D1)"* (`registry.yaml:933`). That is **confirmed** — see below — but it is a
small part of what is here, and the codes it names are the *least* useful thing MacroPoint
publishes. The valuable find is a different table entirely: the **LTL/parcel outcome × reason
matrix**, which is the cleanest published example in the corpus of an exception vocabulary
that factors *what happened to the shipment* from *why*.

## Model summary

Two distinct object graphs sit side by side, and keeping them apart is the source's single
best structural idea.

```
 (A) THE SHIPMENT                       (B) THE TRACKING SESSION
     Order (load)                           Order Status  ── codes 1002…1077
       ├─ TripSheet ──< Stop                 "Ready To Track", "Tracking Now",
       │    ├─ StopType PickUp|DropOff        "Requesting App Install",
       │    ├─ SequenceNumber                 "Invalid PRO Number",
       │    ├─ ScheduledStart/EndTime          "Possible Fraud Detected" …
       │    └─ Trip Event  X3|AF|X1|D1
       ├─ Enhanced Shipment Status         ← nothing here is about the freight;
       │    (StatusCode + StatusMessage)     it is about whether we can SEE the freight
       ├─ Schedule Alert  code 0..4
       ├─ Location Update (ping)
       └─ Form/Document Upload (BOL, POD, images)
```

A consumer of MacroPoint always knows whether a silence means "the shipment is stuck" or
"the driver never installed the app". Every other source in the corpus conflates those.

The identity model is likewise doubled: **every message carries both parties' own load
identifiers side by side**, never one canonical id. The carrier posts
`Sender.LoadID` (its own) *and* `Requestor.{MPID, LoadID}` (the customer's MacroPoint
account number and the customer's load id); MacroPoint's callbacks return `MPOrderID`,
`MPTrackingRequestID` and the customer's `ID` together
(`mp-carrier-collection.json`, `API - JSON/Event Update`; `mp-shipper-collection.json`,
`Trip Events`).

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| Tracking session / Order | the unit MacroPoint tracks; created, changed, stopped | A1 | shipper coll., `API Integration` folder desc. |
| Tracking Request | a session where MacroPoint asks a partnered carrier to supply the tracking method; `MPTrackingRequestID` is present only then | A1/A9 | shipper coll., `Trip Events` |
| `TrackVia` | how tracking is acquired: Mobile, VehicleID, TrailerID, ShipmentID (FTL); **LTL PRO**; Container Number (ocean/rail); Air Waybill | A3/A9 | shipper coll., `Create Order` |
| `TripSheet` | "Captures stop details on a load" — **required** on Create Order | A3 | ibid. |
| `StopType` | `PickUp` \| `DropOff` — the only two stop kinds | A3 | carrier coll., `Event Update`; shipper coll., `Schedule Alerts` |
| `SequenceNumber` | "The sequencial order of the stop. Typically used for round trip shipments" | A3 | carrier coll., `Event Update` |
| `Event.Name` (carrier-supplied) | `Arrived` \| `Departed` — **the entire carrier-side event vocabulary** | A4 | carrier coll., `Event Update` |
| Trip Event code (FTL) | `X3` Arrived-Pickup, `AF` Departed-Pickup, `X1` Arrived-DropOff, `D1` Departed-DropOff | A4 | shipper coll., `Trip Events`, "Standard FTL Event Codes" |
| Trip Event code (flat file) | `AR` Arrival, `DP` Departure — **a second, incompatible spelling of the same four events** | A4 | shipper coll., Flat File `Trip Event` |
| `UpdatedBy` | "Method event was captured. Values include: **Customer** (via API or Control Tower), **Carrier** (via integration), **Driver** (via mobile app), **MacroPoint** (via geofence)" | A4/C7 | shipper coll., `Trip Events` |
| `ConfirmationStatus` | result of an **OpsForce AI agent phoning the driver to verify an event**: `Confirmed` \| `Denied` \| `Unconfirmed` (agent unclear) \| `Unknown` (no conversation) \| `Waiting` (driver says he is waiting at the receiver). "Will be blank on initial event." | A4/C7 | ibid. |
| Order Status code | 1002–1077; the **tracking session's** health, not the shipment's state | A4 | shipper coll., `Order Status`; `macropoint-statuses.pdf` |
| `ScheduleAlertCode` | `0` Cannot Determine, `1` On Time or Ahead of Schedule, `2` Behind Schedule, `3` **Cannot Make It**, `4` Past Appointment Time | A4/C5 | shipper coll., `Schedule Alerts` |
| `ScheduleAlertText` | free-text gloss, e.g. "2 Hours Behind" | A4 | ibid. |
| `EtaToStop` / `ETALocalTimeZoneOffset` | ETA in UTC **plus the local offset at the stop** | A4/C5 | ibid. |
| `Type` (Enhanced Shipment Status) | `Estimated` \| `Actual` — future vs historical, on the same message shape | A4/C5 | carrier coll., `Enhanced Shipment Status` |
| `StatusMessageDetail` | **free text**, e.g. "Out for Delivery" — what a carrier actually sends | A4 | ibid. |
| `MacroPointStatusCode` | "MacroPoint code **mapped to** the associated shipment status provided by the carrier. LTL and Parcel tracking only" — returned **alongside** the carrier's raw `StatusCode`/`StatusMessage` | A4/C7 | shipper coll., `Enhanced Shipment Status` |
| LTL/Parcel status codes | `00` Unmapped, `01` Pickup Actual, `03` In Transit, `05` At Customs Clearance, `10` At Consolidation/Transit Hub, `50` Returned from Refusal, `80` Other, `99` Delivered Actual | A4 | ibid. |
| **Exception codes** | `2xxx` **Delay**, `3xxx` **Undeliverable**, `5xxx` **Returning from refusal** — each with the same reason suffix (see next section) | A4 | ibid. |
| `Locator` | "TMS ID, Truck Number, Trailer Number, or Mobile Cell Phone Number" — one field, four meanings | A9 | shipper coll., `Trip Events` |
| Form Upload `Elements[].ID` | document role, e.g. `POD`; "supplied by the MacroPoint team on a customer by customer basis" | A6 | carrier coll., `Form/Document Upload` |

## Lifecycles & events

### 1. The trip-event vocabulary is four codes wide — and that is the whole of it for FTL

| Event Name | Event Code |
| --- | --- |
| Arrived – Pickup | `X3` |
| Departed – Pickup | `AF` |
| Arrived – DropOff | `X1` |
| Departed – DropOff | `D1` |

(`mp-shipper-collection.json`, `Trip Events`, "Standard FTL Event Codes".) These are indeed
**X12 214 element-1650 status codes** — `X3`, `AF`, `X1`, `D1` all appear in the 214's
status vocabulary — so `registry.yaml:933`'s characterisation is confirmed. But the
important observation is what is *missing*: MacroPoint has adopted **four** of the 214's
42 status codes and **none** of its 86 reason codes
(cf. `stedi-x12-reference/analysis.md:402`). There is no arrival-at-terminal, no
loading-vs-loaded distinction, no dock-vs-site, no lading exception, and — for truckload,
the mode structurally closest to an HHG van — **no exception vocabulary whatsoever**.

The carrier-facing API is even narrower: `Event.Name` must be `Arrived` or `Departed`, and
`Stop.StopType` must be `PickUp` or `DropOff` (`mp-carrier-collection.json`,
`API - JSON/Event Update`). A carrier integrating with MacroPoint **cannot report an
exception at all** through the event channel. Its only outlet is `Enhanced Shipment
Status`, whose `StatusMessageDetail` is an unconstrained string.

### 2. The exception vocabulary — outcome × reason, and it is only on the LTL/parcel path

This is the find. `Enhanced Shipment Status` publishes a matrix in which the **thousands
digit is the outcome** and the **last three digits are the reason**, with the reason
suffix reused verbatim across outcomes:

| Reason suffix | Meaning | `2xxx` Delay | `3xxx` Undeliverable | `5xxx` Returning from refusal |
| --- | --- | :-: | :-: | :-: |
| `x000` | Undefined / Other | ● | ● | ● |
| `x011` | Incorrect delivery details | ● | ● | ● |
| `x012` | Consignee not present / closed | ● | ● | ● |
| `x013` | Refused by consignee | ● | ● | ● |
| `x014` | Damaged | — | ● | ● |
| `x015` | Thefts | — | ● | — |
| `x021` | Late acceptance by consignee | ● | ● | — |
| `x022` | Customs | ● | ● | ● |
| `x023` | Request for change of delivery date | ● | ● | — |
| `x024` | Request for appointment | ● | ● | — |
| `x025` | Rework needed: parcel/pallet not sealed or wrapped securely | ● | ● | ● |
| `x026` | Uncontrollable events: weather, strikes, accidents, traffic, road closed | ● | ● | — |
| `x027` | Transit delay: late unloading / misrouted / sorting error / missed connection | ● | ● | ● |
| `x028` | **Delivery vehicle capacity limitation** | ● | — | — |
| `x029` | Late delivery | ● | ● | — |

(`mp-shipper-collection.json`, `Enhanced Shipment Status`, "LTL and Parcel MacroPoint
Shipment Status Message Codes"; 8 base status codes + 15 delay + 15 undeliverable + 7
returning-from-refusal.)

Two things make this worth keeping:

1. **The same reason means the same thing under three different outcomes.** "Consignee not
   present" is `2012` if it delayed us, `3012` if it defeated us, `5012` if we are carrying
   the goods back. The operator's question ("why?") and the planner's question ("what
   happens now?") are answered by different digits of the same code. This is MacroPoint
   arriving independently at Shippeo's (situation, justification) factorisation — see
   `shippeo/analysis.md` — which is strong evidence the factorisation is right rather than
   idiosyncratic.
2. **`50` / `5xxx` "Returned from refusal" is a *third* outcome, not a failure.** Most
   vocabularies stop at delivered / not-delivered. MacroPoint models the goods coming back
   as its own tracked state with its own reasons.

And one thing that is conspicuously absent: **there is no "delivered with exception"
outcome.** `99` is `Delivered Actual`, full stop. A short or damaged delivery that the
consignee nonetheless accepted has no code here. Shippeo has exactly this (`LIV/MQP`,
`LIV/RCA`); MacroPoint does not.

### 3. The tracking-session lifecycle, kept separate from the shipment

Twenty-two codes, published twice (API callback and flat file) and a third time as prose in
the portal PDF. They are all about the *observability* of the load:

`1002` Requesting App Install · `1020` Ready To Track · `1021` Tracking Now ·
`1022` Tracking Completed Successfully · `1050` Stopped By Creator ·
`1053` Location Hidden By Driver · `1060` Tracking – Waiting For Update ·
`1061` Incompatible Phone · `1065/1066` Invalid Truck/Trailer Number ·
`1067` Expired With Location Hidden By Driver · `1068` Driver Phone Unresponsive ·
`1069` Expired With Driver Phone Unresponsive · `1070` Expired Without Installation ·
`1071` Expired Without Location · `1072/1073/1074/1077` Invalid BOL / PRO / Air Waybill /
Container ID · `1075` Carrier not Supported · `1076` **Possible Fraud Detected**.

The PDF adds portal-only states the callback list omits — `Denied by Driver`,
`Refused Installation`, `Requesting Installation` ("used only for Canadian phones, as US and
Mexico require the app"), `Reported Wrong Number`, `Reported Landline`,
`Stopped Early By Driver`, and a four-state **Trip Sheet** lifecycle
(Deployed → In Progress → Completed / Expired) (`macropoint-statuses.pdf`, pp. 1–3).

Note the shape: several codes are an **outcome paired with the reason it expired** —
`1071` expired-without-location vs `1067` expired-with-location-hidden vs `1069`
expired-with-phone-unresponsive. The same outcome × reason instinct, applied to the session.

### 4. Lateness as a verdict, separate from the ETA

`ScheduleAlertCode` ∈ `{0 Cannot Determine, 1 On Time or Ahead of Schedule, 2 Behind
Schedule, 3 Cannot Make It, 4 Past Appointment Time}`, recalculated "with each corresponding
location update" and delivered alongside `EtaToStop`, `DistanceToStopInMiles`,
`ScheduledStart/EndTimeInLocalTimeForStop` and a free-text gloss
(`mp-shipper-collection.json`, `Schedule Alerts`).

Three of those five values are doing real work that a bare ETA cannot:
- `0 Cannot Determine` — **the system is allowed to say it does not know**, rather than
  emitting a fabricated ETA.
- `3 Cannot Make It` — a *verdict about the future*, not a measurement. The appointment is
  already lost; act now. This is the single most operationally useful value in either source.
- `4 Past Appointment Time` — distinguishes "we will be late" from "we already are".

project44 has the comparable idea (`EARLY/ON_TIME/LATE` with a duration,
`project44/analysis.md:389`) but not `Cannot Determine` or `Cannot Make It`.

### 5. Transitions and corrections

- **No transition graph**, for either the shipment or the session. The status lists are flat.
- **No retraction or correction.** Same gap as Shippeo and as X12 214
  (`stedi-x12-reference/analysis.md:402`). The nearest thing is `ConfirmationStatus`
  arriving later on the *same* event — which disputes an event without withdrawing it.
- **One stated invariant:** location updates "will be throttled if sent more frequently than
  5 minutes per LoadID" (`mp-carrier-collection.json`, `Location Update`). A rate limit
  published as part of the data contract, which is at least an honest statement about what
  the position stream is.

## Time, identity, evidence

**Time.** Better than the vocabulary deserves. Three separate ideas are correctly separated:

- *Occurrence vs local rendering*: `EventDateTime` ("Time in ISO8601 and in UTC") travels
  with `ApproxLocationDateTimeInLocalTimeThe date and time that this event occurred in the
  local time zone" (`Trip Events`). The flat-file variant carries an explicit `Time Zone`
  column ("ET").
- *ETA with the stop's offset*: `EtaToStop` (UTC) **plus** `ETALocalTimeZoneOffset`
  ("Local Timezone offset from UTC") — i.e. the offset **at the stop**, which is precisely
  the field the rubric's C5 asks for and which `gs1-epcis-cbv/analysis.md:388` flags as the
  thing systems usually lose.
- *Planned window*: `ScheduledStartTimeInLocalTimeForStop` / `ScheduledEndTimeInLocalTimeForStop`,
  in local time, format `yyyyMMddHHmmss`.
- *Future vs past on one shape*: `Type` ∈ `Estimated` | `Actual` on Enhanced Shipment Status,
  with `EventETA` populated only for the estimated case.

Two defects: the formats are inconsistent (ISO 8601 in the API, `yyyyMMddHHmmss` in schedule
alerts, `YYYY-MM-DD HH:MMLSS` — evidently a typo — in the flat file), and there is **no
record time**: nothing distinguishes when an event happened from when it was reported.
Shippeo's `input_date` has no counterpart here.

**Identity.** The strongest area outside A4. Every message is **bilaterally referenced**:
the carrier's own `Sender.LoadID` and the customer's `Requestor.LoadID` travel together,
scoped by `Requestor.MPID` (which customer is asking), with MacroPoint's own `MPOrderID`
and `MPTrackingRequestID` added on the way back. Modal identifiers are typed by where they
appear — LTL `PRO`, ocean `BOL` and Container Number, air `AWB`, rail container, `SCAC`,
`UnLocode` for terminals — and each has a dedicated *invalidity* status code (`1072`–`1074`,
`1077`), which means the model treats "your reference was wrong" as a first-class outcome
rather than a parse error. `AllowAccessFrom.MPID` on carrier posts is an explicit
**disclosure scope**: the carrier names who is permitted to see this update.

The weak spot is `Locator`, "TMS ID, Truck Number, Trailer Number, or Mobile Cell Phone
Number" — four different kinds of thing in one untyped string, and the consumer is given
no discriminator.

**Evidence and provenance.** Three genuinely good ideas:

1. **`UpdatedBy` on every trip event** — `Customer` (API or Control Tower) / `Carrier`
   (integration) / `Driver` (mobile app) / `MacroPoint` (**via geofence**). The
   machine-vs-human distinction is carried inline on the fact itself, exactly as Shippeo's
   `trigger.type` is, and reached independently. Note it also names *Customer* as an
   asserter — the shipper keying an event in on the carrier's behalf — which Shippeo's
   two-valued enum cannot express.
2. **Raw and normalised side by side.** For LTL/parcel, the callback returns the carrier's
   own `StatusCode` and `StatusMessage` **and** `MacroPointStatusCode`, "MacroPoint code
   mapped to the associated shipment status provided by the carrier", with an explicit
   warning that "the following fields are passed directly from the Carrier and can vary by
   Carrier". The mapping never destroys the original. For a platform that ingests partner
   statuses, this is the correct discipline and it is rare to see it stated.
3. **`ConfirmationStatus` — a second-order assertion about a first-order event.** An AI
   agent telephones the driver to verify an event that has already been recorded, and the
   answer (`Confirmed` / `Denied` / `Unconfirmed` / `Unknown` / `Waiting`) is attached to
   the original event, blank until asked. This is a **verification layer that neither
   asserts nor retracts**: the event stands, its credibility is tracked separately. Given
   that neither source has retraction semantics, this is the most interesting partial answer
   to C7 in either of them. `Waiting` is also a small gem — the verification attempt
   surfaced a *new operational fact* (the driver is sitting at the receiver) that no event
   code existed for.

Documents: `Form/Document Upload` takes BOLs, PODs and "delivery proof images" as base64
with an IANA MIME type, a role `ID` ("supplied by the MacroPoint team on a customer by
customer basis" — i.e. **not a published vocabulary**), and, usefully, an optional
`StopType` + `Event` pair binding the document to the stop and event it evidences.

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 1 | 1 | 0 | 1 | 2 | 1 | 1 | Create / Change / Stop Order — but the object is a **tracking session**, not a service order. No offer, award, accept, decline, estimate or completion of *service*; `1022 Tracking Completed Successfully` is the end of observation, not of the move. C3=1: the 1002–1077 set is a de facto session lifecycle with no transitions published. |
| A2 Shipment structure | 1 | 1 | n/a | 0 | n/a | 2 | 0 | 1 | `TrackVia`, `Mode`, `Vehicle`, and modal identifiers (PRO / container / AWB) imply shipment kinds, but nothing models the shipment: no weights, no services ordered, no pieces, no commodity. C6=2 on the modal identifier typing alone. |
| A3 Trip, stop & assignment | 2 | 2 | 1 | 0 | 3 | 2 | 2 | 1 | `TripSheet` → stops with `StopID`, `SequenceNumber`, `StopType`, per-stop scheduled start/end and per-stop ETA; `HideTripSheet`; a four-state trip-sheet lifecycle in the PDF. C2=2: stop sequence is real and `SequenceNumber` is explicitly for round trips. C1=2 not 3: **exactly two stop kinds** (`PickUp`/`DropOff`), no legs, no consolidation of several shipments on one trip, no crew. C5=3 on the per-stop window + ETA + offset. |
| **A4 Execution events & tracking** | **3** | **2** | **1** | **0** | **3** | **3** | **3** | **1** | C1=3 by breadth: positions, trip events, session statuses, ETAs + a lateness verdict, an exception matrix, temperature, documents, notifications. **C2=2, and the split is the story**: the LTL/parcel matrix is precisely defined and well factored (outcome × reason, 37 exception codes), while **FTL — the mode nearest an HHG van — gets four codes and no exceptions**, and the carrier-facing status channel is an unconstrained string (`StatusMessageDetail`, "Out for Delivery"). The same four events are also spelled two incompatible ways (`X3/AF/X1/D1` in the API, `AR/DP` in the flat file). C3=1: flat lists, no transitions, no invariants beyond a 5-minute throttle, no retraction. C5=3: UTC + local rendering + **offset at the stop**, planned windows, `Estimated`\|`Actual`, and `ScheduleAlertCode` incl. `Cannot Determine` and `Cannot Make It` (`Schedule Alerts`). C6=3: bilateral load ids, `MPOrderID`/`MPTrackingRequestID`, per-mode identifiers each with its own invalidity code. C7=3: `UpdatedBy` naming Customer/Carrier/Driver/geofence on every event; carrier-raw **and** MacroPoint-mapped status returned together; `ConfirmationStatus` as a tracked second-order verification; documents bound to a stop+event. Held at 3 only on the strength of those three; **no correction or retraction exists**. C8=1: extension is by catch-all (`00 Unmapped`, `80 Other`, `x000 Undefined/Other`) plus "additional statuses may be received from carriers" — no version, no registry, no extension point. |
| A5 Storage-in-transit | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent. `10 At Consolidation/Transit Hub` is a waypoint, not storage — no in/out pair, no duration, no delivery-out leg. |
| A6 Documents & evidence | 1 | 1 | n/a | 0 | 1 | 2 | 2 | 0 | `Form/Document Upload` carries BOL / POD / "delivery proof images" as typed binary bound to a stop and event — the binding is the good part. C2=1 and C8=0 because the document role vocabulary is **not published**: element `ID` and `Name` are "supplied by the MacroPoint team on a customer by customer basis". No signature model, no inventory, no weight ticket. |
| A7 Charges & billing hooks | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent entirely. |
| A8 Parties & roles | 1 | 1 | n/a | 0 | n/a | 2 | 2 | 1 | Shipper/broker ("Requestor", "creator"), carrier ("Sender"), driver, consignee (in reason labels only). `AllowAccessFrom` as a disclosure scope and `Partner Status` / `FraudGuard DOT` as carrier-identity checks are the substance. No agent roles, no van line, no crew, no warehouse. |
| A9 Identity & cross-references | 3 | 2 | n/a | 0 | n/a | 3 | 2 | 1 | The bilateral-identifier discipline (`Sender.LoadID` + `Requestor.{MPID, LoadID}` + `MPOrderID` + `MPTrackingRequestID`), modal identifiers typed by mode, and a distinct invalidity status per identifier kind (`1072`–`1077`). C2=2 held down by `Locator` — four identifier kinds in one untyped field. |
| A10–A12 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Nothing. |
| A13 Crew, driver & settlement | 1 | 1 | n/a | 0 | n/a | 1 | 2 | 0 | Only as the driver's *relationship to the tracking mechanism*: consent, app install, opt-out, `Send Message` to a driver, and the OpsForce agent phoning. No scheduling, no compensation, no splits. |

*S5 (fit to Pegasus data) withdrawn per rubric note of 2026-09-17; not scored.*

## The judgement that matters: which exceptions transfer to a household-goods move

Judged against the `2xxx`/`3xxx`/`5xxx` matrix, since the FTL path supplies nothing to judge.

### Transfers — adopt the concept

| MacroPoint reason | HHG reading | Note |
| --- | --- | --- |
| `x012` Consignee not present / closed | **Customer not home** | The most common HHG delivery failure; and MacroPoint gives it across all three outcomes, so "customer wasn't home so we're bringing it back" (`5012`) is expressible. |
| `x013` Refused by consignee | **Refused delivery / refused items** | Transfers, but at shipment grain only — see traps. |
| `x011` Incorrect delivery details | **Bad address / bad contact on file** | MacroPoint's single code conflates what Shippeo splits into `DEM` (our data is wrong) and `LNA` (customer wants it elsewhere). Prefer Shippeo's split. |
| `x014` Damaged | **Damage discovered** | Transfers; the claims trigger. Note it exists only under `3xxx`/`5xxx` — damage never merely *delays*, which is a reasonable modelling call. |
| `x015` Thefts | **Loss / pilferage** | Transfers; rare but must exist. |
| `x021` Late acceptance by consignee | **Customer delayed the crew on site** | Transfers directly and is billable (waiting time). |
| `x023` Request for change of delivery date | **Customer moved the delivery date** | Extremely common in HHG — the delivery spread exists precisely because this happens. |
| `x024` Request for appointment | **Delivery appointment required** | Transfers; in HHG usually a building or HOA requirement. |
| `x025` Rework needed — not sealed / wrapped securely | **Goods not properly prepared** | Transfers in modified form: customer-packed (PBO) cartons unsealed or unlabelled, items not disassembled as agreed. The *concept* — we cannot take it in the state it is in — is exactly right. |
| `x026` Uncontrollable events: weather, strikes, accidents, traffic, road closed | **Force majeure / road conditions** | Transfers verbatim. The one reason where freight and HHG are identical. |
| `x028` **Delivery vehicle capacity limitation** | **Overflow / won't fit / shuttle needed** | The closest thing in **either** source to HHG's shuttle-and-overflow family. Worth taking as the seed even though HHG needs it split three ways (won't fit the van; van can't reach the residence; second trip required). |
| `x029` Late delivery | **Missed the delivery spread** | Transfers; in HHG it has tariff consequences. |
| `50` / `5xxx` Returned from refusal | **Goods returned to warehouse** | Transfers as a *shape*, and in HHG it is the doorway to SIT. See the gap below. |
| `x027` **"misrouted"** (that clause only) | **Items on the wrong van / crossed shipments** | Real in HHG. The rest of `x027` — sorting error, missed connection — is parcel-network machinery. |

### Freight-only — do not import

| MacroPoint | Why not |
| --- | --- |
| `X3` / `AF` / `X1` / `D1` (and `AR`/`DP`) | Not wrong, just inadequate: four events for a whole move. HHG needs survey, pack start/complete, load start/complete, weigh, depart origin, SIT in/out, arrive destination, unload, unpack, debris removal. Take the 214 codes from `stedi-x12-reference` instead, where 42 exist. |
| The entire `1002`–`1077` order-status set | Every one of these is about the *tracking mechanism* — app install, landline, incompatible phone, invalid PRO/AWB/container. Zero of them are domain events. **But see the structural idea below: the separation itself transfers even though not one code does.** |
| `x022` Customs | Domestic HHG: no. International HHG: yes, and then it is A5/A6 territory. |
| `x027` sorting error / missed connection; `x005` At Customs Clearance; `10` At Consolidation/Transit Hub | Parcel and LTL network machinery. HHG line-haul consolidates at an agent's warehouse, which is A5's problem, not a hub-scan. |
| All ocean / rail / air / in-bond codes (`G1`, `LB`, `DP`, `R1`–`R9`, the CBP set) | Out of scope. |
| `1076 Possible Fraud Detected`, FraudGuard | Broker-carrier fraud is a spot-market problem. HHG capacity is agent-network capacity. |
| `Locator` as an untyped string | An anti-pattern to avoid, not a thing to adopt. |

### What MacroPoint proves is missing

- **No "delivered with exception".** `99 Delivered Actual` and nothing else. An HHG delivery
  that is short two items but signed for cannot be represented. Shippeo can (`LIV/MQP`);
  take it from there.
- **No item grain.** Every code applies to the shipment. HHG's "refused items" is
  *per-item*: the sofa is refused, the other 180 pieces are delivered. MacroPoint has no
  handling-unit concept at all; Shippeo does.
- **Shuttle, long carry, stair carry, elevator, parking permit, COI** — absent, as
  everywhere else in the corpus.
- **SIT as the consequence of an exception** — absent. `5xxx` "Returning from refusal" is
  the nearest shape, and it terminates; it does not open a storage phase with its own
  duration, charges and later delivery-out leg.

## Strengths worth adopting

1. **Separate the shipment's state from the *tracking mechanism's* state, and give each its
   own code list.** This is MacroPoint's best idea and nothing else in the corpus has it. In
   our terms: "the driver's app has not checked in since 6am" is a *different kind of fact*
   from "delivery was refused", and conflating them means an operator cannot tell a stuck
   move from a broken integration. Worth a distinct concept in A4.
2. **Factor exception codes as outcome × reason with a stable reason suffix.** Independent
   corroboration of Shippeo's (situation, justification) grid. The numeric encoding is a
   nice touch: `3012 → 5012` is a state change with the reason provably preserved.
3. **`UpdatedBy` — name the asserter inline, including "geofence" as an asserter.** And note
   it includes **Customer**, which Shippeo's `manual|geofencing` cannot express. Our enum
   should cover: crew/driver, dispatcher on the customer's behalf, partner integration,
   geofence, schedule-derived, computed.
4. **Return the partner's raw status *and* your mapping of it, and say which fields came
   straight from the partner.** Never let normalisation destroy the original.
5. **`ConfirmationStatus` — track the credibility of an event separately from the event.**
   Five values including two flavours of "we tried and still don't know". In a domain where
   a crew member taps the wrong button, a verification layer that neither silently
   overwrites nor requires retraction is a genuinely useful third option — and `Waiting`
   shows verification discovering facts the vocabulary lacked.
6. **A lateness verdict distinct from an ETA, with `Cannot Determine` and `Cannot Make It`.**
   Let the system say it does not know, and let it say the appointment is already lost.
7. **A distinct invalidity status per identifier kind** (`Invalid PRO Number`,
   `Invalid Bill Of Lading`, `Invalid Container ID`, `Invalid Truck Number`). "Your reference
   is wrong" is an outcome, not an error response.
8. **Bind the document to the stop and event it evidences.** `Form/Document Upload` carries
   `StopType` + `Event` alongside the file — a POD is evidence *of* the delivery arrival,
   not an attachment on the order.
9. **Publish the throttle as part of the contract.** "Throttled if sent more frequently than
   5 minutes per LoadID" tells the consumer what the position stream is and is not.

## Weaknesses / traps

1. **The rich vocabulary is on the wrong mode.** All 37 exception codes are **LTL and parcel
   only**. Truckload — the mode structurally closest to an HHG van — gets `X3/AF/X1/D1` and
   nothing else. Do not read the matrix as evidence that truckload visibility has solved
   exceptions; it is evidence that *parcel* has, and parcel's reasons are shaped by parcel's
   economics (sorting errors, sealed packaging, hub scans).
2. **The carrier-facing status channel is free text.** `StatusMessageDetail` is a string with
   the example "Out for Delivery". A platform that ingests this is ingesting uncontrolled
   vocabulary and mapping it after the fact. If we expose an inbound partner status surface,
   it must be closed at the edge, not normalised downstream.
3. **The same four events have two incompatible spellings.** `X3/AF/X1/D1` in the API
   callback, `AR/DP` in the flat file — and `AR`/`DP` cannot even distinguish pickup from
   delivery without reading `StopID` against the trip sheet. One vocabulary, two encodings,
   different information content.
4. **No record time.** Occurrence time only. There is no `input_date`, so a back-dated event
   is indistinguishable from a timely one.
5. **No correction, no retraction.** `ConfirmationStatus: Denied` marks an event as disputed
   and leaves it standing. That is better than nothing and it is not a correction model.
6. **Extension by catch-all.** `00 Unmapped`, `80 Other`, `2000/3000/5000 Undefined / Other`,
   and "please note additional statuses may be received from carriers". No version, no
   change log, no request channel — compare SMDG, which publishes a dated per-code change log
   and a code-request address (`smdg-delay-codes/analysis.md:180`). A vocabulary that can
   silently grow is one you cannot write rules against.
7. **`Locator` is four things in one string.** Do not copy.
8. **The document role vocabulary is per-customer and unpublished.** "Supplied by the
   MacroPoint team on a customer by customer basis" means there is no interoperable evidence
   taxonomy here at all.
9. **Zero HHG fidelity.** No agent roles, no SIT, no survey, no inventory, no valuation, no
   crew, no pack phase, no reweigh. Like Shippeo, this is raw material for a reason
   vocabulary and must not be allowed to shape anything else.
10. **Inconsistent datetime formats across three channels** (ISO 8601 / `yyyyMMddHHmmss` /
    `YYYY-MM-DD HH:MMLSS`) — the last evidently a typo in the published spec, which is itself
    a warning about the documentation's precision.

## Out-of-v1 material

- **A11:** `x014 Damaged` / `x015 Thefts` as claim triggers, and `Form/Document Upload`'s
  "delivery proof images" as the evidence attached.
- **A13:** the driver-consent surface — `Denied by Driver`, `Refused Installation`,
  `Location Hidden by Driver`, `Stopped Early By Driver`, `Requesting Installation`
  (Canada-only, app not required) (`macropoint-statuses.pdf`). If HHG crews are ever tracked
  by phone, this is the consent vocabulary someone has already had to build, including the
  legal/regional variation.
- **Cold chain:** temperature thresholds and Cold Chain Temperature Alerts — irrelevant to
  HHG but the same "threshold breach as an event" pattern.
- **FraudGuard** (DOT / phone / load-number lookup) and `Partner Status` / `Good Truck` —
  carrier-identity verification. Out of scope for the domain model; potentially relevant if
  agent-network vetting is ever modelled.
- **`Send Message` / `Order Messaging`** — driver communication as a tracked artifact.

## Open questions

1. **Do `docs.macropoint.com` and `carrierdocs.macropoint.com` publish more than the Postman
   collections?** Not fetched in this pass. Specifically worth checking: whether an FTL
   exception vocabulary exists anywhere (the collections say it does not), and whether the
   document-role vocabulary is published.
2. **Is the LTL/parcel matrix MacroPoint's own, or is it somebody else's standard?** The
   reason wording ("parcel/pallet was not sealed/wrapped securely", "Late acceptance by
   consignee") reads like a translated European parcel-network list rather than native
   MacroPoint English. If it has an upstream owner, that owner is a better source than this
   one — and would likely carry definitions, which MacroPoint does not.
3. **What does `ConfirmationStatus: Denied` mean downstream?** The event stands; is it
   suppressed in the UI, does it block the next event, is it revisited? The doc says only
   what the values are. This matters because it is the corpus's only live example of an
   assertion being disputed without being retracted.
4. **`MacroPointStatusCode` exists "LTL and Parcel tracking only".** So for FTL there is no
   normalisation at all — the customer receives whatever string the carrier sent. Worth
   confirming, because it would mean the free-text problem is the *normal* case for
   truckload.
5. **Provenance of the local files.** No `capture-log.tsv` rows exist for `macropoint` (the
   fetching run was killed). The PDF's URL is recorded in `registry.yaml:932`; the two
   Postman collections' retrieval URLs are not recorded anywhere and should be back-filled.
