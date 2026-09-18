---
source: src:dtr-part-iv
analyzed: 2026-09-17
evidence_grade: B
material: |
  All under sources/dtr-part-iv/local/ (already on disk from the interrupted 2026-09-17
  gap-fill run; nothing re-downloaded). Page numbers below are PDF pages, which for every
  one of these chapter PDFs equal the chapter's own printed page (IV-A-40x-N).

  READ IN FULL
    dtr_part_iv_A_402.pdf  "Shipment Management" (47 pp) - the single richest chapter.
        §A-B pp. 1-2, §C Outbound pp. 2-14, §D Inbound pp. 14-21, §E Diversions pp. 21-26,
        §F TSP Module pp. 26-32, §F.10 BL block-by-block pp. 32-39, §G-H pp. 39-42,
        Tables A-402-1..4 pp. 46-47.
    dtr_part_iv_A_406.pdf  "Storage" (29 pp) - §A SIT pp. 1-6, §B Non-Temporary Storage
        pp. 6-16. (Figures pp. 17-29 are form images; not OCR'd, see below.)
    dtr_part_iv_app_A-L.pdf  "Domestic and International Transit Timetables" (4 pp).
    dtr_part_iv_app_A-B.pdf  (2 pp - a pointer page to the Tender of Service URLs only).
    dtr_part_iv_toc.pdf  (16 pp) - front matter, full TOC, figure/table lists.

  READ IN PART
    dtr_part_iv_A_413.pdf  "PPGBL/BL and SF 1200" (17 pp) - §A-C pp. 1-3 and §E-H pp. 11-14
        (distribution, substitute documents, SF 1200 preparation, who may issue) read in
        full; §D block-by-block BL preparation pp. 3-11 skimmed only (it duplicates
        A-402 §F.10, which was read in full).
    dtr_part_iv_A_405.pdf  "Quality Assurance" (14 pp) - §A-D.2 pp. 1-5 read in full
        (inspection, performance file, LOW/LOS, suspension grounds); §D.3-§I pp. 5-14
        (appeals, disqualification, appellate addresses) skimmed.
    dtr_part_iv_A_401.pdf  "General Provisions" (32 pp) - §A-F pp. 1-4 read; pp. 5-32 are
        almost entirely form images (DD 1797, DD 1299, ATF Form 6, ...), skimmed.
    dtr_part_iv_app_A-M.pdf  "Counseling" (52 pp) - §F Methods pp. 6-8 and §G.1-G.3
        Government-arranged moves / Storage / How to avoid SIT pp. 8-10 read in full;
        §A-E pp. 1-6 and §H-T pp. 10-22 skimmed; pp. 23-52 are form images.
    dtr_definitions.pdf  "DTR Definitions" (66 pp, 780 numbered entries, all six DTR parts)
        - used as a glossary by targeted extraction, not read end to end. Entries read in
        full: 2, 19, 81, 122, 160-166, 251-259, 322, 338, 351, 388, 422, 425, 474, 479,
        514-516, 530-533, 594, 596-598, 641, 662, 665, 675-677, 694, 702, 711, 715-717,
        730, 738, 750, 779.

  NOT READ (and it matters)
    Chapters A-403 (Best Value), A-404 (Direct Procurement Method), A-407 (Mobile Homes),
    A-408 (POV), A-409 (Firearms), A-410 (Specialized Procedures / Unusual Occurrences),
    A-411 (Personally Procured Transportation), A-412 (Boats) - NOT in local/, not
    downloaded. A-410 is the one that hurts: it is the exception/incident vocabulary the
    Tender of Service defers to (ToS §B.16).
    Appendices A-A (Third Party Payment System - the A7 billing machinery), A-D/A-E
    (warehouse and facility standards - A5), A-G (DPM Performance Work Statement - the
    closest thing here to a task/crew model), A-H, A-K1/K2 ("It's Your Move" customer
    glossaries), A-P, A-Q, A-R - none downloaded except the fragments listed above.
    dtr_part_iv_app_A-C.pdf (state weights-and-measures offices) and app_A-J.pdf (a
    pointer page to the NTS Tender of Service) were extracted but carry no model content.
    Every DD-Form figure in every chapter is a scanned form image; pdfminer returns only
    the caption. So the *field lists* of DD 1299, DD 1797, DD 1780, DD 1814, DD 1857,
    DD 1164, DD 619, DD 1840/1840R and SF 1200 were NOT read - only what the running
    text says about them.
---

# Defense Transportation Regulation Part IV - Personal Property - analysis

## What it is

**DTR 4500.9-R, Part IV, "Personal Property"**, issued under DoDD 4500.09 by the
Commander, USTRANSCOM - renamed through these 2026 changes to the **Department of
War Personal Property Activity (DoW PPA)**. It is the operating regulation for the
**Defense Personal Property Program (DP3)**: the rules by which the US military
moves and stores the household goods of its members and civilian employees, using
commercial carriers, worldwide. Base edition March 2020, "includes changes through
10 September 2026" (`local/dtr_part_iv_toc.pdf` p. 1); individual chapters carry
their own change dates (A-402 is 14 July 2026, A-406 is 6 March 2026, A-413 is
10 September 2026, A-405 is 21 March 2024).

**S1 kind:** `regulation`. **S2 adoption: 3 inside its domain, 0 outside it** - it
binds every DoD/USCG personal-property shipment on earth and, through the Tender of
Service it incorporates, every commercial TSP that wants that traffic (which is most
of the US van-line industry); it binds nobody in commercial relocation.
**S3 openness:** `public` - approved for public release, distribution unlimited, at
ustranscom.mil/dtr (toc p. 2).

**What our reading covered, honestly.** The regulation is a dozen chapters plus
twenty-odd appendices; we read the three that carry the model - **A-402 Shipment
Management** (lifecycle, award, SIT, diversion, BL), **A-406 Storage** (SIT and NTS
end to end) and **Appendix A-L** (transit times / delay attribution) - in full, plus
the correction-notice machinery in A-413 and the enforcement machinery in A-405.
Graded **B, not A**, for three reasons: eight chapters and most appendices were never
downloaded (list above); the form figures are images, so we know what the forms *do*
but not what fields they carry; and this regulation is written as one half of a pair -
it says "refer to the 400NG and the International Tender" or "see the Tender of
Service" at every point where a rule would be priced or where a carrier duty would
be stated in the first person. The ToS half is analysed separately in
[`../dp3-tender-of-service/analysis.md`](../dp3-tender-of-service/analysis.md); the
two should be read as one source.

## Model summary

The DTR's world has four kinds of thing and they are cleanly separated.

**1. The entitlement.** A customer (member or civilian employee) has *orders*, which
authorize a move of some *weight allowance* between *authorized locations*. Anything
beyond that is **excess cost**, computed by the system and collected from the
customer (A-402 §C.10, §H.2, pp. 11-12, 40-42). The entitlement is the reason a
shipment exists; nothing in the commercial world corresponds to it, but it is why
almost every date here has a *right* attached rather than only a promise.

**2. The shipment.** One **Bill of Lading (BL)** = one customer's property moving on
one authority. Definition: "a contract between the shipper and the TSP whereby the
TSP agrees to furnish transportation services subject to the conditions printed on
the bill of lading" (`dtr_definitions.pdf` #81). Its type is a **Code of Service
(COS)** - D loose domestic, 2 containerized domestic, 4/5/6/T international HHG,
7/8/J unaccompanied baggage, S mobile home, two-letter B*/H* codes for Direct
Procurement Method (A-402 Table A-402-3, p. 46). A **consolidated shipment** is
several customers' lots offered to one carrier for one movement - but *"a separate BL
will be issued for each customer's lot"*, cross-referenced in Block 27 (A-402
§F.10.a(18), pp. 33-34). That is the whole trip model: consolidation is a
cross-reference between BLs, not an entity.

**3. The channel and the award.** Origin-destination pairs are bucketed into
**channels** (CONUS->CONUS by origin state to one of 13 destination regions;
CONUS<->OCONUS by country; A-402 §C.1.b). For each channel-and-COS there is a **Traffic
Distribution List** of qualified TSPs ranked by **Best Value Score**, split into four
**Quality Bands** that receive 5/3/2/1 shipments per round-robin turn (Table A-402-1;
UB gets 50/30/20/10, Table A-402-2). DPS offers, the TSP has 24 hours to accept, and
the alternatives to acceptance are enumerated and each has a distinct consequence
(§C.4, §F.1-2).

**4. Storage, which is two different things.** **SIT** is storage *incident to a
line-haul movement*, "cumulative and may accrue at origin, in transit, at destination,
or any combination thereof" (`dtr_definitions.pdf` #676) - the BL is still alive and
the TSP is still liable. **NTS** is "long-term storage of household goods **in lieu of
transportation**" (#479) - a different program, a different document (DD Form 1164
Service Order, not a BL), a different unit (**lot**: "those household goods placed in
storage at government expense and covered by one service order", #425), and a
different counterparty (the NTS TSP / warehouseman, contracting with the
Transportation Officer). The boundary between them is not a duration threshold; it is
*whether a line-haul movement is in flight*. This is the single most useful structural
idea in the source.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| Bill of Lading (PPGBL/BL) | Contract between shipper and TSP; also the priced-out data feed to the payment system | A6, A9 | `dtr_definitions.pdf` #81; A-413 §A |
| Code of Service (COS) | Shipment-type code that fixes mode, containerization and rate family (D, 2, 4, 5, 6, 7, 8, T, J, I, S, DPM two-letter) | A2 | A-402 Table A-402-3 p. 46 |
| Channel | Origin-rate-area -> destination-rate-area pair; the unit rates and TDLs are filed against | A9, A12 | A-402 §C.1.b p. 2 |
| Lot | HHG placed in storage at Government expense **covered by one service order** | A2, A5 | `dtr_definitions.pdf` #425; A-406 §B |
| Storage-in-Transit (SIT) | Storage in connection with a line-haul movement; cumulative across origin/in-transit/destination | A5 | #676; A-406 §A.1 |
| Non-Temporary Storage (NTS) | Long-term storage **in lieu of transportation**, incl. packing, crating, transport to/from, unpacking | A5 | #479; A-406 §B |
| SIT control number | 9 digits: YY + Julian day of entry + 4-digit sequence within that day | A5, A9 | A-406 §A.11 p. 5; A-402 §D.5.a(2) p. 17 |
| Required Delivery Date (RDD) | "A specified calendar date on or before when the TSP agrees to **offer** the entire shipment for delivery"; rolls to the next workday if it falls on a weekend/holiday | A4, A5 | `dtr_definitions.pdf` #594 |
| Desired Delivery Date (DDD) | The customer's wanted date; becomes the RDD **only if the TSP agrees** | A4 | A-402 §C.3.h(1) p. 7 |
| Planned/Agreed Delivery Date | The post-survey negotiated date field; if no agreement, the TSP re-enters the original RDD to acknowledge it | A4 | app A-M §F.1.c p. 7 |
| Pickup spread dates | Seven consecutive calendar days ending at the customer's "Latest Pickup Date"; the pickup must fall inside, the pack dates may fall outside | A4 | A-402 §C (via ToS §C.1.j-l); app A-M §G.1.a-c p. 8 |
| Diversion | "A change made in the route of a shipment while in transit" - operationally, a new destination **more than 30 miles** from the original, excluding shipments already in SIT at destination and OTO | A3, A4 | #255; A-402 §E.1 p. 21 |
| Diversion Point | The point where the change takes effect: the closest county/city of the closest BLOC AOR domestically; a POE, POD or destination internationally | A3 | A-402 §E.2.c(1)(b), §E.3.c(2)(c) |
| Termination | "Onward movement of a shipment is stopped at a designated point. Termination may be for the convenience of the government **or due to the fault of the carrier**" | A1, A4 | #702 |
| Reshipment | Onward movement of a **terminated** shipment requiring further over-ocean movement | A1 | #596 |
| Pull-back / Turn-back | Pull-back = PPSO withdraws the shipment from the TSP; turn-back = the TSP hands it back. Both cancel the BL, but only turn-back is charged against the TSP's allocation | A1 | A-402 §C.6 pp. 8-9 |
| Blackout dates | Dates a TSP cannot be offered new shipments, filed by ZIP3 x BLOC x destination region x category, up to 6 months ahead | A1, A3 | A-402 §C.2.f p. 7 |
| Short-fuse shipment | Pickup required within 5 GBDs; offered to all TSPs at once, first to accept wins, not counted against allocation | A1 | A-402 §C.2.e p. 7 |
| Administrative shipment | The charge a TSP takes against its allocation for *missing* an offer (blackout or non-response) without ever touching the freight | A1 | A-402 §C.2.f p. 7; §C.4.b(2) |
| GBD (Government Business Day) | The unit nearly every deadline is counted in | A4 | used throughout; contrast `dtr_definitions.pdf` #594's calendar-day RDD |
| Accessorial Service | "A service performed by a carrier **in addition to the line-haul**" - sorting, packing, storage, reconsigning... | A7 | #2 |
| Excess cost | The priced difference between what the entitlement authorizes and what the customer asked for (weight, distance, multiple shipments) | A7 | A-402 §C.10, §H.2 |
| TSP / Carrier / Agent, Carrier / Freight Forwarder | Four distinct legal roles; "a bona fide agent ... **as distinguished from a broker** ... under the direction of the carrier pursuant to a pre-existing agreement" | A8 | #738, #95, #19, #322 |
| PPSO / PPPO / TO / SMO / SPM | Booking-and-oversight roles: shipping office, processing (counseling) office, the individual officer, the storage management office, the storage program manager | A8 | #531, #532, #533, #677 |
| Consignor / Consignee | Releases the property to the carrier / receives it for final delivery | A8, A9 | #160, #161 |
| Maintaining PPSO vs Responsible PPSO | For an NTS lot stored outside the booking office's AOR: one office owns the *account*, the other owns the *geography* | A8 | A-406 §B.8 pp. 10-11 |
| In-Transit Visibility (ITV) | "The ability to track the identity, status, and location ... from origin to consignee or destination" | A4 | #388 |
| Tracing | "Action to determine the location of a shipment" | A4 | #717 |
| Gross / Tare / Net weight | Container+contents+packing / empty container / item excluding packaging | A2 | #338, #694, #474 |
| Constructive weight | 7 lb per cubic foot, usable only with PPSO approval when scales are unavailable or tickets lost | A2, A10 | A-402 §F.8.c(1)(a) p. 30 |
| PBP&E (M-PRO / S-PRO) | Professional books, papers & equipment - member's vs spouse's, weighed and inventoried separately, entered as its own weight in DPS | A2, A10 | A-402 §F.8.c(2) p. 30 |
| Waiting Time | Chargeable time the carrier is asked to wait beyond the initial allowable free waiting time | A4, A7 | #779 |
| Free waiting time | 2 hours domestic / 1 hour international at destination before SIT may be requested | A4, A5 | A-406 §A.8.a p. 4 |
| Split shipment | A shipment separated at a transshipment point into increments "each ... identified and documented separately"; each gets its own weight ticket and its own SIT control number | A2, A5 | #662; A-402 §D.5.b(4) p. 18 |
| BLUEBARK | A shipment belonging to a deceased member or their dependents; direct delivery is *not* authorized and the BL is annotated | A1, A8 | #83; A-402 §F.10.a(25)(d)3 |

## Lifecycles & events

### The shipment lifecycle, with the actor on every transition

DPS carries an explicit status code set - the text names **`counseled`, `booked`,
`IT` (in transit)** and **`Delivered Complete`** (A-402 §F.8.d(1)(a) and (2)-(3),
p. 31) - and each transition has an owner:

| From -> To | Caused by | Gate / deadline | Cite |
| --- | --- | --- | --- |
| - -> counseled | **customer + counselor** (DD 1299 application, DD 1797 checklist) | orders must be on file | A-401 §F; app A-M §E |
| counseled -> validated | **PPSO counselor** | after validation the customer's own data goes read-only except contact/dependent data | A-402 §C.11.a(1)(a) p. 12 |
| validated -> offered | **DPS**, by channel + COS + BVS + Quality Band + blackout | - | §C.2, §C.3 |
| offered -> accepted | **TSP** | **24 h** (time-zone aware) | §C.4.a p. 6 |
| offered -> refused | **TSP**, permitted *only* for short-fuse or shortened-transit shipments | 30-day market ineligibility; repeats -> disqualification | §C.4.a, §F.2.a |
| offered -> non-response | **nobody** - the absence of an act is itself a typed event | DPS charges an allocation, e-mails a "Notice of Non-Response" marked URGENT, offers to the next TSP; PPSO must then *overtly* confirm it wasn't a system fault before suspending | §C.4.b p. 6, §F.1.b |
| accepted -> surveyed | **TSP** | initial contact <= 3 GBD of award; survey data in DPS NLT 3 GBD before pickup (1 GBD short fuse); in-residence survey required >= 4,700 lb domestic / 3,200 lb intl within 50 miles | §C.7, §F.3 |
| surveyed -> BL printed | **TSP/PPSO** | **the BL cannot be printed until pre-move survey weight and agreed pack/pickup dates are in DPS** | §F.1 NOTE p. 27; §F.9.a NOTE |
| any -> cancelled | **PPSO** "in the interest of the Government" | TSP returned to the TDL *without* charge | §C.5 p. 8 |
| any -> pulled back | **PPSO** | no charge if for Government convenience; **charged** if caused by TSP action/inaction | §C.6.a-b p. 9 |
| any -> turned back | **TSP** | charged; if it forces the member into an Actual Cost Reimbursement PPM the TSP may owe the difference | §C.6.b, §C.6.d |
| accepted -> picked up | **TSP** | must be inside the 7-day spread; pack dates may precede it | §C.3.h; app A-M §G.1.a-c |
| picked up -> IT | **TSP entering gross/tare/net weight** | see the weight gate below | §F.8.c-d pp. 30-31 |
| IT -> diverted | **PPSO** issuing a Diversion Certificate after the customer presents amended orders | notified PPSO must tell the origin PPSO within **24 h**; TSP must locate the shipment en route and hold it | §E.2 pp. 21-22 |
| IT -> terminated | **PPSO**, for Government convenience **or carrier fault** | terminated shipments are *reshipped* on a new BL, not diverted | #702, #596; §E.4 |
| IT -> arrived | **TSP** ("arrive the shipment in DPS") | arrival date + weight + whole/split + requested/actual delivery date + attempted delivery date | §D.2.b p. 15 |
| arrived -> in SIT | **TSP requests, PPSO approves, DPS issues the control number** | free waiting time 2 h dom / 1 h intl; two documented contact attempts 6 h apart; SIT effective **the date the shipment was offered for delivery, not the date it arrived** | §D.5.b(2) + NOTE p. 18; A-406 §A.8.a |
| arrived / in SIT -> delivered | **TSP** | scheduled delivery date in DPS NLT COB the day before; actual delivery date within **3 GBD** | §D.3.a pp. 15-16 |
| delivered -> Delivered Complete | **TSP entering the actual delivery date** | unlocks: destination invoicing, the customer's Notice of Loss and Damage, claim initiation, and the Customer Satisfaction Survey | §F.8.d(3) p. 31 |

**The weight gate is a genuine invariant, not a workflow nicety.** Until the TSP
enters gross/tare/net in DPS, the system *refuses* invoicing, ITV updates, arrival
entry, SIT-at-destination requests and delivery scheduling (§F.8.c(3), p. 30). One
fact blocks five downstream transitions. That is a modelling idea worth stealing:
**the weight is not an attribute of the shipment, it is a precondition of the
shipment's execution phase.**

### The SIT lifecycle, and its escalating notification ladder

SIT entry: TSP requests in DPS -> PPSO approves or denies -> DPS issues the SIT control
number (A-402 §C.9.b, §D.5.a). Entry rules branch on whether a direct-delivery address
was printed on the BL: with an address, SIT is only available after a stated percentage
of transit time has elapsed *and* the customer has become unavailable; without one, on
arrival plus the 24-hour-notice/two-attempts procedure (§D.5.b(1)-(2), p. 18). Origin
SIT and destination SIT are explicitly *not* meant to both occur, with a named
exception list ("customer's house becomes unavailable, customer hospitalized")
(§D.5.b(3)-(5)).

The days are a single pool: **`Days SIT Used = Release Date - Date Placed in Storage +
1`; `Remaining Days at Destination = Days Authorized - Days Used`** (§C.9.c, p. 11),
carried forward by issuing an SF 1200 that sets a new RDD.

Expiry is the interesting part - an obligation ladder where *each rung has a different
actor and a different evidence requirement* (A-406 §A.5, pp. 2-3):

| T-minus | Who acts | What they must do |
| --- | --- | --- |
| weekly | PPSO | generate a SIT expiration report of lots expiring within 30 days |
| 30 cal days | PPSO | notify the customer by any available means; advise them to buy private insurance and to conduct a **joint inspection with the warehouseman at their own expense** |
| 20 cal days | PPSO | second notification, electronic or mail, to last known address |
| 15 cal days | PPSO | request assistance from the customer's **unit** or civilian personnel office |
| 10 cal days | PPSO | request assistance from **Service locators** (Table A-406-2) |
| 10 cal days | PPSO | final notification by mail **with delivery confirmation**; print the USPS proof of delivery into the case file |
| 7 cal days | PPSO | assemble a case file: orders, signed DD 1299, the notification log (Fig. A-406-7), all correspondence, and an **SCRA certificate** proving active-duty status |
| 5 cal days | PPSO -> authorizing authority | forward the case file for a final contact attempt and **concurrence/non-concurrence** |
| expiry | PPSO | terminate; the property falls under the Servicemembers Civil Relief Act and state bailment law |

Termination has hard semantics: *"Shipments remain in SIT until terminated by the
PPSO and cannot be retroactive"* (§A.6.e), the TSP acts **only at midnight on the
effective date** (§A.6.f(1)), and at that moment **"the warehouse becomes the final
destination of the shipment"** and the TSP's BL liability ends (A-402 §D.5.c(2),
p. 19). And yet: *"When converted to customer expense, the customer is still entitled
to delivery out of storage paid for by the Government"* (§D.5.c(1) NOTE) - one
obligation survives the death of the contract that created it.

The NTS ladder is the same shape at a longer scale: 90 / 75 / 60 / 45 calendar days,
then a 30-day case file (A-406 §B.12, §B.15, pp. 12-13).

### Diversion, termination and reshipment are three different things

This trichotomy is stated crisply and is worth adopting wholesale (A-402 §E, pp. 21-26;
`dtr_definitions.pdf` #255, #596, #702):

- **Diversion** - the shipment keeps its identity and its BL; only the destination
  changes; rates are recomputed as origin->**Diversion Point** plus Diversion
  Point->new destination. It is evidenced by a **Diversion Certificate** which "must
  provide the authenticity of the diversion" and is distributed to the TSP, the
  original destination PPSO and the new destination PPSO (§E.3.c).
- **Termination** - onward movement stops at a designated point. Attributable:
  "for the convenience of the government or due to the fault of the carrier."
- **Reshipment** - a *terminated* shipment moving onward, **on a new BL** (§E.4(4)(c)).

The international scenario matrix (§E.4, pp. 23-26) is essentially a decision table
on (diversion point kind, destination rate area kind, whether further over-water
movement is required) -> {permitted with SFR unchanged, permitted with a land-distance
adjustment computed from the POD, **not permitted - terminate and reship**}. Several
cells read simply "There must be no diversion." A worked example of a domain where
*the legality of a re-route is a function of geography and mode, not of policy
preference*.

### Delay attribution: the single best C7 idea in the source

Appendix A-L §B.6-8 (pp. 1-2) splits an international transit time into **segments
with different responsible parties** - Column I/T-1 = the TSP's time to get the
shipment to the aerial port of embarkation; Column J/T-2 = the Air Mobility Command's
time port-to-port; Column K/T-3 = the destination TSP/port agent's time to deliver;
Column L = the sum, which is what DPS uses to construct the RDD. When an RDD is
missed, the PPSO apportions the lateness between TSP and AMC using **GATES records
and the TCMD/cargo manifest** as evidence (§B.7), and the worked example is explicit:
44 days allotted (30 TSP + 14 AMC), 7 days late, GATES shows AMC took 17, therefore
3 days are not chargeable to the TSP and the TSP owes an inconvenience claim on the
other 4 (§B.8.a-b). If a PPSO shortens or lengthens the total transit time, **the
adjustment lands entirely on the TSP's segment; AMC's is constant** (§B.8.c).

That is a complete model of *attributable lateness*: an SLA decomposed into
party-owned segments, an independent evidentiary system per segment, and a
proportional remedy. Nothing else in our source set does this.

### Enforcement as a first-class lifecycle

A-405 gives the TSP-performance side its own state machine: inspection (DD 1780, a
web form in DPS, on a >=50% inspection standard) -> **Letter of Warning** -> **Letter of
Suspension** (regular, 20 days to respond, effective on day 21, 30 days long; or
*immediate*, effective the day DPS notifies) -> disqualification/non-use recommended to
DoW PPA. Violations are tallied per BLOC on a **rolling 180 days**, and "when a TSP
commits the same violation three or more times during a 180-day period, suspension
action may be considered" (§D.1-2, pp. 3-5). Suspension has a scope: **BLOC-Market**
(one of dHHG / UB / iHHG) versus **BLOC** (all markets at that office). Note the
named immediate-suspension grounds - refusal of a standard award, **missed pickup**
(defined as failing the appointed date *and* causing severe inconvenience, **or**
failing it "without any type of communication with the customer"), property still in
the origin facility on or after the RDD, and smoking (§D.2.c(1)(a)). Two of the four
are communication failures rather than service failures.

## Time, identity, evidence

**Time.** The date model is the richest part of the regulation and it is *role-based,
not timestamp-based*. Distinguished: Requested Packing Date (BL block 6) vs Requested
Pickup Date (block 7) vs the 7-day **spread window** the pickup must fall inside vs
the pack dates which may fall outside it; Desired Delivery Date vs **RDD** (= pickup +
transit time, by rule) vs **Planned/Agreed Delivery Date** vs actual delivery date;
arrival date vs *attempted* delivery date vs scheduled delivery date vs actual;
SIT-placed date vs SIT-effective date (the date offered for delivery, **not** arrival)
vs SIT expiration date vs termination date (midnight). Transit times are **calendar**
days counted from the day after pickup, weekends and holidays included, and the RDD
rolls forward off a weekend/holiday (`dtr_definitions.pdf` #594; app A-L §B.2-3). Most
*duties*, by contrast, are counted in **Government Business Days**, and DPS holds a
per-BLOC holiday calendar worldwide because "holidays and weekends impact allowable
pickup and delivery dates" (A-402 §C.2.g, p. 7). The regulation therefore carries
three different day-counting regimes at once and is explicit about which applies
where.

**Identity.** Unusually dense and mostly *typed and constructed* rather than opaque:

- **BL number** - serially pre-assigned, accountable stock; a laser-generated BL "is
  only accountable when a number has been assigned to the form"; lost/stolen/void
  numbers must be reported to DoW PPA; audits every 180 days (A-413 §C.2).
- **SCAC** - the four-letter carrier code from NMFTA (`dtr_definitions.pdf` #665).
- **BLOC** - Bill of Lading Office Code; the identity of the *office*, and the scope
  unit for suspensions and blackouts.
- **SIT control number** - 9 digits carrying year + Julian day + intra-day sequence
  (A-406 §A.11). Meaningful, sortable, and collision-safe by construction.
- **TCN** - 17 positions, with **position 15 typed by shipment kind** (B = UB DPM,
  J = UB TGBL, H = HHG DPM, K = HHG TGBL, P = POV) (A-402 §F.10.a(15), p. 32).
- **Lot number** (supplied by the *warehouseman*, not the Government) + **service
  order number** (DD 1164) - the NTS identity pair, printed on the BL's block 19 when
  a shipment originates from NTS (§F.10.a(19)(b)).
- **Rate area codes** (US11, GE, JA96, ...) and channel; **COS**; **inventory item
  numbers**; **DD-form numbers** used as the names of business events.
- BL **block numbers** are used as stable field addresses across documents - "the
  destination city or installation shown in **Block 18** of the BL" governs SIT
  charges (A-402 §D.5.a); Block 34 + Block 25 "PAYING OFFICER REVIEW" is the
  machine-readable excess-cost flag (§C.10 NOTE).

**Evidence and corrections.** The **SF 1200 Government Bill of Lading Correction
Notice** is a fully-specified correction record and the best C7 artifact we have
found. Its blocks are: *Bill of Lading Now Reads* (11) / *Correct Bill of Lading to
Read* (12) / **Authority for Correction** (13) / Remarks (14) - i.e. before-value,
after-value, justification, narrative - plus one BL per notice, the initiating
official's signature and the TSP representative's signature (A-413 §F.1.b). **Table
A-402-4** (p. 47) enumerates *exactly which BL fields are correctable* - a closed
mutability whitelist covering agent code, COS, pack/pickup/required-delivery dates,
member identity and authorized weight, orders number and date, extra pickup/delivery
addresses, TCN, consignee and delivery address, pickup address, accounting codes and
remarks. Everything else on the BL is immutable; to change it you cancel and reissue.
**Who may issue** is also specified, including a silence rule: the consignee who
believes a correction is needed must notify the issuing office, and "if a reply to
this notification is not received within 30 days, the consignee is permitted to make
alterations or corrections" - unless the correction is obviously needed to "reflect
the exact facts relating to the shipment", in which case they may act at once
(A-413 §H.2). Cancellation after distribution requires a memorandum copy marked
"canceled" sent to *every* original recipient (§E.3).

Other evidence machinery: an audit trail is required of DPS itself - "DPS maintains an
audit trail of all the changes made to the shipment record including when changes were
made and who made said changes" (A-402 §D.1.b NOTE, p. 15); certified **weight
tickets** with gross/tare/net, due to the ordering PPSO within 7 working days, with
*constructive weight* (7 lb/ft³) as a documented, pre-approved fallback; **witnessed
reweighs** with the interested parties given "reasonable opportunity ... to be present"
(§D.7.a(4), p. 20); the **joint inspection** at SIT expiry; **DD 1780** inspection
records and photographs in the TSP performance file (A-405 §C.2); and for NTS, the
warehouse receipt as a nonnegotiable document of title whose original must exist
exactly once - scan it and you must destroy the paper (A-406 §B.2.d).

One deliberate anti-pattern to note: the regulation forbids the TSP from updating the
customer's **e-mail address** after pickup, "since there may be a conflict of interest
with the CSS" (A-402 §F.8.d NOTE, p. 31). Field-level write permissions justified by
*incentive*, not by ownership.

## Scores

Grade B reading; no C2/C3 cap applies (only grade C caps). Areas are scored against
what this regulation actually contains, not against DP3 as a whole - where a rule is
present only as a pointer to the 400NG, the International Tender or the Tender of
Service, that is scored as absent here and credited to the other source.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 3 | 2 | **3** | 3 | 3 | 3 | 2 | 1 | The most complete order lifecycle in the corpus with an **actor on every transition** (table above). C3=3: offer/accept/refuse/**non-response**/blackout/cancel/pull-back/turn-back/divert/terminate/reship are distinct states with distinct consequences, and the consequence is attributed (charged to the TSP vs not). C2=2 not 3: the states are named in running prose and in DPS status codes but never assembled into one authoritative list. C8=1: COS and form set are closed enumerations with no extension point. |
| A2 Shipment structure | 2 | 2 | 1 | 3 | n/a | 2 | 1 | 1 | COS as a real type taxonomy (Table A-402-3); split shipments as separately documented increments (#662); overflow; consolidated shipment as a **cross-reference between per-customer BLs**, not an entity; PBP&E/consumables/gun safe as separately-weighed sub-quantities. No composition model - a shipment has no parts other than its inventory items and its weight. |
| A3 Trip, stop & assignment | 1 | 2 | 1 | 1 | 1 | 2 | 2 | 0 | Almost absent, as expected. What exists is real: diversion with a **named Diversion Point** and a certificate; POE/POD as typed waypoints for international movement; the DTS entry/exit dates as reportable facts (§F.8.d(1)(e)); extra pickup/delivery addresses in BL block 13. **No trip, no leg sequence, no vehicle, no driver, no consolidation of several shipments onto one truck.** The word "van" appears only in packing rules. |
| A4 Execution events & tracking | 2 | 2 | **3** | 3 | **3** | 2 | **3** | 1 | C1=2: the *milestones* are here (arrive, offer for delivery, attempted delivery, deliver, place in SIT, release from SIT) but pack/load/unload live in the ToS, and exception/incident codes live in the unread Chapter A-410. C3=3 and C7=3 on the strength of the **segmented transit-time attribution model** (app A-L §B.6-8) - party-owned SLA segments with an independent evidence source per segment and a proportional remedy - plus the **weight gate** that blocks five transitions, and the audit-trail requirement. C5=3 for the date-role vocabulary in *Time* above. C6=2: ITV is defined (#388) but there is no event identity, sequence number or dedup rule. |
| A5 Storage-in-transit | **3** | **3** | **3** | 3 | 3 | **3** | 2 | 1 | Complements rather than duplicates the 400NG's SIT treatment: the 400NG owns SIT *charging*, this owns SIT *administration*. C1=3: entry preconditions per BL-address case, origin/in-transit/destination as one cumulative pool with explicit arithmetic, split-shipment SIT with separate control numbers, partial delivery into and out of SIT, extension via DD 1857, expiry, termination at midnight, conversion to customer expense, delivery-out surviving conversion, unclaimed-property disposition under SCRA. C6=3 for the constructed SIT control number. C7=2: the notification ladder is an evidence trail (delivery confirmation, SCRA certificate, case file, concurrence) but there is no correction/reversal semantics for storage facts themselves. |
| A6 Documents & evidence | 3 | 3 | 2 | 3 | 1 | 3 | **3** | 1 | A document-centric regulation: BL, SF 1200, DD 1299, DD 1797, DD 1780, DD 1814, DD 1857, DD 1164, DD 619, DD 1840/1840R, DD 1384 TCMD, warehouse receipt, weight tickets, Diversion Certificate - each with an issuer, a distribution list, a retention rule and, for the BL, serial accountability and audits. C7=3 for SF 1200's before/after/authority structure plus the Table A-402-4 mutability whitelist and the consignee's 30-day silence rule. C5=1: documents carry an issue date and little else. Docked on C3 because document *state* (issued / corrected / cancelled / superseded) is described in prose, never enumerated. |
| A7 Charges & billing hooks | 2 | 2 | 1 | 2 | 1 | 2 | 2 | 1 | Present as hooks, by design: accessorial **pre-approval as a typed record** with states Pending -> Approved/Denied, a 3-GBD PPSO SLA, and a later reconciliation that flags each submitted service pre-approved or pre-denied (§C.8, §D.6); excess-cost computation with estimated-then-actual recalculation and the BL block 34/25 flag; DD 139 / DD 1131 as the two collection instruments depending on pay status. The actual rating lives in the 400NG/IT and the payment machinery in the unread Appendix A-A. |
| A8 Parties & roles | 2 | **3** | 1 | 2 | n/a | 2 | 2 | 0 | C2=3: TSP, carrier, **carrier's agent explicitly distinguished from a broker**, booking agent, general agent, freight forwarder, NTS TSP/warehouseman, TSP for Carriage, consignor, consignee, shipper, customer, designated/releasing/receiving agent, PPSO/PPPO/TO/CBO/JPPSO/SMO/SPM - each separately defined with its authority stated. The **Maintaining vs Responsible PPSO** split (A-406 §B.8) is a genuinely good idea: account ownership and geographic ownership are different roles over the same lot, with a mandatory copy-everyone protocol. C4=2 because the van-line agent set (booking/origin/hauling/destination agent) is absent - DP3 flattens agency into "TSP plus subcontractors", and the ToS then forbids double-brokering to keep it flat. |
| A9 Identity & cross-references | 3 | 3 | n/a | 3 | n/a | **3** | **3** | 1 | The strongest area. Ten-plus typed identifier families (list above), several *constructed* so the identifier carries its own semantics (SIT control number, TCN position 15, DPM alpha codes), positional field addressing by BL block number across documents, and explicit cross-reference obligations (consolidated BLs listing sibling BL numbers in block 27; NTS lot number + service order number printed into BL block 19). C7=3 via SF 1200. |
| A10 Survey, estimating & inventory *(context)* | 2 | 2 | 2 | 3 | 2 | 1 | 2 | 0 | Survey types (in-residence / telephonic / virtual) with weight-and-distance thresholds for which is allowed; the survey output as a set of *fields* (estimated weight, agreed pack/pickup dates, delivery-date info) that gate BL printing; reweigh as a right held by both customer and PPSO with a 500 lb / 100 lb floor and a "within 90 percent of allowance" trigger; witnessed weighing. Inventory itself is in the ToS. |
| A11 Claims & valuation *(context)* | 1 | 1 | 1 | 2 | 1 | 1 | 2 | 0 | Mostly delegated to the unread DP3 Claims and Liability Business Rules and to Service claims offices. What is here: the **liability transfer chain** in NTS (line-haul TSP not liable for pre-existing damage noted on the storage inventory; **burden of proof on the line-haul TSP** for concealed damage, satisfiable by photographs, member statement or PPSO inspection - A-406 §B.16.i(3)), and the missing-property-later-found rules including salvage and repayment (§B.16.c). |
| A12 Rating & tariffs *(context)* | 1 | 1 | n/a | 2 | 1 | 2 | 1 | 1 | Deliberately a pointer. It contributes the *acquisition* side the 400NG assumes: TDL, Best Value Score, Quality Bands, round-robin allocation, Minimum Performance Score, Volume Move and Special Solicitation rate-bidding logic, blackout dates, manual award and "Offer to All" escape hatches with mandatory monthly trend analysis (§C.2-3). |
| A13 Crew, driver & settlement *(context)* | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent. The nearest material is the unread Appendix A-G DPM Performance Work Statement. |

*(Per the 2026-09-17 scope decision, S5 "fit to Pegasus data" is withdrawn and is not
recorded.)*

## Strengths worth adopting

1. **SIT and NTS are distinguished by whether a line-haul movement is in flight, not
   by duration.** SIT rides a live BL and the carrier stays liable; NTS is storage *in
   lieu of* transportation with its own document, its own unit (the lot) and its own
   counterparty. A duration-based "temporary vs permanent storage" flag would be the
   wrong model and this source shows why.
2. **The lot, defined as "the property covered by one service order."** A storage unit
   defined by its authorizing document rather than by a warehouse location or a
   customer. Partial withdrawal therefore *splits the lot* and forces a new warehouse
   receipt for the remainder (A-406 §B.4.b) - the identity follows the paper.
3. **Non-response as a typed event.** The absence of an act inside a window is
   modelled, named, notified, charged and evidenced - and requires a human to confirm
   it was not a system fault before it becomes punitive (§C.4.b(3)).
4. **The weight gate.** One fact whose absence blocks a named set of downstream
   transitions. Better than a validation rule; it is a phase precondition.
5. **Segmented SLAs with per-segment owners and per-segment evidence** (app A-L). The
   general form: *a promise decomposed into party-owned intervals, each with an
   independent record of truth, so lateness can be apportioned rather than merely
   detected.*
6. **Diversion / termination / reshipment as three distinct outcomes**, with diversion
   preserving shipment identity, termination attributable to a party, and reshipment
   requiring a new document.
7. **SF 1200's correction structure** - before-value, after-value, **authority for the
   correction**, narrative - together with a **closed whitelist of correctable fields**
   (Table A-402-4) and a rule for who may correct when the issuer is silent.
8. **Maintaining PPSO vs Responsible PPSO.** Two custodial roles over one object,
   divided along account-ownership vs geography, with an explicit "include everyone on
   every e-mail" protocol to prevent communication gaps (A-406 §B.8.c).
9. **Constructed identifiers that carry their own semantics** - the SIT control number
   (year + Julian day + sequence) and TCN position 15. Cheap, human-readable,
   collision-safe, and self-documenting in a way a UUID is not.
10. **The SIT/NTS expiry ladders.** A sequence of contact obligations with escalating
    evidence requirements (any means -> mail -> unit -> Service locator -> delivery
    confirmation -> case file -> third-party concurrence), terminating in an act with a
    precise instant (midnight) that is explicitly non-retroactive - and an obligation
    (delivery-out at Government expense) that deliberately **survives** the
    termination.

## Weaknesses / traps

- **There is no trip.** Nothing here models a vehicle, a driver, a route, a stop
  sequence, or several shipments riding together. "Consolidated shipment" is a
  billing and paperwork construct - separate BLs that name each other. Take A1, A5,
  A6 and A9 from this source; take A3 from somewhere else entirely.
- **Everything is single-customer-per-document.** One BL, one member, one set of
  orders. A commercial model that needs an account/RMC above the shipper, or a
  corporate move with many transferees, gets no help here.
- **The system is the model.** Large stretches describe what *DPS* does rather than
  what is *true* ("DPS issues", "DPS flags", "DPS work queue"). Copying these
  verbatim would bake a particular 2010s workflow engine into a domain model. The
  discipline is to keep the *rule* and drop the *mechanism*: keep "SIT is effective
  from the date the shipment was offered for delivery"; drop "DPS sends a notification
  to the PPSO work queue."
- **Entitlement contaminates the shipment.** Weight allowance, excess cost, pay
  status, rank/grade, orders number, SSN-last-four and PBP&E are shipment attributes
  here because the Government is both customer and payer. In a commercial model the
  equivalents belong to the *account/authorization*, not the shipment.
- **The agency layer is deliberately flattened.** DP3 wants one accountable TSP per BL
  ("no subcontractor or separate entity is considered to have moved or stored the
  shipment for the purposes of QA" - A-405 §B.1) and outlaws double-brokering. Real
  van-line practice has a booking / origin / hauling / destination agent chain. Do not
  read DP3's flat model as evidence that the chain does not exist.
- **Calendar-day vs GBD ambiguity is a live hazard.** The regulation itself is careful,
  but it mixes three regimes (calendar days for transit and RDD; GBDs for duties;
  "working days" in a few older passages, e.g. A-402 §D.7.b and A-406 §B.9.c). Any
  model that stores a duration must store its *unit and calendar*, not just a number.
- **Forms are load-bearing but their fields are invisible to us.** Every DD-form figure
  is a scanned image. We know DD 1857 extends SIT, but not what it records. Treat any
  claim about form contents here as inferred from prose.
- **The exception vocabulary is missing.** Delay reasons, "unusual occurrences", mold,
  infestation, turn-back causes - all live in Chapter A-410 and the Claims Rules,
  neither of which we hold. The delay fields we *do* see (§D.3.i: "last known location
  of the shipment", "cause for delay and new ETA") are free text, not codes.

## Out-of-v1 material

- **A12 rate acquisition**: the annual rate cycle, Minimum Performance Score, four
  Quality Bands with 5/3/2/1 (HHG) and 50/30/20/10 (UB) allocations, Volume Move and
  Special Solicitation bidding logic where a Rate Score is combined with the
  Performance Score into a solicitation-specific BVS, and the "Offer to All" / manual
  award escape hatches with mandatory monthly trend analysis by PPA J3
  (A-402 §C.1-3, pp. 2-8).
- **A11 liability transfer at the storage-to-linehaul boundary** (A-406 §B.16.i(3)) and
  the found-property/salvage/repayment rules (§B.16.c).
- **A13 adjacent**: TSP qualification and enforcement - the LOW/LOS/suspension/
  disqualification ladder, rolling-180-day violation tallies, BLOC-Market vs BLOC
  suspension scope, and the performance file contents (A-405 §C-D).
- **Excess-cost arithmetic** worked end to end for excess distance, estimated then
  recomputed on actual weight (A-402 §H.2, pp. 40-42).

## Open questions

1. **Chapter A-410 (Unusual Occurrences) is the gap.** It is the named home of the
   incident/exception vocabulary that both the ToS and the Claims Rules defer to, and
   it is the material most likely to fill A4's C1 hole. It should be fetched.
2. **Appendix A-A (Third Party Payment System)** would settle A7's charge-state
   question - whether DP3 has an enumerated billed/disputed/denied/re-billed/refunded
   lifecycle or only prose.
3. **Appendix A-G (DPM Performance Work Statement)** is the one place in DTR Part IV
   likely to contain task-level, crew-level, service-delivery-summary material (the
   TOC lists a "Task/Type of Move Matrix" and a "Service Delivery Summary", Tables G-1
   and G-2). That is our best in-source shot at A13 and at the pack/load task
   vocabulary.
4. **What percentage of transit time must elapse** before a TSP may request SIT on a
   direct-delivery shipment? A-402 §D.5.b(1) says "a percentage (see solicitation)" -
   the number lives in the 400NG/IT, and it is the hinge of the whole "was this SIT
   legitimate?" question.
5. **Is the DPS status code set larger than the four codes named?** The text names
   `counseled`, `booked`, `IT`, `Delivered Complete` in passing. If a full code list
   exists it would be worth having; MilMove (already in the registry) may carry the
   successor set and should be cross-checked.
6. **Free waiting time is stated twice with different framings** - A-406 §A.8.a gives
   2 h domestic / 1 h international; the ToS gives a 24-hour notice plus two contact
   attempts six hours apart. These are different clocks for what looks like the same
   decision point (may I put this in SIT?). Which governs, and are they sequential?
