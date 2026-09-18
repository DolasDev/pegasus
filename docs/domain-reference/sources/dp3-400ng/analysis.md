---
source: src:dp3-400ng
analyzed: 2026-09-17
evidence_grade: B
material: |
  /home/steve/repos/pegasus/docs/2026-400ng.pdf  (93 pp; NOT at the path the task brief gave)
    read in full: pp. 1-44 (front matter, Definitions, Acronyms, Introduction, Items 1-100)
                  pp. 57-61 (Items 185, 210, 225, 226, 227)
                  pp. 52-56 (Items 125, 130, 135)
                  pp. 79-82 (Appendix A costing: LHS composition, discounts, BPC/SA lookup)
    read by targeted extraction only: pp. 45-51 (Item 105/120 detail), 62-78 (OTO + Volume Move),
                  83-93 (Alaska costing worked example, Figures 1-3, region tables)
  /home/steve/repos/pegasus/docs/400NG-BASELINE-RATES.XLSX  (sheet names; "Additional Rates"
    item-code catalog; "Geographical Schedule" header + sample rows; "Accessorials" header rows)
  NOT read: 400NG-RATING-TOOL.XLSX (3.9 MB, not opened); the separately published
    "Item Code Listing", Tender of Service, and DTR Part IV Ch. 401-403 that this tariff
    repeatedly defers to.
---

# DP3 Domestic 400NG Tariff (2026) — analysis

## What it is

The **Defense Personal Property Program (DP3) Domestic 400NG Tariff**, "Rules
Governing the Interstate and Intrastate Movement of Personal Property for
Department of War and the Coast Guard", managed by the Defense Personal Property
Management Office (DPMO) at USTRANSCOM. Effective **15 May 2026 through 14 May
2027** (p. 1). **S1 kind:** `tariff`. **S2 adoption: 3** *within its domain* — it
is the single rate basis for all DoD/USCG domestic household-goods movement in
the US except Hawaii (p. 13, Purpose), and is developed "in partnership with all
the Military Services and commercial industry associations". Outside DoD work it
has **zero** adoption; the commercial analogue is the van line's own tariff.
**S3 openness:** `public` (US government work, published at
business.ustranscom.mil/dp3).

**What our reading covered.** The rules-bearing sections that matter for this
cluster were read in full: the Definitions and Acronyms lists (pp. 9-12), the
Introduction's Transportation Charges rules (pp. 14-16), Items 1-100 (Section 1,
pp. 18-43), the SIT items (17, 17-1, 17-2, 185, 210 — pp. 26-32, 57-59), the
movement-shape items (27, 28, 29, 33, 35 — pp. 34-40), and Appendix A's linehaul
composition and discount arithmetic (pp. 79-82). The item-code catalog was
cross-checked against the *Additional Rates* sheet of the 2026 baseline-rates
workbook. **Graded B, not A**, because three classes of material were not read:
the Section 2 accessorial narrative on pp. 45-51 and 62-72 (extracted and grepped
for item codes, not read line by line); Sections 3/5 (OTO boats & mobile homes,
Volume Moves, pp. 63-78, skimmed only); and the documents this tariff explicitly
defers to and which carry much of the *operational* vocabulary — the **Tender of
Service**, **DTR Part IV Chapters 401-403**, the **Claims and Liability Business
Rules**, and the separately published **Item Code Listing** (Item 2, Item 4
Note 1, Item 17.1, Item 18, Item 19). The SIT and charge findings below rest on
text read in full; treat the OTO/VM findings as indicative.

**Path discrepancy worth recording:** the task brief and `registry.yaml` both give
`docs/2026-400ng.pdf`, but the file is under `/home/steve/repos/pegasus/docs/`,
not under the domain-reference repo. Same for both XLSX refs.

## Model summary

The 400NG's unit of account is **the BL shipment** — one Bill of Lading, one
customer's property, one set of charges. Around it sit four orthogonal
structures:

**1. Geography is a four-level lattice, and rating happens at the coarse end.**

```
street address -> ZIP3 (first three digits of the ZIP)
              -> BPC   Base Point City        (783 of them, p. 13)
              -> SA    Service Area           (227: 20 metro + 207 non-metro, p. 32)
              -> Region / rate area           (16 CONUS regions, Item 498, Figure 3)
```
Mileage is BPC-to-BPC from the DPS mileage table, **except** when origin and
destination share a ZIP3, in which case DTOD mileage is keyed in manually
(pp. 13, 33, 79).

**2. The rating addresses are frozen at award, and they are not the operational
addresses.** Nearly every charge rule in the tariff is phrased *"block 19 of the
BL (requested pickup) and/or block 18 (requested delivery) **at the time the
shipment is offered and accepted by the TSP**"* — Items 17.2.a, 17.8, 28.3.b,
105.2, 135.2, 185.2, 210.1.a, 210.2 all repeat the formula verbatim. And the
tariff says outright that the actual storage location is irrelevant to charges:
"charges will not be based on the actual storage location" (Item 210.1) and
"regardless of the storage locations" (Item 17.9.a.2). So the model needs three
coexisting address facts, not one destination:

- the **requested pickup / requested delivery address as of award** — the rating
  basis, immutable for the life of the BL;
- the **actual pickup / actual delivery address** — what happened;
- the **storage location** — explicitly excluded from rating.

**3. Charges split into linehaul and non-linehaul, each with its own discount.**

```
LHS = [ BLHS + OLF + DLF + SH ] x InvdLHS ,  InvdLHS = 1.00 - dLHS
        base    origin  dest   shorthaul
        linehaul factor  factor (<= 800 mi only, priced per CWT-M)
```
(Appendix A, pp. 80-82.) Non-linehaul = the Additional Services / accessorial
items, most of which are priced per CWT from the **Geographical Schedule** tab by
Service Area and subject to either `dLHS` or `dSIT` depending on the item. The
TSP files `dLHS` and `dSIT` per **channel** — "a unique combination of three
elements…: (1) origin rate area, (2) destination rate area, and (3) code of
service" (Definitions, p. 11). Baseline rates are repriced annually by the
**General Price Adjustment**: `CPI% x 0.59 + CEU% x 0.41` (Item 40).

**4. A code-of-service taxonomy that is really a shipment-type taxonomy**
(Definitions, p. 11): **Code D** (motor van *or* container, CONUS->CONUS
residence to residence, mode at the TSP's discretion, no extra cost); **Code 2**
(containerized — "shipments must always be containerized, will never be customer
packed, and cannot be left unsecured or outdoors", containerization at the
residence unless the origin PPSO authorizes it at the TSP/agent warehouse);
**Code B** (boat tow-away, OTO); **Code H** (boat haul-away, OTO); **Code S**
(mobile home, OTO). Alongside, but under separate paper, sit **NTS**
(non-temporary storage) and **NTSR** (NTS release) — Item 27.3 is explicit that
delivery to NTS in a government facility makes *the facility the final
destination*, and further movement is "under separate BL/invoice".

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **BL / Bill of Lading** | "An accountable shipping document used for the acquisition of authorized transportation and related services from commercial TSPs for the movement of DoW-sponsored personal property shipments" | A6 | Definitions p. 11 |
| **Channel** | "A unique combination of three elements that defines how DoW solicits rates and TSPs file pricing: (1) origin rate area, (2) destination rate area, and (3) code of service (COS)" | A9/A12 | Definitions p. 11 |
| **TSP — Transportation Service Provider** | "Any party, person, or carrier that provides freight/personal property transportation and related services to an agency, **including brokers, motor carriers and freight forwarders**". A *DoW approved TSP* has a notice of acceptance into DP3 and must be approved before filing rates | A8 | Definitions p. 12 |
| **Shipper** | "The party that enters into an agreement with the TSP and pays for the shipment. **In DPS, the shipper is typically the Government**, except for Self-Procured moves." | A8 | Definitions p. 12 |
| **Customer** / **Owner** | DoW and USCG members, civilian employees and their families whose personal property is being moved; *Owner* is "the person… whose name the property is stored under", interchangeable with *customer*, and includes the owner's agent/consignee or, for a deceased owner, the survivors or estate | A8 | Definitions pp. 11-12 |
| **Designated Agent** | "A person who has been appointed to act in place of the customer to coordinate with the PPSO for shipping, monitoring Storage-in-Transit (SIT), or receiving the customer's property" — by legal Power of Attorney, letter, or during the application process | A8 | Definitions p. 11 |
| **Consignor** / **Consignee** | the party that supplies or ships / the recipient to whom the property is addressed or consigned for final delivery | A8 | Definitions p. 11 |
| **PPSO / PPPO / TO / ITO / JPPSO** | Personal Property Shipping Office / Personal Property Processing Office / Transportation Officer or Office / Installation Transportation Officer / Joint PPSO — the government counterparties who approve, pre-approve, dispute and pay | A8 | Acronyms pp. 9-10; Items 17, 29, 210 passim |
| **SB — Storage Branch** | USTRANSCOM office that adjudicates NTS-TSP fault and extra charges | A8 | Item 27.4.b |
| **NTS / NTSR** | Non-Temporary Storage / Non-Temporary Storage Release — a separate program; NTS delivery makes the facility the final destination and further movement moves under a separate BL | A5/A2 | Acronyms p. 10; Item 27.3 |
| **SIT — Storage-in-Transit** | "the holding of the shipment, **or portion thereof**, (except mobile home and boat shipments) in the warehouse used by the TSP or its agent for storage, **pending further transportation**, and will be affected only at specific request of the shipper or under the conditions specified below" | A5 | Item 17.2, p. 27 |
| **first available delivery date** | the TSP's earliest deliverable date, entered in DPS within one workday of arrival at the agent's facility; **it is the SIT start date** | A4/A5 | Items 29.1, 29.4, 29.6, 17.20 |
| **Scheduled delivery date** | the date agreed between TSP and customer, which the TSP "MUST update DPS with… PRIOR to the actual delivery date or within 2 hours after agreeing to a delivery date/time with the customer, whichever is EARLIER" | A4 | Item 17-1.3.a |
| **RDD — Required Delivery Date** | acronym only; the entitlement-side delivery deadline (defined in the DTR/TOS, not here) | A4 | Acronyms p. 10 |
| **GBD — Government Business Day(s)** | "Business days (Monday through Friday) that are not a Federal Holiday" | A4/A5 | Definitions p. 12 |
| **Attempted delivery** | a delivery run to the residence from SIT that fails through no fault of the TSP; billable only with PPSO pre-approval obtained **while the crew is at the delivery point**; PPSO has one hour of free waiting time to locate the customer or approve/disapprove | A4 | Item 17-1, pp. 30-31 |
| **Termination of liability (in SIT)** | the TSP's BL responsibility and liability "shall terminate on midnight of the day specified in the notice which the TSP receives through DPS… and the **warehouse/subcontractor shall become the final destination of the shipment under that BL**" | A5 | Item 17-2.2, p. 31 |
| **depositor** | after termination, "the TSP/warehouse/subcontractor shall thereafter recognize the individual DoW customer, **not the Government**, as the depositor of the property" | A5/A8 | Item 17-2.5 |
| **Partial withdrawal (delivery) from SIT** | shipper/customer requests withdrawal of a portion during SIT; PPSO schedules it; items identified by **inventory item numbers**; only complete cartons or item numbers, individual cartons not opened; TSP must obtain the actual weight of the portion withdrawn | A5/A6 | Item 17.13, pp. 29-30 |
| **Split Shipment** | a shipment where only a portion is stored in transit enroute, or where overflow property is delivered to the storage location on different dates | A2/A5 | Item 17.9, p. 28 |
| **Stop off** | "extra stops… made at locations necessary to accomplish the extra pickup or extra delivery of portions of the shipment. Extra stops are additional pickups made **after the first pickup** or additional deliveries made **prior to the final delivery**. Each such extra stop shall constitute an extra pickup or delivery." Authorized in **block 13 of the BL** or by pre-approval | A3 | Item 28.3, p. 36 |
| **Diversion** | "either a change (1) **while enroute** to the destination of the shipment **outside of the BPC of the original destination**, or (2) in the route at the request of the Government". Rated origin->diversion point plus diversion point->final destination. **Not** a diversion if the change arrives before the shipment moves, or if the shipment is already in destination SIT | A3/A4 | Item 28.4, pp. 36-37 |
| **Shuttle Service** | a truck-to-truck transfer where linehaul equipment cannot access origin or destination; pre-approval required with comprehensive notes; enumerated valid causes: building structure, inaccessibility by highway, inadequate/unsafe road, overhead obstructions, narrow gates, sharp turns, trees/shrubbery, roadway deterioration due to rain/flood/snow, the nature of an article | A3/A4 | Item 125, p. 52 |
| **Impractical Operations** | services the TSP cannot furnish through no fault of its own — road/approach conditions creating unreasonable risk, inadequate loading/unloading facilities, force majeure/war/riot/strike/picketing, or legal restrictions on linehaul equipment | A4 | Item 33, p. 38 |
| **Warehouse Pickup and Delivery Service** | when a shipment is delivered to or picked up from a warehouse, transportation charges include "only the unloading or loading at door, platform, or other point convenient or accessible to the vehicle" | A5/A7 | Item 27.1, p. 34 |
| **LHS / BLHS / OLF / DLF / SH / WHC / BSC** | Linehaul Charge / Base Linehaul / Origin Linehaul Factor / Destination Linehaul Factor / Shorthaul (<= 800 mi, priced on CWT-M) / Waterhaul Charge (Alaska motor-water-motor) / Bunker Surcharge (ocean, port-to-port only) | A7/A12 | Appendix A pp. 80-82; Definitions p. 12; Item 227 |
| **dLHS / dSIT** | the TSP's filed **linehaul discount** and **SIT discount**; charges are `baseline x (1.00 - d)` | A7/A12 | Appendix A p. 80 |
| **CWT / CWT-M** | hundredweight (total weight / 100) / hundredweight-miles (total miles x CWT) | A7/A12 | Acronyms p. 10; Appendix A |
| **FSC / FRA** | Fuel Surcharge / Fuel Related Rate Adjustment — 1% of the linehaul rate per $0.13 increment by which EIA national average diesel exceeds a $3.50 baseline **at the time of actual pickup** | A7 | Item 16.4-16.6, p. 26 |
| **GPA / EPA** | General Price Adjustment (annual, `CPI x .59 + CEU x .41`, effective 15 May) / Economic Price Adjustment (ad-hoc, for "extreme or prolonged" surges, excluding fuel) | A12 | Items 40, 41 |
| **Peak Season** | requested pickup date 15 May - 30 September | A7/A12 | Introduction p. 15; Appendix A p. 79 |
| **Item code** | `<item number><letter>` — e.g. `105A`, `210C`, `226A`. The item number is the tariff rule; the letter is the priced variant. **OT** variants exist for most labour-bearing items | A7/A9 | Items 4, 16, 17-1, 28, 35, 105, 120, 125, 130, 135, 175, 185, 210, 225, 226, 419, 499 |
| **226A Miscellaneous** | "Any authorized charge incurred by the TSP that **does not have a designated service code**, and not performed by a third party, shall be billed as a miscellaneous charge. TSP must submit a detailed note with a description of the service provided." | A7 | Item 226, p. 60 |
| **SF1200 / BL Correction Notice** | "the TSP/Agent will not redact, modify, or remove any information on the BL… The government is the only authorized agency who can redact, modify, or remove information on the BL **through an SF1200**". Destination changes "must be recorded on the BL" via a correction notice | A6/A9 | Introduction p. 14; Item 17.10, p. 28 |
| **GBLOC** | Government Bill of Lading Office Code — identifies the responsible installation/office; responsibility for a GBLOC can be **transferred between offices** with an effective date, and TSPs must cross-reference the transfer list for invoicing previous GBLOCs on shipment BLs | A9 | Regionalization p. 17; 400NG 2024 Change 5, p. 9 |
| **SCAC** | Standard Carrier Alpha Code | A9 | Acronyms p. 10 |
| **BVS / PS / RS / CSS** | Best Value Score = Performance Score (per shipment market) + Rate Score (per channel+COS); CSS = Customer Satisfaction Survey, nine months of data, cut off per performance period | A13-adj. | Item 19, p. 33 |
| **PBP&E** | Professional Books, Papers and Equipment — weight annotated **separately on the BL**; constructive weight 7 lb/cu ft if scales unavailable | A2 | Item 4.9.h, p. 21 |
| **Constructive weight** | 7 lb/cu ft (PBP&E, and the PPSO fallback), 25 lb/cu ft (gun safes without a data plate) | A2 | Items 4.9.h, 4.9.i, 4.11.e |

## Lifecycles & events

The 400NG is a pricing document, so it publishes events **only where money hangs
on them** — but where it does, it specifies them with unusual precision,
including the system of record and the deadline.

### Award and rate lifecycle
- The TSP files rates per **channel + COS** in DPS, gated on a current
  Certificate of Independent Pricing / Certificate of Responsibility and an
  **ETOSSS** (Electronic Tender of Service Signature Sheet), resubmitted annually
  (Item 8.1). Last rate submitted in a round overrides earlier ones (Item 8.4.b).
- "Acceptance and movement of a shipment by the TSP over a traffic channel under
  a BL shall constitute an agreement by the TSP to perform the transportation
  services at the original rate filed" (Item 1.2.a) — **acceptance is the binding
  act, and it fixes the rate basis**.
- Performance periods and re-ranking: scores recalculated and TSPs re-ranked at
  the end of each performance period; ranking by BVS (Item 19).

### Pickup-side
- TSP must enter the **origin representative's name and phone number in DPS at
  the time of shipment acceptance**, and update it to the representative who will
  actually service the shipment **before performing the pre-move survey**
  (Item 7.1). So "who the origin agent is" is a dated, versioned assertion, not a
  static field.
- Blocks 18 & 19 of the BL are "reflected in the DPS BL **at the completion of
  the pre-move survey**" (Definitions, *Shorthaul*, note, p. 12).
- Weighing (Item 4.9), with the same two methods as 49 CFR 375.509.

### Reweigh — a full sub-lifecycle with its own economics
- Two kinds: **automatic** (no pre-approval) and **requested** (pre-approval
  under item codes 4A origin / 4B destination). Item 4.2-4.3.
- Automatic triggers are entitlement-based, not operational: grades E-6 through
  O-10 and DoW civilians at **>= 7,000 lb**; grades E-1 through E-5 at
  **>= 4,000 lb** (Item 4.8). Reweighs are **not authorized below 1,000 lb**
  (Item 4.3.a.3.a).
- The TSP "must conduct the reweigh **before the actual commencement of unloading**
  of the shipment for delivery or placement into storage" (Item 4.3.a.1) — the
  same boundary 49 CFR 375.517 uses.
- **Reweighs may not be performed on the same scale** as the original weighing
  (Item 4.10.b.1 Exception, Item 4.11.d).
- The reweigh *charge* is payable only if the reweigh net weight >= the initial
  net weight, **or** is lower but within tolerance: < 150 lb for shipments
  <= 5,000 lb; < 5% of the lower net weight above 5,000 lb (Item 4.5). Invoice on
  the lesser weight (Item 4.11.d).
- Invoicing is **not** under 4A/4B — "TSP will submit billing under Item Code
  226A (Miscellaneous) with a note stating 'reweigh fee'… Do not bill using Item
  4A or Item 4B" (Item 4.4).
- Sequencing gate: for **direct delivery**, the TSP "cannot invoice for any
  services until reweigh has been performed and DPS reweigh information updated"
  (Item 4.11.c); more broadly, no destination/direct-delivery invoicing until the
  reweigh is performed, DPS is updated, and reweigh tickets reach the origin PPSO
  (Item 4.12.b). Refunds ride on the same invoice as the delivery-out or
  direct-delivery charges, or the destination PPSO disputes everything
  (Item 4.12.c).
- Duplicate-reweigh rule: origin and destination agents must coordinate and, if
  duplicates occur, DPS must be updated with the **lower** of the net reweigh
  weights (Item 4 Note 2).

### Arrival / delivery-scheduling — the strongest event material in the source
| Step | Actor | Deadline | Cite |
| --- | --- | --- | --- |
| "arriving the shipment in DPS" + providing the **first available delivery date** | TSP | within one workday after arrival at the agent's facility | Item 29.1 |
| delivery instruction **or** SIT approval | PPSO | within 2 hours of shipment arrival in DPS | Item 29.3 |
| if the customer can receive on the first available delivery date | — | **SIT is not authorized** | Item 29.2 |
| SIT effective date | — | "always… the TSP's **first available delivery date**, not the date of notification"; "SIT in date will be equal to the TSP's first available delivery date"; the arrival date must **not** be entered in the DPS "SIT Entry Date" field unless they coincide | Items 29.4, 29.6, 17.20 |
| first SIT day on a weekend or holiday | PPSO | requires pre-approval | Item 17.20 |
| 24-hour notice before placing a shipment in SIT | TSP | prior to arrival | Item 17.1 |
| **Scheduled delivery date** entered in DPS | TSP | before the actual delivery date **or within 2 hours** of agreeing it with the customer, whichever is earlier — otherwise the PPSO has grounds to disapprove any attempted-delivery charge | Item 17-1.3 |
| attempted delivery pre-approval | TSP requests, PPSO decides | requested **while at the delivery point**; PPSO gets one hour free waiting time | Item 17-1.4 |

### SIT lifecycle
- **Entry** has two distinct causes: at the **specific request of the shipper**
  (Item 17.2), or **forced** — "If delivery cannot be made at the address
  specified on the BL because of impractical operation as defined in Item 33, or
  for any other reason other than the fault of the TSP, and neither shipper,
  consignor, nor customer designates another address at which delivery can be
  made, TSP will place the property under the SIT provision" (Item 17.15).
- **Location kinds:** origin SIT, enroute SIT, destination SIT — rated
  differently (Item 17.4 vs 17.5; block 19 governs origin SIT, block 18 governs
  destination SIT, Items 185.2, 210.1.a).
- **Duration:** "may be placed in SIT **one or more times** for an aggregate
  period **not to exceed 90 days** unless the authorized Government
  representative authorizes additional storage" (Item 17.3); storage billable on
  "expiration of 90 days SIT and any additional 90-day increments" (Item 17.5.c).
- **Day counting is not calendar occupancy.** Storage days include both the day
  placed in and the day removed, and charges "apply each time SIT service is
  rendered" (Item 185.3) — so a re-entry restarts a **first-day** charge, and a
  failed delivery attempt that returns the goods to the warehouse incurs "a
  second first day storage charge" (Item 17-1.1.b). Conversely, accrual can stop
  before removal: if the shipment is not removed by the **5th GBD after the
  requested delivery date**, storage charges "cease to accrue after such date";
  if removed earlier, they cease on the day of removal (Item 17.7.a-b).
- **Segments:** when property enters SIT in segments on different dates, each
  segment is rated at the rates in effect on **its own** placement date
  (Item 17.17); storage is rated separately per portion but the 1,000-lb minimum
  applies to the **combined** weight (Item 17.9.b.2).
- **Partial withdrawal:** customer -> PPSO -> TSP; identified by **inventory item
  numbers** furnished by the customer; only complete cartons or item numbers,
  cartons not opened; un-stacking/restacking billed under Item 120; the customer
  or a Government representative may be present during sorting; the TSP must
  obtain the actual weight of the portion withdrawn; storage continues to accrue
  on the remaining weight (Item 17.13). Portions under 1,000 lb are billed at
  actual net weight under 226A (Items 17.9.c, 210.2.c.2).
- **No additions:** "During the SIT period, the customer may not add property to
  that already in SIT" (Item 17.14).
- **Records required in SIT** (Item 17.12) — both TSP and warehouseman must hold:
  itemized property list with the BL number; the shipment's point of origin and
  destination; **the condition of each article when received at and forwarded
  from the storage location**; the dates all charges/advances/payments were made
  or received; and the dates the property was delivered to and forwarded from
  storage.
- **Termination** (Item 17-2): liability ends at **midnight of the day specified
  in the DPS notice**; the warehouse becomes the final destination under that BL;
  the Government "may not revive the TSP's liability under the original BL, or
  reinstate the original BL"; the customer becomes the depositor; delivery-out
  afterwards is billed at current 400NG **minus a 25% discount**; and the TSP
  must refund prepaid-but-unperformed services (16B, 105A unpacking, 135B…) via
  226A no later than when it invoices for storage.

### Correction semantics
- The carrier **may not** alter the BL at all: "the TSP/Agent will not redact,
  modify, or remove any information on the BL issued to move DoW HHG/UB. The
  government is the only authorized agency who can redact, modify, or remove
  information on the BL through an **SF1200**" (Introduction, p. 14).
- Destination changes come as a **correction notice** from the Government and
  "must be recorded on the BL" (Item 17.10).
- Refunds and reimbursements are themselves coded transactions carrying a
  narrative note (226A, LHSREF) rather than edits to the original charge
  (Items 4.12, 4.13.3.b, 17-2.7, 27.4.b-c).

## Time, identity, evidence

**Time — the governing date differs by charge class, and there are five distinct
delivery-date roles.**

Governing dates:
- *Originally requested pickup date (at award)* governs the linehaul tables, the
  dLHS/dSIT discounts, peak season, and SIT/accessorial rate areas — and it
  survives renegotiation: "If a TSP… later negotiates with the customer a change
  in the pickup date that crosses into a new annual rate cycle, the TSP will move
  the shipment at the LH and SIT discounts effective on the **original requested
  pickup date** at the time the shipment is offered and accepted" (Item 1.2.b;
  Introduction ¶3, p. 15).
- *Actual pickup date* governs SIT and Accessorial Service tables (Item 1.2.c)
  and the fuel surcharge (Item 16.4), and is the general effective-date rule
  (Item 50).
- *Date of placement into SIT* governs each SIT segment's rates (Item 17.17).
- *Delivery date* governs the 25% delivery-out discount after termination
  (Item 17-2.6).

Delivery-date roles, all distinct and all separately load-bearing:
`requested delivery date` (block 18 at award) - `first available delivery date`
(sets SIT start) - `scheduled delivery date` (DPS, 2-hour deadline) -
`actual delivery date` - `RDD, required delivery date` (entitlement side).

Calendar arithmetic is explicit and mixed: **GBD** (Mon-Fri excluding federal
holidays) for the 5-GBD storage-accrual cutoff (Item 17.7); observed-holiday
shifting (Saturday -> preceding Friday, Sunday -> following Monday, Item 44.2);
**overtime** defined as 17:00-08:00 Mon-Fri or any time Sat/Sun/holiday, and only
when not for the TSP's convenience (Items 210.2.b, 125.4.e); a **midnight**
boundary for liability termination (Item 17-2.2); a fractional-hour rounding
table in quarter hours (Item 22.2). No time zone is stated anywhere.

**Identity.** The richest identifier set in this cluster:

| Identifier | Scope | Cite |
| --- | --- | --- |
| **BL number** | the shipment; required on the SIT itemized property list | Item 17.12.a |
| **SCAC** | the TSP | Acronyms p. 10 |
| **GBLOC** | the responsible government office — **and it can be reassigned mid-life**, with a transfer list and effective dates that TSPs must cross-reference "for invoicing previous GBLOCs on shipment BLs" | Regionalization p. 17 |
| **Channel** | origin rate area + destination rate area + COS — the key rates are filed against | Definitions p. 11 |
| **COS — code of service** | D / 2 / B / H / S | Definitions p. 11 |
| **ZIP3 -> BPC -> SA -> Region** | the geographic key chain used for rating | pp. 13, 32-33, 79 |
| **Item code** | the charge type, e.g. 210C | throughout |
| **Inventory item number** | the article — used operationally to select a partial SIT withdrawal | Item 17.13.a.1 |
| **SF1200 / DD Form 1164** | the amendment instrument / the local voucher authorizing additional NTS cost | p. 14; Item 27.4.c |
| **BL blocks 13 / 18 / 19** | positional identifiers the tariff *reasons about by number*: 13 = extra pickup/delivery addresses, 18 = requested delivery address, 19 = requested pickup address | Items 28.3, 17.2.a, 135.2 |

Note that the tariff addresses BL fields **by block number**, and the block
number is the stable reference — a reminder that an inbound DoD mapping must
carry the positional identity, not just a semantic name.

**Evidence and provenance.** Weaker than 49 CFR 375 on signatures but strong on
*who asserted what, into which system*:

- **DPS is the system of record and the assertion channel.** "Required notices or
  communications must be transmitted through the DoW Defense Personal Property
  System (DPS) when possible" (Definitions, *Notices or Communications*, p. 12).
  Several duties are literally "update DPS" duties with deadlines and financial
  consequences (Items 4.11.c, 4.12.b, 17-1.3, 29.1, 29.6).
- **Weight tickets** — identical six required fields to 49 CFR 375.519, restated
  (Item 4.10.a), plus: original tickets retained in the shipment file, true copies
  must accompany every weight-dependent invoice, and reweigh tickets must reach
  the **origin** PPSO before destination invoicing (Items 4.10.c-d, 4.12.b.3).
- **Manufacturer's weight substitution** is a named, sourced alternative to a
  weight ticket for vehicles and boats — Branham Automobile Reference Book, NADA
  Official Used Car Guide, "other appropriate reference sources", or the
  customer's own manufacturer documents (Item 4.9.g). That is an explicit
  *evidence-source enumeration* for a single fact, with a hierarchy — worth
  copying.
- **Constructive weight** as an evidenced fallback: 7 lb/cu ft for PBP&E and as
  the PPSO fallback, 25 lb/cu ft for undataplated gun safes, and "TSP will be paid
  based on either valid weight tickets or a PPSO constructive weight of 7 lbs per
  cu ft, **whichever is less**" (Items 4.9.h-i, 4.11.e).
- **Storage condition records** — condition of each article on receipt at and
  forwarding from the storage location, held by *both* TSP and warehouseman
  (Item 17.12.c). This is the SIT-leg analogue of the inventory exception record.
- **Third-party charges** require paid original receipts and prior PPSO
  pre-approval, with one reimbursement per receipt (Item 35.1).
- **Pre-approval** is a first-class precondition throughout — Items 105 (crating,
  debris removal), 120 (all), 125 (all shuttle), 58, 210D/210E, and 210A-C when
  delivery out of SIT exceeds 100 miles or the customer has amended orders moving
  them outside the original destination rate area (Item 210.1.a.1).

## Scores

Grade B reading — no C2/C3 cap applies (only grade C caps). Areas scored are
those the source actually addresses; A1, A6, A10 and A11 are deliberately not
scored (see below).

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A2 Shipment structure | 2 | 3 | 1 | 3 | n/a | 2 | 2 | 1 | Codes of service D/2/B/H/S as a real shipment-type taxonomy (Definitions p. 11); "shipment or portion thereof" throughout; split shipments and segments (Item 17.9, 17.17); net weight with a 1,000-lb minimum (Items 25, 56.3); sub-weights annotated separately for PBP&E on the BL and gun safes on the inventory (Item 4.9.h-i); container net weight (Item 4.9.e). No trip/consolidation view of a shipment. |
| A3 Trip, stop & assignment | 1 | 2 | 1 | 2 | 1 | 1 | 1 | 1 | Better than expected but partial. Genuine stop concepts: extra pickups *after the first pickup* and extra deliveries *before the final delivery*, each one an "extra stop", authorized in **block 13 of the BL**, with the rate computed over BPC miles from block 19 to block 18 **via** the authorized stop-offs (Item 28.3). Diversion defined against the BPC of the original destination (Item 28.4.a). Shuttle as an access-exception leg with an enumerated cause list (Item 125.1). **But: no trip, no route, no leg sequence, no consolidation of several shipments on one vehicle, no driver or equipment assignment** — the tariff rates per BL and the vehicle is visible only in the weighing rules. |
| A4 Execution events & tracking | 1 | 2 | 2 | 2 | 3 | 1 | 2 | 1 | C1=1: events exist only where money attaches — no arrive/depart at residence, no pack/load/unload events (those live in the Tender of Service and DTR, unread). C3=2 for real transitions with actors and deadlines (the Item 29 arrival->SIT-approval sequence, the Item 17-1.3 scheduled-delivery-date duty, attempted-delivery pre-approval). **C5=3** — the five distinct delivery-date roles, the rate-governing-date split (Items 1.2.b-c, 50), GBD arithmetic, observed-holiday shifting, OT windows, the midnight liability boundary, and quarter-hour rounding. Reason codes exist for shuttle (Item 125.1) and impractical operations (Item 33) but not for delays generally. |
| A5 Storage-in-transit | 3 | 3 | 3 | 3 | 3 | 2 | 2 | 1 | **The best SIT source we are likely to have.** C1=3: entry (requested and forced), origin/enroute/destination, duration cap and extension, partial withdrawal, segmented entry, re-entry, attempted delivery and return, delivery-out as a priced leg (Items 210A-F), termination, and post-termination delivery-out. C2=3: SIT defined as holding "pending further transportation" and explicitly excluding mobile homes and boats (Item 17.2); NTS separated as a different program with the facility as final destination (Item 27.3). C3=3: 90-day aggregate cap extendable in 90-day increments; a termination event at midnight that cannot be revived; the customer replacing the Government as depositor. C5=3: SIT start = first available delivery date, **not** arrival; accrual stops at the 5th GBD after the requested delivery date; both entry and removal days count; re-entry restarts the first day. |
| A7 Charges & billing hooks | 3 | 3 | 2 | 3 | 2 | 2 | 2 | 2 | Full linehaul/non-linehaul split with the formula (Appendix A pp. 80-82); two discounts (dLHS, dSIT) filed per channel; ~50 item codes with OT variants; pre-approval as a billing precondition; fuel as an indexed formula (Item 16); minimum charge and minimum weight (Items 25, 56); annual GPA and ad-hoc EPA (Items 40, 41); refunds and set-offs as coded transactions (Items 4.12, 27.4, 47). C8=2 on a **documented, heavily used escape hatch**: 226A Miscellaneous for "any authorized charge… that does not have a designated service code" plus a mandatory narrative note (Item 226). C3=2 because charge *state* (billed / disputed / denied / re-billed / refunded) is referenced but never enumerated. |
| A8 Parties & roles | 2 | 3 | 1 | 2 | n/a | 2 | 1 | 0 | C2=3: TSP, subcontractor, NTS TSP, warehouseman, PPSO/PPPO/TO/ITO/JPPSO, SB, customer/owner, designated agent, consignor, consignee, shipper — each separately defined with its authority stated. C4=2: origin/destination *representatives* exist and must be named in DPS (Item 7.1), but the van-line agent role set (booking/origin/hauling/destination agent) is absent; DP3's agency layer is TSP -> subcontractor, with a pass-through obligation (Introduction pp. 15-16). |
| A9 Identity & cross-references | 2 | 2 | n/a | 2 | n/a | 3 | 3 | 1 | C6=3: BL number, SCAC, GBLOC (with documented *reassignment* between offices and an obligation to cross-reference previous GBLOCs for invoicing), channel, COS, ZIP3/BPC/SA/Region, item code, inventory item number, SF1200, DD Form 1164, and BL fields referenced positionally by block number. C7=3: the correction model is explicit and asymmetric — the carrier may not touch the BL; only the Government may, only via SF1200; destination changes come as a correction notice and must be recorded on the BL. |
| A12 Rating & tariffs *(out of v1)* | 3 | 3 | 2 | 3 | 3 | 3 | 2 | 2 | The canonical US domestic charge/accessorial taxonomy for DoD work, with the complete rate structure (baseline tables x discount), the geographic key chain, the seasonal and fuel adjustments, the annual reprice formula, and the rate-acquisition lifecycle (annual filing rounds, OTO spot bids, Volume Move bidding, Special Solicitation). |

**S5 fit to Pegasus data:** `unknown` for every area. No pegII or Cloud schema
was inspected in this task; the S5 call belongs to the internal-source analyses
and to phase 3.

## Strengths worth adopting

1. **Separate the rating address from the operational address, permanently.**
   The "block 18 / block 19 **at the time the shipment is offered and accepted**"
   formula is repeated a dozen times precisely because the two diverge routinely
   (diversion, SIT, amended orders, long delivery-out). Our A9/A7 model should
   carry `requestedPickup@award` / `requestedDelivery@award` as immutable facts
   distinct from actual pickup/delivery and from any storage location — and
   should record explicitly that the storage location **does not** determine
   charges (Items 210.1, 17.9.a.2).
2. **SIT start is a derived date, not the arrival date.** "SIT in date will be
   equal to the TSP's first available delivery date" and the arrival date must
   not be entered as the SIT entry date (Items 29.4, 29.6, 17.20). Our A5 model
   needs `arrivedAtDestinationAgent`, `firstAvailableDeliveryDate` and
   `sitEntryDate` as three separate facts with a stated derivation, not one
   "in SIT since" timestamp.
3. **SIT accrual is not calendar occupancy.** Both the entry and the removal day
   count (Item 185.3); accrual stops at the 5th GBD after the requested delivery
   date even if the goods are still there (Item 17.7.a); and re-entry — including
   after a failed delivery attempt — restarts a first-day charge (Items 185.3,
   17-1.1.b). Model *billable SIT days* as a computed quantity over a sequence of
   SIT occupancy intervals, not as `dateOut - dateIn`.
4. **SIT entry has a cause, and one of the causes is failure.** Requested by the
   shipper (Item 17.2) vs forced by impractical operation or an undeliverable
   address with no alternate designated (Item 17.15). That is a two-value reason
   code our A5 model should carry from day one.
5. **Model SIT termination as an irreversible, notified event that changes the
   shipment's destination of record.** Item 17-2 is the sharpest statement in the
   corpus: liability ends at **midnight of the day named in the notice**; the
   warehouse "shall become the final destination of the shipment under that BL";
   the original BL cannot be revived or reinstated; and the depositor changes
   from the Government to the customer. Compare 49 CFR 375.609's conversion to
   permanent storage — same shape, far more precisely specified here.
6. **Partial withdrawal from SIT is an inventory-item-level operation.** Items
   are selected by **inventory item number**, only whole cartons or item numbers,
   cartons are never opened, the withdrawn portion is separately weighed, and the
   remainder keeps accruing on its own weight (Item 17.13). Any A5/A6 model that
   treats SIT contents as an opaque blob cannot express this.
7. **"Scheduled delivery date set" is a domain event with a deadline, not a
   field update.** Item 17-1.3 gives it a two-hour SLA measured from the customer
   conversation and attaches a financial consequence to not emitting it. This is
   the single best argument in the corpus for treating date-setting as an event.
8. **An explicit evidence hierarchy for a single fact.** Weight may be evidenced
   by a certified-scale ticket, or substituted from Branham / NADA / "other
   appropriate reference sources" / customer-supplied manufacturer documents, or
   fall back to a constructive rate per cubic foot — and where two are available
   the **lesser** governs (Items 4.9.g-i, 4.11.e). Copy this shape for any fact
   with multiple possible asserters.
9. **Corrections are asymmetric and instrumented.** Only the issuing authority
   may amend the BL, and only through a named instrument (SF1200 / correction
   notice); everything else — refunds, reimbursements, re-bills — is an additional
   coded transaction with a narrative note. Our A6/A9 correction semantics should
   name the instrument and the authorized party, not just allow an update.
10. **Keep a documented open class in the charge taxonomy.** 226A exists because
    a closed enum of charge codes is known to be insufficient, and it carries a
    *mandatory* free-text justification (Item 226). Any charge-type vocabulary we
    publish should have the same escape hatch with the same obligation.
11. **Stop-offs as a rated route.** Extra pickups/deliveries are authorized in a
    specific BL field (block 13) and the transportation charge is computed over
    the *total* weight, BPC-mile-routed **through** those stops (Item 28.3.b).
    That is a usable definition of "stop sequence affects the charge" for A3/A7.

## Weaknesses / traps

1. **It is a pricing document, not an operational one.** Its event vocabulary is
   complete only where money attaches. There are no arrive/depart events at the
   residence, no pack/load/unload events, no crew, no ETA, no exception codes for
   delay. Those live in the **Tender of Service** and **DTR Part IV Ch. 401-403**,
   which this tariff repeatedly defers to and which we have not obtained. Do not
   score A4 from this source alone, and do not conclude the domain lacks those
   events because the tariff omits them.
2. **"Shipper" is inverted relative to 49 CFR 375.** Here the *shipper* is
   normally **the Government** ("In DPS, the shipper is typically the Government,
   except for Self-Procured moves", p. 12) and the service member is the
   *customer* / *owner*. In 49 CFR 375 the *individual shipper* is the person who
   owns the goods and pays. A model with a single `shipper` party role will
   silently mean different things on commercial and DoD work. Our A8 vocabulary
   must distinguish *payer / account party* from *goods owner / transferee*
   explicitly, and should probably avoid the bare word "shipper" in the core
   model.
3. **Do not adopt 400NG item codes as the canonical accessorial enum.** They are
   DoD-specific, they collapse distinct services (diversion 28C is *billed under
   28B with a note*, Item 28.4.f; reweigh fees are billed under 226A rather than
   4A/4B, Item 4.4; sub-1,000-lb SIT partial deliveries are billed under 226A,
   Item 210.2.c.2), and several are pure program artefacts (35B Florida Keys,
   499 surcharges, Alaska waterhaul/bunker). They are a *good template* for what
   an accessorial catalog must express — id, variant, OT twin, pre-approval flag,
   unit of measure, which discount applies — but the commercial catalog must come
   from the van line's tariff.
4. **The printed tariff and the rate file disagree, and both are "the tariff".**
   Item 1.1.a says the tariff has two components — the printed rules plus a
   printed baseline spreadsheet — and a third, the DPS rating engine. They drift:
   the change log records "Removed references to 105E throughout document"
   (400NG 2022, p. 8), yet `105E UnPack Reg Crate` still carries a rate in the
   2026 `Additional Rates` sheet. Treat the item-code catalog as **versioned
   reference data with an effective date**, never as a constant compiled into the
   model.
5. **90 days is a DoD program rule, not a legal SIT limit.** 49 CFR 375 delegates
   the SIT maximum to the carrier's own tariff (375.609(c)(2)). Do not promote
   the 400NG's 90-day aggregate cap (Item 17.3) into the core model as *the* SIT
   duration rule.
6. **The rating-address freeze is a pricing convention, not a domain truth.** If
   the model adopts "block 18 at award" as *the* destination, it will mis-model
   what actually happened — diverted shipments, long delivery-out, amended
   orders. Keep both, and keep the tariff's rule as a *mapping*-layer fact.
7. **Its "diversion" is narrower than the everyday word.** It requires either a
   change **while enroute** to a destination **outside the BPC of the original
   destination**, or a Government-requested route change; and it is explicitly
   **not** a diversion if the change arrives before the shipment moves or if the
   shipment is already in destination SIT (Item 28.4.d). A generic
   `DESTINATION_CHANGED` event is not the same concept and should not be named
   "diversion" without this qualification.
8. **Money-flow concepts here are DoD-specific.** TPPS/eBill offsets (Item 47),
   pass-through obligations to subcontractors (Introduction pp. 15-16),
   set-off action against TSPs, PPSO dispute/deny, DD Form 1164 local vouchers —
   none of these generalize to commercial work, and the A7 model should not take
   its invoice lifecycle from them.
9. **We did not read the sources of much of its authority.** Claims and liability
   (Item 2), reweigh detail (Item 4 Note 1), the 24-hour SIT notice (Items 17.1,
   185.4), performance scoring detail (Item 19), and the Item Code Listing are
   all "see the other document". Any claim in this file that depends on those is
   marked as deferred, not asserted.

## Out-of-v1 material

- **A12 — rate structure.** `LHS = [BLHS + OLF + DLF + SH] x (1 - dLHS)`; SH
  applies only at <= 800 total miles across all modes, priced per **CWT-M**, and
  must be **reimbursed in full via EDI** if the shipment turns out to have moved
  more than 800 miles (Appendix A p. 81). Accessorials are priced per CWT off the
  Geographical Schedule by Service Area — the `Geographical Schedule` sheet of
  `400NG-BASELINE-RATES.XLSX` carries, per SA: Services Schedule, Linehaul Factor
  per cwt, `135A & B` Origin/Destination Service Charge per cwt, `185A` SIT First
  Day & Warehouse per cwt, `185B` SIT Additional Days per cwt, and the SIT P/D
  Schedule. Alaska moves via an Ocean Waterhaul table through Tacoma only, with a
  Bunker Surcharge that must be evidenced port-to-port on the actual ocean
  carrier's OBL (Item 227).
- **A12 — rate acquisition lifecycle.** Annual filing rounds in DPS gated on
  CIP/COR + ETOSSS (Item 8); **One-Time-Only (OTO)** bids for boats and mobile
  homes (Items 300-305); **Volume Moves** with a solicitation, a bid window,
  "after the VM Bid End Date/Time, no changes, withdrawals, or cancellations are
  allowed" (Item 2003.4.a.2), correction procedure (Item 2010), punitive action
  (Item 2009), blackout status (Item 2023); **Special Solicitation** (Item 228).
  A complete, well-specified bid/award lifecycle if we ever model rate
  acquisition.
- **A13-adjacent — carrier performance & award.** Best Value Score = Performance
  Score (per shipment market) + Rate Score (per channel+COS); four performance
  periods per year with nine-month CSS data windows and named appeal/TDL build
  periods; re-ranking at the end of each period (Item 19). Non-performance has
  teeth: "immediate suspension for non-performance of reweigh" (Item 4.7),
  market-approval revocation after two consecutive unfiled cycles (Item 8.1.b),
  non-use and disqualification (Item 7.2).
- **A11-adjacent — liability.** Full Replacement Value under 10 USC 2636a
  referenced (Items 7.5, 46); claims against a disqualified TSP may be
  transferred to the Service Claims Office and remain FRV-eligible (Item 7.5);
  collection of unearned freight charges on loss/destruction in transit
  (Item 46).
- **Operational constraints worth keeping** even though out of v1: prohibited and
  restricted articles with the frozen-food and perishable-plant exceptions
  (150 miles and/or 24 hours, no storage, no enroute servicing — Item 32); the
  blanket propane/butane prohibition including certified-empty tanks; inaccessible
  locations (no permanent stairway, inadequate lighting, no flat continuous floor,
  cannot stand erect — Item 58); inspection of articles and the PPSO
  pullback/reschedule path for contaminated goods (Item 14).

## Open questions

1. **Do the tenants do DP3/military work at all?** The user's framing is Allied
   and Atlas agency work with no EDI and no visibility platform today. If DoD
   work is out of scope, this source is still the best **SIT** and **accessorial
   taxonomy** reference in the corpus, but its A8 vocabulary (TSP/PPSO/shipper
   inversion) should be quarantined to a DoD mapping and kept out of the core
   ubiquitous language. **Needs the user.**
2. **Can we obtain the Tender of Service and DTR Part IV Ch. 401-403?** They hold
   the operational event vocabulary this tariff defers to (24-hour notice detail,
   pickup/delivery procedures, Code 2 selection criteria, reweigh guidance,
   BVS mechanics). Registry already has `src:dp3-tender-of-service` as a
   `candidate`; this analysis is the argument for promoting it.
3. **Is the separately published "Item Code Listing" obtainable?** It is the
   authoritative accessorial catalog (Item 1.2.c references it as the thing that
   governs which tables apply to SIT and accessorials); the PDF and the rate
   workbook between them give ~50 codes but neither claims completeness.
4. **What is the commercial analogue of `channel`?** For van-line work the rate
   basis is presumably tariff + discount + agent, not (origin area, destination
   area, COS). Question for `src:sirva-ade` / `src:atlas-world-group-api`.
5. **Does pegII model SIT occupancy as intervals or as a single in/out pair?**
   The 400NG requires intervals (re-entry, segments, attempted-delivery returns,
   partial withdrawals with separate weights). If pegII holds only
   `sitIn`/`sitOut`, that is a concrete v1 gap to record.
6. **Does anything in our systems distinguish `first available delivery date`
   from `scheduled delivery date` from `requested delivery date`?** This is the
   clearest A4/A5 time-model test case in the corpus.
7. **Registry path fix (for the orchestrator, not this analysis):** the 400NG PDF
   and both XLSX refs resolve under `/home/steve/repos/pegasus/docs/`, not under
   the domain-reference repo as `registry.yaml` implies. Flagged, not edited —
   `registry.yaml` is owned by the orchestrator.
