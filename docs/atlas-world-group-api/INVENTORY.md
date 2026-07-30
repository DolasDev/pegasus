# Atlas World Group (QA) — Full Operation Inventory

Generated from the 24 OpenAPI 3 documents in `openapi/`, exported from the Atlas QA Azure API Management instance on 2026-07-30.

Legend: **OBO** = operation declares the `On-Behalf-Of` header · **MP** = `multipart/form-data` request · **B64** = request or response carries base64 (`format: byte`) file content.

**255 operations across 24 APIs. 142 (55%) declare `On-Behalf-Of`.**

## agents-v1 — Agents (9 ops)

Base: `https://qa-azapi.atlasworldgroup.com/agents/v1`

| Method | Path                              | Summary                           | Flags |
| ------ | --------------------------------- | --------------------------------- | ----- |
| GET    | `/Agents`                         | Get Agents                        |       |
| GET    | `/Agents/ActivityStatuses`        | Get Agent Activity Statuses       |       |
| GET    | `/Agents/ShipmentAuths`           | Get Agent Shipment Authorizations |       |
| GET    | `/Agents/{agentCode}`             | Get Agent                         |       |
| GET    | `/Agents/{agentCode}/Family`      | Get Agent Family                  |       |
| GET    | `/Agents/{agentCode}/SalesPeople` | Get Agent Sales People            |       |
| GET    | `/Companies`                      | Get Companies                     |       |
| GET    | `/Companies/{companyId}`          | Get Company                       |       |
| GET    | `/SalesPeople/{salesCode}`        | Get Salesperson                   |       |

## assetmanagement-v1 — Asset Management (49 ops)

Base: `https://qa-azapi.atlasworldgroup.com/assetmanagement/v1`

| Method | Path                                                | Summary                                         | Flags |
| ------ | --------------------------------------------------- | ----------------------------------------------- | ----- |
| GET    | `/api/container-usages/container-id/{id}`           | Get Current Container Usage by ContainerId      |       |
| POST   | `/api/container-usages/current-usages-report`       | Usage Current Report                            | MP    |
| POST   | `/api/container-usages/end-reposition`              | End a Repositioning                             |       |
| POST   | `/api/container-usages/location-correction`         | Perform a Location Correction                   |       |
| POST   | `/api/container-usages/start-reposition`            | Start a Repositioning                           |       |
| POST   | `/api/container-usages/trailer-location-correction` | Perform a Trailer Location Correction           |       |
| POST   | `/api/container-usages/usage-history-report`        | Usage History Report                            | MP    |
| GET    | `/api/containers`                                   | List Containers                                 |       |
| POST   | `/api/containers`                                   | Upsert Container                                |       |
| GET    | `/api/containers/container-id/{id}`                 | Get Container by ContainerId                    |       |
| POST   | `/api/containers/container-info-report`             | Container Info Report                           | MP    |
| POST   | `/api/containers/container-location-report`         | Container Location Report                       | MP    |
| POST   | `/api/containers/container-status-report`           | Container Status Report                         | MP    |
| PUT    | `/api/containers/gps/{id}`                          | Update Container GPS data                       |       |
| POST   | `/api/containers/import-shipment-data`              | Import Shipment Data                            |       |
| POST   | `/api/containers/import-trailer-trip-data`          | Import Trailer Trip Data                        |       |
| POST   | `/api/containers/request-trailer`                   | Request a Trailer                               |       |
| GET    | `/api/containers/summary`                           | List Containers Summary                         |       |
| POST   | `/api/containers/trailer`                           | Upsert Trailer                                  |       |
| POST   | `/api/containers/trailer-admins-report`             | Trailer Admins Report                           | MP    |
| GET    | `/api/containers/{pk}`                              | Get Container                                   |       |
| POST   | `/api/downloadable-documents`                       | Create a Downloadable Document                  | MP    |
| GET    | `/api/downloadable-documents`                       | List Downloadable Documents                     | B64   |
| GET    | `/api/downloadable-documents/file/{id}`             | Get a Downloadable Document File                |       |
| GET    | `/api/downloadable-documents/{id}`                  | Get a Downloadable Document                     | B64   |
| DELETE | `/api/downloadable-documents/{id}`                  | Delete a Downloadable Document                  |       |
| POST   | `/api/mass-containers/add`                          | Mass Add Containers                             |       |
| POST   | `/api/mass-containers/add-report`                   | Generate Mass Add Report                        | MP    |
| POST   | `/api/mass-containers/edit`                         | Mass Edit Containers                            |       |
| POST   | `/api/mass-containers/edit-report`                  | Generate Mass Edit Report                       | MP    |
| POST   | `/api/mass-containers/validate-edit`                | Validate Mass Edit Containers                   |       |
| GET    | `/api/metadata/all`                                 | List All Metadata                               |       |
| POST   | `/api/notes`                                        | Create a Note                                   | MP    |
| GET    | `/api/notes`                                        | List Notes                                      |       |
| GET    | `/api/notes/file/{id}`                              | Get a Note File                                 |       |
| GET    | `/api/notes/{id}`                                   | Get a Note                                      |       |
| GET    | `/api/search-profiles`                              | /api/search-profiles - GET                      |       |
| POST   | `/api/search-profiles`                              | /api/search-profiles - POST                     |       |
| DELETE | `/api/search-profiles`                              | /api/search-profiles - DELETE                   |       |
| POST   | `/api/trailer-control-sheets`                       | Create a Trailer Control Sheet                  | MP    |
| GET    | `/api/trailer-control-sheets`                       | List Trailer Control Sheets                     | B64   |
| POST   | `/api/trailer-control-sheets/build`                 | Build Trailer Control Sheet                     | MP    |
| GET    | `/api/trailer-control-sheets/file/{id}`             | Get a Trailer Control Sheet File                |       |
| GET    | `/api/trailer-control-sheets/{id}`                  | Get a Trailer Control Sheet                     | B64   |
| DELETE | `/api/trailer-control-sheets/{id}`                  | Delete a Trailer Control Sheet                  |       |
| POST   | `/api/trailerprofile/AddTrailers`                   | /api/trailerprofile/AddTrailers - POST          |       |
| POST   | `/api/trailerprofile/ToggleHiddenTrailers`          | /api/trailerprofile/ToggleHiddenTrailers - POST |       |
| GET    | `/api/trailerprofile/UnaddedTrailers`               | /api/trailerprofile/UnaddedTrailers - GET       |       |
| GET    | `/api/trips/exists/{moveNumber}`                    | Check if trip exists                            |       |

## atlasorder-v1 — AtlasOrder (4 ops)

Base: `https://qa-azapi.atlasworldgroup.com/atlasorder/v1`

| Method | Path                                     | Summary                            | Flags |
| ------ | ---------------------------------------- | ---------------------------------- | ----- |
| GET    | `/GetPreviousShipmentJson/{orderNumber}` | Get Shipment as JSON from Previous |       |
| GET    | `/GetPreviousShipmentXML/{orderNumber}`  | Get Shipment as XML from Previous  |       |
| GET    | `/GetShipmentJson/{orderNumber}`         | Get Shipment as JSON               |       |
| GET    | `/GetShipmentXML/{orderNumber}`          | Get Shipment as XML                |       |

## authorizations-v1 — Authorizations (7 ops)

Base: `https://qa-azapi.atlasworldgroup.com/authorizations/v1`

| Method | Path                                          | Summary                      | Flags |
| ------ | --------------------------------------------- | ---------------------------- | ----- |
| GET    | `/OrderAuthorizations`                        | Gets Authorizations          |       |
| POST   | `/OrderAuthorizations`                        | Posts Authorization          | OBO   |
| GET    | `/OrderAuthorizations/actions`                | Gets Actions                 |       |
| GET    | `/OrderAuthorizations/amountTypes`            | Gets Amount Types            |       |
| GET    | `/OrderAuthorizations/frequentAuthorizations` | Gets Frequent Authorizations |       |
| GET    | `/OrderAuthorizations/{authorizationId}`      | Gets Authorization           |       |
| PUT    | `/OrderAuthorizations/{authorizationId}`      | Puts Authorization           | OBO   |

## claims-v1 — Claims (12 ops)

Base: `https://qa-azapi.atlasworldgroup.com/claims/v1`

| Method | Path                      | Summary                    | Flags |
| ------ | ------------------------- | -------------------------- | ----- |
| POST   | `/Claims`                 | Post Claim                 |       |
| GET    | `/Claims/ContactMethods`  | Get Claim Contact Methods  |       |
| GET    | `/Claims/{claimId}`       | Get Claim                  |       |
| GET    | `/Item/Categories`        | Get Item Categories        |       |
| GET    | `/Item/Damage/Directions` | Get Item Damage Directions |       |
| GET    | `/Item/Damage/Locations`  | Get Item Damage Locations  |       |
| GET    | `/Item/Damage/Natures`    | Get Item Damage Natures    |       |
| GET    | `/Item/DamageTypes`       | Get Item Damage Types      |       |
| GET    | `/Item/TagColor`          | Get Item Tag Colors        |       |
| GET    | `/Item/Types`             | Get Item Types             |       |
| GET    | `/api/Images`             | Get Image                  | B64   |
| POST   | `/api/Images`             | Post Image                 | B64   |

## cubesheets-v1 — Cubesheets (8 ops)

Base: `https://qa-azapi.atlasworldgroup.com/cubesheets/v1`

| Method | Path                               | Summary                                  | Flags |
| ------ | ---------------------------------- | ---------------------------------------- | ----- |
| POST   | `/Cubesheets`                      | Create cubesheet and inventory           | OBO   |
| GET    | `/Cubesheets`                      | Gets cubesheets and inventory            | OBO   |
| GET    | `/Cubesheets/businessLines`        | Gets all cubesheet business lines.       | OBO   |
| GET    | `/Cubesheets/regions`              | Gets all cubesheet regions               | OBO   |
| GET    | `/Cubesheets/settings/itemLists`   | Gets all cubesheet setting item lists.   | OBO   |
| GET    | `/Cubesheets/settings/language`    | Gets all cubesheet setting languages.    | OBO   |
| GET    | `/Cubesheets/settings/ratingModes` | Gets all cubesheet setting rating modes. | OBO   |
| GET    | `/Cubesheets/{cubesheetId}`        | Gets cubesheet and inventory             | OBO   |

## customer-shipment-v1 — CustomerShipment (4 ops)

Base: `https://qa-azapi.atlasworldgroup.com/customer-shipment/v1`

| Method | Path                       | Summary       | Flags |
| ------ | -------------------------- | ------------- | ----- |
| POST   | `/orders`                  | Post Order    |       |
| POST   | `/shipments`               | Post Shipment |       |
| PUT    | `/shipments/{orderNumber}` | Put Shipment  |       |
| GET    | `/shipments/{orderNumber}` | Get Shipment  |       |

## customers-v2 — Customers (10 ops)

Base: `https://qa-azapi.atlasworldgroup.com/customers/v2`

| Method | Path                      | Summary               | Flags |
| ------ | ------------------------- | --------------------- | ----- |
| GET    | `/Businesses/Lines`       | Get Business Lines    | OBO   |
| GET    | `/Businesses/Statuses`    | Get Business Statuses | OBO   |
| GET    | `/Businesses/Tariffs`     | Get Business Tariffs  | OBO   |
| GET    | `/Customers`              | Get Customers         | OBO   |
| POST   | `/Customers`              | Post Customer         | OBO   |
| GET    | `/Customers/{customerId}` | Get Customer          | OBO   |
| PUT    | `/Customers/{customerId}` | Put Customer          | OBO   |
| GET    | `/Location/States`        | Get Location States   | OBO   |
| GET    | `/Location/Types`         | Get Location Types    | OBO   |
| GET    | `/Phones/Types`           | Get Phone Types       | OBO   |

## documents-v1 — Documents (13 ops)

Base: `https://qa-azapi.atlasworldgroup.com/documents/v1`

| Method | Path                                      | Summary                                              | Flags   |
| ------ | ----------------------------------------- | ---------------------------------------------------- | ------- |
| POST   | `/AccountsPayable/Documents`              | Posts a Accounts Payable Document.                   | OBO B64 |
| GET    | `/AccountsPayable/Documents/{documentId}` | Gets a Accounts Payable Document.                    | OBO B64 |
| DELETE | `/AccountsPayable/Documents/{documentId}` | Deletes a Accounts Payable Document.                 | OBO     |
| POST   | `/Canada/Documents`                       | Creates a Canada document.                           | OBO B64 |
| POST   | `/Canada/Documents/ivan-DocType`          | Creates a Canada document (using Ivan Document Type) | OBO B64 |
| POST   | `/RiskMgt/Documents`                      | Post RiskMgt Document.                               | OBO B64 |
| GET    | `/RiskMgt/Documents/{documentId}`         | Get RiskMgt Document.                                | OBO B64 |
| DELETE | `/RiskMgt/Documents/{documentId}`         | Delete RiskMgt Document.                             | OBO     |
| GET    | `/Shipment/Documents`                     | Get Shipment Documents                               | OBO B64 |
| POST   | `/Shipment/Documents`                     | Post Shipment Document                               | OBO B64 |
| GET    | `/Shipment/Documents/types`               | Get Shipment Documents Types                         | OBO     |
| GET    | `/Shipment/Documents/{documentId}`        | Get Shipment Document                                | OBO B64 |
| DELETE | `/Shipment/Documents/{documentId}`        | Delete Shipment Document                             | OBO     |

## echo-api — Echo API (6 ops)

Base: `https://qa-azapi.atlasworldgroup.com/echo`

| Method | Path               | Summary                    | Flags |
| ------ | ------------------ | -------------------------- | ----- |
| GET    | `/resource`        | Retrieve resource          |       |
| PUT    | `/resource`        | Modify Resource            |       |
| POST   | `/resource`        | Create resource            |       |
| DELETE | `/resource`        | Remove resource            |       |
| HEAD   | `/resource`        | Retrieve header only       |       |
| GET    | `/resource-cached` | Retrieve resource (cached) |       |

## emailing-v1 — Emailing (1 ops)

Base: `https://qa-azapi.atlasworldgroup.com/emailing/v1`

| Method | Path      | Summary                  | Flags |
| ------ | --------- | ------------------------ | ----- |
| POST   | `/Emails` | Creates email to be sent |       |

## estimating-v2 — Estimating (58 ops)

Base: `https://qa-azapi.atlasworldgroup.com/estimating/v2`

| Method | Path                                          | Summary                            | Flags   |
| ------ | --------------------------------------------- | ---------------------------------- | ------- |
| POST   | `/Estimating`                                 | Post Estimate                      | OBO     |
| GET    | `/Estimating/Account/Types`                   | Get Account Types                  | OBO     |
| GET    | `/Estimating/AdvanceCharge/Types`             | Get Advance Charge Types           | OBO     |
| GET    | `/Estimating/Agent/{agentCode}`               | Get Agent                          | OBO     |
| GET    | `/Estimating/Agent/{agentCode}/Salespeople`   | Get Agent Salespeople              | OBO     |
| GET    | `/Estimating/Appliance/Types`                 | Get Appliance Types                | OBO     |
| GET    | `/Estimating/Authorization/AmountTypes`       | Get Authorization Amount Types     | OBO     |
| GET    | `/Estimating/Authorization/Types`             | Get Authorization Types            | OBO     |
| GET    | `/Estimating/Binding/Types`                   | Get Binding Types                  | OBO     |
| GET    | `/Estimating/BridgeFerry/Types`               | Get Bridge Ferry Types             | OBO     |
| GET    | `/Estimating/Bulky/Types`                     | Get Bulky Types                    | OBO     |
| GET    | `/Estimating/BusinessCodes`                   | Get Business Codes                 | OBO     |
| GET    | `/Estimating/Container/Types`                 | Get Container Types                | OBO     |
| GET    | `/Estimating/Crating/Types`                   | Get Crating Types                  | OBO     |
| POST   | `/Estimating/CreateOrder`                     | Create Order                       | OBO     |
| GET    | `/Estimating/DebrisRemoval/Types`             | Get Debris Removal Types           | OBO     |
| POST   | `/Estimating/Document`                        | Post Document                      | OBO B64 |
| PUT    | `/Estimating/Document`                        | Put Document                       | OBO B64 |
| DELETE | `/Estimating/Document/{documentId}`           | Delete Document                    | OBO     |
| GET    | `/Estimating/Document/{documentId}`           | Get Document                       | OBO B64 |
| GET    | `/Estimating/Estimate/{estimateId}/Documents` | Get Documents by Estimate          | OBO B64 |
| GET    | `/Estimating/Estimates`                       | Get Estimates                      | OBO     |
| GET    | `/Estimating/Estimates/{estimateId}`          | Get Estimate                       | OBO     |
| GET    | `/Estimating/HourlyServiceTypes`              | Get Hourly Service Types           | OBO     |
| GET    | `/Estimating/HourlyTypes`                     | Get Hourly Types                   | OBO     |
| GET    | `/Estimating/ImpliedServices`                 | Get Implied Services               | OBO     |
| GET    | `/Estimating/LeadSource/Types`                | Get Lead Source Types              | OBO     |
| GET    | `/Estimating/Locks`                           | Get Locks                          | OBO     |
| DELETE | `/Estimating/Locks/{estimateId}`              | Delete Lock                        | OBO     |
| GET    | `/Estimating/MaxDiscounts`                    | Get Max Discounts                  | OBO     |
| GET    | `/Estimating/Order`                           | Get Order                          | OBO     |
| GET    | `/Estimating/Packing/Carton/Types`            | Get Packing Carton Types           | OBO     |
| GET    | `/Estimating/Packing/Schedules`               | Get Packing Schedules              | OBO     |
| GET    | `/Estimating/Packing/Types`                   | Get Packing Types                  | OBO     |
| GET    | `/Estimating/Phone/Types`                     | Get Phone Types                    | OBO     |
| GET    | `/Estimating/Pricing/PricingMethod`           | Get Pricing Method Info            | OBO     |
| POST   | `/Estimating/Pricing/PricingMethod/Discounts` | Calculate Pricing Method Discounts | OBO     |
| POST   | `/Estimating/Pricing/PricingMethod/Valuation` | Calculate Pricing Method Valuation | OBO     |
| GET    | `/Estimating/PricingOption/Types`             | Get Pricing Option Types           | OBO     |
| POST   | `/Estimating/Rate`                            | Rate Estimate                      | OBO     |
| POST   | `/Estimating/Rate/CreateSummary`              | Creates a rating summary           | OBO     |
| GET    | `/Estimating/Rate/Summary`                    | Retrieves a rating summary         | OBO     |
| POST   | `/Estimating/Rate/Summary`                    | Saves a rating summary             | OBO     |
| GET    | `/Estimating/Referral/PricingMethods`         | Referral Program Pricing Methods   | OBO     |
| GET    | `/Estimating/Referral/Programs`               | Get Referral Programs              | OBO     |
| POST   | `/Estimating/Reports`                         | Generate Reports                   | OBO     |
| GET    | `/Estimating/Reports/Definitions`             | Get Report Definitions             | OBO     |
| GET    | `/Estimating/Stop/Types`                      | Get Stop Types                     | OBO     |
| GET    | `/Estimating/Tariffs`                         | Get Tariffs                        | OBO     |
| GET    | `/Estimating/Tariffs/PricingMethods`          | Get Pricing Methods                | OBO     |
| GET    | `/Estimating/TaxExempt/Types`                 | Get Tax Exempt Types               | OBO     |
| GET    | `/Estimating/Validation/Referral`             | Validate Referral                  | OBO     |
| GET    | `/Estimating/Valuation/Types`                 | Get Valuation Types                | OBO     |
| GET    | `/Estimating/Vehicle/RateTypes`               | Get Vehicle Rate Types             | OBO     |
| GET    | `/Estimating/Vehicle/Types`                   | Get Vehicle Types                  | OBO     |
| GET    | `/Estimating/Waterhaul/Ports`                 | Get Waterhaul Ports                | OBO     |
| POST   | `/WebHooks/Atlas/Order`                       | Post WebHook Atlas Order           | OBO     |
| POST   | `/WebHooks/HubSpot/Survey`                    | Post WebHook HubSpot Survey        | OBO     |

## finance-v1 — Finance (2 ops)

Base: `https://qa-azapi.atlasworldgroup.com/finance/v1`

| Method | Path                                                  | Summary                  | Flags |
| ------ | ----------------------------------------------------- | ------------------------ | ----- |
| GET    | `/invoicedelivery/MadEmails/{agentBranch}/{division}` | Get MAD emails           |       |
| GET    | `/invoicedelivery/ReloDirectEntities`                 | Get Relo Direct Entities |       |

## holidays-v1 — Holidays (4 ops)

Base: `https://qa-azapi.atlasworldgroup.com/holidays/v1`

| Method | Path                                           | Summary                  | Flags |
| ------ | ---------------------------------------------- | ------------------------ | ----- |
| GET    | `/Calendars/Names`                             | Get Calendar Names       |       |
| GET    | `/Calendars/{calendarName}/Holidays`           | Get Holidays             |       |
| GET    | `/Calendars/{calendarName}/NextWorkingDay`     | Get Next Working Day     |       |
| GET    | `/Calendars/{calendarName}/PreviousWorkingDay` | Get Previous Working Day |       |

## mileage-v1 — Mileage (4 ops)

Base: `https://qa-azapi.atlasworldgroup.com/mileage/v1`

| Method | Path           | Summary            | Flags |
| ------ | -------------- | ------------------ | ----- |
| GET    | `/AmsaMileage` | /AmsaMileage - GET |       |
| GET    | `/Mileage`     | /Mileage - GET     |       |
| GET    | `/PCMiler`     | /PCMiler - GET     |       |
| GET    | `/Rand19`      | /Rand19 - GET      |       |

## move4u-integration-v1 — Move4UIntegration (3 ops)

Base: `https://qa-azapi.atlasworldgroup.com/move4u-integration/v1`

| Method | Path         | Summary           | Flags |
| ------ | ------------ | ----------------- | ----- |
| POST   | `/callbacks` | Post Callback     |       |
| GET    | `/callbacks` | Get Callback Logs |       |
| GET    | `/items`     | /items - GET      |       |

## questionnaire-v1 — Questionnaire (1 ops)

Base: `https://qa-azapi.atlasworldgroup.com/questionnaire/v1`

| Method | Path                 | Summary                   | Flags |
| ------ | -------------------- | ------------------------- | ----- |
| GET    | `/API/Questionnaire` | Search Questionnaire Data |       |

## RadsSupport-v1 — Rads Support (14 ops)

Base: `https://qa-azapi.atlasworldgroup.com/RadsSupport/v1`

| Method | Path                                           | Summary                                 | Flags |
| ------ | ---------------------------------------------- | --------------------------------------- | ----- |
| GET    | `/Distribution/Term/{distributionTermId}`      | Get Distribution Term                   | OBO   |
| GET    | `/Distribution/Terms`                          | Get Distribution Terms                  | OBO   |
| GET    | `/LabelFile`                                   | Get LabelFile Entries                   | OBO   |
| GET    | `/Pricing/Contract`                            | Get Contract                            | OBO   |
| GET    | `/Pricing/Method`                              | Get Pricing Method                      | OBO   |
| GET    | `/Pricing/MethodTypes`                         | Get Pricing Method Types                | OBO   |
| GET    | `/Pricing/Term`                                | Get Pricing Term                        | OBO   |
| GET    | `/Pricing/Term/{pricingTermId}/CriteriaSet`    | Get Pricing Term CriteriaSet            | OBO   |
| GET    | `/Pricing/Terms`                               | Get Pricing Terms for Pricing Method    | OBO   |
| GET    | `/Tariff`                                      | Get Tariff                              | OBO   |
| GET    | `/Tariff/BridgeFerry`                          | Get Bridge/Ferry Services per Tariff    | OBO   |
| GET    | `/Tariff/CriteriaSet/{tariffServiceSubItemId}` | Get Tariff Service Sub Item CriteriaSet | OBO   |
| GET    | `/Tariff/ValuationOptions`                     | Get Tariff Valuation Options            | OBO   |
| GET    | `/Zones`                                       | Get Zones                               | OBO   |

## RadsSupport-v2 — Rads Support (31 ops)

Base: `https://qa-azapi.atlasworldgroup.com/RadsSupport/v2`

| Method | Path                                           | Summary                                                   | Flags |
| ------ | ---------------------------------------------- | --------------------------------------------------------- | ----- |
| GET    | `/Distribution/Term`                           | Get Distribution Term                                     | OBO   |
| GET    | `/Distribution/Terms`                          | Get Distribution Terms                                    | OBO   |
| GET    | `/LabelFile`                                   | Get LabelFile Entries                                     | OBO   |
| GET    | `/Pricing/Contract`                            | Get Contract                                              | OBO   |
| GET    | `/Pricing/Contracts`                           | Get Contracts                                             | OBO   |
| GET    | `/Pricing/Method`                              | Get Pricing Method                                        | OBO   |
| GET    | `/Pricing/MethodTypes`                         | Get Pricing Method Types                                  | OBO   |
| GET    | `/Pricing/Term`                                | Get Pricing Term                                          | OBO   |
| GET    | `/Pricing/Term/{pricingTermId}/CriteriaSet`    | Get Pricing Term CriteriaSet                              | OBO   |
| GET    | `/Pricing/Terms`                               | Get Pricing Terms for Pricing Method                      | OBO   |
| GET    | `/Tariff`                                      | Get Tariff                                                | OBO   |
| GET    | `/Tariff/BridgeFerry`                          | Get Bridge/Ferry Services per Tariff                      | OBO   |
| GET    | `/Tariff/CriteriaSet/{tariffServiceSubItemId}` | Get Tariff Service Sub Item CriteriaSet                   | OBO   |
| GET    | `/Tariff/Rates/AdjustmentPercentage`           | Get Adjustment Percentage Rates for Tariff by SubItem     | OBO   |
| GET    | `/Tariff/Rates/CityRouteRange`                 | Get City Route and Range Rates for Tariff by SubItem      | OBO   |
| GET    | `/Tariff/Rates/FVP`                            | Get Full Valuation Protection Rates for Tariff by SubItem | OBO   |
| GET    | `/Tariff/Rates/Flat`                           | Get Flat Rates for Tariff by SubItem                      | OBO   |
| GET    | `/Tariff/Rates/Information`                    | Get Information on Rates for Tariff by SubItem            | OBO   |
| GET    | `/Tariff/Rates/MileAndWeightRange`             | Get Mile & Weight Rates for Tariff by SubItem             | OBO   |
| GET    | `/Tariff/Rates/MileCubicFeetRange`             | Get Mile Cubic Feet Range Rates for Tariff by SubItem     | OBO   |
| GET    | `/Tariff/Rates/Point`                          | Get Point Rates for Tariff by SubItem                     | OBO   |
| GET    | `/Tariff/Rates/Range`                          | Get Range Rates for Tariff by SubItem                     | OBO   |
| GET    | `/Tariff/Rates/RangeBreakpoint`                | Get Range by Breakpoint Rates for Tariff by SubItem       | OBO   |
| GET    | `/Tariff/Rates/ServiceArea`                    | Get Service Area Rates for Tariff by SubItem              | OBO   |
| GET    | `/Tariff/Rates/State`                          | Get State Rates for Tariff by SubItem                     | OBO   |
| GET    | `/Tariff/Rates/StateAndRange`                  | Get State by Route and Range Rates for Tariff by SubItem  | OBO   |
| GET    | `/Tariff/Rates/TwoDimension`                   | Get Two Dimension Rates for Tariff by SubItem             | OBO   |
| GET    | `/Tariff/Rates/TwoDimensionBreakpoint`         | Get Two Dimension Breakpoint Rates for Tariff by SubItem  | OBO   |
| GET    | `/Tariff/Rates/WeightAndValuation`             | Get Weight & Valuation Rates for Tariff by SubItem        | OBO   |
| GET    | `/Tariff/ValuationOptions`                     | Get Tariff Valuation Options                              | OBO   |
| GET    | `/Zones`                                       | Get Zones                                                 | OBO   |

## RatingSystem-v1 — Rating System (2 ops)

Base: `https://qa-azapi.atlasworldgroup.com/RatingSystem/v1`

| Method | Path                         | Summary                                    | Flags |
| ------ | ---------------------------- | ------------------------------------------ | ----- |
| GET    | `/IsEligibile/{orderNumber}` | Order Eligbility for the new Rating System | OBO   |
| GET    | `/RateOrder/{orderNumber}`   | Rate Order                                 | OBO   |

## shipment-management-v1 — Shipment Management (4 ops)

Base: `https://qa-azapi.atlasworldgroup.com/shipment-management/v1`

| Method | Path                             | Summary                 | Flags |
| ------ | -------------------------------- | ----------------------- | ----- |
| GET    | `/Shipments/Notes/Types`         | Get Shipment Note Types | OBO   |
| GET    | `/shipments/{orderNumber}`       | Get Shipment            | OBO   |
| PUT    | `/shipments/{orderNumber}`       | Put Shipment            | OBO   |
| POST   | `/shipments/{orderNumber}/Notes` | Post Shipment Note      | OBO   |

## tonnages-v1 — Tonnages (3 ops)

Base: `https://qa-azapi.atlasworldgroup.com/tonnages/v1`

| Method | Path                | Summary          | Flags |
| ------ | ------------------- | ---------------- | ----- |
| GET    | `/Tonnages`         | Get Tonnages     |       |
| PUT    | `/Tonnages/accept`  | Accept Tonnages  |       |
| PUT    | `/Tonnages/request` | Request Tonnages |       |

## transitguide-v1 — Transit Guide (1 ops)

Base: `https://qa-azapi.atlasworldgroup.com/transitguide/v1`

| Method | Path            | Summary           | Flags |
| ------ | --------------- | ----------------- | ----- |
| POST   | `/TransitGuide` | Get Transit Guide |       |

## yembo-v1 — Yembo (5 ops)

Base: `https://qa-azapi.atlasworldgroup.com/Yembo/v1`

| Method | Path              | Summary            | Flags |
| ------ | ----------------- | ------------------ | ----- |
| GET    | `/Companies`      | Get Companies      |       |
| GET    | `/Locations/Type` | Get Location Types |       |
| GET    | `/Moves`          | Get Moves          |       |
| POST   | `/Moves`          | Post Move          |       |
| GET    | `/Moves/{moveId}` | Get Move           |       |
