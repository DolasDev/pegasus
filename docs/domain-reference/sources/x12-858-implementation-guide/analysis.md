---
source: src:x12-858-implementation-guide
analyzed: 2026-09-17
evidence_grade: A
material: |
  sources/x12-858-implementation-guide/local/858.pdf — read in full, all 44 pages,
    via the scratchpad pdf2txt extractor.
    sha256 042dd63e527f26c743acef7c2e00a1a0087569cb9824a4153e63e0f46fe6ca3a
  PUBLISHER IDENTIFIED (the registry records "unidentified (user-supplied)"):
    the document is **FCA US** — "IMPLEMENTATION GUIDELINES FOR ANSI ASC X12 EDI
    CONVENTIONS / CARRIER ELECTRONIC NOTIFICATION OF TRAILER STATUS (CENTS) /
    SHIPMENT INFORMATION (858) TRANSACTION SET", by "FCA US / INFORMATION &
    COMMUNICATION TECHNOLOGY MANAGEMENT", ANSI ASC X12 VERSION/RELEASE **003010**
    (p.1). Page footers read "04/15/2023 V/R 003010 … FCA US"; Appendix A's change
    log traces the imprint Daimler → Chrysler LLC → Chrysler → FCA US → Stellantis
    ("03/16/2023: Updated Logo to Stellantis", p.44).
  NOT read: nothing — the PDF is text-extractable end to end. What does not exist
    in it: the underlying X12 003010 standard itself (this is a *subset guide*, and
    it marks most of the standard "Not Used"), any 214/204/990 companion guide, and
    any trading-partner-specific addendum.
---

# X12 858 Shipment Information — FCA US "CENTS" implementation guide — analysis

## What it is

A **trading-partner implementation guide**: one large shipper's subset of a single
X12 transaction set, written so its carriers can build to it. It is not a standard,
it is a *use* of one, and that is precisely its value — it shows what an EDI partner
actually requires versus what the standard offers.

The transaction set's own purpose, quoted from the guide's introduction (p.2):

> *"This standard provides the format and establishes the data contents of a shipment
> information transaction set. The shipment information transaction set provides the
> sender with the capability to transmit detailed bill-of-lading, rating, and/or
> scheduling information pertinent to a shipment."*

And FCA's narrowing of it (p.2):

> *"FCA US uses the Shipment Information (858) Transaction Set to convey **equipment
> status** and **load tender** information to participating carriers on the Carrier
> Electronic Notification of Trailer Status (CENTS) System."*

**S1 kind:** `message-standard` (a partner guide over one). **S2 adoption: 1** as a
*document* — it is one OEM's private convention — but the **segments it uses (BX, N9,
G62, N7, M7, REF, N1/N2/N3/N4, S5, LX, SE) are the industry-wide motor-carrier
vocabulary**, shared with the 204 and 214, so the vocabulary it teaches scores far
higher than the document does. **S3 openness:** `public` per the registry, licence
unstated; it is a partner guide distributed to carriers. Stored `local/` pending
licence confirmation.

**What our reading covered:** all 44 pages — the two transaction-set tables
(heading/detail/summary with base-vs-user status for every segment), all ten segment
specifications FCA actually uses, the transaction-set notes, eight fully worked
examples with element-by-element interpretation, and Appendix A. Evidence grade **A**.

**Two warnings before using it.** First, **version 003010 is archaic** — X12 004010 is
what anyone implements today (see src:stedi-x12-reference), and element attributes
differ (003010 dates are `DT 6/6` = YYMMDD; 004010 is `DT 8/8` = CCYYMMDD). Second,
**the use case is automotive yard/trailer management, not household goods.** Its
"shipment" is a returnable-container run between plants and suppliers. Read it for
*mechanism*, never for *domain*.

## Model summary

An 858 instance is a flat, ordered segment stream in three levels. FCA uses a very
small subset; the guide's tables mark the overwhelming majority of the standard's
segments *"Not Used"* — of roughly 60 heading segments in the base standard, FCA keeps
**ten**.

```
Heading
  ST     Transaction Set Header            "858" + control number      (M)
  BX     General Shipment Information      purpose, mode, payment,
                                           shipment id, SCAC           (M)
  N9     Reference Number                  ← the STATUS carrier        (≤30)
  G62    Date/Time                         qualified date + qualified time (≤10)
  PER    Administrative Communications Contact                          (≤3)
  ─ LOOP N7 (≤600) ───────────────────────────────────────────────────
      N7   Equipment Details               trailer / railcar number
      M7   Seal Numbers                    up to 4 seals
      REF  Reference Numbers               YS = Yard Position
  ─ LOOP N1 (≤10) ────────────────────────────────────────────────────
      N1   Name                            SF = Ship From (plant code)
  ─ LOOP S5 (≤5) ─────────────────────────  the STOP-OFF loop ────────
      S5   Stop-off Details                stop sequence + stop reason
                                           + weight + qty
      N9   Reference Number                part number / shipper status
      ─ LOOP N1 (≤5) ──────────────────────
          N1  Name                         SF Ship From | ST Ship To
          N2  Additional Name Information
          N3  Address Information
          N4  Geographic Location          city/state/postal/country
          REF Reference Numbers            SI = Shipper's ID for Shipment (SID)
Detail
  ─ LOOP LX (≤999) ───  LX Assigned Number  (FCA: always "1")
Summary
  SE     Transaction Set Trailer           segment count + control number
```

Four things this structure teaches, none of which are automotive-specific.

**1. One transaction set, two completely different business messages, discriminated by
one code.** BX01 (Transaction Set Purpose Code) selects between them (p.7):

> *"The BX segment is used by FCA US for 2 distinct purposes: 1. Trailer Status
> Notification 2. Load Tenders Notification… A unique purpose code (BX01) of '08' is
> used to specify that this transaction set relates to data about carrier trailers at a
> specific site. This includes notification for Empty or Arrival… The load tender set
> uses a purpose code (BX01) of '00' to alert a carrier that one or more of its
> trailers is ready to be picked up…"*

**A message's *kind* is a field, not a schema.** The same segment layout serves an
operational status notification and a commercial tender.

**2. Correction and deletion are purpose codes on the same message.** BX01 takes `00`
Original, `01` Cancellation, `03` Delete, `08` Status — and the guide defines the
*semantics of each*, which the base standard does not (p.7):

> *"A purpose code (BX01) of '01' is used to specify that the previous status
> transmitted for the specified trailer should be **disregarded and the prior status
> should be considered the current status**."*
>
> *"A purpose code (BX01) of '03' is used to specify that the previous trailer
> information transmitted should be **removed from the carrier applications system**."*

That is the cleanest statement of **reversal vs deletion** in any source in this
cluster. `01` is *undo the last assertion and restore the one before it* — a
retraction that names its effect on history. `03` is *forget this record*. They are
different operations and both are spelled out. Worked example 4, "Status - Trailer
Arrival Cancellation" (p.35), shows `01` in use, and it carries **the full original
context** (equipment, yard, plant, stop) so the receiver can identify what is being
retracted.

**3. A status is a *reference number*, not a status field.** This is the guide's
strangest and most instructive move. FCA carries the trailer's status in N9 — a generic
reference-number segment — using the qualifier `ZZ` (*"Mutually Defined"*), with the
status code in the value slot and its effective date/time in N904/N905 (p.10):

> *"If N901 = 'ZZ', one of the following values is assigned: 'A5' = Arrival, 'C' =
> (Trailer) Cancel- Revert to prior status, 'D' = (Trailer) Delete, 'E' = Empty,
> 'E4' = Mixed Load, 'E8' = Outbound with containers, 'E9' = Outbound with material,
> 'G0' = Departed… If N901 = 'ZZ', the **current status effective date** … the current
> status effective time."*

So the status vocabulary is **eight privately-agreed codes smuggled through a generic
extension point**, each with its own effective date and time. This is what "we needed a
status and the message had no status field" looks like in production, and the same
device appears twice — a second N9 inside the S5 stop loop carries the *shipper's*
status (`'C' = shipper cancel`) with its own date and time (p.20).

**4. The stop-off loop is the trip, and it is per-stop, not per-shipment.** `S5` is
`{Stop Sequence Number, Stop Reason Code, Weight, Weight Unit, Number of Units Shipped,
Unit of Measure}` (p.18), each stop carrying its own quantities and its own
origin/destination party pair. Worked example 2 (pp.29–32) is a **3-stop load tender**:
S5~1~LD (13 000 lb, 75 EA, part 0CC00091) at Jefferson North Assembly → BBD Elect;
S5~2~LD (2 000 lb, 20 EA, part CC3) → Valine; S5~3~LD (6 000 lb, 50 EA, part C10) →
Harper Mfg — **one trailer, one transaction, three consignments, each with its own SID,
weight, count and destination.** That is consolidation, expressed with no
consolidation concept: a sequence-numbered stop list where each stop names its own
`REF~SI~<SID>` shipper's shipment number.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite (`local/858.pdf`) |
| --- | --- | --- | --- |
| Shipment Information (858) | *"provides the sender with the capability to transmit detailed bill-of-lading, rating, and/or scheduling information pertinent to a shipment"* | A2, A6 | p.2 |
| CENTS | *"Carrier Electronic Notification of Trailer Status"* — the named business system | A4 | p.1, p.2 |
| Status Usage | *"notify carriers in a timely manner of the current status of trailers on site… When trailers become 'empty' and are available for re-use by carriers, the **owning (responsible) carrier** will be notified"* | A4, A8 | p.2 |
| Load Tender Usage | *"notify a specific carrier that material and/or containers now on a specific trailer are now ready for transport to the designated destination(s). The load specifics will indicate content (description and quantity), destination and billing details. The loads may be for a single destination, or for **multiple or drop off destinations**."* | A1, A3 | p.2 |
| `BX01` Transaction Set Purpose Code | `00` Original, `01` Cancellation, `03` Delete, `08` Status — each given a business meaning by the guide | A1, C3, C7 | p.7–8 |
| `BX02` Transportation Method/Type Code | 20+ modes, incl. three *consolidation* modes defined in the standard: `GG` *"Geographic Receiving/Shipping: A collection of shipments which involve multiple origins, multiple destinations, **a single trailer**, and are paid under **a single freight bill**"*; `GR` (single origin, multiple destinations); `GS` (multiple origins, single destination); plus `PP` *"Pool to Pool: Shipment moves from one consolidation point to another consolidation point before final delivery"*, `C` Consolidation, `LT` LTL, `M` Motor (Common Carrier), `P` Private Carrier, `X` Intermodal | A2, A3 | p.8 |
| `BX03` Shipment Method of Payment | FCA subset: `NR` Non Revenue (*"Payment method not applicable for CENTS status or load tender information"*), `RC` Return Container Freight Paid by Customer, `RF` Return Container Freight Free | A7 | p.8 |
| `BX04` Shipment Identification Number | *"Identification number assigned to the shipment **by the shipper** that uniquely identifies the shipment **from origin to ultimate destination and is not subject to modification**; (Does not contain blanks or special characters)"* | A9 | p.8 |
| `BX05` Standard Carrier Alpha Code | *"SCAC of the original carrier receiving the shipment"* / *"Standard Carrier Alpha Code of carrier performing the move"* | A8, A9 | p.7, p.9 |
| `BX10` Status Report Request Code | *"Code used by the shipper to specify that an **automatic status report is requested when the shipment is delivered**"* (FCA sends `N` Not Required) | A4, C8 | p.9 |
| `N9` Reference Number | *"To transmit identifying numbers **and descriptive information** as specified by the reference number qualifier"* — qualifier + value + date + time | A9, C8 | p.10 |
| N9 `ZZ` status values | `A5` Arrival, `C` Cancel — revert to prior status, `D` Delete, `E` Empty, `E4` Mixed Load, `E8` Outbound with containers, `E9` Outbound with material, `G0` Departed | A4 | p.10 |
| N904 / N905 | *"the current status **effective** date"* / *"effective time"* | A4, C5 | p.10 |
| `G62` Date/Time | *"To specify pertinent dates and times"*: a **qualified** date (`89` = First Arrival Date) plus a **separately qualified** time (`R` = Actual Arrival Time) | A4, C5 | p.11 |
| `N7` Equipment Details | *"To identify the equipment"*; FCA: *"N702 will contain the unique railcar or truck/trailer number"* — the base segment carries 22 elements (tare weight, volume, ownership, temperature control, length, height, width, equipment type) of which FCA uses **one** | A3 | p.13–14 |
| `M7` Seal Numbers | *"To record seal numbers used **and the organization that applied the seals**"*; up to four seals per segment, M705 = the applying entity | A3, A6, C7 | p.15 |
| `REF~YS` | Reference Number Qualifier `YS` = **Yard Position** — *"the yard designators at plants where multiple yards exist"* (example values `NORTH YARD`, `SOUTH YARD`) | A3, A5 | p.16, p.28 |
| `REF~SI` | `SI` = *"Shipper's Identifying Number for Shipment (SID)"*; FCA: *"The REF segment will be related to and associated with **origin points only**"* | A9 | p.25 |
| `N1` Name | *"To identify a party by **type of organization**, name, and code"*; `N101` Entity Identifier Code = `SF` Ship From / `ST` Ship To; `N103` Identification Code Qualifier = `92` *"Assigned by Buyer or Buyer's Agent"* | A8, A9 | p.17, p.21 |
| `N104` Identification Code | *"Code identifying a party"* — *"If N101 = 'SF', the assigned supplier code of the shipping location; if N101 = 'ST', Receiving plant code or FCA US assigned supplier code of non-FCA location"* | A8, A9 | p.21 |
| `S5` Stop-off Details | *"To specify stop-off details in terms of weight, quantity and volume"*; `S501` Stop Sequence Number = *"Identifying number for the specific stop **and the sequence in which the stop is to be performed**"* ('1' through '99') | A3 | p.18 |
| `S502` Stop Reason Code | FCA subset: `CL` Complete, `LD` Load (the base 004010 list has 19 values — see src:stedi-x12-reference) | A3, A4 | p.18 |
| `S511` Accomplish Code | present in the segment, marked *"Not Used"* by FCA — the standard's slot for *"has this stop been accomplished"* | A3, A4 | p.19 |
| `LX` Assigned Number | *"To reference a line number in a transaction set"* (FCA: always `1`) | A2 | p.26 |
| `SE01` Number of Included Segments | *"Total number of segments included in a transaction set including ST and SE segments"* — a self-describing integrity count | C7 | p.27 |
| Base status vs User status | every segment row carries both: what the **standard** allows (`O`/`M`) and what **this partner** does (`M`, a max-use, or `Not Used`) | C8 | pp.2–5 |

## Lifecycles & events

**The status vocabulary** (N9 `ZZ`, p.10) is eight codes covering three different
lifecycles at once, which is itself worth noticing:

- *physical presence of equipment*: `A5` Arrival, `G0` Departed;
- *content state of equipment*: `E` Empty, `E8` Outbound with containers, `E9`
  Outbound with material, `E4` Mixed Load;
- *message lifecycle*: `C` Cancel — revert to prior status, `D` Delete.

Every one is timestamped with its **effective** date and time (N904/N905), separately
from any date in G62 and separately from the interchange time. The worked examples show
the two diverging routinely: example 5 (p.36, Trailer Arrival Notification) has the
status effective at `141011~0916` and G62 first-arrival at `141011~0916`; example 7
(p.38) has status `E9` effective `150407~0916` while G62 first arrival is `150406~1100`
— **a status asserted a day after the arrival it describes**. The effective/asserted
split is real and is used.

**The eight worked examples are a small lifecycle catalogue**, and collectively they
are the most useful part of the document:

| # | Name (guide's own title) | BX01 | N9~ZZ | Shape | p. |
| --- | --- | --- | --- | --- | --- |
| 1 | Status - Empty Trailer Notification | `08` Status | `E` | 1 stop `CL`, no weights | 28 |
| 2 | Load Tender - 3-Stop Container Return; 3 Container Types | `00` Original | `E8` | 3 × `S5~n~LD` with weight/qty/part, each with own SF/ST pair and SID | 29–32 |
| 3 | Load Tender - 1 Stop Container Return | `00` | `E8` | 1 stop | 33–34 |
| 4 | Status - Trailer Arrival Cancellation | `01` Cancellation | `C` | full original context repeated | 35 |
| 5 | Status - Trailer Arrival Notification | `08` | `A5` | 1 stop `CL` | 36 |
| 6 | Status - Trailer Departure Notification | `08` | `G0` | 1 stop `LD`, **no REF~YS** (it has left the yard) | 37 |
| 7 | Load Tender - 2-Stop Container and Material Return | `00` | `E9` | 2 stops | 38–40 |
| 8 | Load Tender - Container/Material Return **with Shipper Cancel** | `00` | `E9` + stop-level `C` | cancel expressed **inside one stop**, not for the whole tender | 41–43 |

Example 8 is the important one. The tender's own purpose code stays `00` Original; the
cancellation is a **second N9 with value `C` and its own date/time, scoped to stop 1**
(p.42). **A cancellation can be scoped to a stop rather than to the message** — which is
exactly the HHG case where one shipment on a consolidated load cancels and the trip
proceeds. The guide's own gloss on the stop-level N9: *"If N901 = 'ZZ', shipper (update)
status ('C' = shipper cancel)… shipper status update date… shipper status update time"*
(p.20).

**What the lifecycle does *not* have.** No state machine, no legal-transition table, no
statement of who may cause which transition beyond *"used by FCA US to notify
carriers"* (the direction of the message is the authority model), no acknowledgement or
response transaction inside the 858 — the tender is fire-and-forget here, because the
carrier's accept/decline is a separate transaction set entirely (the 990; see
src:stedi-x12-reference). And `BX10 Status Report Request Code` — *"an automatic status
report is requested when the shipment is delivered"* — shows the standard expects the
**subscription to status to be requested per shipment**, a neat idea FCA switches off.

## Time, identity, evidence

**Time.** Everything about time in X12 is *qualified*, and the 858 shows why that
matters.

- `G62` carries a **date qualifier** (`G6201`) and a **separately qualified time**
  (`G6203`). FCA uses `89` = *"First Arrival Date"* with `R` = *"Actual Arrival Time"*
  (p.11). The qualifier is the semantics: the same segment shape carries a promised
  date, an actual date or an estimate depending on one code. **The planned/actual/
  estimate distinction lives in a qualifier, not in a field name** — the opposite of
  p44's approach (named fields) and OTM's (a lifecycle enum on the record), and it
  scales to a hundred meanings at no structural cost.
- `G6205 Time Code` exists in the segment (the element that carries the UTC offset) and
  FCA marks it **Not Used** (p.11). So every time in a CENTS message is **zoneless
  local time at an unnamed location**. This is the archetypal EDI time-zone failure and
  we should expect it from any partner: *the standard has the field, the partner turns
  it off.*
- Dates are `DT 6/6` — **YYMMDD, two-digit year** (003010). Times are `TM 4/4`, HHMM,
  documented as *"24-hour clock time (HHMMSS) (Time range: 000000 through 235959)"* —
  the description and the attribute disagree, which is itself a caution about partner
  guides.
- **Effective time vs event time vs transmission time are three different things** and
  all three are present: N904/N905 (*"current status effective date/time"*), G62
  (first arrival date + actual arrival time), and BX04's own value, which in every FCA
  example is a **timestamp used as the shipment id** (`1408081440`, `141221131135`,
  `150407113506`).

**Identity.** Five distinct identifier mechanisms, all typed by a qualifier:

1. **`BX04` Shipment Identification Number** — the strongest definition of an
   identifier in this cluster: *"assigned to the shipment **by the shipper** that
   uniquely identifies the shipment **from origin to ultimate destination and is not
   subject to modification**"* (p.8). Assigner, scope, and **immutability**, in one
   sentence. FCA populates it with a creation timestamp.
2. **`BX05` SCAC** — *"the SCAC of the **original** carrier receiving the shipment"*
   (p.7) versus *"carrier performing the move"* (p.9). The guide manages to give two
   different definitions of the same element on facing pages; in an interline that
   distinction is the whole question.
3. **`N7` Equipment Number** — the trailer/railcar number, the join key for the whole
   status flow. Examples show heterogeneous formats (`A1234`, `12-3456`, `789012`,
   `BB667`), and N718 *"Equipment Number Check Digit"* exists in the standard
   (Not Used here).
4. **`N9` qualifier + value + date + time** — the generic, extensible reference slot,
   with `ZZ` = *"Mutually Defined"* as the documented private-agreement escape hatch.
   Note it carries a **date and time of its own**, so a reference is timestamped.
5. **`N1` party identity** = `{N101 role, N103 code-qualifier, N104 code}`, where
   `N103 = 92` means *"Assigned by Buyer or Buyer's Agent"*. **The identifier declares
   whose numbering scheme it belongs to**, separately from the value. `REF~SI` adds the
   shipper's own shipment number (SID) *per stop*, and FCA states the binding rule
   explicitly: *"The REF segment will be related to and associated with **origin points
   only**"* (p.25) — i.e. a SID belongs to the stop that originated it, not to the
   destination. On a 3-stop tender that is what keeps three consignments apart
   (examples 2 and 7 show SIDs 940000, 948001, 948731).

**Evidence & provenance.** Thin but pointed.

- **`M7` Seal Numbers** — *"To record seal numbers used **and the organization that
  applied the seals**"* (M705, p.15). The physical integrity evidence and **who
  asserted it** in one segment. FCA uses it for *"arriving trailer seal numbers"*.
- **`REF~YS` Yard Position** — the trailer's location *within* a site (`NORTH YARD`,
  `SOUTH YARD`), a sub-location grain below the stop. Present in the arrival and
  status examples and **absent from the departure example** (example 6, p.37), which is
  a quiet but correct modelling decision: a departed trailer has no yard position.
- **`SE01`** — the segment count, a self-describing integrity check on the message.
- **The purpose code is the provenance of a correction** (`01` = disregard the previous
  status; `03` = remove it), with the retraction carrying the full original context so
  the receiver can find what to undo.
- Otherwise there is **no actor on a fact**: the message direction implies the asserter
  (FCA → carrier), and no element records who keyed it. `PER` (Administrative
  Communications Contact) names *"Manufacturing Plant Contact"* with a phone number —
  a human to call, not the source of the assertion.

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 2 | 2 | 0 | 1 | 2 | 2 | 2 | Tender-out only, no response (accept/decline is the 990, not here). C2=2 and C3=2 rest entirely on the BX01 purpose codes being **given business meanings** — `01` *"the previous status… should be disregarded and the prior status should be considered the current status"*, `03` *"removed from the carrier applications system"* (p.7) — plus stop-scoped shipper cancel in example 8 (p.41–43). No states, no authority model, no offer/award/accept. |
| A2 Shipment structure | 1 | 2 | n/a | 0 | n/a | 2 | 1 | 1 | Shipment = BX04 id + per-stop weight/quantity (S503–S506) + part number (`N9~PM`). No commodity description in FCA's subset (L5/L0 all "Not Used"). C2=2 for `BX02`'s consolidation modes, which **define** multi-origin/multi-destination/single-trailer/single-freight-bill combinations as named modes (p.8) — a genuinely precise vocabulary for what kind of movement this is. |
| A3 Trip, stop & assignment | 2 | 2 | 1 | 0 | 2 | 2 | 1 | 2 | The area this source is worth reading for. `S5` = sequence number + reason + quantities, repeated, each stop with its own SF/ST party pair and SID; equipment identified once at the top and shared across all stops (`N7` loop, ≤600); `REF~YS` sub-location; worked 3-stop example (pp.29–32). **Consolidation is expressible with no consolidation concept.** C1 held at 2: no driver, no crew, no vehicle beyond a trailer number, no leg/route, and `S511 Accomplish Code` — the standard's "was this stop done" slot — is switched off. C5=2 for per-stop date/time and qualified G62; no zone. |
| A4 Execution events & tracking | 2 | 2 | 1 | 0 | 2 | 1 | 2 | 2 | Eight status codes (`A5`, `G0`, `E`, `E4`, `E8`, `E9`, `C`, `D`) each with an **effective date and time** (p.10), a worked arrival / departure / empty / cancellation set (examples 1, 4, 5, 6), and `BX10`'s per-shipment *"automatic status report… when the shipment is delivered"* subscription idea (p.9). C2 held at 2 and C1 at 2: these are *equipment* statuses, arrive/depart at one site — no in-transit, no ETA, no position, no exception vocabulary, no delay reason. C7=2 for cancellation-as-retraction plus M7 seal-applier. |
| A5 Storage-in-transit | 1 | 1 | n/a | 0 | 1 | 1 | n/a | n/a | Scored, unusually, because the **entire business case is equipment dwelling at a site**: a trailer that is `E` Empty is *"available for re-use"*, it has a `REF~YS` yard position, it has an arrival time and later a departure, and the stop reason `CL` Complete distinguishes "sitting here" from `LD` Load. That is the structural skeleton of a storage interval — arrival, location within site, state, release, departure — even though nothing here is SIT (no storage account, no lot, no charge clock, no in/out legs, no permanent-storage boundary). C1=1 for the skeleton only; do not over-read it. |
| A6 Documents & evidence | 1 | 1 | n/a | 0 | n/a | 1 | 1 | n/a | The 858's stated purpose includes *"detailed bill-of-lading… information"* (p.2), but FCA uses none of that: the L5/L0/L1/L7/L3 lading, rating and tariff segments are all "Not Used". What remains as evidence: `M7` seal numbers with the applying organisation, and `SE01` as a message integrity count. |
| A7 Charges & billing hooks | 1 | 1 | n/a | 0 | n/a | n/a | n/a | n/a | `BX03` Shipment Method of Payment with three values, one of which (`NR` Non Revenue) exists to say *"Payment method not applicable"* — a useful admission that some movements are not billable events. `L1 Rate and Charges` and `L3 Total Weight and Charges` are in the standard and Not Used here. |
| A8 Parties & roles | 2 | 2 | n/a | 0 | n/a | 3 | 1 | 2 | `N1` typed-party loop at two grains (header and per-stop) with `SF` Ship From / `ST` Ship To, full name/address/geo, and — the strong part — `N103` *"Identification Code Qualifier… designating the system/method of code structure used"* with `92` = *"Assigned by Buyer or Buyer's Agent"*. **The party identifier declares whose scheme it belongs to.** C6=3 for that. C4=0: ship-from/ship-to only; no carrier party segment (SCAC is an element on BX), no agent, no consignee-vs-receiver distinction, no driver. |
| A9 Identity & cross-references | 2 | 3 | n/a | 1 | n/a | 3 | 2 | 3 | C2=3 on `BX04`'s definition alone — *"assigned to the shipment by the shipper that uniquely identifies the shipment from origin to ultimate destination and **is not subject to modification**"* (p.8) — assigner, scope and immutability in one sentence. Plus SCAC, equipment number, `REF~SI` SID bound *"to origin points only"* (p.25), `REF~YS` yard position, and `N9` as a timestamped qualifier+value pair. C8=3: `ZZ` Mutually Defined is the standard's own documented private-extension mechanism, and the whole guide is an exercise in profiling a standard by marking base-vs-user status per element. |

Areas **A10–A13** are **not scored** — no material (see Out-of-v1 for the fragments).

**S5 — fit to Pegasus data.** `unknown`; no Pegasus schema was read. One concrete
prior: the CENTS flow is **trailer-centric**, and our tenants' operations are too
(equipment arrives at an agent's yard, sits, is loaded, departs). If pegII has a trailer
or unit number and yard/warehouse location at all, the arrival/dwell/departure skeleton
here is reconstructable from it. Whether pegII records *equipment state* (`E` empty /
`E8` loaded with containers / `E9` loaded with material) as distinct from *shipment
state* is the question to ask — the distinction is real and this source keeps them
apart.

## Strengths worth adopting

1. **Cancellation is a typed message that names its effect on history.** *"the previous
   status transmitted… should be disregarded and **the prior status should be
   considered the current status**"* — a retraction whose semantics ("restore the
   predecessor") are written down, and which is distinct from `03` Delete ("remove it").
   Neither p44 nor OTM nor the eBOL standard says this. Our catalogue needs exactly this
   pair: *retract-to-previous* and *expunge*, with different meanings.
2. **A retraction carries the full original context.** Example 4 repeats equipment,
   yard, plant and stop, so the receiver can identify what is being undone without
   holding a correlation table. A correcting event that carries only a reference is
   useless to a partner who dropped the original.
3. **A cancellation can be scoped to a stop, not the whole message** (example 8). One
   consignment on a consolidated load cancels; the trip proceeds. That is the HHG case
   and it has a worked precedent.
4. **Time semantics live in a qualifier.** `G62 = {date-qualifier, date, time-qualifier,
   time}`. Adding "estimated departure" is a new code, not a new field. Combined with
   **separately qualified date and time** it lets a partner assert a date without a
   time, or an actual time against a planned date, which happens constantly.
5. **"Effective" time is distinct from event time and both are distinct from
   transmission time.** N904/N905 carry the *status effective* date/time; G62 carries
   the arrival date/time; the examples show them a day apart.
6. **An identifier definition that states assigner, scope and immutability.** *"assigned
   by the shipper… uniquely identifies the shipment from origin to ultimate destination
   and is not subject to modification."* That single sentence is the template for every
   identifier row in our A9 model.
7. **A party identifier declares whose numbering scheme it uses** (`N103` code
   qualifier, `92` = "Assigned by Buyer or Buyer's Agent"). Value + issuer + scheme, not
   just value.
8. **A reference belongs to a *stop*, not only to the shipment** — *"related to and
   associated with origin points only."* On a consolidated trip this is what keeps N
   shipments distinguishable, and it is the same shape as p44's route-segment-level
   identifiers.
9. **Sub-location within a site** (`REF~YS` Yard Position), present on arrival, absent
   on departure. A vault position in a warehouse, a bay at an agent's dock — the grain
   below "stop" exists and is cheap to carry.
10. **Seal number *and the organisation that applied it*.** Physical evidence with its
    asserter attached, in one segment.
11. **One message kind discriminated by a purpose code**, so status notification and
    commercial tender share a structure. Worth weighing against a proliferation of event
    types: `<thing>Changed` + a purpose code may beat five near-identical events.
12. **Base status vs user status, element by element.** The guide's tables show, for
    every segment and element, what the standard allows and what *this partner* does
    (`O` → `Not Used`, `O` → `M`). **That is precisely the artefact our integration
    floors + config overlays produce** (`platform/integrations/<id>/`), and it is the
    right shape for a partner conformance profile: publish the catalogue, then publish
    a per-partner profile that marks each event and field required / optional / unused.
13. **`BX10`: subscription to status requested per shipment.** "Tell me when this one is
    delivered" as a field on the tender, not a global webhook configuration.
14. **`SE01` segment count** — a message that states its own size so truncation is
    detectable. A cheap integrity idea for any batch we publish.

## Weaknesses / traps

- **The domain is wrong end to end.** Returnable containers between an OEM's plants and
  its suppliers. Its "shipment" has no consignee in our sense, no householder, no
  service, no valuation, no inventory, no delivery spread. Any *content* taken from here
  is a mistake; only the *mechanisms* transfer.
- **Version 003010, two-digit years.** Do not use this document for element attributes.
  004010 is the baseline anyone will actually send us; check every element against
  src:stedi-x12-reference before believing a length or a format here.
- **Status carried in a reference-number segment via `ZZ` Mutually Defined.** It works,
  and it is a trap: eight privately-agreed codes in a generic slot means **no partner
  can interpret them without the guide**, no validator can check them, and the codes
  collide with the 30 other N9 uses in the same message. If we ever emit EDI, put status
  in the segment designed for it (AT7 in the 214) and keep `ZZ` for genuinely private
  data.
- **Fire-and-forget tender.** Nothing here models accept, decline, counter-offer or
  expiry — the response is a different transaction set. A model built from this document
  alone would have a tender with no answer. (Compare the 990's `Reservation Action Code`
  and p44's `BookingStatus`.)
- **Zoneless local time.** `G6205 Time Code` exists and is switched off. Expect this from
  every EDI partner; never assume an inbound EDI timestamp has a zone, and never emit one
  without.
- **Two definitions of SCAC on facing pages** — *"original carrier receiving the
  shipment"* (p.7) vs *"carrier performing the move"* (p.9). In an interline these are
  different parties. A cautionary tale about partner guides as sources: they are written
  by implementers, not editors.
- **No actor on any fact.** Direction of transmission is the entire authority model. For
  a system of record that is not enough — "who said the trailer was empty" is a real
  question with a real consequence.
- **`S511 Accomplish Code` is Not Used**, so a stop cannot say whether it was
  accomplished; the whole planned-vs-actual question at stop level is simply absent from
  this profile even though the standard has the slot. The lesson generalises: **a
  partner profile can silently delete the very field your model depends on**, so our
  conformance profile must mark which fields are non-negotiable.
- **Subset guides tell you what one partner needs, not what the domain is.** Roughly
  50 of 60 heading segments are marked "Not Used". Reading only this guide would leave
  you believing the 858 has no lading, rating, hazmat or tariff content — it has all of
  them.
- **Flat-file positional thinking leaks into semantics**: `LX~1` always, a `Detail`
  level that exists only to hold a constant, and the 12-character date/time stuffed into
  BX04 as an identifier. Do not reproduce EDI's structural accidents in a
  technology-agnostic model.

## Out-of-v1 material

- **A10 (survey/estimating, inventory detail).** Nothing used, but the *standard's*
  unused segments named in FCA's tables sketch what an 858 can carry and are worth
  knowing when a partner guide arrives: `L5 Description, Marks and Numbers`,
  `L0 Line Item - Quantity and Weight`, `MEA Measurements`, `H3 Special Handling
  Instructions`, `PS Protective Service Instructions`, `H6 Special Services`,
  `N5 Equipment Ordered`, `VC Motor Vehicle Control` (up to 21 per equipment — a vehicle
  manifest, relevant to POV/vehicle shipments), `IC Intermodal Chassis Equipment`
  (pp.2–4).
- **A11 (claims & valuation).** `M1 Insurance` and `Y6 Authentication`, both Not Used
  (p.3). The hazmat loop (`LH1`–`LH6`, `LHR`, `LHE`) is fully enumerated in the detail
  table with three transaction-set notes, including the residue rule — *"All receivers…
  covering empty tank cars which last contained hazardous commodities must be able to
  add the constant words: RESIDUE: LAST CONTAINED ahead of the contents of LHE01"*
  (p.5). The *pattern* — a receiver obliged to render a legally-required constant that is
  not transmitted — is a good cautionary example for A6 (some legal text belongs to the
  renderer, not the message).
- **A12 (rating & tariffs).** `L7 Tariff Reference` (max use 30 at heading, 10 at
  detail), `L1 Rate and Charges`, `L3 Total Weight and Charges`, `ITD Terms of
  Sale/Deferred Terms of Sale`, `C3 Currency` — all present in the standard, all Not
  Used (pp.3–5). Confirms the 858 is a rating-capable set even though this partner uses
  none of it.
- **A13 (crew, driver & settlement).** Nothing. `PER` names a plant contact, not a
  driver.
- **Beyond the rubric.** `N5 Equipment Ordered`, `E1/E4/E5 Empty Car Disposition -
  Pended Destination (Consignee / City / Route)` (p.3) — an entire rail vocabulary for
  *where an empty unit should go next*, which is the equipment-repositioning problem a
  van line also has. `NA Cross-Reference Equipment` (max 999 at heading) is the
  standard's slot for relating one piece of equipment to another — chassis to container,
  tractor to trailer.

## Open questions

1. **Do we model equipment state separately from shipment state?** This source keeps
   them rigorously apart: the trailer is `E` Empty / `E8` loaded-with-containers /
   `E9` loaded-with-material, while the shipment is tendered or not. HHG has the same
   split (a van is loaded, half-loaded, empty; a shipment is packed, loaded, in SIT) and
   conflating them is a classic legacy error. Decide in A3.
2. **What is our retract-vs-delete pair?** BX01 `01` (revert to prior status) and `03`
   (expunge) are two distinct, well-defined operations. Our catalogue needs an explicit
   answer — probably a correcting event that supersedes, plus a separate erasure concept
   for data-protection — and it should be decided in A4/A6 rather than improvised.
3. **Can a cancellation be scoped below the shipment?** Example 8 cancels one stop of a
   multi-stop tender. In HHG: one shipment cancels off a consolidated load; one service
   (a third-party crating) cancels off a shipment. What is the smallest cancellable
   thing in our model?
4. **Do we adopt qualifier-style time typing** (one date field + a qualifier code) **or
   named fields** (p44's `plannedDateTime` / `estimateDateTime` / `actualDateTime`)?
   Qualifiers extend without schema change and map straight onto EDI; named fields are
   far more legible in a JSON event catalogue. This is the same decision flagged in the
   OTM and p44 analyses and should be settled once, in A4, in writing.
5. **What is our equivalent of the base-status/user-status table?** If a partner
   conformance profile is ever needed (and the repo's integration-floor + config-overlay
   design suggests it will be), this guide's per-element two-column table is the proven
   format. Worth prototyping as part of the catalogue's publication format rather than
   as an afterthought.
6. **Registry corrections (orchestrator, not done here):** the `publisher` field should
   read **FCA US (Stellantis)**, not *"unidentified (user-supplied)"*; the `name` should
   record that it is the **CENTS** guide at **X12 version/release 003010** (not 004010),
   since that materially limits how the element attributes may be cited. Consider adding
   A5 and A8 to its `areas`.
