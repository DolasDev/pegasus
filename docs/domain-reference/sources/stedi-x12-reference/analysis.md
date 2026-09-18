---
source: src:stedi-x12-reference
analyzed: 2026-09-17
evidence_grade: B
material: |
  Read (web, 2026-09-17), all under https://www.stedi.com/edi/x12-004010/ :
    /214            — 214 Transportation Carrier Shipment Status Message, full loop/segment table
    /204            — 204 Motor Carrier Load Tender, full loop/segment table
    /210            — 210 Motor Carrier Freight Details and Invoice, full loop/segment table
    /990            — 990 Response to a Load Tender, full segment table
    /segment/AT7    — Shipment Status Details, all 7 elements + syntax rules
    /segment/B10    — Beginning Segment for 214
    /segment/B1     — Beginning Segment for Booking or Pick-up/Delivery (990)
    /segment/B2A    — Set Purpose
    /segment/S5     — Stop Off Details, all 11 elements
    /element/1650   — Shipment Status Code, all 42 code values
    /element/1651   — Shipment Status or Appointment Reason Code, all 86 code values
    /element/1652   — Shipment Appointment Status Code, all 9 code values
    /element/163    — Stop Reason Code, all 19 code values
    /element/558    — Reservation Action Code, all 7 code values
    /element/353    — Transaction Set Purpose Code, codes 00–30
  NOT read: /211, /212, /213, /215, /997, and the ~1 000 other elements; the
    remaining code lists behind "Codes (794)" style links (e.g. element 355 Unit or
    Basis for Measurement, element 128 Reference Identification Qualifier, element
    623 Time Code); and any X12 *normative* text. Stedi's pages are a free,
    non-normative rendering of the X12 004010 dictionary — the normative definitions
    are behind X12 Glass (src:x12-transportation, status `needs-user`).
  Pages were read via an HTML→markdown fetch; where a page said a code list exists
    but did not render it, that is recorded as not-read rather than guessed.
---

# Stedi X12 004010 reference (204 / 210 / 214 / 990) — analysis

## What it is

Stedi publishes a free, browsable rendering of the **ANSI ASC X12 004010** dictionary:
per transaction set, the full loop and segment table with position, name, usage and max
use; per segment, every element with its number, type, min/max and conditional-usage
rules; per element, the complete code list. We read the four transaction sets that make
up the North-American motor-carrier conversation — **tender (204) → response (990) →
status (214) → invoice (210)** — plus the segments and code lists those turn on.

**S1 kind:** `message-standard` (as rendered; the standard itself is X12's).
**S2 adoption: 3** — 004010 is the version the road-freight industry actually runs, and
the 204/990/214/210 quartet is *the* EDI conversation a shipper or broker will ask us
for. No source in this repo has higher real-world adoption for A1/A4/A9.
**S3 openness:** `public` for the rendering; the underlying standard is `licensed`
(registry: *"Reference code lists, never copy them into the repo"*). Code lists below
are therefore cited by element number and illustrated with the values that matter to
HHG, never reproduced whole.

**Evidence grade B, deliberately.** We read a complete and internally consistent
*rendering* of the dictionary, not the normative X12 publication, and not any real
partner's implementation guide (that is src:x12-partner-guides and
src:x12-858-implementation-guide). A dictionary tells you what the envelope can carry;
it does not tell you what any partner actually sends, and the 858 guide in this cluster
is a vivid demonstration that a partner may switch off half of it.

**Why this source matters when no tenant uses EDI.** A future EDI request will not be
"support EDI". It will be *"send us a 214 whenever status changes, and accept our
204."* The question this source answers is therefore narrow and concrete: **what must
our model be able to say for a 214/204/990/210 to be generated from it?** Everything
below is aimed at that.

## Model summary

Four transaction sets, one conversation:

```
   shipper / broker                                carrier
        │                                             │
        │──────────── 204 Motor Carrier Load Tender ─>│   B2 + B2A(purpose)
        │              header: parties, equipment      │   Loop 0300: S5 stops
        │              detail : stop list (S5 loop)    │     ├ L11 refs, G62 times
        │                                              │     ├ AT8 weight/qty
        │                                              │     ├ N1 party per stop
        │                                              │     ├ L5 commodity
        │                                              │     ├ OID order detail
        │                                              │     └ N7 equipment per stop
        │<──────── 990 Response to a Load Tender ──────│   B1 + Reservation Action Code
        │                                              │   S5 loop (per-stop response)
        │<──────── 214 Carrier Shipment Status ────────│   B10 + Loop 0200 LX
        │             (repeatedly, over the life)      │     └ Loop 0205: AT7 + MS1 + MS2
        │<──────── 210 Freight Details and Invoice ────│   B3 + S5 stops + LX/L0/L1 charges
```

Five structural features carry the whole design.

**1. The `S5` stop-off loop is the shared spine.** The *same* segment —
`S5 = {Stop Sequence Number, Stop Reason Code, Weight, Weight Unit, Number of Units
Shipped, Unit of Measure, Volume, Volume Unit, Description, Standard Point Location
Code, Accomplish Code}` (`/segment/S5`) — appears in the 204 (planning the stops), the
990 (responding per stop), the 210 (charging per stop) and the 858. **Tender, response,
status and invoice all agree on what a stop is**, and the stop carries its own
quantities. A shipment's structure is a numbered stop list, and everything else hangs
off it.

**2. `Stop Reason Code` (element 163, 19 values) is a stop *purpose* vocabulary, and it
is unexpectedly rich.** Beyond `LD` Load / `UL` Unload / `CL` Complete /
`CU` Complete Unload it carries **`PL` Part Load**, **`PU` Part Unload**,
`DT` Drop Trailer, `PA` Pick-up Pre-loaded Equipment, `RT` Retrieval of Trailer,
`SL` Spot for Load, `SU` Spot for Unload, `TL` Transload, `CN` Consolidate,
`IN` Inspection, `WL` Weigh Loaded, `AL` Advance Loading, `HT` Heat the Shipment,
`DR` Deramp and Ramp for Subsequent Loading, `LE` Spot for Load Exchange (Export).
For HHG the interesting ones are **`PL`/`PU` (partial load / partial unload — a
shipment that is not fully loaded at one stop), `CN` Consolidate, `TL` Transload,
`DT` Drop Trailer, and `WL` Weigh Loaded** — the last being the weigh-station stop that
produces a weight ticket, modelled as *a stop with a purpose* rather than as a separate
event type.

**3. `S511 Accomplish Code` — "stop status indicator" — is the standard's
planned-vs-done flag on a stop**, and (per src:x12-858-implementation-guide, p.19) it is
exactly the field a partner profile tends to switch off. Its presence means the same
`S5` can express both "this stop is planned" and "this stop is done", which is why the
segment can be reused across four message types.

**4. The 214's status is `AT7`, and its shape is the most transferable thing in this
cluster.** `/segment/AT7`, purpose: *"To specify the status of a shipment, the reason
for that status, the date and time of the status and the date and time of any
appointments scheduled."*

| pos | elem | name | type |
| --- | --- | --- | --- |
| AT7-01 | 1650 | **Shipment Status Code** | ID 2/2, 42 codes |
| AT7-02 | 1651 | **Shipment Status or Appointment Reason Code** | ID 2/2, 86 codes |
| AT7-03 | 1652 | **Shipment Appointment Status Code** | ID 2/2, 9 codes |
| AT7-04 | 1651 | Shipment Status or **Appointment** Reason Code | ID 2/2, same 86 codes |
| AT7-05 | 373 | Date | DT 8/8 (CCYYMMDD) |
| AT7-06 | 337 | Time | TM 4/8 |
| AT7-07 | 623 | **Time Code** | ID 2/2 — the UTC offset, 51 codes |

with these rules, quoted from the page:

> *"Only one of AT7-01 or AT7-03 may be present · If AT7-01 or AT7-02 appears, both are
> required · If AT7-03 or AT7-04 appears, both are required · AT7-06 requires AT7-05;
> AT7-07 requires AT7-06 · AT7-05 represents status date (if AT7-01 present) or
> appointment date (if AT7-03 present)."*

Read that carefully, because it encodes four decisions worth stealing outright:

- **A status is never bare: a status code without a reason code is syntactically
  invalid.** `AT7-01 ⇒ AT7-02 required`. Every status assertion explains itself.
- **A status and an appointment are the same shape and mutually exclusive.** One segment
  says either "here is what happened and why" or "here is what is scheduled and why",
  never both — and the date/time slot means whichever the first element selected.
- **Date, time and *time zone* are three separate, conditionally-chained elements.** You
  may assert a date with no time; you may not assert a time with no date; you may not
  assert a zone with no time. **That chain is the correct model for a delivery spread
  (date-only) versus an arrival (instant with a zone).**
- **The reason-code list is shared between status reasons and appointment reasons** —
  one vocabulary, two uses.

**5. Status is reported at three nesting levels in the 214, and the same `AT7` is used
at each.** Loop 0205 (shipment level, under `LX`), Loop 0215 (carton level, under `CD3`
Carton Detail), and Loop 0240 (order level, under `PRF` Purchase Order Reference) — each
with its own optional `MS1 Equipment, Shipment, or Real Property Location`
(*"location… in terms of city and state or longitude and latitude"*) and
`MS2 Equipment or Container Owner and Type` (*"the owner, the identification number
assigned by that owner, and the type of equipment"*). **The same status vocabulary
applies at shipment, package and order grain, with position and equipment attached at
each.** That answers "can you tell me the status of one item, not the whole shipment?"
without a second vocabulary — directly relevant to HHG partial deliveries and to
per-item claims.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| 204 **Motor Carrier Load Tender** | a shipper offering *"(tender) a shipment to a full load (truckload) motor carrier"* with scheduling and handling instructions | A1 | `/204` |
| 990 **Response to a Load Tender** | *"communicates acceptance or rejection of an EDI 204"* | A1 | `/990` |
| 214 **Transportation Carrier Shipment Status Message** | carrier→shipper status reporting | A4 | `/214` |
| 210 **Motor Carrier Freight Details and Invoice** | *"provides detail information for charges for services rendered by a motor carrier"* | A7 | `/210` |
| `B2A` **Set Purpose** | *"To allow for positive identification of transaction set purpose"* — `B2A-01` = element 353 | A1, C3 | `/segment/B2A` |
| element 353 **Transaction Set Purpose Code** | *"Code identifying purpose of transaction set"*; 65 values incl. `00` Original, `01` Cancellation, `02` Add, `03` Delete, `04` Change, `05` Replace, `06` Confirmation, `08` Status, `11` Response, `13` Request, `16` Proposed, **`17` Cancel, to be Reissued**, `18` Reissue, `22` Information Copy, `24` Draft, `25` Incremental, `27` Verify, `28` Query | A1, C3, C7 | `/element/353` |
| `B1` **Beginning Segment for Booking or Pick-up/Delivery** | `{SCAC, Shipment Identification Number, Date, Reservation Action Code}`; the date is *"the **booking date accepted by the carrier**"* | A1 | `/segment/B1` |
| element 558 **Reservation Action Code** | *"Code identifying action on reservation or offering"*: `A` Reservation Accepted, **`B` Conditional Acceptance**, **`C` Counter Proposal Made**, `D` Reservation Cancelled, `N` New, `R` Delete, `U` Change | A1, C3 | `/element/558` |
| `B10` (214 beginning) | `{Reference Identification (carrier PRO), Shipment Identification Number (shipper's), SCAC (mandatory), Inquiry Request Number, ref-qualifier + ref, **Yes/No Condition or Response Code**}` | A9, C7 | `/segment/B10` |
| `B10-07` | *"Indicates **EDI transmission (Y) or manual key entry (N)** of reference numbers"* | C7 | `/segment/B10` |
| `AT7` **Shipment Status Details** | *"To specify the status of a shipment, the reason for that status, the date and time of the status and the date and time of any appointments scheduled."* | A4 | `/segment/AT7` |
| element 1650 **Shipment Status Code** | *"Code indicating the status of a shipment"* — 42 values (below) | A4 | `/element/1650` |
| element 1651 **Shipment Status or Appointment Reason Code** | *"Code indicating the reason a shipment status or appointment reason was transmitted"* — 86 values (below) | A4, C7 | `/element/1651` |
| element 1652 **Shipment Appointment Status Code** | *"Code indicating the status of an appointment to pick-up or deliver a shipment"* — 9 values (below) | A3, C5 | `/element/1652` |
| element 623 **Time Code** | the UTC-offset element, 51 codes; conditionally required only if a time is present | C5 | `/segment/AT7` |
| `MS1` | *"Equipment, Shipment, or Real Property Location… in terms of city and state or longitude and latitude"* | A4 | `/214` |
| `MS2` | *"Equipment or Container Owner and Type… the owner, the identification number assigned by that owner, and the type of equipment"* | A3, A9 | `/214` |
| `MS3` **Interline Information** | header segment in both 204 and 214 | A8 | `/204`, `/214` |
| `S5` **Stop Off Details** | *"To specify stop-off detail reference numbers and stop reason"*; `S501` Stop Sequence Number (N0 1/3), `S502` Stop Reason Code (**mandatory**), weight, units, volume, `S509` description, `S510` Standard Point Location Code, `S511` Accomplish Code | A3 | `/segment/S5` |
| element 163 **Stop Reason Code** | *"Code specifying the reason for the stop"* — 19 values incl. `PL` Part Load, `PU` Part Unload, `CN` Consolidate, `TL` Transload, `DT` Drop Trailer, `WL` Weigh Loaded, `IN` Inspection | A3 | `/element/163` |
| `S511` **Accomplish Code** | *"Stop status indicator"* | A3, A4 | `/segment/S5` |
| `L11` **Business Instructions and Reference Number** | the 204/214 reference slot, max use **300** at header, 10–50 per loop | A9, C8 | `/204`, `/214` |
| `OID` **Order Identification Detail** | per-stop order loop in the 204 (Loop 0350, repeat 999) with its own `G62` and `LAD` | A2, A9 | `/204` |
| `LAD` **Lading Detail** / `L5` **Description, Marks and Numbers** | what is on the truck, per stop and per order | A2 | `/204` |
| `AT8` **Shipment Weight, Packaging and Quantity Data** | quantities at stop, status and order grain | A2 | `/204`, `/214` |
| `AT5` **Bill of Lading Handling Requirements** | services/handling at header and per stop (max 6 each) | A2, A6 | `/204` |
| `Q7` **Lading Exception Code** | per-status exception segment in the 214, max 10 | A4, A11 | `/214` |
| `POD` **Proof of Delivery** | a segment in the 210, at line-item and carton grain | A6 | `/210` |
| `N7` **Equipment Details** + `N7A`/`N7B`/`MEA`/`M7` | equipment at header (Loop 0200) **and per stop** (Loop 0380) in the 204 | A3 | `/204` |
| `EFI` + `BIN` | *Electronic Format Identification* + *Binary Data* — Loop 0260 of the 214 | A6, C8 | `/214` |
| `MAN` **Marks and Numbers** | max use **9999**, at header, status and carton grain in the 214 | A2, A9 | `/214` |
| `CD3` **Carton (Package) Detail** / `PRF` **Purchase Order Reference** | the two sub-shipment grains at which the 214 reports status | A2, A4 | `/214` |
| `L0`/`L1`/`L3` | *Line Item - Quantity and Weight* / *Rate and Charges* / *Total Weight and Charges* | A7 | `/210` |
| `L7` **Tariff Reference** | per line item in the 210, max 10 | A12 | `/210` |

## Lifecycles & events

### The tender conversation (204 → 990)

**Purpose code first.** Every 204 carries `B2A`, whose only job is *"positive
identification of transaction set purpose"*, drawing on element 353's 65 values. So the
*same* document shape is an original tender (`00`), a change (`04`), a replacement
(`05`), a cancellation (`01`), a **`17` Cancel, to be Reissued**, an `18` Reissue, a
`22` Information Copy, a `24` Draft, or a `28` Query. **The lifecycle verb is a field on
the message, not a different message.** `17 Cancel, to be Reissued` is worth pausing on:
it distinguishes *withdraw this and expect a replacement* from *withdraw this* — a
distinction HHG needs constantly (re-tender to a different hauling agent, re-book a
cancelled spread) and that no vendor API in this cluster has.

**The response is four-valued, not two.** `B1-04` Reservation Action Code
(`/element/558`): `A` Reservation Accepted, **`B` Conditional Acceptance**, **`C`
Counter Proposal Made**, `D` Reservation Cancelled, plus the maintenance verbs `N` New,
`U` Change, `R` Delete. A 1997-vintage standard models **conditional acceptance and
counter-offer** as first-class responses; p44's booking model (`BOOKED` | `REJECTED`)
does not, and neither does any tenant system we are likely to find. Tendering a shipment
to an agent who accepts *except* the delivery date is the normal case in HHG, and this
is the only source in the cluster that can say it.

The 990 also carries `V9 Event Detail` (max 10), `L9 Charge Detail` (max 40), `N7`
equipment and a full `S5` stop loop with nested `N9`/`G62`/`K1` — so the acceptance can
be **per-stop and can attach its own times and charges**, not merely a yes.

### Status (214)

**42 status codes** (element 1650) covering the whole lifecycle with the physical and
custodial distinctions we care about. The ones that matter for HHG, quoted verbatim:

- *departure and arrival, distinguished by **which** location*: `X3` Arrived at Pick-up
  Location, `X8` Arrived at Pick-up Location Loading Dock, `AF` Carrier Departed
  Pick-up Location with Shipment, `X4` Arrived at Terminal Location, `P1` Departed
  Terminal Location, `X6` En Route to Delivery Location, `X1` Arrived at Delivery
  Location, `X5` Arrived at Delivery Location Loading Dock, `CD` Carrier Departed
  Delivery Location. **Nine arrival/departure codes, because *where* changes the
  meaning** — and note `X5`/`X8`, a second, finer grain: at the site vs at the dock.
- *work*: `L1` Loading, `AM` Loaded on Truck, `CP` **Completed Loading at Pick-up
  Location**, `D1` **Completed Unloading at Delivery Location**, `CL` Trailer Closed
  Out.
- *custody transfer between carriers*: **`J1` Delivered to Connecting Line**,
  **`R1` Received from Prior Carrier**, `BA` Connecting Line or Cartage Pick-up. **This
  is the interline pair** — the agent-to-agent handoff that p44 can only gesture at with
  `INTERLINE_INFO`, expressed here as two complementary assertions by two different
  parties.
- **`BC` Storage in Transit.** A status code, in the 1997 standard, for SIT. Its
  presence is significant for A5: a future EDI partner *can* be told a shipment is in
  SIT using a standard code, and it is a *status*, not a stop type.
- *delivery outcomes*: `AJ` Tendered for Delivery, `AV` Available for Delivery,
  `AH` Attempted Delivery, `AP` Delivery Not Completed, `A7` Refused by Consignee,
  `A3` Shipment Returned to Shipper, `A9` Shipment Damaged, `AI` Shipment has been
  Reconsigned, `S1` Trailer Spotted at Consignee's Location.
- *estimates as statuses*: `AG` Estimated Delivery, `B6` Estimated to Arrive at Carrier
  Terminal, `C1` Estimated to Depart Terminal Location, `X2` Estimated Date and/or Time
  of Arrival at Consignee's Location. **The estimate is a status code, not a separate
  field** — which is how the same AT7 segment carries both "it arrived" and "it will
  arrive".
- *administrative*: `XB` Shipment Acknowledged, `CA` Shipment Cancelled, `SD` Shipment
  Delayed, `OO` **Paperwork Received - Did not Receive Shipment or Equipment**.
  (`OO` is a beautifully specific real-world code.)

**86 reason codes** (element 1651) — and the shape of this list is the lesson. It is
**not** a delay taxonomy; it is a list of *who or what is responsible*, with three
explicit "nothing unusual" values:

- *attribution*: `AG` Consignee Related, `AH` Driver Related, `AM` Shipper Related,
  `AJ` Other Carrier Related, `BI` Cartage Agent, `BF` **Carrier Keying Error**,
  `D1` Carrier Dispatch Error.
- *the consignee side*: `B1` Consignee Closed, `A1` Missed Delivery, `A2` Incorrect
  Address, `A5` Unable to Locate, `A6` **Address Corrected - Delivery Attempted**,
  `AQ` Recipient Unavailable - Delivery Delayed, `B9` Receiving Time Restricted,
  `BS` Refused by Customer, `AD` Customer Requested Future Delivery,
  `BJ` Customer Wanted Earlier Delivery, `C1` Waiting for Customer Pick-up,
  `C3` Suspended at Customer Request, `C4` **Customer Vacation**.
- *holds*: `B4` Held for Payment, `B5` Held for Consignee, `BB` Held per Shipper,
  `HB` **Held Pending Appointment**, `P4` Held for Full Carrier Load, `C2` Credit Hold.
- *resources*: `T1`–`T6` (tractor with sleeper / conventional tractor / trailer not
  available / **trailer not usable due to prior product** / trailer class / trailer
  volume), `D2` Driver Not Available, `AI` Mechanical Breakdown.
- *operations and environment*: `AF` Accident, `AO` Weather or Natural Disaster Related,
  `BE` Road Conditions, `AL` Previous Stop, `AW` Past Cut-off Time, `AX` Insufficient
  Pick-up Time, `BH` Insufficient Time to Complete Delivery, `T7` Insufficient Delivery
  Time, `AV` Exceeds Service Limitations, `B8` Improper Unloading Facility or Equipment,
  `BP` Load Shifted, `BQ` Shipment Overweight, `S1` Delivery Shortage,
  `AK` Damaged, Rewrapped in Hub, `BC` Missing Documents, `BN` Failed to Release Billing.
- *and the three that make the design work*: **`NS` Normal Status**, **`NA` Normal
  Appointment**, **`BG` Other**.

`NS`/`NA` are why "a status must carry a reason" is workable: when nothing is wrong, the
reason is *"Normal Status"*. That, plus `BG` Other, is the pattern — **make the
explanation mandatory and supply an explicit "nothing to explain" value**, rather than
making it optional and getting nulls that could mean either.

**9 appointment status codes** (element 1652) — and these are *time-commitment shapes*,
not statuses in the ordinary sense: `AA` Pick-up Appointment Date and/or Time,
`AB` Delivery Appointment Date and/or Time, `AC` Estimated Delivery Appointment,
**`ED` Deliver No Earlier Than**, **`LD` Deliver No Later Than**, `EP` Pick-up No
Earlier Than, `LP` Pick-up No Later Than, **`X9` Delivery Appointment *Secured on*
This Date and/or Time**, `XA` Pick-up Appointment Secured on This Date and/or Time.

Two ideas there. First, `ED`/`LD`/`EP`/`LP` express a **one-sided constraint** — "no
earlier than" and "no later than" as separate assertions, which composes into a window
without requiring one. An HHG delivery spread is literally `ED` + `LD`. Second, `X9`/`XA`
say *when the appointment was secured* — **the appointment has a making-of date
distinct from the appointment date**, which is exactly the "when was this promised"
provenance p44 loses when a window is overwritten.

### The rest of the conversation

- **`Q7 Lading Exception Code`** sits inside the 214's status loop (max 10 per status) —
  a cargo-condition exception attached to the status that reported it, and the hook a
  claim starts from.
- **`EFI` + `BIN`** (Loop 0260) lets a 214 carry **binary data inline** — a scanned POD
  or photo travelling with the status that references it.
- **The 210 charges per stop and per line item**: Loop 0300 `S5` with its own `N9`/`G62`
  /`H3`, then Loop 0400 `LX` → `L0` (quantity and weight) → `L1` (rate and charges) →
  `L7` (tariff reference), plus `POD Proof of Delivery` at line-item and carton grain and
  `L3` totals. **Charges attach to the stop and the line, not only to the shipment** —
  which is what an accessorial at destination *is*.

## Time, identity, evidence

**Time.** The `AT7-05/06/07` chain (date → time → time code) is the most disciplined
time model in this cluster and it is enforced *syntactically*: a time may not appear
without a date; a zone may not appear without a time. That gives, for free, three
legitimate precisions — **date-only**, **date+time**, **date+time+zone** — and makes it
impossible to fabricate the precision you do not have. Compare: the eBOL standard emits
`'2021-05-20T00:00:00.000'` for a date, which is a false instant; p44 has four distinct
time *types* but no rule preventing a zoneless one.

The planned/actual/estimate distinction is carried **in the status code itself** (`AG`
Estimated Delivery vs `X1` Arrived at Delivery Location vs `AB` Delivery Appointment),
not in a field. That is a third design — OTM puts it in a `lifecycle` enum on the
record, p44 in named fields, X12 in the code. Each is defensible; **what X12 buys is
that every new temporal reading is a code addition, and that a message never has to say
which of its five time fields is authoritative.** What it costs is that a consumer must
know 42 codes to answer "when did it arrive?".

`G62 Date/Time` (in the 204 header, per stop, and in the 990) is the same
qualified-date + qualified-time device seen in the 858 — appointment, requested, actual
and estimated dates all ride the same segment under different qualifiers.

**Identity.** The 214's `B10` is the cleanest statement of the two-party identity
problem anywhere in this cluster:

- `B10-01` Reference Identification — *"Carrier-assigned reference/PRO number"*
- `B10-02` Shipment Identification Number — *"Shipper-assigned shipment identifier; no
  blanks/special characters"*
- `B10-03` SCAC — **mandatory in the 214**
- `B10-04` Inquiry Request Number — *"Number assigned by inquirer"*
- `B10-05/06` a further qualifier+value pair — *"Carrier bar code ID or manifest number"*

**Four identifiers side by side, each labelled by who assigned it**: carrier's PRO,
shipper's shipment number, the carrier itself (SCAC), and the asking party's own inquiry
number. A model that cannot carry all four cannot participate in this conversation.
Add `MS2` (*"the owner, the identification number **assigned by that owner**, and the
type of equipment"*) and the pattern is consistent throughout: **an identifier is
(issuer, kind, value)**.

`L11 Business Instructions and Reference Number` is the general extension slot, with a
header max use of **300** in both the 204 and the 214 and further allowances inside
every loop — X12 assumes a shipment carries dozens of cross-references and gives them a
qualified, repeatable home rather than a bag of custom fields.

**Evidence & provenance.** Three devices, and the first is remarkable for 1997:

1. **`B10-07`** — *"Indicates **EDI transmission (Y) or manual key entry (N)** of
   reference numbers."* A per-message flag recording whether the identifiers were
   machine-transmitted or **typed by a human**. That is exactly the
   `trackingType: MOBILE_PHONE | TELEMATICS | API` idea (p44) and exactly the honest
   answer pegII will need to give for most of its facts.
2. **The reason code as attribution** — `AH` Driver Related, `AG` Consignee Related,
   `AM` Shipper Related, `BF` Carrier Keying Error, `BI` Cartage Agent. The
   *responsible party* is part of the reason vocabulary, so "late" always names whose
   late it was. `BF Carrier Keying Error` is a reason code that admits the reporter got
   it wrong — a correction mechanism hiding in a reason list.
3. **`MS1` position on a status** (city/state **or** lat/long) — the status carries the
   evidence of where it was asserted from, at whatever precision is available.

**Corrections.** `B2A` + element 353 is the correction model, and it is the richest of
any source here: `01` Cancellation, `03` Delete, `04` Change, `05` Replace, `07`
Duplicate, `15` Re-Submission, `17` Cancel-to-be-Reissued, `18` Reissue, `25`
Incremental. **Replace vs Change vs Incremental are three distinct update semantics** —
whole-document replacement, field-level change, and delta — and a message says which it
is. Against that, the 214 has **no purpose code at all**: a status message cannot be
retracted, only superseded by a later status with a later timestamp. (The 858's answer —
`BX01 = 01`, revert to prior status — is a partner-level workaround for exactly this
gap, which is why that guide is worth keeping alongside this one.)

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 2 | 2 | 3 | 0 | 2 | 3 | 2 | 3 | **C3=3 is the highest in this cluster**: the 204→990 exchange is a genuine offer/response protocol with a typed response vocabulary including `B` Conditional Acceptance and `C` Counter Proposal Made (`/element/558`), and every message's *intent* is declared by element 353's 65 purpose codes incl. `17 Cancel, to be Reissued` (`/element/353`). `B1-03` is *"the booking date accepted by the carrier"*. C1 held at 2: there is no order, no estimate, no survey, no service catalogue — a tender is not an order for service. C2=2: codes are named and glossed but not defined. C8=3: purpose codes + `L11` + qualifier extension. |
| A2 Shipment structure | 2 | 1 | n/a | 0 | n/a | 2 | 1 | 2 | `AT8` weight/packaging/quantity at three grains, `L5` description/marks, `LAD` lading detail, `OID` order detail per stop, `MAN` marks and numbers (max 9999), `CD3` carton detail, `AT5` bill-of-lading handling requirements. Structure is expressible; **semantics are thin** — everything is qualifier-coded and the definitions live in code lists we did not read (element 355 has 794 values). C4=0: no HHG article, vault, carton-by-room or unpacked-item concept. |
| A3 Trip, stop & assignment | 3 | 3 | 2 | 1 | 3 | 3 | 2 | 3 | **The strongest A3 in this cluster.** `S5` as a shared stop primitive across four transaction sets, with a **mandatory** stop reason from a 19-value purpose vocabulary that includes `PL` Part Load / `PU` Part Unload / `CN` Consolidate / `TL` Transload / `DT` Drop Trailer / `WL` Weigh Loaded (`/element/163`); per-stop parties, times, quantities, commodities, orders **and equipment** (204 Loop 0380); `S511 Accomplish Code` as the planned-vs-done flag; `MS2` equipment owner+id+type on a status. C4=1 for `WL Weigh Loaded` — the weigh-station stop that yields a weight ticket — and `DT`/`PA`/`RT` trailer-spotting, all recognisable HHG operations. C5=3 on the AT7 date/time/zone chain plus the `ED`/`LD` one-sided constraints. C3=2: `Accomplish Code` exists but no transition rules are stated. |
| A4 Execution events & tracking | 3 | 3 | 2 | 2 | 3 | 3 | 3 | 3 | **The best status vocabulary available to us.** 42 status codes distinguishing arrival at pick-up / terminal / delivery **and dock vs site** (`X5`, `X8`), loading vs loaded vs completed loading (`L1`, `AM`, `CP`), the interline pair `J1`/`R1`, `BC` Storage in Transit, and estimates-as-statuses (`AG`, `B6`, `C1`, `X2`) — `/element/1650`. 86 reason codes organised by **responsible party** with `NS Normal Status` / `NA Normal Appointment` / `BG Other` — `/element/1651`. The syntactic rule that **a status code requires a reason code**. Status at shipment / carton / order grain with `MS1` position and `MS2` equipment. `Q7` lading exception inside the status loop; `EFI`+`BIN` for inline binary evidence. C4=2: `BC` Storage in Transit and the interline pair are genuinely HHG-relevant. **C3=2, not 3**: no transition graph, no invariants, no statement of who may assert which status, and — importantly — **no purpose code on the 214**, so a status cannot be retracted. |
| A5 Storage-in-transit | 1 | 2 | 0 | 2 | 1 | n/a | n/a | n/a | One code, but the *right* code: **`BC` Storage in Transit** (`/element/1650`), modelled as a **shipment status** rather than a stop type or a separate entity — plus adjacent material in `DT` Drop Trailer, `SL`/`SU` Spot for Load/Unload, `S1` Trailer Spotted at Consignee's Location, and holds (`B4` Held for Payment, `B5` Held for Consignee, `BB` Held per Shipper). C4=2 because the concept is named in the industry's own vocabulary. C1=1 / C3=0: no duration, no in/out pair, no storage account, no warehouse party, no delivery-out leg, no permanent-storage boundary. **Useful as the interop token for SIT, not as a model of it.** |
| A6 Documents & evidence | 1 | 1 | n/a | 1 | n/a | 2 | 2 | 2 | `POD Proof of Delivery` as a segment at line-item and carton grain in the 210; `EFI`+`BIN` carrying binary data inside a 214; `AT5` bill-of-lading handling requirements; `MAN` marks and numbers; `K1 Remarks`. The document *is* the message in EDI, so this area is structurally thin. C7=2 for `B10-07` (EDI vs keyed) and `BF Carrier Keying Error`. |
| A7 Charges & billing hooks | 2 | 2 | 1 | 1 | n/a | 2 | 1 | 2 | The 210: `B3` invoice header, `L0` quantity/weight → `L1` rate and charges → `L7` tariff reference per line item, `L9 Charge Detail`, `L3` totals, `ITD` terms of sale, `C3` currency, `C2` bank id, plus a per-stop `S5` loop so **accessorials attach to the stop that incurred them**. `L9 Charge Detail` also appears in the **990**, so a tender acceptance can carry charges. C4=1: line-haul vs accessorial vs tariff reference is the right skeleton; no 400NG, no agent revenue split. |
| A8 Parties & roles | 2 | 1 | n/a | 0 | n/a | 3 | 1 | 3 | `N1` typed-party loops at header, stop, status and carton grain in both 204 and 214, each with `N2`/`N3`/`N4`/`L11` and (in the 214) `G61 Contact`; `MS3 Interline Information` in both. C6=3: parties are role-qualified, repeatable, and appear at every grain. **C2=1 and C4=0**: the role vocabulary itself is element 98's code list, **which we did not read** — so we can say parties are typed and placed, but not what the types are. Flagged as an open question. |
| A9 Identity & cross-references | 3 | 3 | n/a | 2 | n/a | 3 | 3 | 3 | `B10`'s four side-by-side identifiers each labelled by assigner (carrier PRO / shipper shipment id / SCAC / inquirer's number), `MS2`'s *"identification number assigned by that owner"*, `L11` with a header max use of 300, `MAN` marks and numbers at 9999, `PRF` purchase-order reference, `SPO` shipment purchase order detail, `S510 Standard Point Location Code` (the NMFTA location code). C4=2: PRO, SCAC and BOL are literally our identifiers. C7=3 for `B10-07`. C8=3: every reference is qualifier-typed, so new kinds are code additions. |

Areas **A10–A13** are not scored; see Out-of-v1.

**S5 — fit to Pegasus data.** `unknown`; no Pegasus schema was read. The useful framing
for phase 5 is a **conformance question rather than a mapping question**: for each of the
42 status codes and 19 stop reasons, can pegII (and Cloud) produce the fact at all?
Our strong priors: arrive/depart at origin and destination — probably yes; **dock vs
site (`X5`/`X8`)** — almost certainly no; **`CP` Completed Loading** as distinct from
`AM` Loaded on Truck — unknown and worth checking, because HHG genuinely distinguishes
them; **`J1`/`R1` interline** — probably recorded as an agent assignment, not as a
custody event; **`BC` Storage in Transit** — yes as a state, probably not as a
timestamped transition; **reason codes** — almost certainly free text today.

## Strengths worth adopting

1. **A status assertion is `(status, reason, date, time, zone)` and the reason is
   mandatory.** `AT7-01 ⇒ AT7-02 required`, with `NS Normal Status` supplied so the rule
   is always satisfiable. Adopt both halves: making the explanation required and giving
   it an explicit "nothing to explain" value is strictly better than an optional field
   whose null means two different things.
2. **The date → time → time-zone conditional chain.** Three legitimate precisions, and
   the higher one is syntactically unreachable without the lower. This is the right
   model for "delivery spread is a local date range; arrival is an instant with a zone",
   and it is the single most directly transferable rule in this source.
3. **Reason codes organised by *responsible party*, not by symptom.** `Consignee
   Related` / `Shipper Related` / `Driver Related` / `Other Carrier Related` /
   `Cartage Agent` / `Carrier Keying Error`. In HHG, "who caused the delay" drives
   liability, rebilling and claims — so it belongs in the primary axis of the
   vocabulary, not as a derived attribute.
4. **`BF Carrier Keying Error` — a reason code for "we reported it wrong."** The
   reporter can admit error inside the ordinary vocabulary, without a separate
   correction protocol.
5. **A four-valued tender response: accepted / conditionally accepted / counter-proposed
   / cancelled.** HHG tendering to agents is a negotiation. Binary accept/reject forces
   the real answer into a phone call and out of the record.
6. **Message purpose as a field**, with `Original` / `Change` / `Replace` /
   `Incremental` / `Cancellation` / **`Cancel, to be Reissued`** / `Reissue` /
   `Duplicate` / `Re-Submission` / `Draft` / `Information Copy` as distinct values.
   Especially: *replace ≠ change ≠ incremental*, and *cancel-to-be-reissued ≠ cancel*.
7. **One stop primitive shared by tender, response, status and invoice.** If our
   catalogue's stop is not the same object in the planning event, the execution event
   and the billing event, we will have three stops and three reconciliations.
8. **`Stop Reason Code` as a stop *purpose*, mandatory.** A stop is not a location, it
   is *a location plus why we are going there* — and the vocabulary already contains
   `PL` Part Load, `PU` Part Unload, `CN` Consolidate, `WL` Weigh Loaded, `DT` Drop
   Trailer. Partial load/unload at a stop is HHG's daily reality and is a code here.
9. **`S511 Accomplish Code` — the same stop record carries plan and accomplishment.**
   One object, not a planned-stop entity and an actual-stop entity.
10. **Arrival granularity: site vs dock** (`X3`/`X8`, `X1`/`X5`). Detention and crew
    time start at different moments; two codes cost nothing and settle the argument.
11. **The interline pair `J1 Delivered to Connecting Line` / `R1 Received from Prior
    Carrier`.** Custody transfer as **two complementary assertions by two parties**,
    rather than one transfer event owned by nobody. This is the shape for
    origin-agent → hauling-agent → destination-agent handoffs, and it lets the model
    represent a handoff where only one side has reported.
12. **Appointment constraints as one-sided assertions** — `ED` Deliver No Earlier Than,
    `LD` Deliver No Later Than, composed rather than a single window; plus
    **`X9`/`XA`: when the appointment was *secured*.** The securing date is the
    provenance p44 loses; carry it.
13. **`B10-07`: was this keyed by a human or transmitted by a machine?** A one-bit
    provenance flag at message grain. For pegII, where most facts are typed into a form,
    this is the honest answer and it costs one field.
14. **Status reported at shipment, carton and order grain with the same vocabulary.**
    "Where is item 47?" and "where is the shipment?" answered by one code list at two
    grains. Directly relevant to HHG partial delivery and per-item claims.
15. **Charges attach to the stop and the line item, not only the shipment** (210 Loop
    0300 / Loop 0400). An accessorial is incurred *somewhere*; the billing hook should
    name where.
16. **Identifiers travel in labelled sets** — carrier's, shipper's, inquirer's, owner's,
    all at once, each qualified. `(issuer, kind, value)` throughout.

## Weaknesses / traps

- **A dictionary is not an implementation.** Every partner profiles it: the 858 guide in
  this cluster marks ~50 of 60 segments "Not Used", and turns off the time-zone element.
  Never assume an inbound 214 carries `AT7-07`, `MS1`, or a reason code beyond `NS`.
  Our conformance profile must state which fields are non-negotiable *for us*.
- **The 214 has no purpose code**, so a status cannot be cancelled or corrected — only
  superseded. If we consume 214s we need our own supersession rule; if we emit them, we
  must accept that a wrong status is permanent in the partner's system. This is the
  single biggest gap in the standard for a system of record.
- **The code lists are licensed.** The registry is explicit: *"Reference code lists,
  never copy them into the repo."* Cite by element number; do not paste 1650/1651 into
  `model/` or `catalog/`.
- **Stedi's rendering is non-normative** and several pages report "Codes (N)" without
  rendering them (element 163's list came from the element page, not the segment page;
  element 353's full 65 were not all shown; `element/98` party roles, `element/355` units
  and `element/623` time codes were not read at all). Do not treat any count or
  definition here as authoritative without X12 Glass (src:x12-transportation).
- **42 status codes is a *flat* list mixing granularities and tenses.** `AG Estimated
  Delivery` sits beside `X1 Arrived at Delivery Location` and `CA Shipment Cancelled`.
  A consumer must know which codes are estimates, which are actuals and which are
  administrative — knowledge that lives nowhere in the data. If we adopt the vocabulary
  we must add the classification the standard omits.
- **Terminal-centric.** `X4 Arrived at Terminal Location`, `P1 Departed Terminal
  Location`, `B6 Estimated to Arrive at Carrier Terminal` presume an LTL hub network.
  An HHG agent's warehouse is *not* a terminal — it is a party with a storage account —
  and mapping SIT onto terminal codes would lose exactly the facts that matter.
- **`BC Storage in Transit` is a single flat status with no structure.** No start/end, no
  duration, no storage account, no who-is-storing-it, no in/out legs, no
  permanent-storage boundary. It is an interop token, not a model. Using it as the model
  would be the A5 disaster.
- **No actor on a status.** The 214 travels carrier→shipper, so the asserter is implied
  by direction. Inside our model, where several parties (agent, driver, crew, warehouse)
  can assert the same status, the asserter must be explicit.
- **Element 98's party-role code list was not read**, so the role vocabulary — the thing
  A8 most needs from X12 — is an open item, not a finding.
- **Flat-file structure leaks.** `LX Assigned Number` exists only to open a loop; status
  nests under an assigned number rather than under the thing it describes. Loop
  structure is transport, not domain.
- **The 204/990 pair models *tender to a carrier*, not *booking a household move*.**
  There is no shipper-as-householder, no survey, no estimate, no valuation election, no
  order for service. The commercial front of HHG is simply absent, and its absence is
  not a gap in the standard — it is out of scope for it.
- **Two-digit-year-era design habits persist** (fixed-width codes, 2-character
  identifiers, positional semantics). Take the distinctions, not the encoding.

## Out-of-v1 material

- **A10 (survey, estimating & inventory detail).** `AT5 Bill of Lading Handling
  Requirements` (204 header, max 6, and per stop, max 6) is the accessorial/handling
  requirement slot; `PLD Pallet Information`; `MEA Measurements` on equipment;
  `NTE Note/Special Instruction` (204 header max 10, per stop max 20). The 214's
  `Q7 Lading Exception Code` is the cargo-condition vocabulary. The hazmat loop
  (`LH1`–`LH6`, `LFH`, `LEP`, `LHT Transborder Hazardous Requirements`) appears at both
  stop and order grain in the 204 — again the pattern of deferring a regulated catalogue
  to its own regulation.
- **A11 (claims & valuation).** Triggers, richly: status codes `A9` Shipment Damaged,
  `A7` Refused by Consignee, `A3` Shipment Returned to Shipper, `AH` Attempted Delivery,
  `AP` Delivery Not Completed; reason codes `S1` Delivery Shortage,
  `AK` Damaged, Rewrapped in Hub, `BP` Load Shifted, `BS` Refused by Customer; and
  `Q7 Lading Exception Code` as the dedicated segment. No claim entity, no valuation —
  X12 handles claims in other transaction sets entirely.
- **A12 (rating & tariffs).** `L7 Tariff Reference` (210, max 10 per line item),
  `L1 Rate and Charges`, `L0 Line Item - Quantity and Weight`, `L9 Charge Detail`,
  `L3 Total Weight and Charges`, `ITD Terms of Sale`, `C3 Currency`,
  `FreightClass`-equivalent coding via NMFC in the LTL sets. Enough to see that
  *rate + charge + tariff reference* is the industry's tripartite structure — which is
  the shape 400NG will need.
- **A13 (crew, driver & settlement).** Nothing on settlement. Driver appears only as
  reason codes `AH Driver Related` and `D2 Driver Not Available`, and equipment
  availability as `T1`–`T6`. `NM1 Individual or Organizational Name` in the 214's carton
  status loop is the only place a *person* is named on a status — potentially the
  signature-at-delivery slot.
- **Beyond the rubric.** `S510 Standard Point Location Code` (the NMFTA SPLC geocode)
  is the industry's own location identifier and pairs with src:nmfta-scac. The 211
  (Bill of Lading), 212 (Delivery Trailer Manifest) and 213 (Shipment Status Inquiry)
  were not read and are the obvious next three: **212 in particular is a *trailer
  manifest*, i.e. the consolidation document, and is the most likely place X12 models
  what we call a trip.**

## Open questions

1. **Element 98 — what are X12's party role codes?** A8 is the area where we most need a
   vetted role vocabulary, and it is the one list we did not read. Fetch
   `/element/98` (and the `N1` segment page) before phase 3 scores A8, or the score
   above is provisional.
2. **Is the 212 Delivery Trailer Manifest the missing trip source?** Every source in this
   cluster fails A3's consolidation question. A manifest is by definition *"multiple
   shipments on one trailer"* (the eBOL's `manifestId` says so explicitly). Worth
   reading before concluding that no standard models our trip.
3. **Do we adopt "status implies reason, with an explicit Normal value"?** It is cheap,
   it makes the catalogue self-explaining, and it forces the reason vocabulary to be
   designed up front rather than accreted. Decide in A4.
4. **Which of the 42 status codes can pegII actually produce today?** This is the most
   useful concrete gap list we can build, and it doubles as the EDI-readiness answer.
   Run it as a checklist in phase 5 against `src:pegii-order` / `src:pegii-longhaul`.
5. **How do we represent custody transfer — one event or two?** `J1`/`R1` is two
   complementary assertions; OTM's `HandOver` is one action with `from`/`to`. Two
   assertions survive a partner who never reports; one action is cleaner internally.
   A4/A8 decision.
6. **What is our supersession rule for a status we got wrong?** The 214 offers none,
   the 858 partner-guide invents one (`BX01=01`, revert to prior), element 353 has a
   rich set for *documents*. Our catalogue needs an explicit answer — and the answer
   should probably be an append-only correcting event, since a published event cannot be
   unpublished.
7. **Registry housekeeping (orchestrator, not done here):** `stedi-x12-reference` has
   `status: candidate` and a single URL; it is now read, and the pages actually consulted
   are listed in this file's front matter. Its `areas` list (`[A1, A3, A4, A6, A7, A9]`)
   should gain **A5** — `BC Storage in Transit` is the only standard token for SIT we
   have found — and **A8**, pending the element-98 read.
