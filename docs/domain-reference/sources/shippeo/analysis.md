---
source: src:shippeo
analyzed: 2026-09-17
evidence_grade: B
material: >
  All paths below are relative to `sources/shippeo/local/`. Retrieved 2026-09-17 by an
  earlier run of this workflow (killed mid-flight; **no `capture-log.tsv` rows were written
  for this source** — see Open questions).

  Portal catalogue: `shippeo-apis.json` (21,099 B, sha256 329ead67d9c6…),
  `shippeo-apis-p2.json` (21,125 B, sha256 61f1108439c4…), `shippeo-apis-p3.json`
  (14,862 B, sha256 e4fa21ee04ec…) — three pages of
  `https://api.apim.core.prod.shippeo.com/portal/environments/DEFAULT/apis`, the public
  API listing behind https://developers.shippeo.com .

  Read **in full**: `event-list-order-level.md` (4,186 B, sha256 d54215d61776…; the 41-row
  published event table) and its byte-identical twin `portal-pages/event-codes-intermodal-order.md`;
  `portal-pages/event-codes-handling-unit.md` (sha256 0c48aa60553a…; 19-row HU table);
  `portal-pages/intermodal-terminal-events.md`; `portal-pages/events-in-road-order.home.md`;
  `portal-pages/events-out-road-order.home.md`; `portal-pages/pod-in.home.md`;
  `portal-pages/3._Send_a_standard_event…HU_level.md`.

  Read **exhaustively but programmatically** (every schema, every `enum`, every
  `description`, extracted and tabulated rather than read as prose):
  `portal-pages/2._Send_a_standard_event_milestone_on_order_level_Road_Events-in___Send_standard_milestone_events.json`
  (sha256 21b6757e0edc…; 101 enums, 89 schemas);
  `portal-pages/events-out-road-order.swagger.json` (91,238 B, sha256 47e53adc2d41…);
  `portal-pages/events-in-road-order.swagger.json` (sha256 4b0014a43e61…);
  `portal-pages/3._Send_a_standard_event…Event_message_at_HU_level.json` (sha256 9f9d5b025f15…);
  `portal-pages/3._Receive_standard_events_milestones_for_Intermodal_Shipments__Event-out_road_at_order_level.json`
  (422,085 B; 627 schemas); `portal-pages/events-in-real-quantities.swagger.json`.

  **Not read:** the orders-in family (`…Full_Orders-in_message_swagger.json`, FTL/FVL/parcel/
  rail/ocean/air variants, `Orders-In_SAP_BN4L_Shipment__Swagger.json`) beyond schema names —
  so A2/A3/A8 below are scored thin and flagged; `events-in-tour-bulk.swagger.json` and
  `events-out-handling-unit.swagger.json` beyond enum extraction; the Get Fleet, eta-in,
  order-cancellation and OAuth pages; and — the significant gap — the **two master code
  spreadsheets** Shippeo publishes as the authority
  (`docs.google.com/spreadsheets/d/1MgnU_GoIB4lFllakKisEdNtSfgtvpCV7Ir_2kB2M1Bc` for events-in,
  `…/1EwuiPnjSbadKylf4Fwjs-OM30mtsghssWlp13rddEVQ` for events-out), cited from
  `events-in-road-order.home.md:24` and `events-out-road-order.home.md:13`. Those sheets are
  the labelled list; six situation codes present in the OpenAPI carry **no label anywhere in
  the material we hold** (see Vocabulary).

  Grade **B** overall — machine specs and published tables, no narrative spec, no live traffic
  samples, no access to the master lists. For **A4 specifically the reading is complete**
  against everything captured.
---

# Shippeo APIs — analysis

## What it is

Shippeo is a European real-time transport visibility platform (RTTVP). Shippers push
transport orders in; carriers, telematics feeds and Shippeo's own geofencing push
*events* against those orders; Shippeo pushes normalised events back out to whoever
subscribes. **S1 kind: `vendor-api`.** **S3 openness: `public`** — the developer portal
serves OpenAPI documents and documentation pages without registration (the catalogue
marks each API `"public": true`, `shippeo-apis.json` passim); only the two master code
spreadsheets sit behind links we did not follow. **S2 adoption: 2** — dominant in its
niche (EU FTL/FCL shipper-side visibility, heavy automotive and CPG), essentially absent
from North American household goods; the vocabulary underneath it is not Shippeo's own
but **Inovert**, a French road-transport EDI code set, which Shippeo names explicitly
(`event-codes-handling-unit.md:2` heads its columns "Inovert code").

Our reading covered the **event surface end to end** — events-in on order level, events-in
on handling-unit level, events-in real quantities, events-out on order level, the
intermodal terminal extension, POD-in — plus the two published code tables. It did not
cover orders-in, tours, or fleet.

**Why this source was fetched:** A4's exception/reason vocabulary. On that specific
question Shippeo is the best-shaped public source in the corpus. It is **not** the first
usable one — `stedi-x12-reference/analysis.md:402` already scores X12 214's 42 status ×
86 reason codes at C1=3/C2=3 for A4, and `project44/analysis.md:389` scores a ~90-type
event vocabulary with an exception subsystem at C1=3. What Shippeo adds that neither has
is a **published, closed, two-dimensional exception grid** in which the same reason is
reused across different outcomes, plus an explicit statement of **which events a machine
may assert**.

## Model summary

```
Shipment ──< Order (transport order; the unit an event attaches to)
              │
              ├─ loading_site   (exactly one)
              ├─ delivery_site  (exactly one)
              ├─ handling_units (0..n; the item grain)
              └─ events (1 per request)
                    ├─ situation            = { situation_code, justification_code,
                    │                           date, input_date, event }
                    └─ situation_justification
                                            = { platform_type, trigger{actor,type},
                                                comment, position, new_slot, photos,
                                                real_quantity, attributes }
Tour ──< Order   (a tour groups orders; `tour.edi_reference`, `tour.driver_tracking_link`)
```

The load-bearing idea is the **event code pair**. Shippeo does not have "statuses" and a
separate "exception" object. Every milestone *and* every exception is the same shape:

> "The event (milestone) is indicated by a pair of event codes i.e. the situation code and
> the justification code."
> — `portal-pages/3._Send_a_standard_event…HU_level.md:23`; same sentence at
> `events-in-road-order.home.md:9` and `events-out-road-order.home.md:13`.

- The **situation** says *where in the lifecycle you are, and with what outcome*:
  `ECH` Pick-up completed vs `ENE` Pick-up **not** completed; `LIV` Delivery completed vs
  `REN` **Not** delivered.
- The **justification** says *why*: `CFM` Conform, `MQP` Partially missing package,
  `DAF` Consignee closed or absent, `AVA` Damage, `TAR` Carrier arrived too late.
- The **event name** (`ORDER_NOT_DELIVERED_ABSENT`) is a human-readable alias for the pair,
  not a third axis.

That factorisation is the whole value of this source for A4. A reason is not welded to an
outcome: `MQP` "partially missing package" appears under **four** different situations —
`ECH/MQP` (loaded anyway, short), `ENE/MQP` (not loaded because short), `LIV/MQP`
(**delivered** anyway, short), `REN/MQP` (**refused** because short). Four operationally
different things, one reason code, no combinatorial code explosion.

## Vocabulary

### Situation codes (the outcome axis)

| Term | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `EPC` | Booking completed | A1 | `event-list-order-level.md:3-4` |
| `COM` | Resource selected (truck, trailer, vessel, container…) | A3 | ibid. `:5` |
| `EML` | Pick-up started | A4 | ibid. `:6-7` |
| `ECH` | Pick-up **completed** | A4 | ibid. `:8-11`; `event-codes-handling-unit.md:4` |
| `ENE` | Pick-up **not** completed | A4 | ibid. `:12-16` |
| `MLV` | Delivery in progress | A4 | ibid. `:17,19` |
| `AEC` | Driving | A4 | ibid. `:18` |
| `LIV` | Delivery **completed** | A4 | ibid. `:20-24` |
| `REN` | **Not** delivered | A4 | ibid. `:25-37` |
| `POD` | Proof of Delivery | A6 | ibid. `:38` |
| `ETA` | ETA | A4 | ibid. `:39-40` |
| `DCH` | Arrival at terminal (intermodal) | A4 | `intermodal-terminal-events.md`, field table |
| `CHG` | Departure from terminal (intermodal) | A4 | ibid. |
| `PCH`, `EXP`, `SOL`, `DIF`, `EDI`, `GES` | **no published label** — present as `enum`-of-one schemas (`SharedEventsSharedInovertSituationCode{Pch,Exp,Sol,Dif,Edi,Ges}`, `events-out-road-order.swagger.json`) and used in live oneOf branches (e.g. `ECH`/`EXP` alternatives on `CON_LOAD`, `LIV`/`PCH`/`SOL` alternatives on `GOODS_DELIVERED_NOT_CONFORM`), but absent from every published table we hold | A4 | see Open questions |

### Justification codes (the reason axis)

| Term | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `CFM` | Conform / accepted | A4 | `event-codes-handling-unit.md:4`; `event-list-order-level.md:3` |
| `NCF` | Not conform (not justified) | A4 | `event-codes-handling-unit.md:5` |
| `NJU` | Not justified (by carrier) | A4 | ibid. `:6,12`; `event-list-order-level.md:13` |
| `DIV` | Not justified by consignor / by consignee (party-attributed) | A4 | ibid. `:7,10,13`; `event-list-order-level.md:14,21,27` |
| `MQP` | **Partially** missing package | A4 | `event-list-order-level.md:10,15,22,29` |
| `MQT` | **Entirely** missing package | A4 | ibid. `:16,30`; `event-codes-handling-unit.md:8,21` |
| `RCA` | Not conform (damage) — accepted with damage | A4/A11 | ibid. `:23`; `event-codes-handling-unit.md:11` |
| `AVA` | Damage — refused for damage | A4/A11 | ibid. `:28`; `event-codes-handling-unit.md:20` |
| `TAR` | Carrier arrived too late / Delayed | A4 | ibid. `:18,31`; `event-codes-handling-unit.md:22` |
| `DAF` | Consignee closed or absent | A4 | ibid. `:33`; `event-codes-handling-unit.md:15` |
| `DEM` | Consignee **changed** address | A4 | ibid. `:34`; `event-codes-handling-unit.md:16` |
| `LNA` | **Deliver to** new address | A4 | ibid. `:37`; `event-codes-handling-unit.md:19` |
| `AVI` | Notice of delivery left to consignee | A4/A6 | ibid. `:32`; `event-codes-handling-unit.md:14` |
| `FCO` | Closed for holidays or inventory | A4 | ibid. `:35`; `event-codes-handling-unit.md:17` |
| `FHB` | Weekly closing times | A4 | ibid. `:36`; `event-codes-handling-unit.md:18` |
| `NRV` | New appointment | A4 | ibid. `:12,25` |
| `ARS` | Arrival of transport mean | A4 | ibid. `:7,19` |
| `DES` | Departure of transport mean (left site) | A4 | ibid. `:11,24` |
| `CEX`, `MQD`, `RGT` | **no published label** — `CEX` and `MQP` are the two alternatives under `EXP` on `GOODS_LOADED_NOT_CONFORM`; `MQD` is the sole justification under situation `SOL`; `RGT` the alternative to `CFM` under `PCH` on `CON_UNLOAD` | A4 | `…Send_standard_milestone_events.json`, `SharedEventsGoodsLoadedNotConform`, `SharedEventsGoodsDeliveredNotConform`, `SharedEventsConUnload` |
| `DIL`, `CO2` | `DIL` unlabelled; `CO2` is the carbon-emission event's justification | — | `events-out-road-order.swagger.json`, `SharedEventsSharedInovertJustificationCode{Dil,Co2}` |

### Structural / provenance vocabulary

| Term | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `situation.date` | "The datetime at which the event **happened**" | A4/C5 | `…Send_standard_milestone_events.json`, `SharedSituationDates` |
| `situation.input_date` | "The datetime at which the event was **recorded**. Example: The driver recorded at 3.30pm (input_date) that he delivered the goods at 3pm (date)" | A4/C5 | ibid. |
| `date_transmission` | Transmission date (third clock) | A4/C5 | `intermodal-terminal-events.md`, field table; `OrderBaseEvent` |
| `trigger.type` | `manual` \| `geofencing` — **required** on every outbound standard event | A4/C7 | `events-out-road-order.swagger.json`, `OrderSituationJustificationTrigger` (`required: [actor, type]`) |
| `trigger.actor` | the stakeholder who asserted it; `relation` ∈ `own-fleet` \| `subcontractor` \| `owner` | A8/C7 | ibid., `SharedStakeholderActor` |
| `platform_type` | "Origin of the new status": `web` \| `mobile` \| `telematics` \| `email` \| `tms` — **required** | A4/C7 | ibid., `OrderSituationJustificationPlatformType` |
| `photos[].url_type` | `0` Api-Attachment, `2` Mobile-**Signature**, `3` Mobile-**POD**, `4` Mobile-**Conformity picture**, `5` Mobile-**Non-conformity picture**, `6` Web-Attachment | A6/C7 | ibid., `OrderPodEvent` |
| `new_slot` | `{start, end}`; **required** on appointment events | A4/C5 | ibid., `OrderAppointmentEvent`, `SharedTrackingSlot` |
| `tracking_confidence` | `index` ∈ `BAD`\|`MEDIUM`\|`GOOD` plus a **required** free-text `cause` | A4/C7 | ibid., `SharedTrackingTrackingConfidence` |
| `real_quantity` | `{quantity, type, custom_type}`; `type` ∈ `PX`\|`PD`\|`PE`\|`PC`\|`NA` | A2/A4 | `events-in-real-quantities.swagger.json`, `SharedSituationJustificationRealQuantityBase` |
| Handling Unit (HU) | "a representation of goods associated with a Transport Order… A Handling Unit can be linked to **multiple** transport orders" | A2 | `3._Send_a_standard_event…HU_level.md:9` |
| `handlingUnit.id.qualifier` | `trackingCode` (this HU) \| `consolidationId` (**all** HUs sharing the reference) \| `shippeoId` | A9 | ibid. `:36-39` |
| Smart Reference Matching | canonicalises a reference by "removing all special characters… and removing leading zeros" so `00AB C-D*E` matches `A-B-C-D-E` | A9/C6 | `events-in-road-order.home.md:70-79` |
| `attributes` | free `{string: string}` map on every situation_justification | C8 | `OrderSituationJustificationBaseSituationJustification` |

## Lifecycles & events

### The full order-level vocabulary

**38 data rows** — built from **18 distinct justification codes across 10 situation codes** —
published as a table with situation label, situation code, justification label, justification code,
and a geofence flag: `event-list-order-level.md` in full (40 lines, one header, one separator).
*(Counted from the committed file. An earlier revision of this analysis said "41 rows"; the
correction is arithmetic and changes no finding — the factorisation argument below is the same
argument at 18 justification codes as at "twenty-odd".)* Grouped by situation:

- **`EPC` Booking** — `ORDER_CONFIRMED` (CFM), `ORDER_IS_REFUSED` (NCF).
- **`COM` Resource** — `ORDER_IS_PAIR` (CFM).
- **`EML` Pick-up started** — `DRIVING_TO_LOAD` (CFM), `ARR_LOAD` (ARS).
- **`ECH` Pick-up completed** — `CON_LOAD` (CFM), `GOODS_LOADED_NOT_CONFORM` (NCF),
  `ORDER_LOADED_NOT_CONFORM_PARTIALLY_MISSING` (MQP), `LEFT_LOADING_SITE` (DES).
- **`ENE` Pick-up NOT completed** — `APPOINTMENT_LOAD_TAKEN` (NRV), `REFUSED_LOAD` (NJU),
  `LOADING_REFUSED_BY_SHIPPER_VARIOUS_REASON` (DIV),
  `ORDER_NOT_LOADED_PARTIALLY_MISSING` (MQP), `ORDER_NOT_LOADED_ENTIRELY_MISSING` (MQT).
- **`MLV`/`AEC` in transit** — `DRIVING_TO_UNLOAD` (CFM), `UNLOADING_POSTPONED` (TAR),
  `ARR_UNLOAD` (ARS).
- **`LIV` Delivery completed** — `CON_UNLOAD` (CFM), `GOODS_DELIVERED_NOT_CONFORM` (DIV),
  `ORDER_DELIVERED_NOT_CONFORM_PARTIALLY_MISSING` (MQP),
  `ORDER_DELIVERED_NOT_CONFORM_DAMAGE` (RCA), `DRIVER_LEFT_UNLOAD` (DES).
- **`REN` NOT delivered** — 12 rows, the richest cell in the grid:
  `APPOINTMENT_UNLOAD_TAKEN` (NRV), `REFUSED_UNLOAD` (NJU),
  `DELIVERY_REFUSED_BY_SHIPPER_VARIOUS_REASON` (DIV),
  `ORDER_DELIVERY_REFUSED_DAMAGE` (AVA), `ORDER_DELIVERY_REFUSED_PARTIALLY_MISSING` (MQP),
  `ORDER_NOT_DELIVERED_ENTIRELY_MISSING` (MQT), `ORDER_DELIVERY_REFUSED_LATE` (TAR),
  `ORDER_NOT_DELIVERED_NOTICE` (AVI), `ORDER_NOT_DELIVERED_ABSENT` (DAF),
  `ORDER_NOT_DELIVERED_ADDRESS_OBSOLETE` (DEM),
  `ORDER_NOT_DELIVERED_CLOSED_HOLIDAYS_INVENTORY` (FCO),
  `ORDER_NOT_DELIVERED_CLOSING_HOURS` (FHB), `ORDER_NOT_DELIVERED_NEW_ADDRESS` (LNA).
- **`POD`/`ETA`** — `POD_ADDED` (CFM), `ETA_EVENT`, `ETA_EVENT_EXTERNAL` ("Carrier provided
  with their own ETA" — a *separate event* from Shippeo's own calculated ETA).

The OpenAPI carries **four exceptions the published table omits**, each a schema titled
with its event name in
`…Send_standard_milestone_events.json` and again in `events-out-road-order.swagger.json`:

- `ORDER_NOT_DELIVERED_NO_ACCESS_TO_SITE`
- `ORDER_NOT_DELIVERED_RECEIVER_CANT_PAY`
- `ORDER_NOT_DELIVERED_RESOURCE_INCIDENT`
- `ORDER_NOT_DELIVERED_MISSING_RETURNABLE`

and the events-out side adds lifecycle/administrative events absent from the table:
`ORDER_CREATED`, `ORDER_MODIFIED`, `ORDER_PENDING`, `ORDER_UNFINISHED`,
`ORDER_IS_UNCHARTERED`, `CANCEL_ORDER`, `LOADING_POSTPONED`,
`DELAY_DRIVING_TOWARD_SITE_{LOAD,UNLOAD}` (declared) and
`CALCULATED_DELAY_DRIVING_TOWARD_SITE_{LOAD,UNLOAD}` (derived), plus
`ORDER_RESOURCE_{ENTERED,LEFT}_MICRO_GEOFENCE`.

The first three of those four undocumented exceptions are precisely the HHG-relevant ones.
**The published table is not the vocabulary; the OpenAPI is larger than the documentation.**

### The same vocabulary at handling-unit grain

`event-codes-handling-unit.md` republishes 19 of the same (situation, justification) pairs
under `HANDLING_UNIT_*` names — `HANDLING_UNIT_NOT_DELIVERED_ABSENT` is `REN/DAF`, exactly
as `ORDER_NOT_DELIVERED_ABSENT` is. The exception vocabulary is **grain-independent**: the
same reason applies to the whole order or to one unit of goods, and the code does not
change. Up to 50 HU events per call; a HU may be created on the fly at event time
(`handlingUnit.createIfNotExists`), and addressing by `consolidationId` applies one event
to every unit sharing that reference
(`3._Send_a_standard_event…HU_level.md:15-21,36-39`).

### Who may cause an event — the geofence rule

`event-list-order-level.md` carries a final column, "Based on geofence?". **Exactly seven
of the 38 data rows are marked `Yes`:**

`ARR_LOAD`, `CON_LOAD`, `LEFT_LOADING_SITE`, `ARR_UNLOAD`, `CON_UNLOAD`,
`DRIVER_LEFT_UNLOAD`, `ETA_EVENT` (`:7, :8, :11, :19, :20, :24, :39`).

Everything else is blank. **25 of the 38 rows carry a justification other than `CFM`, `ARS` or
`DES`, and not one of those 25 is geofence-marked.** *(Earlier revisions wrote "7 of 41" and "the 24
exception rows"; both were inherited approximations. The finding is unchanged, and it is stronger
stated exactly: the geofence-eligible seven and the twenty-five non-conform rows are disjoint sets.)*
The rule the table encodes, and the one worth taking:

> A machine may assert *where the vehicle is* and *that an ETA changed*. It may never
> assert *why something went wrong*. Every exception requires a human declaration.

This is reinforced structurally on the way out: `trigger.type` ∈ `{manual, geofencing}` is
**required** on every standard events-out message, alongside a required `platform_type`
naming the channel (`OrderSituationJustificationStandardSituationJustification`,
`required: [platform_type, trigger]`). A consumer can therefore always tell a geofence
crossing from a person's assertion without consulting a side table.

Two caveats, both real:

1. **`CON_LOAD` and `CON_UNLOAD` are marked geofence-eligible.** Those are *conformity*
   assertions — "goods were loaded conform", "goods were delivered with no observations".
   A geofence can witness a departure; it cannot witness that nothing was missing or
   damaged. Shippeo is letting a geofence crossing imply a clean outcome. That is a
   convenience, and adopting it would silently manufacture evidence.
2. **There is a third trigger kind the enum cannot express.** `DRIVING_TO_LOAD` "can be
   declarative (by the carrier) **or Shippeo triggered 1 hour before the beginning of the
   pickup start slot**" (`event-list-order-level.md:6`; same for `DRIVING_TO_UNLOAD` at
   `:17`), and `CALCULATED_DELAY_DRIVING_TOWARD_SITE_*` is derived by Shippeo from position.
   Those are **schedule-derived and computation-derived** events — neither `manual` nor
   `geofencing`. They must be reported as one of two values, neither of which is true.

### Transitions, invariants, corrections

- **Invariant, stated:** "You can only send **one event per one order** per request"
  (`events-in-road-order.home.md:8`); "Per request you will always receive just one event"
  (`events-out-road-order.home.md:11`).
- **Invariant, implied:** a situation code never travels without a justification code —
  every schema in the events-in `oneOf` requires both. (The same rule X12 214 enforces
  syntactically; see `stedi-x12-reference/analysis.md:141`.)
- **No transition graph.** Nothing states that `ENE` must precede `ECH`, that `REN` and
  `LIV` are mutually exclusive on one order, or that an order may carry two `REN` events
  and then an `LIV`.
- **No reversal, no correction, no purpose code.** There is no way to retract an event
  asserted in error. The only remedy is to assert a later event. `input_date` lets you say
  *when* you recorded something, not *that the earlier record was wrong*. This is the same
  gap flagged against the 214 (`stedi-x12-reference/analysis.md:402`, "no purpose code…
  so a status cannot be retracted") and the opposite of EPCIS, which has explicit
  retraction semantics (`gs1-epcis-cbv/analysis.md:520`).

## Time, identity, evidence

**Time.** Three clocks, cleanly named and separately carried: `situation.date` (occurrence),
`situation.input_date` (recording), `date_transmission` (transmission). The published
worked example is unusually good — "The driver recorded at 3.30pm (input_date) that he
delivered the goods at 3pm (date)". Windows are `{start, end}` slots with only `end`
required. Estimates are events in their own right and are **provenance-typed**: `ETA_EVENT`
(Shippeo's own calculation) vs `ETA_EVENT_EXTERNAL` ("Carrier provided with their own ETA")
are different codes, so a consumer never has to guess whose ETA it is. ETA events carry
`theoretical_distance` (remaining metres) and the position they were computed from. All
datetimes are ISO 8601 with offset. **There is no separate "time zone of the stop" field** —
the offset on the instant is all you get.

**Identity.** An order is addressable four ways and the docs are explicit about when to use
which: `order.edi_reference` (Shippeo's internal id, surfaced in orders-out as reference
qualifier `ZZ`), `order.external_reference` (the shared reference, for when no orders-out
flow exists), `client_reference`, and the qualifier-tagged reference list `DQ` / `ZZ` /
`UCN` (`events-in-road-order.home.md:36-67`). Handling units are addressed by
`trackingCode`, `shippeoId`, or `consolidationId` — the third being a **deliberate
fan-out** address, not an identifier. Sites carry `UNLOCODE` or `ZZ` qualifiers.
**Smart Reference Matching** (`:70-79`) is the standout: rather than demanding exact
reference equality, the platform canonicalises both sides (strip special characters, strip
leading zeros) and matches the canonical forms. That is a deliberate, published,
worked-example-backed answer to the real-world problem that two systems never spell the
same reference the same way — the exact problem A9 exists to solve.

**Evidence.** Photos are typed by *role*, not by MIME type: signature, POD, conformity
picture, **non-conformity picture**, attachment (`OrderPodEvent.photos[].url_type`). A
distinct picture kind for the thing that went wrong is a small idea with a lot of leverage.
POD may be attached as a file or a URL, max 15 MB, addressed by either order reference
(`pod-in.home.md:7-14`). The eCMR (consignment note) view goes further and publishes a
field-by-field **data-source table** — for each field displayed on the consignment note,
where the value came from (orders-in payload vs mobile app vs Shippeo-generated), including
"actual arrival & departure time **(if geofenced or informed by driver)**" and driver /
consignor signature, comment and signature location (`events-out-road-order.home.md:57-69`).
That is provenance published as a first-class artifact.

**Confidence.** `tracking_confidence` = `{index: BAD|MEDIUM|GOOD, cause: string}`, with
`cause` **required**. A quality verdict that is not allowed to be bare.

## Scores

Weights for A4 (the area this source was fetched for) are proposed in phase 3; this
analysis assumes A4 weights **C2, C7 and C3** heavily, per the rubric's note that A4
weights C5/C7.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 2 | 1 | 1 | 0 | 1 | 2 | 2 | 1 | `ORDER_CREATED/PENDING/CONFIRMED/IS_REFUSED/MODIFIED/IS_UNCHARTERED/UNFINISHED/CANCEL_ORDER` exist as codes (`events-out-road-order.swagger.json`, `SharedEventsOrderStandard*`) plus the `EPC` accept/refuse pair (`event-list-order-level.md:3-4`). C2=1: six of those eight appear **only** as schema titles with no definition anywhere in the material. C3=1: no transitions, no statement of who may confirm or cancel. C4=0: no offer/award, no estimate, no survey — nothing between "order exists" and "truck is driving". C7=2 on `trigger`+`platform_type`. |
| A2 Shipment structure | 1 | 2 | n/a | 0 | n/a | 2 | 1 | 2 | Shipment→orders→handling units is real and the HU definition is good ("can be linked to **multiple** transport orders", `3._Send…HU_level.md:9`). C1=1 and heavily caveated: **we did not read the orders-in schemas**, so weights, services-ordered and shipment typing are unassessed, not absent. C2=2 for the HU/order distinction and the `consolidationId` fan-out. Packaging typing is `PX/PD/PE/PC/NA` — europallet, pallet, other pallet, parcel, N/A (ibid. `:66-72`). C4=0: no HHG shipment kinds. C8=2 on `custom_type`. |
| A3 Trip, stop & assignment | 1 | 2 | 0 | 0 | 2 | 2 | 2 | 1 | A "tour" groups orders and carries its own reference and driver tracking link (`OrderBaseEvent.tour`); `ORDER_IS_PAIR` (`COM/CFM`) is resource assignment; micro-geofence sites are modelled (`SharedTrackingMicroGeofenceSite`). C1=1: **an order has exactly two sites** — `loading_site` and `delivery_site`, both optional on output and gated behind a `showAdress` option. There is no stop sequence, no leg, no n-stop journey at order level. C3=0: nothing about assignment transitions. |
| **A4 Execution events & tracking** | **3** | **3** | **2** | **0** | **3** | **3** | **2** | **2** | **The area this source wins, and the reason to keep it.** C1=3: milestones, exceptions, ETA (own vs external), declared *and* calculated delay, appointments, POD, positions, micro-geofence, carbon — `event-list-order-level.md` (38 data rows) + `events-out-road-order.swagger.json` (~24 standard + 22 conformity events). C2=3 for the **(situation, justification) factorisation** and the distinctions it buys: `LIV/MQP` delivered-but-short vs `REN/MQP` refused-for-short vs `ENE/MQP` not-loaded-for-short (`event-list-order-level.md:10,15,22,29`); `RCA` damage-accepted vs `AVA` damage-refused (`:23,28`); `DEM` their-address-was-wrong vs `LNA` deliver-it-somewhere-else (`:34,37`); `NJU` carrier's fault vs `DIV` counterparty's fault (`:13,14,26,27`). Deduction noted but not applied: six situation codes carry no label anywhere (`PCH`,`EXP`,`SOL`,`DIF`,`EDI`,`GES`). C3=2, **not 3**: real invariants exist (one event per order per request, `events-in-road-order.home.md:8`; situation never without justification) **and a genuine who-may-cause rule** (the geofence-eligibility column, 7 of 38 rows; required `trigger.type`), but there is **no transition graph, no state invariant, and no retraction**. C5=3: `date`/`input_date`/`date_transmission`, slots, own-ETA vs carrier-ETA as distinct codes, `theoretical_distance`, `tracking_confidence{index,cause}`. C6=3: four order addressing modes, qualifier-tagged references, HU `trackingCode`/`consolidationId`, Smart Reference Matching (`events-in-road-order.home.md:70-79`). C7=2: `platform_type` + `trigger{actor,type}` both **required**, role-typed photos, free `comment` — but **no correction or reversal semantics at all**, which is what holds this off 3. C4=0: entirely generic freight; no agent role, no SIT, no pack phase, no survey, no reweigh. |
| A5 Storage-in-transit | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent. The nearest thing is `DCH`/`CHG` terminal arrival/departure for intermodal (`intermodal-terminal-events.md`), which is a transshipment point, not storage: no duration, no in/out pair, no delivery-out leg, no warehouse-as-stop. |
| A6 Documents & evidence | 2 | 2 | 1 | 0 | 1 | 2 | 3 | 1 | POD-in as file or URL (`pod-in.home.md`); `POD_ADDED` as an event; role-typed photos incl. a dedicated non-conformity picture; eCMR with dual-site signature capture. C7=3 on the published **data-source table** for every eCMR field (`events-out-road-order.home.md:57-69`) — source of each fact stated per field, including whether a time was geofenced or driver-declared. C1=2: POD and consignment note only; no order-for-service, estimate, inventory or weight ticket. |
| A7 Charges & billing hooks | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent. Carbon-emission events (`OrderSituationJustificationCarbonCarbon`, fuel type / engine type / emission `DEFAULT`\|`MODELED`\|`PRIMARY`) are reporting, not charging. |
| A8 Parties & roles | 1 | 2 | n/a | 0 | n/a | 2 | 2 | 1 | Organization / agency / carrier / owner, with `SharedStakeholderActor.relation` ∈ `own-fleet`\|`subcontractor`\|`owner` — a genuine three-way distinction for who is actually driving. Consignor and consignee exist only **inside justification labels** ("Not justified by consignor", "Consignee closed or absent"), not as modelled parties in the event payload. C4=0: no booking/origin/hauling/destination agent, no van line, no crew. Caveat: orders-in unread. |
| A9 Identity & cross-references | 3 | 2 | n/a | 1 | n/a | 3 | 2 | 2 | See C6 under A4. The strongest non-A4 showing: four order addressing modes, qualifier-tagged reference lists (`DQ`/`ZZ`/`UCN`), HU addressing by tracking code vs consolidation, place `UNLOCODE`/`ZZ`, vessel `IMO`/`MMSI`, and **Smart Reference Matching** as a published canonicalisation rule. C4=1 only because `consolidationId` happens to match how HHG groups items, not by intent. |
| A10–A13 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Nothing on survey/estimating, claims/valuation, tariffs, or crew settlement. `RCA`/`AVA` damage codes are a claims *trigger*, not a claims model. |

*S5 (fit to Pegasus data) withdrawn per rubric note of 2026-09-17; not scored.*

## The judgement that matters: which exceptions transfer to a household-goods move

The task this source was fetched to answer. Each row is a judgement about the *concept*,
not the code string.

### Transfers directly — adopt the concept, rename the code

| Shippeo | HHG reading | Why it transfers |
| --- | --- | --- |
| `REN/DAF` `ORDER_NOT_DELIVERED_ABSENT` — "Consignee closed or absent" | **Customer not home** | The single most common HHG delivery failure. One-for-one. |
| `ORDER_NOT_DELIVERED_NO_ACCESS_TO_SITE` (OpenAPI only) | **Access denied** — building/gate/elevator/COI | The only source in the corpus with a named "couldn't get to the site" exception. HHG needs sub-reasons Shippeo lacks (see gaps). |
| `REN/LNA` `…NEW_ADDRESS` — "Deliver to new address" | **Diversion requested** | A customer redirecting a delivery mid-move is routine and **charge-bearing**. Shippeo's separation of this from `DEM` is the valuable part. |
| `REN/DEM` `…ADDRESS_OBSOLETE` — "Consignee changed address" | **Address on file is wrong** | A data defect, not a customer request. Different owner, different remedy, different billing. Keep the two apart. |
| `REN/NRV` `APPOINTMENT_UNLOAD_TAKEN` + required `new_slot` | **Rescheduled delivery** | The exception carries its own remedy. HHG delivery attempts almost always end in a new appointment; making the new window part of the exception event is exactly right. |
| `REN/TAR` `…REFUSED_LATE` — "Carrier arrived too late" | **Crew missed the window** | Customer had a closing, a flight, a building elevator reservation. Attribution matters for the waiting-time charge. |
| `REN/AVA` vs `LIV/RCA` — damage refused vs damage accepted | **Refused items vs delivered-with-exception** | The HHG claims hook. Whether the shipper took the damaged item changes the claim, not just the note. |
| `REN/MQP` vs `LIV/MQP` — refused-short vs **delivered**-short | **Partial delivery** | The most important single import. HHG "partial delivery" is normally a *completed* delivery with a shortage (items still on the van, going to SIT, or missing), **not** a failure. Only Shippeo models "completed with exception" as a first-class outcome. |
| `ENE/MQP` / `ENE/MQT` `ORDER_NOT_LOADED_*_MISSING` | **Goods not ready** (partial / total) | Near-transfer. Shippeo means "the packages weren't there"; HHG means "the customer hasn't finished packing". Same shape, needs its own label. |
| `ORDER_NOT_DELIVERED_RECEIVER_CANT_PAY` (OpenAPI only) | **C.O.D. not collected** | Transfers *better* to HHG than to EU FTL. A van operator who will not unload until the customer pays is standard HHG practice; this is a named exception for it. |
| `ORDER_NOT_DELIVERED_RESOURCE_INCIDENT` (OpenAPI only) | **Equipment failure** | Van breakdown, lift-gate failure. Direct. |
| `AEC/TAR` `UNLOADING_POSTPONED` / `LOADING_POSTPONED` | **Carrier-initiated postponement** | Distinct from a customer-caused failure; attribution again. |
| `ENE/NJU` vs `ENE/DIV` — "not justified by carrier" vs "by consignor" | **Fault attribution on the reason itself** | Lightweight version of X12 214's responsible-party organisation of its 86 reason codes (`stedi-x12-reference/analysis.md:267,377`). Cheap and load-bearing for who pays. |

### Freight-only — do not import

| Shippeo | Why it does not transfer |
| --- | --- |
| `REN/FHB` "Weekly closing times", `REN/FCO` "Closed for holidays or inventory" | Presume a commercial consignee with posted opening hours and an annual stock-take. A residence has neither. **But the shape survives**: HHG's equivalents are building move-in windows, elevator reservations and HOA quiet hours. Re-label, don't drop. |
| `ORDER_NOT_DELIVERED_MISSING_RETURNABLE` | Returnable pallets and roll-cages. No HHG analogue. |
| `REN/AVI` "Notice of delivery left to consignee" | Door-tag semantics. HHG re-contacts by phone; a card on the door is not the artifact. Marginal. |
| `CON_LOAD`/`CON_UNLOAD` as a **binary** conformity flag | HHG conformity is never one bit. It is per-item, against a signed inventory with pre-existing-damage codes. Import the *grain* (HU-level events), not the flag. |
| `PX`/`PD`/`PE`/`PC` packaging types | Europallets. HHG's unit is the inventory-tagged carton or article. |
| `real_quantity` = a count of handling units | HHG reconciles **pieces and weight** (and, on an interstate move, a reweigh). A count alone cannot express an HHG shortage. |
| `DCH`/`CHG` terminal arrive/depart | Intermodal only. |
| The `EXP`/`PCH`/`SOL` situation branches | Unlabelled; cannot be judged, therefore cannot be imported. |

### Named in the task, absent from Shippeo — the authoring gap

The task asked which of *customer not home, access or elevator denied, goods not ready,
partial delivery, refused items, shuttle required, long carry* transfer. Six of those seven
have a Shippeo antecedent above. **Shuttle required and long carry do not, and neither does
anything like them.** Nor do these, which an HHG A4 vocabulary will have to author from
nothing because no source in the corpus supplies them:

- **Shuttle required** — the residence is unreachable by a tractor-trailer. This is not a
  failure at all; it is a *charge-bearing execution variant* that happens mid-service.
  Shippeo's grid has no cell for "we completed it, differently, and it costs more".
- **Long carry / stair carry / elevator unavailable** — same category: accessorial-generating
  conditions discovered on site.
- **Parking permit not obtained / no parking**.
- **COI (certificate of insurance) not on file with the building** — an *administrative*
  blocker discovered at the door.
- **Overflow — won't fit the van** — the nearest analogue anywhere in the two sources
  fetched is MacroPoint's `x028 Delivery vehicle capacity limitation`
  (see `macropoint/analysis.md`).
- **Destination not ready → goods go to SIT.** The deepest structural gap. In freight an
  exception is a *retry*. In HHG this exception starts **a whole new phase** — storage in
  transit, with its own in/out events, duration, charges and a later delivery-out leg (A5).
  Shippeo, MacroPoint, and every freight vocabulary in the corpus model exceptions as
  "something to resolve", never as "something that forks the shipment".
- **Third-party service not performed** (appliance disconnect, crating, piano specialist).
- **Weight exceeds estimate / reweigh required.**
- **No pack-phase events at all.** Shippeo's lifecycle starts at `DRIVING_TO_LOAD`. HHG has
  survey, pack day(s), load day — and exceptions at each. There is no `PACKING_STARTED`,
  no `PACKING_NOT_COMPLETED`, nothing.

## Strengths worth adopting

1. **Factor the exception into (outcome, reason), not one flat enum.** The situation says
   where you got to; the justification says why. Reasons are reused across outcomes.
   Twenty-odd reasons × five outcomes covers what a flat list would need a hundred codes
   for, and it makes "delivered short" and "refused for short" *the same reason, different
   outcome* — which is how an operator actually thinks.
2. **Make "completed with exception" a first-class outcome.** `LIV` (delivery completed)
   carries `MQP`, `RCA`, `DIV` alongside `CFM`. Partial and damaged deliveries are
   completions, not failures. MacroPoint cannot express this; X12 214 handles it via a
   separate lading-exception segment. For HHG — where most deliveries have *some*
   exception — this must be in the core shape.
3. **The same reason vocabulary at two grains.** Order-level and handling-unit-level events
   share codes verbatim (`event-codes-handling-unit.md` vs `event-list-order-level.md`).
   HHG needs exactly this: "shipment delivered, two items refused" is one order-level
   completion plus two item-level exceptions, in one vocabulary.
4. **Publish, per event, whether a machine may assert it.** Seven of 38 geofence-eligible;
   zero exceptions among them. Make it a property of the event type, not a runtime guess.
5. **Carry the trigger on every event, and make it required.** `trigger.type` +
   `trigger.actor` + `platform_type`. A consumer can always separate a geofence crossing
   from a driver's tap from a TMS batch import. Extend the enum past `manual|geofencing` —
   Shippeo already emits schedule-derived and computed events it cannot label (see below).
6. **Three clocks, named and separate.** occurrence / recording / transmission, with a
   worked example. This is the cheapest thing on the list and the most often skipped.
7. **Provenance-type the estimate.** `ETA_EVENT` vs `ETA_EVENT_EXTERNAL` as distinct codes —
   whose ETA it is, without a side field.
8. **Type evidence by role, and give the failure its own type.** Signature / POD /
   conformity picture / **non-conformity picture**. The photo of the gouged tabletop is a
   different kind of thing from the signed delivery receipt.
9. **Let the exception carry its remedy.** `new_slot` is *required* on appointment events.
   A failed delivery that doesn't say when it will be retried is an incomplete record.
10. **Confidence with a mandatory cause.** `{index: BAD|MEDIUM|GOOD, cause: required}`.
11. **Smart Reference Matching.** Canonicalise before matching, publish the rule, give a
    worked example. Directly usable for A9.
12. **Publish a per-field data-source table for anything you put on a document.**
    (`events-out-road-order.home.md:57-69`.) This is provenance as a deliverable.

## Weaknesses / traps

1. **No retraction, no correction, no purpose code.** An event asserted in error can only be
   superseded, never withdrawn. For HHG — where a driver taps "delivered" on the wrong
   shipment and it has to come back off — this is disqualifying on its own. Take the grid;
   do not take the append-only-with-no-eraser model. EPCIS is the counter-example
   (`gs1-epcis-cbv/analysis.md:520`).
2. **No transition graph and no state invariants.** Nothing forbids `LIV` after `REN`,
   two `ECH` events, or a delivery before a pickup. The situation codes *look* like states
   and are not governed like states.
3. **The documentation is smaller than the API.** Four exceptions — including the three most
   HHG-relevant (`NO_ACCESS_TO_SITE`, `RECEIVER_CANT_PAY`, `RESOURCE_INCIDENT`) — exist only
   as OpenAPI schema titles. Six situation codes (`PCH`, `EXP`, `SOL`, `DIF`, `EDI`, `GES`)
   and three justification codes (`CEX`, `MQD`, `RGT`) appear in live `oneOf` branches with
   **no label published anywhere we can read**. Anyone integrating from the published tables
   will receive codes they cannot interpret.
4. **A verifiable defect in the published spec.** In
   `events-out-road-order.swagger.json`, `SharedEventsOrderConformityOrderNotLoadedPartiallyMissing`
   declares `event: "ORDER_NOT_LOADED_ENTIRELY_MISSING"` — the *entirely*-missing name on the
   *partially*-missing schema. Two distinct exceptions collapse to one string on the wire.
   Concrete evidence for why the event name must be an alias for the code pair and never the
   identity: the pair (`ENE/MQP` vs `ENE/MQT`) stays correct in both schemas even where the
   name is wrong.
5. **`trigger.type` has two values and the system produces at least four kinds of event.**
   Declarative, geofence-derived, **schedule-derived** (`DRIVING_TO_LOAD` auto-fired one hour
   before the pickup slot, `event-list-order-level.md:6`), and **computation-derived**
   (`CALCULATED_DELAY_DRIVING_TOWARD_SITE_*`). Two of the four have to lie. Do not copy a
   two-valued trigger enum.
6. **Geofence-derived conformity.** `CON_LOAD`/`CON_UNLOAD` are geofence-eligible. Treating
   a departure as proof that nothing was missing manufactures evidence. Under our own
   read-vs-mutation discipline this is the kind of inference that must stay a human
   assertion.
7. **An order has exactly one pickup and one delivery.** HHG moves have pack day, load day,
   an origin-agent leg, possibly SIT, and a delivery — sometimes to two addresses. Shippeo's
   order shape cannot hold that; its "tour" groups orders but the *exception* attaches to the
   order. Take the vocabulary, not the container.
8. **`DIV` is overloaded.** `event-list-order-level.md` glosses it as "Not justified by
   consignor" at `:14`, "Not conform (not justified)" at `:21`, and "Not justified by
   consignee" at `:27` — three meanings, one code, depending on situation. The reason axis is
   not as orthogonal as the model claims.
9. **Zero HHG fidelity.** No agent roles, no SIT, no survey, no valuation, no inventory, no
   reweigh, no pack phase. This source is raw material for a reason vocabulary, and nothing
   else. It must not be allowed to shape the lifecycle.
10. **`consolidationId` fans out silently.** One event addressed by consolidation reference
    applies to every handling unit sharing it. Powerful, and an excellent way to mark 200
    inventory items delivered by accident.

## Out-of-v1 material

- **A11 (claims & valuation):** the `RCA` (accepted-with-damage) / `AVA` (refused-for-damage)
  split is a claims trigger with the accept/refuse decision already recorded, and
  `url_type: 5` "Mobile — Non conformity picture" is the evidence attached to it. Worth
  revisiting when A11 is modelled.
- **A13 (crew/driver):** `SharedStakeholderActor.relation` ∈ `own-fleet` | `subcontractor` |
  `owner`, and `tour.driver_tracking_link` gated on a `showDriverTrackingLink` option.
- **Carbon:** a full emission-reporting event (`OrderSituationJustificationCarbonCarbon`)
  with fuel type, engine Euro class, resource type, and emission provenance `DEFAULT` /
  `MODELED` / `PRIMARY`. Out of scope entirely, but that three-value provenance enum on a
  *computed number* is a pattern worth remembering.
- **Ocean/rail/air vocabularies** (`OceanMilestoneUpdatedEvent.situation.event`, ~20 container
  milestones incl. customs hold/release and free-time expiry) — relevant only if
  international HHG enters scope.

## Open questions

1. **The six unlabelled situation codes** (`PCH`, `EXP`, `SOL`, `DIF`, `EDI`, `GES`) and three
   unlabelled justification codes (`CEX`, `MQD`, `RGT`). They are in live `oneOf` branches —
   `EXP` is an alternative to `ECH` on `CON_LOAD` and on `GOODS_LOADED_NOT_CONFORM`;
   `PCH` and `SOL` are alternatives to `LIV` on `GOODS_DELIVERED_NOT_CONFORM`; `MQD` is
   `SOL`'s only justification. They are plainly a second dimension of delivery outcome that
   the published table omits. **Resolving them means reading the two master Google Sheets**
   (`…/1MgnU_GoIB4lFllakKisEdNtSfgtvpCV7Ir_2kB2M1Bc`, `…/1EwuiPnjSbadKylf4Fwjs-OM30mtsghssWlp13rddEVQ`)
   or the Inovert code set directly. Cheap follow-up, potentially several more reason codes.
2. **Does Shippeo publish transition rules anywhere?** Nothing in the captured material
   states which situation may follow which. If it exists it is in the portal HTML pages we
   captured as `.md` stubs, not in the OpenAPI.
3. **Is `input_date` ever used to correct?** The example only covers back-dating a fresh
   assertion. Whether a second event with the same `event` code and an earlier `date`
   supersedes or duplicates is unstated — and it determines whether the append-only model is
   survivable.
4. **Orders-in remains unread.** A2, A3 and A8 scores above are floors, not verdicts. If
   those areas matter in phase 3, the orders-in swaggers must be read before comparing this
   source against OTM or SCRDM.
5. **Provenance of the local files.** No `capture-log.tsv` rows exist for `shippeo` (the
   fetching run was killed). The files' retrieval URLs are inferred from filenames and the
   portal catalogue, not recorded. Worth back-filling.
