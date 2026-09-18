---
source: src:dp3-tender-of-service
analyzed: 2026-09-17
evidence_grade: A
material: |
  All under sources/dp3-tender-of-service/local/ (already on disk from the interrupted
  2026-09-17 gap-fill run; nothing re-downloaded). PDF page numbers equal the documents'
  own printed page numbers in both files.

  READ IN FULL - this is the grade-A part
    2026-tender-of-service-change-2.pdf  "DP3 HHG Tender of Service 2026 Change 2"
        (55 pp, effective 15 May 2026, as-of 04 Mar 2026). Read cover to cover:
        List of Changes pp. 5-9, Introduction p. 10, §A Qualifications pp. 10-17,
        §B Mutual Agreements and Understandings pp. 18-32, §C Performance Requirements
        pp. 33-46, §D Certification pp. 46-47, Figures B-1..B-6 pp. 48-55 (captions only -
        the figures are scanned form images, see below).

  READ IN FULL, OPERATIVE SECTIONS - grade A for what was read
    2026-nts-tender-of-service.pdf  "DP3 Non-Temporary Storage Tender of Service 2026"
        (89 pp, 15 May 2026). Read in full: §1.1 Scope + definitions pp. 10-11,
        §1.3 General Requirements pp. 18-23, §1.4 Special Requirements pp. 23-27,
        §1.5 Preparation of Articles pp. 27-32, §1.6 Inventory Requirements pp. 32-34,
        §1.7 Storage Requirements pp. 34-40, §1.8 NTS TSP Responsibility pp. 40-44,
        §5.5-5.14 (service order, charges, compensation, attempted pickup/delivery,
        claims, mold, disposition, inconvenience claims, real property) pp. 46-56.

  DIFFED, NOT RE-READ
    2026-tender-of-service.pdf (54 pp) and 2026-tender-of-service-change-1.pdf (54 pp).
        Change 2 carries the cumulative "List of Changes" table for 2023, 2023-C1, 2024,
        2024-C1, 2025, 2026, 2026-C1 and 2026-C2 (pp. 5-9), which was read in full and is
        what the version history below rests on. The bodies of the base and Change-1 PDFs
        were not read line by line; Change 2 supersedes both.

  SKIMMED
    NTS ToS §1.2 General Cyber Security pp. 11-18, §2-4 pp. 44-46, §5.1-5.4 rate
        submission pp. 44-46, §5.15-5.18 pp. 56-58, §6-8 payment/certification pp. 58-65,
        Attachments A-N pp. 66-89.
    HHG ToS §A.2 General Cyber Security pp. 11-17 (read, but it is DFARS boilerplate with
        no domain content beyond the incident-report field list).

  NOT READ / NOT AVAILABLE
    Every figure in both documents is a scanned form image; pdfminer returns the caption
    only. So the *field lists* of DD Form 619, the DP3 Notification of Loss or Damage
    AT DELIVERY and AFTER DELIVERY forms, the Unusual Occurrence Notification Form,
    the Foreign Vendor Report, the Inconvenience Claim Form, the Household Goods
    Descriptive Inventory (NTS Attachment F, which carries the **exception and location
    symbol legend**), the Locator Sheet (Attachment G) and the Firearm Chain of Custody
    Form (Attachment L) were NOT read. The symbol legend in particular is a real loss.
    Documents this ToS binds itself to but which are separate publications and are not in
    local/: the **International Tender (IT)**, the **400NG** (held separately as
    src:dp3-400ng), the **DP3 Claims and Liability Business Rules** (src:dp3-claims-liability,
    not yet captured), **DTR Part IV Chapter A-410** (Unusual Occurrences), the
    **Storage Management Branch Tender of Service** (cited at HHG §C.14.b for the
    "Storage Area" requirements), and the **Weight Estimator** tool.

  NOTE ON THE REGISTRY ENTRY: the id `dp3-tender-of-service` currently covers two
  genuinely different contracts - the HHG ToS and the NTS ToS. They have different
  counterparties, different ordering documents (BL vs DD Form 1164) and different
  obligation sets. See "registry changes" at the end.
---

# DP3 Tender of Service (HHG 2026 Change 2, and NTS 2026) - analysis

## What it is

A **Tender of Service** is the standing offer a Transportation Service Provider makes
to the US Government, and it is written in the **first person**: *"I will weigh all
shipments...", "I agree to trace shipments upon request...", "I understand I am not
liable for an IC payment if..."*. The TSP signs an Electronic ToS Signature Sheet
(ETOSSS) and is thereby bound for shipments picking up between 15 May 2026 and
14 May 2027 (HHG ToS §A.1.b(1)-(3), p. 10). Managed by the **Department of War
Personal Property Activity (DoW PPA)** at Scott AFB - renamed from USTRANSCOM/DPMO
throughout by Change 2 (List of Changes p. 9).

**S1 kind:** `contract` (a standing offer / adhesion tender, not a regulation and not
a tariff). **S2 adoption: 3 within DoD household-goods moving** - it binds every TSP
carrying DoD/USCG personal property, which is a large fraction of the US van-line
industry; **0 outside it**. **S3 openness:** `public` - published at
business.ustranscom.mil/dp3/pdfs.cfm, and DTR Part IV Appendix A-B is nothing but a
page of direct URLs to each year's edition (`../dtr-part-iv/local/dtr_part_iv_app_A-B.pdf`
p. 1, which gives the canonical 2026 URL).

**Why this source matters more than its size suggests.** Round 1 established that every
strong *execution* source we hold - Samsara, project44, Omnitracs, DCSA - scores 0 or 1
on **C4 HHG fidelity**, and every strong *HHG* source is weak on execution. This is the
document that breaks that trade-off. It is the only source in the corpus that gives
**HHG-native execution milestones with the actor, the clock, the evidence and the
remedy all attached to the same sentence.** The DTR (analysed at
[`../dtr-part-iv/analysis.md`](../dtr-part-iv/analysis.md)) says what the *Government*
does and what the *system* records; the ToS says what the *mover* must do and by when,
and what happens when they do not. Read the two as one source.

**What our reading covered.** The HHG ToS 2026 Change 2 was read **cover to cover** -
hence grade **A**. The NTS ToS was read in full across its operative sections
(§1.1, 1.3-1.8, 5.5-5.14) and skimmed elsewhere; treat NTS-specific claims as
**grade B**. The figures in both documents are images and were not read.

## Model summary

The HHG ToS organises itself around **three obligation classes**, and the distinction
is worth preserving:

1. **§A Qualifications** - who may hold the tender at all (registration, DOT/state
   authority, CMMC cyber affirmations, background checks, foreign-vendor suitability,
   debarment screening). Preconditions on the *party*, not on any shipment.
2. **§B Mutual Agreements and Understandings** - standing duties that attach to the
   *relationship*: through-responsibility, tracing, weighing, loss and damage,
   inconvenience claims, unusual occurrences, third-party declaration, reporting.
3. **§C Performance Requirements** - duties that attach to *this shipment's execution*:
   dates, survey, arrival and delivery notification, packing, inventory, containers
   and seals, documents, SIT, unloading, recording loss or damage.

Cutting across all three is the document's real contribution: **an obligation with a
clock.** Nearly every duty is stated as *<actor> must <act> within <interval> of
<triggering event>, recorded in <system or document>, or <consequence>*. That four-part
shape - trigger, deadline, evidence, remedy - is the A4 material round 1 could not find.

The NTS ToS has a different shape because it is a different contract. Its unit is the
**lot** ("personal property placed in storage at Government expense and covered by one
Service Order for Personal Property (DD Form 1164)", §1.1.7.4, p. 11); its clock is the
**storage period** ("the period of time the NTS TSP has possession of the property
pursuant to Government orders", §1.1.7.5); its counterparty is the **Transportation
Officer**, not a shipping office; and its formation rule is explicit: *"An enforceable
contract is entered into when the NTS TSP receives the Government service order"*
(§5.6.3, p. 48). The HHG ToS's shipment is a *movement*; the NTS ToS's lot is a
*bailment*.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| Customer | DoW/USCG members **and civilian employees** whose property is moved or stored ("customer" was defined by the 2026 edition; earlier editions said member) | A8 | HHG Introduction p. 10; NTS §1.1.7.6 |
| TSP | The party on the BL; solely responsible for the acts and omissions of any third party it contracts with | A8 | HHG §B.3.g p. 19 |
| Move Management Company (MMC) | A centralised entity providing customer service / operational coordination / shipment management on behalf of a SCAC; **domestic program only**; must be identified in DPS; **may not be named as the origin servicing agent** | A8 | HHG §B.17.b p. 28; §B.20.a p. 30 |
| Trusted Agent | A named individual "expected to be very familiar with DoW processes and readily accessible to DoW PPA" | A8 | HHG §B.17.b |
| Claims Manager | A named role the TSP must declare in the DPS Qualifications module | A8, A11 | HHG §B.17.b |
| Origin servicing agent | The actual origin representative, by name and telephone, in DPS - must be updated to the real servicing rep **before** the pre-move survey | A8, A3 | HHG §B.20 p. 30 |
| NTS TSP / warehouseman | The storage counterparty; a distinct tender, distinct qualification, distinct liability insurance | A8, A5 | NTS §1.1, §1.8.11 |
| TSP for Carriage | The line-haul carrier that collects a lot **from** an NTS warehouse - a named third party in the custody chain | A3, A8 | NTS §1.6.10 p. 34; §5.8 p. 50 |
| Double brokering | "when a TSP assigns a shipment to a carrier who then brokers the shipment to another carrier" - prohibited | A8 | HHG §B.3.f p. 19 |
| Lot | Property placed in storage at Government expense covered by **one DD Form 1164** | A2, A5 | NTS §1.1.7.4 |
| Storage period | The period the NTS TSP has possession pursuant to Government orders | A5 | NTS §1.1.7.5 |
| Handling-in / Handling-out | The warehouse work of receiving a lot into storage / releasing it; each a separately ordered and separately priced service with its own clock | A5, A7 | NTS §1.8.1 p. 40 |
| FADD (First Available Delivery Date) | The earliest date the TSP can deliver; must be given to the customer *with* each delivery notification and is the anchor for inconvenience-claim arithmetic | A4, A11 | HHG §B.11.f p. 24; §C.3.e-f p. 35 |
| Spread dates | Seven consecutive calendar days ending at the customer-entered "Latest Pickup Date"; the pickup must fall inside; **the pack dates may precede the pickup and fall outside the spread** | A4 | HHG §C.3.j-l p. 35-36 |
| Short fuse | An award with a compressed lead time; its own DPS queue; collapses several deadlines to 1 GBD | A1, A4 | HHG §B.18.a; §C.2.d |
| Turned back shipment | The TSP handing a shipment back; if within 14 calendar days of the pickup date and the PPSO cannot rebook the original dates, the TSP owes miscellaneous expenses | A1, A11 | HHG §B.11.k p. 26 |
| Inconvenience Claim (IC) | A *no-fault-of-the-customer* delay remedy paid by the TSP directly to the customer, computed per diem per person per day | A11, A7 | HHG §B.11 pp. 23-27 |
| Unusual Occurrence | "incidents of major significance producing significant loss, damage or delay resulting from strikes, port congestion, fires, pilferage, vandalism, and similar incidents" | A4 | HHG §B.16 p. 26 |
| After Action Report (AAR) | Written report due within 10 GBDs on any unusual-occurrence shipment: BL number, customer name, **root cause**, and mitigation efforts; then a final chronological report | A4, A6 | HHG §B.10.b p. 22 |
| Loose load shipment | An uncontainerised shipment - gets its own arrival/notification procedure | A2, A4 | HHG §C.3.e p. 35 |
| Containerized at Warehouse (CW) | An inventory annotation for items removed from the residence loose and containerised later | A2, A6 | HHG §C.9.a(18) p. 41; §C.11.b |
| Overflow shipment | The split portion of a shipment that will not fit; **the established RDD applies to all parts**; separate inventory required | A2, A4 | HHG §C.10 p. 42 |
| Exception Symbols / Location Symbols | The inventory's condition-coding legend; **"the omission of these symbols will indicate good condition except for normal wear"** | A6, A10 | HHG §C.9.a(14) p. 40; NTS §1.6.6 |
| Exception sheet | The custody-transfer discrepancy record written when a lot leaves NTS for a line-haul carrier | A6, A11 | NTS §1.6.10 p. 34 |
| High Value / high-risk inventory | An optional separate detailed inventory, an addendum to the main one, signed by the TSP | A6, A10 | HHG §C.9.a(3); NTS §1.6.9 |
| Tamper-evident seal | Applied at the residence for international/Code 2 containers; **seal numbers annotated on the inventory cross-referencing the container number** | A6, A9 | HHG §C.11.i pp. 43-44 |
| M-PRO / S-PRO | Member's vs spouse's professional books, papers & equipment - segregated, in separate cartons, marked, weighed and inventoried separately | A2, A10 | HHG §C.9.a(16) pp. 40-41 |
| Constructed weight | 7 lb/cu ft (25 lb/cu ft for a gun safe without a data plate), usable only with prior PPSO approval and a written account of how the tickets were lost | A2, A10 | HHG §B.8.a(3) pp. 21-22; NTS §1.6.11 |
| Real Property Damage | Damage to the *house*, not the goods - its own form, its own 7-day notice clock, its own claim channel | A11 | HHG §B.10.e pp. 22-23 |
| Safety Move (SM) | A shipment flagged in DPS where origin and destination must not be disclosed outside the one named person, "who may not be the customer" | A8 | HHG §B.18.a p. 28 |
| Bingo card / check-off sheet | Internal company delivery tally - explicitly **not** proof of delivery | A6 | HHG §C.9.a(24) pp. 41-42 |

## Lifecycles & events

### The notification catalogue - an obligation with a clock is an event with a deadline

This is the densest and most directly reusable material in the whole corpus. Every row
is *trigger -> actor -> deadline -> where it is recorded*. All HHG ToS cites are to
`local/2026-tender-of-service-change-2.pdf`.

| # | Trigger | Actor | Deadline | Recorded in | Cite |
| --- | --- | --- | --- | --- | --- |
| 1 | Shipment award | TSP | initial customer contact within **3 GBD** | DPS | §C.2.c p. 34 |
| 2 | Shipment acceptance | TSP | confirm the agreed pickup date **in writing to the customer** within **3 calendar days** | writing + DPS | §C.3.m p. 36 |
| 3 | Shipment acceptance | TSP | origin servicing agent name + phone in DPS within **15 calendar days of acceptance or NLT 7 calendar days before pickup, whichever is sooner** (short fuse: **1 GBD**) | DPS | §B.20.a p. 30 |
| 4 | Shipment acceptance | TSP | pre-move survey + weight estimate: **5 GBD from acceptance but NLT 9 days before first pack/pickup, whichever is later**; ordered <9 days out -> NLT 3 days; <3 days out -> NLT 1 day | DPS | §C.2.b pp. 33-34 |
| 5 | Pre-move survey done | TSP | survey data (estimated weight, agreed pack/pickup dates, delivery info) in DPS **NLT 3 GBD before pickup** (1 GBD short fuse) | DPS | §C.2.d p. 34 |
| 6 | Any concern about the residence's condition found during survey | TSP | **immediately** contact local quality assurance | - | §C.2.e p. 34 |
| 7 | Agreed pickup date reached | TSP | document the agreed date **and the customer's acceptance** in DPS within 3 calendar days or 24 h before pickup, whichever is sooner | DPS | §C.3.n p. 36 |
| 8 | First pack date - 2 GBD | TSP | **BL may not be printed earlier than this** | - | §C.3.n p. 36 |
| 9 | Afternoon before any scheduled pack/pickup/delivery | TSP | tell the customer whether service is **AM (0800-1200) or PM (1200-1700)** | - | §C.1.h p. 33 |
| 10 | Departure from origin | TSP | record the **legal name and US DOT number of the service provider actually hauling the shipment** plus the departure date, in DPS General Remarks, within **2 GBD** | DPS General Remarks | §B.3.f p. 19 |
| 11 | Pickup | TSP | weigh and enter weight in DPS within **4 GBD of pickup or before arrival, whichever is earlier** - stated purpose: *"to allow the customer or PPSO the opportunity to request a reweight"* | DPS | §B.8.a pp. 20-21 |
| 12 | Pickup | TSP | weight tickets to the origin PPSO within **7 GBD** | PPSO | §B.8.a |
| 13 | Pickup | TSP | full document set to PPSO **NLT 7 GBD**: weighted BL (gross/tare/net/pro-gear), weight tickets, DD 619, inventories, third-party invoices | PPSO | §C.12.a-b p. 44 |
| 14 | Pickup | TSP | arrival/departure at **any** in-transit facility, storage facility, POE or POD, **or any change in estimated arrival** -> notify the customer by phone or e-mail with **status, location and updated ETA**, within **3 GBD of pickup or 1 GBD of any change** | DPS remarks | §C.3.b p. 34 |
| 15 | Reweigh performed and lower | TSP | update DPS **before invoicing or within 4 GBD of the reweigh, whichever is earlier**, and invoice on the lower of the two weights; if already invoiced, submit a **supplemental invoice refunding the difference** | DPS + invoice | §B.8.a(2)(c)-(d) p. 21 |
| 16 | PPSO or customer asks to witness a reweigh | TSP | provide the reweigh **date and time** with reasonable opportunity to attend | - | §B.8.a(2)(b) p. 21 |
| 17 | Trace request from PPSO or customer | TSP | acknowledge **and** report the shipment's location within **1 GBD domestic / 72 h (3 GBD) international** | - | §B.6 p. 20 |
| 18 | Shipment placed in SIT at origin at Government direction | TSP | notify the customer of the placement "to allow the customer to make arrangements at destination" | - | §B.7 p. 20 |
| 19 | Release from origin SIT | TSP | notify the customer of the **new RDD** | - | §B.7 p. 20 |
| 20 | Arrival at destination | TSP | record arrival and/or delivery in DPS; notify and coordinate delivery | DPS | §C.3.a p. 34 |
| 21 | Before delivery | TSP | **at least 24-hour notice**, e-mail or telephone | - | §C.3.c p. 34 |
| 22 | Before delivering to SIT instead of the residence | TSP | **two documented unsuccessful contact attempts, six hours apart**; if the first fails the **final attempt must be telephonic** | DPS | §C.3.c p. 34 |
| 23 | Loose-load shipment approaching destination | TSP | before arrival give the **FADD**, contact numbers, e-mails and hours of operation, and state that the customer has **24 hours from the first notification** to respond; update DPS Shipment Management Remarks **immediately after each notification** | DPS | §C.3.e p. 35 |
| 24 | Containerised shipment arriving | TSP | **arrive the shipment in DPS first**, then contact the customer within 24 h with the same FADD package | DPS | §C.3.f p. 35 |
| 25 | Customer confirms a delivery date | TSP | **immediately** update DPS with the scheduled delivery date - and arrive the shipment in DPS "regardless of shipment location" | DPS | §C.3.e NOTE p. 35 |
| 26 | Knowing a pickup date or RDD cannot be met | TSP | notify the customer **at the earliest practicable time** with the new date/ETA **and inconvenience-claim guidance**; update DPS **before the missed date / before the RDD expires** with: new scheduled pickup date; and for missed RDDs the **last known location, cause for delay and new ETA** | DPS | §C.3.i pp. 35 |
| 27 | Any change of dates | TSP | "ensure all dates are correct and updates made in system **within 24 hours**" | DPS | §C.3.c p. 34 |
| 28 | SIT approved | warehouseman | complete handling-in services by **COB the third GBD** after approval | - | §C.14.b p. 45 |
| 29 | Missing item found at delivery | TSP | **tracer action immediately**; advise the customer **in writing within 30 days of delivery** of the result; forward found items by expedited means at no cost if a claim has not yet been initiated | writing | §C.17.c-d p. 46 |
| 30 | Unusual occurrence | TSP | notify **origin PPSO, destination PPSO, the Military Service HQ and DoW PPA** on the DP3 Unusual Occurrence Notification Form; **AAR within 10 GBD** with root cause | form + AAR | §B.16 p. 26; §B.10.b p. 22 |
| 31 | Pack-out or delivery at a residence | TSP | **joint walk-around inspection with the customer on arrival and again before departure**, recording interior and exterior condition in writing on the DP3 Real Property Damage Form | form | §B.10.e p. 22 |
| 32 | Real-property damage occurs | customer | notify the TSP within **7 calendar days**, clock starting the **first day after** the pickup/delivery date - **and the TSP's failure to provide a point of contact negates the 7-day period entirely** | - | §B.10.e pp. 22-23 |
| 33 | Real-property damage notified | TSP | arrange a repair firm to inspect within **15 calendar days** | - | §B.10.e p. 23 |
| 34 | Inconvenience claim received | TSP | acknowledge within **5 GBD**; reimburse within **30 days** | - | §B.11.c-d p. 23 |
| 35 | Claim unsettled at 60 days | TSP | advise the claimant **in writing** of status and reason for delay, and again at **each succeeding 30-day period** | writing | §B.10.c p. 22 |
| 36 | Claim settled | TSP | update DPS with final action, **date and total amount of settlement** | DPS | §B.10.d p. 22 |
| 37 | IC dispute unresolved | TSP | escalate to **origin PPSO for a missed pickup, destination PPSO for a delivery**; appeal to DoW PPA within **10 calendar days**; settle within **10 days** of the final decision | e-mail | §B.11.h p. 25 |
| 38 | Monthly (twice monthly 15 Jun - 31 Oct, due the 1st and 15th) | TSP | report **all filed ICs including completed payments, by BL**, and all shipments with missed pickups, late deliveries or exceeded SIT delivery windows | e-mail report | §B.11.j p. 26 |
| 39 | Seals must be broken before delivery | TSP | notify PPSO/PPPO **and the customer** and give them the opportunity to be present; a QA inspector will attend within **2 GBD**; reseal and record the **new seal numbers in DPS** | DPS | §C.11.i(5) p. 43 |
| 40 | Seals found broken in transit | TSP | reseal, replace, and annotate **the circumstances along with the new seal numbers** in DPS; verify seal integrity with the customer at delivery; if only discovered at delivery, notify the customer and document under DPS General Remarks | DPS | §C.11.i(6) pp. 43-44 |
| 41 | Cyber incident discovered | TSP | notify within **72 hours**; follow-on report within **5 calendar days** including **the BL numbers implicated** | phone/e-mail | §A.2.d(2), §A.2.f pp. 15-16 |
| 42 | Any change to officials / third-party representatives | TSP | disclose in the DPS Qualifications module within **5 days** | DPS | §B.17.a p. 28 |
| 43 | Notified an entire shipment is available at a military terminal | TSP | collect **NLT 1 GBD (air) / 5 GBD (water)** from receipt of notification | - | §B.4.a p. 20 |

NTS-side equivalents (`local/2026-nts-tender-of-service.pdf`):

| Trigger | Actor | Deadline | Cite |
| --- | --- | --- | --- |
| Prearranged pickup time cannot be met | NTS TSP | notify **the customer and the TO immediately** | §1.3.6 p. 21 |
| Pickup | NTS TSP | complete wrapping/processing for storage **NLT COB the third workday following pickup**; all remaining handling-in **within 3 GBD of pickup** | §1.3.6 p. 21; §1.8.1 p. 40 |
| Handling-out ordered | Government | NTS TSP gets **at least 5 GBD advance notice**; storage payment terminates for property not handled out within 5 GBD | §1.8.1 p. 40 |
| Receipt of a lot | NTS TSP | weight certificates + **nonnegotiable warehouse receipt** to the TO within **7 GBD** | §1.8.3 p. 41 |
| Firearms arrive at the warehouse | NTS TSP company official | **sight-verify** and certify in writing to the local PPSO, by make/model/serial (and container number), within **72 hours** of arrival - at the residence if the shipment is containerised | §1.4.13.1 pp. 25-26 |
| Firearm discovered missing | NTS TSP | notify the Storage Branch **immediately**; triggers a **100% inventory of every firearm in storage** | §1.4.13.2 p. 26 |
| Theft / fire / flood / earthquake / tornado, or foreseeable loss | NTS TSP | notify the SPM **immediately by the quickest means**; SPM investigates and **may withhold new awards during the investigation** | §1.8.6-1.8.7 p. 41 |
| Water damage | NTS TSP | per-item loss/damage report to the TO (copy SPM) within **10 working days** | §1.8.7.1 p. 42 |
| Any other shortage or damage | NTS TSP | complete report within **5 GBD following the detection and/or occurrence** | §1.8.7.4 p. 42 |
| Anticipated corporate change (sale, name change, bankruptcy, seizure) | NTS TSP | **90 days** written notice; results in the warehouse being placed in non-use | §1.8.9 pp. 42-43 |
| Line-haul carrier fails to collect a lot on the specified date | NTS TSP | notify the TO **no later than the following business day**, keep storing; **DD 1164 is amended to document the carrier's failure as the cause of the additional cost**, and the PPSO sets off against that carrier on its BL | §5.8.2 p. 50 |
| Container shows contamination / suspected mold | TSP | contact the PPSO **by phone and in writing (e-mail preferred, with Delivery and Read Receipt as proof of notification)**; QA inspector within 2 GBD; on confirmation notify the customer, the Military Claims Office and the inspecting PPSO, and update the destination PPSO | §5.11.1 p. 51 |
| Intent to dispose of stored property | NTS TSP | notify the PPSO in writing; SCRA and state bailment law apply | §5.12 p. 52 |

### SIT, end to end, as the mover experiences it

Assembled from HHG ToS §B.7, §B.11.f, §C.3.a-h and §C.14 (pp. 20, 24-25, 34-35, 45),
with the Government-side procedure in `../dtr-part-iv/` §D.5 / A-406 §A:

1. **Origin SIT.** Requested by the TSP or PPSO in DPS, approved by the PPSO. If the
   Government directs it, the TSP must **tell the customer it happened** so they can
   make destination arrangements, and must **tell the customer the new RDD** when it is
   released (§B.7).
2. **Arrival at destination.** The TSP records arrival in DPS. For containerised
   shipments the *order is mandated*: **arrive in DPS first, then contact the customer**
   (§C.3.f). For loose loads the contact happens **before** arrival (§C.3.e).
3. **The 24-hour / two-attempt gate.** The customer must get at least 24 hours' notice
   for delivery (§C.3.c) and the notification must carry the **FADD**, contact numbers,
   e-mails and hours of operation, with an explicit statement that the customer has
   **24 hours from the first notification to respond** (§C.3.e-f). A shipment may not be
   put into SIT unless **two documented unsuccessful contact attempts six hours apart**
   have been made, and if the first fails the second must be **telephonic**.
4. **The evidentiary consequence.** *"If PPSO determines the TSP did not provide at
   least 24 hour notice to the customer before placing shipment in SIT, PPSO will deny
   the SIT and delivery out charges"* (§C.3.h, p. 35). The notification is not
   advisory; it is the precondition of getting paid for the storage.
5. **Calendar constraint.** *"SIT cannot start on weekends and/or holidays"* (§C.3.g).
6. **Handling-in.** Warehouseman has until **COB of the third GBD after SIT approval**
   (§C.14.b). Containerised shipments **must not be de-containerised** in SIT
   (§C.14.c). Loose domestic lots must be identified in plain view by customer name,
   BL number and **SIT control number** (§C.14.d).
7. **Delivery out.** The customer requests; the TSP must deliver **within 7 GBD of the
   customer's first contact requesting delivery, or within 2 GBD of the requested
   delivery date when that date is more than 7 GBD out - whichever is later**
   (§B.11.f(2)). Missing that window is an inconvenience-claim event.
8. **Who pays for the delay.** The TSP owes an IC for a SIT placement **only if it
   failed to make the two documented attempts** (§B.11.f) - otherwise SIT is a no-fault
   outcome. But once in SIT, the customer is owed an IC **between the date placed into
   SIT and the FADD out of SIT**. There is a further carve-out for "good cause"
   unavailability (short-notice mission, hospitalisation, convalescent leave) supported
   by a statement of non-availability (§B.11.l, pp. 26-27).

### Reweigh as a right, not a service

The reweigh rules are unusually clean and should be lifted wholesale
(HHG ToS §B.8, pp. 20-22):

- The **weight-entry deadline exists to protect someone else's option**: enter the
  weight within 4 GBD of pickup *or before arrival, whichever is earlier*, expressly
  "to allow the customer or PPSO the opportunity to request a reweight." A deadline
  whose stated purpose is to keep a third party's right alive.
- **Either the customer or the PPSO may demand one**; the DTR adds the triggers -
  the customer believes the shipment will exceed or come within 90% of the weight
  allowance, or the PPSO doubts the accuracy, with floors of 500 lb HHG / 100 lb UB
  (`../dtr-part-iv/local/dtr_part_iv_A_402.pdf` §D.7.a, p. 20).
- **It is witnessable**: on request the TSP must give the date and time and a
  reasonable opportunity to attend (§B.8.a(2)(b)).
- **It is asymmetric in the customer's favour**: if the reweigh comes out lower, the
  lower figure governs and the TSP invoices on it; if already invoiced, a
  **supplemental invoice refunds the difference** (§B.8.a(2)(c)-(d)). A reweigh can
  only reduce what the Government pays.
- **International shipments are reweighed at destination by default**, specifically to
  enable witnessed reweighs (§B.8.a(2)(e)).
- The fallback when tickets are lost is procedural, not silent: prior PPSO approval, a
  **written account of the circumstances and of all efforts to obtain certified
  copies**, a signed inventory, then the published Weight Estimator, then 7 lb/cu ft
  for anything the estimator does not cover (§B.8.a(3), pp. 21-22).

### Delivery attempt, refusal and the delivery obligation itself

- **What delivery includes** is defined as a scope of work, not an event:
  "the one-time laying of rugs and the one-time placement of furniture and like items
  in a room or dwelling designated by the customer"; one-time reassembly of anything
  the TSP disassembled or that came out of NTS; unpacking of containers **on request**
  with contents placed in a designated room, including into cabinets and cupboards -
  "but does not include arranging the articles in a manner desired by the customer";
  debris removal on the day of delivery, with a **return trip** for debris if ordered
  (§C.16, pp. 45-46).
- **Refusal to accept property for shipment** is enumerated: items whose inherent
  nature is liable to contaminate or damage other property, items that cannot be taken
  from the premises without damage to the item or the premises, improperly drained
  waterbeds, items not prepared as the customer was told to prepare them, oversize
  lithium cells and batteries (§C.4.b, §C.4.e-k, pp. 36-37).
- **Turn-back** has a 14-day rule: if the TSP turns a shipment back within 14 calendar
  days of the pickup date and the PPSO cannot rebook the original dates, the TSP owes
  miscellaneous expenses; and if the failure pushes the customer into an Actual Cost
  Reimbursement PPM, the TSP may owe the Government the excess over its own rates
  (§B.11.k, p. 26).
- **Attempted pickup and attempted delivery are priced events** on the NTS side:
  attempted pickup pays drayage on a 500-lb minimum; attempted delivery requires the
  crew to **wait one hour** before returning the shipment to the warehouse, and pays
  drayage plus handling-out on actual weight (NTS §5.9, pp. 50-51).
- **Exoneration list for inconvenience claims** (§B.11.i, p. 26): natural disasters,
  acts of the public enemy, acts of the Government, acts of public authority, violent
  strikes, mob interference, Government-caused delays of Code J or T shipments where
  the TSP's negligence did not contribute; the customer being unavailable on the TSP's
  FADD provided the FADD precedes the RDD; a shipment consisting entirely of alcohol;
  SIT other than the two-attempt failure; a shipment turned back for **mold or
  infestation discovered at pickup**; and a 15-day tail after payment for essential
  items in catastrophic-loss or mold-remediation cases.

## Time, identity, evidence

**Time.** Three calendars run at once and the document is careful about which:
**GBD** for most duties; **calendar days** for customer-facing notice periods (the
7-day real-property window, the 3-day written pickup confirmation, the 15-day repair
inspection, the 10-day appeal); and **clock hours** where a human is waiting (the
24-hour delivery notice, the 24-hour response window, the six hours between contact
attempts, the one-hour wait at an attempted delivery, the 0800-1700 service window with
its AM/PM half-day commitment, and "must not begin any service that will not allow
completion by 2100 hours without prior approval of the customer", §C.1.i p. 33).
Deadlines are frequently expressed as **whichever-comes-first / whichever-is-later
compounds** rather than as single intervals - "within 4 GBD of pickup or prior to
arrival, whichever is earlier"; "5 GBD from accepting but NLT 9 days prior to first
pack/pickup, whichever is later"; "within 15 calendar days of acceptance or NLT 7
calendar days prior to pickup, whichever is sooner". A deadline model that cannot
express a compound of two anchors cannot represent this domain.

**Identity.** The ToS adds several cross-reference obligations the DTR does not:

- The **hauling carrier's legal name and US DOT number** recorded against the shipment
  within 2 GBD of departure (§B.3.f) - the only place in the corpus where *the party
  that actually moved the freight* is recorded as distinct from the party on the
  contract.
- **Seal (control) numbers entered on the inventory, cross-referencing the container
  number** (§C.11.i(2)), and **new seal numbers recorded in DPS whenever a seal is
  replaced**, with the circumstances (§C.11.i(5)-(6)).
- **Container stencil/label content** as a fixed five-field record: origin and
  destination PPSO names, BL number, **RDD as a Julian date**, TSP SCAC, and customer
  last name, first name - with "old markings must be permanently removed" (§C.11.h,
  p. 43).
- **CAGE code, facility CAGE code, SCAC and the BL numbers implicated** as the identity
  set for a cyber incident report (§A.2.f p. 16) - identity used for blast-radius
  reporting.
- NTS: **lot number supplied by the warehouseman**, DD 1164 service order number,
  warehouse receipt, pallet/box numbers and warehouse locations in a **locator system**
  with a master locator sheet, and identity tags on segregated items bearing customer
  name + lot number + item number (NTS §1.7.4, pp. 39-40).
- The inventory itself must carry nine enumerated identity fields including warehouse
  location, lot number, service order, **page N of M** and **total number of items**
  (NTS §1.6.7 p. 33).

**Evidence and provenance - the strongest sub-theme in the document.**

- **Condition is recorded by omission.** "The omission of these symbols will indicate
  good condition except for normal wear" (HHG §C.9.a(14)). The NTS ToS turns this into
  an explicit **burden-of-proof rule**: "In the absence of condition codes or other
  notes on the inventory, items are assumed to be in good working condition and
  **failure of electronic items will be assumed to be transit related**", the TSP is
  responsible for verifying appliance working condition with the customer at the
  pre-move survey, and the escape code "Mechanical Condition Unknown" is "only
  permitted in documented instances where the customer is unable or unwilling to
  demonstrate the working condition of an item" - and using it still does not bar a
  claim (NTS §1.6.2, pp. 32-33). **Silence on a record is a positive assertion with a
  default value and an assigned burden.** That is a first-class provenance idea.
- **Waiver by vagueness.** If the TSP describes carton contents as "misc." it "agrees
  not to contest a claim for missing items related to the nature of such cartons"
  (HHG §C.9.a(22), p. 41). Description quality is tied directly to evidentiary standing.
- **The exception sheet with attributed dissent.** When a lot leaves NTS for a line-haul
  carrier, the warehouseman and the driver check every item out against the inventory.
  Any shortage, overage or condition difference goes on an **exception sheet
  cross-referenced to the original inventory**; if there is nothing, they still write
  "no differences noted", sign and date it. And: *"In the event the opinion of the TSP's
  driver and the NTS TSP's representative differ as to shortage/overage or condition,
  **both opinions will be listed on the exception sheet and separately identified as to
  source**"* (NTS §1.6.10, p. 34). A custody-transfer record that captures disagreement
  and attributes each version to its author, rather than forcing a single truth.
- **E-inventory integrity requirements** (HHG §C.9.a(4)-(11), pp. 39-40): the customer
  must be able to review every comment, condition and exception and annotate exceptions
  **per line item** before signing; the TSP must obtain the customer's electronic
  signature **separately on each individual page**; the inventory **must not be editable
  once signed**; the customer must receive their copy **before the property leaves the
  residence**; and a handwritten fallback must exist for equipment failure. This is a
  more rigorous e-signature spec than most commercial systems implement.
- **Notification proof.** "e-mail preferred with **Delivery and Read Receipt as proof of
  notification**" (NTS §5.11.1) - notification as a fact requiring its own evidence.
- **Jointly-signed records** at both ends: the DP3 Notification of Loss or Damage AT
  DELIVERY is "jointly signed by my representative and the customer or their authorized
  agent" (§C.17.a), and the real-property walk-around is a joint inspection performed
  **twice**, on arrival and before departure (§B.10.e).
- **A negative is explicitly not evidence**: "a signed bingo card or check-off sheet
  does not indicate proof of delivery and lost, missing or damaged items will still be
  indicated on the appropriate loss or damage forms" (§C.9.a(24)).
- **Claim timeline with distinct windows** (NTS §5.11.3, p. 52): the AT DELIVERY notice
  is signed at delivery; the AFTER DELIVERY notice is due **within 180 days**; a written
  claim must be filed **within 12 months** to keep full replacement value. And a
  reversal: "The NTS TSP's failure to provide [the two forms] and to have proof thereof
  **will eliminate any requirement for notification to the NTS TSP**" - fail to give the
  customer the means to notify you and you lose the right to be notified. The same
  pattern appears on the HHG side for real-property damage (§B.10.e).

**Versioning.** The ToS is a genuinely versioned artifact and documents its own change
history: an eight-row cumulative **List of Changes** table (pp. 5-9) giving version,
per-paragraph description, revision date and affected page numbers. Effectivity is
keyed to the **pickup date**, not to the award date or the signature date - "binding
for shipments with a **pickup date of 15 May 2026 or later**" (§A.1.b(1)) - and DTR
Appendix A-B maintains a URL per effectivity window so an old shipment can always be
adjudicated against the edition that governed it. Mid-year changes are "effective upon
receipt of notification unless specifically stated otherwise" (§A.1.b(4)).

## Scores

Grade **A** for the HHG ToS (read cover to cover); the NTS ToS contributions are
grade **B** and are flagged in the notes. No C2/C3 cap applies. Scored against what
these two tenders contain; rating and routing are credited to the 400NG/IT and the DTR.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 2 | 2 | 2 | **3** | 3 | 2 | 2 | **2** | Only the carrier-facing half: acceptance, short fuse, agreed pickup date confirmation, turn-back (with a 14-day rule and downstream PPM liability), missed pickup, missed RDD, and the SIT/delivery endgame. Award, routing, cancellation and pull-back live in the DTR. **C8=2** for real versioning: effectivity keyed to pickup date, a published edition per window, and a cumulative change log with per-paragraph diffs (pp. 5-9). |
| A2 Shipment structure | 2 | 2 | 1 | **3** | n/a | 2 | 2 | 1 | Loose load vs containerized vs UB as operationally distinct shipment shapes with **different arrival procedures**; overflow/split with "the established RDD applies to all parts" and a separate inventory; CW annotation for partial containerization; door-to-door container service; the NTS **lot**; sub-quantities (M-PRO/S-PRO, consumables, gun safe) each separately weighed and annotated. Still no part-whole composition model. |
| A3 Trip, stop & assignment | 1 | 1 | 1 | 2 | 1 | 2 | **2** | 0 | Thin but not empty, and better than the DTR here. **The hauling provider's legal name and US DOT number recorded against the shipment within 2 GBD of origin departure** (§B.3.f) is a genuine assignment fact. The origin servicing agent must be named and must be the *actual* servicing rep. The **TSP for Carriage** collecting from an NTS warehouse is a modelled custody handoff. Still: no vehicle, no route, no stop sequence, no consolidation. |
| A4 Execution events & tracking | **3** | **3** | **3** | **3** | **3** | 2 | **3** | 1 | **The headline. The best A4 source in the corpus and the only one that is HHG-native.** C1=3: pre-move survey, initial contact, pack, pickup, departure from origin, arrival/departure at any in-transit or storage facility or POE/POD, ETA change, arrival at destination, delivery notification, attempted contact, FADD offered, placed in SIT, handling-in, requested delivery, scheduled delivery, actual delivery, unpack, debris removal, tracer initiated. C2=3: *offered for delivery* vs *arrived* vs *delivered* are distinguished and the distinction carries money. C3=3 and C7=3 via the 43-row obligation catalogue above - every event has an actor, a clock, a record and a consequence, and §C.3.h makes the *notification itself* a precondition of payment. C5=3 for the compound whichever-first/later deadlines, three coexisting calendars, and the AM/PM half-day commitment. C6=2: still no event id, sequence or dedup. |
| A5 Storage-in-transit | **3** | 2 | **3** | **3** | **3** | 2 | 2 | 1 | The mover's side of SIT, which complements the DTR's Government side and the 400NG's charging side: entry preconditions (24-h notice, two attempts six hours apart, telephonic second attempt), the no-weekend-start rule, handling-in by COB+3 GBD, no de-containerisation in SIT, lot identification in plain view, the **delivery-out window (7 GBD from first contact, or 2 GBD from a later requested date, whichever is later)**, and the FADD as the anchor of delay liability. NTS side adds storage period, lot, warehouse receipt, locator system, handling-out with 5 GBD notice and payment termination. C2=2: SIT is used, not defined, here. |
| A6 Documents & evidence | **3** | **3** | 2 | **3** | 2 | **3** | **3** | 1 | Second-strongest area. Inventory as the central evidentiary artifact with condition-by-omission, exception and location symbols, per-page e-signature, post-signature immutability, customer copy before departure, "misc." as a waiver of contest, and the same inventory used to verify delivery at destination. Plus: tamper-evident seals cross-referenced to containers and re-recorded on breakage; the jointly-signed AT DELIVERY notice; the AFTER DELIVERY notice at 180 days; the exception sheet with attributed dissent; DD 619 for accessorials with customer signature; delivery/read receipts as proof of notification; document packages enumerated by recipient and by moment (§C.12, §C.13). C5=2 and C3=2: documents are dated but their state machine is implicit. |
| A7 Charges & billing hooks | 2 | 2 | 2 | 2 | 2 | 1 | **3** | 0 | Charge *events* rather than rating: pre-approval of every accessorial in DPS before performance (§B.12.c, §D.2.g); DD 619 as the billing evidence, customer-signed; supplemental invoices for reweigh refunds; PPSO denial of SIT and delivery-out charges as a notification penalty (§C.3.h); NTS half-month storage arithmetic keyed to the 15th/16th and to partial-removal weights (§5.7.2); minimum 500 lb net; set-off against the party whose failure caused the cost, documented on an amended DD 1164 (NTS §5.8.2). C7=3 for that attribution-and-set-off pattern. |
| A8 Parties & roles | 2 | **3** | 1 | **3** | n/a | 2 | 2 | 0 | C2=3 and C4=3: TSP, MMC (domestic only, cannot be the servicing agent), Trusted Agent, Claims Manager, origin servicing agent, alternate TSP, subcontractor, foreign service provider, NTS TSP/warehouseman, **TSP for Carriage**, port agent, overseas general agent, PPSO/PPPO/TO/SPM/Storage Branch, QA inspector, Military Claims Office, customer, customer's representative, releasing/receiving agent, dependents, the **Safety Move** victim "who may not be the customer". Double brokering defined and banned - the agency boundary is stated as a rule rather than assumed. C3=1: roles have duties, not lifecycles. |
| A9 Identity & cross-references | 2 | 2 | n/a | 2 | n/a | **3** | 2 | 1 | BL number, SCAC, CAGE and facility CAGE, **US DOT number of the actual hauler**, SIT control number, lot number, DD 1164 service order number, warehouse receipt, seal control numbers keyed to container numbers, inventory item numbers and page N of M, pallet/box locator numbers, container stencil fields including **RDD as a Julian date**. |
| A10 Survey, estimating & inventory | **3** | **3** | 2 | **3** | 2 | 2 | **3** | 1 | Much stronger than expected and a real find. Survey modality (in-residence / virtual with recorded consent / telephonic); a tiered deadline ladder keyed to lead time; and a hard accuracy standard - **"Weight estimates must be accurate within 10% of actual shipment net weight. Failure ... may result in administrative action"** (§C.2.b, p. 34). An estimate with a stated tolerance and a penalty is a different object from an estimate. Inventory: item specificity rules (make, model, colour, serial where externally visible), carton description by type/cube/general contents with "household goods" banned as a description, condition symbols, disassembly annotation, per-firearm line items, PBP&E segregation, gun-safe make/model/weight, high-value addendum. C7=3 for the burden-of-proof rule. |
| A11 Claims & valuation *(context)* | 2 | 2 | 2 | **3** | 2 | 1 | 2 | 0 | The **inconvenience claim** is fully specified here and is a genuinely distinct claim type - a delay remedy, paid by the carrier directly to the customer, computed as full M&IE per diem for the customer plus 75% per dependent per day at the affected location, over a window bounded by named events (day after the agreed date or missed RDD -> actual delivery date inclusive; or date placed in SIT -> FADD out of SIT), with an enumerated exoneration list, a miscellaneous-expense category (furniture/appliance rental, EFMP medical equipment, above-BAH lease extension costs) and an explicit exclusion list (groceries, alcohol, normally lodging and individual meals). Loss/damage itself defers to the unread Claims and Liability Business Rules; real-property damage is a third, separate channel. |
| A12 Rating & tariffs *(context)* | 1 | 1 | n/a | 2 | 1 | 1 | 1 | 1 | Deliberately a pointer: "this ToS, in addition to the International Tender and the 400NG, is binding" (§A.1.b(1)). Contributes only the NTS Schedule of Services and Rates structure (Items I Packing, III Drayage, IV Handling-In, V Storage, VI Handling-Out) and the boat/trailer weight additives (NTS §1.4.14.2). |
| A13 Crew, driver & settlement *(context)* | 1 | 1 | 0 | 2 | 1 | 1 | 1 | 0 | Crew *requirements* without a crew *model*: background checks on everyone who interacts with a customer, the Government's right to bar an individual, installation access rules, at least one English-speaking representative always present during packing/loading/delivery, no smoking within 50 feet, immediate replacement of anyone impaired or armed, and a single named customer POC maintained "throughout the entire shipment process and until all associated actions are final" (§C.1.e). No scheduling, no assignment, no compensation. |

*(Per the 2026-09-17 scope decision, S5 "fit to Pegasus data" is withdrawn and is not
recorded.)*

## Strengths worth adopting

1. **The obligation-with-a-clock as the unit of the execution model.** Not "event
   happened at time T" but *trigger -> responsible party -> deadline -> system of
   record -> consequence*. Forty-three instances above. If A4 is modelled as a bare
   event stream, everything that makes this domain interesting is discarded.
2. **A notification is itself a fact with its own evidence and its own consequences.**
   Two documented attempts six hours apart; the second must be telephonic; the failure
   to make them costs the carrier the storage and delivery-out charges (§C.3.h) and
   makes it liable for an inconvenience claim (§B.11.f). Model *attempts*, not just
   contacts.
3. **Condition-by-omission with an assigned burden.** The absence of an exception
   symbol is an affirmative assertion of good condition, and failure is then presumed
   transit-related (NTS §1.6.2). Generalise: any record where silence has a defined
   default must say what the default is and who carries the burden of rebutting it.
4. **The exception sheet that records dissent and attributes it.** Two parties inspect,
   disagree, and **both opinions are recorded and separately identified as to source**
   (NTS §1.6.10). Most data models force a single truth at custody transfer; this one
   does not, and it is right not to.
5. **FADD - First Available Delivery Date.** A distinct, named date that is neither
   promised nor requested nor actual, but *the earliest the carrier could do it*. It is
   what liability windows are measured against. Our date vocabulary needs it.
6. **The estimate with a tolerance.** 10% of actual net weight, enforced with
   administrative action (§C.2.b). An estimate should carry its accuracy commitment,
   not just its value.
7. **A reweigh is a right held by two parties, is witnessable, and can only move the
   price one way.** Including a *supplemental invoice* mechanism to refund after the
   fact (§B.8.a(2)(c)-(d)).
8. **Description quality has legal consequences.** Vague carton descriptions waive the
   right to contest related claims (§C.9.a(22)). Data quality modelled as a
   liability, not as a lint warning.
9. **Failure to enable notification destroys the right to be notified.** Twice, in two
   different documents (HHG §B.10.e; NTS §5.11.3.3). A clean, symmetrical rule for
   notice-period modelling.
10. **Attribution-and-set-off recorded on the ordering document.** When a line-haul
    carrier fails to collect a lot, the DD 1164 is amended to name that failure as
    the cause of the extra cost, and the money is set off against that carrier's BL
    (NTS §5.8.2). Cause, cost and counterparty in one record.
11. **E-signature requirements that actually bind**: per-page signature, immutability
    after signing, customer copy before the goods leave, mandatory offline fallback.
12. **Effectivity keyed to the pickup date**, with a published edition per window and a
    per-paragraph change log. Any versioned rulebook should copy this: the governing
    version is chosen by a *business event*, not by the date the record was created.

## Weaknesses / traps

- **This is one party's obligations, not a domain model.** Everything is phrased from
  the TSP's side; the customer and the PPSO appear only as counterparties. Reading it
  as a complete lifecycle would give a model with no booking, no routing, no award and
  no cancellation - those are in the DTR.
- **DPS field names leak into the obligations.** "the 'General Remarks' block in DPS",
  "DPS Shipment Management Remarks", "the short fuse queue". Keep the duty, discard the
  field name.
- **Some duties are satisfied by writing prose into a remarks field.** The
  subcontractor-visibility rule (§B.3.f) and the delay rule (§C.3.i, "cause for delay
  and new ETA") are both *free-text into a remarks box*. The domain has the concepts
  but not the codes. Do not infer a reason-code taxonomy that is not there.
- **No exception or delay code list exists in this document.** Unusual occurrences are
  given by example ("strikes, port congestion, fires, pilferage, vandalism, and similar
  incidents") and the form is an unreadable image. The taxonomy, if it exists, is in
  DTR Chapter A-410, which we do not hold.
- **The inconvenience-claim formula is entitlement-shaped.** M&IE per diem, dependents
  on funded relocation orders, BAH, EFMP. The *structure* (a delay remedy over a
  window bounded by named events, with an exoneration list) generalises; the
  *arithmetic* does not.
- **Peak season is a real operational mode** (15 May - 31 Oct: Saturday coverage,
  twice-monthly reporting, different Code 2 weight thresholds) but is never modelled as
  a first-class concept - it appears as literal date ranges scattered through the text.
- **The HHG ToS and the NTS ToS are different contracts under one registry id.**
  Different counterparty, different ordering document, different unit, different
  claims timeline, different IC trigger. Merging their vocabularies would produce a
  storage model that is wrong for both.
- **The symbol legend - the actual exception and location codes - is an image we could
  not read.** Every claim here about condition coding rests on the prose *about* the
  symbols, not on the symbols themselves.
- **Change 2's substantive edits are thin.** The 2026 Change 2 diff is almost entirely
  the USTRANSCOM -> DoW PPA rename plus a CMMC UID requirement and two e-mail address
  updates (List of Changes p. 9). Do not treat "2026 Change 2" as materially different
  from "2026 Change 1" for domain purposes.

## Out-of-v1 material

- **A11**: the complete inconvenience-claim computation, the dispute/appeal ladder
  (TSP -> PPSO -> DoW PPA, 10 days each way, final), the exoneration list, the
  miscellaneous-expense category and its exclusions, and the "good cause"
  non-availability statement (§B.11, pp. 23-27).
- **A11**: the NTS claim timeline - AT DELIVERY at delivery, AFTER DELIVERY within
  180 days, written claim within 12 months for FRV (NTS §5.11.3).
- **A11/A5**: the mold procedure end to end - detection at the container, dual-channel
  notification with read receipts, QA inspection within 2 GBD, notification fan-out to
  customer + Military Claims Office + inspecting PPSO + destination PPSO, possession-at-
  discovery determining who mitigates, no additional storage or handling fees, and IC
  liability running during remediation (NTS §5.11.1).
- **A13**: crew and personnel requirements (background checks, installation access,
  English-speaking representative, impairment and firearm rules, appearance).
- **A5 facility**: the NTS warehouse standards - two-inch floor clearance after
  handling-in, 10-foot stack height, no basements, multiple-occupancy prohibition with
  firewall ratings, quarterly sprinkler and monthly fire-detection inspection, monthly
  pest control with records, two keyed locks per access door, no railroad tracks within
  75 feet (NTS §1.7.3, §1.7.5).
- **A12**: NTS weight additives for boats, canoes and sailboats by linear foot
  (§1.4.14.2), and the four-successive-fiscal-year renegotiation schedule (§5.6.4).

## Open questions

1. **Is there a delay / exception reason-code list anywhere in DP3?** The ToS records
   "cause for delay" as free text. DTR Chapter A-410 and the Unusual Occurrence
   Notification Form are the candidates and neither is readable to us. This is the
   single biggest remaining A4 gap and it should be chased before A4 is finalised.
2. **The exception and location symbol legend** (NTS Attachment F / the HHG Descriptive
   Inventory) is the HHG condition-coding vocabulary. It is an image in both documents.
   A text or form-fillable source for it would materially improve A6/A10.
3. **Free waiting time vs the 24-hour notice.** DTR A-406 §A.8.a gives 2 hours domestic
   / 1 hour international of free waiting before SIT may be requested; the ToS gives a
   24-hour notice plus two attempts six hours apart. Are these sequential stages of one
   decision, or alternative rules for different shipment shapes (loose load vs
   containerised vs direct-delivery-address-on-BL)? The two documents do not
   cross-reference each other here.
4. **What percentage of transit time must elapse** before a TSP may request SIT on a
   shipment with a direct delivery address? Both documents defer to "the solicitation"
   (i.e. the 400NG / International Tender).
5. **Does the domestic program have a UB analogue?** DTR A-402 §G says flatly "There
   are no UB moves under the domestic program", yet the ToS treats UB throughout. The
   boundary is a codes-of-service question worth settling before A2 is finalised.
6. **The DP3 Claims and Liability Business Rules** (registry id `dp3-claims-liability`,
   status not yet captured) is referenced a dozen times by both tenders and owns the
   loss/damage lifecycle, FRV, salvage and the mitigation-cost rules. It is the obvious
   next capture for A11.
