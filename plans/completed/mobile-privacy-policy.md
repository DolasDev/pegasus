# Mobile Driver App — Privacy Policy Refresh & Publish

## Goal

Take the testing-era privacy policy for the **Moving & Storage Driver** mobile app,
bring it in line with what the app _actually_ does today, publish it on the
tenant web app at a public (unauthenticated) URL, and hand the user that URL so
they can update the Google Play / App Store app registrations.

## Why

The existing policy was written during early TestFlight/closed-testing and makes
claims that are very likely stale — notably:

- "logs are stored locally on the device and are not transmitted to external servers"
- proof-of-delivery photos "stored locally on your device ... until manually deleted"
- "No transmission of personal data over the internet without appropriate security measures"
- "does not currently integrate third-party analytics, advertising, or crash reporting"
- no mention of **push notifications** (credentials + TestFlight wiring landed in #562/#590/#627)
- no mention of the cloud API / account & tenant model (the app cold-starts by
  fetching the driver from the Pegasus API — #605)

A store-facing policy that understates data transmission is both a compliance and
an app-review risk.

## Plan

1. **Audit `apps/mobile` against every factual claim in the policy.** Specifically:
   - `app.json` / `app.config.js` — declared permissions, plugins, usage strings
   - push notifications: token registration, what identifiers are sent upstream
   - proof-of-delivery photos: local-only or uploaded to the API / S3?
   - location: foreground vs background; are coordinates transmitted?
   - auth/session: what's stored on-device (SecureStore?), what's transmitted
   - logging/telemetry: local only, or shipped to CloudWatch/a backend sink?
   - any third-party SDKs (analytics, crash reporting) actually present
2. **Rewrite the policy** so each claim matches the code. Keep the existing
   structure/section numbering where it still fits; fix the numbering gap
   (2.1 → 2.3 with no 2.2). Refresh Last Updated / Effective dates.
3. **Publish it on tenant-web at a public URL** — must be reachable by app-store
   reviewers _without logging in_, so a static page under `apps/tenant-web/public/`
   (or a route explicitly outside the auth guard), whichever the app's routing
   makes cleanest.
4. **Land it** as one PR through the merge queue, wait for the tenant-web deploy,
   then **curl the live URL** and confirm 200 + correct content before reporting it.

## Scope

Docs / static asset only. No API, no schema, no SDK surface changes.

## Done when

- Policy content is verified accurate against `apps/mobile` as it stands today.
- The page is live on the production tenant-web domain at a stable, public URL.
- That URL has been fetched and confirmed, and reported to the user.

---

## Outcome

Published at **`https://pegasus.dolas.dev/privacy.html`** —
`apps/tenant-web/public/privacy.html`, a self-contained static page. Vite copies
`public/` into `dist/`, which `FrontendAssetsStack` uploads to the site bucket
root, so the file is a real S3 object served at 200 without the SPA bundle
executing — the property that matters for a store-registration URL a validator
may fetch headlessly. (The distribution's SPA fallback maps 403/404 → 200
`/index.html`, so an extensionless `/privacy` would have rendered only after JS
booted and, lacking a route, resolved to the not-found page. Hence `.html`.)

`apps/mobile` Settings → Legal → Privacy Policy previously opened an
`Alert.alert('…would be displayed here.')` placeholder; it now opens the
published URL via `expo-web-browser`. The URL is hard-coded to prod on purpose —
the store listings name exactly one address.

### Audit findings — what the testing-era policy got wrong

Every claim below was checked against source, not inferred:

| Old claim                                                                                   | Reality                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Location used "to optimize delivery routes and track order progress", incl. GPS coordinates | **No location collection at all.** No `expo-location` dependency; no location API called anywhere in `src/` or `app/`.                     |
| Photos captured via camera stored **locally**, "retained until manually deleted"            | Documents are **uploaded to S3** through the API (`documentService.ts`, 3-step presigned flow). Local files are cache-dir temporaries.     |
| Photo library access via `expo-image-picker`                                                | `expo-image-picker` is declared in `package.json` + `app.json` plugins but **imported nowhere**. File selection is `expo-document-picker`. |
| Driver **signatures** captured                                                              | No signature capture exists. "Proof of Delivery" is one of eight `documentType` values for an uploaded file.                               |
| App updates **order status**                                                                | Trips/shipments are **read-only**. The only writes are auth, `POST/DELETE /device-tokens`, and document upload/finalize.                   |
| "No transmission of personal data over the internet"                                        | The App is an API client end-to-end (Cognito, `/onprem/longhaul/*`, `/documents/*`).                                                       |
| — (absent)                                                                                  | **Push notifications.** Expo push token — a device identifier — is registered server-side against the account and deactivated on logout.   |
| App name "Moving & Storage Driver"                                                          | `app.json` name is **Pegasus Move Manager**; bundle id `com.movingstorage.driverapp` unchanged.                                            |
| Logs "stored locally on the device"                                                         | Console-only in dev; a no-op transport in production. Nothing persisted, nothing transmitted. Accurate in spirit, restated precisely.      |
| §2.2 missing (2.1 → 2.3)                                                                    | Renumbered.                                                                                                                                |

### Follow-up not done here (needs a new store build)

`app.json` still declares permissions the App never exercises:
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
`NSLocationWhenInUseUsageDescription`, `READ/WRITE_EXTERNAL_STORAGE`, and the
unused `expo-image-picker` plugin + dependency. Google Play rejects apps
declaring location without demonstrated use, and a manifest advertising
`FINE_LOCATION` beside a policy saying "we do not collect location" is exactly
the pairing that draws review. Strip them before the next submission —
deliberately excluded from this change, which must describe the build currently
in the stores.
