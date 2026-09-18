---
source: src:x12-212-trailer-manifest
analyzed: 2026-09-17
evidence_grade: B
material: |
  Read (web, 2026-09-17), all under https://www.stedi.com/edi/x12-004010/ :
    /212            — TS 212 Motor Carrier Delivery Trailer Manifest, full loop/segment
                      table; read twice (second pass verifying loop repeat counts and
                      the explicit absence of S5 / N7)
    /215            — TS 215 Motor Carrier Pick-up Manifest, full loop/segment table
                      (read for contrast — the other X12 "many shipments" document)
    /segment/ATA    — Beginning Segment for Motor Carrier Delivery Trailer Manifest
    /segment/TSD    — Trailer Shipment Details (both elements)
    /segment/MS1    — Equipment, Shipment, or Real Property Location (all 7 elements)
    /segment/MS2    — Equipment or Container Owner and Type (all 4 elements)
    /segment/AT9    — Trailer or Container Dimension and Weight (all 8 elements)
    /segment/AT8    — Shipment Weight, Packaging and Quantity Data (all 7 elements)
    /segment/BLR    — Transportation Carrier Identification (both elements)
    /segment/MAN    — Marks and Numbers (all 6 elements)
    /segment/SPO    — Shipment Purchase Order Detail (all 8 elements)
    /segment/SDQ    — Destination Quantity (all 23 elements)
    /segment/SMD    — Consolidated Shipment Manifest Data (215) (all 3 elements)
    /element/88     — Marks and Numbers Qualifier, all 20 code values
    /element/187    — Weight Qualifier, filtered read (17 of ~51 values retrieved by
                      keyword; full list not read)
  Structure + quoted definitions transcribed to
    sources/x12-212-trailer-manifest/captured/stedi-212-215-structure-notes.md
  NOT read: the 211 Motor Carrier Bill of Lading and 213 Shipment Status Inquiry;
    element 40 Equipment Description Code (134 values), 284 Service Level Code (66),
    146 Shipment Method of Payment (28), 108 Pick-up or Delivery Code (32), 355 Unit
    or Basis for Measurement (794), 647 Application Error Condition (162); the M7,
    B2A, LX, L11, G61, G62, N1–N4, CD3, MS4, MS5, MS6, ACS, AT6, SLN segment pages
    (B2A / L11 / G62 / N1 were read in round 1, see src:stedi-x12-reference); and any
    X12 *normative* text.
  AT7 (Shipment Status Details) and elements 1650/1651/163 were read in round 1 under
    src:stedi-x12-reference and are cited from there, not re-read.
---

# X12 004010 TS 212 — Motor Carrier Delivery Trailer Manifest — analysis

## What it is

**Transaction set 212** is the ANSI ASC X12 document a motor carrier sends to describe
**one trailer and everything loaded on it**. Its stated purpose is bare — *"the format
and… data contents of the Motor Carrier Delivery Trailer Manifest Transaction Set
(212)"* (`/212`) — but the structure is unambiguous: a trailer identified by owner SCAC
and equipment number, a manifest number, one status with one location, and then up to
**9 999 shipments** riding on it, each with its own references, marks, weight, dates
and *physical position on the trailer*.

It was pulled into this reference because **no round-1 source could express
consolidation** — several shipments travelling together on one vehicle — and the 212 is
the one X12 document whose entire reason for existing is that fact. This analysis
therefore spends most of its length on **A3 (trip, stop & assignment)** and asks one
blunt question: *does the 212 model what a van-line trip needs, or only a trailer
manifest?* The answer, argued below, is **only a trailer manifest** — but the half it
does model, it models better than anything else read so far.

The companion **TS 215 Motor Carrier Pick-up Manifest** was read alongside it, because
it is the other X12 "many shipments in one document" set and it consolidates along a
*different* axis. Its lead segment is literally named `SMD Consolidated Shipment
Manifest Data` (`/segment/SMD`). Where the 212 is *many shipments : one piece of
equipment*, the 215 is *many shipments : one tender to a carrier* (`/215`, page gloss:
*"manifests of all shipments tendered"*; explicitly *not* a load tender, bill of lading,
pick-up notification or appointment).

**S1 kind:** `message-standard`.
**S2 adoption: 2** — lower than the 204/214/210 quartet. The 212 is a real, deployed
LTL/parcel-linehaul document, but it is a niche one; most carriers express trailer
contents inside a 214 or a proprietary manifest. Marked 2, not 3, because we have seen
no partner implementation guide for it (contrast the 858, src:x12-858-implementation-guide).
**S3 openness:** `public` for Stedi's rendering; the underlying X12 004010 publication is
`licensed`. Code lists are cited by element number; only element 88 (20 values) is
quoted whole, being small and structural rather than a taxonomy.
**S4 evidence grade: B.** We read a complete and internally consistent *rendering* of
the dictionary — every loop, every segment, every element of the segments that matter —
but not the normative X12 text, and not a single real 212 from a real carrier. A
dictionary tells you what the envelope *can* carry. It does not tell you what anyone
sends. Two specific integrity notes: the structure was re-verified on a second,
narrowly scoped read (loop repeats, full segment inventory, explicit S5/N7 negatives),
and the fetcher's *count* claims proved unreliable elsewhere in this cluster, so counts
below are treated as approximate while enumerations are treated as sound. See
`captured/stedi-212-215-structure-notes.md` § Read caveats.

## Model summary

The 212's shape, drawn to make the nesting obvious:

```
212  Motor Carrier Delivery Trailer Manifest
├─ ATA   delivering carrier SCAC + "delivery trailer manifest number assigned by
│        carrier" + creation date                      ← the manifest's identity
├─ B2A   Set Purpose                                   ← original / replace / cancel
├─ L11   ×300  business instructions & reference numbers
├─ Loop 0100 ×1      N1 N2 N3 N4 G61 G62 L11           ← ONE party, whole manifest
└─ Loop 0150 ×1  (mandatory)
   ├─ AT7           ONE status: code, reason, date, time, time zone
   ├─ G62 ×5        dates/times
   ├─ MS1           ONE location: city+state XOR lat/long (DDDMMSS)
   └─ Loop 0160 ×1
      ├─ MS2        equipment owner SCAC + equipment number + type + check digit
      ├─ M7         seal numbers
      └─ AT9        length/height/width, tare weight, volumetric capacity

   Loop 0200 ×9999   ← THE SHIPMENTS ON THE TRAILER
   ├─ LX            assigned number (its ordinal in this manifest)
   ├─ L11 ×10       references
   ├─ BLR           SCAC of a carrier, per shipment      ← interline, at shipment grain
   ├─ MAN ×9999     marks and numbers (qualifier + value, or a range)
   ├─ AT8           weight qualifier/unit/value + unitized & non-unitized handling
   │                units + volume
   ├─ G62 ×5        dates/times
   ├─ TSD           loading sequence + relative position ON the trailer
   ├─ Loop 0210 ×999999   SPO purchase order + SDQ destination quantity
   └─ Loop 0220 ×1        N1 N2 N3 N4 L11              ← ONE party, per shipment
```

Four structural facts carry everything that follows.

**1. The root of the document is a piece of equipment, not a journey.** `ATA-01` is the
delivering carrier's SCAC and `ATA-02` is *"Delivery trailer manifest number assigned by
carrier"* (`/segment/ATA`). `MS2` then names the equipment's **owner** SCAC and the
owner-assigned equipment number (`/segment/MS2`: *"To specify the owner, the
identification number assigned by that owner, and the type of equipment"*) — so the
document deliberately separates *who is hauling it* from *whose trailer it is*, which is
the interchange/interline case. `M7` carries the seals and `AT9` the trailer's physical
envelope and **tare weight** (`AT9-06`, quoted: *"Tare weight of trailer or container"*).

**2. There is exactly one status and exactly one place, for the whole trailer.**
Loop 0150 is **mandatory, repeat 1**, and `AT7` inside it is **mandatory, max use 1**.
`MS1` is the single location, and its syntax rule `E0104` makes city/state and
latitude/longitude **mutually exclusive** — one or the other, never both
(`/segment/MS1`). So a 212 asserts *"this trailer is in this state, here, now"* once,
and the entire shipment list hangs beneath that one assertion. **No shipment in a 212
has a status of its own.**

**3. The shipment line knows where it physically sits inside the trailer.** `TSD` is the
most interesting segment in the set and it has only two elements
(`/segment/TSD`, purpose: *"To specify details of shipments on a trailer"*):

| | Element | Definition, quoted |
| --- | --- | --- |
| `TSD-01` | 350 Assigned Identification | *"Indicates the loading sequence and relative shipment position on the trailer"* |
| `TSD-02` | 219 Position | *"Relative position of shipment in car, trailer, or container"* — mutually defined |

That is **load-order and physical placement as first-class shipment data**, which is
precisely what a van-line load plan is about (what goes in first comes out last; the
shipment at the nose cannot be delivered before the one at the doors). No other source
read in round 1 has it. But `TSD-02` is explicitly *mutually defined* — X12 supplies the
slot and no vocabulary, so the semantics are trading-partner agreement, not standard.

**4. A shipment is identified by reference and by marks, not by a shipment id.** There
is no "shipment number" element on loop 0200. Identity comes from three places:
`LX` the ordinal within this manifest; `L11` up to ten qualifier-typed reference numbers
(the general X12 reference slot); and `MAN` up to **9 999** marks-and-numbers entries.
`MAN-01`'s qualifier (element 88, 20 values, `/element/88`) is the part worth keeping:
it says *whose* mark this is — `SM` Shipper Assigned, `CA` Shipper-Assigned Case Number,
`CP` Carrier-Assigned Package ID Number, `MC` Master Carton Number, `R` Originator
Assigned, `DZ` Receiver Assigned Drop Zone, `SI` Self-Identifying Container via Radio
Frequency ID Device, `ZZ` Mutually Defined — and one value, **`S` Entire Shipment**,
promotes a mark from a carton label to a shipment identifier. `MAN-02`/`MAN-03` express a
**range** of marks (start, end), which is how a numbered carton series is stated
compactly. For HHG this is the inventory-sticker series, exactly.

**The 215, by contrast**, drops the equipment entirely and grows the shipment. Its loop
0200 iteration begins with `SMD` (service level, method of payment, pick-up-or-delivery
code) and then allows **10 typed parties per shipment** (loop 0220, repeat 10 — versus
the 212's *one*), a full carton loop (`CD3` + `MAN` ×100 + dimensions), per-shipment
rates and **ancillary charges** (`MS5`, `ACS`), international manifest data (`AT6`) and
sub-line item detail (`SLN`, `PID` ×1000). The 215 is the better *shipment* model and has
no trip at all; the 212 is the better *vehicle* model and has almost no shipment.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Delivery Trailer Manifest** | the transaction set itself: one trailer, its status and location, and the shipments loaded on it | A3 | `/212` |
| **Delivery trailer manifest number** | *"assigned by carrier"* — the manifest's own identifier, distinct from any shipment or equipment id | A9 | `ATA-02` |
| `MS2` **Equipment or Container Owner and Type** | *"the owner, the identification number assigned by that owner, and the type of equipment"* — equipment identity is owner-scoped | A3, A9 | `/segment/MS2` |
| `AT9` **Trailer or Container Dimension and Weight** | length (FFFII), height, width, **tare weight**, volumetric capacity | A3 | `/segment/AT9` |
| `M7` **Seal Numbers** | seals on the equipment — tamper evidence at the vehicle, not the shipment | A6 | `/212` pos 160 |
| `TSD` **Trailer Shipment Details** | *"details of shipments on a trailer"*: loading sequence and relative position | A3 | `/segment/TSD` |
| `TSD-01` **Assigned Identification** | *"the loading sequence and relative shipment position on the trailer"* | A3 | `/segment/TSD` |
| `TSD-02` **Position** | *"Relative position of shipment in car, trailer, or container"*, mutually defined | A3 | `/segment/TSD` |
| `MS1` **Equipment, Shipment, or Real Property Location** | *"location of a piece of equipment, a shipment, or real property in terms of city and state or longitude and latitude"* — city **xor** coordinates (`E0104`) | A4 | `/segment/MS1` |
| `BLR` **Transportation Carrier Identification** | *"the identifying SCAC code and effective date for the data"*; on loop 0200 it names a carrier **per shipment** | A8, A9 | `/segment/BLR` |
| `MAN` **Marks and Numbers** | *"identifying marks and numbers for shipping containers"*, with ranges and two independent marks per container | A2, A9 | `/segment/MAN` |
| element 88 `S` **Entire Shipment** | a mark that identifies the whole shipment rather than one container | A9 | `/element/88` |
| `AT8` **Shipment Weight, Packaging and Quantity Data** | weight (qualified) plus **unitized** (`AT8-05`, pallets/slip sheets) and **non-unitized** (`AT8-04`, cartons) handling units, summing to total handling units | A2 | `/segment/AT8` |
| element 187 `RG`/`RN`/`RT` **Reweigh Gross / Net / Tare Weight** | reweigh is a *typed weight*, not a separate event | A2, A6 | `/element/187` |
| `SPO` **Shipment Purchase Order Detail** | *"the purchase order details for a shipment"* — a commercial order reference below the shipment | A9 | `/segment/SPO` |
| `SDQ` **Destination Quantity** | *"destination and quantity detail"* — up to ten `location id → quantity` pairs, `SDQ-03` glossed *"Store number"* | A2 | `/segment/SDQ` |
| `SMD` **Consolidated Shipment Manifest Data** (215) | service level + method of payment + pick-up-or-delivery code, leading each shipment on a pick-up manifest | A2, A7 | `/segment/SMD` |

## Lifecycles & events

The 212 has **almost no lifecycle of its own**, and that is the finding rather than a
gap in our reading.

**The document's lifecycle is `B2A Set Purpose`** — mandatory in the heading (`/212`
pos 030), the same segment the 204 uses. It carries element 353 Transaction Set Purpose
Code, whose 65 values (read in round 1, `src:stedi-x12-reference` → `/element/353`)
include original, replace, cancel and `17 Cancel, to be Reissued`. So a trailer manifest
is **restatable and retractable as a whole**: you do not amend a manifest, you reissue
it. That is a real modelling decision — the manifest is a *snapshot document*, not a
mutable entity.

**The trailer's lifecycle is one `AT7`.** `AT7` (analysed in round 1) is
*"the status of a shipment, the reason for that status, the date and time of the status
and the date and time of any appointments scheduled"*, with element 1650 Shipment Status
Code (42 values) and element 1651 Shipment Status or Appointment Reason Code (86 values,
mandatory alongside the status). In the 212 that segment describes **the trailer**, even
though it is named for a shipment. There is no transition graph, no invariant, no
statement of who may assert the status — the same C3 ceiling the whole X12 cluster hits.

**The shipments have no lifecycle at all.** Loop 0200 carries `G62` date/time (max 5)
and nothing else temporal. There is no per-shipment status, no per-shipment reason, no
`AT7` inside the detail loop. A shipment's state, in a 212, is *"it is on this trailer,
and this trailer's status is X"*.

**Consolidation is expressed by re-issuing documents, not by a persistent trip.** This
is the single most important behavioural observation. Because a 212 is one trailer + one
status + one location, the way a carrier narrates a consolidated movement is a **series
of 212s** — a new manifest whenever the trailer's status or contents change, each a
fresh `ATA-02` (or a `B2A` replacement of the prior one). Transload and interline are
represented as *the same shipment appearing on a different trailer's manifest*, and the
only thing that ties the two manifests together is the shipment's own `L11` references
and `MAN` marks. Nothing in X12 is the trip.

## Time, identity, evidence

**Time.** Weak, and unusually so for this cluster. The 212 gets exactly two time
mechanisms: `AT7-05/06/07` (date → time → time code), which round 1 showed is
syntactically disciplined — a time may not appear without a date, a zone may not appear
without a time — and `G62 Date/Time` (qualifier + date + qualifier + time + time code),
max 5 on the manifest's status loop, max 5 on each shipment, max 1 on the header party.
`ATA-03` is a bare creation date. That is all. **There is no planned-versus-actual
apparatus in the 212** — no appointment, no window, no ETA field; `AT7-03/04` can carry
an appointment date/time, and element 1652's `ED`/`LD`/`EP`/`LP` one-sided constraints
(round 1) are available in principle, but nothing in the 212's own structure is about
planning. The set describes *now*. C5 is capped by that, not by our reading.

**Identity.** Strong, and the best-organised part of the set. Several distinct identifier
kinds coexist, each with a stated assigner:

| Identifier | Assigned by | Cite |
| --- | --- | --- |
| Delivery trailer manifest number (`ATA-02`) | the carrier | `/segment/ATA` |
| Delivering carrier SCAC (`ATA-01`) | NMFTA, industry-wide | `/segment/ATA` |
| Equipment number + check digit (`MS2-02`, `MS2-04`) | the **equipment owner** (`MS2-01` SCAC) | `/segment/MS2` |
| Per-shipment carrier SCAC + effective date (`BLR`) | NMFTA / the carrier | `/segment/BLR` |
| Marks and numbers (`MAN`), qualified by element 88 | shipper, carrier, receiver, originator, or mutually defined | `/element/88` |
| Reference numbers (`L11`), ×300 header / ×10 per shipment | qualifier-typed | `/212` |
| Purchase order number (`SPO-01`) | *"assigned by orderer/purchaser"* | `/segment/SPO` |

The pattern worth stealing: **every identifier names its issuer**, either structurally
(`MS2-01` is the owner whose numbering `MS2-02` belongs to) or by qualifier (element 88
says whose mark this is; `L11`'s qualifier says what kind of reference it is). An id is
never bare.

`BLR` on loop 0200 deserves a sentence of its own. A carrier SCAC **per shipment**, on a
manifest whose header already names the delivering carrier, means the standard expects
the shipments on one trailer to belong to *different* carriers — interline consolidation,
stated structurally. And `BLR-02` is an **effective date** for that attribution, so the
carrier-of-record for a shipment is time-scoped.

**Evidence and provenance.** Thin but real. `M7 Seal Numbers` is tamper evidence at the
equipment (and it is on the equipment loop, not the shipment loop — seals secure a
trailer, not a consignment). `AT9`'s tare weight plus `AT8`'s qualified weight plus
element 187's `G`/`N`/`T` and **`RG`/`RN`/`RT` reweigh** triple mean a weight in X12 is
always accompanied by *what kind of weight it is* — gross, net, tare, billed, estimated,
legal, or the reweigh of any of those. **That is a weight-provenance model**, and it is
the most HHG-native thing in the whole set: a household-goods shipment is rated on net
weight derived from gross minus tare at a scale, and a reweigh is a first-class right of
the shipper. X12 encodes both without a separate event type.

Corrections are document-level only: `B2A` reissues the manifest. There is no way to
correct one shipment line, and no actor recorded on any assertion — nothing says *who*
said the trailer was in Effingham at 14:02.

## Scores

Weights are set in phase 3; these are the per-area criterion scores for **this source**
(the 212, with the 215 as supporting material, as marked).

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A3 Trip, stop & assignment** | 2 | 2 | 1 | 1 | 1 | 3 | 2 | 2 | **The headline.** C1=2: *consolidation is first-class* — loop 0200 repeat **9999** shipments under one `MS2` equipment (`/212`), with `TSD` giving loading sequence and physical position on the trailer, `AT9` the trailer envelope and tare, `M7` the seals, and `BLR` a **per-shipment carrier SCAC** (interline on one trailer). C1 is capped at 2 because **stops, sequence, legs and driver are entirely absent** — verified by direct query: no `S5` (Stop Off Details), no `S5A`/`S5B`, no `N7` (Equipment Details) anywhere in the 212; the full segment inventory is `ST ATA B2A L11 N1–N4 G61 G62 AT7 MS1 MS2 M7 AT9 LX BLR MAN AT8 TSD SPO SDQ SE`. C2=2: `TSD-01`/`TSD-02` and `MS2` are precisely worded, but `TSD-02` is *"mutually defined"* — a slot without a vocabulary. C3=1: `B2A` gives original/replace/cancel on the **document**; there is no trip state, no assignment event, no transition rule. C4=1: nothing HHG-named, but load sequence + position + tare/net/reweigh weights are exactly a van-line load plan's primitives. C5=1: `G62` ×5 and one `AT7` timestamp, no planned-vs-actual. C6=3: manifest number, delivering SCAC, owner SCAC + owner-assigned equipment number + check digit, per-shipment SCAC with effective date. C7=2: `B2A` reissue semantics + `M7` seals + `BLR-02` time-scoped attribution; no actor on any assertion. C8=2: `L11` ×300 and qualifier-typed everything. |
| **A2 Shipment structure** | 2 | 2 | n/a | 1 | n/a | 3 | 1 | 2 | C1=2 for the 212 alone (`AT8` weight + unitized/non-unitized handling units, `MAN` ×9999 marks with ranges, `SPO`/`SDQ` order-and-destination quantities); the **215** raises the family's coverage with `CD3` carton detail ×999999, `MS4` dimensions, `SLN` sub-line items, `PID` ×1000, `L5` description/marks (`/215`). C2=2: `AT8-04` vs `AT8-05` — *non-unitized* (cartons) vs *unitized* (pallets/slip sheets) handling units, summing to a total — is a real, useful distinction and is defined, not just named. C4=1 and only because of element 187: `G` Gross / `N` Actual Net / `T` Tare / `E` Estimated Net / `B` Billed and **`RG`/`RN`/`RT` Reweigh Gross/Net/Tare** (`/element/187`) — reweigh as a weight *type*. No HHG article, vault, room, or unpacked-item concept anywhere. C6=3: element 88 qualifies whose mark each identifier is, incl. `S` Entire Shipment. C7=1: weight qualifiers are provenance of a kind; nothing else. C8=2. |
| **A4 Execution events & tracking** | 1 | 2 | 1 | 0 | 1 | 2 | 1 | 2 | C1=1: **one** `AT7` for the whole manifest (loop 0150 mandatory, repeat 1; `AT7` max use 1) and **no per-shipment status at all** — the 212 is a snapshot, not an event stream. C2=2 is borrowed: `AT7`, elements 1650/1651 and their disciplines were read in round 1 (`src:stedi-x12-reference`), not re-derived here. C5=1: `MS1` is a *place* with no time of its own; the only timestamp is `AT7-05/06/07` plus `G62`. C6=2. C7=1: no actor, no evidence attached to the status (no `Q7`, no `EFI`/`BIN` — those are 214-only). Notable positive for C2/C5: `MS1`'s `E0104` makes **city/state and lat/long mutually exclusive** — the standard refuses to let a geocode and a place name disagree. |
| **A8 Parties & roles** | 1 | 1 | n/a | 0 | n/a | 2 | 0 | 2 | **Weakest area.** The 212 allows **one** party on the whole manifest (loop 0100, repeat 1) and **one** party per shipment (loop 0220, repeat **1**) — you cannot state shipper *and* consignee on a shipment line. The role vocabulary is element 98, analysed separately in `sources/stedi-x12-reference/analysis-supplement-98-1651.md`; it has no household-goods agent roles. C4=0. The 215 is much better here — loop 0220 repeat **10**, with `G61` contact, `X1`/`X2` licences and `R4` port/terminal per party (`/215`) — so the *pick-up* manifest can carry a shipment's party set and the *delivery* manifest cannot. |
| **A9 Identity & cross-references** | 3 | 3 | n/a | 2 | n/a | 3 | 2 | 3 | **Strongest area.** Seven identifier kinds coexist, each naming its assigner: manifest number *"assigned by carrier"* (`ATA-02`), delivering SCAC (`ATA-01`), equipment number *"assigned by that owner"* + check digit (`MS2`), per-shipment carrier SCAC **with effective date** (`BLR`), marks qualified by element 88 (shipper/carrier/receiver/originator/mutually-defined, incl. `S` Entire Shipment and start–end **ranges**), `L11` ×300, purchase order *"assigned by orderer/purchaser"* (`SPO-01`). C4=2: SCAC and carton-mark series are literally our identifiers. C7=2 for `BLR-02`'s time-scoping. C8=3: every reference is qualifier-typed, so new kinds are code additions. |
| **A6 Documents & evidence** | 1 | 1 | 2 | 0 | n/a | 2 | 2 | 1 | The manifest **is** a document and `B2A` gives it original/replace/cancel semantics (C3=2) — a manifest is reissued, never amended. `M7 Seal Numbers` is evidence at the equipment. Element 187's reweigh qualifiers imply a weight ticket without naming one. No BOL, no POD, no inventory, no signature, no binary attachment (the 214's `EFI`/`BIN` is not here). C4=0. |
| **A7 Charges & billing hooks** | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent from the 212 entirely. *Via the 215 only:* `SMD-02` Shipment Method of Payment (element 146, 28 codes), `MS5` Shipment Rates and Charges, `ACS` **Ancillary Charges** at both shipment and carton grain (max 10 each), `CGS` Charge, `TXI` Tax Information (`/215`). Recorded so the 215 is not re-researched later; not scored, because the 212 is the source. |
| **A1 Order & service lifecycle** | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | No order, no offer, no acceptance, no service. `SPO` references a purchase order but does not model one. |
| **A5 Storage-in-transit** | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Nothing. (The X12 SIT hooks are elsewhere: element 1650 `BC` Storage in Transit, round 1; and element 98 `WO`/`WD` storage facility at origin/destination — see the supplement.) |

**S5 fit to Pegasus data:** withdrawn 2026-09-17 (rubric § Per-source attributes). Not
assessed. Our systems are out of the evidence base for this round.

## Strengths worth adopting

1. **Consolidation is a relation between a *vehicle* and *many shipments*, and the
   relation carries data of its own.** The 212's loop 0200 is not a list of shipment
   ids — each membership carries the shipment's weight on this trailer, its marks, its
   dates, its carrier, and its **loading sequence and physical position** (`TSD`). The
   model should have a `TrailerLoad`/`Trip`↔`Shipment` association object, not a foreign
   key. `TSD-01` — *"the loading sequence and relative shipment position on the
   trailer"* — is the field that makes "which shipment can we deliver first" answerable.

2. **Equipment identity is owner-scoped, and the hauler is a separate fact.** `MS2`
   pairs an owner SCAC with an owner-assigned equipment number; `ATA-01` separately names
   the delivering carrier. Trailer `12345` is only unique inside its owner's numbering.
   Copy that: equipment ids are never globally unique and the model should not pretend
   otherwise.

3. **Carrier attribution at shipment grain, with an effective date** (`BLR` on loop
   0200, `BLR-02` = *"effective date of transaction set data"*). Two shipments on one
   trailer can belong to two carriers, and the attribution is time-scoped. This is the
   interline/agent-handoff fact that a van-line model needs and that a single
   `shipment.carrier` field cannot express.

4. **Weight is always typed, and reweigh is a type rather than an event.** Element 187's
   `G`/`N`/`T` × the `RG`/`RN`/`RT` reweigh variants, plus `E` Estimated Net, `B` Billed,
   `L` Legal, `X`/`M` maximum/minimum for rate, `CD`/`ND` chargeable/non-chargeable
   dunnage. An HHG shipment's weight history is exactly this list. Adopt the qualifier
   pattern: a `Weight` value object is `(kind, unit, value, source)`, never a number.

5. **`MAN`'s two ideas: marks are qualified by *whose* they are, and they come in
   ranges.** Element 88 `S` Entire Shipment vs `CA` Shipper-Assigned Case Number vs
   `CP` Carrier-Assigned Package ID vs `MC` Master Carton Number distinguishes the four
   grains an inventory sticker can name, and `MAN-02`/`MAN-03` state a start–end series.
   A van-line inventory is a numbered sticker series issued by an agent — that is
   `MAN-01=SM` with a range, without inventing anything.

6. **`MS1`'s `E0104`: a location is a place name *or* a coordinate, never both.** The
   standard refuses to store two representations that can drift apart. A `Location` value
   object should be a discriminated union for the same reason.

7. **The document is reissued, not mutated** (`B2A`, element 353, incl. `17 Cancel, to be
   Reissued`). A manifest is a point-in-time assertion about a trailer; correcting it
   means superseding it. That is the right shape for any "state of the vehicle now"
   artefact and it composes with event sourcing.

8. **Unitized vs non-unitized handling units as two separate counts that sum**
   (`AT8-04`/`AT8-05`). For HHG this maps directly onto loose cartons versus vaults/
   crates/pallets, and the standard's insistence that they are different numbers adding
   to one total is better than a single `pieceCount`.

9. **From the 215: `SMD`'s three-part shipment header — service level, method of payment,
   pick-up-or-delivery code.** A shipment declares *what grade of service* and *who pays*
   as structural fields on the line, not as free text. And the 215's 10-party-per-shipment
   loop is the shape the 212 should have had.

## Weaknesses / traps

1. **The 212 has no stops. Following it would model a fleet, not a trip.** Verified by
   direct query: there is no `S5 Stop Off Details` segment anywhere in the 212, and no
   `N7 Equipment Details`. There is therefore no stop sequence number, no
   `Stop Reason Code` (element 163 — the 19-value vocabulary with `PL` Part Load,
   `PU` Part Unload, `CN` Consolidate, `TL` Transload, `WL` Weigh Loaded that round 1
   found in the **204**), no origin/destination pairing, and no answer to *"at which stop
   does this shipment load and at which does it unload?"* A model built from the 212
   would know what is on the truck and never know where the truck is going.

2. **A shipment appears exactly once per manifest, so "a shipment at more than one stop"
   is not merely unsupported — it is unaskable.** There is no mechanism to repeat a
   shipment within loop 0200 (`LX` is its ordinal) and no stop for it to be repeated
   against. Partial load / partial unload — a normal HHG occurrence, and one the 204's
   element 163 `PL`/`PU` codes explicitly anticipate — cannot be stated in a 212 at all.

3. **One status for the whole trailer conflates the vehicle with its cargo.** `AT7` is
   named *Shipment* Status Details and in the 212 it describes the trailer. Any model
   that copies this inherits the bug: a trailer arriving at a warehouse is not the same
   event as a shipment being delivered, and the 212 has only one of the two. It is the
   mirror image of round 1's finding about fused aggregates — the 212 fuses vehicle-state
   and shipment-state in the other direction.

4. **One party per shipment (loop 0220, repeat 1).** A delivery manifest line cannot name
   both shipper and consignee, let alone origin agent, destination agent, booking agent
   and van line. Combined with element 98's lack of HHG roles (see the supplement), A8
   gets nothing usable from this source. Do not take the 212's party model.

5. **`SPO`/`SDQ` are retail, and they are a trap for A2.** `SPO` is a purchase order;
   `SDQ-03` is glossed *"Store number"* and `SDQ-23` gives examples *"front room, back
   room, end aisle display"*. This is a DC-to-store distribution model. The temptation to
   read `SDQ` as "quantity per destination" and use it for split deliveries should be
   resisted — it is quantity per *retail location*, and it sits below a purchase order,
   not below a stop.

6. **`TSD-02` is mutually defined**, i.e. a slot with no vocabulary. The good idea
   (position on the trailer) comes with no standard way to say *nose / mid / doors /
   deck / overhead*. If we adopt it we must define the vocabulary ourselves — and we
   should, because it is what makes a load plan checkable.

7. **No planned/estimated time anywhere in the set.** The 212 says only "now". Taking its
   time model would lose appointments, windows, spreads and ETAs — all of which X12 *does*
   have, in the 204/214 (element 1652's `ED`/`LD`/`EP`/`LP` one-sided constraints, round
   1). Do not treat the 212 as evidence about C5; treat it as silent.

8. **No actor on any assertion, and corrections only at document grain.** Nothing records
   who reported the trailer's status, and a single wrong shipment line can only be fixed
   by reissuing the whole manifest. For A6/C7 the 212 is below the bar the model should
   set.

9. **Adoption risk (S2=2).** Unlike the 204/214/210, we have seen no carrier
   implementation guide for the 212, and the 858 precedent (src:x12-858-implementation-guide)
   shows partners switching off half a set. Treat the 212 as *evidence that the industry
   names consolidation*, not as evidence that partners will exchange it.

## Out-of-v1 material

- **A12 (rating & tariffs), via the 215:** `MS5 Shipment Rates and Charges` (max 5 per
  shipment), `ACS Ancillary Charges` at shipment **and** carton grain (max 10 each),
  `CGS Charge`, `TXI Tax Information`, `IT1 Baseline Item Data (Invoice)`, `SMD-02`
  Shipment Method of Payment (element 146, 28 codes), `SMD-01` Service Level Code
  (element 284, 66 codes). Accessorials attaching at *carton* grain is unusual and worth
  revisiting when A12 is built. `/215`, `/segment/SMD`.
- **A10 (survey, estimating & inventory), via the 215:** `CD3 Carton (Package) Detail` →
  `MAN` ×100 → `MS4 Shipment or Package Dimensions`, and `SLN Subline Item Detail` →
  `PID Product/Item Description` ×1000. A per-carton, per-item structure already exists
  in X12; when we model inventory, compare against it before inventing. `/215`.
- **A12/A13 adjacent:** element 187's `CD Chargeable Dunnage` / `ND Nonchargeable
  Dunnage` and `X Maximum Weight (for Rate)` / `M Minimum Weight (for rate)` /
  `F Deficit Weight` show weight feeding rating directly. `/element/187`.
- **Equipment typing:** element 40 Equipment Description Code, 134 values (`MS2-03`), not
  read. Likely the source for a trailer/vault/van/tractor type vocabulary if A3 needs one.
- **Unread neighbours in the same family:** TS **211** Motor Carrier Bill of Lading
  (A6 — the BOL itself, the biggest single A6 gap in this cluster) and TS **213**
  Shipment Status Inquiry. `BLR` also appears in TS **217 Motor Carrier Loading and Route
  Guide**, whose name suggests loading rules and routing — a candidate for A3.

## Open questions

1. **Does any X12 transaction set join *N shipments* × *M sequenced stops* × *one piece
   of equipment* in one document?** On the evidence so far the answer is no, and that is
   the central structural finding of this read: the **204** gives sequenced stops
   (`S5` loop with stop sequence, `Stop Reason Code`, per-stop parties, quantities and
   `N7` equipment) for **one** tender; the **212** gives many shipments on **one** piece
   of equipment with no stops; the **214** gives status for **one** shipment. A van-line
   trip is the product of all three and no standard document expresses it. **The
   reference model must supply that join itself** — a `Trip` aggregate owning an ordered
   `Stop` list and a set of `ShipmentOnTrip` memberships, each membership naming its load
   stop and its unload stop. TS 217 (Motor Carrier Loading and Route Guide) is the one
   unread candidate that might contradict this; worth 20 minutes.
2. **Is the 212 used in practice by household-goods van lines, or only by LTL/parcel
   linehaul?** Needs a partner implementation guide (src:x12-partner-guides,
   src:tenant-edi-partner-guides) or a van-line EDI contact. Affects S2 and affects
   whether "trailer manifest" is even the right industry name for what we are modelling.
   The HHG industry's own word is *load plan* or *trip*, and neither appears in X12.
3. **Is there a standard vocabulary for `TSD-02 Position`** (nose/mid/doors/deck), or is
   it universally trading-partner-specific? If we define our own we should check the
   NMFTA e-BOL work (src:nmfta-ebol) and the 400NG/DP3 tariffs (src:dp3-400ng) first.
4. **How do carriers actually correlate successive 212s** — by `L11` reference, by `MAN`
   marks, or by a `B2A` replacement chain on `ATA-02`? The dictionary allows all three
   and mandates none. This is the "how is a trip reconstructed from snapshots" question
   and only a real implementation guide answers it.
5. **Element 40 Equipment Description Code (134 values)** — does it distinguish a moving
   van, a straight truck, a shuttle/bobtail, a storage vault, a container? Unread, and it
   is the natural place for A3's equipment-type vocabulary.
6. **Does element 187's full list (≈51 values, 17 read) contain a certified-scale or
   weight-ticket qualifier?** The reweigh triple is present; whether provenance of the
   weighing itself is expressible would settle part of A6.
