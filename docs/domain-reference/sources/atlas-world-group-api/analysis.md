---
source: src:atlas-world-group-api
analyzed: 2026-09-17
evidence_grade: B
material: |
  Read in full (schemas + every operation): docs/atlas-world-group-api/README.md,
  docs/atlas-world-group-api/INVENTORY.md, docs/atlas-world-group-api/apim-products.json,
  docs/atlas-world-group-api/apim-tags.json, and these specs under
  docs/atlas-world-group-api/openapi/ - shipment-management-v1.json, customer-shipment-v1.json,
  agents-v1.json, documents-v1.json, claims-v1.json, tonnages-v1.json, cubesheets-v1.json,
  customers-v2.json, transitguide-v1.json, move4u-integration-v1.json, yembo-v1.json.
  Sampled by targeted extraction (schema + operation inventory, all enums, all property
  descriptions, named schemas dumped): atlasorder-v1.json (139 schemas), estimating-v2.json
  (89 schemas). Schema-name listing only, bodies NOT opened: RadsSupport-v1.json,
  RadsSupport-v2.json, RatingSystem-v1.json, authorizations-v1.json. NOT opened at all:
  assetmanagement-v1.json, finance-v1.json, holidays-v1.json, mileage-v1.json,
  emailing-v1.json, questionnaire-v1.json, echo-api.json.
  No live API calls were made in this analysis.
---

# Atlas World Group APIM (AtlasNet) - analysis

## What it is

Atlas World Group is one of the two van lines our tenants act as agents for. What we hold is
the **machine-readable API catalog of its QA Azure API Management instance**: 24 OpenAPI 3
documents / 255 operations, exported byte-for-byte from `atlas-qa-api-apim` on 2026-07-30
(`docs/atlas-world-group-api/README.md` sections 1-2), plus a gap analysis re-verified against a
working QA subscription key on 2026-08-20. S1 kind: **vendor-api**. S3 openness: **gated-partner** -
every API declares `subscriptionRequired: true` with an `Ocp-Apim-Subscription-Key` and no other
scheme (README section 2 "Auth: subscription key only"); the developer portal is not anonymously
readable (README section 1). S2 adoption: **3 for our purposes, 1 industry-wide** - Atlas is one of
the largest US van lines and this is the system its whole agent network transacts through, but the
API itself is a private partner surface, not an industry standard, and only one of two van lines
our tenants use.

Our reading covered the **structure** of the model thoroughly and the **semantics** not at all,
because the semantics are not in the artifact. Two facts drive the whole evidence grade:

1. **There are zero `enum` declarations in every operational spec.** Counted across all 24 files:
   `estimating-v2.json` has 11 and `echo-api.json` has 2; `atlasorder-v1`, `shipment-management-v1`,
   `customer-shipment-v1`, `agents-v1`, `documents-v1`, `claims-v1`, `tonnages-v1`, `cubesheets-v1`,
   `customers-v2` and the rest have **none**. Every status, type, event code and reason in the
   operational model is an untyped `{"type":"string","nullable":true}`.
2. **There are zero property descriptions in the two core order specs.** A walk over
   `atlasorder-v1.json` `components.schemas` found 0 properties carrying a `description`;
   `shipment-management-v1.json` likewise carries none on its schemas. `estimating-v2.json` is the
   single exception - its properties are documented and routinely say "Refer to
   `/Estimating/<X>/Types` for valid values" (e.g. `EstimateModel.bindingType`, line ~16233;
   `StopModel.type`, line 19445).

The code lists therefore live **behind runtime lookup endpoints** whose OpenAPI response schema is
literally `{"type":"array","items":{"type":"string"}}` (verified on `/Estimating/Stop/Types`,
`/Estimating/Binding/Types`, `/Estimating/Valuation/Types` in `estimating-v2.json`). They are
reference *data*, not contract. We did not fetch them. **Grade B**, not A: we read the real spec,
but the spec is a shape without a vocabulary.

Scope caveat carried from the gap analysis: our measured subscription reaches **6 APIs / 102
operations**, and `atlasorder-v1` - the richest model in the catalog - returns 401
(README section 2 "Our measured grant", "Notable exclusions"). For *domain modeling* that does not
matter: the spec is readable regardless. For S5 and for any future integration it matters a great
deal.

## Model summary

Atlas's own vocabulary, in its own words. Two near-duplicate renderings of the same order exist and
neither is canonical; both are described below.

### The spine

```
Customer (customers-v2 CustomerModel, customerId)
  |- Business (BusinessModel, businessId)      <- carries orderNumber, bookingAgentCode,
       |                                          originAgentCode, destinationAgentCode,
       |                                          businessLine, tariff, status, weight
       |- Estimate (estimating-v2 EstimateModel, id)  -- POST /Estimating/CreateOrder --+
       |- Cubesheet (cubesheets-v1, cubesheetId) -> Room -> Item                        |
                                                                                        v
Order / Shipment  (ord_hdrnumber : int   +   ord_number : string)
  |- agents[]      (Agent: code, type, type_name, authority, personnel, assigned_date, assigned_by, status)
  |- referenceNumbers[]  (ref_type, ref_number, ref_typedesc, ref_sequence, ref_table, ref_tablekey)
  |- orderDates    (requested / scheduled / confirmed / agreed / QC / follow-up dates)
  |- otherDates    -> customerETAs[] , extDates[]   (delay records)
  |- surveys[]     (surveyMethod, surveyStatus, surveyAgent, surveyorCode, surveyAppointmentId)
  |- reweighs[]    (gross/tare/net, witnessed, ticket_number, scale_Owner, participant)
  |- military      (gbl, code_of_service, channel, port_of_embark/debark, service_branch ...)
  |- auditorinfo   (the estimated-vs-billed money ledger)
  |- notes[] , documents.paperwork[] , authorizations[] , orderAuthorizations[]
  |- loadBoards[] , localSchedules[] , onSiteStaffMembers[] , thirdPartyOrders[]
  |- trips[]
       |- Trip (lgh_number)   driver1, driver2, tractor, trailer1, trailer2, carrier,
            |                 lgh_instatus, lgh_outstatus, lgh_startdate, lgh_enddate,
            |                 cmp_id_start / cmp_id_end, stp_number_start / stp_number_end,
            |                 mov_number, lgh_feetavailable, lgh_hauling_comm
            |- Segment (shipment-management only: tripNumber + segmentNumber)
                 |- Stop (stp_number, lgh_number, ord_hdrnumber, mov_number, mfh_number,
                      |   stp_sequence, stp_mfh_sequence, stp_type, stp_type1, stp_reftype,
                      |   evt_eventcode, evt_number, evt_status, evt_startdate, evt_enddate,
                      |   evt_earlydate, evt_latedate, stp_eta, stp_etd, actual_stop_date,
                      |   stp_arr_confirmed, stp_dep_confirmed, stp_departure_status,
                      |   stp_reasonlate, stp_reasonlate_depart, stp_delayhours, stp_podname,
                      |   stp_transfer_type, stp_transfer_stp, stp_weight,
                      |   stp_ord_mileage, stp_lgh_mileage, stp_mfh_mileage, stp_trip_mileage)
                      |- siTs[]          <- storage-in-transit, at a stop
                      |- packUnpacks[]   |- shuttles[]      |- selfMinis[]
                      |- storageInVans[] |- crateUncrates[] |- debrisRemovals[]
                      |- labors[]        |- appliances[]    |- elevatorsStairsCarries[]
                      |- advancedCharges[] |- diversions[]  |- inventories[]
                      |- satSunHols[]    |- tradeShows[]
```

(`atlasorder-v1.json`: `Order` L11324, `Trip` L14745, `Stop` L14029, `SIT` L13215,
`Reweigh` L13135, `CustomerETA` L9688, `EXTDate` L9964, `ReferenceNumber` L13056,
`Military` L10934, `OrderDates` L12504, `Diversion` L9820, `AttemptedPickupDelivery` L8202.
`shipment-management-v1.json`: `Shipment` L2193, `Trip` L3226, `Segment` L2082, `Stop` L2866,
`Agent` L1295, `Survey` L3169, `AuditorInformation` L1405, `Paperwork` L1981.)

### Two renderings of the same order

| | `atlasorder-v1` `Order` | `shipment-management-v1` `Shipment` |
| --- | --- | --- |
| Naming | `snake_case` DB columns: `ord_hdrnumber`, `awg_ord_origin_agent`, `stp_reasonlate_depart` | `camelCase`: `orderHeaderNumber`, `originAgent`, `reasonLateDepart` |
| Collections | XML-shaped wrappers: `Orders{order:[]}`, `Trips{trip:[]}`, `Stops{stop:[]}` | plain arrays: `trips[]`, `agents[]` |
| Fields | ~190 on the header, ~35 child collections | ~140 on the header, 8 child collections |
| Hierarchy | Order -> Trip -> Stop | Shipment -> Trip -> **Segment** -> Stop |
| Extras present only here | `military`, `reweighs`, `attemptedPickupsDeliveries`, `referenceNumbers`, `otherDates`, `localSchedules`, `loadBoards`, `payAuthorizations`, `thirdPartyOrders`, `preapprovals`, `onSiteStaffMembers`, `bindingService`, `containers`, `cancelReason`/`cancelCategory`/`cancelledBy`/`cancelDate` | `segments` (the leg layer), `orderDates.datesConfirmed`, `invoices` (untyped) |
| Reachable on our key | **no** (401) | **yes** |

The `Segment` layer exists only in `shipment-management-v1` (`tripNumber` + `segmentNumber`, with
`stops[]` underneath and its own `driver1/driver2/tractor/trailer1/trailer2/carrier/inStatus/outStatus`).
In `atlasorder-v1` those same fields sit directly on `Trip` and stops hang off the trip. The two
specs disagree about whether a trip has one crew assignment or many.

### Load offering (`tonnages-v1`)

`Tonnage` is a **shipment offered to a hauler on a load board**, not a weight. It carries
`orderHeaderNumber` + `orderNumber` + `moveNumber` + `segmentNumber`, origin/destination
city/state/lat/long/region/zone, `originEarliest`/`originLatest`/`destinationEarliest`/`destinationLatest`
and the corresponding `originAgreedFrom/To`/`destinAgreedFrom/To`, `haulMode`, `payType`,
`estimatedLinehaul`, `discount`, `actualElseEstimatedWeight`, `board`, `flagPlanned`/`planned`,
`loadBoardAcceptable`/`loadBoardNotAcceptableReason`/`notAcceptableText`, `hotLoad`, `onDockAt`,
`xduDone`, `isAcceptableByUser`, `needAssistance`, `containerized`, `carrier`, `legHauler`.
`PUT /Tonnages/request` (`RequestOptions`: tonnage, pvo, tractor, trailer, acceptingUser, comments,
`loadDirect`, `board`, `agentId`) and `PUT /Tonnages/accept` (`AcceptanceOptions`: tonnage,
`legHauler`, `pvo`, tractor, trailer, `acceptingUser`) are the **offer/accept transition made
explicit as verbs** - the only place in the whole catalog where a lifecycle transition is an
operation rather than a field.

## Vocabulary

Terms exactly as the source spells them. Type/status values are omitted where the spec does not
carry them (which is nearly everywhere - see "What it is").

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `ord_hdrnumber` / `orderHeaderNumber` | Integer surrogate key of the order header; the join key every child row carries | A9 | `atlasorder-v1.json:11324`; `shipment-management-v1.json:2193` |
| `ord_number` / `orderNumber` | The human-facing order number; the only path parameter on `GET /shipments/{orderNumber}` and `GetShipmentJson/{orderNumber}` | A9 | `shipment-management-v1.json` paths |
| `Business` / `businessId` | The move-level record owned by a `Customer`; carries the `orderNumber`, `bookingAgentCode`, `originAgentCode`, `destinationAgentCode`, `businessLine`, `tariff`, `status`, `weight`. Atlas's "customer" is a **person**; the move aggregate is a Business | A1, A8 | `customers-v2.json` `BusinessModel` |
| `mov_number` / `moveNumber` | A number above the trip - present on `Order`, `Trip`, `Stop` and `Tonnage`, and on `assetmanagement-v1 GET /api/trips/exists/{moveNumber}` | A3 | `atlasorder-v1.json:14745,14029`; `tonnages-v1.json` `Tonnage` |
| `mfh_number`, `stp_mfh_sequence`, `stp_mfh_mileage` | A manifest layer between trip and stop with its own stop sequence and mileage accumulator | A3 | `atlasorder-v1.json:14029` |
| `lgh_number` ("leg header") | The trip identifier. `Trip.lgh_number`; `Stop.lgh_number`; `PayAuthorization.lgh_number` | A3 | `atlasorder-v1.json:14745` |
| `Segment` | `tripNumber` + `segmentNumber` with its own crew/equipment and its own `stops[]` | A3 | `shipment-management-v1.json:2082` |
| `stp_type`, `stp_type1`, `stp_reftype`, `awg_stp_triptype`, `stp_transfer_type` | Five separate type axes on one stop, all untyped strings | A3 | `atlasorder-v1.json:14029` |
| `evt_eventcode`, `evt_number`, `evt_status`, `eventType` | The execution event **carried as fields on the stop** - one current event per stop, not a log | A4 | `atlasorder-v1.json:14029`; `shipment-management-v1.json:2866` |
| `evt_earlydate` / `evt_latedate` vs `evt_startdate` / `evt_enddate` | The planned window vs the event's own start/end | A4 | `atlasorder-v1.json:14029` |
| `stp_eta` / `stp_etd` (`etaDateFrom`/`etaDateTo`) | Estimated arrival/departure, separate from scheduled, agreed and actual | A4 | ibid. |
| `scheduledFromDate`/`scheduledToDate` vs `agreedFromDate`/`agreedToDate` | Two distinct windows on the same stop: what is scheduled vs what was agreed with the shipper | A4 | `shipment-management-v1.json:2866` |
| `actual_stop_date` / `actualStopDate` | The one actual instant on the stop | A4 | ibid. |
| `stp_arr_confirmed` / `stp_dep_confirmed` | Confirmation flags separate from the timestamps they confirm | A4, C7 | `atlasorder-v1.json:14029` |
| `stp_reasonlate` / `stp_reasonlate_depart`, `stp_delayhours` | Separate late-arrival and late-departure reason codes plus an hours figure | A4 | ibid. |
| `stp_podname` / `podName` | Name of the person who signed for proof of delivery, on the stop | A4, A6 | ibid. |
| `stp_transfer_stp` | Pointer from one stop to the stop it transfers to (cross-dock / transfer pairing) | A3, A5 | ibid. |
| `SIT` | Storage-in-transit record hung off a **stop**, with `type`, `status`, `reason`, `sit_date`, `siT_Out_Date`, `days_authorized`, `additional_authorized_days`, `permanent`, `bonded_Storage`, `storage_In_Van`, `storageWarehouse`, `sit_stop_number`, `sit_xdl_stop_number` | A5 | `atlasorder-v1.json:13215` |
| `sit_xdl_stop_number` | The cross-dock-delivery stop paired with the SIT stop - the delivery-out leg, identified | A5 | ibid. |
| `crossdocked_by` / `crossdocked_date` | Who moved the goods out of SIT into the delivery leg, and when | A5, C7 | ibid. |
| `permanent` (on SIT) | The boundary flag separating storage-in-transit from permanent storage | A5 | ibid. |
| `market_Saturated`, `warehouse_full`, `long_Cartage_Denied`, `carrier_Convenience`, `nO_Prior_OPS_Approval` | Named *causes* of a SIT, as booleans/flags alongside the free `reason` | A5 | ibid. |
| `SITFirstDayActivity` / `SITAdditionalDaysActivity` / `SITCartageActivity` | Three billing activity kinds under a SIT, each with weight, date(s), discount, `bill`, `flat_auto` | A5, A7 | `atlasorder-v1.json` |
| `StorageInVan`, `SelfMini` | Storage held in the van, and self-storage/mini-warehouse, as separate stop services from SIT | A5 | `atlasorder-v1.json:14407,13769` |
| `EXTDate` | A delivery-date **extension** record: `date_from`, `date_to`, `reason`, `explainreason`, `shipmentlocation`, `delayclaimresponsibility`, `delayclaimwhy`, `loadedatdelay`, `routeto`, `who`, `when`, `approvedWho`, `approvedWhen`, `notificationRecdLate`, `notificationToWhom`, `notificationWhen`, `notificationByWhom`, `regionOriginating`, `delayRegion`, `date_type` | A4, C7 | `atlasorder-v1.json:9964` |
| `CustomerETA` | An ETA **communication**: `date_from`, `date_to`, `eta_given_to`, `eta_given_by`, `date_given` - the promise and who made it, not just the estimate | A4, C7 | `atlasorder-v1.json:9688` |
| `Reweigh` | `reweigh_date`, `gross_weight`, `tare_weight`, `net_weight`, `witnessed`, `ticket_number`, `scale_Owner`, `participant`, `shipper_customer_requested` | A2, A6, C7 | `atlasorder-v1.json:13135` |
| `AttemptedPickupDelivery` | `attempt_type` + `participant` - a failed service attempt as its own record | A4 | `atlasorder-v1.json:8202` |
| `Diversion` | Re-routing to a new city/zip/state, with `participant` and `additional_participant`, hung off a stop | A4 | `atlasorder-v1.json:9820` |
| `ReferenceNumber` | `ref_type` + `ref_number` + `ref_typedesc` (human description of the type) + `ref_sequence` + `ref_pickup` + `ref_table`/`ref_tablekey` (what row it hangs off) | A9 | `atlasorder-v1.json:13056` |
| `ApplicationXRefModel` | `application` + `xRefType` + `foreignKey` (+ `addressId`, `contactId`) on a `Company` - an explicit cross-system identity table | A9 | `agents-v1.json` `CompanyModel.xRefs` |
| `agentRegno` / `agentRegNumber` | The agent's registration number on the order | A9 | `atlasorder-v1.json:11324` |
| `gbl`, `military_control_number`, `code_of_service`, `channel`, `port_of_embark`/`debark`, `travel_order_type`, `is_short_fuse_shipment` | Government-bill-of-lading identity and military move vocabulary | A9, A2 | `atlasorder-v1.json:10934` |
| `awg_ord_booker` / `booker`, `awg_ord_origin_agent`, `awg_ord_dest_agent`, `awg_ord_freight_forwarder`, `extending_Agent`, `ord_broker` | Van-line agent roles as **flat fields** on the order, in parallel with the typed `agents[]` collection | A8 | `atlasorder-v1.json:11324` |
| `Agent.type` / `type_name` / `authority` / `personnel` / `assigned_date` / `assigned_by` / `status` | A role assignment on the order, with its own actor and timestamp | A8, C7 | `atlasorder-v1.json:7837`; `shipment-management-v1.json:1295` |
| `activityStatus`, `retentionStatus`, `shipmentAuth` (on `AgentModel`) | Party-level lifecycle axes, each with a dedicated lookup endpoint (`/Agents/ActivityStatuses`, `/Agents/ShipmentAuths`) | A8 | `agents-v1.json` |
| `parentAgentCode`, `/Agents/{agentCode}/Family` | Agent hierarchy / family grouping | A8 | `agents-v1.json` |
| `PVO` | The van operator, named as a first-class assignee alongside tractor/trailer in `RequestOptions`/`AcceptanceOptions`; also `pvoCode`, `show_PVO_Profile`, `lgh_pvo_override` | A8, A13 | `tonnages-v1.json`; `atlasorder-v1.json:11324` |
| `legHauler` | The party actually hauling the leg, distinct from `carrier` and from the agents | A3, A8 | `tonnages-v1.json` |
| `OnSiteStaffMember` | Named person at the job with `role_ID`/`role_Description`, `type`, `source`, `run_Date`, and `onSiteStaffMemberLocations[]` binding them to `stop_Number`s | A8, A13 | `atlasorder-v1.json:11209` |
| `LocalSchedule` / `LocalScheduleResource` | Local (non-linehaul) work: `work_type_code`/`work_type`, `event`, `status`/`status_name`, `event_weight`/`event_hours`/`event_piece_count`, `warehouse`/`residence`, `leave_warehouse`/`leave_residence`/`return_to_warehouse`, `bill_of_lading`, plus resource assignments (`type_code`, `resource_id`, `assignment_type`) | A3, A4, A13 | `atlasorder-v1.json:10621` |
| `Paperwork` | `abbr` + `received` + `pwDt` + `imaged` + `inDocid` + `legNumber` - which document has arrived and whether it has been scanned | A6 | `shipment-management-v1.json:1981` |
| `ShipmentDocument` / `AccountsPayableDocument` / `RiskMgtDocument` | Three document families, each `content: {type: string, format: byte}` (base64-in-JSON) with a different cross-reference set | A6 | `documents-v1.json` |
| `convertContentTo`, `fields`, `types` (query params on `GET /Shipment/Documents`) | Server-side format conversion, field projection, and type filtering on the document store | A6, C8 | `documents-v1.json` |
| `bindingType` | Binding basis of the estimate; valid values from `/Estimating/Binding/Types` | A1, A10 | `estimating-v2.json:16233` |
| `ValuationCategory` | `NONE`, `BASE_PROTECTION`, `DECLARED_VALUE_PROTECTION`, `FULL_VALUE_PROTECTION`, `REPLACEMENT_VALUE`, `RELEASE_LONG_VALUATION`, `RELEASE_LOCAL_VALUATION`, `VALUATION`, `LOCAL_VALUATION`, `VALUATION_FLAT_RATE` - **the only released-vs-full-value vocabulary in the catalog** | A11 | `estimating-v2.json:19917` |
| `ServiceName` | ~230-value accessorial/charge catalog: `LINEHAUL`, `FUEL_SURCHARGE`, `SHUTTLE`, `FIRST_DAY_STORAGE`, `ADDITIONAL_DAY_STORAGE`, `SIT_TRANSPORTATION_ORIGIN`/`_DESTINATION`, `PERM_STORAGE_ORIGIN`/`_DESTINATION`, `ATTEMPTED_DELIVERY`, `DIVERSION_CHARGE`/`DIVERSION_LINEHAUL`, `REWEIGH_CHARGE`, `WAIT_TIME_VAN`/`_LABOR`, `TRUCK_ORDERED_NOT_USED`, `STORAGE_IN_VAN`, `SELF_MINI_WAREHOUSE`, `LONG_CARRY`, `EXCESS_CARRY`, `FLIGHTS_INSIDE`/`_OUTSIDE`, `ORIGIN_AGENT_COMMISSION`, `PERFORMING_OA`/`COMMISSIONED_OA`, `NON_PARTICIPATING_AGENT`, `PBLD_VARIANCE`, ... | A7, A12 | `estimating-v2.json:19198` |
| `HourlyServiceType` | `Appliances`, `OTLoadUnload`, `Stairs`, `LongCarries`, `SplitPickup`, `Shuttle`, `WaitTime`, `SITHandling`, `RiggingHoistingLowering`, `Elevators`, `Packing`, `Unpacking`, `Transportation`, `Labor`, `LaborWaiting`, `VanWaiting` | A7 | `estimating-v2.json:16828` |
| `HourlyType` | `Regular`, `Overtime`, `DoubleTime`, `Sunday`, `Vehicle`, `Holiday`, `NoWorkDay` | A7 | `estimating-v2.json:16849` |
| `CartonTypes` | 48-value packing-carton catalog (`DISH`, `WARDROBE`, `CP_30`...`CP_65`, `FLAT_SCREEN_LT_46`/`_GTE_46`, `MATTRESS_COVER`, `GRANDFATHER_CLOCK`, `MICRO_FOAM`, ...) | A10 | `estimating-v2.json:15819` |
| `AccessType` | `StairsInside`, `StairsOutside`, `Elevators`, `LongCarries` | A10 | `estimating-v2.json:15091` |
| `PBLD` / `EBLD` (`adhdPbldPct`, `adhdEbldPct`, `adhdSharedPct`, `PBLD_VARIANCE`) | Prepaid-billed vs estimated-billed discount percentages and their variance, as first-class money concepts | A7 | `estimating-v2.json:16900`; `RadsSupport-v1.json` `Models.Pricing.PBLD` |
| `AuditorInformation` / `auditorinfo` | The estimated-vs-actual money ledger on the order: `estimatedLinehaul`, `calculatedEstimatedLinehaul`, `actualCharges`, `grossBilledLinehaul`, `billedDiscount`, `sharedDiscount`, `actualTareWeight`/`actualGrossWeight`/`actualProgearWeight`, `authorizedWeight`, `authorizedDollarCap`, `estimatedSITCharge`, `paymentTiming`, `valuationDeductible`/`valuationFree`/`valuationRate` | A7 | `shipment-management-v1.json:1405` |
| `InvoiceData` | Invoice header with `ivhInvoiceNumber` <-> `ordNumber`, `ivhInvoiceStatus`, `ivhCreditMemo` + `adhdMemoType`/`adhdMemoDate`, `adhdRemitScacCode`, `adhdIvhGblNumber`, `adhdSettlementDate`, `adhdIvhRatedBy`/`RatedByDate`/`RatedByTeam`, `adhdIvhAgentReleaseBy`/`Date`, `adhdIvhRateDistReleaseBy`/`Date`, `adhdIvhBilledWeight`, `adhdIvhConstructiveWeight`, `adhdIvhWeightAdditive` | A7, A9, C7 | `estimating-v2.json:16900` |
| `PayAuthorization` | Per-leg payable to a driver/agent: `lgh_number`, `asgn_number`/`asgn_type`/`asgn_id`, `pyd_payto`, `pyt_itemcode`, `pyd_rate`/`pyd_amount`, `pyd_status`, `pyd_carinvnum`/`pyd_carinvdate`, `pyd_releasedby`, `pyd_ap_check_date` | A13 | `atlasorder-v1.json:12865` |
| `TransitGuideResponseModel` | `minDays`, `maxDays`, `deliveryDateFrom`, `deliveryDateTo`, **`calculationLog: [string]`** - derived from tariff, division, loadDate, bookDate, weight, miles, origin, destination and `conditions[]` | A4, C5, C7 | `transitguide-v1.json` |
| `LockModel` | `estimateId`, `lockDate`, `userName`, `lockType`, **`customerSigned`** - an estimate is locked, and one lock reason is that the customer signed it | A1, A6, A10 | `estimating-v2.json:17726` |
| `SeverityEnum` | `NONE`, `INFORMATION`, `WARNING`, `ERROR` on `OrderError` (with `messageNumber`, `pointer`) | C8 | `estimating-v2.json:19421` |
| `<service>_cmpid_status` / `service_status` | Every performed service carries **two** statuses: the assigned company's acceptance status and the service's own status (`shuttle_van_cmpid_status`, `shuttle_labor_cmpid_status`, `pack_unpack_cmpid_status`, `advchrgs_vendorid_status`, `sm_agentid_status`, `haul_agent_status`, `load_agent_status`, `unload_agent_status`, `build_cmpid_status`, `material_cmpid_status`, `crate_cmpid_status`, `debris_cmpid_status`, `labor_cmpid_status`, `bridge_ferry_agentid_status`) | A3, A8 | grep over `atlasorder-v1.json` |
| `ord_revtype1`..`4` / `ivhRevType1AuthDivision`, `ivhRevType2HaulMode` | Four generic "revenue type" dimension slots; the invoice names two of them (auth division, haul mode) | A7, C8 | `atlasorder-v1.json:11324`; `estimating-v2.json:16900` |

## Lifecycles & events

**There is no declared state machine anywhere in this catalog.** Every state is a nullable string.
What Atlas *does* give us is a set of named lifecycle axes and the actor/timestamp pairs that trace
them.

### Status axes found (all untyped strings)

| Axis | Field | Where |
| --- | --- | --- |
| Order | `ord_status`, `awg_user_managed_order_status` | `atlasorder-v1.json:11324` |
| Order acceptance | `isAccepted` + `hasBeenAccepted` (two booleans, relation undefined) | `atlasorder-v1.json:11324`; `shipment-management-v1.json:2193` |
| Order cancellation | `cancelDate`, `cancelReason`, `cancelRequestor`, `cancelledBy`, `cancelCategory` | `atlasorder-v1.json:11324` - **absent from `shipment-management-v1`** |
| Invoice | `ord_invoicestatus`, `ivhInvoiceStatus` | `atlasorder-v1.json`, `estimating-v2.json:16900` |
| Trip | `lgh_instatus`, `lgh_outstatus`, `lgh_active` | `atlasorder-v1.json:14745` |
| Stop event | `evt_status` (+ `evt_eventcode`, `evt_number`, `eventType`) | `atlasorder-v1.json:14029` |
| Stop departure | `stp_departure_status` | ibid. |
| Service assignment | `<service>_cmpid_status` (14 variants) | ibid. |
| Service performance | `service_status` | ibid. |
| SIT | `SIT.status` + `SIT.reason` | `atlasorder-v1.json:13215` |
| Survey | `surveyStatus` (+ `surveyMethod`) | `atlasorder-v1.json:14450`; `shipment-management-v1.json:3169` |
| Load board | `load_board_status`, `is_load_board_acceptable`, `is_load_board_visible`, `load_board_not_acceptable_reason`, `load_board_expiration` | `atlasorder-v1.json:10483,11324` |
| Payable | `pyd_status` | `atlasorder-v1.json:12865` |
| Local work | `LocalSchedule.status` / `status_name` / `status_comments` / `event_priority` / `priority_name` | `atlasorder-v1.json:10621` |
| Agent (party) | `activityStatus`, `retentionStatus`, `shipmentAuth`, `Company.status` | `agents-v1.json` |
| Business (move) | `BusinessModel.status` | `customers-v2.json` |
| Preapproval | `Preapproval.status` (+ `ppso`, `ppso_note`, `tsp_note`, `submit_date`) | `atlasorder-v1.json:12964` |

### Where the code lists actually live

Reference-data endpoints, response schema `array<string>` with no values in the spec:

- `agents-v1`: `GET /Agents/ActivityStatuses`, `GET /Agents/ShipmentAuths`
- `shipment-management-v1`: `GET /Shipments/Notes/Types`
- `documents-v1`: `GET /Shipment/Documents/types`
- `estimating-v2`: `/Estimating/Stop/Types`, `/Binding/Types`, `/Valuation/Types`,
  `/Packing/Types`, `/Packing/Schedules`, `/Packing/Carton/Types`, `/Crating/Types`,
  `/Bulky/Types`, `/Container/Types`, `/Vehicle/Types`, `/Vehicle/RateTypes`,
  `/Appliance/Types`, `/DebrisRemoval/Types`, `/BridgeFerry/Types`, `/Account/Types`,
  `/AdvanceCharge/Types`, `/Authorization/Types`, `/Authorization/AmountTypes`,
  `/TaxExempt/Types`, `/PricingOption/Types`, `/LeadSource/Types`, `/HourlyTypes`,
  `/HourlyServiceTypes`, `/ImpliedServices`, `/BusinessCodes`, `/Waterhaul/Ports`
- `claims-v1`: `/Item/Categories`, `/Item/Types`, `/Item/DamageTypes`, `/Item/Damage/Natures`,
  `/Item/Damage/Locations`, `/Item/Damage/Directions`, `/Item/TagColor`, `/Claims/ContactMethods`
- `authorizations-v1`: `/OrderAuthorizations/actions`, `/OrderAuthorizations/amountTypes`,
  `/OrderAuthorizations/frequentAuthorizations`
- `cubesheets-v1`: `/Cubesheets/businessLines`, `/regions`, `/settings/itemLists`,
  `/settings/language`, `/settings/ratingModes`
- `customers-v2`: `/Location/Types`, `/Phones/Types`, `/Businesses/Lines`,
  `/Businesses/Statuses`, `/Businesses/Tariffs`

**None of these were fetched.** Any code list we need from Atlas is an outreach/fetch task, not a
spec-reading task.

### Transitions expressed as operations (the only ones)

| Transition | Operation | Spec |
| --- | --- | --- |
| Estimate -> Order | `POST /Estimating/CreateOrder` -> `CreateOrderResponseModel{orderNumber}` | `estimating-v2.json` |
| Estimate rated | `POST /Estimating/Rate`, `POST /Estimating/Rate/CreateSummary`, `POST\|GET /Estimating/Rate/Summary` | ibid. |
| Estimate locked / signed | `GET /Estimating/Locks` (`lockType`, `customerSigned`), `DELETE /Estimating/Locks/{estimateId}` | ibid. |
| Load offered to a hauler | `PUT /Tonnages/request` | `tonnages-v1.json` |
| Load accepted by a hauler | `PUT /Tonnages/accept` | ibid. |
| Order created by a customer/account | `POST /orders`, `POST /shipments` | `customer-shipment-v1.json` |
| Order rated (new engine) | `GET /RatingSystem/v1/RateOrder/{orderNumber}`, `/IsEligibile/{orderNumber}` | `RatingSystem-v1.json` |
| Claim filed | `POST /Claims` | `claims-v1.json` |
| Authorization requested / amended | `POST` / `PUT /OrderAuthorizations` (header `On-Behalf-Of-Agent`) | `authorizations-v1.json` |
| Note added | `POST /shipments/{orderNumber}/Notes` | `shipment-management-v1.json` |
| Survey posted | `PostSurveyRequestModel` (`performedByAgentCode`, `performedDateTime`, `method`, `status`) | `estimating-v2.json:18097` |

**Direction of travel is pull-only.** The three webhook-shaped paths
(`estimating-v2 POST /WebHooks/Atlas/Order`, `POST /WebHooks/HubSpot/Survey`,
`move4u-integration-v1 POST /callbacks`) are endpoints *Atlas receives on*; nothing in the catalog
registers a subscriber URL (`docs/atlas-world-group-api/README.md` section 2 "Direction of travel").
So Atlas publishes **no event feed** - there is no event history resource, no `GET /events`, no
change log. The nearest thing to an event stream is `move4u-integration-v1 GET /callbacks`, which
returns `CallbackLog{timestamp, payload}` and is documented as "intended for debugging".

## Time, identity, evidence

### Time

Atlas's time model is **the strongest thing in this source**, and it is entirely implicit - carried
by field names, never defined.

Five distinct temporal kinds coexist on a single stop (`atlasorder-v1.json:14029` /
`shipment-management-v1.json:2866`):

| Kind | Fields |
| --- | --- |
| Scheduled (plan) | `scheduledFromDate` / `scheduledToDate` |
| Agreed (commitment to the shipper) | `agreedFromDate` / `agreedToDate` (`evt_earlydate` / `evt_latedate`) |
| Estimated (forecast) | `stp_eta` / `stp_etd` -> `etaDateFrom` / `etaDateTo` |
| Actual | `actual_stop_date`, `evt_startdate` / `evt_enddate` |
| Confirmed (assertion about the actual) | `stp_arr_confirmed`, `stp_dep_confirmed` |

Plus a *customer-facing* promise separate from all of them: `stp_custpickupdate` /
`stp_custdeliverydate`, and `CustomerETA{date_from, date_to, eta_given_to, eta_given_by, date_given}`.

At order level `OrderDates` (`atlasorder-v1.json:12504`) splits the same spread four ways -
`requested_delivery_date`, `scheduled_delivery_date`, `confirmed_Delivery_Date_From`/`_To`,
`agreed_pre_move_date` - and adds process milestones: `mid_call_attempted_date` /
`mid_call_completed_date`, `load_call_date`, `virtual_QC_Date`, `physical_QC_Date`,
`post_Delivery_Follow_Up_Date`, `ttg_date_from` / `ttg_date_to` (the transit-time-guide spread),
`customer_arrival_date`, `dates_confirmed`, `storage_anticipated`. The header carries yet another
pair - `awg_ord_agreed_pickup_date_from`/`_to`, `awg_ord_agreed_delivery_date_from`/`_to` - plus
`awg_ord_load_date`, `awg_ord_delivery_date`, `awg_ord_pack_date_from`/`_to`, `shipment_arrival_date`,
`shipment_departure_date`, `extendedDeliveryDate`, `customs_clearance_date`, `resPkupDate`,
`sitOrigDate`, `sitDestDate`.

`transitguide-v1` makes the derivation explicit: `TransitGuideRequestModel` (tariff, division,
loadDate, bookDate, weight, miles, origin, destination, `conditions[]`) -> `minDays`/`maxDays` +
`deliveryDateFrom`/`deliveryDateTo` + **`calculationLog: [string]`**. That is the delivery spread
computed from a tariff, and the log is a stated audit trail of the computation.

**Two weaknesses.** (1) In `atlasorder-v1` nearly every date is `{"type":"string"}` with **no
`format`** - date vs date-time vs local-date is unknowable from the spec (contrast
`shipment-management-v1`, which uses `format: date-time` throughout). (2) **There is no time zone
anywhere in the catalog** - no `timeZone`, no offset field on a stop, no UTC statement. A stop in
Honolulu and one in Boston carry the same shape of timestamp with nothing to disambiguate.

### Identity

Atlas is unusually good here, on three levels.

1. **Dual key on every aggregate.** `ord_hdrnumber` (int surrogate) + `ord_number` (string
   business key); `ivhHdrNumber` + `ivhInvoiceNumber`; `apHdrNumber`. Every child row carries the
   surrogate, every API path takes the business key.
2. **A typed, self-describing reference table.** `ReferenceNumber` (`atlasorder-v1.json:13056`)
   holds `ref_type` + `ref_number` + **`ref_typedesc`** (the type's own human description) +
   `ref_sequence` + `ref_pickup` + `ref_table` / `ref_tablekey` (which row the reference hangs off).
   Cross-references are data, not schema.
3. **An explicit cross-application identity map.** `CompanyModel.xRefs[] = ApplicationXRefModel
   {application, xRefType, foreignKey, addressId, contactId}` (`agents-v1.json`) - Atlas records
   *which external application* a foreign key belongs to.

Named identifiers in play: `orderNumber`, `ord_hdrnumber`, `mov_number`, `mfh_number`, `lgh_number`,
`stp_number`, `customerId`, `businessId`, `agentCode`, `cmp_id` / `cmp_altid`, `companyId`,
`salesCode`, `estimateId`, `cubesheetId`, `claimId` / `claimNumber` / `thirdPartyClaimNumber`,
`agentRegno`, `gbl` / `gbl_origin_zip_code` / `gbl_destination_zip_code`, `military_control_number`,
`faiC_Number`, `adhdRemitScacCode` (SCAC), `container_number` / `container_seal_number` /
`container_easydps_id`, `reweigh_easydps_id`, `preapproval_easydps_id`, `quoteNumber`,
`workOrderId`, `accountEstimateId`, `projectId`, `client_ID`, `fileNumber`, `clientNumber`,
`customerOE`, `supplierId` / `originSupplierId` / `destinationSupplierId`, `provider_order_id`,
`hubspotContactId` / `hubspotMoveId`, `moveKey` (Yembo), `externalKey` / `barcode` / `lotNumber`
(Move4U items), `inventory_Tag_Color` + `inventory_Lot_Number`.

Notably: the **BOL number appears only on `LocalSchedule.bill_of_lading` / `billOfLading`** - there
is no BOL number on the order header, no PRO number, and no `proNumber` anywhere in the catalog
(grep across all 24 specs). `signed_Premove_BL` is a flag, not an identifier.

### Evidence, provenance and corrections

Provenance is recorded consistently as **actor + timestamp + application** triples:

- Order: `enteredBy`/`enteredMode`, `takenBy`, `ord_datetaken`, `bookedBy`, `last_updateby`/
  `last_updatedate`, `cancelledBy`/`cancelRequestor`/`cancelDate`.
- Trip/Segment: `createdBy`, `createdOn`, **`createdByApp`**, `lastUpdatedBy`, `lastUpdated`,
  **`updatedByApp`** (`shipment-management-v1.json:2082`). Recording *which application* wrote a
  row is rare and useful.
- Agent assignment: `assigned_by` + `assigned_date` (`atlasorder-v1.json:7837`).
- Survey: `createdBy`/`createdOn`/`updatedBy`/`updatedDateTime`/**`updateApplication`**, plus
  `surveyMethod` - *how* the fact was gathered (`shipment-management-v1.json:3169`).
- SIT: `created_by`/`created_date`, `supervisor_approval_by`/`supervisor_approval_on`,
  `crossdocked_by`/`crossdocked_date`, `cancelled_by`/`cancelled_date`, `auto_authorized`,
  `customer_contacted`/`customer_number_called` (`atlasorder-v1.json:13215`).
- Invoice: `adhdIvhRatedBy`/`RatedByDate`/`RatedByTeam`, `adhdIvhAgentReleaseBy`/`Date`,
  `adhdIvhRateDistReleaseBy`/`Date`, `adhdIvhRatedByEngine` + `BatchNo` - a human-vs-engine
  distinction on who produced the rating (`estimating-v2.json:16900`).
- Delay: `EXTDate` records `who`/`when`, `approvedWho`/`approvedWhen`,
  `notificationByWhom`/`notificationToWhom`/`notificationWhen`/`notificationRecdLate` - the fact,
  its approval, and the notification of it, each with its own actor and time
  (`atlasorder-v1.json:9964`).
- ETA: `CustomerETA.eta_given_by` / `eta_given_to` / `date_given` - the *communication* of an
  estimate is itself an evidenced fact.
- Weight: `Reweigh.witnessed`, `ticket_number`, `scale_Owner`, `participant`,
  `shipper_customer_requested` - physical evidence (a scale ticket), who owns the scale, whether it
  was witnessed, and who asked for it (`atlasorder-v1.json:13135`).
- Documents: `Paperwork.received` + `pwDt` + `imaged` + `inDocid` - a two-stage evidence lifecycle
  (received, then scanned), linked to a document id (`shipment-management-v1.json:1981`).
- Estimate: `LockModel.customerSigned` - the estimate is locked because the customer signed it.

**Correction semantics exist in exactly one place:** `InvoiceData.ivhCreditMemo` +
`adhdMemoType` + `adhdMemoDate` (`estimating-v2.json:16900`), i.e. financial reversal by credit
memo. Nowhere else. Operational facts are corrected by `PUT` - `PUT /shipments/{orderNumber}`,
`PUT /Customers/{customerId}`, `PUT /OrderAuthorizations/{authorizationId}` - which overwrites, with
only the `lastUpdatedBy`/`lastUpdated` pair as residue. Documents are `DELETE`d outright. There is
**no versioning, no supersede, no reversal, no soft delete, and no "as-asserted-at" on any
operational record**.

## Scores

Scored per area against the rubric. `n/a` where the criterion does not apply to the area.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1** Order & service lifecycle | 3 | 1 | 1 | 3 | 2 | 3 | 2 | 1 | C1: book (`bookDate`/`bookedBy`/`booker`), estimate->order (`POST /Estimating/CreateOrder`), offer/accept (`PUT /Tonnages/request`+`/accept`, `LoadBoard.accepted_by`/`accepted_datetime`), accept (`isAccepted`/`hasBeenAccepted`), cancel (`cancelDate`/`cancelReason`/`cancelRequestor`/`cancelledBy`/`cancelCategory`), complete (`ord_completiondate`) - all present, `atlasorder-v1.json:11324,10483`; `tonnages-v1.json`. C2=1: 0 property descriptions in `atlasorder-v1`/`shipment-management-v1`; `isAccepted` vs `hasBeenAccepted` undefined. C3=1: `ord_status` is `{"type":"string","nullable":true}`; zero enums in the file. C4=3: booker / origin agent / dest agent / freight forwarder / extending agent, `isAvailMove`, `isSelfHaul`, `storage_anticipated`. C5=2: many dates, but `atlasorder-v1` dates carry no `format`. C6=3: `ord_number`+`ord_hdrnumber`+`customerID`+`businessID`+`quoteNumber`+`ord_fromorder`. C7=2: actor captured on every transition, no correction semantics. C8=1: URL-path versioning + runtime `/Types` lists; `ord_revtype1..4` generic slots. |
| **A2** Shipment structure | 3 | 1 | n/a | 3 | n/a | 3 | 2 | 1 | C1=3: `shipment_type`, `move_Type`, `logistics_Mode`, `orderKind`, `haulMode`, `householdGoodsType`, `freight_class`, `containerized_Shipment`, weights (`ord_totalweight`/`ord_tareweight`/`ord_grossweight`/`awg_ord_auto_weight`/`awg_ord_boat_weight`/`authorizedWeight`/`actualProgearWeight`), `ord_totalpieces`/`ord_totalvolume`/`shipment_Density`/`ord_length` (`atlasorder-v1.json:11324`; `shipment-management-v1.json:1405,2193`). C2=1: four overlapping type axes, no definitions, no code lists. C4=3: auto/boat/progear weight, bulky, SIT, `selectDeliveryWeight`, `spaceReservation`, `exclusiveUseOf`, `climateControl`. C6=3. C7=2: `Reweigh` gives actual weight real evidence (`witnessed`, `ticket_number`, `scale_Owner`) - `atlasorder-v1.json:13135`. C8=1. |
| **A3** Trip, stop & assignment | 3 | 2 | 1 | 3 | 3 | 3 | 2 | 1 | **Best-covered area in this source.** C1=3: Trip(`lgh_number`)->Segment->Stop with `stp_sequence`; consolidation via `mov_number`/`mfh_number`/`stp_mfh_sequence` on the stop; four mileage accumulators (`stp_ord_mileage`/`stp_lgh_mileage`/`stp_mfh_mileage`/`stp_trip_mileage`); equipment+driver on the trip/segment (`driver1`,`driver2`,`tractor`,`trailer1`,`trailer2`,`carrier`); offer/accept of the haul in `tonnages-v1` (`legHauler`,`pvo`,`tractor`,`trailer`,`acceptingUser`). `atlasorder-v1.json:14745,14029`; `shipment-management-v1.json:2082`. C2=2: trip != shipment is structurally explicit (a stop carries `ord_hdrnumber` *and* `lgh_number` *and* `mov_number` independently) but never stated in prose. C3=1: `lgh_instatus`/`lgh_outstatus`/`stp_departure_status` all untyped, no transitions. C4=3: PVO, legHauler, hauling commission (`lgh_hauling_comm`), agent-performed services, CrewPro. C5=3: scheduled / agreed / ETA-ETD / actual / confirmed all distinct on one stop. C6=3: `stp_number`,`lgh_number`,`mov_number`,`mfh_number`,`stp_refnum`+`stp_reftype`,`stp_transfer_stp`,`cmp_id`. C7=2: `createdByApp`/`updatedByApp`, `assigned_by`/`assigned_date`, `stp_arr_confirmed`/`stp_dep_confirmed`, `podName`. C8=1. |
| **A4** Execution events & tracking | 2 | 1 | 1 | 3 | 3 | 2 | 3 | 1 | C1=2: event fields on the stop (`evt_eventcode`,`evt_number`,`eventType`,`evt_status`,`evt_startdate`/`evt_enddate`), exception records (`AttemptedPickupDelivery`, `Diversion`, `EXTDate`, `stp_delayhours`), `LocalSchedule.event`/`work_type` - but **no event history resource and no push** (`README.md` section 2 "Direction of travel"), and no telemetry on the agent surface (GPS exists only on `assetmanagement-v1 PUT /api/containers/gps/{id}`, outside our grant). C2=1 and C3=1: event codes are neither enumerated nor described, and no lookup endpoint publishes them. C4=3: attempted delivery, diversion, shuttle, reweigh, cross-dock, delivery-date extension with delay-claim responsibility. C5=3 (see "Time"). **C7=3**: `EXTDate` (`atlasorder-v1.json:9964`) records reason, explanation, shipment location at delay, delay-claim responsibility and why, who/when, approver/approval time, and the notification's sender/recipient/time/lateness - the single richest provenance record in the catalog; plus `CustomerETA.eta_given_by/to/date_given`. C8=1. |
| **A5** Storage-in-transit | 3 | 2 | 2 | 3 | 3 | 3 | 3 | 1 | **The standout area.** C1=3: `SIT` (`atlasorder-v1.json:13215`) hung off a **stop**, with in/out (`sit_date`, `siT_Out_Date`), duration (`days_authorized`, `additional_authorized_days`, `wait_date_from`/`_to`), warehouse identity (`location_id`, `agent`, `storageWarehouse`), the permanent-storage boundary (`permanent`), variants (`storage_In_Van`, `bonded_Storage`, plus separate `StorageInVan` and `SelfMini` stop services), extension workflow (`extension_request_sent_date`/`extension_request_received_date`) and billing children (first-day / additional-days / cartage activities). C2=2: the distinctions that matter are encoded as separate fields even though undefined. C3=2: a lifecycle traced by dated actor pairs - created -> supervisor-approved -> crossdocked -> cancelled - plus `status`+`reason`. C4=3: `market_Saturated`, `warehouse_full`, `long_Cartage_Denied`, `carrier_Convenience`, `nO_Prior_OPS_Approval`, `airport_Handling` as named SIT causes. C5=3. C6=3: `sit_stop_number` + `sit_xdl_stop_number` bind the SIT to the stop sequence and name the delivery-out stop; `military_control_number`. C7=3: `supervisor_approval_by`/`on`, `auto_authorized`, `customer_contacted`/`customer_number_called`, `crossdocked_by`/`date`, `cancelled_by`/`date`. C8=1. |
| **A6** Documents & evidence | 3 | 1 | 1 | 2 | 2 | 3 | 2 | 2 | C1=3: `documents-v1` with four families (Shipment / AccountsPayable / RiskMgt / Canada), `GET /Shipment/Documents/types`, plus `Paperwork` on the order, `estimating-v2` estimate documents + `ReportDefinitionType` (OrderForService, DeclarationOfValue, TableOfMeasurements, Estimate variants, Valuation - `estimating-v2.json:19046`), `claims-v1 ImageModel`, `cubesheets-v1`. C2=1: document types are a runtime list; `Paperwork.abbr` is an opaque abbreviation. C3=1: `Paperwork.received` + `imaged` imply a two-step lifecycle, undocumented. C4=2: order-for-service / declaration-of-value / table-of-measurements are HHG-native report types; `signed_Premove_BL`; `LockModel.customerSigned`. C5=2: `pwDt`, `createdAt`, `invoiceDate`. C6=3: `ShipmentDocument` carries `orderNumber`+`customerId`+`businessId`+`invoiceNumber`+`vendorCode`; `AccountsPayableDocument` carries `shipment`+`po`+`project`+`vendorId`+`paymentNumber`+`documentNumber`. C7=2: `createdBy`/`createdAt` and the `received`->`imaged` pair, but hard `DELETE` and no versioning. C8=2: `fields` projection, `types` filter, `convertContentTo` server-side conversion, and a `Canada/Documents/ivan-DocType` bypass showing a document-type mapping layer exists. |
| **A7** Charges & billing hooks | 3 | 2 | 1 | 3 | 2 | 3 | 2 | 1 | C1=3: linehaul vs accessorial split on the order (`ord_est_linehaul`/`ord_est_accessorial`/`ord_est_totalcharges`/`ord_max_charges`), the estimated-vs-billed ledger (`AuditorInformation`, `shipment-management-v1.json:1405`), per-stop third-party `AdvancedCharge` with vendor + `advchrgs_payvend` + status, `AgentBilled`, `LogisticsCharge`, `InvoiceData` (`estimating-v2.json:16900`), `PayAuthorization`. C2=2: `ServiceName` (~230 values, `estimating-v2.json:19198`) and `IRatingLineItem` (gross vs net vs discount amount vs discount percentage, each described) are genuinely precise. C3=1: `ivhInvoiceStatus`, `ord_invoicestatus`, `pyd_status` all untyped. C4=3: PBLD/EBLD/shared discount, bound option + bound price + bound discount per service, `TRUCK_ORDERED_NOT_USED`, `PBLD_VARIANCE`, SIT charge families, valuation charges. C5=2: `ivhShipDate`, `ivhDeliveryDate`, `ivhBillDate`, `adhdSettlementDate`, `adhdTariffRateDate`, `adhdMemoDate`. C6=3: `ivhInvoiceNumber`<->`ordNumber`, `adhdRemitScacCode`, `adhdIvhGblNumber`, `adhdIvhRefNumber`/`RefType`. C7=2: rated-by / released-by actor+date pairs, human-vs-engine flag, and `ivhCreditMemo` as the one reversal mechanism. C8=1: `ord_revtype1..4` generic dimensions. |
| **A8** Parties & roles | 3 | 1 | 2 | 3 | 2 | 3 | 2 | 2 | C1=3: booker / origin agent / destination agent / hauling agent / freight forwarder / extending agent / broker / consultant / CSR / private CSR / move monitor / salesperson / estimator / surveyor / driver1-2 / carrier / legHauler / PVO / on-site staff / third-party provider / warehouse / bill-to / national account / claimant. `atlasorder-v1.json:11324,7837,11209,14531`; `agents-v1.json`; `tonnages-v1.json`; `claims-v1.json`. C2=1: `Agent.type`/`type_name`/`authority`/`personnel` have no code list, and roles are expressed twice (typed `agents[]` **and** flat `awg_ord_*_agent` fields) with the relation undefined. C3=2: `activityStatus`, `retentionStatus`, `shipmentAuth` on `AgentModel` each have a dedicated lookup endpoint - an explicit party-lifecycle vocabulary, values not in the spec. C4=3: booking/origin/destination/hauling agent, agent family (`parentAgentCode`, `/Agents/{code}/Family`), agent salespeople, PVO. C5=2: `CompanyModel.effectiveDate`/`expirationDate`, `AgentSalesPersonModel.effectiveDate`/`expirationDate` - temporal validity of a party record. C6=3: `agentCode`, `cmp_id`/`cmp_altid`, `companyId`, `sub_id`, `salesCode`, plus `ApplicationXRefModel`. C7=2: `assigned_by` + `assigned_date` per role assignment. C8=2: `ApplicationXRefModel` is a designed extension point for foreign identity. |
| **A9** Identity & cross-references | 3 | 2 | n/a | 3 | n/a | 3 | 1 | 3 | C1=3 and C6=3: see "Identity" - dual keys on every aggregate, ~40 named identifier kinds, `ReferenceNumber` and `ApplicationXRefModel`. C2=2: `ref_typedesc` makes a reference self-describing; `xRefType`+`application` types a foreign key by owning system. C4=3: GBL, military control number, agent registration number, SCAC on remit-to, order-number-vs-header-number. **C7=1**: nothing records *who asserted* a reference number or when it was issued. C8=3: both mechanisms are open key/type/value designs - a new partner identifier needs no schema change. Gap worth flagging: **no BOL number on the order and no PRO number anywhere** (grep over all 24 specs); `bill_of_lading` appears only on `LocalSchedule`. |

**S5 - fit to Pegasus data.** These are reasoned from the registry's own descriptions of our
internal sources, not from reading Pegasus code (out of scope for this task). Every value below is
a hypothesis to be confirmed in phase 5.

| Area | Fit | Note |
| --- | --- | --- |
| A1 | partial | pegII is the "sale/order" system (`registry.yaml:98` `pegii-order`), and Cloud has a `MoveStatus` state machine (`registry.yaml:55`). Whether either carries Atlas's cancel-reason/category/requestor triple or the accept flags is **unknown** - the registry records that no complete native pegII order exists on disk (`registry.yaml:98` `obtain:`). |
| A2 | partial | Weights and shipment type almost certainly present; auto/boat/progear weight splits and `shipment_Density` unknown. |
| A3 | **yes (best fit)** | `pegii-longhaul` is the only internal model with trip != shipment plus an activity/stop concept, with `TripMaster`, `ShipmentActivity`, `ActivityType` and a declared trip status `Pending -> Offered -> Accepted -> In-Progress -> Finalized` (`registry.yaml:120,130`). Atlas's Trip/Segment/Stop and its `Tonnages` request/accept map onto that almost one-to-one - and pegII's status list is *declared* where Atlas's is not. |
| A4 | partial | `ShipmentActivity` + the `activity-arrival-window` plan (`registry.yaml:120`) suggests arrival windows exist; confirmed-vs-actual and reason-late codes unknown. |
| A5 | unknown | Cloud's `StopType` includes `STORAGE` (`registry.yaml:55`), but nothing indicates SIT authorization days, extensions, cross-dock pairing or the permanent-storage boundary exist in either system. This is the area where Atlas is richest and our fit is least known. |
| A6 | partial | Cloud has a document context (`packages/domain/src/document/index.ts`, `registry.yaml:46`) and we already ship a `document_record` floor (`registry.yaml` `pegasus-integration-floors`). The `received`->`imaged` two-stage paperwork lifecycle is probably not modeled. |
| A7 | partial | Cloud has rating (400NG) and billing contexts; the PBLD/EBLD/shared-discount and agent-distribution concepts are Atlas/van-line-specific and likely absent. |
| A8 | partial | Agent roles: our tenants *are* Atlas agents, so `agentCode` is almost certainly a real value in tenant data - but that it is *stored* in pegII is unverified. |
| A9 | partial | We already hold `IntegrationProjection`/`IntegrationCorrelation` (`registry.yaml` `pegasus-cloud-prisma`), which is the right shape for Atlas's `ApplicationXRef` idea. Whether pegII stores Atlas order numbers is unknown. |

## Strengths worth adopting

1. **Five temporal kinds on one stop, as separate fields.** scheduled / agreed / estimated (ETA-ETD)
   / actual / *confirmed*. Most sources collapse at least two of these. The **confirmed** flag being
   distinct from the actual timestamp (`stp_arr_confirmed`, `stp_dep_confirmed`) is the sharp idea:
   an actual time can be recorded before anyone has confirmed it.
2. **The ETA as a communication, not a value.** `CustomerETA{date_from, date_to, eta_given_to,
   eta_given_by, date_given}` - we should model "a delivery window was promised to someone, by
   someone, at a time" separately from "the current forecast". This is what makes a late delivery
   a *broken promise* rather than a variance.
3. **`EXTDate` as the template for an exception record.** Reason + free explanation + location at
   the time + **who bears the delay-claim responsibility and why** + who asserted it + who approved
   it + who was notified, by whom, when, and whether that notification was late. Copy this shape for
   every exception we model, not just delays.
4. **SIT hung off a stop, with the cross-dock stop named.** `sit_stop_number` + `sit_xdl_stop_number`
   makes the storage-in / delivery-out pairing explicit in the stop sequence rather than implied.
   Combined with `permanent`, `storage_In_Van` and separate `SelfMini`, this is the most complete
   SIT model we have seen so far and should be the reference for A5.
5. **Named causes alongside a free reason.** SIT carries `market_Saturated`, `warehouse_full`,
   `long_Cartage_Denied`, `carrier_Convenience`, `airport_Handling`, `nO_Prior_OPS_Approval` as
   discrete flags *and* a `reason` string. That pattern - enumerate the causes you bill or dispute
   differently, keep prose for the rest - is worth copying into our reason-code design.
6. **Two statuses on every assigned service.** `<service>_cmpid_status` (has the assigned company
   accepted?) and `service_status` (has the service been performed?). Assignment state and execution
   state are genuinely different lifecycles and Atlas keeps them apart on ~14 service types.
7. **Self-describing typed references.** `ReferenceNumber{ref_type, ref_number, ref_typedesc,
   ref_sequence, ref_table, ref_tablekey}` plus `ApplicationXRefModel{application, xRefType,
   foreignKey}`. Cross-references as data with the *owning application* named. Directly informs A9
   and lines up with our existing `IntegrationCorrelation`.
8. **Weight as evidenced fact.** `Reweigh{gross, tare, net, witnessed, ticket_number, scale_Owner,
   participant, shipper_customer_requested}` - the weight, the physical artifact that proves it, who
   owns the scale, whether it was witnessed, and who asked for the reweigh. This is the model for
   "who asserted a fact and with what evidence".
9. **`createdByApp` / `updatedByApp` / `updateApplication`.** Recording the *writing application*
   alongside the user. In a multi-system estate (pegII, Cloud, Atlas, Allied, telematics) this is
   exactly the provenance dimension we will wish we had.
10. **A derivation with its audit trail.** `TransitGuideResponseModel.calculationLog: [string]`
    returns the delivery-day spread *and how it was computed*. Any derived date or fact we publish
    should be able to say why.
11. **The two-key convention.** Integer surrogate + string business key on every aggregate, child
    rows carrying the surrogate, API paths taking the business key. Cheap, and it makes
    correlation unambiguous.
12. **Offer/accept as verbs.** `PUT /Tonnages/request` and `PUT /Tonnages/accept` are the only
    lifecycle transitions modeled as operations. That is the right shape, and it matches pegII Long
    Haul's declared `Pending -> Offered -> Accepted` (`registry.yaml:130`).
13. **Temporal validity on party records.** `effectiveDate`/`expirationDate` on `CompanyModel` and
    `AgentSalesPersonModel` - a party's participation is dated.
14. **A stop's mileage is four numbers.** `stp_ord_mileage` / `stp_lgh_mileage` / `stp_mfh_mileage` /
    `stp_trip_mileage`: the same physical stop accrues distance against the order, the leg, the
    manifest and the trip separately. On a consolidated load these are genuinely different, and any
    single "miles" field is wrong.

## Weaknesses / traps

1. **`shipment-management-v1` nests `trips[]` inside `Shipment` - that inverts the real relation.**
   A trip carries many orders: the stop, not the trip, is what belongs to an order (`Stop` carries
   `ord_hdrnumber`, `lgh_number`, `mov_number` and `mfh_number` independently,
   `atlasorder-v1.json:14029`). Reading the JSON tree literally produces "a shipment has trips",
   which is an artifact of serving the trip *filtered to one order*. **Do not model trip as a child
   of shipment.**
2. **Zero enums means zero vocabulary.** Modeling A1/A3/A4 from these specs without fetching the
   `/Types` endpoints will produce invented status values. A `{"type":"string"}` here is a *closed
   code list we cannot see*, not free text - treating it as free text is the worse error of the two.
3. **`atlasorder-v1` is a database schema on the wire.** `ord_hdrnumber`, `awg_stp_triptype`,
   `evt_eventcode`, `lgh_outstatus`, `cht_itemcode` - table prefixes (`ord_`, `stp_`, `lgh_`, `evt_`,
   `cmp_`, `pyd_`, `mfh_`) and vendor prefixes (`awg_` = Atlas World Group customization, `adhd_`)
   leak the underlying TMS. Add the XML-shaped wrappers (`Orders{order:[]}`, `Trips{trip:[]}`,
   `Stops{stop:[]}`) and this is a serialized database, not a domain model. Adopting its *structure*
   is right; adopting its *names* would import someone's schema into a reference model.
4. **Two competing renderings of the same order, neither canonical.** `Order` (snake_case, ~190
   header fields, 35 child collections) vs `Shipment` (camelCase, ~140 fields, 8 collections). They
   disagree on the trip/segment layer, and `Shipment` silently drops cancellation, military, reweigh,
   reference numbers, attempted deliveries and the ETA/extension dates. Worse, **the richer one is
   the one we cannot call** (`README.md` section 2). Do not let reachability decide the model.
5. **There is no event.** `evt_*` is a field set describing *the current event at a stop* - one per
   stop, overwritten. No history, no append-only log, no `GET /events`, no push (`README.md`
   section 2 "Direction of travel"). Any A4 model built on Atlas alone inherits current-state-only
   semantics with no ordering, no replay and no correction. A4 needs a different primary source.
6. **Roles are modeled twice.** Typed `agents[]` (with `type`, `authority`, `assigned_by`,
   `assigned_date`, `status`) *and* flat `awg_ord_booker` / `awg_ord_origin_agent` /
   `awg_ord_dest_agent` / `awg_ord_freight_forwarder` / `extending_Agent` / `ord_broker` on the
   header. The flat fields are the tempting ones to map; they cap you at six roles and throw away
   assignment provenance. The relation between the two is undocumented and may be lossy in either
   direction.
7. **`additionalProperties: false` with everything nullable and nothing required.** The contract
   asserts a closed shape and no obligations whatsoever - there is not a single `required` array on
   any order/shipment schema. Validity lives entirely outside the spec. Do not infer optionality
   from nullability.
8. **No time zone, anywhere.** And in `atlasorder-v1`, no date `format` either. A reference model
   that copies Atlas's time fields without adding a zone (or a stop-local convention) will be wrong
   the first time it crosses a boundary.
9. **`Business` is not a company.** In `customers-v2`, `Customer` is a *person* and `Business` is the
   *move-level record* that owns the `orderNumber` and the agent codes. Mapping `Business` ->
   "business/company" would be a serious mis-model. (`Company` is a separate concept in
   `agents-v1`.)
10. **SIT activity rows are billing, not events.** `SITFirstDayActivity` /
    `SITAdditionalDaysActivity` / `SITCartageActivity` carry `weight`, `date`, `discount`, `bill`,
    `flat_auto` - they are charge lines. The storage-in/storage-out facts are `sit_date` and
    `siT_Out_Date` on the SIT itself. Using the activity rows as a SIT event source would produce
    billing-cycle "events".
11. **The estimate model is agent- and tariff-centric, not party-centric.** `EstimateModel` has no
    shipper identity at all - only `customerId` / `businessId`. Do not derive party structure from
    A10 material.
12. **No settlement endpoint.** Verified by term frequency across all 24 specs: `settlement` appears
    twice, `remittance` and `disbursement` zero (`README.md` section 2 "Financial data - where
    settlements are not"). Our own grep confirms the only settlement-named field in the catalog is
    `InvoiceData.adhdSettlementDate` (`estimating-v2.json:16900`). Atlas is not a source for A13
    settlement structure.
13. **Beware `GetPreviousShipment`.** `GET /GetPreviousShipmentJson/{orderNumber}` and
    `GetShipmentJson/{orderNumber}` carry *identical* descriptions and the same `Orders` response
    schema. "Previous" is undefined - prior version? prior move for the same shipper? prior leg?
    Do not guess; it is an outreach question.

## Out-of-v1 material

**A10 - survey, estimating & inventory.** The largest surface in the catalog (58 estimating
operations) and the one Atlas's own integration story centres on (`README.md` section 3 G7).

- **Survey as an entity**: `surveyId`, `surveyAgent`, `surveyorCode`, `surveyDate`, `surveyStatus`,
  `surveyMethod`, `surveyAppointmentId`, plus `createdBy`/`updatedBy`/`updateApplication`
  (`shipment-management-v1.json:3169`; `atlasorder-v1.json:14450`). The order header adds
  `awg_ord_oa_to_survey`, `awg_ord_oa_to_do_estimate`, `awg_ord_est_req`, `estimateDate`,
  `estimateDueDate`, `estimateInspectionDate`.
  `PostSurveyRequestModel` (`estimating-v2.json:18097`) adds `performedByAgentCode`,
  `performedDateTime`, `performedBySalesPersonEmail`/`Code`, `method`, `status`.
- **Three survey channels**: in-person (`cubesheets-v1`), **Yembo** AI survey (`yembo-v1`:
  `MoveModel{moveKey, moveUrl, invitationUrl, loadDate, leadId}`), and **Move4U**
  (`move4u-integration-v1`, inbound callbacks to Atlas). `EstimateModel` carries
  `hubspotContactId`/`hubspotMoveId`, so HubSpot is the CRM upstream
  (`POST /WebHooks/HubSpot/Survey`).
- **Cubesheet inventory**: `Cubesheet -> Room{roomId, roomName, canadaRoomCode} -> Item{itemName,
  weight/defaultWeight, volume/defaultVolume, width/height/length, isCrate, isCartonCP,
  isCartonPBO, isBulky, shippingQuantity, notShippingQuantity, packQuantity, unpackQuantity,
  canadaGovernmentItemCode, surveyedItemId}` (`cubesheets-v1.json`). The
  **CP (carrier-packed) vs PBO (packed-by-owner)** distinction and the going/not-going split are
  first-class.
- **Move4U descriptive inventory** adds the tagging layer: `barcode`, `lotNumber`, `itemNumber`,
  `colorCode`, `externalKey`, `isValuable` + `valuableEstimatedValue`, `isVoid` + `voidReason`,
  `canContainItems`, `isDefaultPackedByOwner`, and `conditions[]{damages[], locations[]}` - i.e.
  **condition at origin recorded per item per location** (`move4u-integration-v1.json`). Paired with
  the order's `inventory_Tag_Color` + `inventory_Lot_Number`, this is the origin-inventory /
  destination-exception model.
- **Estimate types**: `bindingType` (values at `/Estimating/Binding/Types` - not fetched),
  `pricingOption`, `accountType`, `isAvailMove`, `isSelfHaul`, `breakpointWeight`,
  `excludedImpliedServices[]`, six separate discount percentages (linehaul / accessorial / packing /
  crating / storage / bottom-line). `ReportDefinitionType` names the customer-facing documents:
  `Estimate`, `ShortEstimate`, `LongEstimate`, `DetailedEstimate`, `SummaryEstimate`,
  `DeclarationOfValue`, `TableOfMeasurements`, `AdditionalServicesPriceList`, `OrderForService`,
  `Valuation`, `EstimateCoverPage`, `ServicePackages` (`estimating-v2.json:19046`).
- **Estimate concurrency**: `LockModel{estimateId, lockDate, userName, lockType, customerSigned}`
  with `GET /Estimating/Locks` and `DELETE /Estimating/Locks/{estimateId}` - the estimate is a
  locked, signable artifact.

**A11 - claims & valuation.**

- `ClaimModel{claimId, claimNumber, claimant, receivedDate, closedDate, thirdParty,
  thirdPartyClaimNumber, temporarilyDetained, comments, orderNumber, items[], images[]}` -
  received/closed dates only; no intermediate states, no adjuster, no settlement amount
  (`claims-v1.json`).
- `ItemModel{itemId, type, isMissing, damageType, category, amountClaimed, number, isCartonDamaged,
  weight, age, originalCost, replacementCost, lotNumber, tagColor, labelName, damages[], images[]}`
  - note `lotNumber`/`tagColor`/`labelName` tie a claimed item back to the origin inventory tag.
- `ItemDamageModel{location, nature, direction}` - damage described on three orthogonal axes, each
  with its own lookup endpoint (`/Item/Damage/Locations`, `/Natures`, `/Directions`), none
  enumerated in the spec.
- **Valuation** is in `estimating-v2`, not `claims-v1`: `ValuationCategory` enum
  (`estimating-v2.json:19917`) is the only released-vs-full-value vocabulary in the catalog, and
  `ValuationModel{amount, deductible, rate, excessRate, freeAmount, type}` with described fields.
  `AuditorInformation` carries the booked side (`valuation`, `valuationType`, `valuationUnit`,
  `valuationFree`, `valuationDeductible`, `valuationRate`, `valuationUnsigned`).

**A12 - rating & tariffs.** `RadsSupport-v1/v2` (45 ops) is a full tariff-authoring model. **Schema
names read, bodies not opened.** Named model families: `Tariff`, `TariffSection`, `TariffService`,
`TariffServiceSubItem`, `TariffServiceSubItemAvailability`, `TariffFactor`, `TariffMileage`,
`CriteriaSet`, `CostLevel`, `WeightCategory`, `RoundMethod`/`RoundType`, `Proviso`,
`ShipmentCharacteristic`, geographic `City`/`County`/`State`/`Country`/`Region`/`Zone`/`ServiceArea`,
and pricing `Contract`/`ContractAmendment`/`ContractAgent`/`ContractFactor`, `PricingMethod`/
`PricingTerm`/`PricingTermFactor`, `Discount`/`DiscountType`, `Commission`/`CommissionType`, `PBLD`,
`InvoiceType`, `PaymentType`, `Factor`/`FactorFamily`/`FactorGroup`/`FactorSection`,
`Act`/`ActGroup`/`ExcludedAct`, `Service`/`ServiceFamily`/`ServiceSubFamily`/`ServiceName`.
`RadsSupport-v2` exposes **17 distinct rate structures** as separate endpoints (`/Tariff/Rates/Flat`,
`/Point`, `/Range`, `/RangeBreakpoint`, `/MileAndWeightRange`, `/MileCubicFeetRange`,
`/TwoDimension`, `/TwoDimensionBreakpoint`, `/State`, `/StateAndRange`, `/CityRouteRange`,
`/ServiceArea`, `/AdjustmentPercentage`, `/FVP`, `/WeightAndValuation`, `/Information`) -
a taxonomy of rate shapes worth mining when A12 is built. `RatingSystem-v1` is a separate
GP-invoice-building engine (`RatingStop`, `RatingService`, `DistributionLineItem`,
`ReleaseToFinanceAVGM`).

**A13 - crew, driver & settlement.**

- `PayAuthorization` (`atlasorder-v1.json:12865`): per-leg payable keyed on `lgh_number` +
  `asgn_number`/`asgn_type`/`asgn_id`, with `pyd_payto`, `pyt_itemcode`, `pyd_rate`/`pyd_amount`,
  `pyd_status`, carrier invoice number/date, `pyd_releasedby`, `pyd_ap_check_date`.
- `RadsSupport` **Distribution** family: `DistributionTerm`, `DistributionTermType`,
  `DistributionTermFactor`, `DistributionMethod`, `AgentRole`, `AgentGroup`,
  `DistributablePricingMethod`, `DistributableTariff`, `LinehaulSlidingScale` + `SlidingScaleValue` -
  i.e. **revenue splits by agent role, on a sliding scale**. Names only; bodies not opened.
- `LocalSchedule` + `LocalScheduleResource` (`atlasorder-v1.json:10621`): local crew/equipment
  scheduling with `work_type`, `event_hours`, `event_piece_count`, `travel_expenses`,
  `leave_warehouse`/`leave_residence`/`return_to_warehouse`, `billed`, and per-resource
  `assignment_type`.
- `OnSiteStaffMember` + `OnSiteStaffMemberLocations` (`atlasorder-v1.json:11209`): named crew with
  roles, bound to specific stop numbers, with `source` and `ciD_Number`.
- `DriverRecord` (`shipment-management-v1.json` `RelatedData`): `id`, `type`, `alternateId`, name
  parts, `payTo`, `fleet`, `division`, `company`.
- `AgentBilled` / `AgentBilledDetail`, `PricingMethodCommissions`, plus the order's
  `lgh_hauling_comm`, `COMMISSIONED_OA` / `PERFORMING_OA` / `ORIGIN_AGENT_COMMISSION` /
  `NON_PARTICIPATING_AGENT` / `STOCKHOLDER` service names.

**Equipment / asset (no rubric area).** `assetmanagement-v1` (49 ops, **not opened**) covers
containers and trailers: usage, repositioning (`start-reposition`, `end-reposition`,
`location-correction`, `trailer-location-correction`), GPS updates, trailer control sheets, and
`GET /api/trips/exists/{moveNumber}`. `location-correction` as a first-class operation is a
correction semantic worth a look if A3/A4 needs one. Excluded from our subscription tier
(`README.md` section 2).

## Open questions

1. **What are the actual code lists?** Every status, event code, stop type and reason in this model
   is behind an unfetched `/Types`-style endpoint (see "Where the code lists actually live"). The
   highest-value single action for this source is to **call the ~35 reference-data endpoints and
   commit the results** - they are small, read-only, and they are the entire semantic layer.
   `GET /Shipments/Notes/Types`, `/Agents/ActivityStatuses`, `/Agents/ShipmentAuths`,
   `/Shipment/Documents/types` and `/Estimating/Stop/Types` are reachable on our current key
   (`README.md` section 2 "Our measured grant"). The claims and authorizations lists are not.
2. **What is the stop event vocabulary (`evt_eventcode`), and is it published at all?** No lookup
   endpoint in the catalog returns stop event codes. If there is none, the A4 vocabulary is
   undiscoverable without a real shipment or an Atlas document. **Blocking for A4.**
3. **What does `GetPreviousShipment` mean?** Identical description and response schema to
   `GetShipment` (`atlasorder-v1.json` paths). Version history? A prior related move? If it is
   history, it is the only correction/versioning mechanism in the catalog and matters a lot for C7.
4. **`isAccepted` vs `hasBeenAccepted`.** Two booleans, no definitions. Presumably "currently
   accepted" vs "was ever accepted" - i.e. a revocable acceptance. Needs confirmation, because
   accept/decline is an A1 transition.
5. **Trip vs Segment: which is real?** `atlasorder-v1` has Trip->Stop with crew on the trip;
   `shipment-management-v1` has Trip->Segment->Stop with crew on the segment. Is `Segment` a newer
   layer, or a rendering artifact? This decides whether crew/equipment assignment is per-trip or
   per-leg - an A3 modeling decision.
6. **What are `mov_number` and `mfh_number`?** A move number above the trip and a manifest number
   between trip and stop, each with its own sequence and mileage. These are the consolidation
   mechanism and they are completely undocumented. Needs an Atlas answer or a real multi-order load.
7. **Is `invoices` on `Shipment` structured?** Declared as literally `{"nullable": true}` - no type,
   no `$ref` (`shipment-management-v1.json:2193`; `README.md` section 2 "Financial data"). It is the
   only reachable structured financial surface and its shape is unknown. Needs **one real QA order
   number** - which is also outreach question 1 in `README.md` section 5.
8. **Does Atlas have any push/event feed outside this catalog?** Everything published is pull-only
   (`README.md` section 5 item 5). A "yes" would change A4 substantially.
9. **How do the flat agent fields relate to `agents[]`?** Is `awg_ord_origin_agent` a denormalized
   copy of an `agents[]` row, or an independent field that can disagree with it? Determines whether
   role assignment has provenance (A8 C7).
10. **Is there a time zone convention?** No zone field exists. Are stop timestamps local to the
    stop, local to Atlas, or UTC? Affects every A3/A4/A5 time claim.
11. **For the user:** our tenants are Atlas agents *and* Allied agents. Does a tenant's Pegasus
    order carry the Atlas `orderNumber` and the tenant's own `agentCode` today, or is the Atlas
    identity only in pegII? This is the S5 question that decides whether Atlas can be a *source*
    for our catalog or only a *comparator* - and it cannot be answered from this source.
12. **For phase 3:** Atlas is the best candidate for A5 (storage-in-transit) and a strong candidate
    for A3, but it is **disqualified as the primary source for A4** because it has no event concept
    (trap 5). It should be mined for A4's *time* and *evidence* vocabulary (C5, C7) while the event
    structure comes from an event-shaped source.
