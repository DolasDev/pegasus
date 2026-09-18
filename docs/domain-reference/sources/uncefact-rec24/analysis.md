---
source: src:uncefact-rec24
analyzed: 2026-09-17
evidence_grade: A
material: |
  All paths below are relative to docs/domain-reference/.
  Read in full:
  - sources/uncefact-rec24/local/rec24-rev1-2000-ECE_TRADE_258.pdf (40 pp; body text
    pp.2-5 read in full, Annexes 2/3 skimmed) - Recommendation No. 24, 2nd edition,
    ECE/TRADE/258, Geneva May 2000.
  - sources/uncefact-rec24/local/rec24-rev3-2004-CEFACT_ICG_2004_IC006.pdf (31 pp, read
    in full via text extraction) - 3rd revision of the CODE LIST, CEFACT/ICG/2004/IC006,
    1 July 2004. Annex 2 = code-value order (pp.2-16), Annex 3 = code-name order (pp.17-31).
  - sources/uncefact-rec24/local/rec24-rev5-2009-ECE_TRADE_C_CEFACT_2009_26E.pdf (3 pp,
    read in full) - ECE/TRADE/C/CEFACT/2009/26, 9 Sep 2009, the Plenary APPROVAL document
    for the 5th revision. Cover text only; the code list itself is a separate attachment.
  - sources/uncefact-rec24/local/rec24-jsonld-vocabulary-service.unece.org.html - the
    JSON-LD rendering of the Rec 24 code list published at
    https://service.unece.org/trade/uncefact/vocabulary/rec24/ (345 terms, each with
    rdf:value = the numeric code and rdfs:comment = the official definition). Parsed in
    full into sources/uncefact-rec24/local/rec24-codes-extracted.tsv.
  Cross-read (already captured under src:uncefact-mmt-rdm, cited only to show how the list
  is bound in a data model):
  - .../MMT-RDM_D19A/XSD/schema/uncefact/MMTMaster_1p0_urn_un_unece_uncefact_codelist_standard_UNECE_TransportStatusCode_4.xsd
  Derived artefact written by this analysis:
  - sources/uncefact-rec24/local/rec24-codes-extracted.tsv (code<TAB>name<TAB>definition, 345 rows)
  - sources/uncefact-rec24/local/rec24-rev3-2004.txt (text extraction of the Rev 3 PDF)
  Not read - see "What we could not see".
---

# UNECE Recommendation No. 24 - Trade and Transport Status Codes - analysis

## What it is

Rec 24 is the United Nations' **status-code list for the movement of goods**: a single flat
vocabulary of numeric codes, each with a short name and a one-sentence definition, for saying
what has happened to a consignment, the goods in it, a piece of equipment, or a means of
transport. It is the vocabulary that UN/EDIFACT `IFTSTA` and the UN/CEFACT reference data
models point at when they need a status value. It is maintained not by the UN/CEFACT Plenary
but by a code-maintenance body - the Codes Working Group, later the Information Content
Management Group (ICG) - on delegated authority, with Plenary approval only when the body
text changes (rev1 p.5 paras 13-18; rev5 cover p.1).

- **S1 Kind** - `glossary` / reference code list. It is not a model: no entities, no
  relationships, no message structure. It is exactly one enumeration.
- **S2 Adoption / maturity** - 3. In continuous maintenance since 1995 (WP.4/R.1067) through
  five revisions: rev1 = ECE/TRADE/258 (2000), rev2 = TRADE/CEFACT/2001/22, rev3 =
  CEFACT/ICG/2004/IC006, rev4 = CEFACT/ICG/2007/IC002, rev5 = ECE/TRADE/C/CEFACT/2009/26
  (rev5 cover p.1 footnote 2). It is bound as a namespaced code list in the UN/CEFACT XSD
  stack (`urn:un:unece:uncefact:codelist:standard:UNECE:TransportStatusCode:4`, whose schema
  prefix is literally `clm6Recommendation24`) and is the status vocabulary the Multimodal
  Transport RDM uses for *both* `LogisticsStatus.ConditionCode` and
  `LogisticsStatus.ReasonCode`.
- **S3 Openness** - `public`. UN documents, free. (In practice unece.org is behind a
  Cloudflare interactive challenge that blocks non-browser clients; every PDF here was
  retrieved through the Internet Archive - see "What we could not see".)
- **S4 Evidence grade** - **A** for codes 1-363 (read in the official Rev 3 PDF, Annex 2,
  every code and definition); **B** for codes 364-379, which exist in the machine-readable
  vocabulary and (for 364-370) in the Rev 5 XSD binding but whose official PDF - the Rev 4 /
  Rev 5 code-list attachment - I could not retrieve.

### Correcting the premise of this task

The task brief says the captured UN/CEFACT package holds "a 336-value StatusCode enumeration
with NO NAMES". That conflates two different lists, and round 1's own MMT analysis had it
right:

| List | Namespace | Size | Is it Rec 24? |
| --- | --- | --- | --- |
| `TransportStatusCode:4` | `...codelist:standard:UNECE:TransportStatusCode:4`, prefix `clm6Recommendation24` | **336** distinct values, 1-370 | **Yes.** This *is* Rec 24. |
| `StatusCode:D18B` / `:D21B` | `...codelist:standard:UNECE:StatusCode:D18B`, prefix `clm64405` | 491 enumeration lines / **419** distinct values (the D18B file lists every value twice) | No. This is UN/EDIFACT data element **4405**, bound to `TransportMovement.StatusCode` / `TransportRoute.StatusCode` / `TradeTax.StatusCode`. |

So the "336" that anchored round 1's highest A4 coverage score was Rec 24 all along - it was
simply captured as bare integers. **That list now has names and definitions.** The second,
larger list (DE 4405) is still nameless and is *not* what this analysis covers.

### What we could not see

- **The official Rev 4 (CEFACT/ICG/2007/IC002) and Rev 5 code-list attachments.** The Rev 5
  document retrieved (ECE/TRADE/C/CEFACT/2009/26) is the three-page Plenary approval paper;
  it says the code list "can be downloaded from the UN/CEFACT website" and does not contain
  it. Codes 364-379 are therefore attested only by the JSON-LD vocabulary and (for 364-370)
  by the Rev 5 XSD binding, not by a UN PDF I have read.
- **unece.org and service.unece.org are unreachable from this machine.** Every direct request
  - curl, wget, and the WebFetch tool, with and without full browser headers - returns HTTP
  403 with a Cloudflare "Just a moment..." interstitial. All four artefacts here were fetched
  through `https://web.archive.org/web/2024id_/<original-url>`. The URLs recorded below are
  the canonical originals; the bytes came from the Archive.
- **The Rev 2 (TRADE/CEFACT/2001/22) edition** - not retrieved; the rev1 -> rev3 delta is
  therefore not decomposed.
- **French and Russian language versions** - not retrieved, not needed.
- **Whether the edi3-maintained JSON-LD vocabulary is normatively endorsed by UN/CEFACT.** It
  is hosted under `service.unece.org/trade/uncefact/vocabulary/` but the page banner reads
  "Draft version" and the site brands itself "edi3 Standards by edi3". Its codes 1-363 match
  the official Rev 3 PDF exactly on spot checks (codes 1, 2, 3, 4, 5, 21, 91, 111, 209, 267);
  treat it as a faithful rendering, not as the normative text.

## Model summary

There is no model. Rec 24 defines **two concepts and one list**:

> **transport status**: snapshot of the position and/or condition of consignments, goods
> and/or equipment at any point in time or place within the full transport or logistical
> chain. (rev1 p.3, sec. V.A)

> **status reason**: explanation or justification of the status of consignments, goods and/or
> equipment. (rev1 p.3, sec. V.A)

and then - crucially - declines to split the list along that line:

> 8. Users of the trade and transport status codes **may choose codes to fulfil the business
> requirements to suit Transport status or Status reason as they wish.** (rev1 p.3, sec. V.B
> para 8)

One vocabulary, two jobs, user's discretion. That sentence is the source of both the list's
reach and its biggest defect (see "Weaknesses / traps"), and it is visible downstream: the
UN/CEFACT Multimodal Transport RDM binds *the same* Rec 24 list to
`LogisticsStatus.ConditionCode` **and** `LogisticsStatus.ReasonCode`, so a conforming message
can carry `{condition: 21 Delivery_completed, reason: 266 Delivery_delayed_adverse_weather}`
with nothing in the standard saying which slot a given code belongs in.

**Subject scope is deliberately vague.** Almost every definition begins "The
goods/consignment/equipment/means of transport has..." - a four-way disjunction the code
itself never resolves. The code tells you *what happened*; the message envelope must tell you
*to what*.

**Presentation and columns** (rev1 p.5, sec. VII paras 19-20):

- Annex 2 - codes in code-value order; Annex 3 - the same codes in code-name order.
- Columns: **Change indicator (CI)**, **Code value** ("3 alphanumeric"; in practice 1-3
  digits), **Code name**, **Code description**.

## Vocabulary

The full extracted list is at `sources/uncefact-rec24/local/rec24-codes-extracted.tsv`
(345 rows: code, name, definition). Below is the shape of the vocabulary and the entries that
matter for our areas. Names are given in the JSON-LD spelling (`Word_word`); the PDF spells
them `Word, word` (e.g. `Arrival, completed`).

### Size and growth

| Edition | Codes | Highest value | Source read |
| --- | --- | --- | --- |
| Rev 3 (2004) | 329 | 363 | rec24-rev3 PDF, Annex 2 pp.2-16 |
| Rev 5 (2009) as bound in XSD | 336 | 370 | `...TransportStatusCode_4.xsd` |
| JSON-LD vocabulary (current) | 345 | 379 | rec24 JSON-LD rendering |

Growth is purely additive at the tail (rev3 codes are a strict subset of the XSD's, which are
a strict subset of the vocabulary's). **34 code slots inside the range are empty** - 42, 43,
52, 55, 56, 122, 160, 173, 217, 221, 223, 226, 230, 237, 244-246, 249, 252, 257, 259,
261-264, 268, 289, 290, 293, 294, 296, 303-305 - i.e. retired codes are withdrawn and **never
reissued**. That is a real versioning discipline, not an accident (see C8).

### The families that carry the vocabulary

| Family | Count | Examples |
| --- | --- | --- |
| `Delivery_*` | 52 | 21 `Delivery_completed`, 23 `Delivery_not_completed`, 113 `Delivery_in_progress`, 209 `Delivery_scheduled`, 361 `Delivery_expected`, 210 `Delivery_unsuccessful_attempt` |
| - of which `Delivery_refused_*` | 22 | 275 `...purchase_order_cancelled`, 282 `...consignee's_condition`, 291 `...collect_freight_charges_not_paid`, 297 `...commercial_dispute` |
| `Waiting_*` | 27 | 189 `Waiting_for_a_location`, 191 `Waiting_for_workers`, 192 `Waiting_for_storage_area`, 236 `Waiting_for_instructions` |
| `Equipment_*` | 15 | 33 `Equipment_sent_for_repair`, 60 `Equipment_on_hire`, 372 `Equipment_loaded`, 375 `Equipment_storage_period_at_terminal_exceeded` |
| `Collection/pick-up_*` | 11 | 13 `...completed`, 53 `...not_completed`, 64 `...awaited`, 338 `...business_closed`, 345 `...adverse_weather_conditions` |
| delay codes | 9 | 20 `Delayed_in_the_course_of_transportation`, 25 `Departure_delayed`, 273 `Delayed_operation`, 314 `Delayed_at_origin` |
| `Cleared_*` | 7 | 12 `Cleared_by_customs`, 360 `Cleared_by_logistics_service_provider` |
| document-related | 10 | 123 `Accompanying_documents_delivered`, 241 `Missing_document`, 343 `Document_incorrect`, 359 `Bill_of_Lading_issued`, 378 `Delivery_Order_Issued` |

### Terms that earn their place in our model

| Term (source spelling) | Definition (verbatim) | Area | Cite |
| --- | --- | --- | --- |
| `transport status` | "snapshot of the position and/or condition of consignments, goods and/or equipment at any point in time or place within the full transport or logistical chain." | A4 | rev1 p.3 sec. V.A |
| `status reason` | "explanation or justification of the status of consignments, goods and/or equipment." | A4 | rev1 p.3 sec. V.A |
| 1 `Arrival_completed` | "The goods/consignment/equipment/means of transport has arrived." | A4 | rev3 p.2 |
| 24 `Departure_completed` | "The means of transport has departed." | A4 | rev3 p.3 |
| 127 `Departed_completed_on_a_means_of_transport` | "The goods/consignment/equipment has departed on a means of transport." | A4 | rev3 p.7 |
| 48 `Loading_completed_onto_a_means_of_transport` | "The goods/consignment/equipment has been loaded onto a means of transport." | A4 | rev3 p.4 |
| 132 `Loading_in_progress` | "The goods/consignment/equipment is being loaded onto a means of transport." | A4 | rev3 p.7 |
| 363 `Loading_ready` | "The goods/consignment/equipment is ready to be loaded onto a means of transport." | A4 | rev3 p.16 (marked `+`) |
| 57 `Not_loaded_onto_a_means_of_transport` | "The goods/consignment/equipment has not been loaded onto a means of transport." | A4 | rev3 p.4 |
| 346 `Unloading_completed_from_a_means_of_transport` | "The goods/consignment/equipment has been unloaded from a means of transport." | A4 | rev3 p.15 |
| 28 `Stripped` | "The goods/consignment/equipment has been unloaded from a piece of equipment in which they were transported." | A4 | rev3 p.3 |
| 93 `Stuffed` | "The goods/consignments have been loaded into a piece of equipment." | A4 | rev3 p.5 |
| 13 `Collection/pick-up_completed` | "The goods/consignment/equipment has been collected/picked-up." | A4 | rev3 p.2 |
| 21 `Delivery_completed` | "The goods/consignment/equipment has been delivered." | A4 | rev3 p.3 |
| 113 `Delivery_in_progress` | "The delivery of the goods/consignment is in progress." | A4 | rev3 p.6 |
| 209 `Delivery_scheduled` | "The delivery has been scheduled." | A4, A5 | rev3 p.11 |
| 361 `Delivery_expected` | "The goods/consignment/equipment expected to be delivered." | A4 | rev3 p.16 (marked `+`) |
| 114 `Delivery_accepted_subject_to_further_inspection` | "Delivery accepted subject to further inspection of the goods/consignment/equipment/means of transport." | A4, A6, A11 | rev3 p.6 |
| 91 `Stored` | "The goods/consignment/equipment has been placed into storage." | A5 | rev3 p.5 |
| 267 `Free_storage_time_expired` | "The goods/consignment/equipment has been in a storage facility for longer than the permitted free time." | A5, A7 | rev3 p.13 |
| 192 `Waiting_for_storage_area` | "Waiting for a storage area." | A5 | rev3 p.10 |
| 375 `Equipment_storage_period_at_terminal_exceeded` | "The equipment storage period at a transport terminal has been exceeded." | A5, A7 | JSON-LD vocab only |
| 328 `Moved_internally` | "The goods/consignment/equipment has been moved internally." | A5 | rev3 p.14 |
| 112 `Held_at_consignee's_disposal` | "The goods/consignment is held at consignee's disposal." | A5 | rev3 p.6 |
| 41 `Handed_over_under_continued_responsibility` | "The goods/consignment/equipment has been handed over under responsibility of the same transport operator." | A8 | rev3 p.4 |
| 349 `Handed_over` | "The goods/consignment/equipment has been handed over to another party." | A8 | rev3 p.15 |
| 98 / 99 `Transferred_in` / `Transferred_out` | "...has been transferred in." / "...out." | A3, A8 | rev3 p.5 |
| 72 / 73 `Receipt_of_goods_fully_/_partially_acknowledged` | "The receipt of goods has been fully/partially acknowledged." | A4, A6 | rev3 p.5 |
| 350 / 256 `Signature_required` / `Signature_not_required` | "A signature is required." / "...is not required." | A6 | rev3 pp.15, 12 |
| 359 `Bill_of_Lading_issued` | "The Bill of Lading for the goods/consignment/equipment has been issued." | A6 | rev3 p.16 (marked `+`) |
| 343 `Document_incorrect` | "The document for the goods/consignments/equipment is incorrect." | A6, A7 | rev3 p.15 |
| 38 `Freight_paid` | "The freight charges have been paid." | A7 | rev3 p.3 |
| 250 `Transport_payment_not_received` | "The transport payment has not been received." | A7 | rev3 p.12 |
| 84 `Service_ordered` | "A service has been ordered." | A1 | rev3 p.5 |
| 6 / 7 `Booking_completed` / `Booking_cancelled` | "The goods/consignment/equipment or means of transport has been booked." / "...has been cancelled." | A1 | rev3 p.2 |
| 321 / 324 `Instruction_to_despatch_received` / `...cancelled` | "The instruction to despatch has been received." / "...cancelled." | A1 | rev3 p.14 |
| 88 `Split_consignment` | "The consignment of goods has been split." | A2 | rev3 p.5 |
| 15 `Consolidated` | "The goods/consignments have been consolidated." | A2, A3 | rev3 p.2 |
| 97 `Damage_surveyed` | "The goods/consignment/equipment has been surveyed to assess the damage." | A10, A11 | rev3 p.5 |
| 19 `Equipment_damage_quoted_for` | "Damaged equipment has been assessed and a repair quotation has been sent." | A11 | rev3 p.3 |
| 311 `Claim_folder_opened` | "A claim folder has been opened." | A11 | rev3 p.14 |
| 61 `Outstanding_claims_settled` | "Outstanding claims in respect of the goods/consignment/equipment have been settled." | A11 | rev3 p.4 |
| 327 `Weight_or_volume_loss` | "The goods have suffered a weight or volume loss." | A11 | rev3 p.14 |
| 362 `Measured` | "The goods/consignment/equipment/means of transport has been measured." | A10 | rev3 p.16 (marked `+`) |
| 125 `No_status` | "No status information is available." | A4 | rev3 p.7 |
| 265 `Reason_unknown` | "The reason is unknown." | A4 | rev3 p.13 |
| 316 `Incident_occurred_but_accepted_by_ordering_party` | "An incident has occurred but has been accepted by the ordering party." | A4 | rev3 p.14 |
| 320 / 351 `Undefined_/Defined_incident_attributed_to_logistic_server_provider` | "An undefined/defined incident has occurred which has been attributed to the logistic service provider." | A4 | rev3 pp.14, 15 |
| 332 / 333 `Action_by_logistics_service_provider` / `...on_instruction_by_owner` | "An action was taken by the logistics service provider." / "...as instructed by owner of the goods." | A4, A8 | rev3 p.14 |

## Lifecycles & events

**There is no lifecycle.** No states, no transitions, no preconditions, no actor permissions,
no ordering. The recommendation says so by omission: rev1's entire normative body is scope,
field of application, definitions, maintenance and presentation. The list is flat.

What it does have, and what is genuinely interesting, is **aspect baked into the code value
rather than expressed as a separate classifier**. For delivery the list carries, as five
distinct codes:

| Aspect | Code |
| --- | --- |
| planned | 209 `Delivery_scheduled` |
| expected | 361 `Delivery_expected` |
| in progress | 113 `Delivery_in_progress` |
| actual, succeeded | 21 `Delivery_completed` |
| actual, failed | 23 `Delivery_not_completed` / 210 `Delivery_unsuccessful_attempt` |

and for loading: 363 `Loading_ready` -> 2 `Loading_authorized` -> 132 `Loading_in_progress` ->
48 `Loading_completed_onto_a_means_of_transport`, with 57
`Not_loaded_onto_a_means_of_transport` as the negative. This is the **opposite** design
decision from DCSA (one event code plus an `eventClassifierCode` of PLN/EST/ACT), and it is
why the list is 345 entries long: the cross-product of *thing that happened* x *aspect* x
*failure mode* is enumerated instead of factored. The families are not complete or symmetric
- `Collection/pick-up` has `awaited` and `not_completed` but no `scheduled`; `Arrival` has no
`expected`. **Take the distinctions, not the factoring.**

**Reason codes and status codes are the same list** (rev1 p.3 para 8, quoted above). The list
does contain a large, usable reason vocabulary - 27 `Waiting_*` codes, 22 `Delivery_refused_*`
codes, 9 delay codes, plus weather / industrial-dispute / business-closed causes - but nothing
marks a code as a reason rather than a status. The `Waiting_*` family is the clearest
reason-only cluster and the closest thing in the list to a cause taxonomy: waiting for a
**location** (189), **cargo** (190), **workers** (191), **storage area** (192), **equipment**
(193), **other means of transport** (194), **handling equipment** (195), **instructions**
(236), **operational periods** (200), **daylight** (181), **meteorological circumstances**
(182), **action by authorities** (184), **entry permission** (186), **repair or maintenance**
(201, 202).

**Failure has first-class vocabulary.** This is the list's strongest suit relative to every
event standard read so far: it enumerates *not happening* as carefully as it enumerates
happening. 23 `Delivery_not_completed`, 210 `Delivery_unsuccessful_attempt`,
211/352/353/354 `Delivery_not_completed_business_closed[_inventory_count|_on_Saturday|_on_national_holiday]`,
269 `Delivery_consignee_absent`, 317 `Delivery_party'_premises_closed_during_normal_hours`,
213 `Delivery_further_address_needed`, 234/274 `Incorrect_address` / `Incomplete_address`, 243
`No_recipient_contact_information`, 318 `Delivery_incomplete_time_shortage`, 109/110
`Delivery_impossible_delivery_notice_left` / `...no_delivery_notice_left`. Nothing in EPCIS,
DCSA or OTM comes close.

**Change indicators are part of the published list** (rev1 p.5 sec. VII para 20):

| CI | Meaning |
| --- | --- |
| `+` | an addition |
| `#` | change to the **code name** |
| `\|` | change to the **code description** |
| `X` | "marked for deletion in this edition (will not appear in the next edition)" |

The `X` marker is a **one-edition deprecation window**, published in-band in the code table
itself. Rev 3 carries five `+` rows (codes 359-363, p.16). A consumer diffing two editions
does not have to compute the delta; the table states it, and distinguishes a renamed code from
a redefined one - which matters, because a changed *description* silently changes meaning
while a changed *name* does not.

## Time, identity, evidence

**Time: none.** Rec 24 is a value list; it carries no timestamp, no window, no time zone, no
planned/estimated/actual classifier. Time comes entirely from the carrying message. The only
time semantics inside the list are the aspect-in-the-code pattern above (`_scheduled`,
`_expected`, `_in_progress`, `_completed`), plus a handful of duration-derived facts (267
`Free_storage_time_expired`, 375 `Equipment_storage_period_at_terminal_exceeded`, 254
`Delivery_scheduled_past_cut-off_time`, 344 `Collection/pick-up_scheduled_past_cut-off_time`)
where the standard has folded "a clock ran out" into a status value.

**Identity: none, and this is the point of failure.** The definitions say
"goods/consignment/equipment/means of transport" - a four-way disjunction the code never
resolves. Rec 24 gives no way to say *which* of those four the status is about, let alone
which specific one. The subject must come from the envelope; in the UN/CEFACT binding that
envelope is `LogisticsStatus`, which hangs off whichever object it describes. **Any adoption
of Rec 24 has to supply a subject type alongside the code**, or 1 `Arrival_completed` is
unusable - it cannot distinguish "the truck arrived" from "the shipment arrived".

**Evidence and corrections: none.** No provenance, no asserting party, no correction or
retraction protocol, no supersession. There are codes *about* bad data (343
`Document_incorrect`, 115 `Discrepancy`, 233 `Incorrect_picklist`, 220 `Destination_incorrect`,
248 `Tracking_number_unknown`) but they report a real-world data defect, not a correction of a
previously sent status. There is nothing like EPCIS's `errorDeclaration`. The only
self-referential codes are 125 `No_status` ("No status information is available") and 265
`Reason_unknown` - explicit "I don't know" values, which is more than most vocabularies offer,
but not provenance.

**Versioning: good, and in-band.** See the CI table above, plus: numbered revisions each with
a UN document symbol; retired code values never reissued (34 empty slots); a namespaced XSD
binding whose URN carries the list version (`...UNECE:TransportStatusCode:4`); a two-month
mandatory public comment period on every draft revision (rev1 p.5 para 16); and a split
approval path - code-list-only revisions are approved by the maintenance body, body-text
revisions go to the Plenary (rev1 p.5 paras 17-18). That is a deliberate, documented answer to
"how do we add a code without a standards ballot".

**Extension: none.** The list is closed. No user-defined range, no `OTHER` escape hatch, no
namespace mechanism. The only way to add a code is to propose it to the ICG (rev1 p.5 para
14). This is the exact opposite of EPCIS's open `anyOf [ any URI, CBV enum ]`.

## Scores

Weighting is decided in phase 3; these are raw per-criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1** Order & service lifecycle | 1 | 1 | 0 | 0 | n/a | n/a | 0 | 2 | C1: only 6/7 `Booking_completed`/`cancelled`, 84 `Service_ordered`, 321/324 `Instruction_to_despatch_received`/`cancelled`, 77 `Refused_action`, 76 `Transport_re-arranged`. No offer/award, no accept/decline, no estimate. C2: definitions are tautologies ("The goods... has been booked"). C3: flat list, no transitions, no actors. |
| **A4** Execution events & tracking | **3** | 2 | 0 | 0 | 1 | 0 | 0 | 2 | C1=3: the fullest neutral-body execution vocabulary we have - arrive (1, 40, 364), depart (24, 127, 365), load (2, 48, 132, 363), unload (29, 135, 346), stuff/strip (93, 28), collect (13, 53, 64), deliver (21, 23, 113, 209, 210, 361), en route (31, 355-357), plus 27 `Waiting_*`, 22 `Delivery_refused_*`, 9 delay codes and the incident codes 316/320/351 (rec24-codes-extracted.tsv; rev3 Annex 2 pp.2-16). C2=2: every code carries a one-sentence definition - enough to separate *loaded onto a means of transport* (48) from *departed on a means of transport* (127) from *en route* (31) - but the definitions are one-liners that restate the name, and they never say which of goods / consignment / equipment / means-of-transport the code applies to. C3=0: no states, no transitions, no ordering; "users may choose codes to suit Transport status or Status reason as they wish" (rev1 p.3 para 8) means the same list is both. C5=1: no time model; aspect is smuggled into the code value (`_scheduled`/`_expected`/`_in_progress`/`_completed`), asymmetrically. C6=0: the code has no subject and no identifier. C7=0: no provenance, no correction semantics. C8=2: CI change indicators incl. a one-edition `X` deprecation window (rev1 p.5 para 20), numbered revisions, retired values never reissued - but the list is **closed**, no extension point. |
| **A5** Storage-in-transit | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 2 | C1: 91 `Stored`, 267 `Free_storage_time_expired`, 192 `Waiting_for_storage_area`, 375 `Equipment_storage_period_at_terminal_exceeded`, 112 `Held_at_consignee's_disposal`, 315 `Held_by_logistic_service_provider`, 326 `Goods_held_by_third_party_on_instruction_from_owner`, 328 `Moved_internally`, 46 `Moved_into_bond`, 47 `Moved_into_packing_depot`. **There is no storage-out code** - nothing pairs with 91, which is the single most important thing A5 needs. No duration, no warehouse-as-stop, no permanent-storage boundary. C5=1 only because 267 and 375 encode "the free period elapsed", i.e. storage has a billable clock. |
| **A6** Documents & evidence | 1 | 1 | 0 | 0 | n/a | 0 | 0 | 2 | C1: 359 `Bill_of_Lading_issued`, 378 `Delivery_Order_Issued`, 123 `Accompanying_documents_delivered`, 241 `Missing_document`, 306 `Document_found`, 334 `Document_refused`, 343 `Document_incorrect`, 300/301 `Document_received_without_goods`/`Goods_received_without_documentation`, 350/256 `Signature_required`/`not_required`, 72/73 receipt fully/partially acknowledged. Documents appear only as *subjects of a status*, never as entities; no document type, id, version or content. C7=0: no evidence linkage between a status and the document that proves it. |
| **A7** Charges & billing hooks | 1 | 1 | 0 | 0 | n/a | 0 | 0 | 2 | 38 `Freight_paid`, 250 `Transport_payment_not_received`, 251 `Refused_non-payment_by_payer`, 291 `Delivery_refused_collect_freight_charges_not_paid`, 292 `...reimbursement_not_paid`, 215 `Delivery_awaiting_credit_approval`, 267 `Free_storage_time_expired`, 19 `Equipment_damage_quoted_for`. Payment *status* only; no charge, no amount, no currency, no line item. |
| **A8** Parties & roles | 1 | 2 | n/a | 0 | n/a | 0 | 0 | 2 | C1: roles appear only inside code names - consignee (45, 269, 271, 282), consignor (272, 276), shipper (130), agent (207), logistics service provider (315, 320, 332, 333, 351, 360), terminal operator (374), transport operator (41, 373), equipment operator (376, 377), authorities (184, 186, 187, 228), owner of the goods (326, 333). C2=2 for one real distinction: 41 `Handed_over_under_continued_responsibility` ("under responsibility of the **same** transport operator") vs 349 `Handed_over` (to **another** party) - custody-transfer vs custody-continuation, stated in the definitions. C6=0: no party identifier of any kind. |
| **A9** Identity & cross-references | 0 | n/a | n/a | 0 | n/a | 0 | 0 | n/a | The list contains no identifier. 248 `Tracking_number_unknown` is the only code that mentions one. |
| **A2** Shipment structure | 1 | 1 | 0 | 0 | n/a | 0 | 0 | 2 | 88 `Split_consignment`, 15 `Consolidated`, 302 `Overcarried_consignment`, 330 `Consignment_partially_lost_or_missing`, 329 `Consignment_partially_stolen`, 285 `Delivery_refused_remainder_not_accepted`, 231 `Missing_goods_item`, 287 `Missing_contents`, 288 `Not_on_package_list` - partiality is expressible as a status, which is more than most event vocabularies manage. But there is no shipment entity, no service, no weight. |
| **A3** Trip, stop & assignment | 1 | 1 | 0 | 0 | n/a | 0 | 0 | 2 | 15 `Consolidated`, 100 `Transshipment`, 368 `Transshipment_to_another_wagon`, 131 `For_transfer_to_another_carrier`, 369 `Trip_plan_revised_manually` ("The transport route has been re-programmed manually"), 364/365 yard arrival/departure, 366 `Accepted_at_interchange_point`, 255 `Shunted_to_siding`. No trip, no stop sequence, no leg, no vehicle or driver. |

**Not covered at all:** A12 (rating & tariffs) - no monetary or tariff concept beyond payment
status. A13 (crew, driver & settlement) - 156 `Crew_recruitment_operation`, 171
`Medical_control_operations` and 191 `Waiting_for_workers` are maritime port operations, not
crew scheduling or settlement.

## Strengths worth adopting

1. **A named, defined, neutral-body execution vocabulary at the right granularity.** This is
   the thing the task set out to find. 345 codes, each with a one-sentence definition, from a
   UN body rather than a vendor, covering arrive / depart / load / unload / collect / deliver
   / store / delay / refuse / return / damage. Wherever our milestone catalog needs a name and
   a gloss for an operational event, Rec 24 has a candidate that predates and outranks any
   carrier's.
2. **Failure is enumerated as carefully as success.** 22 distinct `Delivery_refused_*` codes
   and a dozen `Delivery_not_completed_*` codes give a ready-made taxonomy for the most common
   HHG exception: *we went, and it did not happen*. Business closed (211, 352, 353, 354),
   consignee absent (269), premises closed in normal hours (317), further address needed (213),
   address incorrect/incomplete (234, 274), no recipient contact (243), refused for non-payment
   (291, 292), refused pending instructions (281), refused and returning to consignor (276).
   Adapt these names; do not re-derive them from support tickets.
3. **The `Waiting_for_*` reason family as a cause taxonomy.** Waiting for a location (189),
   cargo (190), workers (191), storage area (192), equipment (193), other means of transport
   (194), handling equipment (195), instructions (236), operational periods (200), daylight
   (181), weather (182), authority action (184), entry permission (186), repair/maintenance
   (201, 202). Translate the nouns to our domain - waiting for an elevator reservation, for a
   COD, for the residence to be ready, for a shuttle - and the *shape* ("delayed, waiting for
   <named resource>") transfers intact.
4. **Attribution of an incident to a party, as a status value.** 320
   `Undefined_incident_attributed_to_logistic_server_provider` vs 351 `Defined_incident...` vs
   316 `Incident_occurred_but_accepted_by_ordering_party` vs 333
   `Action_by_logistics_service_provider_on_instruction_by_owner`. Who is on the hook for a
   delay decides whether a charge sticks, and this list makes it a first-class value rather
   than a note. Directly relevant to agent-vs-van-line-vs-shipper fault.
5. **`Handed_over_under_continued_responsibility` (41) vs `Handed_over` (349).** Physical
   handover that does or does not transfer responsibility, stated as two codes with two
   definitions. That is the origin-agent -> line-haul-driver -> destination-agent chain
   exactly: goods change hands repeatedly under one van line's responsibility, then once under
   a change of responsibility. EPCIS gives owning-vs-possessing party; Rec 24 gives the
   *event* that distinguishes them.
6. **Two explicit ignorance values: 125 `No_status` and 265 `Reason_unknown`.** A vocabulary
   that lets a publisher say "I have nothing" and "something happened and I don't know why" is
   honest about the real world and keeps those cases out of free text.
7. **The change-indicator column as a published, in-band diff** (`+`, `#` name change, `|`
   description change, `X` marked for deletion), with `X` giving one full edition of
   deprecation notice, and retired values never reissued (34 empty slots). Our catalog will be
   revised; this is a cheap, proven mechanism for telling a consumer what changed *and*
   whether the change was cosmetic (name) or semantic (description).
8. **A split governance path for vocabulary vs body text** (rev1 p.5 paras 17-18): code-list
   revisions are approved by the maintenance body; a change to the normative text goes to
   Plenary. Two-month public comment on every draft (para 16). Adding a milestone should not
   require the same ceremony as changing what a milestone *is*.
9. **Duration overruns as status values.** 267 `Free_storage_time_expired` and 375
   `Equipment_storage_period_at_terminal_exceeded` publish "a chargeable clock ran out" as an
   event. SIT free time and detention are the same shape, and modelling them as *events*
   rather than as derived report rows is the right call.
10. **Partial outcomes are expressible.** 73 `Receipt_of_goods_partially_acknowledged`, 285
    `Delivery_refused_remainder_not_accepted`, 330 `Consignment_partially_lost_or_missing`, 329
    `Consignment_partially_stolen`, 283 `Delivery_refused_delivery_incomplete`. Our
    inventory-reconciliation-at-delivery case needs exactly this.

## Weaknesses / traps

1. **Status and reason are the same list, by explicit design.** "Users... may choose codes to
   fulfil the business requirements to suit Transport status or Status reason as they wish"
   (rev1 p.3 para 8). Downstream this produces the MMT RDM binding where `ConditionCode` and
   `ReasonCode` draw on one enumeration, so nothing prevents a message saying the status is
   `Waiting_for_workers` and the reason is `Delivery_completed`. **Do not inherit this.**
   Separate the two vocabularies, and if a code can serve as both, say which slot it belongs in.
2. **Aspect is baked into the code value instead of being factored out.** Five delivery codes
   for scheduled / expected / in-progress / completed / not-completed, four loading codes, and
   then the pattern is applied inconsistently. That is why the list is 345 long and why it can
   never be complete. Take DCSA's factoring (one event plus a PLN/EST/ACT classifier) and use
   Rec 24 for the *event* half only.
3. **The code has no subject.** Almost every definition reads "goods/consignment/equipment/
   means of transport", and the code cannot say which. 1 `Arrival_completed` alone does not
   distinguish "the truck arrived at the residence" from "the shipment arrived at the
   warehouse". Adopting a Rec 24 code without a mandatory subject-type field imports the
   ambiguity wholesale.
4. **No storage-out code.** 91 `Stored` says goods were "placed into storage" and nothing in
   the list says they came out. For A5 - where SIT-in and SIT-out are separate, dated,
   separately chargeable and often months apart - this is a hole, not a starting point. (It is
   the mirror of EPCIS's opposite failure, where `storing` covers into *and out of* storage in
   one step. Neither standard gives a usable SIT pair.)
5. **Zero HHG fidelity.** The list's centre of gravity is maritime and rail: ballast loading
   (143), deratization (154), compass calibration (168), waiting for a pilot (179), waiting for
   a tug (180), waiting to form a convoy (183), deramped (26), shunted to siding (255),
   transshipment to another wagon (368). There is no agent, no van line, no survey, no SIT, no
   reweigh, no valuation, no crew. Roughly a third of the list is inapplicable and should not
   be carried along for completeness' sake.
6. **Definitions restate names.** "Process, begun - The process has begun." "Booking, completed
   - The goods/consignment/equipment or means of transport has been booked." "Damaged - The
   goods/consignments/equipment have been damaged." Where the list *does* discriminate (41 vs
   349, 57 vs 23, 28 vs 29) it is because a distinction was contested in practice; elsewhere
   the definition adds nothing. Do not assume a Rec 24 gloss is a usable definition - check
   each one you adopt.
7. **Near-duplicates that will be used inconsistently.** 29 `Unloaded` vs 346
   `Unloading_completed_from_a_means_of_transport`; 24 `Departure_completed` (means of
   transport) vs 127 `Departed_completed_on_a_means_of_transport` (goods); 21
   `Delivery_completed` vs 22 `Delivery_completed_as_per_instruction`; 74 `Received` vs 72
   `Receipt_of_goods_fully_acknowledged` vs 130 `Consignment_received_from_shipper`. The
   standard never states exclusivity rules - contrast CBV 2.0, which says outright that
   `shipping` is mutually exclusive with `staging_outbound` / `loading` / `departing`. If we
   take overlapping codes, we must supply the exclusivity rule the source omits.
8. **Closed list, no extension mechanism.** No user range, no `OTHER`, no namespace. Adding a
   code means a proposal to the ICG and a revision cycle. A tenant-extensible catalog cannot be
   Rec 24 as published; we would be forking it.
9. **No provenance and no correction protocol.** Nothing says who asserted a status or how to
   retract one. A vocabulary alone cannot supply this, but it means Rec 24 answers only the
   *name* half of A4 - the envelope must come from elsewhere (EPCIS / DCSA).
10. **The authoritative current text is hard to obtain.** The Rev 5 approval document does not
    contain the code list; unece.org blocks programmatic access; the only complete
    machine-readable rendering reachable is an edi3 "Draft version" page. Any production
    dependency on Rec 24 needs a one-time human download of the official code-list attachment
    and a pinned local copy - which is what `local/` now holds for Rev 3.

## Out-of-v1 material

- **A10 (survey, estimating & inventory).** 97 `Damage_surveyed` ("surveyed to assess the
  damage"), 362 `Measured`, 30 `Empty_on_inspection`, 228 `Inspection_required_by_authority`,
  240 `Mechanical_inspection_required`, 233 `Incorrect_picklist`, 288 `Not_on_package_list`,
  231 `Missing_goods_item`, 287 `Missing_contents`. A survey/inspection *event* vocabulary, not
  an estimating model - but 97 and 362 are the two statuses a pre-move survey and a reweigh
  would publish.
- **A11 (claims & valuation).** The most complete out-of-scope cluster: 311
  `Claim_folder_opened`, 61 `Outstanding_claims_settled`, 108 `Delivery_claim` ("A claim has
  been made at delivery"), 18 `Damaged_in_the_course_of_transportation`, 218 `Damaged`, 307
  `Damaged_but_deliverable`, 308 `Spoilt`, 327 `Weight_or_volume_loss`, 331 `Destroyed`, 329
  `Consignment_partially_stolen`, 330 `Consignment_partially_lost_or_missing`, 49 `Lost`, 117
  `Missing`, 119 `Unable_to_be_located`, 66 `Plundered`, 309 `Packaging/equipment_opened`, 295
  `Delivery_refused_opened`, 335/336/337 `Seals_damaged`/`broken`/`tampered`, 208
  `Seals_replaced`, 114 `Delivery_accepted_subject_to_further_inspection`, 19
  `Equipment_damage_quoted_for`, 97 `Damage_surveyed`. That is a workable
  loss-and-damage-event skeleton: detection -> survey -> quotation -> claim opened -> settled,
  with a damage-severity distinction (`Damaged_but_deliverable` vs `Damaged` vs `Destroyed`)
  and a tamper-evidence chain. No valuation, no coverage, no money.
- **A12 (rating & tariffs).** Nothing beyond payment status (38, 250, 251).
- **A13 (crew, driver & settlement).** Nothing usable; 156/171/191 are port operations.
- **Beyond the rubric - equipment leasing.** 60 `Equipment_on_hire`, 58 `Equipment_off_hire`,
  95/96 `Sub-lease_notice_in`/`out`, 33/32/34 `Equipment_sent_for_repair` /
  `returned_from_repair` / `repaired`, 65/103 `Equipment_plugged-in`/`unplugged`, 373/374/376
  `Equipment_held_by_transport_/terminal_/equipment_operator`, 377
  `Equipment_not_released_by_equipment_operator`. If we ever model vaults, lift vans or
  trailers as leased assets with a hire clock, this is a ready vocabulary.

## Open questions

1. **Do we adopt Rec 24 code values, or only its names and definitions?** Taking the integers
   buys interoperability with EDIFACT `IFTSTA` and the UN/CEFACT RDMs and a stable,
   never-reissued identifier space; it also imports 34 dead slots, the maritime third of the
   list, and the status/reason conflation. Taking only the vocabulary (our own ids, Rec 24 as a
   documented mapping) keeps the catalog clean but forfeits the interop claim. A phase-4
   decision, to be made once, explicitly.
2. **Where does the subject type live?** Rec 24 codes are subject-less by design. Our envelope
   must carry "this status is about the shipment / the trip / the equipment / the vehicle" as a
   separate, required field before any Rec 24 code is meaningful. Confirm against whatever
   A2/A3 settle on for the shipment-vs-trip split.
3. **Do we split status from reason, given that the source does not?** Recommended yes (trap
   1), which means every Rec 24 code we adopt must be classified as status-only, reason-only,
   or both. That is a ~345-row triage; worth doing once against the extracted TSV rather than
   discovering it per-integration.
4. **Which aspect model wins - Rec 24's baked-in (`_scheduled`/`_expected`/`_completed`) or
   DCSA's factored (`eventClassifierCode`)?** Rec 24 is now a second data point on the baked-in
   side, and its asymmetry (some families have four aspects, some one) is the best argument
   against it.
5. **What fills the SIT gap?** Rec 24 has `Stored` with no storage-out; EPCIS has `storing`
   covering both directions. Neither neutral standard supplies the SIT-in / SIT-out pair A5
   needs, so A5's best source is likely a moving-specific one (DP3 / 400NG / a van line's own
   vocabulary) rather than a transport standard. Worth confirming in phase 3 before A5 is
   scored.
6. **Is codes 364-379 material safe to cite?** Attested by the JSON-LD vocabulary and partially
   by the Rev 5 XSD, not by a UN PDF read here. If any of 371-379 turn out to matter
   (`Equipment_emptied`, `Equipment_loaded`, `Delivery_Order_Issued`,
   `Cleared_for_container_release`), someone should obtain the official Rev 5 code-list
   attachment through a browser and drop it in `local/`.
