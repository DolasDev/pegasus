# Driver Dashboard — Real Metrics (feat/driver-dashboard)

## Goal

Replace the hardcoded `getDriverMetrics()` stub (`apps/mobile/src/services/driverMetrics.ts`) with real
figures derived from the tenant's MoveManager data. Financial figures come from **new `Pegasus.Api`
endpoints** (movemanager repo), bridged into the cloud API through a pegII gateway; trip counts come from
the `TripMaster` reads the cloud already does.

## Decisions (Steve, 2026-10-14)

| Tile               | Definition                                                                                 | Source                                 |
| ------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| Account Balance    | Show **three** figures: running balance, running minus escrow, last month-end              | New `Pegasus.Api` endpoint             |
| Pending Settlement | `SUM(settlementmaster.net_due_driver) WHERE settle_status IN ('D','W')`                    | New `Pegasus.Api` endpoint             |
| Active Shipments   | Driver's trips not pending/canceled/completed                                              | Cloud, `TripMaster` via mssql-executor |
| Completed (wk)     | Driver's trips with completed status and `actual_last_day` in the current week             | Cloud, `TripMaster` via mssql-executor |
| ~~Miles (wk)~~     | **Removed** — no trustworthy source (`total_miles` is planned, odometer has no driver key) | —                                      |

Offered Trips stays as-is (`TripsContext`).

**Revised after Step 0 (Steve, 2026-10-15)** — supersedes the table above where they differ:

- **Pending Settlement** = `SUM(settlementmaster.net_due_driver) WHERE active='Y' AND transfer_date IS NULL AND entry_date >= today − 90 days` (posted, not yet paid out). NW never uses Draft/Working. The 90-day bound (Steve, 2026-10-15) is because NW leaves years of rows untransferred (driver 75: 2,843 rows / $1.23M unbounded); every transfer in the last year landed within 8 weeks.
- **Verified on NW prod (2026-10-15):** the new SQL's running balance and escrow equal `sp_DrvDailyBalance.total` / `sp_DrvRetainerPaid.retainercurrent` to the cent for drivers 4766, 20222, 21103, 134, 75.
- **Account Balance** = running balance (`sp_DrvDailyBalance` formula), **escrow held** as its own line (`sp_DrvRetainerPaid` formula), and last month-end. No "running − escrow": escrow debits are already inside the running balance.
- **Auth** on the new `Pegasus.Api` route: cloud tokens **without** `scp` (rejects desktop-session tokens), **plus** a hub token whose `sub` is the configured bridge service user (NW is still on the legacy credential). All other hub logins are rejected.
- **Week** = Monday 00:00 US Central → now.
- **Active Shipments** = trips in status 3 Accepted / 4 In-Progress, `internal_status <> 'canceled'` (Offered already has its own tile). **Completed (wk)** = status 5 Finalized with `COALESCE(actual_last_day, planned_last_day)` in the Monday-start week (Steve, 2026-10-15: NW fills neither `actual_last_day` nor `finalized_date` — 0 of 1,234 finalized trips in 6 months).

## Current state (verified 2026-10-13)

- Mobile resolves the driver via `GET /api/v1/me/driver` → `TenantUser.longhaulDriverId` (`apps/api/src/handlers/me.ts`).
- All longhaul reads go cloud → `executeSql` (mssql-executor). `Pegasus.Api` has **no** driver/trip/settlement endpoint and no driver claim (`CloudCaller`: `emp`/`wun` are attribution only).
- pegII HTTP calls go through `lib/pegii-api-client.ts` + `tunnelFetch` with the pegII service-user token (existing gateways: order, salesman, report, email).
- Balance logic lives in stored procs `sp_DrvDailyBalance` (begin − debits + credits) and `sp_DrvRetainerPaid` (`ret_paid + retainerdebit`) whose bodies are in **neither** repo; month-end is `DriverYTDSummary.end_balance` keyed by `ytd_id` (driver code).
- `settlementmaster.settle_status`: D=Draft, W=Working, P=Posted (`DriverSettlementMaster.vb`).
- Dashboard `index.tsx` has `try/finally` with no `catch` → a failed fetch spins forever.

## Step 0 results — Nelson Westerberg prod, via mssql-executor (2026-10-15)

- **`sp_DrvDailyBalance`** (running balance) = `driverytdsummary.begin_balance` for (current year, current month)
  `+ SUM(settlementmaster.gross_due_driver)` with `entry_date` in the current month (any status)
  `− SUM(debit.debit_amt)` with `debit_date` in the current month. Keyed `ytd_id` = `settlementmaster.driver_id` = `debit.driver_id`.
- **`sp_DrvRetainerPaid`** (escrow held) = `drivers.retainer_paid` (null→0) `+ SUM(debit.debit_amt)` this month where `expense1_code = '1'`.
  Escrow debits are **already** in the running balance's debit sum (96 active drivers carry a retainer).
- **`driverytdsummary`**: 786 drivers × months 1–13 per year; ~497 have a non-zero `begin_balance` for 2026-10;
  month 13 is a year bucket (all zero) — month-end = the row for the previous calendar month, `monthend_bal`/`end_balance`.
- **`v_longhaul_drivers`** reads view `driverall` (types `NW` = `drivers` rows, `NWSUB` = `crews` drivers with no `drivers` row).
  134 long-haul drivers, 22 NWSUB → no `drivers`/escrow row for those.
- **`settlementmaster` at NW is posted immediately**: last 12 months = 12,697 rows, **all `settle_status='P'`**. Draft+Working is always empty.
  Last 3 months, `transfer_date IS NULL` (not yet paid out): 58 rows / ~$150k; transferred: 3,910 rows.
- **`MasterTripStatus`**: 1 Pending, 2 Offered, 3 Accepted, 4 In-Progress, 5 Finalized. `TripMaster.internal_status` ∈ {`active`, `canceled`}.
- **NW `Site.cloudAuthEnabled = false`** (prod, both NW tenants); NW cloud-auth rollout is on hold (`plans/todo/cloud-identity-and-companies.md`).
- `drvbal` is dead (last row 2017).

## Contracts (fixed before implementation, 2026-10-15)

**Pegasus.Api** — `GET /api/v1/pegii/drivers/{driverId:int}/financials`, capability `pegii.drivers.financials.v1`,
`ApiResponse` envelope, `data`:

```json
{
  "driverId": 4766,
  "asOf": "2026-10-15",
  "runningBalance": 1234.56, // null when driverytdsummary has no (year, month) row for the driver
  "escrowHeld": 800.0, // null when the driver has no `drivers` row (NWSUB)
  "monthEnd": { "year": 2026, "month": 9, "balance": 1100.0 }, // null when no previous-month row
  "pendingSettlement": { "total": 2500.0, "count": 2 }
}
```

Auth: cloud token with no `scp`, or a hub token whose `sub` is `Api:DriverFinancials:BridgeHubUser` (default `pegasus-cloud`). 403 otherwise.

**Cloud** — `GET /api/v1/me/driver/metrics` (Cognito session; no `requirePermission`, scoped to the caller like `/me/driver`):

- `404 { error, code: 'DRIVER_NOT_LINKED' }` when the caller has no `TenantUser.longhaulDriverId`.
- `200 { data }`:

```json
{
  "driverId": 4766,
  "asOf": "<ISO now>",
  "weekStart": "<ISO Monday 00:00 America/Chicago>",
  "trips": { "activeShipments": 2, "completedThisWeek": 1 }, // null when the MSSQL read fails / not configured
  "financials": {
    "runningBalance": 1234.56,
    "escrowHeld": 800,
    "monthEnd": { "year": 2026, "month": 9, "balance": 1100 },
    "pendingSettlement": { "total": 2500, "count": 2 }
  }, // null when pegII is unavailable
  "unavailable": [{ "section": "financials", "reason": "PEGII_API_CAPABILITY_MISSING" }]
}
```

Trip SQL (`TripMaster`, `driver_id = @driverId`, `internal_status <> 'canceled'` or null):
active = `TripStatus_id IN (3,4)`; completedThisWeek = `TripStatus_id = 5 AND actual_last_day >= @weekStart` (date compare on the Chicago-local Monday date).

## Approach

### Step 0 — Verify against a real tenant DB (before writing SQL)

1. Pull `sp_helptext` for `sp_DrvDailyBalance` and `sp_DrvRetainerPaid`; record the exact formulas in this plan.
2. Confirm key equivalence: `TenantUser.longhaulDriverId` = `v_longhaul_drivers.driver_id` = `drivers.driver_id` = `settlementmaster.driver_id` = `DriverYTDSummary.ytd_id` (pull the view definition).
3. Confirm "completed" `MasterTripStatus` id(s) and the canceled marker (`internal_status='canceled'`).
   If no DB access from this box, stop and ask Steve to run the queries.

### Step 1 — movemanager `Pegasus.Api` (lands via ff-push to `dev`, no PR)

- New `Endpoints/DriverEndpoints.cs`: `GET /api/v1/pegii/drivers/{driverId}/financials` →
  `{ driverId, runningBalance, runningBalanceLessEscrow, monthEndBalance, monthEndDate, pendingSettlementTotal, pendingSettlementCount, asOf }` in the `ApiResponse.Ok` wrapper.
- **Auth: `ptype=service` only.** A user token must not be able to read an arbitrary driver's money; the cloud is the only caller and has already resolved the driver server-side. 404 for unknown driver.
- Read model in `Pegasus.Infrastructure`: raw SQL (or proc call) mirroring the Step 0 formulas — no net48 EF6 reference. Repository + tests in `Pegasus.Api.Tests` (net8 tests run on Linux per `reference_dotnet_on_linux_movemanager`).
- Add the read-only tables to the conformance golden schema only if the conformance test requires it.
- Deploy: on-prem Windows-service redeploy (Steve) — the cloud side must tolerate its absence (below).

### Step 2 — cloud `apps/api`

- New gateway `gateways/pegii-driver.gateway.ts` (pattern: `pegii-salesman.gateway.ts`) calling the endpoint above.
- New standalone route `GET /api/v1/me/driver/metrics` (do not edit `trips-list.ts`):
  - Resolve `driverId` from `TenantUser.longhaulDriverId` server-side; 404 `driver_not_linked` when null. Never accept a driver id from the client.
  - `executeSql` aggregate over `TripMaster` for `activeShipments` and `completedThisWeek` (week = Mon 00:00 → now, tenant-local; document the choice).
  - Call the pegII gateway for financials. **Partial failure is a 200 with `financials: null` + a reason**, so trip counts still render when on-prem `Pegasus.Api` is old/unreachable.
- Register in the OpenAPI spec if `/me/*` routes are registered there.
- Integration tests (Vitest, DB-backed) with the gateway and `executeSql` faked at the module seam; cover unlinked driver, pegII down, happy path.
- Check `packages/infra` — no new env expected (reuses pegII client config); confirm.

### Step 3 — mobile `apps/mobile`

- `DriverMetrics` type: drop `milesThisWeek`; balance becomes `{ running, lessEscrow, monthEnd, monthEndDate } | null`; pending settlement `number | null`.
- `getDriverMetrics()` calls `/me/driver/metrics` via the existing api client.
- Dashboard: remove Miles tile; Account Balance tile shows running balance as the value with "After escrow" and "Month-end (<date>)" lines; nulls render "—" with "Unavailable". Add a `catch` + error/retry state (no infinite spinner).
- Update `Dashboard.snapshot.test.tsx`; add `driverMetrics.test.ts`.

### Step 4 — docs

- Update `dolas/agents/project/GOTCHAS.md` / `PATTERNS.md` with the pegII driver bridge + service-only auth rule.

## Out of scope (flag only)

- Existing `trips-list`/`trip-detail`/`shipments-list` accept a client-supplied `driver_id` with no `requirePermission` — any tenant user can read any driver's trips. Separate fix.
- Miles metric.

## Risks

- Proc formulas differ per tenant / NW company variants → Step 0 per-tenant check on PegNW at minimum.
- On-prem deploy lag → handled by the `financials: null` degradation.
- Mobile release cadence (store builds) — the endpoint is additive, old app builds keep the stub.

## Acceptance

- Signed-in linked driver sees real Active, Completed (wk), three balance figures and pending settlement matching the WinForms driver grid / settlement screen for the same driver.
- Unlinked driver or pegII outage shows a legible state, never a spinner.
- `npm test` + typecheck green in `apps/api` and `apps/mobile`; `Pegasus.Api.Tests` green.

## Outcome (2026-10-15)

- Implemented as above. Verified on NW prod: running balance + escrow equal the legacy procs to the cent (5 drivers);
  the trip-count SQL runs and returns plausible counts (4766: 2 active / 1 completed this week).
- **NW financials will show "Unavailable" until NW has a bridge credential.** NW's tenant has **no** `pegii_api_key_ref`
  and its site has `cloud_auth_enabled = false`, so the cloud reaches NW's Pegasus.Api with no Authorization at all.
  Either run NW's cloud-auth rollout (`plans/todo/cloud-identity-and-companies.md` item 3) or provision a hub bridge user
  - secret and set `Api:DriverFinancials:BridgeHubUser` on NW to its username. Trip counts don't depend on this.
- New definitions with no WinForms screen to reconcile against: Pending Settlement (90-day untransferred) and
  Completed (wk) (planned end fallback).
- OpenAPI: `/me/driver/metrics` is NOT in the m2m OpenAPI spec, matching `/me/driver` — both are mobile session
  routes, not integration surface.
- movemanager: `feat/driver-financials` → `dev` (plan `plans/completed/*-driver-financials-endpoint.md` there).
- Out of scope, still open: `trips-list` / `trip-detail` / `shipments-list` accept a client-supplied `driver_id`
  with no `requirePermission`.
