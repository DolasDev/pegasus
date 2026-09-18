---
source: src:atlas-world-group-api
supplement_to: analysis.md
analyzed: 2026-09-17
evidence_grade: B
scope: focused supplement — the semantic layer (code lists / vocabulary) only
material: |
  docs/atlas-world-group-api/README.md (§1 "How to re-fetch this", §2 "Our measured grant",
  "Rate limits", "The On-Behalf-Of header"), docs/atlas-world-group-api/INVENTORY.md, and a
  programmatic re-read of all 24 documents under docs/atlas-world-group-api/openapi/ targeting
  three things the round-1 read did not extract: (a) every `enum` declaration, (b) every property
  `description` containing a cross-reference to a code-list endpoint, (c) every named worked
  example in a request body. Harvest committed at
  captured/spec-derived-vocabulary/estimating-v2-vocabulary.json.
  NO live API call was made. No key was found, and no authentication was attempted.
---

# Atlas World Group APIM — vocabulary supplement

## Why this exists

Round 1 scored Atlas across nine areas while recording, in its own opening, that the catalog has
**zero enum declarations in every operational spec** and **zero property descriptions in the two
core order specs**. The round-1 crosscheck flagged the contradiction: *"C1 (coverage) from field
names is defensible; C2 (semantic precision) from field names is not"*
(`docs/domain-reference/analysis/round-1-crosscheck.md:192`). Because round 1 nominates Atlas as
the **A5 best-source candidate** and a strong **A3** candidate, that objection is load-bearing —
an A5 or A3 model sourced from Atlas would otherwise be built on column names.

The remedy round 1 prescribed (its Open Question 1) was to call the reference-data endpoints and
commit the results. **That capture did not happen and is blocked** — see below. What follows is
(1) the precise state of the blockage, (2) the vocabulary that turned out to be recoverable from
the committed specs *without* a key, and (3) the score corrections.

---

## 1. The capture is blocked — no key exists in the repo

**No `Ocp-Apim-Subscription-Key` is present in any repo material.** The QA key referenced
throughout `docs/atlas-world-group-api/README.md` was issued by Atlas admin-side, is invisible to
the developer portal account (`GET /users/{uid}/subscriptions` → `count: 0`, README §1
"Subscription status"), and was deliberately never committed — README §1 states *"No fetch script
is committed here because it needs portal credentials."* The only occurrences of the string
`ATLAS_SUB_KEY` anywhere in the tree are a **config-key name** in a docstring
(`apps/api/src/handlers/integration-call.ts:185`) and a **test fixture**
(`apps/api/src/handlers/integration-delivery.test.ts:232-241`), neither of which is a credential.

Per the task's instruction, **no value was guessed and no authentication was attempted.** The
exact endpoint list is recorded in § "The exact capture list" below and in
[`captured/reference-data/README.md`](captured/reference-data/README.md).

### Three corrections to round 1's description of the blockage

| Round-1 / crosscheck claim | Measured | Correction |
| --- | --- | --- |
| *"the ~35 reference-data endpoints"* (crosscheck:216; analysis "Where the code lists actually live") | **63** parameterless GET reference-data endpoints across 12 APIs | Round 1's list omitted `estimating-v2`'s typed lookups (`/Tariffs`, `/Container/Types`, `/Reports/Definitions`, `/Referral/*`, `/Tariffs/PricingMethods`, `/Waterhaul/Ports`), both `RadsSupport` lookups, `holidays-v1`, `yembo-v1`, and `/Location/States`. |
| *"five of these are reachable on the current QA subscription key"* (crosscheck:216; analysis OQ1 names exactly 5) | **47 of 63 are reachable** | Round 1 named five endpoints individually but then applied the measured 6-API grant only to those five. The grant (`estimating-v2`, `documents-v1`, `customers-v2`, `agents-v1`, `cubesheets-v1`, `shipment-management-v1` — README §2 "Our measured grant") covers **47** of them, including all 32 in `estimating-v2`. The prize is ~9× larger than recorded. |
| *"Reference-data endpoints, response schema `array<string>` with no values in the spec"* (analysis, "Where the code lists actually live") | **47 bare `array<string>`, 15 typed `array<Model>`, 1 malformed** | Not all reference data is opaque. Fifteen endpoints return **structured** models, and three of those models carry real property descriptions. See § 2.4. |

---

## 2. What was recoverable without a key

Three seams of genuine vocabulary exist in the committed specs. Round 1 extracted the first and
missed the second and third.

### 2.1 Declared enums — 11, all in one API (confirms round 1)

Re-verified programmatically across all 24 documents. Enum counts: `estimating-v2.json` **11**,
`echo-api.json` 2 (both the APIM stock `?param=sample`), **every other document 0**. Round 1's
central claim holds exactly.

The 11: `AccessType` (`estimating-v2.json:15091`), `CartonTypes` (`:15819`, 48 values),
`HourlyServiceType` (`:16828`), `HourlyType` (`:16849`), `LocationType`, `RateType`, `Region`,
`ReportDefinitionType` (`:19046`), `ServiceName` (`:19198`, **218** values — round 1 said "~230"),
`SeverityEnum` (`:19421`), `ValuationCategory` (`:19917`).

> **New finding — Atlas carries two parallel vocabularies for the same concept.**
> `ValuationCategory` is declared as `NONE | BASE_PROTECTION | DECLARED_VALUE_PROTECTION |
> FULL_VALUE_PROTECTION | REPLACEMENT_VALUE | RELEASE_LONG_VALUATION | RELEASE_LOCAL_VALUATION |
> VALUATION | LOCAL_VALUATION | VALUATION_FLAT_RATE` (`:19917`). But `ValuationModel.type`
> (`:19932`) is an untyped string documented as *"Refer to Estimating/Valuation/Types for valid
> values"*, and the values actually appearing in Atlas's own worked examples are display strings:
> `Release Value`, `Declared Value`, `Full Value Free`, `Canada Released Long Haul`. The enum is
> an **internal category**; the code list is a **tariff-scoped display vocabulary**, and the two do
> not correspond one-to-one (`Canada Released Long Haul` has no enum member; `REPLACEMENT_VALUE`
> has no observed display string). **Modeling consequence:** a code list and a semantic category
> are different things, and a reference model that collapses them will lose the mapping. This is
> an argument for the ideal model carrying a *category* (stable, few, defined) alongside a
> *partner code* (volatile, many, tariff-scoped) rather than one `valuationType` string.

### 2.2 The field → code-list binding map — 32 declarations (NEW)

Round 1 noted in passing that `estimating-v2` properties *"routinely say 'Refer to
/Estimating/<X>/Types for valid values'"*. Extracted exhaustively, this is a **complete, citable
map of which field's vocabulary lives at which endpoint** — the single most useful artifact for
planning the capture, and it costs nothing to have. 32 declarations across 5 APIs:

| Field | Code list endpoint | Area |
| --- | --- | --- |
| `EstimateModel.bindingType` | `/Estimating/Binding/Types` | A1, A10 |
| `EstimateModel.accountType` | `/Estimating/Account/Types` | A1, A8 |
| `EstimateModel.tariffName` | `/Estimating/Tariffs` | A12 |
| `StopModel.type` | `/Estimating/Stop/Types` | **A3** |
| `ValuationModel.type` | `/Estimating/Valuation/Types` | **A11** |
| `PackingModel.type` | `/Estimating/Packing/Types` | A10 |
| `PackingModel.schedule` | `/Estimating/Packing/Schedules` | A10, A12 |
| `CratingModel.type` | `/Estimating/Crating/Types` | A10 |
| `BulkyModel.type` | `/Estimating/Bulky/Types` | A10 |
| `ContainerModel.type` | `/Estimating/Container/Types` | A2, A10 |
| `ApplianceModel.type` | `/Estimating/Appliance/Types` | A10 |
| `VehicleModel.type` | `/Estimating/Vehicle/Types` | A2 |
| `VehicleModel.weight` | `/Estimating/Vehicle/RateTypes` | A2, A12 |
| `AdvanceChargeModel.type` | `/Estimating/AdvanceCharge/Types` | A7 |
| `AuthorizationModel.type` | `/Estimating/Authorization/Types` | A7 |
| `AuthorizationModel.amountType` | `/Estimating/Authorization/AmountTypes` | A7 |
| `PhoneModel.type` (estimating) | `/Estimating/Phone/Types` | A8 |
| `ShipmentNoteModel.noteType` | `/Shipments/Notes/Types` | **A6** |
| `ShipmentDocument.type`, `AccountsPayableDocument.type`, `RiskMgtDocument.type` | `/Types` (i.e. `/Shipment/Documents/types`) | **A6** |
| `BusinessModel.businessLine` | `/Businesses/Lines` | A2 |
| `BusinessModel.status` | `/Businesses/Statuses` | **A1** |
| `BusinessModel.tariff` | `/Businesses/Tariffs` | A12 |
| `LocationModel.type` | `/Location/Types` | A3, A8 |
| `LocationModel.state` | `/Location/States` | A9 |
| `PhoneModel.type` (customers-v2) | `/Phones/Types` | A8 |
| `CubesheetModel.region`, `.businessLine` | `/Cubesheets/regions`, `/businessLines` | A10 |
| `CubesheetSettingsModel.language`, `.itemList`, `.ratingMode` | `/Cubesheets/settings/*` | A10 |

*(Counts by file: `estimating-v2.json` 17 declarations, `customers-v2.json` 6,
`cubesheets-v1.json` 5, `documents-v1.json` 3, `shipment-management-v1.json` 1 — reproducible by
extracting every property `description` matching "Refer to … for valid".)*

> **The negative result is the important one.** Run the same extraction over
> `atlasorder-v1.json` and `shipment-management-v1.json`'s *operational* schemas and it returns
> **nothing**. Not one of the 17 status axes round 1 tabulated — `ord_status`, `evt_eventcode`,
> `evt_status`, `stp_type`/`stp_type1`/`stp_reftype`, `stp_departure_status`, `SIT.status`,
> `SIT.reason`, `lgh_instatus`/`lgh_outstatus`, the 14 `<service>_cmpid_status` variants,
> `stp_reasonlate` — carries a code-list reference, and a grep for an event-code lookup path
> across all 24 documents returns none (only the field `evt_eventcode` / `eventCode` itself,
> `atlasorder-v1.json:445`, `shipment-management-v1.json:2985`).
>
> **This confirms round-1 Open Question 2 as a finding, not a question: the operational vocabulary
> is not published at all.** The code-list layer covers *estimating, customer master, cubesheets
> and documents*. It does not cover *order status, stop type, stop event, SIT status or service
> status*. **Even a complete, successful capture of all 47 reachable endpoints would not raise
> A4's semantic precision, and would raise A3's and A5's only partially** — which materially
> changes what the capture is worth and is the single most consequential thing in this supplement.

### 2.3 Observed values from Atlas's own worked examples — NEW

`estimating-v2` carries **47 named worked examples** on `POST /Estimating`, `POST
/Estimating/CreateOrder` and `POST /Estimating/Rate` (plus 17 on `POST /Estimating/Reports`) —
vendor-authored sample payloads spanning four tariffs: `ATVL1000TR` (Atlas US interstate),
`CA MAX4` (California intrastate) and two Canadian tariffs (`0087-02-01`, `0135-02-01`). Examples
begin at `estimating-v2.json:353`. These carry **real Atlas code values**, and are the only place
in the whole catalog where operational-style vocabulary appears literally.

Full harvest (62 fields, with the example names each value appears in) is committed at
[`captured/spec-derived-vocabulary/estimating-v2-vocabulary.json`](captured/spec-derived-vocabulary/estimating-v2-vocabulary.json).
The vocabulary that bears on v1 areas:

| Concept | Observed values | Area | Note |
| --- | --- | --- | --- |
| `bindingType` | `Binding`, `Non Binding`, `Not To Exceed` | **A1, A10** | The three-way binding basis, in Atlas's own words. Corroborated independently by `PricingMethodType.isNotToExceed` / `isLongTermContract` (`RadsSupport-v1.json`, not reachable). |
| `stops[].type` | `Origin`, `Destination`, `Origin Extra Stop`, `Destination Extra Stop`, `Origin Airport Stop`, `Destination Airport Stop` | **A3** | **Stop types are directional pairs** — every type is qualified by which end of the move it belongs to, rather than being a bare role. A real modeling idea, and one the ideal model should weigh. |
| `valuation.type` | `Release Value`, `Declared Value`, `Full Value Free`, `Canada Released Long Haul` | **A11** | Tariff-scoped display strings; see § 2.1 on the two-vocabulary problem. |
| `pricingOption` | `Bottom Line Discount`, `Binding COD`, `Free Valuation Bottom Line Discount` | A7, A12 | |
| `accountType` | `COD`, `COD_REFERRAL` | A1, A8 | |
| `packingService.type` | `FullPack`, `FullUnpack`, `CustomPack`, `CustomUnpack`, `ComparePack`, `CompareUnpack` | A10 | `Compare*` = the Canadian "lesser of two" packing basis (example *"Canada Lesser of Two Packing"*). |
| `accessorials.accessServices[].type` | `StairsInside`, `StairsOutside`, `Elevators`, `LongCarries` | A7, A10 | Matches the declared `AccessType` enum exactly — the one place enum and observed values agree. |
| `hourlyServices[].type` | `Labor`, `LaborWaiting`, `VanWaiting`, `Packing`, `Unpacking`, `Shuttle`, `Stairs`, `Elevators`, `LongCarries`, `RiggingHoistingLowering` | A7 | Subset of the declared `HourlyServiceType` enum. |
| `hourlyType` | `Regular`, `Overtime`, `DoubleTime` | A7, A13 | Subset of declared `HourlyType`. |
| `overtimeServices[].type` | `SatSunHoliday` | A7, A13 | Not in any declared enum. |
| `cratings[].type` | `Crating`, `Uncrating` | A7, A10 | |
| `advanceCharges[].type` | `Security Fees`, `Site Survey` | A7 | Third-party / advance-charge taxonomy. |
| `transportation.authority` | `Agent` | **A8** | The *authority under which the move runs* — agent authority vs (presumably) van-line authority. An A8 distinction with no code list published. |
| `bulkies[].type` | `Piano (any size)`, `Doll House`, `Go-Cart` | A10 | |
| `containers[].type` | `Lift Van`, `Sofa Box`, `Affinity Vault` | A2, A10 | |
| `businessCode` | `08 - Private Client (COD)` | A1, A8 | Code-and-label fused in one string. |
| `tariffName` | `ATVL1000TR`, `CA MAX4`, `0087-02-01`, `0135-02-01` | A12 | Tariffs are named by **mnemonic (US) or numeric code (Canada)** — two identifier conventions in one field. |

**Every list above is a sample, never a complete code list.** They are the lower bound of each
vocabulary: sufficient to establish that a distinction exists and what Atlas calls it, insufficient
to enumerate the domain. Treat as **grade B, observed** — the same standing the scope rule assigns
to the Weichert milestone rules derived from live API error responses.

#### The code lists are tariff-scoped and effective-dated (NEW, structural)

Eleven of the 47 reachable reference endpoints take a **required** qualifier:

- `tariffName` — `/Estimating/Bulky/Types`, `/Packing/Types`, `/DebrisRemoval/Types`,
  `/TaxExempt/Types`, `/Container/Types`, `/Reports/Definitions`, `/Referral/Programs`
- `tariffName` + `effectiveDate` — `/Estimating/Tariffs/PricingMethods`
- `tariffName` + `accountType` — `/Estimating/PricingOption/Types`
- `tariffName` + `postalCode` — `/Estimating/Waterhaul/Ports`
- `effectiveDate` — `/Estimating/AdvanceCharge/Types`
- `referralEntityCode` — `/Estimating/Referral/PricingMethods`

And the observed examples confirm the consequence empirically: the **same** carton concept is
spelled `1.5 cf` under `ATVL1000TR` and `1.5cu` under the Canadian tariff; `Flat Screen TV` under
one becomes `Flt Scrn TV < 46 in.` / `Flt Scrn TV 46 in. +` under another. Separately,
`RadsSupport` `Tariff.Valuation` carries `validFromDate` / `validToDate`.

> **Modeling consequence.** There is no such thing as "the Atlas code list". Atlas's vocabulary is
> a **function of (tariff, effective date)** — which is essentially what a tariff *is* — and it
> means a partner code is only interpretable together with the tariff and date it was issued
> under. For the ideal model this argues that a partner code reference is a **triple** (code,
> vocabulary scope, effective date), not a string. It also multiplies the capture cost: 47
> endpoints × the tariff count, against an unmeasured weekly quota (README §2 "Rate limits").

### 2.4 Fifteen reference endpoints return structured models

Correcting round 1's *"response schema `array<string>` with no values"*. Three of these models
carry real property descriptions and are therefore genuine **grade-B semantic** content:

- **`PricingMethodDescription`** (reachable, `estimating-v2`) — `bindingType`, `discountType`,
  `discountPercentage`, `remit`, `valuation`, `pricingId`, each described. It ties binding basis,
  discount basis, remit and valuation into **one named pricing method** — the closest thing Atlas
  publishes to a definition of how an estimate is priced.
- **`PricingMethodType`** (NOT reachable, `RadsSupport-v1/v2`) — `isLongTermContract`, `isItem`,
  `isStorageDiscount`, `isAccessorialDiscount`, `isApplyPeak`, **`isNotToExceed`**,
  **`meaningForClaim`**. A typed decomposition of what a pricing method *means*, including its
  meaning for claims. Relevant to A11/A12 and currently out of grant.
- **`FrequentAuthorizationModel`** (NOT reachable, `authorizations-v1`) — the only reference-data
  model with a full provenance set (`enteredBy`/`Date`, `updatedBy`/`Date`, `expiredBy`/`Date`,
  `isLocked`, `allowedActions`, `allowedDivisions`, `disallowedAgents`). **Reference data with
  effectivity, authorship and an access scope** — a C7/C8 idea worth adopting regardless of Atlas.

Others: `ItemTypeModel` (`itemTypeId`/`category`/`description` — a two-level claims item taxonomy),
`GetContainerTypesResponseModel` (container type **with dimensions and gross/net weight**, so
`/Container/Types` is a dimensional catalog rather than a code list), `TariffModel`
(`name`/`division`/`tariff`/`section`/`moveType`/`generateWarehouseCrossdock`), `ReportDefinition`,
`ReferralProgram`, `AuthorizationActionModel`, `AmountTypeModel`, `Tariff.Valuation` (rates with
`validFromDate`/`validToDate`), `AddressModel`.

**Spec defect worth recording:** `customers-v2 GET /Phones/Types` declares its 200 body as
`{"type": "string"}` — a bare scalar where every sibling lookup returns an array. Consistent with
README §2's warning that these specs drift from runtime behavior.

### 2.5 A5 corroboration from a second, independent rendering (NEW)

Round 1 built its A5 case entirely on `atlasorder-v1.json:13215`'s `SIT` object. `estimating-v2`
contains an **independent** rendering, `StorageInTransitModel` (`estimating-v2.json:19595`), hung
off `StopModel.storageInTransit` (`:19445`) — and the worked example *"ATVL1000TR Storage In
Transit"* (`estimating-v2.json:773`) shows **origin-side and destination-side SIT coexisting on
one order**, each with its own `startDate`, `dayCount` and warehouse ZIP.

Two structural claims are now corroborated across two specs rather than asserted from one:
**SIT hangs off a stop, not off the order**, and **storage-in-van is a flag on SIT rather than a
separate concept** (`isStorageInVan`). The estimating rendering also adds fields absent from round
1's vocabulary table: `storageRateSchedule`, `waiveScalingFee`, `waiveWarehouseHandling`,
`warehouseHandlingWeight`, `overrideWeight`, `fuelSurchargePercent`. A sibling `MiniStorageModel`
(`:17776`) keeps self-storage separate, as round 1 reported.

Note also that **SIT is not a stop type** in the estimating vocabulary — the observed
`/Estimating/Stop/Types` values contain no storage or warehouse member. Storage is modeled as a
*service at* an Origin or Destination stop, not as a *stop of its own*. That is a direct A5/A3
design question for the ideal model and it can be stated now, without the capture.

---

## 3. Score corrections

Applying the crosscheck's rule — **C1 (coverage) from field names is defensible; C2 (semantic
precision) from field names is not** — to every round-1 C2 ≥ 2, and re-checking each against the
evidence above.

| Area | C2 round 1 | C2 corrected | Reason |
| --- | --- | --- | --- |
| **A3** Trip, stop & assignment | 2 | **1** | Round 1's own justification was *"structurally explicit … but never stated in prose"* — that is structure, not definition. The five operational stop-type axes (`stp_type`, `stp_type1`, `stp_reftype`, `awg_stp_triptype`, `stp_transfer_type`) have **no code list and no description** anywhere in the catalog (§ 2.2). Partially offset: the *estimating* rendering has a real, observed six-value stop vocabulary (§ 2.3), but that is the estimate's stop model, not the trip/stop model A3 was scored on. |
| **A5** Storage-in-transit | 2 | **1** | Round 1 justified it as *"the distinctions that matter are encoded as separate fields even though undefined"* — self-describing field names are evidence a distinction **exists** (C1, C4), not evidence it is **defined** (C2). `SIT.status` and `SIT.reason` remain untyped with no lookup endpoint. Round-1 **C1=3 and C4=3 stand and are strengthened** by the independent `estimating-v2` rendering (§ 2.5). |
| **A9** Identity & cross-references | 2 | **1** | Justified by `ref_typedesc` and `xRefType` + `application`. `ref_typedesc` is a *field that would carry* a human description — the reference-type vocabulary itself is nowhere in the catalog. C6=3 and C8=3 stand: those rest on structure, which is legitimately what they measure. |
| **A7** Charges & billing hooks | 2 | **2 — stands** | The only C2 ≥ 2 that was never field-names-alone. It rests on a **declared** 218-value `ServiceName` enum (`estimating-v2.json:19198`) and on `IRatingLineItem` (`:16853`), every property of which carries a real description distinguishing gross vs net vs discount amount vs discount percentage. Verified this round. |
| A1, A2, A4, A6, A8 | 1 | **1 — unchanged** | Already at 1. |

**No C1, C3, C4, C5, C6, C7 or C8 score changes.** C1/C4 from field names are within the
crosscheck's own allowance; C3 was already 1–2 everywhere (round 1 correctly refused to score a
state machine that does not exist); C5 and C7 rest on the *presence and pairing* of distinct
temporal and actor fields, which is structural evidence and the right kind for those criteria.

**Net effect on phase 3.** Atlas's A5 nomination survives — but it is now explicitly a
**structural** nomination (C1=3, C4=3, C5=3, C6=3, C7=3, C2=1): Atlas tells us *what distinctions
a mature HHG system makes about storage-in-transit*, not *what its terms mean*. Any area file that
adopts Atlas for A5 must take the definitions from elsewhere or state them as our own. The A3
nomination weakens correspondingly. A4's disqualification (round-1 Open Question 12) is reinforced
and is now **permanent from this source**: § 2.2 shows the event vocabulary is not merely unfetched
but unpublished.

**S5 lines in `analysis.md` are withdrawn**, per the 2026-09-17 scope rule (`rubric.md` S5 note;
`README.md` § "What this model is — and is not"). They are retained in that file as raw material
for `mappings/` and must not be read as evidence.

---

## 4. The exact capture list

What to call when a key becomes available, and what remains out of grant either way. Grant per
`docs/atlas-world-group-api/README.md` §2 "Our measured grant" (measured 2026-08-20).

### 4.1 Reachable on the measured grant — 47 endpoints

| API base | Path | Required params | 200 schema | Summary |
| --- | --- | --- | --- | --- |
| `agents/v1` | `/Agents/ActivityStatuses` | — | `array<string>` | Get Agent Activity Statuses |
| `agents/v1` | `/Agents/ShipmentAuths` | — | `array<string>` | Get Agent Shipment Authorizations |
| `cubesheets/v1` | `/Cubesheets/businessLines` | — | `array<string>` | Gets all cubesheet business lines |
| `cubesheets/v1` | `/Cubesheets/regions` | — | `array<string>` | Gets all cubesheet regions |
| `cubesheets/v1` | `/Cubesheets/settings/itemLists` | — | `array<string>` | Gets all cubesheet setting item lists |
| `cubesheets/v1` | `/Cubesheets/settings/language` | — | `array<string>` | Gets all cubesheet setting languages |
| `cubesheets/v1` | `/Cubesheets/settings/ratingModes` | — | `array<string>` | Gets all cubesheet setting rating modes |
| `customers/v2` | `/Businesses/Lines` | — | `array<string>` | Get Business Lines |
| `customers/v2` | `/Businesses/Statuses` | — | `array<string>` | Get Business Statuses |
| `customers/v2` | `/Businesses/Tariffs` | — | `array<string>` | Get Business Tariffs |
| `customers/v2` | `/Location/States` | — | `array<string>` | Get Location States |
| `customers/v2` | `/Location/Types` | — | `array<string>` | Get Location Types |
| `customers/v2` | `/Phones/Types` | — | `{"type":"string"}` ⚠ | Get Phone Types (spec defect, § 2.4) |
| `documents/v1` | `/Shipment/Documents/types` | — | `array<string>` | Get Shipment Documents Types |
| `estimating/v2` | `/Estimating/Account/Types` | — | `array<string>` | Get Account Types |
| `estimating/v2` | `/Estimating/AdvanceCharge/Types` | `effectiveDate` | `array<string>` | Get Advance Charge Types |
| `estimating/v2` | `/Estimating/Appliance/Types` | — | `array<string>` | Get Appliance Types |
| `estimating/v2` | `/Estimating/Authorization/AmountTypes` | — | `array<string>` | Get Authorization Amount Types |
| `estimating/v2` | `/Estimating/Authorization/Types` | — | `array<string>` | Get Authorization Types |
| `estimating/v2` | `/Estimating/Binding/Types` | — | `array<string>` | **Get Binding Types (A1/A10)** |
| `estimating/v2` | `/Estimating/BridgeFerry/Types` | — | `array<string>` | Get Bridge Ferry Types |
| `estimating/v2` | `/Estimating/Bulky/Types` | `tariffName` | `array<string>` | Get Bulky Types |
| `estimating/v2` | `/Estimating/BusinessCodes` | — | `array<string>` | Get Business Codes |
| `estimating/v2` | `/Estimating/Container/Types` | `tariffName` | `array<GetContainerTypesResponseModel>` | Get Container Types |
| `estimating/v2` | `/Estimating/Crating/Types` | — | `array<string>` | Get Crating Types |
| `estimating/v2` | `/Estimating/DebrisRemoval/Types` | `tariffName` | `array<string>` | Get Debris Removal Types |
| `estimating/v2` | `/Estimating/HourlyServiceTypes` | — | `array<string>` | Get Hourly Service Types |
| `estimating/v2` | `/Estimating/HourlyTypes` | — | `array<string>` | Get Hourly Types |
| `estimating/v2` | `/Estimating/ImpliedServices` | — | `array<string>` | Get Implied Services |
| `estimating/v2` | `/Estimating/LeadSource/Types` | — | `array<string>` | Get Lead Source Types |
| `estimating/v2` | `/Estimating/Packing/Carton/Types` | — | `array<string>` | Get Packing Carton Types |
| `estimating/v2` | `/Estimating/Packing/Schedules` | — | `array<string>` | Get Packing Schedules |
| `estimating/v2` | `/Estimating/Packing/Types` | `tariffName` | `array<string>` | Get Packing Types |
| `estimating/v2` | `/Estimating/Phone/Types` | — | `array<string>` | Get Phone Types |
| `estimating/v2` | `/Estimating/PricingOption/Types` | `tariffName`, `accountType` | `array<string>` | Get Pricing Option Types |
| `estimating/v2` | `/Estimating/Referral/PricingMethods` | `referralEntityCode` | `array<PricingMethodDescription>` | Referral Program Pricing Methods |
| `estimating/v2` | `/Estimating/Referral/Programs` | `tariffName` | `array<ReferralProgram>` | Get Referral Programs |
| `estimating/v2` | `/Estimating/Reports/Definitions` | `tariffName` | `array<ReportDefinition>` | Get Report Definitions |
| `estimating/v2` | `/Estimating/Stop/Types` | — | `array<string>` | **Get Stop Types (A3)** |
| `estimating/v2` | `/Estimating/Tariffs` | — | `array<TariffModel>` | **Get Tariffs — the seed call** |
| `estimating/v2` | `/Estimating/Tariffs/PricingMethods` | `tariffName`, `effectiveDate` | `array<PricingMethodDescription>` | Get Pricing Methods |
| `estimating/v2` | `/Estimating/TaxExempt/Types` | `tariffName` | `array<string>` | Get Tax Exempt Types |
| `estimating/v2` | `/Estimating/Valuation/Types` | — | `array<string>` | **Get Valuation Types (A11)** |
| `estimating/v2` | `/Estimating/Vehicle/RateTypes` | — | `array<string>` | Get Vehicle Rate Types |
| `estimating/v2` | `/Estimating/Vehicle/Types` | — | `array<string>` | Get Vehicle Types |
| `estimating/v2` | `/Estimating/Waterhaul/Ports` | `tariffName`, `postalCode` | `array<AddressModel>` | Get Waterhaul Ports |
| `shipment-management/v1` | `/Shipments/Notes/Types` | — | `array<string>` | **Get Shipment Note Types (A6)** |

**Capture order.** `GET /Estimating/Tariffs` first — it enumerates the tariffs that the eleven
parameterised endpoints need, and `TariffModel` carries `division`, `section` and `moveType`, so it
also reveals how the tariff space is partitioned. Then the 36 unqualified endpoints (one call
each). Then the parameterised ones, per tariff, scoped deliberately against the unmeasured weekly
quota. Store each response **with the tariff and effective date it was issued under** (§ 2.3) — an
undated, untariffed capture of a tariff-scoped list is not reusable.

### 4.2 NOT reachable on the measured grant — 16 endpoints

These require a product-tier change (README §5 open question 7), not a fetch.

| API base | Path | 200 schema | Blocks |
| --- | --- | --- | --- |
| `claims/v1` | `/Item/Types` | `array<ItemTypeModel>` | A11 |
| `claims/v1` | `/Item/Categories` | `array<string>` | A11 |
| `claims/v1` | `/Item/DamageTypes` | `array<string>` | A11 |
| `claims/v1` | `/Item/Damage/Natures` | `array<string>` | A11 |
| `claims/v1` | `/Item/Damage/Locations` | `array<string>` | A11 |
| `claims/v1` | `/Item/Damage/Directions` | `array<string>` | A11 |
| `claims/v1` | `/Claims/ContactMethods` | `array<string>` | A11 |
| `authorizations/v1` | `/OrderAuthorizations/actions` | `array<AuthorizationActionModel>` | A7 |
| `authorizations/v1` | `/OrderAuthorizations/amountTypes` | `array<AmountTypeModel>` | A7 |
| `authorizations/v1` | `/OrderAuthorizations/frequentAuthorizations` | `array<FrequentAuthorizationModel>` | A7, C7/C8 |
| `RadsSupport/v1` and `/v2` | `/Pricing/MethodTypes` | `array<PricingMethodType>` | A11, A12 |
| `RadsSupport/v1` and `/v2` | `/Tariff/ValuationOptions` | `array<Valuation>` | A11, A12 |
| `holidays/v1` | `/Calendars/Names` | `array<string>` | A5 (SIT day counting) |
| `Yembo/v1` | `/Locations/Type` | `array<string>` | A10 |

---

## 5. Open questions — status after this supplement

| Round-1 OQ | Status |
| --- | --- |
| **1. What are the actual code lists?** | **Still open, and still blocked** — no key in the repo. Partially answered for `estimating-v2` by § 2.3 (observed samples) and § 2.2 (which field maps to which list). Restated correctly: **47** reachable endpoints, not 5; **63** total, not ~35; 11 of the reachable ones are tariff-scoped. |
| **2. What is the stop event vocabulary (`evt_eventcode`)?** | **Answered — it is not published.** No lookup endpoint exists in any of the 24 documents and no operational property carries a code-list reference (§ 2.2). Recoverable only from a real shipment payload or an Atlas-supplied document. A4 cannot be sourced from this catalog. |
| **3–10** | Unchanged — each needs a live call, a real order number, or an Atlas answer. |
| **11 (the S5 question)** | **Withdrawn** per the 2026-09-17 scope rule. Belongs to `mappings/`. |
| **12 (phase 3 guidance)** | **Revised.** A5 nomination survives as a *structural* nomination only (C2 corrected to 1); A3 weakens (C2 corrected to 1); A4 disqualification is now permanent from this source, not pending a fetch. |

### New questions this supplement raises

1. **Is `ValuationCategory` the stable internal category behind the tariff-scoped display strings,
   and is the mapping published anywhere?** If yes, Atlas has solved the code-vs-category problem
   and the ideal model should copy the shape. If no, it is an unmanaged two-vocabulary drift and
   the model should avoid it. Affects **A11** directly. (§ 2.1)
2. **Is the `stops[].type` directional pairing exhaustive?** Six values observed, across Origin and
   Destination × {plain, Extra Stop, Airport Stop}. Does `/Estimating/Stop/Types` return only
   directional pairs, or also non-directional types (warehouse, SIT, transfer)? Decides whether
   "stop type" in the ideal model is one dimension or two. **A3.** (§ 2.3, § 2.5)
3. **What is `transportation.authority`?** Observed value `Agent`; described only as *"The
   authority of the shipment."* If this is agent-authority vs van-line-authority, it is an **A8**
   concept with no code list and no counterpart in any other source read so far.
4. **Should the ideal model treat a partner code as a triple (code, vocabulary scope, effective
   date)?** Atlas's code lists are a function of tariff and date (§ 2.3), and `Tariff.Valuation`
   carries `validFromDate`/`validToDate`. Worth putting to the other vendor sources in phase 3
   before the core model fixes an identifier shape. **A9, C8.**
5. **Registry gap:** `registry.yaml:204` lists Atlas's areas as `[A1, A2, A3, A4, A6, A7, A8, A9,
   A10, A11, A12]` — **A5 is missing**, yet round 1 calls A5 "the standout area" and nominates
   Atlas as its best source for it. A registry correction, not a research question.
