# Labor module — driver-private cash-labor crew contacts (mobile "Labor")

## Context

Drivers hire local cash-labor crews (packers/loaders) at each stop and today keep them in their phone contacts. We'll add a **Labor** module to the Expo driver app that stores crews in Pegasus. Access works like a phone book: a driver can see a crew only if they have added that crew's phone number to their own list.

Decisions you made (2026-10-20):

- **Shared record, private extras.** There is one `Crew` row per phone number. Every linked driver sees and can edit its name, service areas and packers. Ratings, comments and a nickname stay private to each driver.
- **Platform-wide.** Crews are not tenant-scoped, so drivers at different tenants who add the same phone number share the record.
- **Ratings.** The card shows the driver's own stars plus an anonymous average.
- **CID** is a Candidate ID (a certification number). The date is the **issue** date, so there is no expiry logic.
- **Search** covers **US and Canada**.
- **Empty search** shows an **A–Z** list. GPS / "near me" is out of scope.

### Consequences to accept with this plan

1. **Cross-tenant PII.** Packer names, emails and CIDs entered at tenant A become visible at tenant B to anyone who adds that crew's phone number. That is how the "phone = access" model works. Mitigations: link creation is rate-limited per driver (see Phase 1 handler, about 100 new links per day), and a non-linked crew returns 404.
2. **Links key on `TenantUser.id`.** It is per-tenant and matches `tenantMiddleware`. If a driver is deactivated or moves to another tenant, their list does **not** follow them. This is why the export exists.
3. **Average privacy.** The anonymous average and count appear only when **3 or more** drivers have rated the crew. Below that, the card shows only the driver's own stars, because with 2 raters each could work out the other's rating.
4. **The phone number is the crew's identity and cannot change.** A new number means a new crew. "Remove from my list" deletes only my link and my rating. The crew record stays for other drivers.
5. **No SDK change.** This is not an integrations or workflows feature. OpenAPI is still updated.

## Status (2026-10-20)

- **Phase 1 (domain + API + geo data): BUILT** on `feat/labor-crews`. Domain `labor/` (501 domain
  tests green, 100% line coverage held), `handlers/labor.ts` + `repositories/labor.repository.ts`
  (23 integration tests against real Postgres + geo data), migrations `20261021200000_labor_crews`
  and `20261021200100_geo_places_data` (23,011 cities, 35,291 postal codes), OpenAPI, authz.
- **Phase 2 (mobile): BUILT** on the same branch. Steve chose to review both halves together, so
  this is **one PR, not two**. That is safe because `mobile-release.yml` is `workflow_dispatch`
  only and there is no OTA publish: merging puts nothing in front of drivers. The one ordering
  rule left is **dispatch the EAS build only after the API deploy (and its geo migration) has
  landed.**
  - Labor drawer screen, crew page, add-crew, contacts import and packer form, plus 6 components.
  - Mobile suite: 286 tests, typecheck, lint, `expo install --check` and expo-doctor all green.
  - The Android bundle was verified with `packages/domain/dist` moved aside.
  - **Needs an EAS native build + store release (`expo-contacts`, `expo-sharing`). No OTA.**
  - **Release-time, outside this repo:** the privacy policy at `pegasus.dolas.dev/privacy.html`
    and the App Store / Play data-safety answers must now declare contacts access. Only the
    contacts the driver picks are uploaded (name, phone, email).

**Code-review fixes (2026-10-20):**

- The add rate limit counts an append-only `CrewLinkAdd` log (migration
  `20261021200200_labor_crew_link_adds`). Removing a crew no longer frees budget, which add/delete
  cycles could otherwise use to walk the number space.
- CSV export cells starting with `= + - @` get a leading `'` (formula injection), except E.164 phones.
- `+` followed by a NANP-shaped 10-digit number is rejected ("add +1"), so it no longer becomes a
  second, foreign identity for the same crew.
- The `:phone` param is no longer double-decoded (`%25zz` was a 500).
- Concurrent service-area saves give a 409 `SERVICE_AREAS_CONFLICT` instead of a P2002 500.
- The import looks up existing crews' names in one query instead of one per row.
- The import screen keeps earlier batches' results when a later batch fails, and says that a
  crew's name, phone and email are shared.
- Text search matches phone digits only when the query has no letters.

**Raised by review, kept as designed (Steve confirmed 2026-10-21):**

- Any linked driver can read and edit a shared crew's packers.
- A crew outlives its last link.
- The first importer's contact name becomes the shared crew name.

**Where Phase 2 deviates from the text below:**

6. **No `LaborContext`.** The detail routes live on the root Stack, outside `(drawer)/_layout`, so
   a provider mounted there can't reach them. Instead, the list and crew screens re-query on focus
   (`useFocusEffect`), which also picks up edits made on pushed screens.
7. **CID issue date is a masked `YYYY-MM-DD` text field, not a native date picker.** One optional
   field didn't justify a third native module. `validatePacker` (the same domain function the API
   runs) rejects impossible and future dates.
8. **`@pegasus/domain` is aliased to `src/index.ts` in `metro.config.js`.** Its `main` is the
   gitignored `dist/`, which nothing builds on an EAS machine. This is the first mobile import of
   domain (see GOTCHAS).
9. **The `expo-sharing` config plugin is not added.** It only configures "share INTO the app"
   (disabled by default); `shareAsync` needs no plugin. **The `expo-contacts` plugin's
   `WRITE_CONTACTS` is stripped** via `android.blockedPermissions`, since the app only reads.
10. **Header actions are buttons under the search bar**, not in the navigation header, because the
    drawer header's right slot holds the user menu.

**Where Phase 1 deviates from the text below:**

1. **Authz is a shared permit, not driver + tenant_admin.** `56-labor-shared.cedar` grants
   `ReadLabor`/`WriteLabor` to every principal, like `55-chat-shared.cedar`. There is no role to gate
   on, because the handler reaches only crews the caller linked themselves. It also sidesteps the
   persona-grant traps (`30-personas/*.cedar` is pinned 1:1 to persona names, one permit per file).
   Updated: `authz.test.ts`, `me.test.ts`, `authz-smoke.spec.ts`.
2. **US cities come from GeoNames `cities500`, not the Census Places file.** The Gazetteer has no
   population, which typeahead ranking needs, and it suffixes names ("Atlanta city"). The ZCTA file has
   no state column, so a ZIP's region is taken from the nearest city. That is a display label only;
   nothing ranks on it.
3. **No Playwright API acceptance spec.** Under SKIP_AUTH the `userId` (`skip-auth-user`) has no
   `TenantUser` row, so every link-creating route hits the foreign key (see GOTCHAS). The Vitest
   integration suite covers the real router end to end instead.
4. **`CrewLink` is in the schema-sync test's `INTENTIONALLY_UNSCOPED`.** It has an audit-only `tenantId`,
   and the cross-tenant rating aggregate deliberately reads other drivers' links.
5. **Search semantics, settled:**
   - Free text matches a crew's name, nickname or phone first.
   - Only when nothing matches is the text tried as a city name.
   - A state or province code filters crews A–Z; it does not rank them.
   - An unknown ZIP or city answers `[]` with `meta.locationNotFound`.

## Data model (Prisma: `apps/api/prisma/schema.prisma`, global, NO `tenantId`)

These models must **not** be added to `TENANT_SCOPED_MODELS` (`apps/api/src/lib/prisma.ts`). Follow the global-model precedent (`Tariff400ng*`, `FeatureFlag`). Verify that `db-access-guard` and any schema lint accept a model without a tenant.

| Model                                          | Key fields                                                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Crew` (`labor_crews`)                         | `phone` **@id** (E.164), `name`, `email?`, `createdByUserId`, `updatedByUserId`, timestamps                                                                                                                          |
| `CrewLink` (`labor_crew_links`)                | `id`, `tenantUserId` → TenantUser (cascade), `tenantId` (audit only), `crewPhone` → Crew, `nickname?` (private; defaults to the phone contact's name), `@@unique([tenantUserId, crewPhone])`, `@@index([crewPhone])` |
| `CrewServiceArea` (`labor_crew_service_areas`) | `id`, `crewPhone`, `city`, `region` (state or province), `country` (US/CA), `geoCityId?` → GeoCity, `lat?`/`lon?` (copied at write time), `createdByUserId`, `@@unique([crewPhone, country, region, cityKey])`       |
| `Packer` (`labor_packers`)                     | `id`, `crewPhone`, `firstName`, `lastName`, `email?`, `cidNumber?`, `cidIssuedOn? @db.Date`, `phone?`, `cidKey?`, `emailKey?`, audit cols, `@@unique([crewPhone, cidKey])`, `@@unique([crewPhone, emailKey])`        |
| `CrewRating` (`labor_crew_ratings`)            | `id`, `crewLinkId` **@unique** → CrewLink (cascade), `stars` 1–5 (DB CHECK), `comment?` (≤1000), timestamps                                                                                                          |
| `GeoCity` (`geo_cities`)                       | `id`, `country`, `region`, `name`, `nameKey` (lowercased, ASCII-folded), `lat`, `lon`, `population?`, `@@index([nameKey])`, `@@index([country, region])`                                                             |
| `GeoPostalCode` (`geo_postal_codes`)           | `country`, `code` (US ZIP5 or CA FSA, the first 3 characters), `lat`, `lon`, `region`, `@@id([country, code])`                                                                                                       |

**Packer identity.** `cidKey = lower(lastName)|cidNumber` and `emailKey = lower(lastName)|lower(email)`, both nullable. Postgres allows multiple NULLs, so a phone-only packer has no identity key and is not deduplicated. Identity is **per crew**: a packer belongs to one crew. The domain layer derives the keys. A unique violation → 409 `PACKER_DUPLICATE`.

## Phase 1 — domain + API + geo data (PR 1)

**Domain `packages/domain/src/labor/`** (pure functions, `DomainError`, re-exported from `src/index.ts`, tests in `__tests__/labor.test.ts`):

- `normalizePhoneNumber(raw, defaultCountry='US')`. NANP rules: strip formatting and extensions, handle 10 digits or a leading `1`/`+1`. Other `+…` input is accepted only if it passes the existing `isValidE164` (`messaging/index.ts`). Anything else → `INVALID_PHONE_NUMBER`.
- `validatePacker(input)` checks:
  - `firstName` and `lastName` are required;
  - at least one of `email`, `cidNumber` or `phone` is given;
  - `cidIssuedOn` is required if and only if `cidNumber` is given;
  - `cidIssuedOn` is not in the future;
  - the email format is valid.
    It returns the normalized record plus `cidKey`/`emailKey`.
- `parseLocationQuery(q)`. It recognises a US ZIP5 (also ZIP+4), a CA FSA or full postal code (`A1A 1A1` → FSA), `City, ST`, a bare `City`, and a 2-letter state or province. Anything else becomes free text.
- `rankCrewsByDistance(crews, origin)`. A crew's distance is the **minimum** haversine distance across its service areas, reusing `haversineMiles` (`rating/mileage.ts`). Check at implementation that the inflation factor is applied by the estimator, not inside `haversineMiles`. Crews with no geocoded area sort last, then by name.
- `aggregateRating(ratings, minCount=3)` → `{ average, count } | null`.
- `crewsToVCard(crews)`. Produces vCard 3.0 with:
  - one contact per crew: `FN` = nickname or name, `TEL;TYPE=CELL`, `EMAIL`, `ORG:Labor crew`, and a `NOTE` holding service areas, my stars and my comment;
  - one contact per packer that has a phone: `ORG` = crew name, `NOTE` = CID number and issue date.
    It follows RFC 6350 escaping and line folding.
- `crewsToGoogleContactsCsv(crews)`, with the same content in Google Contacts CSV headers.

**Geo data.**

- `scripts/generate-geo-places.ts` follows the `scripts/generate-zip3-centroids.ts` precedent and **writes a Prisma data migration** of batched INSERTs, so every environment, worktree DB and e2e DB gets the data from `db:migrate` with no separate loader step.
- Sources: the US Census Gazetteer (ZCTA plus Places, public domain), and GeoNames `CA` postal FSAs plus `cities500` filtered to CA (CC-BY 4.0, so attribution is added to the app's About/Settings screen).
- Expect about 70k rows, roughly 3–4 MB of SQL, as a one-time commit.

**Handler `apps/api/src/handlers/labor.ts`**:

- It is mounted with `v1.route('/labor', …)` in `app.ts`.
- It rejects `apiClient` callers, like `chat.ts:94`.
- It does **not** require `longhaulDriverId`.
- Every crew read or write goes through `CrewLink where { tenantUserId: c.get('userId'), crewPhone }`. A non-linked crew → 404.

| Route                                                     | Purpose                                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /labor/crews?q=`                                     | My crews with service areas, my rating, the aggregate and a packer count. With a location `q`, results are ranked nearest first and include `distanceMiles`. Free text matches name, nickname or phone. |
| `POST /labor/crews`                                       | Add one crew `{phone, name, email?, nickname?}`. It upserts the Crew, creates my link and is idempotent. If the crew already exists, its shared name is not overwritten.                                |
| `POST /labor/crews/import`                                | Batch version for the phone-contacts import (≤200). It returns per-row results: `added`, `alreadyInList`, `linkedExisting` or `invalidPhone`.                                                           |
| `GET /labor/crews/:phone`                                 | Header, service areas, packers, my rating and the aggregate.                                                                                                                                            |
| `PATCH /labor/crews/:phone`                               | Shared fields `name`, `email`, plus my `nickname`.                                                                                                                                                      |
| `DELETE /labor/crews/:phone`                              | Removes **my link** and my rating.                                                                                                                                                                      |
| `PUT /labor/crews/:phone/service-areas`                   | Replaces the list. Each entry is resolved to a `GeoCity` when one matches; unmatched entries are kept but have no lat/lon.                                                                              |
| `POST / PATCH / DELETE /labor/crews/:phone/packers[/:id]` | Packer CRUD, using `validatePacker`.                                                                                                                                                                    |
| `PUT /labor/crews/:phone/rating`                          | Upserts `{stars, comment?}`.                                                                                                                                                                            |
| `DELETE /labor/crews/:phone/rating`                       | Deletes my rating.                                                                                                                                                                                      |
| `GET /labor/places?q=`                                    | City typeahead (US and CA) for the service-area editor. Prefix match on `nameKey`, ranked by population, ≤20 results.                                                                                   |
| `GET /labor/export`                                       | The full export of my list. The client renders it with the domain functions.                                                                                                                            |

- **Rate limit:** about 100 new links per driver per rolling 24h, counted from `CrewLink.createdAt`. Over the limit → 429 `LINK_RATE_LIMITED`.
- **Authz:**
  - New actions `ReadLabor` / `WriteLabor` in `authz/actions.ts`, plus a resource type in `cedar.schema.json`.
  - One policy file, `56-labor-driver.cedar`, granting both actions to the `driver` persona and `tenant_admin`.
  - Memory warns that persona `.cedar` files can grant nothing (Operations is gated by role name). Verify that the grant actually takes effect.
  - Update `lib/authz.test.ts` and `apps/e2e/tests/api/authz-smoke.spec.ts`.
- **OpenAPI:** add the paths and schemas (`Crew`, `Packer`, `CrewRating`, `ServiceArea`) to `lib/openapi-spec.ts`.
- **Tests:** a Vitest integration suite `handlers/labor.test.ts` covering:
  - link isolation: driver B gets 404 on driver A's crew until B adds the phone, and then sees the shared packers;
  - the import outcomes;
  - packer validation and duplicate 409s;
  - the average shown only at 3 or more raters;
  - distance ordering for a ZIP, a city, a state and a CA FSA;
  - the rate limit;
  - remove-from-list leaving the crew in place for other drivers.

  Also add an API acceptance spec in `apps/e2e/tests/api/`.

## Phase 2 — mobile (PR 2, `apps/mobile`)

The app uses a drawer, not tabs, so "Labor" becomes a drawer module.

**Navigation**

- Add `app/(drawer)/labor.tsx` and a `Drawer.Screen` in `(drawer)/_layout.tsx`.
- Add a `DrawerItem` in `src/components/DrawerContent.tsx`.
- Add detail routes flat on the root Stack in `app/_layout.tsx` with `detailHeader`: `labor/[phone].tsx`, `labor/import.tsx`, `labor/new.tsx` and `labor/packer.tsx`. The packer form is used for both add and edit.

**Data**

- Add `src/services/laborService.ts`, with static methods over `getApiClient().fetch`, following `tripService.ts`.
- Add `src/context/LaborContext.tsx`, following `TripsContext`.

**Screens**

- **Labor list:**
  - a `SearchBar` at the top, debounced, querying `GET /labor/crews?q=`;
  - an empty query shows a `SectionList` grouped A–Z, like the phone's contacts app;
  - a location query shows a flat list ordered nearest first, with an "x mi" label;
  - each `CrewCard` shows the name or nickname, phone, top service areas, my `StarRating`, and the average and count (when there are 3 or more raters);
  - the header actions are **Add Crew**, with a choice of "From contacts" or "Enter manually", and **Export**;
  - the empty state is a "no crews yet" prompt.
- **Import from contacts:**
  - uses `expo-contacts`, handling the permission states granted, **limited** (iOS 18) and denied, with a settings deep-link for denied;
  - shows a searchable multi-select list, hiding contacts with no phone number;
  - for a contact with several numbers, the driver picks one (mobile is the default);
  - contacts already in the list are shown as "Added";
  - submits to `/labor/crews/import`, then shows a summary of the per-row results.
- **Crew page:**
  - the header shows the name and phone, with tap-to-call and tap-to-text via `Linking` (`tel:`/`sms:`), the shared email, and my private nickname;
  - the **Service areas** chip list can be edited using the city typeahead from `/labor/places`;
  - **My rating** has a star picker and a comment box (save or clear), with the average shown under it;
  - a **Packers** list; tap a packer to edit it, and swipe or long-press to delete;
  - an **Add packer** button opens the packer form;
  - a "Remove from my list" action asks for confirmation.
- **Packer form:**
  - fields for first and last name, email, CID number, CID issue date (a date picker that appears only when a CID number is entered) and phone;
  - the inline checks mirror `validatePacker`; the domain package is importable through the `@pegasus/*` jest mapping and the Metro config, so reuse it rather than copying it.
- **Export:**
  - `GET /labor/export` → `crewsToVCard` / `crewsToGoogleContactsCsv` → write to `FileSystem.cacheDirectory` → `expo-sharing` share sheet;
  - two choices: **Contacts file (.vcf)**, recommended, which iOS and Android Contacts import directly; and **Spreadsheet (.csv)** in Google Contacts format, which imports via contacts.google.com.

**New components** in `src/components/`: `SearchBar`, `StarRating` (both a read-only and an input mode), `CrewCard`, `ServiceAreaEditor`, `PackerRow`.

**Native and config**

- Run `npx expo install expo-contacts expo-sharing`. Add a date picker only if none is installed; check this first.
- In `app.json`: the `expo-contacts` plugin with `contactsPermission` text, iOS `NSContactsUsageDescription`, and Android `READ_CONTACTS`.
- Add the new modules to `transformIgnorePatterns` in `jest.config.js`.
- The new native modules mean an **EAS native build and store release; this cannot ship as an OTA update.** Follow the release notes in the `project_mobile_driver_app` memory.

**Tests:** screen tests in `__tests__/app/` (the labor list, the crew page, the import screen with mocked `expo-contacts`, the packer form validation), plus service tests next to their source.

## Delivery

- Seed via `workstream-start`, so each PR carries the plan and the code.
- The order is PR 1 (domain, API and geo migration), then PR 2 (mobile), which ships only after PR 1 is deployed.
- Update `dolas/agents/project/DECISIONS.md` with the platform-wide crew decision, the PII trade-off and the TenantUser link key. Update `GOTCHAS.md` with anything found about global models and guards.
- Follow-ups, not in v1: an admin moderation tool for shared crew edits, "near me" via GPS, moving a packer between crews, and full CA postal codes beyond the FSA.

## Verification

1. `npm run typecheck` and `npm test` at the root. Domain unit tests cover the phone normalizer, packer rules, query parser, ranking, the aggregate threshold, and vCard/CSV escaping and folding.
2. API integration tests against Docker Postgres after `npm run db:migrate`. Confirm the geo tables are populated (`SELECT count(*) FROM geo_cities`).
3. Run `npm run e2e` for the API acceptance and authz-smoke specs.
4. Manually on an iOS simulator or a device with a dev build:
   - import 3 contacts and add one crew manually;
   - search `30301`, `Atlanta, GA`, `GA` and `M5V`, and check nearest-first order;
   - rate a crew;
   - add packers, including the CID-without-date error and a duplicate CID → 409;
   - sign in as a second driver, add the same phone, and see the shared packers but not the first driver's comment;
   - export a `.vcf`, import it into Contacts, and check the entries round-trip.
5. Code review (`/code-review`) before each PR.
