---
source: src:smartmoving-api
analyzed: 2026-09-17
evidence_grade: A
material: |
  Read in full, retrieved 2026-09-17 from the vendor's own Azure API Management
  developer portal data API at
  https://smartmoving-prod-api-management.developer.azure-api.net/developer/...?api-version=2022-04-01-preview
  (no key, no login - the portal serves its API definition anonymously):
  - sources/smartmoving-api/local/apim-apis.json (the API version set; sha256
    51d69876f95a9a00ae017e02aee0cc52ff58e89be424e3ed5ccc62bd9348ce9f)
  - sources/smartmoving-api/local/apim-operations.json - all **68** operations with
    method + urlTemplate (sha256 e109f9cd27c8ae8ccc1297db1a7edb702bffd202705db3984635c0a5b7c02238)
  - sources/smartmoving-api/local/apim-operation-details.json - the per-operation
    detail for all 68 (display name, description, path/query parameters with their
    descriptions, request and response representations; sha256
    35b79df06a72b6ef0d35895d80e910541c9fcfe1613f0ec406eae905461d81d5)
  - sources/smartmoving-api/local/apim-schemas.json - the API's **complete OpenAPI
    `components.schemas` document, 428 schemas**, including every enum with its
    `x-enumNames` and integer-to-name description (sha256
    9d6254ca006dd582af74ac554638b02d3364497e2859719e87cdbe05965861fb)
  NOT read: SmartMoving's narrative help centre / customer documentation; any live
  response body (the API requires a `x-api-key` subscription, which we do not hold -
  `apim-apis.json` `subscriptionRequired: true`); webhooks, if any (none are
  described in the portal); the `/api/premium/...` gating rules (the path prefix is
  the only evidence that "premium" is a separate entitlement). The portal's
  `?export=true&format=openapi+json` returns an **empty `paths` object**, so the
  path-to-schema binding below is reconstructed from the operations + schemas
  documents, not from a single assembled spec.
---

# SmartMoving External API - analysis

## What it is

The public REST API of **SmartMoving**, a SaaS operations platform for
**residential / local moving companies** (leads to sales to jobs to crew to
billing). **S1 kind:** `vendor-api`. **S2 adoption: 2** - widely used in the US
residential mover market and actively developed (the API carries a `public-api`
version set at `v1`, `apim-apis.json`), but it is one vendor's product surface,
not an industry artifact, and it has no presence in the interstate van-line
world. **S3 openness:** `public` - the definition is served without
authentication from the APIM developer portal; *calling* it needs a subscription
key tied to a paid plan (`subscriptionKeyParameterNames: {header: "x-api-key",
query: "api-key"}`, `apim-apis.json`). License unstated, so the captured copies
live in `local/`.

**Our reading covered the machine-readable definition in full** - 68 operations
and 428 schemas, every enum with its symbolic names. That is unusually strong
evidence for a vendor API: the enums carry `x-enumNames` *and* a human
description mapping each integer to a name, e.g. `OpportunityStatus` ->
`"0 = NewLead, 1 = LeadInProgress, 3 = Opportunity, 4 = Booked, 10 = Completed,
11 = Closed, 20 = Cancelled, 30 = Lost, 50 = BadLead"`
(`apim-schemas.json`, `components.schemas.OpportunityStatus`). **What we could
not see** is everything outside the contract: no prose defining what *Booked* or
*Closed* mean, no transition rules, no worked examples, no live payloads, and no
event/webhook surface at all. Hence grade **A for vocabulary and structure, but
the source itself is silent on lifecycle rules** - that silence is a finding, not
a gap in our reading.

> The task brief said "66 operations visible"; the portal returned **68** on
> 2026-09-17. Both counts include `GET /api/ping`.

## Model summary

The spine is four entities, in the source's own words:

```
Customer --< Opportunity --< Job --< JobStop       (order 1..n, isOrigin/isDestination)
             (quoteNumber)    (jobNumber, jobDate)
                 |              |- estimatedCharges[] / actualCharges[]
                 |              |- estimatedMaterials[] / actualMaterials[]
                 |              |- crewMembers[]      (uuid only)
                 |              |- jobTime { laborTime{est,act}, travelTime{est,act}, billableHours }
                 |              |- notes { crew, customer, internal, crewFeedback, accounting, dispatcher }
                 |              \- jobDocuments[]
                 |- tripInfo   (long-haul pickup/delivery *spreads* - see below)
                 |- inventory  (rooms --< items, boxes)
                 |- surveys[]  (CalendarEntryViewModel)
                 |- payments[] / opportunityDocuments[] / opportunityFiles[] / photos[]
                 |- tasks[] / followUps[] / audit-activity
                 \- tariff, branch, estimator, salesAssignee, moveCoordinator, affiliate

Customer --< StorageAccount (accountNumber, status, storageType SIT|Permanent, jobId)
```

Four structural choices are worth naming up front, because they are exactly where
this product's model diverges from a van-line model:

1. **The deal, not the shipment, is the aggregate root.** `Opportunity` is a
   CRM/quote object carrying `quoteNumber`, `status`, `volume`, `weight`,
   `estimatedTotal`, `salesAssignee`, `referralSource`, `affiliateId` and UTM
   tracking (`NewLeadModel` carries `utmSource`/`utmMedium`/`utmCampaign`/
   `utmKeyword`). There is **no shipment entity**: what moves is implied by the
   opportunity's `volume`/`weight` and by the inventory attached to the
   opportunity, not to a job.
2. **A `Job` is a day of service, not a leg of transport.** It has a `type`
   (`JobType`), a `jobDate`, an `arrivalWindow`, a crew, and its own charges. A
   pack day and a load day are two jobs on one opportunity; an SIT in and an SIT
   out are `JobType.StorageInBound` and `JobType.StorageOutBound` - two jobs, not
   two ends of one shipment.
3. **A `JobStop` is an address with access attributes, not a transport event.**
   It carries `order`, `isOrigin`, `isDestination`, `propertyType`, `stairs`,
   `hasElevator`, `parkingDescription` - and **no status, no arrival, no
   departure** (`JobStopViewModel`). There is no vehicle anywhere in the API.
4. **"Trip" means *date spread*, not journey.** `OpportunityTripInfoViewModel` is
   `pickupSpreadFirstAvailableDate` / `pickupSpreadLastAvailableDate` /
   `confirmedPickupDate` / `preferredPickupTime` and the same four for delivery -
   the long-haul *promise window*, gated by `hasTripInfo` / `isTripInfoApplied`.

## Vocabulary

All cites are to `local/apim-schemas.json` (`components.schemas.<Name>`) unless a
path is given; operation cites are to `local/apim-operation-details.json` by
operation id.

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Lead** | A prospect before qualification. `LeadViewModel` carries `status: OpportunityStatus` - i.e. **lead and opportunity share one status enum**; the lead *is* the early opportunity. | A1 | `LeadViewModel`; `OpportunityStatus` |
| **Opportunity** | The deal / quote. Root of everything. `quoteNumber` (int32) is the human handle. | A1, A2 | `OpportunityDetailsViewModel` |
| **OpportunityType** | `Local . Intrastate . Interstate` - the regulatory class of the move. | A2 | `OpportunityType` |
| **OpportunityStatus** | `NewLead(0) . LeadInProgress(1) . Opportunity(3) . Booked(4) . Completed(10) . Closed(11) . Cancelled(20) . Lost(30) . BadLead(50)` | A1 | `OpportunityStatus` |
| **leadStatus** | A *second*, free-string status on the same object, alongside the typed `status`. Undefined. | A1 | `OpportunityDetailsViewModel.leadStatus` (`string, nullable`) |
| **Job** / **jobNumber** | One dated unit of service on an opportunity. | A2 | `JobViewModel`, `OpportunityJobViewModel` |
| **JobType** (a.k.a. *service type*) | `Moving . Packing . MovingAndPacking . LoadOnly . UnloadOnly . Commercial . StorageInBound . StorageOutBound . InnerHouse . JunkRemoval . LaborOnly` + `Custom01...Custom50` | A2, A5 | `JobType`; also `ServiceTypeViewModel.id: JobType` |
| **ServiceType** | The tenant-configured presentation of a `JobType`, with `hasActivityLoading`, `hasActivityFinishedLoading`, `hasActivityUnloading` - i.e. **which crew-app activities this service type emits** - plus `scalingFactorPercentage`. | A4 | `ServiceTypeViewModel`; op `get-api-service-types` |
| **JobStop** | Ordered address on a job: `order`, `isOrigin`, `isDestination`, `propertyType`, `stairs`, `hasElevator`, `parkingDescription`. | A3 | `JobStopViewModel` |
| **StopType** | `PickUp(0) . DropOff(1)` - **write-only**: present on `UpdateJobStopForm`, absent from `JobStopViewModel`. | A3 | `StopType`; `UpdateJobStopForm.stopType [required]` vs `JobStopViewModel` |
| **ArrivalWindow** | A named company-wide window (`description`, `startTime`, `endTime` as fractional hours, `isDefault`), attached to a job. | A3, A5 | `ArrivalWindowViewModel`; op `get-api-arrival-windows` |
| **tripInfo** | Long-haul date **spread**: `pickupSpreadFirstAvailableDate` / `...LastAvailableDate` / `confirmedPickupDate` / `preferredPickupTime` / `preferredPickupTimeDurationMinutes`, and the delivery quartet. | A3, A5 | `OpportunityTripInfoViewModel` |
| **MoveSize** | Catalog entry (`name`, `description`, `volume` cu ft) used to seed `volume`/`weight`. | A2, A10 | `MoveSizeViewModel` |
| **VolumeWeightCalculationMode** | `MoveSize(0) . Inventory(1) . Manual(2)` - **states where the shipment's volume/weight came from.** | A2, A10 | `VolumeWeightCalculationMode` |
| **densityFactor** | lb per cu ft used to derive weight from inventory volume. | A2, A10 | `OpportunityInventoryViewModel.densityFactor` |
| **Survey** / **CalendarEntryType** | `OnSiteEstimate(0) . BoxDelivery(1) . VirtualSurvey(2) . PhoneSurvey(3) . OtherEvent(4) . LiveSwitchSurvey(5)` - a survey is a *calendar entry* assigned to an estimator, with `isConfirmed`. | A10 | `CalendarEntryType`, `SurveyViewModel`, `CalendarEntryViewModel` |
| **isBinding** | Write-only flag on the opportunity. The only estimate-type concept in the API - no not-to-exceed, no guaranteed-price. | A10 | `UpdateOpportunityForm.isBinding` (absent from `OpportunityDetailsViewModel`) |
| **InventoryItemType** | `Furniture(0) . Box(1) . CarrierPack(2) . PackByOwner(3)` - CP/PBO, the HHG packing-responsibility distinction. | A10 | `InventoryItemType` |
| **Room / shortCode** | Inventory is `rooms[] --< items[]`; each item has a numeric `shortCode` and optional `imageUrls`. | A10 | `OpportunityInventoryRoomViewModel`, `OpportunityInventoryItemViewModel` |
| **StorageAccount** | A *billing* object per customer: `accountNumber`, `status`, `jobId`, `storageType`, `storageBillingPreOrPostPay`, `storageValuationMethod`, `nextInvoiceAt`, `discounts[]`, `warehouseName`, `warehouseSalesTaxRate`. | A5, A7 | `CustomerStorageAccountViewModel` |
| **StorageType** | `SIT(0) . Permanent(1)` - **the permanent-storage boundary is a first-class enum.** | A5 | `StorageType` |
| **StorageAccountStatus** | `Creating(1) . Active(5) . Closed(11)` | A5 | `StorageAccountStatus` |
| **StorageValuationMethod** | `ByCWT(0) . ByFlatRate(1) . ByCubicFoot(2)` | A5, A11 | `StorageValuationMethod` |
| **JobChargeCategory** | `MovingLabor . Transportation . Packing . AdditionalServices . TripAndTravel . FuelSurcharge . Valuation . BulkyItem . Storage . ShuttleFees . StorageInTransit . Insurance . CrewSkills` | A7 | `JobChargeCategory` |
| **ChargeType** | 27 values: `PerMile . FlatFee . PerItem . Percentage . MileageTable . FlatFeeTwoFactor . DriveTime . Rollup . PerItemCwt . DistanceRateFee . MovingHourlyLabor . ... . ZoneRated . Valuation . BulkyItem . PrepaidStorage . WarehouseHandling . CrewSkillHourly . ...` | A12 | `ChargeType` |
| **EstimatedJobCharge / ActualJobCharge** | Two parallel collections on a job; **`ActualJobChargeViewModel.estimatedJobChargeId` points back at the estimate line it realises.** | A7 | `ActualJobChargeViewModel` |
| **DocumentType** | `PrintOnly . Contract . Addendum . Estimate . Invoice . WorkOrder . DescriptiveInventory . CarrierInvoice . TripPlanning . WarehouseRelease . CardAuthorizationAgreement . PaymentAuthorizationTerms` | A6 | `DocumentType` |
| **FileCategory** | `Documents . Customer . Survey . PreMove . PostMove . Claims . DescriptiveInventory` - the **phase** a file belongs to. | A6 | `FileCategory` |
| **AuditActivityType** | `Created . Edited . Deleted . MissingDuringCheck . FoundDuringCheck` | A6, A7, A10 | `AuditActivityType` |
| **SmApplications** | `OfficeWebApp . CrewApp . PreMoveSurveyApp . DescriptiveInventoryApp . CustomerPortal . ExternalApi` - **which client asserted a fact.** | A6 (provenance) | `SmApplications`; `OpportunityInventoryViewModel.lastModifiedFromApplication` |
| **Branch** | The operating location (`name`, `phoneNumber`, dispatch location per op description). | A8 | `BranchViewModel`; op `get-api-branches` |
| **Affiliate / ReferralSource** | Lead-origin parties. `ReferralSourceViewModel.isLeadProvider` marks a paid lead vendor. | A8 | `AffiliateViewModel`, `ReferralSourceViewModel` |
| **estimator / salesAssignee / moveCoordinator** | Three named internal roles on an opportunity. | A8 | `OpportunityDetailsViewModel` |
| **CrewMember** | `role`, `branch`, `status`, and a `compensation` block of per-category percentages. | A8, A13 | `CrewMemberViewModel`, `CrewMemberCompensationViewModel` |
| **CustomerServiceTicket** | `type: Claim . Review . Other`, `status`, `priority`, optional `jobId`. The whole of claims. | A11 | `CustomerServiceTicketViewModel`, `CustomerServiceTicketType` |
| **Tariff** | Named rate book, `appliesToOpportunityTypes[]`, `appliesToBranches[]`, with `materials` under it. | A12 | `TariffListViewModel`; op `get-api-premium-tariffs-tariffid-materials` |

## Lifecycles & events

**Opportunity / lead - one enum, no transitions published.**
`OpportunityStatus` is a single ladder shared by leads and opportunities
(`LeadViewModel.status` and `OpportunityDetailsViewModel.status` are the same
type). The **numbering is the only hint of structure**: `0,1,3` pre-sale, `4`
booked, `10,11` done, `20,30,50` terminal-negative. Nothing in the definition
says which transitions are legal, who may cause them, or what distinguishes
`Completed(10)` from `Closed(11)`. There is **no status-setting operation**:
status changes are side effects of `PUT /api/premium/lead/{id}/convert`
(op `put-api-premium-lead-id-convert`, "Convert lead to opportunity") and of work
done in the UI.

Terminal states are the only ones with **reason vocabularies**, and each is a
tenant-configured catalog rather than a fixed code list:

- `GET /api/cancellation-reasons` -> "all of your company's job cancellation
  reasons" (`get-api-cancellation-reasons`); surfaced back as
  `OpportunityDetailsViewModel.cancellationReason` (a **string**, not an id).
- `GET /api/lost-reasons` -> "lost lead/opportunity reasons"
  (`get-api-lost-reasons`), surfaced as `LeadViewModel.lostReason`.
- `GET /api/bad-lead-reasons` (`get-api-bad-lead-reasons`), surfaced as
  `LeadViewModel.badLeadReason`.

**Job - five timestamps and one command.** `BasicJobViewModel` / `JobViewModel`
carry `startTimeUtc`, `endTimeUtc`, `completedAtUtc`, `confirmedAtUtc`,
`closedAtUtc`, plus a boolean `confirmed` on `OpportunityJobViewModel`. The only
lifecycle *operation* is
`POST /api/premium/opportunities/{opportunityId}/jobs/{jobId}/confirm`
("Confirm a job by jobId and category (optional)",
`post-api-premium-opportunities-opportunityid-jobs-jobid-confirm`, with an
undocumented `category` query parameter). Everything else - started, completed,
closed - is a timestamp that appears, with no command, no actor and no reason.
**Jobs are deleted, not cancelled**
(`DELETE /api/premium/opportunities/{opportunityId}/jobs/{jobId}`, "Remove job
from opportunity").

**Execution events: effectively absent.** The nearest thing to an execution
vocabulary in the whole API is three booleans on the *service-type catalog* -
`ServiceTypeViewModel.hasActivityLoading`, `hasActivityFinishedLoading`,
`hasActivityUnloading` - which say which crew-app activities a service type
raises. The activities themselves are not readable: there is no activity
resource, no stop status, no arrival/departure, no exception, no delay reason, no
ETA and no position. `JobTimeInfoViewModel` is the only quantified execution
signal - `laborTime {estimated, actual}` and `travelTime {estimated, actual}` in
minutes, plus `billableHours`.

**Storage account.** `Creating(1) -> Active(5) -> Closed(11)`
(`StorageAccountStatus`). No transition rules; no move-in / move-out dates on the
account itself. The physical SIT movements are jobs (`StorageInBound` /
`StorageOutBound`), and the release paperwork is `DocumentType.WarehouseRelease`.

**Inventory review.** A genuine small workflow:
`POST /api/premium/opportunities/{opportunityId}/inventory/submit` - "Initiate an
inventory review request ... mirroring the functionality of the 'Submit
Inventory' button in the Customer Portal. Submissions can be resolved from the
opportunity's Sales tab" (`post-api-premium-opportunities-opportunityid-inventory-submit`).
Its counterpart state is `OpportunityInventoryViewModel.lockStatus` and
`OpportunityDetailsViewModel.allowInventoryUpdates`.

**Follow-ups and tasks** are the only objects with an explicit completion command:
`POST .../followups/{followupId}/mark-complete`; `TaskItemStatus` is
`NotStarted . InProgress . Completed`. `FollowUpType` = `Email . Call . Text .
Other . CMET`; logged calls carry `CallType` (`Outbound`/`Inbound`) and
`CallOutcome` (`NoAnswer . Busy . WrongNumber . LeftLiveMessage . LeftVoicemail .
Connected . NumberDisconnected`).

**There is no event/webhook surface.** All 68 operations are request/response;
nothing in the portal describes a push channel. A consumer keeps in step by
polling date-ranged lists (`GET /api/leads?From=&To=`,
`GET /api/customers?FromServiceDate=&ToServiceDate=`,
`GET /api/crew-members/{id}/jobs?From=&To=`, `GET /api/premium/surveys?From=&To=`).

## Time, identity, evidence

**Time.** Three different representations coexist, deliberately:

- **`int32` yyyyMMdd** for operational dates: `serviceDate`, `jobDate`,
  `dropOffDate`, every `From`/`To` filter ("Format: yyyyMMdd, eg. 20240831",
  `get-api-leads` query-parameter description). A date-only business day, with no
  time zone - correct for "the job is on the 31st", and unambiguous in a way an
  ISO instant would not be.
- **`string/date-time` suffixed `Utc`** for record facts: `createdAtUtc`,
  `completedAtUtc`, `confirmedAtUtc`, `closedAtUtc`, `paidAtUtc`, `startAtUtc`.
  The suffix is in the field name, so the zone is part of the contract.
- **fractional-hour `double`** for times-of-day: `ArrivalWindowViewModel.startTime`
  / `endTime`, `OpportunityTripInfoViewModel.preferredPickupTime` - paired with a
  `...DurationMinutes` rather than an end instant.

**Planned vs estimated vs actual** exists in two places and only two:
`jobTime.laborTime{estimated,actual}` / `jobTime.travelTime{estimated,actual}`,
and `estimatedCharges[]` / `actualCharges[]` / `estimatedMaterials[]` /
`actualMaterials[]`. The **spread** idea - an offered window narrowing to a
confirmed date - is expressed once, in `tripInfo`
(`pickupSpreadFirstAvailableDate` / `pickupSpreadLastAvailableDate` /
`confirmedPickupDate`). **No time zone is ever attached to a stop.**

**Identity.** Everything internal is a `uuid`. The human-facing handles are
`Opportunity.quoteNumber` (int32), `Job.jobNumber` (string),
`StorageAccount.accountNumber` (string) and inventory `shortCode` (int32); there
is a lookup by quote number (`GET /api/opportunities/quote/{quoteNumber}`).
**Cross-party references barely exist**: `customField01/02/03` on the opportunity
(also writable on create and update) is the designated foreign-key parking space;
`gatewayPaymentId` is the only typed external id in the model; `affiliateId` and
`referralSourceId` name lead vendors. There is **no carrier, van line, SCAC, BOL,
registration or service-order number anywhere** - the only hint that a
third-party carrier exists at all is `DocumentType.CarrierInvoice`.

**Evidence and provenance.** Better than the rest of the model:

- `GET /api/opportunities/{opportunityId}/audit-activity` returns
  `OpportunityAuditActivityEntryViewModel { activityType, description,
  changeMadeByUserId, createdAtUtc }` with `AuditActivityType = Created . Edited .
  Deleted . MissingDuringCheck . FoundDuringCheck`. The last two are **inventory
  check-off outcomes recorded as audit facts** - an item that could not be found
  at delivery, or turned up, is an audit entry, not a claim.
- `SmApplications` (`OfficeWebApp . CrewApp . PreMoveSurveyApp .
  DescriptiveInventoryApp . CustomerPortal . ExternalApi`) records **which client
  asserted a fact**, exposed as
  `OpportunityInventoryViewModel.lastModifiedFromApplication`. `PaymentSource`
  (`MobileApp . WebApp . CustomerPortal . ExternalApi`) does the same for money.
- **Corrections are modelled only for money and only as new records**:
  `OpportunityPaymentViewModel.refundsJobPaymentId` / `isRefund` /
  `amountRefunded`, and `StorageAccountPaymentViewModel.refundsPaymentId`. A
  refund points at the payment it reverses; nothing else in the API can be
  reversed, superseded or corrected - an edit overwrites and leaves an audit line.
- `DocumentSummaryViewModel.isComplete` is the only document state (signed / not),
  and documents attach to an **entity** (opportunity or job), never to an event or
  a fact.

## Scores

Weights are set per area in phase 3; these are the raw 0-3 criterion scores.
Every cite is to `local/apim-schemas.json` (`components.schemas.*`) or
`local/apim-operation-details.json` (by operation id), as spelled in the
Vocabulary and Lifecycles sections above.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 2 | 1 | 1 | 2 | 2 | 1 | 2 | 2 | 9 named states covering lead-booked-completed/cancelled/lost/bad, with **three tenant-configured reason catalogs** for the negative terminals (`get-api-cancellation-reasons`, `get-api-lost-reasons`, `get-api-bad-lead-reasons`) => C1=2. C2=1: names only, no definitions - `Completed(10)` vs `Closed(11)` is undefined, and a second untyped `leadStatus` string sits beside the typed one. C3=1: states are explicit, **no transition is published and no operation sets status**; the one lifecycle command is job `confirm`. C5=2 for the `int32` yyyyMMdd service date + the `tripInfo` spread-to-confirmed pattern. C7=2 for `audit-activity` + `SmApplications`. C8=2: `customField01-03`, `Custom01-50` job types, `/api/premium` split. |
| A2 Shipment structure | 2 | 2 | 1 | 3 | 1 | 1 | 2 | 3 | C4=3: `JobType` is the residential mover's own service list (`Moving`, `Packing`, `LoadOnly`, `UnloadOnly`, `InnerHouse`, `StorageInBound/OutBound`, `JunkRemoval`, `LaborOnly`), `OpportunityType` is `Local/Intrastate/Interstate`, volume is cu ft and weight lb. C2=2 chiefly for **`VolumeWeightCalculationMode` (`MoveSize . Inventory . Manual`)** - the model states *how* the shipment quantity was derived, and `densityFactor` says how volume became weight. C1=2 and not 3 because **there is no shipment entity** (no shipment id, no services-ordered list, no vehicle/PPM/storage shipment types - storage is a *job type*). C8=3 for `Custom01...Custom50`. |
| A3 Trip, stop & assignment | 1 | 1 | 0 | 2 | 2 | 1 | 1 | 1 | C1=1: ordered stops exist (`JobStopViewModel.order`, `isOrigin`, `isDestination`; `PUT .../jobs/{jobId}/stops` replaces the whole list) and crew is assigned (`crewMembers[]` - bare uuids, no role-on-this-job). **There is no vehicle, no trip, no leg, no consolidation** anywhere in 428 schemas. C3=0: a stop has **no status and no arrival/departure field at all**. C4=2: `propertyType` (incl. `HighRise`, `AssistedLiving`, `Storage`, `Warehouse`), `stairs`, `hasElevator`, `parkingDescription` are exactly the HHG access attributes. C5=2 for `tripInfo` spreads + `ArrivalWindowViewModel`. Note the asymmetry: **`StopType` (`PickUp`/`DropOff`) is required on write and never returned on read** (`UpdateJobStopForm` vs `JobStopViewModel`). |
| A4 Execution events & tracking | 1 | 1 | 1 | 2 | 2 | 1 | 1 | 1 | C1=1: five job timestamps (`startTimeUtc`, `endTimeUtc`, `completedAtUtc`, `confirmedAtUtc`, `closedAtUtc`) and nothing else - no arrive/depart, no pack/load/unload/deliver resource, no ETA, no exception, no delay reason, no telemetry, **no webhook**. C4=2 solely for `ServiceTypeViewModel.hasActivityLoading / hasActivityFinishedLoading / hasActivityUnloading`, which names the crew-app's HHG activity set (and distinguishes *loading* from *finished loading*) even though the activities are not readable. C5=2 for `laborTime`/`travelTime` `{estimated, actual}` in minutes - a real planned-vs-actual pair. C7=1: `audit-activity` records who edited, not who observed. |
| A5 Storage-in-transit | 3 | 2 | 2 | 3 | 1 | 2 | 1 | 1 | The strongest area. C1=3 and C4=3: **`StorageType = SIT . Permanent`** makes the permanent-storage boundary a typed distinction; `JobType.StorageInBound`/`StorageOutBound` are the in and out movements; `JobChargeCategory` separates `Storage` from `StorageInTransit` and adds `ShuttleFees`; `ChargeType` has `PrepaidStorage` and `WarehouseHandling`; `DocumentType.WarehouseRelease` is the release paperwork; `PaymentType.StorageCredit` closes the loop. C2=2: the storage *account* is a first-class object (`accountNumber`, `storageBillingPreOrPostPay = PrePay/PostPay`, `storageValuationMethod = ByCWT/ByFlatRate/ByCubicFoot`, `warehouseName`, `warehouseSalesTaxRate`, `discounts[]`) rather than a flag on a job. C3=2 for `Creating->Active->Closed`. C5=1: **the account has no in or out date** - only `nextInvoiceAt`; duration is implied by the two jobs. C6=2 for `accountNumber` + `jobId` linkage. |
| A6 Documents & evidence | 2 | 2 | 1 | 3 | 1 | 1 | 2 | 1 | C4=3: `DescriptiveInventory`, `WarehouseRelease`, `TripPlanning`, `CarrierInvoice`, `Addendum` are HHG paperwork, not generic attachments. C2=2 because **`FileCategory` orthogonally types a file by phase** (`Survey . PreMove . PostMove . Claims . DescriptiveInventory`) while `DocumentType` types it by instrument - two independent axes, which is the right shape. C3=1: `isComplete` is the only state. C7=2 for `lastModifiedFromApplication` + `audit-activity` incl. `MissingDuringCheck`/`FoundDuringCheck`. Traps: documents attach to an entity, **never to an event**, and `OpportunityAttachmentViewModel` takes `base64Contents` inline. |
| A7 Charges & billing hooks | 3 | 2 | 1 | 3 | 1 | 2 | 3 | 2 | C1=3, C4=3: 13 `JobChargeCategory` values give the linehaul/accessorial split in mover's terms (`Transportation` vs `TripAndTravel`, `FuelSurcharge`, `ShuttleFees`, `Valuation`, `BulkyItem`, `StorageInTransit`, `CrewSkills`), and `ChargeType` carries the *rating method* (`PerItemCwt`, `MileageTable`, `ZoneRated`, `DistanceRate`, `PackingByCuFt`...). **C7=3 - the best provenance in the source**: `ActualJobChargeViewModel.estimatedJobChargeId` links each realised charge to the estimate line it came from, and every payment that reverses another names it (`refundsJobPaymentId`, `isRefund`, `amountRefunded`) with `PaymentSource` and `takenByUserId`. C3=1: no invoice lifecycle - only `isOutstanding` / `paidAtUtc`; `PaymentCategory = Deposit . BalanceDue . Other`. |
| A8 Parties & roles | 1 | 1 | 1 | 1 | n/a | 1 | 1 | 1 | Customer (+`contacts[]`, `secondaryPhoneNumbers[]`), Branch, CrewMember (+role, branch, compensation), office User (+role), Affiliate, ReferralSource (`isLeadProvider`), and three named internal roles on the opportunity (`estimator`, `salesAssignee`, `moveCoordinator`). **C4=1: not one inter-company role exists** - no van line, no booking/origin/hauling/destination agent, no carrier, no account/RMC, no shipper-vs-transferee distinction (the customer is the payer and the transferee at once), and the warehouse is a *string* on the storage account (`warehouseName`). C3=1 for `CrewMemberStatus = Active/Inactive`. |
| A9 Identity & cross-references | 1 | 1 | n/a | 1 | n/a | 1 | 1 | 2 | One uuid per aggregate plus three human numbers (`quoteNumber`, `jobNumber`, `accountNumber`) and a lookup by quote number (`get-api-opportunities-quote-quotenumber`). C6=1: **no typed external reference exists** - correlation to another party's system is expected to go in `customField01/02/03`; `gatewayPaymentId` is the single typed foreign id. C8=2 because the custom fields and `Custom01-50` enum slots *are* the declared extension mechanism. |
| A10 Survey, estimating & inventory | 3 | 2 | 2 | 3 | 2 | 1 | 2 | 2 | Context-map area, scored because it is this source's second-strongest. C1=3/C4=3: survey subtypes (`OnSiteEstimate . VirtualSurvey . PhoneSurvey . LiveSwitchSurvey . BoxDelivery`), assignment to an estimator with notify-customer / notify-sales flags, room-to-item inventory with `shortCode`, per-item `volume`/`weight`/`overrideDefaultWeight`/dimensions/photos, `InventoryItemType = Furniture . Box . CarrierPack . PackByOwner`, boxes separate from furniture, materials with `packingTimeMinutes`/`unpackingTimeMinutes`, master inventory list + room types + move sizes as catalogs. C3=2 for the submit-for-review + `lockStatus` + `allowInventoryUpdates` flow. **C2=2 not 3: estimate *typing* is one write-only boolean `isBinding`** - no not-to-exceed, no guaranteed price. |
| A13 Crew, driver & settlement | 2 | 2 | 1 | 2 | 1 | 1 | 1 | 1 | Context-map area. `CrewMemberCompensationViewModel` pays by **revenue category** - `movingLaborPercentage`, `packingLaborPercentage`, `transportationPercentage`, `materialsPercentage`, `valuationPercentage`, `prepaidStoragePercentage`, `warehouseHandlingPercentage`, `storageInTransitPercentage`, `shuttleFeePercentage`, `bulkyItemPercentage`, `tripAndTravelPercentage`, `insurancePercentage`, `fuelSurchargeFeesPercentage` - i.e. **the split vocabulary is the charge-category vocabulary**, which is a reusable idea. Plus `labor {method, rate}`, `tripFees {method, rate}`, `tipsEnabled`, job `totalTips`, and `GET /api/crew-members/{id}/jobs`. No settlement statement, no period, no payout record. |

Areas **A11 (claims & valuation)** and **A12 (rating & tariffs)** are recorded
under *Out-of-v1 material* rather than scored: A11 is one enum value
(`CustomerServiceTicketType.Claim`) and A12 exposes only tariff *names* and
materials, never rates.

**S5 - fit to Pegasus data.** SmartMoving is a **comparator, not a supplier**: it
holds no Pegasus data. The column below therefore reads "could pegII / Cloud
produce the concepts this source makes explicit?", judged against
`src:pegii-order`, `src:pegii-longhaul`, `src:pegasus-cloud-domain`.

| Area | Fit | Note |
| --- | --- | --- |
| A1 | partial | pegII has a `Survey.Status` and `KeyMoveDates`; neither repo evidences a reason-code catalog for cancel/lost (`src:pegii-order`, Open questions). Cloud has 5 generic move states and no reasons. |
| A2 | partial | SmartMoving's `VolumeWeightCalculationMode` has a direct pegII counterpart in `Financials.EstimatedWeight` / `ActualWeight`, but *how* the weight was derived is not evidenced anywhere on our side. Cloud has **no** weight field at all. |
| A3 | no | Nothing to compare: SmartMoving has no trip either. Our trip surface is pegII long-haul (`src:pegii-longhaul`), which SmartMoving cannot inform. |
| A4 | unknown | SmartMoving's execution model is too thin to test ours against. pegII's `SettlementUniqueInfo.Actual{Pack,Load,Deliver}Date` is already richer. |
| A5 | unknown | pegII has a `WarehouseSummary` root **whose contents have never been seen** (`src:pegii-order`). SmartMoving's storage-account model is the sharpest question to put to it. |
| A6 | partial | pegII has `DocumentationDates` as a **positional array with no legend**; SmartMoving's `DocumentType` + `FileCategory` pair is a candidate legend to test against. |
| A7 | partial | pegII's cost block and Cloud's 400NG line-item codes both exist; neither evidences an estimate-line-to-actual-line link like `estimatedJobChargeId`. |
| A8 | n/a | SmartMoving has no agent roles, so it cannot inform A8 for us at all. |
| A9 | no | `customField01-03` is the anti-pattern our `IntegrationCorrelation` already improves on (`src:pegasus-cloud-prisma`). |
| A10 | partial | Cloud's room-to-item inventory with condition-at-pack/at-delivery is *better* than SmartMoving's on condition; SmartMoving is better on `CarrierPack`/`PackByOwner`, `shortCode`, density factor and survey subtypes. |
| A13 | partial | Cloud has crew + availability, no compensation; SmartMoving's category-percentage split is the model to copy if settlement is ever built. |

## Strengths worth adopting

1. **State *how* a quantity was derived, next to the quantity.**
   `VolumeWeightCalculationMode = MoveSize . Inventory . Manual` (plus
   `densityFactor`, plus per-item `overrideDefaultWeight`) turns "weight" from a
   number into a number with a provenance. Our A2 should carry the same: an
   estimated weight derived from a survey is not the same fact as one typed in.
2. **Link the actual to the estimate it realises.**
   `ActualJobChargeViewModel.estimatedJobChargeId` is a one-field idea that makes
   estimate-vs-actual variance computable per line rather than per total. Worth
   generalising beyond charges - an actual *date* could name the planned date it
   realises, which is exactly what pegII's parallel `LocalDispatchUniqueInfo`
   (earliest/latest) and `SettlementUniqueInfo` (actual) blocks fail to do.
3. **Two orthogonal axes on a document: instrument and phase.** `DocumentType`
   (Contract / Estimate / WorkOrder / WarehouseRelease) x `FileCategory`
   (Survey / PreMove / PostMove / Claims). Our A6 should not collapse these.
4. **Record which application asserted a fact.** `SmApplications` (`CrewApp`,
   `CustomerPortal`, `ExternalApi`, `PreMoveSurveyApp`, ...) and `PaymentSource`
   are a cheap, high-value provenance dimension - "the crew app said it" is
   different evidence from "an integration said it".
5. **`MissingDuringCheck` / `FoundDuringCheck` as audit activity types.** An item
   that could not be found at delivery is recorded as an **observation about the
   inventory**, before and independently of any claim. That is the right place for
   the fact, and it is a distinction A6/A11 should keep.
6. **The SIT trio.** `StorageType = SIT . Permanent` as a typed boundary; a
   **storage account** as the billing aggregate (with `PrePay`/`PostPay` and a
   valuation method) distinct from the storage *jobs*; and `StorageInTransit` as a
   charge category **separate from** `Storage`. This is the cleanest A5 model in
   the comparator set.
7. **Terminal-state reasons as tenant catalogs with their own endpoints** -
   cancellation, lost and bad-lead reasons are three distinct catalogs, not one
   "reason" field. Our A1 reason codes should likewise be per-terminal-state.
8. **Date-only business days as `yyyyMMdd`, instants as `...Utc`-suffixed names.**
   Crude, but it makes the date-vs-instant distinction impossible to get wrong at
   the contract boundary - worth keeping as a *modelling* distinction (C5) even if
   we serialise differently.
9. **Six named note channels on a job** - `crewNotes`, `customerNotes`,
   `internalNotes`, `crewFeedback`, `accountingNotes`, `dispatcherNotes` - i.e.
   notes typed by *audience*, with `crewFeedback` read-only (it is absent from
   `UpdateJobNotesForm`). Better than one free-text blob.

## Weaknesses / traps

1. **No shipment, and no trip.** Adopting this shape would fuse order, shipment
   and service-day into `Opportunity -> Job`. For a local mover with one truck for
   one day that is correct and elegant; for a van-line agent it destroys the case
   the model exists for - one shipment on a trip with four other shipments,
   handled by four different agents.
2. **A stop has no status, no arrival and no departure.** Copying
   `JobStopViewModel` would make A4 unimplementable. Note especially the
   write/read asymmetry: `stopType` is *required* on `UpdateJobStopForm` and
   simply not returned - a model whose read surface has forgotten a fact its write
   surface demanded.
3. **"Trip" means a date spread.** `OpportunityTripInfoViewModel` uses the word
   *trip* for what our A1/A3 would call the **pickup and delivery spread**. If we
   borrow the spread idea (and we should - first-available / last-available /
   confirmed is exactly the van-line promise), we must not borrow the word.
4. **No inter-company parties at all.** One customer, one branch, internal staff.
   Nothing in this source can inform A8, and a model calibrated on it would have
   no place to put a booking agent or a hauling agent.
5. **`customField01/02/03` as the cross-reference mechanism.** Three untyped,
   unnamed string slots per opportunity is the failure mode A9 exists to prevent.
6. **Integer enums with names only in a description string.** The values are
   sparse (`OpportunityStatus` skips 2, 5-9, 12-19...) and the semantics live in
   `x-enumNames`. Any consumer that reads the wire without the schema sees `4` and
   must guess. A published vocabulary should be symbolic.
7. **Two statuses on one object** (`status: OpportunityStatus` *and*
   `leadStatus: string`), and `GET /api/leads/statuses` whose response schema is an
   **empty object** (`ApiLeadsStatusesGet200ApplicationJsonResponse` has no
   properties). Whatever that second ladder is, the contract does not say.
8. **Polling-only.** No webhooks, no change feed, no `modifiedSince` filter on
   opportunities (only `From`/`To` on *service date* and on *lead creation*). A
   catalog built on this shape cannot be kept in step except by re-reading date
   windows.
9. **Corrections overwrite.** Outside payment refunds there is no reversal,
   supersession or effective-dating anywhere; `PUT .../jobs/{jobId}/stops` replaces
   the entire stop list, so stop identity across an edit is not guaranteed by the
   contract.
10. **`Custom01...Custom50` job types.** The extension mechanism is 50 anonymous
    enum slots whose meaning is per-tenant - which means the *type of service
    performed* is not interoperable across two SmartMoving tenants, let alone with
    us.

## Out-of-v1 material

- **A10 - survey & estimating.** Survey subtypes (`OnSiteEstimate`,
  `VirtualSurvey`, `PhoneSurvey`, `LiveSwitchSurvey` - i.e. a vendor-specific
  video-survey product - plus `BoxDelivery` as a calendar event of the same kind);
  `POST .../opportunities/{id}/surveys` and `PATCH .../surveys/{surveyId}`, whose
  field descriptions are the richest prose in the whole API: 30-minute slots
  between 07:00 and 19:00, "interpreted in the account's time zone",
  `durationMinutes` rounds up to the next 30 between 30 and 720, `notifyCustomer`
  "suppressed when nothing the customer can see changed", `updateEstimator`
  "promotes the supplied estimatorId to the opportunity's estimator".
  `GET /api/premium/surveys?From=&To=` exists so a consumer "can see which windows
  are already booked before scheduling a new survey". Estimate typing is the
  single write-only `isBinding` flag.
- **A10 - inventory.** Master inventory list (`GET /api/premium/inventory`), room
  types catalog, per-opportunity rooms and items with `shortCode`, `quantity`,
  `volume`, `weight`, `overrideDefaultWeight`, `width`/`depth`/`height`,
  `imageUrls[]`, and **boxes as a sibling collection to rooms** rather than items
  inside a room. `CustomItemToInventoryForm` lets a custom item be promoted into
  the master list. `InventoryItemType.CarrierPack` / `PackByOwner` is the CP/PBO
  distinction.
- **A11 - claims & valuation.** Almost nothing: `CustomerServiceTicketViewModel`
  (`type = Claim . Review . Other`, `status = NotStarted . InProgress .
  Completed`, `priority = Low . High . NotSet`, optional `jobId`),
  `FileCategory.Claims`, `JobChargeCategory.Valuation` / `Insurance`,
  `ChargeType.Valuation`, `StorageValuationMethod`. No released-vs-full-value
  concept, no declared value, no claim amount.
- **A12 - rating & tariffs.** `GET /api/tariffs` returns names + `isEnabled` +
  `appliesToOpportunityTypes[]` + `appliesToBranches[]` only; rates are never
  exposed. `GET /api/premium/tariffs/{tariffId}/materials` returns the packing
  materials book (`materialsRate`, `packingRate`, `packingTimeMinutes`,
  `unpackingRate`, `unpackingTimeMinutes`, `isContainer`). The 27-value
  `ChargeType` enum is effectively a **catalog of rating methods**
  (`MileageTable`, `ZoneRated`, `PerItemCwt`, `FlatFeeTwoFactor`,
  `DistanceRateFee`, `Rollup`, `PackingByCwt`, `PackingByCuFt`,
  `CrewSkillFlatRatePlusHourly`...) and is worth keeping for A12 even though no
  rates accompany it.
- **A13 - crew & settlement.** The per-category compensation percentages listed in
  the score table; `LaborCompensationViewModel {method, rate}` and
  `TripFeesCompensationViewModel {method, rate}` (the `method` values are untyped
  strings - not enumerated); `CrewMemberRoleViewModel`, `CrewMemberBranchViewModel`;
  `GET /api/crew-members/{id}/jobs?From=&To=` as the crew's schedule view; job
  `totalTips`.
- **Sales/CRM (no rubric area).** Leads with full UTM attribution
  (`utmSource`/`utmMedium`/`utmCampaign`/`utmContent`/`utmKeyword`/`utmAdGroup`/
  `utmCustomTracking`), `leadCost`, `ReferralSourceViewModel.isLeadProvider` /
  `isPublic`, affiliates under referral sources, follow-ups, logged calls with
  outcomes, notes - a complete lead-vendor attribution model that neither pegII
  nor Cloud has.

## Open questions

1. **What distinguishes `Completed(10)` from `Closed(11)`, and `Cancelled(20)`
   from `Lost(30)`?** The contract gives names only. Needed before we borrow the
   ladder shape for A1. (Answerable only from SmartMoving's help centre - not read
   - or from a tenant.)
2. **What is `leadStatus`, and what does `GET /api/leads/statuses` return?** Its
   response schema is empty. Is there a second, tenant-defined pipeline beside the
   typed `OpportunityStatus`?
3. **What does `IncludeDispatchInfo=true` add to `GET /api/opportunities/{id}`?**
   The query parameter exists (`get-api-opportunities-opportunityid`) but **no
   dispatch field appears in `OpportunityDetailsViewModel`** - so either the
   response is wider than the published schema, or the flag is dead. If it is
   real, it is the only dispatch surface in the API and changes the A3 score.
4. **Are the crew-app activities (`hasActivityLoading`,
   `hasActivityFinishedLoading`, `hasActivityUnloading`) readable anywhere?** If
   SmartMoving records loading-started / finished-loading / unloading timestamps
   internally, that is a real A4 event vocabulary that the public API merely does
   not expose - worth asking a tenant before we score the product (as opposed to
   the API) at C1=1.
5. **Is there a webhook or change-feed product outside this API?** Nothing in the
   portal suggests one. If not, this is evidence for the claim that mover-market
   products are polled, not subscribed - relevant to how ambitious our own event
   catalog should be.
6. **`confirm` takes a `category` query parameter with no description** - what are
   its values? Job confirmation is the only lifecycle command in the API, so its
   parameter matters.
7. **For us, not for SmartMoving:** does pegII's unseen `WarehouseSummary` root
   hold anything like a storage *account* (number, pre/post-pay, valuation method,
   next invoice date), or only a warehouse name? SmartMoving's model is the
   sharpest probe we have for that question (`src:pegii-order`, Open questions).
