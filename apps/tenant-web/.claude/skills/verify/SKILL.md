---
name: verify
description: Drive the real tenant-web SPA in a browser to observe a change working — launch with the e2e auth seam, stub the API at the network layer, and capture what the app actually sends.
---

# Verifying tenant-web changes

Runtime observation for `apps/tenant-web`. Drives the real SPA in Chromium; no
Cognito login and no API/database needed.

## 1. Launch with the e2e auth seam

```bash
cd apps/tenant-web && npx vite --mode e2e --port 5199 --strictPort
```

`--mode e2e` is what matters: `src/auth/session.ts` returns a synthetic
`tenant_admin` session when `import.meta.env.MODE === 'e2e'`, so the
`authGuard` (`src/auth/guard.ts`) on every protected route passes without a
login. A plain `npx vite` redirects to `/login` and you will get stuck there.
The seam is build-time only and dead-code-eliminated from prod bundles.

## 2. Stub the API at the network layer

The SPA reads its API base URL from `/config.json` at runtime (`apiUrl`), then
calls `<apiUrl>/api/v1/...`. Intercept both with Playwright `page.route`:

- `**/config.json` → the **complete** object below. `loadConfig()`
  (`src/config.ts`) hard-requires `apiUrl` plus **all five** `cognito` strings and
  throws if any is missing, so the app renders a bare **"Configuration error"**
  page and nothing else. An elided `cognito: { ... }` stub fails this way even
  though the e2e auth seam means none of the values are ever used — any
  placeholder string will do. (`features` is optional and parsed defensively.)

  ```js
  {
    apiUrl: 'http://localhost:3000',
    cognito: {
      region: 'us-east-1',
      userPoolId: 'us-east-1_test',
      clientId: 'testclientid',
      domain: 'https://test.auth.us-east-1.amazoncognito.com',
      redirectUri: 'http://localhost:5199/auth/callback',
    },
  }
  ```

- `**/api/v1/**` → your stubs

**Envelope: handlers return `{ data: ... }` and `apiFetch` unwraps `.data`.**
Returning a bare array/object gets you `Cannot read properties of undefined`
in the redux thunks. Mirror the real handler shape.

## 3. driver-planning (longhaul) specifics

The module bootstraps through **one batched call**, not seven:

- `GET /api/v1/onprem/longhaul/reference-data` →
  `{ data: { drivers, tripStatuses, states, zones, planners, dispatchers, filterOptions } }`
  (`redux/common/index.ts` fans it out into the per-slice reducers)
- `GET .../version` → `{ data: { clientVersion, supportedVersions: [{ supported_client_version }] } }`
  — omit it and `fetchVersionSuccess` throws.
- `GET .../users/me` — AppGuard gates the module on this.

Route to `/driver-planning/planning` for the trip builder. Selectors are
`data-target` hooks (`driver-typeahead`, `save-trip`, `pending-trips`,
`trip-name-input`); see `apps/e2e/tests/browser/longhaul/pages/`.

Save routing (`utils/api/routes.ts`): `trip.id` present → `PUT /trips/:id`,
else `POST /trips`. A stubbed `{ data: { id: 555 } }` response makes the next
save an update, which is how you exercise both paths in one session.

**Gotchas that will eat a run:**

- Changing the driver on an already-saved trip opens the **"Record a rejected
  trip?"** dialog and _returns without saving_ — click "Save without recording"
  to let the save through. Its overlay also swallows clicks, and `saveDisabled`
  stays true while it is open, so a missed dialog silently kills every later save.
- Wait for the "Succesfully saved trip" snackbar to hide between saves; it
  intercepts pointer events. `click({ force: true })` for good measure.
- Drivers from the list carry `driver_id` and **no `id`** — mirror that exactly
  in stubs, or you will reproduce the bug that `id`-shaped fixtures hid.

## 4. Capture

Read `route.request().postData()` in the handler to assert on what the app
actually sent. That request body is the evidence — screenshot the pane too.

Run scripts from the repo root (`node ./x.tmp.mjs`) so `@playwright/test`
resolves from the root `node_modules`; `/tmp` cannot resolve it. Clean up after.
