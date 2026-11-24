# Driver ETA submission — optional tenant Operations setting

**Branch:** `feat/driver-eta-setting` (worktree `../pegasus-driver-eta-setting`)
**Goal:** Tenants can turn driver ETA submission in the mobile app on or off from
**Settings → App → Operations**. When it is off, drivers can't post ETAs and the
API refuses ETA writes.

## Decisions

- **D1 — Field:** `operations.driverEtaSubmission: boolean | null` in
  `AppSettingsSchema`. JSON column, so no migration is needed.
- **D2 — Default OFF when unset (user decision 2026-11-24)**, like the
  `driverTaskRules` sibling. Only an explicit `true` enables it, and the rule
  lives in one helper, `isDriverEtaEnabled(settings)`. ⚠️ Driver ETAs are live at
  NW today, so a tenant admin must tick the setting on NW (and any other tenant
  that wants it) after deploy, or their drivers lose ETA entry.
- **D3 — The API enforces it.** When the setting is off, both ETA write routes
  return `403 DRIVER_ETA_DISABLED`, and the guard runs before any legacy SQL:
  - `PATCH /onprem/longhaul/driver/activities/:id/eta` (trip Delivery/SIT-IN, writes legacy)
  - `PUT /onprem/longhaul/me/itinerary/acts/eta`. The guard goes in
    `myItineraryEtaHandler`, NOT `assertOnOwnItem`, which the DONE path shares.
    Clearing an ETA is blocked too. Itinerary "mark done" is unaffected.
- **D4 — Mobile reads the setting from `GET /me/driver`**, which gains
  `driverEtaEnabled: boolean`. If the field is missing (an older API, which has
  no enforcement), the app treats it as `true`. If the call fails, it treats it
  as `false`, which hides the UI and matches the default.
- **D5 — Mobile UI when off:** the itinerary hides the ETA action. On the trip
  screen the Delivery ETA cards still show the ETA but aren't tappable.
  `trip/[id]` sits outside `TripsProvider` (it isn't in `(drawer)`), so that
  screen calls `TripService.getDriverMapping()` itself. Inside the drawer,
  `TripsContext` exposes `driverEtaEnabled`.
- **D6 — Out of scope:** the SDK, MCP and OpenAPI surfaces. A grep for the
  sibling `driverTaskRules` shows it appears only in the api lib/handlers and
  tenant-web, with no SDK/OpenAPI/e2e hits. It is a tenant Operations
  preference, not an integrations or workflows capability.
- Checked: the `submit-arrival-times` To Do rule means "mark acts done", not
  ETAs, so it is unaffected. The crew-leader link has no ETA writer.

## Checklist

- [x] 1. `apps/api/src/lib/app-settings.ts`: add the field and
      `isDriverEtaEnabled`. Tests in `app-settings.test.ts`.
- [x] 2. `apps/api/src/handlers/longhaul-cloud/driver-activity-eta.ts`: add
      `appSettings` to the tenant select and the 403 guard. Add a test.
- [x] 3. `apps/api/src/handlers/longhaul-cloud/itinerary.ts`: guard in
      `myItineraryEtaHandler`. Add a test.
- [x] 4. `apps/api/src/handlers/me.ts`: add `driverEtaEnabled` to `/me/driver`.
      Add a test.
- [x] 5. tenant-web: type in `api/queries/app-settings.ts`; new
      `features/settings/app/DriverEta/index.tsx` card; mount it in
      `routes/settings.app.operations.tsx`. Add a component test.
- [x] 6. mobile: `types/longhaul.ts` `DriverMapping.driverEtaEnabled?`;
      `services/tripService.ts` `getDriverMapping` returns it;
      `context/TripsContext.tsx` exposes it; `app/(drawer)/itinerary.tsx` hides
      the ETA action; `app/trip/[id].tsx` makes the cards read-only. Update
      tests.
- [x] 7. Typecheck, lint, and test api, tenant-web and mobile. Update
      `dolas/agents/project` docs if anything new was learned.

## Risks

- A mobile build without this change still shows the ETA UI. When the setting is
  off, saving returns a 403, and the modal shows the API's error text.
- The mobile flag is read at start-up or screen load. If the setting changes
  mid-session, the user gets the 403 message until the next refresh.
