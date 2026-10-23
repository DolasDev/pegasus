# Activity labor — crews + packers on an order's activities (mobile Labor tab)

**Branch:** `feat/activity-labor` (worktree `../pegasus-activity-labor`). All changes stay on this branch.

**Goal:** a Labor tab on the mobile shipment screen where a driver assigns one or more crews to each
of their activities on the order, selects which packers from those crews worked it, and can add
crews / packers on the spot.

## Decisions (Steve, 2026-10-23)

- Labor belongs on the **activity** (`LongDistanceDispatchActivity.id`), not the order.
- The tab shows **only the driver's own activities**, using the ETA editor's owner rule
  (`driver-activity-eta.ts`): `assigned_driver_id` wins when set (non-0); an unassigned activity
  belongs to the trip's `driver_id`. **Other drivers' activities are hidden** from a driver (not
  shown read-only) — confirmed by Steve at approval.
- Unlike the ETA editor, an `actual_date` does **not** lock labor — packers are recorded after the
  work is done.
- Stored in **Pegasus Postgres**, keyed by tenant + legacy activity id. Nothing is written to legacy
  SQL Server (movemanager won't see it).
- **Readable by order viewers** (employees see every activity's labor on the order, read-only);
  **editable only by the activity's driver**.
- **Mobile only** — no tenant-web view in this PR.
- Adding a crew from the tab offers **both** manual entry and contacts import.
- An assigned crew stays on the activity if the driver later removes it from their book (history);
  it can still be un-assigned, and its packers toggled.

## Design

### Schema (both models have `tenantId` and go in `TENANT_SCOPED_MODELS`)

```prisma
/// A crew that worked one legacy longhaul activity. `activityId` = LongDistanceDispatchActivity.id
/// (no FK — legacy DB). `orderNum` is denormalised for the per-order read.
model ActivityLaborCrew {
  id               String   @id @default(uuid())
  tenantId         String   @map("tenant_id")
  activityId       Int      @map("activity_id")
  orderNum         Int      @map("order_num")
  crewPhone        String   @map("crew_phone")          // → Crew.phone, onDelete Cascade
  assignedByUserId String   @map("assigned_by_user_id") // → TenantUser, onDelete Cascade
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  packers          ActivityLaborPacker[]
  @@unique([tenantId, activityId, crewPhone])
  @@index([tenantId, orderNum])
  @@map("activity_labor_crews")
}

/// A packer selected on an assigned crew. Deleting the packer (or the assignment) drops it.
model ActivityLaborPacker {
  activityLaborCrewId String @map("activity_labor_crew_id") // cascade
  tenantId            String @map("tenant_id")
  packerId            String @map("packer_id")              // → Packer, cascade
  @@id([activityLaborCrewId, packerId])
  @@map("activity_labor_packers")
}
```

Migration stamped after main's latest at implementation time.

### Domain (`packages/domain/src/labor`)

`validateActivityLabor(input)`: ≤ 10 crews, phones E.164-normalised + unique, packer ids unique
per crew. (Packer-belongs-to-crew is a DB fact, checked in the API.) Unit tests.

### API (`apps/api/src/handlers/labor.ts`, existing router, `ReadLabor` / `WriteLabor`)

Caller scope via the domain's `resolveChatScope` (employee vs driver), imported, not copied.

- `GET /labor/orders/:orderNum/activities`
  - driver: the order's activities they own (legacy query, the ETA owner rule), `editable: true`;
  - employee: every activity on the order, `editable: false`;
  - activity: `id`, type code / name / abbreviation, planned start, estimated + actual dates;
    `crews`: phone, shared name, the caller's nickname if linked, `inMyBook`, and **all** the
    crew's packers with `selected`.
- `PUT /labor/activities/:activityId` — body `{ crews: [{ phone, packerIds: [] }] }`; whole-set
  replace in one transaction. 404 unknown activity; 403 not the activity's driver (employees too —
  read-only); 422 a **newly added** crew not in the caller's book, or a packer not on its crew.
  `orderNum` comes from the legacy row, never the client. Returns the activity as in GET.
- No legacy connection / legacy query error → 503, fail closed.
- The legacy activity lookup + owner rule is extracted from `driver-activity-eta.ts` into a shared
  helper (`lib/longhaul-driver-activity.ts`) used by both — behaviour of the ETA route unchanged
  (its tests must stay green). **Shared-utility change — flagged for approval.**
- OpenAPI: both paths + `LaborActivity` / `LaborActivityCrew` schemas.

### Mobile (`apps/mobile`)

- `app/shipment/[orderNum].tsx`: `'labor'` tab (+ `?tab=labor`).
- `src/components/labor/ActivityLaborTab.tsx`: one card per activity (type + date). Per assigned
  crew: name, call button, remove ✕, packer checklist, "Add packer". "Assign crew" button.
  Every change PUTs the full set (optimistic; revert + alert on failure). Read-only when
  `editable` is false. Empty state when the driver has no activities on the order. Refetch on focus.
- `app/labor/assign.tsx?activityId&orderNum`: crew picker over my book (existing list/search),
  already-assigned crews marked; header actions **New crew** / **Import from contacts**.
  Picking a crew assigns it and goes back to the tab. Refreshes on focus (`useFocusEffect`) so
  crews imported from contacts appear.
- `labor/new.tsx?activityId`: after create, assigns the crew to the activity, then
  `router.dismissTo` the shipment tab (back past the picker). Without the param: unchanged.
- `labor/import.tsx`: unchanged — returns to the picker, where the imported crews now show.
- `labor/packer.tsx?activityId`: after **create**, the packer is selected on that activity, then back.
- `src/services/laborService.ts`: `getOrderActivityLabor`, `setActivityLabor`; types in
  `src/types/labor.ts`.

No new native modules, but the app has no OTA path → EAS build, dispatched **after** the API deploy.

## Checklist

- [x] Sync worktree with `origin/main`
- [x] Domain: `validateActivityLabor` + tests
- [x] Prisma models + migration; schema-sync tenant-scoped list
- [x] Extract legacy activity owner lookup into `lib/longhaul-driver-activity.ts`; ETA tests green
- [x] API GET + PUT + integration tests (driver own-only, employee read-only, 403/404/422/503, replace, packer-delete cascade)
- [x] OpenAPI paths + schemas
- [x] Mobile service + types + tests
- [x] Mobile Labor tab + tests
- [x] Mobile `assign.tsx` picker + tests
- [x] `new.tsx` / `packer.tsx` `activityId` mode + tests
- [x] Full suites: domain, api, mobile jest, typecheck, lint; restore auto-bumped coverage floors
- [x] DECISIONS + PATTERNS updates (no new GOTCHAS)
- [~] Archive plan → `/workstream-finish` (one PR)

## Files

Modified: `apps/api/prisma/schema.prisma`, `apps/api/src/handlers/labor.ts`,
`apps/api/src/handlers/labor.test.ts`, `apps/api/src/handlers/longhaul-cloud/driver-activity-eta.ts`,
the schema-sync tenant-scoped list, the OpenAPI spec module, `packages/domain/src/labor/*`,
`apps/mobile/app/shipment/[orderNum].tsx`, `apps/mobile/app/labor/new.tsx`,
`apps/mobile/app/labor/packer.tsx`, `apps/mobile/src/services/laborService.ts` (+test),
`dolas/agents/project/{DECISIONS,GOTCHAS}.md`.
Created: `apps/api/prisma/migrations/<stamp>_activity_labor/`, `apps/api/src/lib/longhaul-driver-activity.ts`,
`apps/mobile/src/components/labor/ActivityLaborTab.tsx` (+test), `apps/mobile/app/labor/assign.tsx` (+test).

## Risks

- Legacy activity ids are per tenant DB — always key with `tenantId`.
- `getShipment().activities` may contain generated template rows without ids — the tab reads its
  own endpoint, never the embedded list.
- Refactoring the ETA route's owner lookup could regress it — its existing tests guard it.
- Packer PII becomes readable by employees of the tenant via the order (accepted per decision).
- Local (LocalDispatchJobs) jobs are **out of scope**, as are pay/hours per packer and legacy writes.

## Status (2026-10-23)

Built and green locally on `feat/activity-labor`: domain 515, API 4513 (13 new in
`labor-activities.test.ts`; ETA tests unchanged and green), mobile 366 (22 new), lint +
typecheck clean. Migration `20261023101130_activity_labor`. As built:

- Endpoints live in `handlers/labor.ts`, not a new file, so they share its guard and errors.
  Owner rule + legacy reads are in `lib/longhaul-driver-activity.ts`. The ETA route imports only
  `realDriverId` / `activityOwnerDriverId` from it and keeps its own SQL.
- **Deviation from the design above (review):** "employee" scope is NOT chat's `resolveChatScope`.
  The GET uses `resolveLonghaulReadScope` — PATTERNS ("A driver-scoped write on the legacy longhaul
  tables") requires it for every longhaul driver-data read, and the shipment the tab sits on is
  read through it too. An Operations role (`OPERATIONS_ROLES`) sees every activity; any other
  login sees only what its driver mapping owns, and an unmapped one gets 403.
- `editable` = the caller's `longhaulDriverId` owns the activity, whatever their role, so an
  Operations login that is also a mapped driver can still edit its own activities. The read scope
  widens what is VISIBLE, not what is editable.
- Cross-tenant: a write on activity id N never touches another tenant's rows for N (tested).
- Mobile: `src/components/labor/ActivityLaborTab.tsx`, `app/labor/assign.tsx` (registered in
  `_layout.tsx`). `new.tsx` in activity mode uses `router.dismiss(2)` back to the tab.
  `LaborService.updateActivityLabor` does read-modify-write for the pushed screens.
- No new native modules, but there is no OTA path: release via an EAS build AFTER the API deploys.

Next: `/workstream-finish` (archive this plan → one PR → merge queue).
