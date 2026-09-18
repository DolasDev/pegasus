---
source: src:nmfta-ebol
analyzed: 2026-09-17
evidence_grade: A
material: |
  sources/nmfta-ebol/local/ebol-apiv2.1.0.yaml — read in full, all 1 837 lines.
    OpenAPI 3.0.0, "Electronic Bill Of Lading Service" v2.1.0.
    sha256 39715755793a2f39ee290e17f3997cb1bd7cadf001e5531f4a61093df1094e8c
  sources/nmfta-ebol/local/digitalCouncilBol-v2.1.0.yaml — sha256
    9a05f827c1e191410840ddd4a9a81ef0f55c407e96a45ae9f67ad5ca656eb77d.
    VERIFIED IDENTICAL to the file above apart from line endings (this one is CRLF;
    `diff` after `tr -d '\r'` is empty). Two copies of one document, not two documents.
  NOT read: the NMFTA Digital Standards Development Council portal at
    https://dsdc.nmfta.org/apis/ebol-api-standard (registration-gated) — so the
    council's implementation guidance, conformance process, adopter list and any
    companion API standards (rating, dispatch, status, imaging) were not seen. Every
    claim below comes from the OpenAPI document itself.
  LICENCE NOTE: registry records "NMFTA copyright, no commercial copying". Code lists
    below are therefore cited by line range and illustrated with a handful of values,
    never reproduced whole.
---

# NMFTA Digital LTL Council eBOL API Standard v2.1 — analysis

## What it is

A **message standard published as an OpenAPI contract** by the NMFTA's Digital LTL
Council: a single carrier-side endpoint triple (`POST /bol/v1/app/`,
`PUT /bol/v1/app/{pro}`, `DELETE /bol/v1/app/{pro}`) that lets a shipper or a
third party lodge a bill of lading with a carrier electronically. Its own statement of
what it is (`local/ebol-apiv2.1.0.yaml:3`):

> *"This document provides an electronic Bill of Lading (eBOL). The eBOL is **a legal
> document that provides a contract between the shipper, carrier and consignee**
> stating what goods are being shipped, where the shipment is coming from and where
> it's headed to. **"Pro" number is the unique identifier for the document** for update
> and delete functions."*

**S1 kind:** `message-standard` (delivered as a vendor-neutral REST contract; the tag
on every operation is *"Carrier API Standards"*). **S2 adoption: 2** — NMFTA is the
LTL industry's own standards body, the document is versioned and dated in its payload
(`version` accepts `2.0.0`, `2.0.1`, `2.1.0` — `:156`), and the whole point is that
many carriers implement the same shape. It is an LTL-industry standard, not an HHG
one, and not a regulation. **S3 openness:** `free-registration` (registry), with NMFTA
copyright — hence `local/`.

**What our reading covered:** the entire document — every path, every schema, every
code-list schema. It is small and completely readable; evidence grade **A**.
**What we could not see:** the council's own guidance behind the registration wall
(above). There is also **no example payload, no conformance suite, and no prose beyond
the field descriptions** in the artefact itself.

**Read it for exactly one thing.** This is not a lifecycle source, an event source or
a tracking source. It is the best available answer to the question *"what does it take
to say a bill of lading in a structured way, and what identifies it?"* — which is A6
and A9. It scores on nothing else and should not be asked to.

## Model summary

One document, one shape, three verbs. There are exactly two top-level schemas —
`BOL_Request` and `BOL_Response` — and eleven code-list schemas that are pure
documentation (their entire body is a `description` listing valid values; they are
never `$ref`'d from a field, which is a real weakness, see traps).

```
BOL_Request                       required: bol, version, commodities,
                                            payment, origin, destination, billTo
  bol           {function, requestedPickupDate, isTest, requestorRole,
                 specialInstructions}                    ← required inside
  version       "2.0.0" | "2.0.1" | "2.1.0"
  images        {includeBol, includeShippingLabels,
                 shippingLabels{format,quantity,position}, email{...,addresses[]}}
  notifications [ {phoneNumber, email} ]
  referenceNumbers {pro, quoteId, shipmentId, masterBol, trailerId, manifestId,
                    bol[], po[ {number,pieces,weight,weightUnit,palletized,
                                additionalShipperInfo} ],
                    additionalReferences[ {name, value} ]}
  payment       {terms}                                   ← required
  commodities   {lineItemLayout, handlingUnits[], lineItems[]}   ← required
      handlingUnit {count, type, tareWeight, weight, weightUnit,
                    length/width/height, dimensionsUnit, stackable,
                    lineItems[ {description, weight, pieces, packagingType,
                                classification, nmfc, nmfcSub, hazardous,
                                hazardousDescription, hazardousDetails{...}} ]}
  shipmentTotals {grossWeight, netWeight, handlingUnits, linearLength,
                  cube, declaredValue, currency, ...units}
  accessorials  {codes[], hazardousDetails, cod, sortAndSegregateDetails,
                 fullValueCoverageDetails, markDetails, limitedAccessType,
                 timeCriticalDetails, appointmentDetails}
  origin / destination / billTo / customsBroker
                {account, locationId, name, address1..country, contact{phone*,...}}

BOL_Response  {version, transactionDate,
               referenceNumbers{pro, shipmentConfirmationNumber},
               scac, images{bol(base64 PDF), shippingLabels(base64 PDF)},
               termsAndConditions, messageStatus{...}, resultStatusCodes[]}
```

Four structural observations.

**1. The PRO number is the document's primary key, and it may be pre-assigned by
either side.** The path is literally `/bol/v1/app/{pro}` for update and delete. The
field: *"Shipper's **pre-assigned** PRO number for the requested carrier. **If one was
not provided in the request, one will be auto assigned by the carrier.** The PRO
number value should include the **check digit** when applicable"* (`:257`–`:261`).
So the identifier can originate on either side of the exchange, and the carrier's
pre-assignment of PRO blocks to a shipper is assumed. The check-digit sentence is
repeated for barcodes in the response images (`:1324`, `:1329`) — the identifier has a
**print representation with an integrity property**, not just a value.

**2. Acceptance produces a *second* identifier.** `BOL_Response.referenceNumbers`
carries both `pro` and `shipmentConfirmationNumber` — *"Number provided by the carrier
to **acknowledge they accepted** the BOL"* (`:1308`–`:1313`) — alongside the carrier's
`scac` (`:1314`). **The document id and the proof-of-acceptance id are different
things**, and the response is where the carrier's identity is bound to the shipment.

**3. Handling units and line items are two levels, and the relationship between them
is explicitly allowed to be unknown.** `commodities.lineItemLayout` (`:361`–`:375`):

> *"**Nested**: Indicates if the Handling Unit/Line Item relationship **is known**. If
> this value is used, each Line Item associated to a Handling Unit is conditionally
> required to be passed within that Handling Unit's object. **Stacked**: Indicates if
> the Handling Unit/Line Item relationship **is not known**. If this value is used,
> Line Items may [be] passed within any Handling Unit object."*

This is a **declared epistemic mode on a structure** — the payload says whether the
containment it shows is real or merely a layout artefact. It costs one enum and it
stops a consumer inferring a relationship that was never asserted.

**4. Weight is stated three times at three grains, each with its own unit.** Per line
item, per handling unit (plus `tareWeight` — *"Weight of the skids/pallets/slips used
in the shipment"*), and per shipment (`shipmentTotals.grossWeight` = *"Total weight of
the entire shipment, **including** handling units (tare weight)"* vs `netWeight` =
*"…**not including** handling units"*, `:566`–`:580`). Every weight field is paired
with its own `weightUnit` *"Defaults to Pounds (Imperial) if not passed"*, and the same
pattern holds for `dimensionsUnit` (Inches/Centimeters) and `cubeDimensionsUnit`
(Feet/Meters). **Unit accompanies magnitude at every single grain** — no global unit,
no implied unit.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite (`local/ebol-apiv2.1.0.yaml`) |
| --- | --- | --- | --- |
| eBOL | *"a legal document that provides a contract between the shipper, carrier and consignee stating what goods are being shipped, where the shipment is coming from and where it's headed to"* | A6 | `:3` |
| `pro` | *"Shipper's pre-assigned PRO number for the requested carrier. If one was not provided in the request, one will be auto assigned by the carrier. The PRO number value should include the check digit when applicable."* — and it is the URL key for update/delete | A6, A9 | `:257`–`:261`, `:33`, `:69` |
| `shipmentConfirmationNumber` | *"Number provided by the carrier to acknowledge they accepted the BOL."* | A6, A9 | `:1308` |
| `scac` | *"4-letter, Standard Carrier Alpha Code, returned by the carrier."* — returned, not supplied | A8, A9 | `:1314` |
| `masterBol` | *"Master Bill of Lading number for the shipment."* | A9 | `:272` |
| `bol[]` | an **array** of bill-of-lading numbers on one eBOL | A9 | `:284` |
| `shipmentId` | *"Shipment Id (SID) number for the shipment."* | A9 | `:268` |
| `quoteId` | *"Quote (estimate) number provided by the carrier after submitting a rate quote request."* | A7, A9 | `:262` |
| `trailerId` | *"When passed, indicates that the shipment is associated to a specific, **spotted trailer**."* | A3, A9 | `:276` |
| `manifestId` | *"When passed, indicates that the shipment is associated to **a manifest that includes multiple shipments, possibly across multiple spotted trailers**."* | A3, A9 | `:280` |
| `additionalReferences[] {name, value}` | *"Indicates the **name** of the reference number being provided"* + the value — a typed-by-label extension slot | A9, C8 | `:325`–`:340` |
| `bol.function` | *"The intent for the submitted request. Valid Values: **Create** - Used for initial creation"* — one value only | A6, C3 | `:129`–`:136` |
| `bol.isTest` | *"Indicates whether or not the submitted request is intended to be a test or not."* — a **required** field | C7, C8 | `:137` |
| `requestorRole` | *"Identifies the party making the request."* — `Shipper` \| `Consignee` \| `Third Party` | A8, C7 | `:143`, `:1694` |
| `requestedPickupDate` | *"The intended Ship Date. **NOTE this does not serve as a Pickup Request**"* | A1, C5 | `:121`–`:128` |
| `version` | *"Indicates which **minor version of the Digital LTL Council Bill of Lading spec you are consuming**"* — in the payload, not the URL | C8 | `:156`–`:162` |
| `lineItemLayout` | `Nested` = *"the Handling Unit/Line Item relationship **is known**"*; `Stacked` = *"…**is not known**"* | A2, C2 | `:361`–`:375` |
| `handlingUnits[]` | `{count, type, tareWeight, weight, dimensions, stackable, lineItems[]}` | A2 | `:376`–`:437` |
| `tareWeight` | *"Weight of the skids/pallets/slips used in the shipment."* | A2 | `:397` |
| `grossWeight` / `netWeight` | *"including"* vs *"not including handling units (tare weight)"* | A2 | `:569`–`:580` |
| `linearLength` | *"Linear length for the entire shipment"* | A2 | `:592` |
| `cube` | *"Cubic volume of the entire shipment (total length X total width X total height)"* | A2 | `:603` |
| `declaredValue` | *"Total monetary value of the shipment in USD (sometimes needed for cross-border moves)"* | A7, A11 | `:616` |
| `classification` | freight class; 19 values `50`…`500` plus **`Not required`** | A2, A12 | `:480`, list `:1411`–`:1433` |
| `nmfc` / `nmfcSub` | NMFC code and its Sub value | A2, A12 | `:488`–`:497` |
| `accessorials.codes[]` | *"An array to hold the **list of services requested for the shipment**"* — 28 codes | A2, A7 | `:631`–`:645`, list `:1379`–`:1410` |
| `payment.terms` | `Prepaid` \| `Collect` \| `Third Party` | A7 | `:341`–`:353`, `:1620` |
| `cod` | `{amount, currency, terms, customerCheckAcceptable, remitTo{…full address…}}`, *"Required when accessorial code COD is present"* | A7 | `:669`–`:752` |
| `fullValueCoverageDetails` | `{monetaryValue, currency}`, *"Required when accessorial code FVC is present"* — **the one valuation hook** | A11 | `:763`–`:784` |
| `timeCriticalDetails` | `{type, date{start,end}}` where type ∈ `Deliver On Date`, `Deliver On or After Date`, `Deliver By Date`, `Delivery Window` — each with a one-line definition | A1, C5 | `:824`–`:870`, list `:1809`–`:1816` |
| `appointmentDetails` | `{pickup{start,end}, delivery{start,end}}`, required when `APTP`/`APTD` is in the accessorial codes | A3, C5 | `:871`–`:925` |
| `limitedAccessType` | `{origin, destination}` drawn from a ~100-value site-type catalogue (`Church`, `Farm`, `Hotel`, `School-50 - Nursing Home / Assisted Living`, `Storage-71 - Self Storage Warehouse`, `Secure-45 - Military Base`…) | A3, A10 | `:795`–`:823`, list `:1515`–`:1619` |
| `origin` / `destination` / `billTo` / `customsBroker` | four **positionally named** party slots, each with the same address+contact shape; `account` = *"Company's account number/id for the …"*, `locationId` = *"Company's location id for the …"* | A8, A9 | `:926`, `:1016`, `:1108`, `:1198` |
| `customsBroker.type` | `Import` = *"customs broker handling the destination-side"*, `Export` = *"…the origin-side of the cross-border freight move"* | A8 | `:1201`–`:1211` |
| `notifications[]` | *"include if you want notifications of **shipment movements** by text message or email"* — `{phoneNumber, email}` | A4, A8 | `:238`–`:253` |
| `messageStatus` | `{status ∈ PASS\|FAIL\|WARNING, code, message, resolution, information[]}`; `WARNING` = *"Request is successful with some exception"* | C7 | `:1338`–`:1373` |
| `resolution` | *"Provides **guidance** pertaining to the response code."* | C7 | `:1358` |
| `Result_Status_Codes` | *"Numerical codes describing any logical status outcomes. **Not all codes apply to this API, but are included to encourage adoption of these standards across API specifications.**"* | C7, C8 | `:1817`–`:1837` |
| `termsAndConditions` | *"Add terms and conditions here if desired, or a link to your terms and conditions."* — free text in the response | A6 | `:1332` |

## Lifecycles & events

**There is almost none, and the almost matters.**

- `bol.function` is a **required** field with exactly one documented value —
  *"Create - Used for initial creation"* (`:129`–`:136`). A required discriminator with
  a single value is a version-1 extension point: the slot for `Update`, `Cancel`,
  `Replace` is cut, declared mandatory, and left empty. (Compare X12's element 353,
  which fills the same slot with 65 values — see src:stedi-x12-reference.)
- The **lifecycle lives in HTTP verbs**, not in the payload: `POST` creates,
  `PUT /{pro}` updates, `DELETE /{pro}` deletes, and both keyed operations answer
  `404 eBOL not found`. So the document's states are *exists* and *does not exist*.
  There is no accepted / tendered / picked-up / in-transit / delivered, no actor
  authority, and **no cancellation reason** — a `DELETE` carries no body.
- The only *transition* in the document is acceptance, and it is implicit: a `POST`
  that returns a `shipmentConfirmationNumber` means the carrier accepted. There is no
  rejection vocabulary as such, only failure codes.
- **The failure codes are where the operational reality leaks through.** The
  `Result_Status_Codes` list (`:1817`–`:1837`) is nominally about message processing,
  but half of it is about the physical world: beyond `300 Failure Data Error` and
  `400 Failure Formatting Error` it carries `700 Failure Outside Ship Window`,
  `800 Failure No Freight - **Will be re-attempted**`, `900 Failure No Freight - Pick
  UP Closed`, `1000 Failure Freight Not ready`, `1100 Failure Packaging Problem`,
  `1400 Failure **Duplicate Pro**`, `1600 Failure Shipper Closed`. **These are
  exception reason codes for a failed pickup wearing an API error's clothing** — and
  `800`'s *"will be re-attempted"* is a retry semantic embedded in a status code.
  Every one of these is a fact an HHG dispatcher recognises.
- `messageStatus.status` has three values, and the third is the useful one: `WARNING` —
  *"Request is successful **with some exception**"* (`:1344`–`:1348`), carried
  alongside a `code`, a human `message`, a `resolution` (*"Provides guidance"*) and an
  `information[]` array of further `{code, type, message}` triples. **Partial success
  with itemised advisories** is a real and correct shape; most APIs manage two values.
- `notifications[]` is the only acknowledgement that the shipment will *move*: contacts
  to be told about *"shipment movements"* (`:238`–`:242`). No event vocabulary — the
  standard hands the tracking problem to the carrier and walks away.

## Time, identity, evidence

**Time.** Deliberately thin, and one line is worth the whole section:

> `requestedPickupDate`: *"The intended Ship Date. **NOTE this does not serve as a
> Pickup Request**"* (`:121`–`:126`).

A date on a document is not an instruction to a dispatcher. That distinction —
*asserted intent on paper* vs *a scheduled operational commitment* — is exactly the one
HHG blurs constantly, and it is stated here in eleven words.

Beyond that: every date is a string in *"YYYY-MM-DDTHH:mm:ss.sss (ISO 8601)"* format,
examples are always midnight local (`'2022-11-20T00:00:00.000'`), and there is **no
time zone field anywhere** — no offset, no IANA id, no statement about which zone a
stop's appointment is in. Windows are modelled as `{start, end}` pairs in three places
(`timeCriticalDetails.date`, `appointmentDetails.pickup`, `appointmentDetails.delivery`)
and the conditional-requirement rules are spelled out (`end` *"Required when the
timeCriticalDetails.type is Delivery Window"*, `:857`–`:866`). `Time_Critical_Types`
gives four *deadline shapes* with definitions — *"Deliver On Date - Freight can only be
delivered on the specified start date"*, *"Deliver By Date - Freight can only be
delivered **up to, and including**, the specified start date"* (`:1809`–`:1816`). That
is a small, precise vocabulary for **the shape of a delivery commitment** — a delivery
spread is one of these shapes, and naming the shape rather than just carrying two dates
is the right move. There is no planned/actual/estimate distinction at all, because
nothing here has happened yet: an eBOL is entirely ex ante.

**Identity.** The strongest part of the source, and the reason to keep it.

- **The PRO is the document identity, in the URL.** Not a field to be searched on — the
  key of the resource (`:33`, `:69`).
- **The identifier can be issued by either party**, with an explicit fallback:
  pre-assigned by the shipper from a carrier-issued block, or auto-assigned by the
  carrier if absent (`:257`–`:261`).
- **The identifier has a print form with a check digit**, called out three times
  (`:260`, `:1324`, `:1329`). The value and its barcode representation are treated as
  the same fact.
- **Ten distinct reference types coexist on one document** (`referenceNumbers`,
  `:254`–`:340`): `pro`, `quoteId`, `shipmentId`, `masterBol`, `trailerId`,
  `manifestId`, `bol[]` (array), `po[]` (structured, with pieces/weight/palletized per
  PO), and `additionalReferences[]`. They are *positionally typed* — the field name is
  the type — with one open `{name, value}` escape hatch.
- **They span three grains at once**: the document (`pro`, `bol`, `masterBol`), the
  commercial order (`po`, `quoteId`), and the **equipment/trip** (`trailerId` = *"a
  specific, spotted trailer"*, `manifestId` = *"a manifest that includes **multiple
  shipments, possibly across multiple spotted trailers**"*). That `manifestId`
  definition is the only sentence in the whole document that admits consolidation
  exists — and it handles it purely as a cross-reference, which is a legitimate and
  cheap answer for a document standard.
- Parties carry two identifiers each: `account` (*"Company's account number/id"*) and
  `locationId` (*"Company's location id"*) — **the counterparty's own ids for the
  counterparty**, which is the correct direction for a cross-reference.
- The carrier's `scac` comes back **in the response** (`:1314`): carrier identity is
  asserted by the carrier, not claimed by the requester.

**Evidence & provenance.** Two mechanisms, both good, both narrow.

1. `requestorRole` — `Shipper` | `Consignee` | `Third Party` (`:143`, `:1694`) — is a
   **required** field. Every lodged document records *in what capacity* it was lodged.
   Combined with `payment.terms` (`Prepaid` / `Collect` / `Third Party`) it separates
   **who asked**, **who pays** and **who ships** into three independent facts.
2. `isTest`, also **required** (`:137`) — *"Indicates whether or not the submitted
   request is intended to be a test or not."* A mandatory, in-band, per-message
   rehearsal flag. Given this repo's own investment in benign rehearsal
   (`--dry-run`, captured mutations), the pattern is familiar and worth carrying into
   the model: *a fact knows whether it is real*.

The **document itself is the evidence**: the response returns the rendered BOL as
*"Base 64 encoded PDF"* plus shipping labels as a second PDF (`:1319`–`:1331`), and
offers to email either. The structured data and the rendered legal artefact travel
together, the barcode check-digit rule applies to the render, and
`termsAndConditions` is carried as text or a link. **What the carrier accepted is a
document, and the document is returnable.**

**Corrections.** `PUT /{pro}` replaces the document wholesale, `DELETE /{pro}` removes
it. No version history, no supersession, no amendment reason, no record of what
changed, and `bol.function` — the field that exists to say *what this submission is* —
has no `Update` value. The only trace of a correction problem anywhere is failure code
`1400 Failure Duplicate Pro`.

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 1 | 0 | 0 | 2 | n/a | 1 | 1 | Only the lodge-a-document act. `bol.function` is required with one value, `Create` (`:129`). Lifecycle is the HTTP verb set; no states, no transitions, no actors, no cancel reason. C5=2 for `requestedPickupDate`'s *"does not serve as a Pickup Request"* (`:121`) and the four `Time_Critical_Types` deadline shapes with definitions (`:1809`). C7=1 for `requestorRole`. |
| A2 Shipment structure | 2 | 3 | n/a | 1 | n/a | 1 | 1 | 1 | Handling unit / line item / shipment totals at three grains, each with its own unit; `tareWeight`; gross-vs-net defined against tare (`:566`–`:580`); `linearLength`, `cube`, `stackable`, `palletized`; freight class + NMFC + sub. **C2=3 earned on `lineItemLayout` Nested-vs-Stacked** (`:361`) — the structure declares whether its own containment is known. `accessorials.codes[]` is literally *"the list of services requested for the shipment"* (`:636`), which is a services-ordered concept. C4=1: nothing HHG (no vaults, no cartons-by-room, no third-party services), but declared value and full-value coverage are adjacent. |
| A3 Trip, stop & assignment | 1 | 1 | n/a | 0 | 2 | 2 | n/a | n/a | No trip, no stop sequence, no vehicle assignment. What exists: exactly two places (`origin`, `destination`) with no ordering concept; `trailerId` / `manifestId` as **cross-references into someone else's trip** (`:276`–`:283`); `appointmentDetails.pickup/delivery` windows (`:871`); and `limitedAccessType` as a per-end site-access classification (`:795`). C5=2 for the window pairs with conditional-requirement rules; **no time zone anywhere** caps it. |
| A5 Storage-in-transit | 0 | n/a | n/a | 0 | n/a | n/a | n/a | n/a | Absent. The only adjacent strings are `Storage-18 - Container Freight Station` and `Storage-71 - Self Storage Warehouse` in the limited-access site catalogue (`:1614`–`:1616`) — a *destination type*, not a storage state. |
| A6 Documents & evidence | 3 | 3 | 1 | 1 | n/a | 3 | 2 | 2 | **The area this source wins outright.** A BOL modelled as a structured document with a legal definition (`:3`), a document key in the URL, an acceptance identifier distinct from the document identifier (`:1308`), the rendered PDF and labels returned inline as base64 with a barcode check-digit rule (`:1319`–`:1331`, `:260`), `termsAndConditions` carried with it, and a three-value message status with `WARNING` + `resolution` + itemised `information[]` (`:1338`). C3=1: create/update/delete only, `function` stubbed at one value. C7=2 for `requestorRole` + `isTest`; **not 3** — no version history, no amendment reason, no correction record. |
| A7 Charges & billing hooks | 2 | 2 | n/a | 1 | n/a | 1 | n/a | 1 | Not rating, but every billing *hook*: `payment.terms` Prepaid/Collect/Third Party (`:1620`), a full `billTo` party with its own account number, a 28-code accessorial list that is the accessorial catalogue in miniature (`:1379`), COD with amount/currency/terms/`customerCheckAcceptable`/`remitTo` address (`:669`), `declaredValue` + `currency`, `quoteId` linking the document back to a rate quote (`:262`), and conditional-detail objects that fire off accessorial codes (SRT→`sortAndSegregateDetails`, FVC→`fullValueCoverageDetails`, MARK→`markDetails`, COD→`cod`). **The accessorial-code-implies-required-detail pattern is the reusable idea.** |
| A8 Parties & roles | 2 | 2 | n/a | 0 | n/a | 2 | 2 | 1 | Four positional party slots (`origin`, `destination`, `billTo`, `customsBroker`) each with `account` + `locationId` + a **required** contact phone, plus `remitTo` inside COD and `notifications[]` contacts. `requestorRole` separates who lodged it from the parties named on it; `customsBroker.type` Import/Export is defined by which *side* of the border they handle (`:1201`). C4=0: no carrier party at all on the request (the SCAC only comes back on the response), no agent chain, no driver, no van line. |
| A9 Identity & cross-references | 3 | 3 | n/a | 2 | n/a | 3 | 2 | 2 | **The other area this source wins.** PRO as the resource key, issuable by either party with a documented fallback and a check digit (`:257`, `:33`); `shipmentConfirmationNumber` as a separate acceptance id; carrier `scac` returned not claimed; ten positionally-typed reference kinds spanning document / order / equipment grains, incl. `bol[]` as an array and structured `po[]`; `additionalReferences[] {name,value}` as the open slot; `account` + `locationId` as the counterparty's own ids. C4=2: PRO, BOL, master BOL and SCAC are genuinely the HHG identifiers too. C8=2 for `additionalReferences`. |

Areas **A4** (execution events & tracking) and **A10–A13** are **not scored** — the
document contains no material for them beyond `notifications[]` (contacts to be told
about *"shipment movements"*, with no event vocabulary) and the pickup-failure codes
noted under Lifecycles.

**S5 — fit to Pegasus data.** `unknown` pending the internal-system analyses, with one
strong prior worth recording: **A6/A9 is where pegII is most likely to already be
adequate.** A moving company's system of record necessarily has a BOL number, an order
number, a registration number and a shipper; the gap is more likely to be *typing* the
cross-references (issuer + kind + value, the way `LogisticsIdentifier` and this
document's positional slots both do) than *having* them. Test that first — it is the
cheapest win in the catalogue.

## Strengths worth adopting

1. **A document is an entity with a key, and the key is the partner's key.** PRO is the
   URL. Not a searchable attribute, not a foreign column — the identity. Our BOL should
   be addressable the same way.
2. **The document identifier and the acceptance identifier are different facts.** `pro`
   is what the document is called; `shipmentConfirmationNumber` is proof somebody
   accepted it. Collapsing these loses the ability to say *"we issued it but they never
   confirmed."*
3. **An identifier may be issued by either party, with a documented fallback rule.**
   *"If one was not provided in the request, one will be auto assigned by the carrier."*
   Our agent/van-line numbering has exactly this shape and it is rarely written down.
4. **The identifier's print form is part of the identifier** — *"should include the
   check digit when applicable"*, applied to both the value and its barcode. If our BOL
   number has a check digit, the model should say so once rather than in every renderer.
5. **`lineItemLayout: Nested | Stacked` — declare whether a structural relationship is
   known.** The best single idea in the document. An inventory whose items are known to
   be in a specific vault is not the same fact as an inventory listed in vault order; a
   model that cannot distinguish them will silently fabricate the stronger claim.
6. **Unit travels with magnitude at every grain**, with a stated default rather than an
   implied one. Gross vs net defined *against tare weight*, not by convention.
7. **Accessorial code implies a required detail object.** `codes[]` contains `COD` ⇒
   `cod{}` is required; `FVC` ⇒ `fullValueCoverageDetails{}`; `SRT` ⇒ `pieces`;
   `APTD` ⇒ `appointmentDetails.delivery.start`. A flat service-code list plus
   conditionally-required structured detail is a clean way to model *services ordered*
   without a class per service — and it is directly transferable to HHG accessorials
   (shuttle, long carry, piano, third-party servicing).
8. **Deadline *shapes* rather than raw dates.** `Deliver On Date` / `On or After` /
   `By Date` / `Delivery Window`, each with a one-line definition. A delivery spread is
   one of these shapes; naming the shape makes "is this delivery late?" answerable.
9. **`requestedPickupDate` is explicitly not a pickup request.** Ex-ante intent on a
   document is a different fact from an operational commitment. Say so in the model.
10. **`requestorRole` is required.** Every submission records the capacity in which it
    was made. Cheap provenance, mandatory, unskippable.
11. **`isTest` is required, in-band, per message.** A fact knows whether it is real.
    Our benign-rehearsal machinery already believes this; the model should too.
12. **Three-valued outcome with itemised advisories.** `PASS` / `FAIL` / `WARNING`
    (*"successful with some exception"*) plus `code` + `message` + `resolution`
    (*"guidance"*) + `information[]`. Partial acceptance is the common case in HHG
    document exchange and two-valued outcomes force a lie.
13. **Structure the version into the payload** (`version: "2.1.0"`, with the accepted
    set enumerated) and say what it versions: *"which minor version of the … spec you
    are consuming."* Our catalogue events should carry the same.
14. **`trailerId` / `manifestId` as cross-references into the carrier's trip**, with the
    manifest explicitly *"multiple shipments, possibly across multiple spotted
    trailers."* A document standard does not need to model consolidation — it needs to
    be able to *point at* it. Worth remembering when deciding how much trip detail the
    published catalogue should expose.

## Weaknesses / traps

- **Two parties and no sequence.** `origin` and `destination` are fields, not a stop
  list. An HHG shipment with a warehouse hand-in, a SIT interval, an interline transfer
  and a partial delivery cannot be expressed. Do not let a document shape define the
  operational shape — this is the trap that makes legacy movers treat "the BOL" as if it
  were the shipment.
- **No lifecycle, and a required discriminator stubbed at one value.** `function:
  Create` with no `Update` / `Cancel` is an invitation to infer lifecycle from HTTP
  verbs. `PUT` replaces the whole document with no amendment reason and no history —
  for a document the source itself calls *"a legal document that provides a contract"*,
  that is a serious gap, and it is the single thing we must not copy.
- **No time zone, anywhere.** Every example is local midnight. `appointmentDetails`
  windows are zoneless strings. A destination delivery window is a local fact; p44
  (src:project44) gets this right and this document does not.
- **The code-list schemas are documentation, not schema.** `Accessorial_Codes`,
  `Handling_Unit_Types`, `Payment_Terms`, `Classification_Codes`, `Country_Codes`,
  `Currencies`, `Limited_Access_Types`, `Packaging_Types`, `Requestor_Roles`,
  `State_Province_Codes`, `Time_Critical_Types`, `Result_Status_Codes`,
  `Shipping_Label_Formats` are schemas whose entire body is a prose `description`; the
  fields that use them are plain `type: string` pointing at *"See the … schema at the
  bottom of this page."* **Nothing validates.** If we publish code lists, publish them
  as enumerations a machine can check.
- **`Handling_Unit_Types` and `Packaging_Types` are the same ~60-value list, duplicated
  verbatim** (`:1448`–`:1514` and `:1627`–`:1693`). Two names, one vocabulary, no stated
  difference — and both are pallet/drum/carton vocabularies with no HHG analogue
  (no vault, no carton by room, no crated item, no unpacked article).
- **Freight class and NMFC are LTL commercial DNA that HHG does not share.** The
  `classification` enum's inclusion of **`Not required`** as a value is itself the
  warning: this axis is optional even within LTL.
- **`country` is three values** (`USA`/`CAN`/`MEX`) and `stateProvince` is a closed
  North-American list. The standard is continental by construction.
- **The parties are positional, not role-typed.** Four named slots, so a fifth party
  (an origin agent, a destination agent, a warehouse, an RMC) has nowhere to go. A
  role-typed party *list* is required for HHG; this shape does not extend.
- **The carrier is absent from the request.** SCAC appears only in the response, so the
  document cannot say who it was tendered to. Fine for a one-carrier API call; wrong for
  a record.
- **`limitedAccessType` is a ~100-value flat site catalogue with a `Type-NN - Label`
  string convention** (`Other-52 - Other`, `Secure-45 - Military Base`). It is
  genuinely useful raw material for HHG site access, but the encoding — a compound
  string mixing a family, an integer and a label in one value — should not be copied.
- **Error and business-exception codes are conflated** in `Result_Status_Codes`.
  `400 Failure Formatting Error` and `1000 Failure Freight Not ready` are not the same
  species. Keep transport errors and domain exceptions in separate vocabularies (this is
  the same fault as p44's `COMPLETED / TIMED_OUT`).
- **Two copies of one file are stored under two names** — `ebol-apiv2.1.0.yaml` and
  `digitalCouncilBol-v2.1.0.yaml` are byte-identical after CRLF normalisation. Anyone
  diffing them later will waste an afternoon; the registry should note it.

## Out-of-v1 material

- **A10 (survey, estimating & inventory detail).** `limitedAccessType` (`:1515`–`:1619`)
  is a ~100-value **site-access catalogue** — `Church`, `Farm-87 - Winery`,
  `School-50 - Nursing Home / Assisted Living`, `Secure-45 - Military Base`,
  `Storage-71 - Self Storage Warehouse`, `Park-11 - Campground / RV Park`,
  `Other-48 - Native American Reservation` — grouped into families (`Airport`, `Club`,
  `Hotel`, `Mine`, `Park`, `Port`, `School`, `Secure`, `Storage`, `Tradeshow`, `Other`).
  This is the closest published analogue to a survey's *access findings* (shuttle
  required, long carry, elevator, restricted hours) and the family/leaf structure is
  worth mining when A10 is built. Also relevant: `stackable` on both handling units and
  line items, `sortAndSegregateDetails.pieces`, `markDetails.pieces`, and the full
  hazmat block (`unnaNumber`, `propername` *"From DOT regulations 172.101"*,
  `technicalName`, `packingGroup`, `class`, `contractNumber`, plus a required
  `emergencyContact` with name and phone, `:498`–`:565`, `:646`–`:668`) — note the
  pattern of **deferring a regulated catalogue to its own regulation by citation**.
- **A11 (claims & valuation).** `fullValueCoverageDetails {monetaryValue, currency}`,
  required when accessorial `FVC` is present (`:763`–`:784`), plus
  `shipmentTotals.declaredValue` + `currency` (`:616`–`:630`). **Released-vs-full-value
  is expressed here as an accessorial code with a money detail** — an interesting, very
  cheap encoding of the valuation election, and one worth comparing against the CFR
  treatment in src:cfr-49-375 when A11 is built.
- **A12 (rating & tariffs).** The 28-code `Accessorial_Codes` list (`:1379`–`:1410`) is
  a complete miniature accessorial catalogue with several codes that have direct HHG
  analogues: `IDL`/`IPU` (inside delivery/pickup), `LFTD`/`LFTP` (lift gate),
  `LTDAD`/`LTDAP` (limited access), `RES`/`REP` (residential delivery/pickup),
  `SRT` (sort and segregate), `MARK`, `OVR` (over dimension/excessive length),
  `APTD`/`APTP` (appointment required), `GTD_AM`/`GTD_NOON`/`GTD_PM` (guaranteed by
  morning/noon/end of day), `TCS`, `SS` (single shipment), `EXPD`, `COD`, `HAZ`, `INBD`,
  `MNC` (must notify consignee), `PSC`/`PSH` (protect from cold/heat), `PPD`. Plus
  freight class (`:1411`) and NMFC/NMFC-sub — the LTL rating spine, which HHG replaces
  with 400N/400NG.
- **A13.** Nothing.

## Open questions

1. **Is our BOL number the document's identity, the shipment's identity, or both?** In
   this standard PRO is unambiguously the *document's* key and `shipmentId` (SID) is a
   separate field. pegII very likely conflates them. Establish which, because the
   catalogue's correlation story depends on it.
2. **Who issues our BOL number, and is there a pre-assigned block?** This source assumes
   carrier-issued blocks pre-allocated to shippers, with carrier auto-assignment as
   fallback. Do the van lines (Allied, Atlas) pre-allocate registration or BOL ranges to
   our tenants? If so the model needs a *block* concept, and `p44`'s `ProNumberBlock` /
   `ProNumberBlockVendorId` schemas confirm this is a real industry object.
3. **Do we need a `lineItemLayout` equivalent for HHG inventory?** Is an inventory item
   *known* to be in a particular vault/carton, or merely listed alongside it? This is a
   real distinction in HHG (SIT vault contents, overflow, exception items) and the
   answer determines whether inventory-in-container is an assertion or a layout.
4. **How is an amendment to an issued BOL recorded?** This source cannot say (whole-
   document `PUT`, no history, no reason). The X12 answer is a purpose code
   (`04 Change` / `05 Replace` / `01 Cancellation`, see src:stedi-x12-reference) and
   ours needs to be at least that expressive, since the BOL is a contract.
5. **Should accessorials/services be one flat code list with conditionally-required
   detail** (this source's answer) **or a typed service object per service** (OTM's
   constraint approach)? Decide in A2, since it determines how *services ordered* is
   shaped and how a new service is added without a schema change.
6. **Do we adopt a mandatory `isTest` on published events?** The rehearsal concept
   already exists in the platform (`client.is_dry_run`, captured mutations). If a
   catalogue event can ever be emitted during a dry run, it should say so in band.
7. **Registry housekeeping (orchestrator, not done here):** record that
   `ebol-apiv2.1.0.yaml` and `digitalCouncilBol-v2.1.0.yaml` are the **same document**
   (identical after CRLF normalisation), so later readers do not treat them as two
   sources. Also worth noting that the registry lists this source's areas as
   `[A6, A8, A9]`; our reading says A2 and A7 are as strong as A8 and should be added.
