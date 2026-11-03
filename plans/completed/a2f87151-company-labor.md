# Company labor list — a tenant-owned crew list (mobile + tenant-web Operations → Labor)

**Branch:** `feat/company-labor` (worktree `../pegasus-company-labor`). All changes stay on this branch.

**Goal:** a **company-owned** list of cash-labor crews, scoped to the tenant, that works like a
driver's own crew book but is shared across the company. Drivers read it, add to it, edit packer
membership on it, and copy crews into their own book. Operations users manage it (create, update,
delete) from the mobile app's Labor tab and from a new **Operations → Labor** screen in tenant-web.

## What exists today (measured on `main` @ `c231db3a`)

- `Crew` is **platform-wide**, keyed by E.164 phone (`labor_crews`). Name, email, service areas and
  packers are shared. A driver reaches a crew only through their own `CrewLink` (`tenantUserId`),
  which also holds the private nickname and 1–5 rating. Adds are rate-limited to 100 per user per
  24 h via the append-only `CrewLinkAdd`. (#878)
- `ActivityLaborCrew` / `ActivityLaborPacker` (tenant-scoped) record which crews and packers worked
  an activity. A crew newly assigned must be in the caller's book (`CREW_NOT_IN_YOUR_LIST`). (#881)
- `56-labor-shared.cedar` permits Read/WriteLabor to every principal. The handler refuses
  `apiClient` callers. The handler header says "there is no role to gate on".
- Operations access is gated by **role name** (`OPERATIONS_ROLES`), not Cedar. The list is held
  twice: `apps/api/src/lib/longhaul-read-scope.ts` (enforced) and
  `apps/tenant-web/src/auth/role-guard.ts` (UX). The persona `.cedar` files are deliberate
  placeholders.
- **Mobile login has no role gate.** Nothing in `authService.ts`, `api/handlers/auth.ts` or
  `login.tsx` rejects a non-driver, and `session.roleNames` is on the mobile `Session`. A non-driver
  can already sign in. What they get is a driver-shaped app (Dashboard / My Trips fed by
  `/me/driver`, which is unmapped for them).

## Reading of the request

- "Drivers should be able to read from this list and add to it … but remove a crew from it" is
  read as **but NOT remove**. The sentence contrasts drivers (read + add) with Operations
  (create/update/delete).
- "Edits the drivers make to crew packer membership however should be allowed" means a driver may
  add, edit and delete **packers** on a company crew, even one not in their own book.

## Calls I made (flag any to change)

1. ~~Header edits Operations-only~~ — **Steve, 2026-10-23: drivers may edit EVERYTHING on a
   company crew except removing it from the company list** (name, email, service areas, company
   nickname, packers). Removal is the only Operations-only action.
2. **Ratings stay private, per `CrewLink`.** A company card shows the existing anonymous average
   (3+ raters). Your own stars appear only when the crew is also in your book. There is no
   company-level rating.
3. **Company crews can be assigned to activities.** The `PUT /activities/:id` check becomes "in
   your book **or** on your company's list". Without that, "drivers read from this list" doesn't
   help them on the job.
4. **A driver's "Add to company list" uses their own link.** It is offered from the card of a crew
   already in the driver's book, so it creates no new crew and spends no add budget. A **new**
   crew created straight onto the company list (Operations, by phone + name) does spend the
   creator's `CrewLinkAdd` budget. The 100/day limit is what stops the phone-number space being
   walked, and the company list must not become a way around it.
5. **"Add to my list" needs no new endpoint.** The existing `POST /crews {phone, name}` already
   links to an existing crew idempotently, and counts against the budget like any add.
6. **The company list has its own optional `nickname`,** a company display name editable by
   Operations. Renaming the shared `Crew.name` still changes it for every linked driver, at any
   tenant. That is the existing platform-wide design (#878), and nothing new.
7. **Removing a crew from the company list deletes only the company link,** never the platform
   `Crew`. Past `ActivityLaborCrew` rows stay; they are history (as #881).
8. **Mobile visibility:**
   - **Driver** (role `driver` or a `/me/driver` mapping): Labor shows two tabs, **My list |
     Company**.
   - **Operations user** (Steve confirmed Labor + Messages only when not a driver): sees the Company tab with create/edit/delete. If they are not also a
     driver, the drawer hides Dashboard and My Trips and the app opens on Labor.
   - **Neither:** the Labor entry is hidden. The Dashboard is not redesigned.
9. **One `OPERATIONS_ROLES` list.** It is hoisted into `packages/auth` and re-exported from the two
   existing sites, so mobile becomes a consumer and not a third copy.
10. **Tenant-web Labor sits inside the Operations group,** so it inherits the group's `longhaul`
    capability gate. A tenant without a legacy DB won't see it, even though this list lives in
    Postgres only. That's acceptable because the request puts it in Operations. Moving it is a
    one-line nav change later.
11. **No Cedar change.** Read/WriteLabor stays open to everyone. The Operations gate is
    `hasOperationsRole(principal.roleNames)` in the handler, the same sanctioned pattern as
    `resolveLonghaulReadScope`. The comments in the cedar file and the handler header get updated,
    since "no role to gate on" stops being true.
12. **Out of scope:** company-list export (.vcf/.csv), contacts import onto the company list, and
    any tenant-web view of a driver's private book.

## Design

### Schema — one new tenant-scoped model

```prisma
/// A crew on the tenant's company list. The crew record (name, service areas,
/// packers) is the shared platform-wide `Crew`; this row is the tenant's grant.
model CompanyCrewLink {
  id              String   @id @default(uuid())
  tenantId        String   @map("tenant_id")
  crewPhone       String   @map("crew_phone")
  /// Company display name (Operations-editable); falls back to Crew.name.
  nickname        String?
  addedByUserId   String   @map("added_by_user_id")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  crew    Crew       @relation(fields: [crewPhone], references: [phone], onDelete: Cascade, onUpdate: Cascade)
  addedBy TenantUser @relation(fields: [addedByUserId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([tenantId, crewPhone])
  @@index([crewPhone])
  @@map("labor_company_crew_links")
  @@schema("public")
}
```

- Add it to `TENANT_SCOPED_MODELS` in `apps/api/src/lib/prisma.ts` and to the
  tenant-isolation enumeration test. It does **not** go in `INTENTIONALLY_UNSCOPED`.
- The migration is stamped after main's latest at implementation time (currently
  `20261023101130_activity_labor`).
- `addedBy` cascades on user delete, matching `ActivityLaborCrew.assignedBy`.

### Shared Operations role list

- Add `OPERATIONS_ROLES` and `hasOperationsRole(roleNames)` to `packages/auth`, exported from the
  index.
- `apps/api/src/lib/longhaul-read-scope.ts` and `apps/tenant-web/src/auth/role-guard.ts`
  re-export from there, keeping their current export names so call sites don't change. Mobile
  imports it directly.
- Check the dependency direction first: does `apps/api` already depend on `@pegasus/auth`? If it
  doesn't, and adding it is heavier than the win, keep the API copy and add a test that asserts the
  copies agree. Record which way it went in Status.

### API — `apps/api/src/handlers/labor.ts` + `repositories/labor.repository.ts`

**A common row shape for search.** `crewDto` / `matchesText` / `rankFrom` currently take
`CrewLinkRow`. Introduce a `CrewView` built from either kind of link:

```ts
{
  crew,
  nickname,
  myLink: CrewLinkRow | null,
  companyLink: CompanyCrewLinkRow | null,
}
```

The `/crews` and `/company/crews` searches then share one `searchCrews(views, q)` function, not a
second 100-line copy. The company include mirrors `LINK_INCLUDE` (serviceAreas +
`_count.packers`).

`crewDto` gains these fields:

| Field                  | Meaning                                           |
| ---------------------- | ------------------------------------------------- |
| `inMyList`             | the caller has their own link                     |
| `inCompanyList`        | the crew is on the caller's tenant's company list |
| `companyNickname`      | the company display name                          |
| `canRemoveFromCompany` | caller is Operations                              |

`displayName` resolves in this order: my nickname, then the company nickname, then `crew.name`.

**The access helper.** `requireCrewAccess(c, who, phone)` returns
`{ link: CrewLinkRow | null, company: CompanyCrewLinkRow | null }`, and 404s
`CREW_NOT_FOUND` when both are null. The company lookup is always `{ tenantId: who.tenantId, crewPhone }`.

| Route                                           | Access rule                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /crews/:phone`                             | `requireCrewAccess` (detail works for company-only crews)                                            |
| `POST/PATCH/DELETE /crews/:phone/packers[/:id]` | `requireCrewAccess`: drivers may edit packers on company crews                                       |
| `PATCH /crews/:phone` (name/email)              | `requireCrewAccess`. `nickname` here stays the caller's private link nickname and needs the own link |
| `PUT /crews/:phone/service-areas`               | `requireCrewAccess`                                                                                  |
| `PUT/DELETE /crews/:phone/rating`               | own link only (unchanged)                                                                            |
| `DELETE /crews/:phone`                          | own link only (unchanged; removes from MY list)                                                      |

**New company routes.** All of them refuse `apiClient` callers via `caller()`, as today.

| Route                                                   | Who             | Behaviour                                                                                                              |
| ------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /company/crews?q=`                                 | any tenant user | the same search semantics as `GET /crews` (A–Z, ZIP/city nearest-first, region, text), over the tenant's company links |
| `POST /company/crews {phone, name?, email?, nickname?}` | any tenant user | see "POST behaviour" below                                                                                             |
| `PATCH /company/crews/:phone {nickname}`                | any tenant user | company display name                                                                                                   |
| `DELETE /company/crews/:phone`                          | Operations      | removes the company link only, then 204                                                                                |

POST behaviour:

- **Already on the company list:** 200 with `meta.outcome: 'alreadyInList'`.
- **Caller has their own link:** link it with `outcome: 'addedFromMyList'`. No budget is spent.
- **Operations, crew not in their book:** `validateCrew` + `ensureCrew`. A new crew spends the
  budget (`CrewLinkAdd` row, 429 `LINK_RATE_LIMITED` when exhausted); an existing crew is linked
  with `outcome: 'linkedExisting'`.
- **Non-Operations, crew not in their book:** 422 `CREW_NOT_IN_YOUR_LIST`. Drivers add from their
  own book.
- A unique violation on a concurrent add is treated as `alreadyInList`.
- A non-Operations caller on DELETE gets 403 `OPERATIONS_ONLY`.

**Activity labor:**

- In `PUT /activities/:activityId`, a newly added crew passes when it is in the caller's book
  **or** on the tenant's company list.
- `activityLaborDtos` adds `inCompanyList`, and `displayName` falls back to the company nickname.
- In `GET /orders/:orderNum/activities`, nothing else changes.

**Other API work:**

- Add the new paths and fields to `apps/api/src/lib/openapi-spec.ts`.
- Update the handler header and the `56-labor-shared.cedar` comment to describe the Operations
  gate on company-list writes.

### Domain (`packages/domain/src/labor`)

No new rules beyond reuse (`validateCrew`, `normalizeNickname`). If the search refactor wants a
pure helper (e.g. `displayNameOf(view)`), it lives here with tests.

### Mobile (`apps/mobile`)

- **`laborService.ts`:** add `listCompanyCrews(q)`, `addToCompanyList(phone, extras?)`,
  `updateCompanyCrew(phone, {nickname})` and `removeFromCompanyList(phone)`. `addToMyList(crew)`
  wraps the existing `POST /crews`. The types in `src/types/labor.ts` gain the new DTO fields.
- **Role helper** (`src/auth/roles.ts` or similar): `isOperations(session)` comes from the shared
  `hasOperationsRole`. `isDriver` is role `driver` or a `/me/driver` mapping, which
  `TripsContext` already has.
- **`(drawer)/labor.tsx`:** a segmented control, **My list | Company**, is shown when the user is a
  driver. An Operations-only user sees Company only. The same search, A–Z sections and `CrewCard`
  serve both, with a `scope` prop. On Company:
  - the "+" (new crew) shows only for Operations and posts to `/company/crews`;
  - Import and Export stay My-list only.
- **`labor/[phone].tsx`** (the contact card) shows:
  - **Add to company list** when `inMyList && !inCompanyList`;
  - **Add to my list** when `inCompanyList && !inMyList`;
  - **Remove from company list** when `canRemoveFromCompany && inCompanyList`, behind a confirm;
  - header and service-area editing whenever the caller can see the crew;
  - packer add/edit/delete always (the request allows it);
  - the rating section only when `inMyList`;
  - the existing "Remove from my list" only when `inMyList`;
  - the company nickname, editable by anyone, as a field next to the header.
- **`labor/new.tsx`:** takes a `scope=company` param so Operations create straight onto the company
  list.
- **Activity labor assign picker (`labor/assign.tsx`):** lists my crews plus company crews not in
  my book, in two sections.
- **Drawer (`DrawerContent.tsx` + `(drawer)/_layout.tsx`):**
  - Labor is shown when driver or Operations.
  - Dashboard and My Trips are hidden for an Operations user who is not a driver; Messages stays.
  - The initial route for that user is `labor`. Verify what `(drawer)/index.tsx` and `trips.tsx`
    show an unmapped non-driver today, and only fix what is needed for a clean landing.
- No new native modules. It still needs an **EAS build after the API deploys** (no OTA path).

### Tenant-web (`apps/tenant-web`)

- **Route:** add `/driver-planning/labor` in `router.tsx` with `beforeLoad: requireRole(...OPERATIONS_ROLES)`,
  lazy-loaded like the other Operations modules. Add a sixth `OPERATIONS_CHILDREN` entry, `Labor`,
  in `AppShell.tsx`.
- **Feature** `src/features/driver-planning/labor/` (or `features/labor/` if that reads better
  against the tree):
  - a search box with the API's semantics, debounced;
  - a table of display name, phone, service areas, packer count, average rating, and distance when
    a location search is active;
  - **New crew** dialog (phone, name, email, company nickname);
  - a detail drawer/page to edit name/email/company nickname, edit service areas (city typeahead
    via `GET /labor/places`), and add/edit/delete packers (name, email, phone, CID + issue date);
  - **Remove from company list** with a confirm.
- Reuse the existing UI kit, dialogs and query hooks used by the Services board / Availability
  screens. Error codes surface legibly (409 dupes, 422, 429).

## Tests

- **API (`labor.test.ts` + a new `labor-company.test.ts` if the file gets long):**
  - company search (each query kind);
  - POST as a driver with a link, as a driver without a link (422), and as Operations for a new
    crew (budget spent, 429 at the limit) and an existing crew;
  - an idempotent add;
  - PATCH/DELETE as a driver (403) and as Operations;
  - packer CRUD by a driver on a company-only crew;
  - header and service-area edits allowed for a driver on a company-only crew;
  - rating refused without an own link;
  - cross-tenant: tenant B can't see or touch tenant A's company link (404);
  - activity labor assigning a company-only crew;
  - DELETE keeping the `Crew` and the activity history;
  - a tenant-isolation enumeration test that includes `CompanyCrewLink`.
- **Domain:** any new pure helper.
- **Mobile:**
  - the service functions;
  - the drawer gate (driver / Operations-only / neither);
  - the Labor segments;
  - card buttons for each combination of `inMyList` / `inCompanyList` / Operations;
  - the assign picker including company crews.
- **Tenant-web:**
  - a route test (guarded, renders list, search);
  - create, edit and remove flows with a mocked API;
  - the nav entry visible for `OPERATIONS_ROLES` only.
- **E2E:** the SKIP_AUTH user has no `TenantUser` row, so Playwright can't exercise these FK routes
  (GOTCHAS). The coverage is unit/integration.

## Traps / do-not-commit

- Each full API suite run auto-bumps the floors in `apps/api/vitest.config.ts`. Run
  `git checkout` on it after every run.
- The `apps/e2e/.env.test` and `package-lock.json` diffs are worktree provisioning. Leave them out.
- `@pegasus/domain` (and `@pegasus/auth`) are Metro-aliased to `src/` in mobile. Check that the
  `packages/auth` export resolves in the Metro + jest config.
- Archive this plan to `plans/completed/<hash>-company-labor.md` in the implementation commit,
  **before** opening the PR.

## Release

- **API + tenant-web** ship with the normal Deploy on merge.
- **Mobile** ships through the `mobile-release` EAS build. Dispatch it **only after the API deploy
  is green**, then submit to the Play internal track as for #878/#881. iOS is still owed from
  earlier.

## Status (2026-10-23)

- [x] Schema + migration + tenant scoping. `CompanyCrewLink`, migration `20261023200000_company_crew_links`.
      After review, `addedByUserId` is **nullable with ON DELETE SET NULL**: deleting the user who added a
      crew must not empty the company list.
- [x] Shared `OPERATIONS_ROLES` in `packages/auth`, used by tenant-web and mobile. **The API keeps its own
      copy** because it does not depend on `@pegasus/auth`, and adding a workspace dependency touches the CDK
      bundling path (#762). `longhaul-read-scope.agree.test.ts` asserts the two copies agree.
- [x] API work:
  - `requireCrewAccess` lets a driver reach crews in their own book or on the company list.
  - `listViews`/`searchViews` now serve both lists.
  - Added the `/company/crews` GET, POST, PATCH and DELETE routes.
  - Activity labor accepts company crews.
  - Updated the OpenAPI spec and the cedar comment (the comment must stay ASCII; `load.test.ts` checks).
- [x] Review fixes, API:
  - An Operations add by phone is charged to the budget only once it actually links a crew.
  - Sending `nickname: null` on a crew that is only on the company list is now a no-op instead of a 422.
  - The other list is read with a light `select`.
- [x] Mobile:
  - The Labor screen has My list | Company segments.
  - The contact card has "Add to company list", "Add to my list" and "Remove from company list"
    (Operations only).
  - New-crew scope, assign-picker sections, and the drawer gate.
  - An Operations-only user is sent from `/` or `/trips` to `/labor`.
  - Review fix: a **failed** `/me/driver` call (`mappingFailed`) no longer counts as "not a driver".
  - Review fix: on a crew in both lists, the shared fields go in one call.
- [x] Tenant-web:
  - New Operations → Labor screen at `/driver-planning/labor`, guarded by `OPERATIONS_ROLES`.
  - Search table, new-crew dialog, and a detail drawer with header, service areas, packers and remove.
  - Review fix: a `distanceMiles` of null renders as "—", not "0 mi".
- [x] Suites: API 4530, tenant-web 1678, mobile 410, auth package; typecheck and lint are clean.
- Not changed: the review asked to gate `PATCH /company/crews` on Operations. Steve's decision (drivers
  edit everything except remove) stands.
- The budget check-then-spend race on concurrent adds is the same as the existing `POST /crews`, so it is
  left as is.
- **Release:** API + tenant-web ship with Deploy. Mobile needs an EAS build after the API deploy is green.
  There are no new native modules, but there is also no OTA path.
