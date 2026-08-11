# Reporting phase 1 — server-defined dataset catalog + one built-in dashboard

> **Status: APPROVED 2026-08-11 — decisions 1–4 taken; implementation started.**
> Drafted 2026-08-08 from the primary checkout parked on `main` (no changes made
> there), revised and seeded into the worktree for branch
> `feat/reporting-dataset-catalog`.

> **Decisions taken 2026-08-11** (reasoning at the foot, under "Decisions"):
>
> 1. **New top-level `/reporting` route.** The `/dashboard` home page and its
>    PegII toggle stay untouched in phase 1.
> 2. **OpenAPI only.** No `m2mV1` mounting and no SDK/MCP exposure in phase 1.
> 3. **Grant `ReadReportingDataset` to all personas** (see §4 for the one
>    carve-out and why).
> 4. **Dashboards are publishable, reusable artifacts, and each user picks
>    their own default view from their profile settings.** This is the big one —
>    it changes what phase 1 must get right. See "The phase-2 target" below.

**Goal:** ship the _foundation_ for customizable dashboards — a versioned,
server-defined, RBAC-filtered catalog of tenant-scoped datasets, plus one
read-only built-in dashboard that renders from it — **without** a widget editor,
without persisted layouts, and without touching `schema.prisma`.

Phase 1 proves the contract. Phase 2 (user-authored layouts) is cheap once the
catalog is right; it is expensive to retrofit if the catalog is wrong.

---

## The phase-2 target (decision 4) — and what it demands of phase 1

Dashboards are to be **publishable and reusable**, with each user choosing their
own default view in their profile settings. Phase 2 builds that; phase 1 must not
foreclose it. Two repo findings set the design:

**A. The publish model already exists — reuse its vocabulary.**
`IntegrationConfig` is exactly this artifact: monotonic `version` per key with
immutable uploads, `visibility` (TENANT / GLOBAL, _derived server-side_ from the
publishing tenant's `isPlatformTenant`), `status` where a publish supersedes prior
PUBLISHED rows for the scope, `publishedBy`, and `forkedFromConfigId` +
`forkedFromVersion` for "fork this GLOBAL one to my tenant". A `DashboardDefinition`
model in phase 2 should mirror those columns rather than invent a parallel
lifecycle — it buys platform-published starter dashboards, tenant forks, and the
already-solved `fork(force=true)` re-sync from GLOBAL for free.

**B. Per-user preferences have nowhere to live yet.**
`Tenant.appSettings` is a tenant-wide Json column (its `DashboardSchema` section
is an empty scaffold). `TenantUser` has **no** preferences column, and `/api/v1/me`
exposes only `/permissions` and `/driver`. So "my own default view" needs new
per-user storage — a `preferences Json` column on `TenantUser` mirroring the
`appSettings` Zod-with-defaults pattern, read/written through `/me`. **That is a
migration, and it belongs to phase 2**, which is why phase 1 stays off
`schema.prisma` entirely.

### What this forces phase 1 to get right

A dashboard that can be _published by one tenant and forked by another_ is a
portable document, not a local constant. Three consequences land in phase 1:

1. **The built-in dashboard must be a validated `DashboardDefinition` document,
   not an ad-hoc typed constant.** Phase 1 defines the Zod schema for that
   document and validates the built-in against it at module load. Phase 2 then
   changes only _where the document is loaded from_ — code constant → Postgres row.
2. **A widget references a dataset by `id` AND `version`.** Reuse makes dataset
   identity a cross-tenant public contract: a GLOBAL dashboard forked by twenty
   tenants breaks in all of them if a dataset's columns move. Recording the
   version a definition was authored against lets phase 2 detect drift and warn,
   instead of silently rendering an empty chart. This upgrades R6 from a review
   note to a structural requirement.
3. **A portable dashboard must never assume the tenant has a legacy DB.** A
   GLOBAL dashboard referencing `longhaul-*` datasets will be forked by tenants
   whose `mssqlConnectionString` is unset (→ 422 `MSSQL_NOT_CONFIGURED`). The
   per-slot error contract in §3 is what makes that survivable, and phase 1 must
   prove it: a widget whose source is unavailable degrades alone, and the rest of
   the dashboard renders. Phase 2 additionally surfaces `source` at fork time so
   a tenant sees what a definition depends on before adopting it.

Nothing else about phase 2 is decided here — the editor, sharing UI, and fork
flow are out of scope and out of this plan.

---

## Why a catalog, and why it comes first

The discriminating constraint is data topology, not UI:

- Cloud data is Neon Postgres via Prisma (66 models).
- The numbers tenants actually want — longhaul shipments, trips, driver activity,
  `invoicemaster` YTD totals — still live in **each tenant's on-prem MSSQL**,
  reachable _only_ through the in-VPC `mssql-executor` Lambda over WireGuard
  (`handlers/longhaul-cloud/*`, `handlers/dashboard-pegii.ts`).

No third-party BI tool can reach that second source without new networking, so
the query layer has to live in our API regardless of what renders the charts.
Making it a **catalog** — rather than letting the client send SQL or field paths —
buys three things at once:

1. **The MSSQL→Postgres migration stays invisible.** A dataset's _implementation_
   can flip from a legacy view to a Prisma query without any dashboard noticing.
   This matters because the strangler-fig is still in flight; we must not build
   BI plumbing hard-wired to a database that is being retired.
2. **Authorization reuses what exists.** A dataset declares the Cedar action it
   piggybacks, so visibility falls out of the existing policy set — no parallel
   permission model.
3. **Fan-out is controllable.** Lambda reserved concurrency is **10** in both
   accounts. N widgets × M users × auto-refresh is exactly the pattern that has
   already produced 500/503s here. A catalog lets the server batch a whole
   dashboard into one round trip; free-form client queries cannot be batched.

---

## Scope

### In scope

- Dataset registry + types (`apps/api/src/reporting/`).
- Two standalone endpoints: catalog list, batched query.
- One new Cedar action + resource type, granted to human personas.
- **Six** seed datasets — three Postgres, three legacy MSSQL (see below).
- OpenAPI entries for both routes.
- A `DashboardDefinition` **Zod schema** (the portable document shape phase 2
  will persist and publish) + one built-in definition validated against it.
- One built-in dashboard at a **new** `/reporting` route in tenant-web, rendering
  from that definition.
- A chart library dependency (Recharts) + a thin `<ChartCard>` wrapper.
- Tests at every layer.

### Explicitly OUT of scope (phase 2+)

- Any `DashboardDefinition` Prisma model, any `TenantUser.preferences` column,
  any migration. **Phase 1 adds no columns and no migration** — the built-in
  definition is a validated code constant. This deliberately keeps the branch off
  `schema.prisma`, a declared merge-magnet file.
- The drag-and-drop widget editor and `react-grid-layout`.
- Publishing, versioning, forking, and GLOBAL/TENANT visibility of definitions.
- The per-user default-view preference and its `/me` read/write surface.
- Dataset-version drift detection (phase 1 only _records_ the version).
- Cross-source joins (a dataset reads Postgres **or** legacy, never both).
- CSV/PDF export, scheduled email delivery.
- Distributed caching (see Risk R3).
- Changes to the existing `/dashboard` home route or its "Use PegII Data" toggle.
  Phase 1 sits beside it; merging the two is a phase-2 decision.

---

## Design

### 1. The dataset contract

`apps/api/src/reporting/types.ts`

```
export interface DatasetColumn {
  key: string
  label: string
  type: 'string' | 'number' | 'currency' | 'date' | 'boolean'
}

export interface DatasetDef<P = unknown> {
  id: string                    // stable, kebab-case, NEVER renamed once shipped
  version: number               // bump on a breaking column change
  title: string
  description: string
  source: 'postgres' | 'legacy-mssql'
  /** Existing Cedar action the caller must already hold to see/run this. */
  requires: ActionDef
  params: z.ZodType<P>          // Zod 4, per repo convention
  columns: readonly DatasetColumn[]
  run(ctx: DatasetContext, params: P): Promise<Row[]>
}
```

Three properties are load-bearing:

- **`id` is a permanent public identifier.** Phase-2 saved layouts will reference
  it. Renaming one later breaks stored dashboards. Treat like a DB column name.
- **`requires` points at an _existing_ action** (`Actions.ListMoves`,
  `Actions.ReadInvoice`, …), so a dataset can never widen what a role can read.
- **`columns` is declared, not inferred.** It is what the frontend renders
  against and what the OpenAPI/SDK surface documents. Never `SELECT *` — see R5.

For `source: 'legacy-mssql'`, `run` does **not** issue its own `executeSql` call.
It returns a SQL fragment + a row mapper so the handler can batch (see §3).
Modeled directly on `dashboard-pegii.ts`, which already batches three views into
one multi-statement round trip.

**Injection rule for legacy datasets (hard constraint).** Fragments are
concatenated into one multi-statement call, and `params` are caller-supplied —
Zod-validating a string does not make it safe to interpolate into that batch.
Until the `mssql-executor` parameterization story is verified end-to-end,
**phase-1 `legacy-mssql` datasets take no params, or only numeric/enum params
validated against a closed set. Interpolating a caller-supplied string into a
legacy fragment is forbidden.** The three seed legacy datasets are constant
SELECTs over `v_dashboard1/2/3`, so this costs nothing in phase 1. Parameterized
legacy datasets are a phase-2 item gated on that verification. (This branch
touches authz files, so `/security-review` runs at finish — the plan should
answer this before the review has to.)

### 2. Seed datasets (six)

Chosen to exercise both sources and all three widget shapes (scalar / series /
table), not for completeness.

| id                        | source       | requires      | shape                   |
| ------------------------- | ------------ | ------------- | ----------------------- |
| `moves-by-status`         | postgres     | `ListMoves`   | series                  |
| `invoices-outstanding`    | postgres     | `ReadInvoice` | scalar (currency)       |
| `quotes-conversion-30d`   | postgres     | `ReadQuote`   | series                  |
| `longhaul-new-orders-ytd` | legacy-mssql | `ListMoves`   | series (`v_dashboard1`) |
| `longhaul-in-transit`     | legacy-mssql | `ListMoves`   | series (`v_dashboard2`) |
| `longhaul-invoiced-ytd`   | legacy-mssql | `ReadInvoice` | scalar (`v_dashboard3`) |

The three legacy ones intentionally reuse the views `dashboard-pegii.ts` already
reads. That makes phase 1 a **provable refactor target**: same numbers, new
contract. If the catalog can reproduce the existing PegII dashboard exactly, the
contract is right.

### 3. Endpoints (standalone — no edits to existing route paths)

Mounted on the session-auth `v1` router in `app.ts`, **not** on `m2mV1` in
phase 1 (see Open Question Q2).

**`GET /api/v1/reporting/datasets`**
Returns the catalog, filtered to datasets whose `requires` action the caller
holds. Response carries `id`, `version`, `title`, `description`, `source`,
`columns`, and a JSON-Schema rendering of `params`. This is the introspection
surface — the frontend and any SDK consumer read capabilities from here rather
than from static docs, per the SDK-discoverability rule in CLAUDE.md.

**`POST /api/v1/reporting/query`**

```
{ "requests": [ { "datasetId": "moves-by-status", "params": {...} }, ... ] }
→ { "data": { "results": [ { "datasetId": "...", "rows": [...] }, ... ] } }
```

POST rather than GET because params are nested objects and a dashboard sends N of
them; URL-encoding that is hostile. Handler behavior:

1. Reject unknown `datasetId`; validate each `params` against its Zod schema.
2. **Two-layer authorization.** `requirePermission(Actions.ReadReportingDataset)`
   mounts as route middleware (one action per route — that is all the middleware
   supports). The per-dataset `requires` check is then **programmatic, inside the
   handler**, iterating the requested datasets. If any fails, deny the whole
   request — fail closed, one 403, no partial leakage. The same programmatic
   check backs `GET /datasets` filtering.
   ✅ **Resolved 2026-08-11 — no extraction needed.** `lib/authz.ts` already
   exports both `authorize()` (single, TTL-cached for coarse calls) and
   `listAllowedPermissions(principal, idToken, policyStoreId)` → `string[]` of
   public permission strings. **Both endpoints use `listAllowedPermissions`
   once per request** and filter the catalog by `dataset.requires.permission`,
   rather than issuing N `authorize()` calls. That is one batched AVP round
   trip, matching what `GET /me/permissions` already does, and it fits because
   our datasets are coarse-grained (`listAllowedPermissions` authorizes against
   a per-tenant catch-all resource id — exactly our model).
   ⚠️ Note for review: `listAllowedPermissions` batches **every** action in
   `ALL_ACTIONS` and already had to be chunked at AVP's 30-request cap. Adding
   `ReadReportingDataset` grows that batch by one — harmless now, but the
   catalog is on a growth path worth watching.
3. **Group by `source`.** All `legacy-mssql` datasets in the request are
   concatenated into ONE `executeSql` multi-statement call → one tunnel round
   trip regardless of widget count. Postgres datasets run via the tenant-scoped
   `c.get('db')` client.
4. Cap `requests.length` at **12** and return 400 above it. This is the hard
   backstop against the concurrency cap; a dashboard that needs more widgets
   needs a conversation, not a bigger cap.

A per-dataset failure returns `{ datasetId, error }` in its slot rather than
failing the batch — one broken legacy view must not blank the whole dashboard.
Exception: auth failures, which fail the whole request per (2).

### 4. RBAC

- New `ResourceType: 'Report'` in `authz/actions.ts`.
- New action `ReadReportingDataset` → permission string `report:read`.
- Add to `cedar.schema.json` `actions` map with `appliesTo`.

**Grant to all human personas** (decision 3). ✅ **Implemented 2026-08-11, but
not the way the draft assumed** — the repo's actual policy structure changed the
mechanics. What the code now does:

| target                                                                                                                                                                   | action taken                 | why                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `10-tenant-admin.cedar`                                                                                                                                                  | **nothing**                  | its permit is `action` (wildcard) — already covers the new action                           |
| `20-viewer.cedar`                                                                                                                                                        | **granted**                  | the real read-only business-user baseline; this is the grant that makes reporting reachable |
| `accountant`, `sales`, `driver`, `billing-manager`, `workflow-developer`                                                                                                 | **granted**                  | the only 5 personas with real `permit` clauses                                              |
| `senior-management`, `operations-admin`, `coordinator`, `warehouse`, `customer-service-manager`, `local-dispatch`, `long-distance-dispatch`, `central-planning-dispatch` | **deliberately NOT granted** | see below                                                                                   |

**Why the 8 stub personas were left alone.** They are comment-only placeholder
files with **zero** permit clauses — `loadPolicies` skips them on purpose,
because AVP's `CreatePolicy` rejects a comment-only statement (that failure
broke a real deploy; see `authz/__tests__/load.test.ts`). Two reasons not to
convert them here:

1. **It would be inert.** A stub-persona user granted only `report:read` still
   fails every dataset's `requires` gate (they hold no `ListMoves`,
   `ReadInvoice`, …), so they would get an **empty catalog**. Zero user-visible
   benefit.
2. **It would break an existing invariant test.** `authz.test.ts` invariant (f) —
   _"a pure placeholder persona grants only the shared document baseline"_ —
   asserts `operations_admin` resolves to exactly the doc baseline. Adding a
   permit clause turns a deliberate placeholder into a loaded policy and fails
   that test. The test passed untouched, which confirms the call.

In practice these personas reach reporting by also holding `viewer` (or
`tenant_admin`), which is how they reach every other read surface today. When
their real permissions are authored, `ReadReportingDataset` goes in with them.

**One carve-out — the four machine personas are excluded:** `reporting`,
`integrations`, `integration-publisher`, `workflow-runtime`. The `reporting`
persona in particular reads, in its own header, _"service accounts that mirror
data into downstream warehouses or run scheduled exports — strictly
observational"_ — it is an M2M identity, not a human dashboard role. Granting it
would hand every warehouse-mirror service account a UI-facing surface and make
the two access patterns impossible to revoke independently. Since phase 1 mounts
nothing on `m2mV1` (decision 2), a service account could not reach these routes
anyway, so the grant would be inert _and_ misleading.
**Assumption:** "add all" meant all the human personas Q3 was choosing among. Say
the word and the four machine personas go in too — it is a one-line change per
policy file. Worth a comment in `role-options.ts` either way, because the
`reporting`-persona / reporting-feature name collision will mislead someone.

Net effect: a user sees a dataset iff they hold `ReadReportingDataset` **and**
that dataset's `requires` action. Two gates, both from the existing policy set.
With a blanket grant, the second gate is doing all the real work — a `driver`
holds `ReadReportingDataset` but not `ReadInvoice`, so they get an empty or
partial catalog rather than finance numbers. This is exactly why `requires`
points at pre-existing actions instead of inventing per-dataset permissions.

### 5. Frontend

- New route `/reporting` in `router.tsx`, `beforeLoad: requireRole(...)` matching
  the personas above (client-side hardening only; Cedar remains authoritative).
- Nav entry in `AppShell.tsx`. **`requireRole` gates by role, not by feature
  flag** — with `REPORTING_ENABLED=false` a granted user would otherwise see a
  nav item pointing at a dead endpoint. Gate the nav entry and route on the
  catalog endpoint responding (an empty/404 catalog hides both); copy whatever
  pattern the feedback feature already uses to hide its UI when its flag is off.
- `api/queries/reporting.ts` — TanStack Query bindings. The whole dashboard is
  **one** `useQuery` hitting `POST /reporting/query` with all widget requests,
  with `staleTime: 60_000` so refetch churn does not multiply the tunnel load.
- **`DashboardDefinition` — the portable document.** Zod schema, defined once and
  shared in shape by phase 2's persisted rows:
  ```
  {
    schemaVersion: 1,
    id: string,                  // stable slug
    title: string,
    description?: string,
    widgets: [{
      datasetId: string,
      datasetVersion: number,    // authored-against version — drift detection (phase 2)
      params: unknown,           // validated against the dataset's own schema
      widget: 'scalar' | 'bar' | 'line' | 'table',
      title: string,
      span: 1 | 2 | 3 | 4
    }]
  }
  ```
  The built-in dashboard is an instance of this, validated at module load (a bad
  constant fails a unit test, not production). Phase 2 replaces _only the loader_
  — code constant → Postgres row — and gains publish/version/fork around the same
  document. **Nothing else in the render path changes.** That substitution is the
  test of whether phase 1 is shaped right.
- Renderer must tolerate a widget whose slot carries `error` (unavailable legacy
  source, drifted dataset) by degrading that tile alone.
- `<ChartCard>` wraps Recharts in the existing `Card` primitives so charts inherit
  Tailwind tokens and dark mode.

**Chart library: Recharts.** React-idiomatic, composable, and the widget shapes
here are ordinary. ECharts is the better call only if we later need dense
operational visuals (trip gantts, thousand-point series) — revisit at phase 3,
and note that swapping is contained to `<ChartCard>` by design.

---

## Files

**Create — `apps/api`**

- `src/reporting/types.ts` — `DatasetDef`, `DatasetColumn`, `DatasetContext`
- `src/reporting/registry.ts` — catalog map, `listFor(permissions)`, `byId`
- `src/reporting/datasets/moves-by-status.ts`
- `src/reporting/datasets/invoices-outstanding.ts`
- `src/reporting/datasets/quotes-conversion-30d.ts`
- `src/reporting/datasets/longhaul-new-orders-ytd.ts`
- `src/reporting/datasets/longhaul-in-transit.ts`
- `src/reporting/datasets/longhaul-invoiced-ytd.ts`
- `src/handlers/reporting.ts` — both handlers
- `src/handlers/reporting.test.ts`
- `src/reporting/registry.test.ts`
- `src/lib/reporting-feature.ts` — `isReportingEnabled()`, env-gated, off by
  default (mirrors `lib/feedback-feature.ts`)

**Create — `apps/tenant-web`**

- `src/routes/reporting.tsx`
- `src/api/queries/reporting.ts`
- `src/features/reporting/dashboard-definition.ts` — Zod schema + types
- `src/features/reporting/builtin-dashboard.ts` — the validated instance
- `src/features/reporting/ChartCard.tsx`
- `src/features/reporting/__tests__/reporting-page.test.tsx`
- `src/features/reporting/__tests__/dashboard-definition.test.ts`

**Modify**

- `apps/api/src/app.ts` — import + mount two routes (additive)
- `apps/api/src/authz/actions.ts` — `Report` type + `ReadReportingDataset` ⚠️ hot
- `apps/api/src/authz/cedar.schema.json` — action entry ⚠️ hot
- `apps/api/src/authz/policies/10-tenant-admin.cedar` ⚠️ hot
- `apps/api/src/authz/policies/30-personas/*.cedar` — all 13 human personas
  (every file except `reporting`, `integrations`, `integration-publisher`,
  `workflow-runtime`) ⚠️ hot
- `apps/api/src/authz/role-options.ts` — comment on the persona/feature name
  collision
- `apps/api/src/lib/openapi-spec.ts` — document both routes
- `apps/tenant-web/src/router.tsx` ⚠️ hot
- `apps/tenant-web/src/components/AppShell.tsx` ⚠️ hot
- `apps/tenant-web/package.json` — add `recharts`

**Not touched:** `apps/api/prisma/schema.prisma`, `handlers/dashboard-pegii.ts`,
`routes/index.tsx`, `routes/settings.app.dashboard.tsx`.

---

## Checklist

- [x] Create worktree `scripts/new-worktree.sh feat reporting-dataset-catalog`
- [x] `types.ts` + `registry.ts` + registry unit tests (permission filtering,
      duplicate-id rejection, params→JSON-Schema rendering) — 14 tests, incl. 3
      legacy-SQL safety invariants (no string params, one statement per
      fragment, no `SELECT *`)
- [x] `lib/reporting-feature.ts` env gate, off by default
- [x] Cedar: `Report` resource type, `ReadReportingDataset`, schema entry,
      persona grants — wasm validator + all authz suites green (32/32).
      4 pinned permission-set expectations in `lib/authz.test.ts` updated;
      invariant (f) left untouched and still passing
- [x] **Verify `lib/authz.ts` exposes a programmatic (non-middleware)
      permission check** — ✅ it does: `authorize()` + `listAllowedPermissions()`.
      No extraction needed; both endpoints use `listAllowedPermissions`
- [x] Three Postgres datasets + unit tests
- [x] `GET /reporting/datasets` handler + tests (empty catalog for a role with
      no grants; no 403 — an empty list is the correct answer)
- [x] `POST /reporting/query` handler: validation, two-layer authorization
      (fails closed), per-source grouping, batch cap of 12, per-dataset error
      slots, request-order-preserving results — 18 tests
- [x] Three legacy-MSSQL datasets, batched into one `executeSql` call
- [ ] **Verify legacy column names against the LIVE views (R5) — NOT DONE.**
      The three fragments were copied verbatim from the shipping
      `handlers/dashboard-pegii.ts`, so they are as correct as the endpoint
      already in production, but they have not been re-verified against a live
      `v_dashboard1/2/3`. Do this before enabling the flag on a real tenant
- [ ] Assert parity: catalog output == current `/dashboard/pegii` numbers.
      **Deferred with the item above** — it needs a live legacy DB, which this
      worktree has no tunnel to. Unit-level equivalence IS covered (the batch
      test pins the exact SQL and the mapped output)
- [x] OpenAPI entries for both routes + `ReportingDataset`/`ReportingResult`
      schemas; `openapi-spec.coverage.test.ts` green
- [x] Add `recharts`; single version, no overrides; `audit-ci` green
- [x] `dashboard-definition.ts` Zod schema + 12 tests
- [x] `<ChartCard>` + `builtin-dashboard.ts` (validated at module load) +
      `/reporting` route + permission- and capability-gated nav
- [x] tenant-web component test: renders from a mocked batch response; degrades
      to a per-widget error state when one slot carries `error` — 7 tests
- [x] **Prove the phase-2 substitution** — `dashboard-definition.test.ts`
      round-trips the built-in through `JSON.parse(JSON.stringify(...))`
      (simulating a Postgres JSON column) and asserts identical parse + identical
      query requests
- [x] Full gate: `npm run typecheck && npm test && npm run lint` — 15/15 turbo
      tasks green, 2974 api tests, all four coverage floors RAISED
- [ ] E2E: one API acceptance spec under `apps/e2e/tests/api/` — **not written.**
      The surface is off by default (`REPORTING_ENABLED`), so an e2e spec would
      need the flag set in the e2e environment; folding that in belongs with the
      first real enablement, not with a dark-shipped feature
- [ ] Update `dolas/agents/project/PATTERNS.md` with the dataset-catalog pattern
- [ ] `git mv` this plan to `plans/completed/<short-hash>-reporting-dataset-catalog.md` **before** opening the PR
- [ ] `/workstream-finish`

---

## Risks & side effects

**R1 — Lambda concurrency (10).** The whole design leans on one-batch-per-
dashboard. Mitigations: server-side source grouping, the batch cap of 12,
`staleTime: 60_000`, and no per-widget polling in phase 1. If a legacy dataset
turns out slow, the batch makes the _whole_ dashboard slow — acceptable in phase
1, and the reason R3 exists.

**R2 — Hot files.** This branch touches `actions.ts`, `cedar.schema.json`,
persona `.cedar`, `router.tsx`, and `AppShell.tsx` — all listed merge magnets
that collide _semantically_ even when git merges cleanly. Serialize against any
other active stream touching them; rebase on `origin/main` before finishing.

**R3 — No caching in phase 1, deliberately.** A module-scope `Map` in a
horizontally-scaled Lambda is per-container and gives an inconsistent hit rate
(the lesson from the outbound OAuth token cache, which needed a shared L2). Phase
1 therefore batches instead of caching. If tunnel latency proves unacceptable,
the fix is a _shared_ cache, not a local one — a phase-2 item, not an improvised
addition to this branch.

**R4 — MSSQL unavailable in CI/local.** Legacy dataset tests must mock
`executeSql`, and the tenant must have `mssqlConnectionString` set or the route
returns 422 (`MSSQL_NOT_CONFIGURED`), as `dashboard-pegii.ts` already does. The
`/reporting` page must render its Postgres widgets normally when legacy slots
error — that is precisely what the per-slot error contract is for.

**R5 — Legacy column names lie.** Two recorded failures apply directly: ported
accessors that named TypeORM _aliases_ rather than real view columns, and a trip
roll-up that wrote zeros because `total_actual_wt` is not a view column at all.
**Verify every legacy column against the live view before shipping a dataset**,
and never `SELECT *` — a star select plus an alias reusing a projected name makes
mssql return an _array_ for that column.

**R6 — dataset `id` + `version` are a cross-tenant public contract.** Reuse
raises the stakes: a GLOBAL dashboard forked by twenty tenants breaks in all of
them if a dataset is renamed or its columns move. Renames become migrations of
stored definitions. Review ids and column sets in the PR with that weight, and
bump `version` on any breaking column change so phase-2 drift detection has
something to compare against.

**R8 — a portable dashboard can reference a source a tenant does not have.** A
forked GLOBAL definition may include `longhaul-*` widgets for a tenant with no
`mssqlConnectionString`. Phase 1's per-slot error contract is the mitigation and
must be tested (R4). Phase 2 surfaces `source` at fork time so the dependency is
visible before adoption.

**R7 — Feature flag off by default.** Nothing is user-visible until ops flips
`REPORTING_ENABLED=true`, so this can land ahead of the UI being finished.

---

## Decisions (2026-08-11)

**D1 — New top-level `/reporting` route.** The `/dashboard` home page and its
"Use PegII Data" toggle are untouched. Consequence: two dashboard surfaces
coexist during phase 1. Merging them — and retiring the toggle — is a phase-2
call to make once definitions are persisted and a user can pick a default.

**D2 — OpenAPI only.** Both routes are documented in `openapi-spec.ts` and
reachable at `/docs`, but nothing mounts on `m2mV1` and the SDK/MCP surfaces are
untouched. Reporting is a tenant-facing BI surface, not an integrations feature,
so the SDK-discoverability rule in CLAUDE.md is not triggered. Revisit in phase 2
**if** external authors turn out to want the dataset catalog — at which point the
introspection endpoint (`GET /reporting/datasets`) is already the right shape to
expose, since it returns the contract live rather than as static docs.

**D3 — Grant to all human personas** (§4). The four machine personas are carved
out, with the reasoning and the override noted there.

**D4 — Definitions are publishable and reusable; the default view is per-user.**
Drives the whole "phase-2 target" section above. Phase 1's obligations are the
`DashboardDefinition` document, `datasetVersion` on every widget, and a proven
per-slot degrade path. Phase 2 owns the `DashboardDefinition` Prisma model
(mirroring `IntegrationConfig`'s version/visibility/status/publishedBy/forkedFrom
columns), `TenantUser.preferences`, the `/me` preference surface, and the editor.

**Still open, deliberately deferred to phase 2 planning:**
`settings.app.dashboard` is an `EmptySectionCard` stub and `Tenant.appSettings`
already carries an empty `DashboardSchema` section. Those are the natural homes
for _tenant-wide_ dashboard configuration, while the _per-user_ default belongs
on `TenantUser` behind `/me`. Phase 1 puts nothing in either, so the choice stays
open.
