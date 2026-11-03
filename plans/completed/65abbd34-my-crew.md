# My Crew — a driver's own packers, auto-assigned when a trip is accepted

**Branch:** `feat/my-crew` (worktree `../pegasus-my-crew`). All changes stay on this branch.

**Goal:** a driver keeps a private **My Crew**: packers who work with them, entered directly
rather than picked from a shared crew. Each one can be flagged **Every job**. When dispatch moves
one of the driver's trips to Accepted, every Every-job packer is assigned to that driver's labor
activities on the trip (PACK, LOAD, UNPK, RDEL, XDEL). The same tick emits a new `trip.accepted`
domain event that tenant Automations can subscribe to.

## What exists today (measured on `main` @ `19ad9517`)

- **Crew book (#878).** `Crew` is platform-wide and keyed by E.164 phone. `Packer` rows hang off a
  crew (`crewPhone` FK). A driver reaches a crew through `CrewLink` (`tenantUserId`), and a tenant
  through `CompanyCrewLink` (#888).
- **Activity labor (#881).** `ActivityLaborCrew` (tenant, activityId, orderNum, crewPhone) and
  `ActivityLaborPacker` (crew assignment × packer) record who worked a legacy
  `LongDistanceDispatchActivity`. `PUT /labor/activities/:id { crews }` replaces the set. Only the
  activity's own driver may write (`activityOwnerDriverId` = assigned driver, else trip driver).
- **Acceptance.** The mobile app shows Offered trips but has **no accept action**. Tenant-web
  changes status only through `PATCH /onprem/longhaul/trips/:id/status` (`trips-write.ts`,
  `longhaulTripStatusHandler`; tenant-web `API.changeTripStatus`). That handler already detects
  the confirm transition, Pending/Offered (1/2) → Accepted/In-Progress (3/4), as `clearReady`.
  Legacy MoveManager writes straight to SQL Server, and Pegasus never sees those writes.
- **Events.** `emitDomainEvent(tx, …)` writes the `DomainEvent` outbox. The dispatcher Lambda only
  starts tenant workflow executions, and there is no internal subscriber. `DOMAIN_EVENT_TYPES` is a
  public contract, duplicated in tenant-web `api/workflows.ts` and listed in the SDK MCP server
  docstring.
- **TenantUser has no phone number**, so a personal crew can't be a `Crew` keyed by the driver's
  phone.

## Steve's answers (2026-10-26)

1. **Trigger:** no Accept button. Acceptance stays with dispatch, and the auto-assign fires when
   tenant-web moves the trip to Accepted. The packers come from the trip's driver's My Crew, not
   the caller's.
2. **Activities:** labor types only: **PACK, LOAD, UNPK, RDEL, XDEL** (`ActivityType_code`).
3. **Source:** a **new personal crew**. The driver enters packers directly.
4. **Crew model:** **private to the driver**. Its packers get their own "My crew" group on each
   activity's Labor card.
5. **Wiring:** a **direct, idempotent assign right after the status commit, plus a new
   `trip.accepted` domain event**. The assign rows and the event row commit in one Postgres
   transaction.

## Calls I made (flag any to change)

1. **"Accepted" means the existing confirm transition**: from 1/2 to 3 **or 4**. Offered →
   In-Progress also confirms the driver, the same rule `clearReady` uses.
2. **Whose crew:** for each labor activity on the trip, use the activity's **owner**
   (`activityOwnerDriverId`, the same rule the Labor tab uses). Map that owner to their
   `TenantUser`(s) via `longhaulDriverId` in the tenant, and assign those users' Every-job members.
   An unmapped driver is a silent no-op, logged, like `enqueueTripAssignmentPush`.
3. **Idempotent, additive only.** It inserts with `skipDuplicates` and never removes anyone. Once
   the trip is accepted, a member the driver unticks stays unticked. If the trip bounces back to
   Offered and is accepted again, the auto-assign runs again and re-adds them. That edge case is
   rare and harmless.
4. **Best-effort.** The legacy status write has already committed, so a Postgres failure is logged
   and the status PATCH still returns 200. That matches the trip-save push precedent ("best-effort
   by design"). No retry queue.
5. **The event fires on every confirm transition, even when there's nothing to assign.** Payload
   (pointer-style): `{ tripId, driverId, fromStatusId, toStatusId, assigned: [{ activityId,
memberIds }] }`. It's added to `DOMAIN_EVENT_TYPES` (api + tenant-web copy + the domain-events
   test) and to the SDK MCP docstring. That's a patch bump of `workflows-sdk-python` with a
   CHANGELOG entry. Tag and publish after the merge.
6. **Label: "Every job"**: a switch on each My Crew row, with a hint under the section header:
   "Added to your pack, load and delivery jobs when a trip is accepted."
7. **Old app builds keep working.** `PUT /labor/activities/:id` gains an optional `memberIds`. When
   it's omitted, member assignments are left alone, so an old build saving crews never wipes the
   auto-assigned members.

## Design

### Data (Postgres, tenant-scoped; one migration)

- `DriverCrewMember` → `labor_driver_crew_members`: `id`, `tenantId`, `tenantUserId` (owner,
  cascade), `firstName`, `lastName`, `email?`, `cidNumber?`, `cidIssuedOn?` (date), `phone?`,
  `cidKey?`, `emailKey?`, `everyJob Boolean @default(false)`, `removedAt?`, `createdAt`, `updatedAt`.
  `@@unique([tenantUserId, cidKey])`, `@@unique([tenantUserId, emailKey])`,
  `@@index([tenantId, tenantUserId])`. The fields and validation are the packer's: reuse
  `validatePacker` from `@pegasus/domain`.
- `ActivityLaborMember` → `activity_labor_members`: `tenantId`, `activityId` (legacy id, no FK),
  `orderNum`, `memberId` (FK cascade — only a TenantUser/tenant delete reaches it; members are soft-deleted), `assignedByUserId?` (SET NULL; null = auto-assigned),
  `createdAt`. `@@id([tenantId, activityId, memberId])`, `@@index([tenantId, orderNum])`.
- Both go in `TENANT_SCOPED_MODELS` (`apps/api/src/lib/prisma.ts`).

### Domain (`packages/domain/src/labor`)

- `LABOR_ACTIVITY_TYPE_CODES = ['PACK','LOAD','UNPK','RDEL','XDEL']` and
  `isLaborActivityType(code)` (trim + uppercase).
- `isTripConfirmTransition(from, to)`. `trips-write.ts` `clearReady` uses it too, so the rule
  lives in one place.
- `MAX_CREW_MEMBERS = 50`.

### API

- `/labor/my-crew` (Read/WriteLabor; refuses `apiClient` like the rest of the handler):
  - `GET` → my members A–Z.
  - `POST` → create (packer fields + `everyJob`); 409 `PACKER_DUPLICATE` on the identity keys.
  - `PATCH /:id` → edit fields and/or `everyJob`; 404 when it isn't mine.
  - `DELETE /:id` → **soft delete** (Steve, 2026-10-26: keep history): sets `removedAt`. A
    removed member leaves My Crew, is never auto-assigned and can't be newly ticked, but stays
    (read-only) on the jobs they worked. A `POST` whose CID/email key matches one of my removed
    members **restores** it with the new fields, so the plain unique keys stay valid.
- `GET /labor/orders/:n/activities`: each activity gains `myCrew: [{ id, firstName, lastName,
phoneDisplay, everyJob, selected }]`. When editable, that's the caller's members (`selected` when
  assigned) plus any assigned member the caller doesn't own or has removed (so Operations sees who worked it).
  Read-only callers see only the assigned ones.
- `PUT /labor/activities/:id`: optional `memberIds: string[]`. Every NEWLY ticked id must be the caller's own,
  un-removed member (422 `MEMBER_NOT_YOURS`); one already assigned may stay after removal. It replaces that activity's member set in the same transaction
  as the crews.
- `lib/labor-auto-assign.ts`: `autoAssignOnTripAccepted({ db, tenantId, connectionString, tripId,
driverId, fromStatusId, toStatusId })`.
  1. Read the trip's activities (new `tripActivities(cs, tripId)` in `longhaul-driver-activity.ts`,
     the same `ACTIVITY_SELECT` filtered on `TripMaster_id`).
  2. Keep the labor types.
  3. Group by owner driver, then map to TenantUsers (by `longhaulDriverId`, tenant named
     explicitly; TenantUser isn't auto-scoped), then their `everyJob` members.
  4. In one `db.$transaction`: `activityLaborMember.createMany({ skipDuplicates })` +
     `emitDomainEvent('trip.accepted', …)`.
- `longhaulTripStatusHandler`: when `isTripConfirmTransition(old, new)`, after the SQL write call
  the auto-assign inside a try/catch (log `labor auto-assign failed`, never fail the PATCH).
- `openapi-spec.ts`: new routes + the `memberIds` / `myCrew` fields.

### Mobile

- **Labor drawer:** a third segment **My list | Company | My crew** (drivers only;
  `useLaborAccess().isDriver`). The My crew list shows each member as a row with an "Every job"
  switch (saves immediately) plus a hint line, and tapping a row opens edit. "+ Add" opens the
  member form. Search and Import/Export are hidden on this segment.
- **Member form:** generalize `app/labor/packer.tsx` to a `target` param (crew packer | my-crew
  member) rather than duplicating it. The fields are the same (name, CID + issued, phone, email),
  plus the "Every job" switch when the target is My crew. Delete is on the edit screen.
- **Activity Labor tab:** when `myCrew.length > 0` or the activity is editable, add a "My crew"
  group under the crews, with a checkbox per member that saves through the same locked PUT
  (`memberIds`). An editable activity with no members links to "Add to My crew".
- `laborService` + types: `getMyCrew`, `addMyCrewMember`, `updateMyCrewMember`,
  `deleteMyCrewMember`, `memberIds` in `activityLaborInput`.

### Tenant-web

- Only add `trip.accepted` to `DOMAIN_EVENT_TYPES` (the trigger picker). No labor UI, consistent
  with #881's mobile-only labor.

## Tests

- Domain: `isLaborActivityType`, `isTripConfirmTransition` (the full 1–5 × 1–5 matrix).
- API: my-crew CRUD (ownership, duplicates, cap, `apiClient` refused). PUT with and without
  `memberIds` (omitted means untouched; a foreign member gives 422). GET `myCrew` shape for the
  owner vs Operations. Auto-assign: only labor types; owner = assigned driver over trip driver;
  unmapped driver means no rows but the event is still emitted; duplicates skipped; the
  Postgres failure is swallowed and the PATCH still returns 200. The status handler calls the
  auto-assign only on the confirm transition (2→3 and 1→4 yes; 3→4 and 4→5 no).
- Schema sync / tenant-scope guard tests pick up the new models.
- Mobile: the My crew segment (list, toggle, add), the member form in both targets, and the
  Activity Labor tab's My crew group (tick → PUT with memberIds; locked while saving). Use
  `AFTER_DEBOUNCE` for any debounced find (#888 gotcha).

## Release

- API first: merge → Deploy green. Then dispatch the mobile-release EAS build (there's no OTA
  path) and submit to the Play internal track. Old builds are safe in the meantime (calls 7 and 4).
- Tag + publish `sdk-python-vX.Y.Z` after the merge (the MCP docstring change).
- DECISIONS.md entry: the private My Crew vs the shared Crew; direct assign + event rather than an
  internal subscriber, and why (SQL Server write, no shared transaction, no subscriber hook).

## Do not commit

- `apps/api/vitest.config.ts` coverage-floor bumps from local full runs; restore with `git checkout`.
- `apps/e2e/.env.test` and `package-lock.json` provisioning diffs from the worktree.

## Status

- [x] Plan approved (Steve, 2026-10-26 — with soft delete)
- [x] Domain + migration (`20261026220922_my_crew`)
- [x] API (my-crew CRUD, activity labor members, auto-assign + event, status hook)
- [x] Mobile (My crew segment, member form via `labor/packer?myCrew=1`, Labor tab group)
- [x] SDK docstring + bump to 0.53.1, tenant-web taxonomy
- [x] Local suites green (2026-10-26): domain labor 80, API 4621 (309 files), mobile 427
      (48 suites), SDK 516; tsc + eslint clean on api / mobile / tenant-web
- [ ] Review, PR, merge, deploy → EAS build (Android internal) → tag `sdk-python-v0.53.1`

### Code review (2026-10-26, /code-review high)

**Fixed:**

- Others now see only a member's name.
- `trip.accepted` still fires when the assign fails (`assignFailed`).
- The `!db` skip is logged.
- A member toggle re-reads the activity before its PUT.
- A removed member's identity keys are released when an active member needs them.
- The duplicated activity query is deduped.

**Accepted, not fixed:**

- The 50-member cap is count-then-create, so a double-tap can reach 51. Harmless.
- Two concurrent accepts of the same trip both read Offered, so `trip.accepted` emits twice. Member rows are deduped by `skipDuplicates`, but the event is not. Fixing it would mean making the legacy status UPDATE conditional on the status read (a behavior change to a ported write), or adding a dedupe key to `DomainEvent`. Flag this to Steve.
- The status PATCH now awaits a legacy activity read plus a Postgres transaction before it answers. It is best-effort, and its failures are swallowed.

### Notes from the build

- The trip-save path (`lib/longhaul-trip-save.ts`) writes back the `TripStatus_id` its DTO
  carries and is **not** hooked. Tenant-web changes status only through `API.changeTripStatus` →
  the status PATCH.
- `trips-write.ts` `clearReady` now uses `isTripConfirmTransition` too. It's the same predicate,
  and its existing tests are unchanged and pass.
- On the Labor tab, a crew-only change sends no `memberIds` (`setActivityLabor(id, crews,
undefined)`), so it can never race the auto-assign on members.
