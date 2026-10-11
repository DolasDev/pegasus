# Symptom index — from legacy MoveManager code into the domain reference

**GENERATED — do not edit.** Rewrite with `npm run symptom-index -w @pegasus/domain-reference`. Generator: `packages/domain-reference/tools/generate-symptom-index.ts`. Catalog `0.7.0`.

> A session refactoring legacy WinForms logic arrives holding a MODULE FOLDER or a FORM NAME, never a fact class. glossary.md is indexed by vocabulary (Aggregates, Record types, Bases) and offers no path in from a symptom. This table is that path.

**How to use it.** Find your module folder. The **what the model can say** column is derived from the published catalog, so it is current: it tells you whether the concept has an authority row, whether that row is **owed** and to whom, and whether the concept is an **absent fact class** — which means the reference has nothing for you yet, and silence would have been the alternative. Then read the note, then the area documents.

**Then check what the reading is worth.** The **can you re-check it?** column says whether the sources behind that module's authority rows are bytes you can open or prose nobody can verify — `● re-checkable`, `◐ mixed`, `○ no recourse`. It is derived per row from `data/authority-table.json` and `sources/registry.yaml`, and the two recourse sections below give the detail. **Where the model and your legacy code disagree, this is what tells you which of the two can be checked.**

**What is authored and what is derived.** The legacy→concept correspondence is **`[ORIGINAL]`** — the reference model is built from external sources only ([SD §0]) and knows nothing about MoveManager, so the mapping is judgement and each row states the `basis` it was read from. Everything in the status column is **derived** from `catalog/index.json` and the vocabulary, and the generator **refuses to build** if the two disagree.

## The legacy side, and when it was measured

Measured **2026-10-10** against `movemanager` (private) at commit **`f0abdf16`** on `master`, committed 2026-09-03; root `Pegasus/MoveManager`.

**28** module folders · **242** forms · **75,724** lines of VB. Elsewhere in that repo: **52** viewModelsProject · **128** pureDomainCore · **303** legacyDataTypes.

> Counts below were MEASURED at that commit, not estimated: .vb files excluding .Designer.vb, walked per module folder. They are captured here because the generator runs in CI, where movemanager does not exist. They WILL drift — they are context for ranking, not a contract, and `measuredAt` is how a reader knows how stale they are.

## The index

| legacy module                   | legacy vocabulary                                                | reference concepts                                                                                                                                 | what the model can say                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | can you re-check it?                                                         | read?         |
| ------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------- |
| **`_Account/`**                 | account, account memo, contract information                      | `partyRole` · `identity`<br>_aggregates:_ `party`, `partyRole`<br>_areas:_ A8, A9                                                                  | **authority row:** `identity`<br>**authority OWED:** `partyRole` → [A8 §9 item 2] — the role enum, refused on evidence                                                                                                                                                                                                                                                                                                                                                                                                                                   | ◐ mixed<br>_captured-here · retained-elsewhere · local-only · analysis-only_ | ●● read       |
| **`_Billing/`**                 | invoice, budget, billing                                         | `charge` · `documentIssuance`<br>_aggregates:_ `charge`, `document`<br>_areas:_ A7, A6                                                             | **authority row:** `charge`, `documentIssuance`<br>**fact-class family owed:** `charge`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ◐ mixed<br>_captured-here · retained-elsewhere · local-only · analysis-only_ | ●● read       |
| **`_Configuration/`**           | configuration                                                    | —                                                                                                                                                  | _no reference concept — see the note_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●● read       |
| **`_Crew/`**                    | crew, crew history                                               | `partyRole` · `assignmentOffer` · `assignmentResponse` · `assignmentRelease`<br>_aggregates:_ `partyRole`, `assignment`, `resource`<br>_areas:_ A3 | **authority OWED:** `partyRole` → [A8 §9 item 2] — the role enum, refused on evidence; `assignmentOffer` → [A8 §9 item 8]; `assignmentResponse` → [A8 §9 item 8]; `assignmentRelease` → [A8 §9 item 8]                                                                                                                                                                                                                                                                                                                                                   | —                                                                            | ●○ from names |
| **`_Database/`**                | database maintenance, copy table                                 | —                                                                                                                                                  | _no reference concept — see the note_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●● read       |
| **`_Driver/`**                  | driver, settlement, driver debit, pay group                      | `partyRole` · `charge` · `assignmentOffer` · `assignmentResponse`<br>_aggregates:_ `partyRole`, `charge`, `assignment`<br>_areas:_ A3, A7, A8      | **authority row:** `charge`<br>**authority OWED:** `partyRole` → [A8 §9 item 2] — the role enum, refused on evidence; `assignmentOffer` → [A8 §9 item 8]; `assignmentResponse` → [A8 §9 item 8]<br>**fact-class family owed:** `charge`                                                                                                                                                                                                                                                                                                                  | ◐ mixed<br>_captured-here · retained-elsewhere · analysis-only_              | ●● read       |
| **`_Employee/`**                | employee, salesman, commission                                   | `partyRole`<br>_aggregates:_ `partyRole`, `party`<br>_areas:_ A8                                                                                   | **authority OWED:** `partyRole` → [A8 §9 item 2] — the role enum, refused on evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●● read       |
| **`_Flash/`**                   | flash, flash recap, flash accounting, flash billing, flash claim | —                                                                                                                                                  | **ABSENT fact class:** `claim`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                            | ●● read       |
| **`_FlatRateAuto/`**            | flat rate auto, contract number, auto transport                  | `charge`<br>_aggregates:_ `charge`<br>_areas:_ A7                                                                                                  | **authority row:** `charge`<br>**fact-class family owed:** `charge`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ◐ mixed<br>_captured-here · retained-elsewhere · analysis-only_              | ●● read       |
| **`_Lead/`**                    | lead, lead demo, opportunity                                     | `identity`<br>_aggregates:_ `party`, `order`<br>_areas:_ A1                                                                                        | **authority row:** `identity`<br>**ABSENT fact class:** `estimate`, `survey`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ◐ mixed<br>_captured-here · retained-elsewhere · local-only · analysis-only_ | ●● read       |
| **`_LocalDispatch/`**           | local dispatch, job, dispatch date                               | `arrival` · `departure` · `loading` · `unloading`<br>_aggregates:_ `trip`, `stop`, `stopAction`<br>_areas:_ A3, A4                                 | **authority row:** `arrival`, `departure`, `loading`, `unloading`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ◐ mixed<br>_captured-here · retained-elsewhere · local-only · analysis-only_ | ●○ from names |
| **`_Masters/`**                 | master data, pay group, driver settlement detail                 | —                                                                                                                                                  | _no reference concept — see the note_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●○ from names |
| **`_MenuSpecifications/`**      | report menu                                                      | —                                                                                                                                                  | _no reference concept — see the note_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●● read       |
| **`_Ops/`**                     | service monitor                                                  | —                                                                                                                                                  | _no reference concept — see the note_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●● read       |
| **`_Person/`**                  | person, user login                                               | `partyRole` · `identity`<br>_aggregates:_ `party`, `partyRole`<br>_areas:_ A8, A9                                                                  | **authority row:** `identity`<br>**authority OWED:** `partyRole` → [A8 §9 item 2] — the role enum, refused on evidence                                                                                                                                                                                                                                                                                                                                                                                                                                   | ◐ mixed<br>_captured-here · retained-elsewhere · local-only · analysis-only_ | ●● read       |
| **`_Portal/`**                  | portal user, portal documents                                    | `documentIssuance` · `identity`<br>_aggregates:_ `document`, `party`<br>_areas:_ A6                                                                | **authority row:** `documentIssuance`, `identity`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ◐ mixed<br>_captured-here · retained-elsewhere · local-only · analysis-only_ | ●○ from names |
| **`_PremiumServiceDetail/`**    | premium service, third party service order, crate, crating       | `charge` · `packing`<br>_aggregates:_ `charge`, `shipment`<br>_areas:_ A7                                                                          | **authority row:** `charge`, `packing`<br>**fact-class family owed:** `charge`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ◐ mixed<br>_captured-here · retained-elsewhere · local-only · analysis-only_ | ●● read       |
| **`_Sale/`**                    | sale, sale memo, service authorization                           | `orderResponse` · `orderAward` · `orderCancellation`<br>_aggregates:_ `order`, `shipment`<br>_areas:_ A1, A2                                       | **authority row:** `orderResponse`<br>**authority OWED:** `orderAward` → [A8 §9 item 8] — [A8 §5] has no order row; `orderCancellation` → [A8 §9 item 8] — owed, and NO LONGER on the boundBy gap: the binding is AWARD. What is owed is the HOLDER. [A1 §3.5] makes a cancellation after acceptance "either party", a refused one the counterparty of the requestor, and its open defect leaves a completed cancellation with no requestor field at all — so authoritative would be plural, A8-NAMED requires a tie-break, and no source publishes one. | ◐ mixed<br>_captured-here · refs-in-repo · analysis-only_                    | ●● read       |
| **`_Shared/`**                  | form support, postal address                                     | —                                                                                                                                                  | _no reference concept — see the note_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●● read       |
| **`_StoredProcedures/`**        | stored procedure                                                 | —                                                                                                                                                  | _no reference concept — see the note_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●● read       |
| **`_SurveyResults/`**           | survey, survey results, service authorization                    | —<br>_aggregates:_ `shipment`<br>_areas:_ A10                                                                                                      | **ABSENT fact class:** `survey`, `estimate`, `cube`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                            | ●● read       |
| **`_Task/`**                    | task, master task                                                | `notification`<br>_areas:_ A4                                                                                                                      | **authority OWED:** `notification` → [A8 §9 item 6] — the party as a notification target; the row is provisional throughout ([SD §4.7.3])<br>**fact-class family owed:** `notification`                                                                                                                                                                                                                                                                                                                                                                  | —                                                                            | ●○ from names |
| **`_TestForms/`**               | test forms                                                       | —                                                                                                                                                  | _no reference concept — see the note_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            | ●● read       |
| **`_TextMessaging/`**           | texting, SMS, unread notifier                                    | `notification`<br>_areas:_ A4                                                                                                                      | **authority OWED:** `notification` → [A8 §9 item 6] — the party as a notification target; the row is provisional throughout ([SD §4.7.3])<br>**fact-class family owed:** `notification`                                                                                                                                                                                                                                                                                                                                                                  | —                                                                            | ●● read       |
| **`_Vehicle/`**                 | vehicle, vehicle repair                                          | `identity`<br>_aggregates:_ `resource`<br>_areas:_ A3                                                                                              | **authority row:** `identity`<br>**ABSENT fact class:** `resourceTareWeight`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ◐ mixed<br>_captured-here · retained-elsewhere · local-only · analysis-only_ | ●○ from names |
| **`_WarehouseCommercial/`**     | project, warehouse shipment, commercial                          | `storeIn` · `storeOut`<br>_aggregates:_ `stay`, `shipment`<br>_areas:_ A5                                                                          | **authority row:** `storeIn`, `storeOut`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ○ closed — unverifiable<br>_analysis-only_                                   | ●○ from names |
| **`_WarehouseHouseholdGoods/`** | in storage, storage detail, SIT, warehouse                       | `storeIn` · `storeOut` · `sitEntryDate` · `pieceCount` · `condition`<br>_aggregates:_ `stay`, `item`<br>_areas:_ A5                                | **authority row:** `storeIn`, `storeOut`, `sitEntryDate`, `pieceCount`, `condition`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ◐ mixed<br>_captured-here · local-only · analysis-only_                      | ●● read       |
| **`_zUnsorted/`**               | dispatch sheet, dispatch log, unsorted                           | `arrival` · `departure`<br>_aggregates:_ `trip`, `stop`<br>_areas:_ A3, A4                                                                         | **authority row:** `arrival`, `departure`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ◐ mixed<br>_captured-here · analysis-only_                                   | ●○ from names |

**Confidence legend.** **●● read** — The correspondence was taken from form names AND at least one form or folder listing was opened this session. **●○ from names** — Taken from form names alone. The names in this domain are unusually literal, but a form named for a noun can still hold logic about three others. **○○ unknown** — Could not be named without reading the code. Recorded as unknown rather than guessed — [SD §0]'s disclosure rule applies to this table too.

## Module notes — read the one for your module before mapping anything

### `_Account/`

- **Read from:** AccountMaintenanceForm, AcctMemosMaintenanceForm.
- **Confidence:** ●● read

"Account" is the commercial counterparty. The reference's nearest role is `accountParty` — A8-NAME-2's half of the word "shipper": the party that contracts and pays, as distinct from `goodsOwner`, the party whose goods move. That distinction is load-bearing and was the catalog's first BREAKING change (`customer` → `goodsOwner`, 0.7.0); do not collapse the two.

### `_Billing/`

- **Read from:** InvoiceMasterMaintenanceForm, BudgetMasterMaintenanceForm — the second-largest module at 8,872 lines.
- **Confidence:** ●● read

`charge` exists but its VALUE is owed (A7/A12 — the corpus publishes gross/net/discount as field names and defines them nowhere), and `chargeCollection` is an ABSENT fact class. So this module's biggest concepts are the ones the reference is thinnest on. Read [A7] before trusting a mapping here.

### `_Configuration/`

- **Read from:** ConfigurationForm, 77 lines.
- **Confidence:** ●● read

Application configuration. Not domain.

### `_Crew/`

- **Read from:** CrewMaintenanceForm, NewCrewHistoryMaintenanceForm.
- **Confidence:** ●○ from names

[A8 §9 item 3] decided that crew-member grain rides on the ROLE and the identifying scheme, never on a class field on the party. "Crew history" is the effective-dated role assignment A8-HISTORY needs, so this module is probably the best legacy evidence for it.

### `_Database/`

- **Read from:** DatabaseMaintenanceForm, DatabaseCopyTableForm.
- **Confidence:** ●● read

Infrastructure. Not domain.

### `_Driver/`

- **Read from:** DriverSettlementNewMaintenanceForm, DriverDebitMaintenanceForm (7,540 lines).
- **Confidence:** ●● read

`driver` IS a published role name. Settlement is compensation — A13's revenue allocation, which [A8 §5 row 11] explicitly must not be read as settling ([A8 §9 item 7]). Driver settlement logic is therefore OUT of the reference's scope, not merely owed.

### `_Employee/`

- **Read from:** SalesmanCommissionMasterMaintenanceForm, SalesmanCommissionNWMaintenanceForm (7,129 lines).
- **Confidence:** ●● read

Employees and commissions are an INTERNAL HR/payroll axis. The reference models parties as ASSERTERS of facts, not as employees, and has no commission concept. Mostly out of scope — but `partyRole` and [A8 §3]'s role⟂ownership separation are the right reading for who-may-do-what.

### `_Flash/`

- **Read from:** FlashRecapMaintenanceForm, FlashAccountingMaintenanceForm, FlashBillingMaintenanceForm, FlashClaimMaintenanceForm (2,439 lines).
- **Confidence:** ●● read

A REPORTING shape — "flash" is a period recap across accounting, billing, claims and customer service. The reference publishes ASSERTIONS and holds that state is a projection ([SD §1.1] forbids a mutable current-state field), so a flash report is downstream of the model and has no fact class by construction. Its `claim` form is the exception and points at an ABSENT class. Do not look for a `flash` concept; there will never be one.

### `_FlatRateAuto/`

- **Read from:** FlatRateAutoMasterMaintenanceForm, NewFlatrateAutoContractNumberEntryForm.
- **Confidence:** ●● read

Rate tables for automobile transport. Lands on `charge` at `aspect = RATED`, whose authority is "the tariff owner — the van line, or the party whose tariff prices it" — and that holder is STILL OWED to [A8 §9 item 2], blocked on `secondary` grade, carried as `{kind: 'owedRole'}`. So the reference can say this is a rating fact but cannot say who owns the rate.

### `_Lead/`

- **Read from:** LeadMaintenanceForm, LeadDemoMaintenanceForm.
- **Confidence:** ●● read

Pre-commitment. [A7 §3.6] and [A1] establish that both roles ARE named before any commitment exists — §375.401's estimate signed by both parties before the BOL, and §375.409's broker-adopted estimate — so a lead is not nothing to the reference. But there is no `lead` or `opportunity` concept, and `estimate` is absent. `src:sirva-ade`'s LEP/LEU/LOD specs are the closest published material.

### `_LocalDispatch/`

- **Read from:** LocalDispatchJobOldMaintenanceForm, LocalDispatchDateSelectForm.
- **Confidence:** ●○ from names

[SD §8.4] is the directly relevant decision: a day of service performed at one place with no linehaul IS a Trip with one Stop. That is what makes a local job expressible at all, and it was added because the model could not previously hold one.

### `_Masters/`

- **Read from:** DriverPayGroupMaintenanceForm, MasterDriverSettlementDetailMaintenanceForm (4,072 lines across 13 forms).
- **Confidence:** ●○ from names

Reference/master data maintenance across several domains. It has no single correspondence — map FORM BY FORM, using the other rows. Its settlement forms are A13's, like `_Driver`'s.

### `_MenuSpecifications/`

- **Read from:** ReportMenuItemsMaintenanceForm, ReportMenuSelectionForm.
- **Confidence:** ●● read

Menu/report wiring. Not domain.

### `_Ops/`

- **Read from:** ServiceMonitorForm, 198 lines.
- **Confidence:** ●● read

Operational monitoring of the application itself. Not domain.

### `_Person/`

- **Read from:** PersonMaintenanceForm, UserLoginMaintenanceForm.
- **Confidence:** ●● read

READ [A8 §9 item 3] BEFORE TOUCHING THIS. It decided there is NO `person` aggregate kind and no person/organisation field on the asserter: a party's grain rides on the role and on the identifying scheme. `tests/conformance/party-grain-refuses.ts` refuses the `person` spelling outright. A legacy Person table is not evidence against that; it is the thing the decision was taken about.

### `_Portal/`

- **Read from:** PortalUserMaintenanceForm, PortalDocumentsMaintenanceForm.
- **Confidence:** ●○ from names

Customer-facing document access. [A6] and [A8 §5 row 17] cover document ISSUANCE — the issuer of the document's own number scheme, and nobody else. Portal access control is not a domain fact.

### `_PremiumServiceDetail/`

- **Read from:** PremiumServiceDetailMaintenanceForm, ThirdPartyServiceOrderMaintenanceForm, CrateMaintenanceForm.
- **Confidence:** ●● read

Accessorials. Crating is a packing service, so `packing` is the act; the money is `charge` at `aspect = PROPOSED/DECIDED/RATED`. The THIRD-PARTY half is delegation-shaped and lands on [A8 §9 item 4], which is OPEN — so who may assert a third party's service is undecided.

### `_Sale/`

- **Read from:** SaleMaintenanceForm, SaleMemosMaintenanceForm; the only module folder carrying a ViewModel already.
- **Confidence:** ●● read

"Sale" is the legacy word for the booked job, which the reference splits into an `order` (the commitment) and a `shipment` (the goods). [A1] and the order↔shipment cardinality fork are the reading; do not assume one legacy Sale row is one of either.

### `_Shared/`

- **Read from:** FormSupport, PostalAddressMaintenanceForm — the LARGEST module at 10,014 lines across 38 forms.
- **Confidence:** ●● read

Shared UI plumbing, and the largest module by line count, so expect to meet it constantly. Mostly not domain — BUT its address handling touches the one thing [SD §1.2] admits it lacks: there is NO `place` aggregate, and `placeRef` is owed (carried as `{owed: 'placeRef'}` in `custody.ts`'s `LegEndpoint`). An address is the clearest example of a legacy concept the reference deliberately does not model yet.

### `_StoredProcedures/`

- **Read from:** StoredProcedureParameterForm, StoredProcedureSelectionForm.
- **Confidence:** ●● read

Infrastructure. Not domain.

### `_SurveyResults/`

- **Read from:** SurveyResultsMaintenanceForm, SaleServiceAuthorizationMaintenanceForm (1,774 lines).
- **Confidence:** ●● read

THE CLEAREST GAP IN THE REFERENCE, and the most useful row in this table. `survey`, `estimate` and `cube` are all ABSENT fact classes — [A8 §9 item 8] names survey/estimate facts among the classes [A8 §5] does not reach, and A10 is out of scope for v1. A migrator here gets NO domain reading, and should know that rather than infer one. Plan §8.3(3) is the fix.

### `_Task/`

- **Read from:** TaskMaintenanceFormNew, MasterTaskMaintenanceForm.
- **Confidence:** ●○ from names

Internal workflow. The nearest reference concept is `notification`, whose fact-class FAMILY is itself owed, and [A8 §9 item 6] — the party as a notification target — is open. An internal task list is probably not a domain fact at all.

### `_TestForms/`

- **Read from:** 34 forms, 3,074 lines — TestEmployeeBenefitHoursForm, MainSwitchboardForm.
- **Confidence:** ●● read

Test and scratch forms. Not domain, and note some are not obviously test-only despite the folder name.

### `_TextMessaging/`

- **Read from:** TextingApplicationHost, ToastUnreadTextNotifier — only 89 lines here; the real SMS code is in Pegasus.SMS_Library.
- **Confidence:** ●● read

Channel mechanics, not domain. [SD §6.5]/[A8 §9 item 6]: an obligation knows WHOM it is owed to but cannot say HOW they are reached — so the reference deliberately stops short of channels. Nearly all of this module is out of scope.

### `_Vehicle/`

- **Read from:** VehicleMaintenanceForm, VehicleRepairMaintenanceForm.
- **Confidence:** ●○ from names

`resource` is the aggregate. [SD §1.2]'s `resource` row is UNCITED for half of what it admits — "driver or crew member" carries no citation (recorded by [A8 §9 item 3]) — so the vehicle/driver split inside `resource` is weaker than it looks. Repair/maintenance has no reference concept.

### `_WarehouseCommercial/`

- **Read from:** ProjectMaintenanceForm, WarehouseShipmentMaintenanceForm (1,083 lines).
- **Confidence:** ●○ from names

COMMERCIAL warehousing, and the reference's corpus is household-goods. "Project" has no reference concept at all. Treat A5's readings as analogies here, not as mappings — and note `Pegasus.Domain` already has its own `CommercialWarehouse` context, which may be the better target.

### `_WarehouseHouseholdGoods/`

- **Read from:** HouseholdGoodsInStorageMaintenanceForm, HouseholdGoodsInStorageDetailMaintenanceForm.
- **Confidence:** ●● read

One of the best-covered modules: A5 is written, `stay` is an aggregate, and the storeIn/storeOut acts are distinguished from the `sitEntryDate` VALUE ([SD §5.3] — a date is not an instant, and the two must not be substituted). But `stayAuthorisation`, `stayTermination` and `stayAllowance` are ABSENT fact classes, so the lifecycle edges are owed.

### `_zUnsorted/`

- **Read from:** DispatchSheetGenerationForm, DispatchLogMaintenanceForm — 25 forms, 4,675 lines.
- **Confidence:** ●○ from names

The name says unsorted and it is: 25 forms with no single theme. Its two largest ARE dispatch, so [A3]/[A4] apply there, but map this folder FORM BY FORM. The highest-value module to triage, because it is large and nobody has classified it.

## What the reference does NOT have, enumerated

Derived from the published catalog, so this list cannot go stale while the catalog is regenerated. **A migrator meeting one of these should expect no domain reading at all** — which is a finding, not a dead end.

**Absent fact classes (15).** `chargeCollection` · `claim` · `cube` · `estimate` · `eta` · `resourceTareWeight` · `sealIntegrity` · `shipmentCommitment` · `stayAllowance` · `stayAuthorisation` · `stayTermination` · `survey` · `tracerResult` · `unpacking` · `weighing`

**Of those, the ones a MoveManager module actually lands on** — i.e. the gaps that cost:

| absent fact class    | modules that need it        |
| -------------------- | --------------------------- |
| `claim`              | `_Flash/`                   |
| `cube`               | `_SurveyResults/`           |
| `estimate`           | `_SurveyResults/`, `_Lead/` |
| `resourceTareWeight` | `_Vehicle/`                 |
| `survey`             | `_SurveyResults/`, `_Lead/` |

**Owed vocabularies (3).** `identityScheme` · `roleClass` · `unitOfMeasure` — a value in one of these is carried as an owed code, never as a guessed member.

**Fact-class families owed (2).** `charge` · `notification`

**Fact classes whose authority row is owed (13).** `assignmentOffer` · `assignmentRelease` · `assignmentResponse` · `membershipOffer` · `membershipRelease` · `membershipResponse` · `notification` · `orderAward` · `orderCancellation` · `partyRole` · `tripCancellation` · `tripDelay` · `tripResequence` — the class exists and is assertable, but **who is authoritative over it is undecided**, so do not let legacy code imply an answer.

## Can you re-check it? — recourse per authority row

**Why this is here and not folded into one score.** Four independent things decide how far to trust a row, and no single number can state them: **which sources** it rests on and therefore **what recourse you have**, whether the reading is the source's or **ours**, the row's **own stated confidence**, and how thoroughly we read each source (`evidence_grade`, rubric S4 — the next table). The combination that misleads is a row read in full, authored by us, and verifiable by nobody; it looks identical to a row quoting a statute you can open.

| fact class         | recourse                     | cited sources, with retention                                                                                                                                                       | reading     | row confidence |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------- |
| `arrival`          | ◐ mixed                      | `src:dcsa` (captured-here)<br>`src:dp3-tender-of-service` (analysis-only)                                                                                                           | [ORIGINAL]  | medium         |
| `charge`           | ◐ mixed                      | `src:dtr-part-iv` (analysis-only)<br>`src:milmove-mymove` (captured-here)<br>`src:sirva-ade` (retained-elsewhere)                                                                   | [ORIGINAL]  | medium         |
| `condition`        | ◐ mixed                      | `src:cfr-49-375` (captured-here)<br>`src:dp3-400ng` (local-only)<br>`src:dp3-tender-of-service` (analysis-only)                                                                     | [ORIGINAL]  | high           |
| `delivery`         | ◐ mixed                      | `src:cfr-49-375` (captured-here)<br>`src:dp3-tender-of-service` (analysis-only)<br>`src:sirva-ade` (retained-elsewhere)                                                             | [ORIGINAL]  | medium         |
| `departure`        | ◐ mixed                      | `src:dcsa` (captured-here)<br>`src:dp3-tender-of-service` (analysis-only)                                                                                                           | [ORIGINAL]  | medium         |
| `documentIssuance` | ◐ mixed                      | `src:cfr-49-375` (captured-here)<br>`src:dcsa` (captured-here)<br>`src:dp3-tender-of-service` (analysis-only)<br>`src:dtr-part-iv` (analysis-only)<br>`src:nmfta-ebol` (local-only) | _unmarked_  | medium         |
| `handover`         | ○ closed — unverifiable      | `src:stedi-x12-reference` (notes-only)<br>`src:uncefact-rec24` (analysis-only)                                                                                                      | [SYNTHESIS] | medium         |
| `identity`         | ◐ mixed                      | `src:dcsa` (captured-here)<br>`src:dp3-400ng` (local-only)<br>`src:dtr-part-iv` (analysis-only)<br>`src:sirva-ade` (retained-elsewhere)                                             | _unmarked_  | high           |
| `loading`          | ◐ mixed                      | `src:cfr-49-375` (captured-here)<br>`src:dp3-400ng` (local-only)<br>`src:dp3-tender-of-service` (analysis-only)<br>`src:sirva-ade` (retained-elsewhere)                             | [ORIGINAL]  | medium         |
| `orderResponse`    | ◐ mixed                      | `src:atlas-world-group-api` (refs-in-repo)<br>`src:dp3-tender-of-service` (analysis-only)<br>`src:dtr-part-iv` (analysis-only)<br>`src:milmove-mymove` (captured-here)              | _unmarked_  | medium         |
| `packing`          | ◐ mixed                      | `src:cfr-49-375` (captured-here)<br>`src:dp3-400ng` (local-only)<br>`src:macropoint` (analysis-only)<br>`src:sirva-ade` (retained-elsewhere)                                        | [SYNTHESIS] | medium         |
| `pieceCount`       | ◐ mixed                      | `src:cfr-49-375` (captured-here)<br>`src:dp3-400ng` (local-only)                                                                                                                    | [SYNTHESIS] | medium         |
| `sitEntryDate`     | ○ closed — unverifiable      | `src:dp3-400ng` (local-only)<br>`src:dtr-part-iv` (analysis-only)                                                                                                                   | [ORIGINAL]  | high           |
| `storeOut`         | ○ closed — unverifiable      | `src:dp3-tender-of-service` (analysis-only)<br>`src:dtr-part-iv` (analysis-only)                                                                                                    | [ORIGINAL]  | medium         |
| `unloading`        | ◍ with access — another repo | `src:sirva-ade` (retained-elsewhere)                                                                                                                                                | [ORIGINAL]  | medium         |
| `weight.gross`     | ◐ mixed                      | `src:cfr-49-375` (captured-here)<br>`src:dp3-400ng` (local-only)<br>`src:dp3-tender-of-service` (analysis-only)<br>`src:dtr-part-iv` (analysis-only)                                | [SYNTHESIS] | medium         |
| `weight.net`       | ◐ mixed                      | `src:cfr-49-375` (captured-here)<br>`src:dp3-400ng` (local-only)<br>`src:dp3-tender-of-service` (analysis-only)<br>`src:dtr-part-iv` (analysis-only)                                | _unmarked_  | high           |
| `weight.tare`      | ● open — clone and grep      | `src:cfr-49-375` (captured-here)                                                                                                                                                    | _unmarked_  | medium         |

**3 of 18 authority rows rest entirely on sources nobody can open** — `handover`, `sitEntryDate`, `storeOut`. That is not an accusation of error; every one is sourced and the sourcing is recorded. It means a disagreement between the model and your legacy code **cannot be settled by reading the source** — so treat the model as the weaker party in that argument and write down what the code says.

## Where the evidence is — the cited corpus

Every source the authority table cites, with the two axes a reader needs kept apart: **retention** (can anyone re-check the bytes) and **`evidence_grade`** (how thoroughly _we_ read them, rubric S4). They are independent, and `A` / `analysis-only` — a full read of a document nobody can now open — is the pairing that manufactures false confidence.

| source                      | retention              | what that means                                                              | our reading (S4) | rows citing it |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------- | ---------------- | -------------- |
| `src:cfr-49-375`            | **captured-here**      | the source's own bytes are in this repo under `sources/<id>/captured/`       | `A`              | 9              |
| `src:dcsa`                  | **captured-here**      | the source's own bytes are in this repo under `sources/<id>/captured/`       | `A`              | 4              |
| `src:milmove-mymove`        | **captured-here**      | the source's own bytes are in this repo under `sources/<id>/captured/`       | `A`              | 2              |
| `src:atlas-world-group-api` | **refs-in-repo**       | the source's own bytes are in this repo, outside `sources/`, named by `refs` | `B`              | 1              |
| `src:sirva-ade`             | **retained-elsewhere** | primary bytes are version-controlled in another repo — checkable with access | `A`              | 6              |
| `src:stedi-x12-reference`   | **notes-only**         | only **our** notes and short quoted excerpts; the raw bytes are gitignored   | `B`              | 1              |
| `src:dp3-400ng`             | **local-only**         | the bytes sit on one machine and are in no git anywhere                      | `B`              | 8              |
| `src:nmfta-ebol`            | **local-only**         | the bytes sit on one machine and are in no git anywhere                      | `A`              | 1              |
| `src:dp3-tender-of-service` | **analysis-only**      | `analysis.md` prose only — nobody can re-check the claim                     | `A`              | 10             |
| `src:dtr-part-iv`           | **analysis-only**      | `analysis.md` prose only — nobody can re-check the claim                     | `B`              | 8              |
| `src:macropoint`            | **analysis-only**      | `analysis.md` prose only — nobody can re-check the claim                     | `B`              | 1              |
| `src:uncefact-rec24`        | **analysis-only**      | `analysis.md` prose only — nobody can re-check the claim                     | `A`              | 1              |

**8 of the 12 cited sources cannot be re-checked from a clone of this repo**, and **4** of those carry `evidence_grade: A` — `src:sirva-ade`, `src:nmfta-ebol`, `src:dp3-tender-of-service`, `src:uncefact-rec24` — meaning the model read them in full and no second reader can. `registry.yaml` carries each state and a `retention_note` explaining it where the state isn't obvious.

> **A per-source state is a floor, not a guarantee, and `src:dcsa` is why.** Its 125 captured files are real and the cited JIT sub-spec was never among them — five citations rested on bytes that exist nowhere ([A8 §10]). Measured 2026-10-11, **neither** `src:dcsa` citation in the authority table reaches JIT, so nothing in the table above is overstated. The **per-citation** grain is owed and is not done.

## Where to go after this file

- [`glossary.md`](glossary.md) — the vocabulary itself, once you know which term you want.
- [`context-map.md`](context-map.md) — which concepts cross area boundaries.
- [`catalog/`](catalog/) — the published wire contract, and the `owed` block this file joins.
- `analysis/` — the areas. The index names which one applies per module.
