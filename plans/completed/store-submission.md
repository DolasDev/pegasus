# Mobile driver app — store submission

Get `@pegasus/mobile` (Pegasus Move Manager, `com.movingstorage.driverapp`) from
"builds land in the test tracks" to "publicly listed on the App Store and Google
Play Production".

The listing **assets** are done — #666 shipped icons, 6.9" iPhone + Play phone
screenshots, the feature graphic and draft listing copy to
`apps/mobile/store-assets/`. This plan is the submission itself: the code the
stores will object to, the decisions only the product owner can make, and the
console work.

## Where things actually stand (verified 2026-09-12)

| Thing                | State                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing assets       | **Done**, on `main` (#666). iOS 1320×2868 = the 6.9" set ASC requires; Play 1080×2400 + 1024×500 feature graphic; `ios/icon-1024.png`, `android/icon-512.png`. |
| `ios.supportsTablet` | **`false`** — #666 made iOS phone-only. **No 13" iPad screenshot set is required.**                                                                            |
| Privacy policy       | Live at `https://pegasus.dolas.dev/privacy.html`. Verify by **content**, not status code — the SPA fallback turns 404 into 200.                                |
| Android              | vcode 15 on the **alpha / closed-testing** track (2026-08-08). Production promotion is manual + staged.                                                        |
| iOS                  | TestFlight build 2 VALID (2026-08-13). Auto-submit wired (#627); ASC app `6800979383`, team `9NJ2BGU4TR`. Creds expire **2027-08-13**.                         |
| Draft listing copy   | `apps/mobile/store-assets/listing/listing-copy.md` — descriptions, keywords, review notes, App Privacy guidance.                                               |

**Both store builds predate #666.** vcode 15 and TestFlight build 2 were built
before the real logo landed, so they still carry the placeholder. A fresh
`mobile-release` dispatch on **both** platforms is required before either
console submission — see "Rebuild" below.

## Decisions (product owner)

1. **RESOLVED 2026-09-15 — brand is Pegasus, product is Move Manager.** Store
   name _Pegasus Move Manager_; login reads _Pegasus / Move Manager_; drawer
   header _Pegasus_; feature graphic _Pegasus / MOVE MANAGER_. Was: the app
   called itself three different things. `app.json` → _Pegasus Move
   Manager_ (the chosen store name); the drawer header → _Pegasus_; the login
   screen (`app/(auth)/login.tsx:42-43`) → _Moving & Storage_ / _Driver Portal_.
   The login copy is the first thing a reviewer and every driver sees. Pick one
   and we align the rest.
2. **RESOLVED 2026-09-15 — the product owner already holds a demo account and
   password** for App Review Information (never committed to the repo). Was: Apple requires a working login
   with _seeded_ data; a login-walled app with an empty dashboard draws a 2.1
   rejection, then a 4.2. This is not a seed script: driver trips come from
   **longhaul MSSQL over the tunnel** (`/me/driver` → `/onprem/longhaul/trips`),
   and the QA tunnel is on-demand only. A _permanent_ demo login needs a tenant
   whose legacy backend is reachable 24/7 — a prod tenant with a real
   `TenantUser.longhaulDriverId` mapping, or a stable demo data source. Decide
   the shape before building anything.
3. **RESOLVED by #690 (landed on `main` during this work) — marketing / support
   URL.** `pegasusmovemanager.com` is now attached to the company site's
   CloudFront distribution; the DNS alias records are the last step, in
   dolas-infra (`pegasus:companySite:aliasEnabled`). Confirm the apex resolves
   and serves before entering it in either console.

## Code changes (this worktree)

- [x] **Drop the dead location config.** `app.json` carries
      `NSLocationWhenInUseUsageDescription` ("optimize delivery routes") and
      `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`, but `expo-location`
      is **not a dependency** and nothing in `src/` or `app/` imports it. Play
      makes you justify a location permission against a real in-app feature, and
      the ASC App Privacy answer must not declare location. Remove all three.
- [x] **Align the app name** — `login.tsx` + its test, `brand.json` subtitle,
      feature graphic now renders `brand.shortName`, docs retitled. Nothing was
      bound to the old strings beyond the login test and the capture's
      `waitFor` text; the legal operator name in `privacy.html` was left alone.
- [x] Re-ran `store:export && store:capture && store:compose`. Only the two
      `01-login` shots and the feature graphic changed; 02–06 regenerated
      byte-identical.
- [x] **`store:export` made self-contained.** A fresh worktree has no
      `apps/mobile/.env`, so the web export booted to the Configuration Error
      screen and every capture failed. The script now bakes placeholder
      `EXPO_PUBLIC_*` values (all `/api/*` calls are fixture-served) and passes
      `--clear` — without it Metro's transform cache kept `config.ts` from the
      env-less run and the placeholders never inlined.

## Rebuild, then submit

Prod dispatch is branch-protected to `main` — merge this branch first.

```
gh workflow run mobile-release.yml --ref main -f env=prod -f platform=android -f submit=true
gh workflow run mobile-release.yml --ref main -f env=prod -f platform=ios -f ios_build=store -f submit=true
```

Workflow success means the build was **accepted**, not finished. Confirm via the
EAS GraphQL recipe (session secret from `~/.expo/state.json`, header
`expo-session`) — `eas build:view` fails locally in this hoisted monorepo.
**Verify what actually got baked by grepping the AAB**, not the CI log: EAS
server-side env vars override the composite-written `.env`.

## Console work (manual, outside the repo)

**App Store Connect** — listing copy + keywords from `listing-copy.md`; upload
the 6.9" screenshots and `icon-1024.png`; App Review Information (demo account +
notes on tenant selection and the hosted-UI SSO flow); App Privacy questionnaire
(email, Cognito `sub`/tenant, camera/photos — **not** location); age rating 4+;
category Business; submit for review.

**Play Console** — listing copy, screenshots, feature graphic, icon; content
rating questionnaire; Data safety form (mirror the ASC answers); then promote
the validated closed-testing build to **Production** as a staged rollout.

## Notes

- `apps/e2e/.env.test` is tracked and the worktree provisioner rewrites its
  `DATABASE_URL`. **It must not ride into the PR** — restore it with
  `git restore apps/e2e/.env.test` before committing.
- Land with `/workstream-finish` (one PR through the merge queue); archive this
  plan `in-progress/ → completed/` in the implementation commit.
