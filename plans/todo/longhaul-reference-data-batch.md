# Longhaul — batch reference-data into a single cloud round-trip

**Status (2026-05-29): TODO / not started.**

**Type:** Optimization + resilience (NOT a bug fix).

## Background

The tenant Driver Planning UI (`AppGuard`) hydrates its dropdown/lookup
state on bootstrap by firing **7 separate reference-data fetches in
parallel**: drivers, trip-statuses, states, zones, planners, dispatchers,
filter-options. Each one is a separate `GET /api/v1/onprem/longhaul/*`
request → api Lambda → **synchronous** `executeSql` invoke of the in-VPC
mssql-executor Lambda.

So a single user opening "Operations" wants up to ~14 concurrent Lambda
slots (7 api invocations each holding a slot while it waits on its own
executor invoke) — plus `users/me` (another executor call) and `version`.

This collided with the AWS account's Lambda concurrency limit of **10**
(see [[project_lambda_concurrency_throttle]]) and produced
`TooManyRequestsException: Rate Exceeded` → the user-visible "Failed to
load reference data" toast, with zones/states 503 and drivers 500.

### What this plan is NOT

The **throttle root cause is the concurrency limit**, and that is being
fixed by a Service Quotas increase to 1000, requested 2026-05-29:

- staging acct `248812875460` — request `2a0e205aa8764fd4bf9af75c4189661b5VM1SYGd`
- prod acct `331145994639` — request `7adb86eb45fe476a8f4b48f8180142d8BiBr4dY4`

This plan does **not** fix the throttle. It removes the wasteful fan-out
so that bootstrap is faster, cheaper (fewer Lambda invokes), and can't
self-throttle even on a constrained account — defense-in-depth, not the
fix. Do not gate the quota increase on this work.

### Already shipped this session (the honest-failure stopgap)

`trip-statuses` cloud handler added (was 404ing post-Phase-5 proxy
removal); reference-data thunks now re-throw and `AppGuard` aggregates
all failures into one snackbar instead of only reporting `drivers`. This
plan supersedes the per-label aggregation: once bootstrap is a single
call, the toast is genuinely one "Failed to load reference data".

## Goal

Collapse the 7 bootstrap reference-data requests into **one**
`GET /api/v1/onprem/longhaul/reference-data` request that runs **one**
multi-statement `executeSql` batch and returns every lookup in one
payload. Bootstrap api-Lambda invocations drop from ~9 to ~3
(reference-data + users/me + version).

## Current state (the 7 lookups)

All SQL fragments below are **server-side constants — never user input**,
so they are safe to concatenate into one multi-statement batch (same
trust model the per-endpoint handlers already rely on).

| #   | Endpoint       | SQL (today)                                                                                          | Notes                                                   |
| --- | -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | drivers        | `SELECT DRIVER_ID AS driver_id, … FROM v_longhaul_drivers`                                           | lowercase aliases must stay                             |
| 2   | trip-statuses  | `SELECT * FROM MasterTripStatus`                                                                     | lowercase cols already                                  |
| 3   | states         | `SELECT * FROM v_longhaul_states`                                                                    |                                                         |
| 4   | zones          | `SELECT * FROM v_longhaul_zones`                                                                     |                                                         |
| 5   | planners       | `SELECT * FROM v_longhaul_salesman WHERE code IN (SELECT DISTINCT created_by_id FROM TripMaster …)`  |                                                         |
| 6   | dispatchers    | `SELECT * FROM v_longhaul_salesman WHERE ${dispatcherQuery}`                                         | per-client (`longhaulClient`)                           |
| 7   | filter-options | `SELECT move_type_desc, move_type FROM MoveType WHERE ${moveTypesWhere} ORDER BY move_type_desc ASC` | per-client; reshaped to `{ moveType: [{value,label}] }` |

Per-client fragments (`dispatcherQuery`, `moveTypesWhere`) come from
`lib/longhaul-client-config.ts` keyed on `Tenant.longhaulClient`
(`'nwi' | 'qmm'`).

The executor already supports multi-statement batches via
`recordsets[i]` (read by index) — see
`handlers/longhaul-cloud/trip-detail.ts` for the established pattern.

## Design

### API — new combined handler

`handlers/longhaul-cloud/reference-data.ts` →
`longhaulReferenceDataHandler`, registered in `app.ts` as
`v1.get('/onprem/longhaul/reference-data', …)` alongside the other
cloud-direct routes.

1. Load tenant `{ mssqlConnectionString, longhaulClient }`. No connection
   string → 422 `MSSQL_NOT_CONFIGURED` (unchanged).
2. Build a batch of the **5 client-independent** statements (drivers,
   trip-statuses, states, zones, planners) in a **fixed, documented order**.
3. If `longhaulClient` is set, append the **2 per-client** statements
   (dispatchers, filter-options) to the same batch. If it is **absent**,
   omit them and return `dispatchers: []` / `filterOptions: { moveType: [] }`
   with a logged warning — **do not 422 the whole call**. (Today a missing
   `longhaulClient` only breaks dispatchers + filter-options; the other 5
   still load. Preserve that graceful degradation — don't regress it into
   an all-or-nothing failure.)
4. One `executeSql(connectionString, batchSql)` call. Read each lookup
   from `recordsets[i]` by its documented index. Reshape filter-options
   server-side exactly as the standalone handler does.
5. Return `{ data: { drivers, tripStatuses, states, zones, planners,
dispatchers, filterOptions } }`. On any executor error → 500
   `INTERNAL_ERROR` (matches the existing per-endpoint handlers).

**Comment the recordset index map** at the top of the batch SQL (as
trip-detail does) — index drift between the SQL order and the reads is the
main footgun.

### Frontend — single thunk

- `utils/api/routes.ts`: add `case 'fetchReferenceData': return { method:
'GET', path: '/reference-data' }`.
- `utils/api/index.ts`: add `fetchReferenceData: () =>
fetchHelper('fetchReferenceData')`.
- `redux/common/index.ts`: add `fetchReferenceData()` thunk that calls
  `API.fetchReferenceData()` once, then dispatches the **existing** success
  actions from the single response slice-by-slice:
  `fetchDriversSuccess(data.drivers)`, `fetchStatusesSuccess(data.tripStatuses)`,
  `fetchStatesSuccess(data.states)`, `fetchZoneSuccess(data.zones)`,
  `fetchPlannersSuccess(data.planners)`, `fetchDispatcherSuccess(data.dispatchers)`,
  `fetchFilterOptionsSuccess(data.filterOptions)`. On error: `console.error` +
  re-throw (so `AppGuard` surfaces it). Reuses every existing reducer →
  no component changes.
- `containers/AppGuard/index.tsx`: replace the `REFERENCE_DATA_THUNKS`
  fan-out loop with a single `dispatch(fetchReferenceData())`; on rejection
  set `Failed to load reference data: ${detail}`. The per-label
  aggregation array is removed.

### Backward compatibility

Keep the 7 standalone endpoints, thunks, and API methods in place — they
may have non-bootstrap callers (refresh buttons, etc.) and removing them is
out of scope. Audit usages; if confirmed bootstrap-only, schedule deletion
in a follow-up. The new endpoint is additive, so api can deploy ahead of
tenant-web with zero risk.

## Tasks (TDD)

1. **Handler test first** (`reference-data.test.ts`, mirror zones.test.ts):
   - happy path with `longhaulClient='nwi'` → all 7 keys populated, one
     `executeSql` call, batch SQL contains all 7 statements in order.
   - `longhaulClient` null → 5 keys populated, `dispatchers: []`,
     `filterOptions: { moveType: [] }`, batch has only 5 statements.
   - `longhaulClient='qmm'` → uses qmm fragments.
   - no connection string → 422.
   - executor throws → 500.
2. Implement `longhaulReferenceDataHandler` to green.
3. Register route + import in `app.ts`.
4. **Redux thunk test**: `fetchReferenceData` dispatches all 7 success
   actions from one payload; re-throws on rejection.
5. Implement the thunk + `routes.ts` + `api/index.ts` entries.
6. **AppGuard test**: bootstrap fires exactly one reference-data fetch;
   children render; snackbar on rejection. Update existing AppGuard tests
   that asserted the 7-way fan-out.
7. `npm run typecheck` + targeted vitest (api longhaul-cloud, tenant-web
   driver-planning) green.
8. Extend `apps/e2e/tests/api/longhaul-qa.spec.ts` with a `/reference-data`
   assertion (shape + 200).

## Risks / edge cases

- **Batch abort semantics:** in one MSSQL batch, a single failing statement
  aborts the whole batch → all reference data lost (worse granularity than
  7 independent calls). All 7 target objects exist on every longhaul tenant
  today (unlike the optional `pegasus_extra_location`), so this is
  acceptable. If a lookup later becomes tenant-optional, split it into a
  soft-failing side query per the trip-detail pattern — **don't** silently
  let it kill the batch.
- **Index drift:** the `recordsets[i]` reads must match SQL statement order
  exactly. Mitigate with a documented index map + the multi-client tests.
- **Per-client fragment correctness:** a malformed fragment for a future
  client breaks the whole batch. Covered by the nwi/qmm tests; reuses
  already-tested constants.

## Verification / done criteria

- Opening Operations on QA issues **one** `/onprem/longhaul/reference-data`
  request (network tab), all dropdowns populate, no error toast.
- Bootstrap concurrent api-Lambda invocations measurably drop (CloudWatch).
- All unit + e2e suites green; typecheck clean.

## Rollout

Single PR touching `apps/api` + `apps/tenant-web`. Path-filtered deploy on
merge to `main` ships both; old endpoints remain so order is irrelevant.
After a QA soak, file the follow-up to retire any now-unused standalone
reference endpoints/thunks.
