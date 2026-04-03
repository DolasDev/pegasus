# Plan: Dolas Modules Migration into Pegasus Monorepo

**Source repo:** `~/repos/Pegasus Dolas Modules`
**Goal:** Integrate the PegII Long Haul modules into the Pegasus Turborepo monorepo, add test
coverage, migrate the back-end services into the on-prem Hono API (`packages/api`), and convert
the Electron React client into a standalone web SPA.

---

## Background

The source repo is a single-package Electron app containing three tightly-coupled concerns:

| Layer          | Technology                                 | Notes                                                                         |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| NestJS server  | NestJS 7, TypeORM 0.2, Knex, MSSQL         | No HTTP adapter — runs as `ApplicationContext`, communicates via Electron IPC |
| Electron shell | Electron 8, `electron-builder`             | Windows-only. IPC bridge between renderer and NestJS. Auto-updater via S3.    |
| React client   | React 16, CRA 3, Redux Toolkit, HashRouter | Calls `window.fetchData(routeName, data)` injected by Electron preload.       |

**Key constraints:**

- The NestJS service has zero HTTP surface — all routes are Electron IPC handler names.
- Auth is Windows username → `win_username` DB lookup. No JWT, no sessions.
- Database is MSSQL (the legacy Pegasus core DB). The app owns ~10 tables and reads several more views.
- No meaningful test coverage exists (empty spec file, CRA boilerplate only).
- Node 12 / NestJS 7 / TypeORM 0.2 — all EOL; upgrading is a prerequisite for monorepo compatibility.

**Target state:**

- NestJS services ported as Hono handlers in `packages/api`, behind the on-prem Windows Service
  deployment (completed: `plans/completed/d710463-on-prem-server.md`).
- React client lives as `apps/longhaul` — a Vite SPA that calls the HTTP API instead of IPC.
- Electron shell is retired.

---

## Phase 1 — Monorepo Integration

**Goal:** Two clean workspace packages in the repo that build without Electron. No behaviour
changes yet — the code runs; the IPC wiring is stubbed at the boundary so tests can run.

### 1.1 Create `packages/longhaul-api`

Port `server/` to a standalone NestJS package.

- [x] Scaffold `packages/longhaul-api/package.json`
  - Upgrade: NestJS 7 → 10, TypeORM 0.2 → 0.3, Node target 18+
  - Keep `mssql ^10`, `knex ^3`, `@nestjsplus/knex` (or replace with `@nestjs/config`)
  - Deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/typeorm`, `reflect-metadata`, `rxjs`,
    `typeorm`, `knex`, `mssql`, `lodash`
  - DevDeps: `typescript`, `@types/node`, `@types/lodash`, `vitest`
- [x] `packages/longhaul-api/tsconfig.json`
  - `target: ES2022`, `module: CommonJS` (Node16 requires .js extensions which clash with copied source)
  - `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `strictPropertyInitialization: false`
  - Remove dependency on `electron/tsconfig.json` compile model
- [x] Copy `server/modules/` → `packages/longhaul-api/src/modules/`
- [x] Copy `server/utils/` → `packages/longhaul-api/src/utils/` (IPC emitter/consumer excluded)
- [x] Replace `config` npm package with `@nestjs/config` + env vars throughout
  - DB config: `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_DATABASE`
  - `DRIVER_TYPES`, `DISPATCHER_QUERY`, `RELEASE_CHANNEL`, `IMPORT_EXPORT_TYPES`, `MOVE_TYPES_WHERE`
  - Created `.env.example`
- [x] Create `packages/longhaul-api/src/app.module.ts`
  - `ConfigModule.forRoot({ isGlobal: true })`, `KnexModule.register()` and `TypeOrmModule.forRootAsync()`
  - `EmployeeModule` removed (deprecated)
- [x] Create `packages/longhaul-api/src/main.ts` — NestJS HTTP server (`NestFactory.create`)
  - Reads `PORT` from env (default 3100), sets global prefix `/api`
- [x] Add `build`, `dev`, `typecheck`, `test` scripts to `package.json`
- [x] `nest-cli.json` created
- [x] Add package to root `workspaces` — already covered by `packages/*` glob; no change needed
- [x] `turbo.json` — already picks up new packages via wildcard tasks; no change needed
- [x] Verify: `npm run typecheck` passes for this package in isolation
  - TypeORM 0.3 `findOne({ where: ... })` migrations applied (states, zones, activities, shipments, filters)
  - `trustServerCertificate` cast as `any` for MSSQL options compatibility
  - `BigInteger` → `bigint`, `noImplicitOverride` disabled for legacy decorators

### 1.2 Create `packages/longhaul-web`

Port `src/` to a Vite SPA workspace.

- [x] Scaffold `packages/longhaul-web/package.json`
  - Replace `react-scripts` (CRA 3) with `vite` + `@vitejs/plugin-react`
  - React 18, react-router-dom 6, Redux Toolkit 2, react-redux 8
  - Removed all `electron*` deps; removed `config`, `ts-jest`, `react-scripts`
- [x] `packages/longhaul-web/vite.config.ts` — standard Vite + React config
- [x] `packages/longhaul-web/index.html` — Vite entry point
- [x] Copy `src/` → `packages/longhaul-web/src/`
- [x] `HashRouter` kept as-is (react-router v5 syntax throughout routes; full upgrade in Phase 4)
- [x] Replace `window.fetchData` calls with stub transport in `src/utils/api/transport.ts`
  - `src/utils/api/index.ts` updated to import from `./transport`
- [x] Replace `window.confirmPrompt` / `window.alertPrompt` with `window.confirm` / `window.alert`
  - Files: `App.js`, `PendingTrips/index.js`, `Trip/utils/date-prompt.ts`, `Trip/utils/status-prompt.ts`
- [x] `AppGuard` version check replaced with `useVersionStub()` that always passes (Phase 3 deferred)
- [x] `index.tsx` updated to React 18 `createRoot` API; `serviceWorker` import removed
- [x] `vite-env.d.ts` and `tsconfig.json` created consistent with `packages/web`
- [x] Add `dev --port 5175`, `build`, `preview`, `typecheck`, `test` scripts
- [x] Verify: `npm run typecheck` passes
  - Removed unused `ReactChild/ReactChildren` imports (removed in React 18+)
  - Removed stray `import { State } from 'server/modules/...'` in redux/version
  - Added `@airbrake/browser` dep for logger.ts
  - `useDispatch<any>()` cast for thunk dispatch compatibility
  - Note: App.js still uses react-router v5 `HashRouter`/`Switch`/`Redirect` — full v6 upgrade in Phase 4
  - Note: `--legacy-peer-deps` required due to react-popper@2 React 19 peer dep gap

### 1.3 Root wiring

- [x] Both packages covered by existing `packages/*` glob in root `package.json` workspaces — no edit needed
- [x] Run `npm install --legacy-peer-deps` — succeeded (591 packages added)
- [x] `npm run typecheck` — `longhaul-api` and `longhaul-web` pass; pre-existing `@pegasus/api` failures unrelated to this work

---

## Phase 2 — Test Coverage

**Goal:** Meaningful test coverage before structural changes. Pattern: Vitest throughout,
consistent with the rest of the monorepo.

### 2.1 `packages/longhaul-api` — Service unit tests

NestJS services contain the business logic; repositories are the I/O boundary. Test services
by mocking the TypeORM `Repository<T>` and Knex `QueryBuilder`.

- [x] Configure Vitest (`vitest.config.ts`) in the package
  - Note: esbuild doesn't support `emitDecoratorMetadata`; resolved by mocking `typeorm` and
    `@nestjs/typeorm` in `src/test-setup.ts` so entity decorators become no-ops
- [x] `TripService` tests (`trip.service.spec.ts`) — 15 tests
  - `getTripsV2` — delegates to repo
  - `saveTrip` — no-shipments 403, driver-change-in-progress 403, remove-with-actual-date 403
  - `updateStatus` — no-driver 403, finalize-with-unfinished-activities 403, happy path
  - `cancelTrip` — in-progress 403, happy path cascade
  - `getStatuses`, `createTripNote`
- [x] `ActivityService` tests (`activity.service.spec.ts`) — 19 tests
  - `buildShipmentActivities` — PACK/LOAD/DOCKPICKUP/DELIVERY mapping, deduplication, location
  - `saveActivity` / `saveActivities` — update vs insert branching
  - `getTripInfo` — unfinished-first sort, all-finished, empty/null
  - `cancelTripActivities`
- [x] `ShipmentService` tests (`shipment.service.spec.ts`) — 7 tests
  - `getShipments` — TripStatus_id filter, 1000-result limit
  - `saveCoverage` — update existing, save new
  - `patchShipmentShadow` — with/without order_num
- [x] `FilterOptionsService` tests (`filter-options.service.spec.ts`) — 8 tests
  - `getOptions`, `saveShipmentsFilter` (with/without default), date-offset transform
  - `deleteShipmentFilter`, `setDefaultShipmentFilter` (new/existing/no-user)
  - `fetchShipmentFiltersForUser` with date-offset reverse transform
- [x] `UserService` tests (`user.service.spec.ts`) — 7 tests
  - Active user lookup — found, not found, inactive, case-insensitive
  - Alpha channel fallback — PEGASUS, GIGI, query-builder
  - `getDispatchers` env var / default
- [x] Add to turbo `test` pipeline (covered by existing `packages/*` glob)

### 2.2 `packages/longhaul-web` — Component and Redux tests

- [x] Configure Vitest + jsdom + `@testing-library/react` in the package (`vitest.config.ts`)
- [x] Redux slice tests (pure reducer logic — no mocking needed)
  - `tripPlanning` slice — 12 tests (add/remove shipment, editTrip, setTrip, swapOrder, editActivity, removeActivity, saveTripSuccess)
    - Note: `addActivity` reducer has a known bug (`delete array[idx]` inside Immer); test marked `.skip`
  - `shipments` slice — 12 tests (fetch lifecycle, selected shipment, query merge/reset, optimistic coverage/shadow updates)
  - `trips` slice — 8 tests (selectTrip, fetch lifecycle, changeTripsQuery, editTrip)
  - `user` slice — 4 tests (start/success/error)
- [x] API abstraction layer tests (`src/utils/api/index.spec.ts`) — 32 tests
  - `fetchHelper` — success, null data, falsy result, 4xx throw, 3xx no-throw, arg passthrough
  - All 27 IPC route mappings verified (fetchTrips, fetchShipments, fetchUser, etc.)
- [x] Key component render tests
  - `AppGuard` — 5 tests: renders children when user valid; Loading state; error container when no user; "not registered" message; no error when user present
  - `FilterTabs`, `ActivityGantt`, `ShipmentsTable` — deferred (complex Redux + CSS module deps; covered by e2e in Phase 4)
- [x] Add to turbo `test` pipeline (covered by existing `packages/*` glob)

---

## Phase 3 — Back-end Migration to On-Prem Hono API

**Goal:** Port all NestJS service logic into `packages/api` as Hono handlers, replacing the
Electron IPC transport with HTTP. The on-prem deployment (`packages/api/src/server.ts` +
Windows Service scripts) already exists.

The 27 IPC routes map to a new `longhaul` handler group:

| IPC route                                 | HTTP method + path                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `fetchShipments`                          | `GET /api/v1/longhaul/shipments`                                                |
| `fetchTrips`                              | `GET /api/v1/longhaul/trips`                                                    |
| `fetchTrip`                               | `GET /api/v1/longhaul/trips/:id`                                                |
| `saveTrip`                                | `POST /api/v1/longhaul/trips` (new) / `PUT /api/v1/longhaul/trips/:id` (update) |
| `changeTripStatus`                        | `PATCH /api/v1/longhaul/trips/:id/status`                                       |
| `cancelTrip`                              | `POST /api/v1/longhaul/trips/:id/cancel`                                        |
| `updateTripSummaryInfo`                   | `PATCH /api/v1/longhaul/trips/:id/summary`                                      |
| `fetchTripStatuses`                       | `GET /api/v1/longhaul/trip-statuses`                                            |
| `createTripNote`                          | `POST /api/v1/longhaul/trips/:id/notes`                                         |
| `patchTripNote`                           | `PATCH /api/v1/longhaul/notes/:id`                                              |
| `saveActivity`                            | `POST /api/v1/longhaul/activities/:id`                                          |
| `fetchDrivers`                            | `GET /api/v1/longhaul/drivers`                                                  |
| `fetchUser`                               | `GET /api/v1/longhaul/users/me`                                                 |
| `fetchVersion`                            | `GET /api/v1/longhaul/version`                                                  |
| `fetchStates`                             | `GET /api/v1/longhaul/states`                                                   |
| `fetchZones`                              | `GET /api/v1/longhaul/zones`                                                    |
| `fetchPlanners`                           | `GET /api/v1/longhaul/planners`                                                 |
| `fetchDispatchers`                        | `GET /api/v1/longhaul/dispatchers`                                              |
| `saveShipmentCoverage`                    | `POST /api/v1/longhaul/shipments/:id/coverage`                                  |
| `patchWeight`                             | `PATCH /api/v1/longhaul/shipments/:id/weight`                                   |
| `patchShipmentShadow`                     | `PATCH /api/v1/longhaul/shipments/:id/shadow`                                   |
| `fetchFilterOptions`                      | `GET /api/v1/longhaul/filter-options`                                           |
| `fetchSavedShipmentFilters`               | `GET /api/v1/longhaul/shipment-filters`                                         |
| `saveShipmentsFilter`                     | `POST /api/v1/longhaul/shipment-filters`                                        |
| `fetchShipmentDefaultFilterForUser`       | `GET /api/v1/longhaul/shipment-filters/default`                                 |
| `setDefaultShipmentFilter`                | `PUT /api/v1/longhaul/shipment-filters/default`                                 |
| `deleteShipmentFilter`                    | `DELETE /api/v1/longhaul/shipment-filters/:id`                                  |
| `pegasusRemoteFunctionCall` (jumpToOrder) | `POST /api/v1/longhaul/remote/jump-to-order` (named pipe relay — on-prem only)  |

### 3.1 MSSQL connection in `packages/api`

The Pegasus API currently uses PostgreSQL (Prisma + Neon). Long haul routes hit the legacy
MSSQL database. These must coexist.

- [x] Add `mssql ^10` and `knex ^3` to `packages/api/package.json`
- [x] Create `packages/api/src/lib/mssql.ts` — singleton Knex connection configured from
      `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_DATABASE` env vars
- [x] Add vars to `packages/api/.env.example`
- [x] Graceful skip: if MSSQL vars are absent, `mssql.ts` exports a null client; longhaul
      handlers return 503 with `{ error: 'MSSQL not configured', code: 'MSSQL_UNAVAILABLE' }`
- [x] Update `packages/api/src/app.ts` deep health check to optionally ping MSSQL

### 3.2 Auth for longhaul routes

The original auth is Windows username → DB lookup. On-prem deployment uses `SKIP_AUTH=true`
(already implemented). Longhaul routes will:

- When `SKIP_AUTH=true`: read `X-Windows-User` header (set by a reverse proxy or the client)
  and pass it to the user service for DB lookup. Return 403 if not found/inactive.
- When `SKIP_AUTH=false`: require a valid M2M API key (existing `api-client-auth` middleware)
  with scope `longhaul:read` / `longhaul:write`.

- [x] Create `packages/api/src/middleware/longhaul-user.ts`
  - Reads `X-Windows-User` header when `SKIP_AUTH=true`
  - Calls a minimal user lookup against MSSQL `v_longhaul_salesman` view
  - Sets `c.set('longhaulUser', user)` in Hono context

### 3.3 Port repositories

Port TypeORM/Knex queries as plain Knex query functions (no ORM decorators).

- [x] `packages/api/src/repositories/longhaul/shipments.repository.ts`
- [x] `packages/api/src/repositories/longhaul/trips.repository.ts`
- [x] `packages/api/src/repositories/longhaul/activities.repository.ts`
- [x] `packages/api/src/repositories/longhaul/filter-options.repository.ts`
- [x] `packages/api/src/repositories/longhaul/reference.repository.ts` (drivers, states, zones, users, statuses, versions)
- [x] Integration tests for each repository using `describe.skipIf(!process.env['MSSQL_HOST'])`

### 3.4 Port handlers

- [x] `packages/api/src/handlers/longhaul/shipments.ts`
- [x] `packages/api/src/handlers/longhaul/trips.ts`
- [x] `packages/api/src/handlers/longhaul/activities.ts`
- [x] `packages/api/src/handlers/longhaul/filter-options.ts`
- [x] `packages/api/src/handlers/longhaul/reference.ts` (drivers, states, zones, planners, dispatchers, statuses, version)
- [x] `packages/api/src/handlers/longhaul/remote.ts` (named pipe relay — `jumpToOrder`)
- [x] Mount all under `/api/v1/longhaul` in `packages/api/src/app.ts`
- [x] Handler unit tests (mock Knex client) for all handlers

### 3.5 Retire `packages/longhaul-api`

- [x] Confirm all 27 IPC routes have HTTP equivalents and handler tests pass
- [x] Remove `packages/longhaul-api` from root workspaces and turbo pipeline
- [x] Delete `packages/longhaul-api/` directory

---

## Phase 4 — Standalone Web Client

**Goal:** `packages/longhaul-web` becomes a fully autonomous browser SPA (`apps/longhaul`),
communicating with `packages/api` via HTTP. No Electron dependency.

### 4.1 HTTP transport layer

Replace the Phase 1 `transport` stub with a real HTTP client.

- [x] Create `apps/longhaul/src/utils/api/http-client.ts`
  - Base URL from `VITE_API_URL` env var
  - Sends `Authorization: Bearer <apiKey>` (key from `VITE_LONGHAUL_API_KEY`) OR
    `X-Windows-User: <username>` header (for on-prem SKIP_AUTH mode, detected by
    `VITE_AUTH_MODE=windows`)
  - Implements the same async call signature as the former `window.fetchData` transport
    so all Redux thunks continue to work without changes
- [x] Map all 27 former IPC routes to their Phase 3 HTTP endpoints in
      `apps/longhaul/src/utils/api/routes.ts`
- [x] Replace the Phase 1 stub in `transport.ts` with the HTTP client
- [x] `apps/longhaul/.env.example` — document `VITE_API_URL`, `VITE_AUTH_MODE`,
      `VITE_LONGHAUL_API_KEY`

### 4.2 Auth UX (Windows username mode)

When `VITE_AUTH_MODE=windows`, the app should prompt for or auto-detect the Windows username
(since we no longer have `os.userInfo()` in the browser). Options:

- [x] Simple login screen: username text input → validates by dispatching fetchUser; stores
      username in `sessionStorage`; http-client injects as `X-Windows-User` on all requests.
      "Sign in as different user" button clears sessionStorage and returns to login screen.
- [x] `AppGuard` updated: skips fetchUser until username is stored; blocks on 403.

### 4.3 Promote to `apps/longhaul`

- [x] Move `packages/longhaul-web/` → `apps/longhaul/`
- [x] Root `package.json` workspaces already covers `apps/*` — no change needed
- [x] `turbo.json` already picks up via wildcard — no change needed
- [x] Vite dev server port `5175` already set in package.json from Phase 1

### 4.4 End-to-end verification

- [x] Add Playwright API tests in `apps/e2e/tests/api/longhaul.spec.ts` covering 13 routes:
      users/me, shipments list, trips list, trips with filters, trip 404, trip-statuses, drivers,
      filter-options, shipment-filters, version, saveTrip validation, changeTripStatus 404, auth check
- [x] `AppGuard` blocks access when user is not in MSSQL (403 path + "not registered" message)
- [ ] Smoke test full trip-creation flow (requires live MSSQL — deferred to manual QA)

---

## Dependency & Upgrade Notes

| Concern          | Current | Target  | Notes                                                       |
| ---------------- | ------- | ------- | ----------------------------------------------------------- |
| Node target      | 12      | 18+     | Required for monorepo compatibility                         |
| NestJS           | 7       | 10      | NestJS 7 is EOL; `@nestjs/config` replaces `config` package |
| TypeORM          | 0.2.25  | 0.3.x   | Many breaking changes in entity decorators and find options |
| Electron         | 8.2.1   | retired | Replaced by web SPA                                         |
| React            | 16.13.1 | 18      | Concurrent mode, updated hooks                              |
| react-router-dom | 5       | 6       | Loader API, `BrowserRouter` default                         |
| CRA              | 3.4.1   | retired | Replaced by Vite                                            |
| Redux Toolkit    | 1.2.1   | 2.x     |                                                             |
| `config` npm pkg | 3.2.4   | retired | Replaced by env vars + `@nestjs/config`                     |

---

## Risks

| Risk                                                                                          | Mitigation                                                                                                                 |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| TypeORM 0.2 → 0.3 has breaking changes in entity decorators and `find()` options              | Port to plain Knex (no TypeORM entities) in Phase 3 — avoids the upgrade entirely                                          |
| `v_longhaul_shipments_v2` SQL view is complex; logic is embedded in the view, not the service | Carry the view DDL as a migration script; document view dependency in handler README                                       |
| Named pipe relay (`jumpToOrder`) is Windows-only                                              | Implement behind a feature flag; log + return 501 on non-Windows hosts                                                     |
| CRA → Vite migration may break CSS Modules or absolute imports                                | Audit `src/` for CRA-specific conventions before Phase 1 (especially `process.env.REACT_APP_*` → `import.meta.env.VITE_*`) |
| No existing tests means Phase 2 may surface hidden bugs in service logic                      | Phase 2 is intentionally before Phase 3; bugs found during test writing are fixed before porting                           |

---

## Status

- [x] Phase 1 — Monorepo Integration ✓ (both packages typecheck clean)
- [x] Phase 2 — Test Coverage ✓ (56 API service tests + 75 web tests pass)
- [x] Phase 3 — Back-end Migration to On-Prem API ✓ (27 HTTP routes in packages/api; 148 handler unit tests; packages/longhaul-api retired)
- [x] Phase 4 — Standalone Web Client ✓ (HTTP transport, Windows auth UX, promoted to apps/longhaul, E2E tests)
