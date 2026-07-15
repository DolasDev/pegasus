# Mobile CI/CD — commit → Google Play production

## Context

The `@pegasus/mobile` driver app (Expo SDK 55 / RN 0.83 / expo-router, `apps/mobile`)
is well-aligned with the rest of the repo: it consumes the same workspace packages
(`@pegasus/api-http|auth|domain|theme`) as the web apps, EAS is already configured
(`projectId`, owner `kbeck`, `eas.json` build/submit profiles), and CI already gates it
on every PR (`expo install --check`, `expo-doctor`, jest via turbo). **Decision: keep
Expo/EAS — no framework switch.** EAS Build handles the Turborepo/npm-workspace layout
natively (resolves the root lockfile), so a switch (bare RN + Fastlane, Flutter, …) would
only discard the workspace-package reuse and the SSM-driven config path that already
mirrors the repo's deploy philosophy — for no benefit.

What's missing is the release automation. Today `mobile-build.yml` is manual-dispatch,
**build-only** — it never submits. `eas submit` is wired nowhere active (only in a dead
orphan `apps/mobile/.github/workflows/ci-cd.yml` that GitHub never runs). This plan wires
the full **push-to-main → EAS build → Google Play production** path for Android, adds an
iOS **simulator** build as a CI signal (real iOS device builds/submission stay deferred
until Apple Developer credentials exist), and keeps a human approval gate via the existing
`prod` GitHub environment.

## Chosen requirements (confirmed with user)

1. **Android now → Play Store production track**; **iOS build in CI** (no App Store submit).
2. **Auto on push to main** (path-filtered to `apps/mobile`) → build → submit to the Play
   **production** track. Submit job gated behind the `prod` environment reviewer (one-click
   human approval before public release — consistent with web deploys).
3. **EAS cloud build** (not `--local`).

## Two realities that shape the design

- **iOS without Apple creds:** real (device) iOS builds need an Apple Developer Program
  membership + signing certs — that blocks _builds_, not just submission. The only iOS
  artifact CI can produce today is an unsigned **simulator** build (`ios.simulator: true`),
  which needs no creds and catches iOS-specific bundling/native breakage. iOS device build +
  App Store submit stay a documented follow-up.
- **Staged rollout is not automatable via `eas submit`:** it has no `userFraction`/rollout
  flag. `eas submit` lands a release on the production track; the rollout **percentage** is
  then either set manually with the Play Console rollout slider, or driven by a separate Play
  Developer API `edits.tracks.update` call (deferred v2). Given the `prod` reviewer gate
  already puts a human in the loop at submit time, the launch design = gated submit → set the
  staged-rollout % in Play Console. Full API-driven staged rollout is a deferred follow-up.

---

## One-time bootstrap — must FULLY precede enabling the auto-trigger (go-live gate, not parallel)

1. **Migrate the EAS project off the personal `owner: "kbeck"` account to an Expo org/robot
   account.** An unattended auto-submit-to-production pipeline must not hinge on one person's
   personal account (2FA/password/offboarding would silently break it). Update `app.json`
   `owner` accordingly. Confirm the Expo **build-credits/plan tier** covers the expected
   push frequency (every mobile-touching main push = 1 Android + 1 iOS-sim cloud build).
2. **Google Play Console** ($25 one-time): create the app for `com.movingstorage.driverapp`
   and complete the entire "Set up your app" checklist — privacy policy URL, content rating,
   target audience, **data safety**, ads declaration, full store listing (icon, screenshots,
   feature graphic, descriptions). These are enforced **per-submission**, not just at first
   upload — an incomplete section rejects _every_ future `eas submit`, automated or not.
3. **First AAB uploaded manually** (Google forbids the API from creating a brand-new app's
   first release): build one `eas build --profile production --platform android`, download
   the AAB, upload via the Console UI (Internal testing is the lowest-friction track that
   satisfies "a release exists"), accept **Play App Signing** enrollment, publish. Note the
   **first review can take days** — it must be live/approved before the pipeline's first real
   submit. (Manual steps already in `apps/mobile/DEPLOYMENT_GUIDE.md` §Google Play.)
4. **Google Cloud service account**: Play Console → Setup → API access → link a GCP project →
   create SA + JSON key. Play Console → Users and permissions → invite the SA email, grant
   least-privilege **single-app** "Release to production … + Play App Signing" (no account-wide
   admin).
5. **Register the SA key with EAS** (`eas credentials` → Android → Google Service Account Key
   for Submissions, uploaded once interactively). Preferred over injecting a GH secret file
   each run — raw key material never touches a CI runner or GH secret store; only `EXPO_TOKEN`
   needs project scope. Then drop `serviceAccountKeyPath` from `eas.json`.
6. **Seed the remote versionCode counter**: `eas build:version:set` so the next automated
   Android `versionCode` is strictly greater than the manually-uploaded one — otherwise the
   first automated submit fails with "version code already used."

`EXPO_TOKEN` secret and `prod`/`staging` environments already exist.

---

## Implementation

### 1. Delete the dead orphan

Remove `apps/mobile/.github/workflows/ci-cd.yml` (GitHub never runs nested `.github`; it uses
removed `expo publish`, node 20, `--legacy-peer-deps`).

### 2. `eas.json` changes (`apps/mobile/eas.json`)

- `cli.appVersionSource: "remote"` (top-level `cli`, not per-profile) — EAS owns the monotonic
  Android `versionCode`.
- `build.production.autoIncrement: true` — bumps only the **native build number**
  (`versionCode`), NOT the marketing `version` in `app.json` (that stays a manual bump).
- Add a distinct **`ios-simulator-ci`** profile: `{ "extends": "production", "ios": { "simulator": true, "resourceClass": "m-medium" } }` — honest semantics, no Apple creds.
- `submit.production.android.track`: `"internal"` → **`"production"`**; **remove**
  `serviceAccountKeyPath` (EAS-hosted key from bootstrap step 5). Leave iOS submit
  `PLACEHOLDER`s (deferred).
- Narrow `cli.version` from open-ended `">= 13.2.0"` to a bounded range (e.g. `">=13.2.0 <14.0.0"`)
  so an unattended pipeline can't be surprised by a CLI major bump.

### 3. Generalize `mobile-build.yml` → `mobile-release.yml`

Keep the proven SSM→`.env` resolution; add triggers and split the jobs.

- **Triggers:**
  - `push: branches: [main]` with `paths:` on `apps/mobile/**` + the four shared packages
    (`packages/api-http/**`, `packages/auth/**`, `packages/domain/**`, `packages/theme/**`).
    Main uses squash-merges, so single-commit `push.paths` diffing is reliable. Add a comment
    explaining why mobile uses a plain path-filter rather than `deploy.yml`'s `last-deploy`
    watermark (mobile is a single independent component; no cross-component cancellation risk).
  - Keep `workflow_dispatch` (env staging/prod, platform, `skip_submit` toggle) for on-demand.
  - `concurrency: cancel-in-progress: false` (mirror the existing choice — never drop a queued build).
- **Jobs** (iOS decoupled from the Android submit chain so a simulator-build blip can't block a release):
  ```
  resolve-config (SSM → apps/mobile/.env: EXPO_PUBLIC api URL + Cognito, prod params on push)
    ├─ build-android  (eas build --profile production --platform android --json → capture buildId)
    │     └─ submit-android  (environment: prod gate;
    │            eas submit --platform android --profile production --id <buildId>)
    └─ build-ios-simulator  (eas build --profile ios-simulator-ci --platform ios)  [no downstream dep]
  ```
  - Use `--id <buildId>` (captured from `eas build --json`), **not** `--latest` — avoids a
    race where a concurrent build hijacks the submit.
  - `submit-android` runs on push-to-main, or on dispatch unless `skip_submit`.

### 4. Docs

Update `apps/mobile/DEPLOYMENT_GUIDE.md` to make the automated pipeline the canonical path and
fold in the bootstrap checklist above. Note that the mobile pipeline is a **separate workflow**
from `deploy.yml`/`_deploy.yml` (CDK-only) — it deliberately does not join the
`deploy-manifest.json` component set.

---

## Files touched

- `apps/mobile/.github/workflows/ci-cd.yml` — **delete**.
- `.github/workflows/mobile-build.yml` → `mobile-release.yml` — extend (triggers + split build/submit jobs).
- `apps/mobile/eas.json` — versioning, `ios-simulator-ci` profile, production track, drop `serviceAccountKeyPath`, pin `cli.version`.
- `apps/mobile/app.json` — `owner` → Expo org (bootstrap).
- `apps/mobile/DEPLOYMENT_GUIDE.md` — reflect automated flow + bootstrap checklist.

## Verification

1. **Static:** `actionlint .github/workflows/mobile-release.yml`; `npx expo-doctor` and
   `npx expo install --check` in `apps/mobile` (already CI-gated); sanity-read eas.json.
2. **iOS simulator build:** `workflow_dispatch` with `skip_submit=true`, platform ios →
   green unsigned simulator build with no Apple creds.
3. **Submit dry-run to a low track first:** validate the EAS-hosted SA key + `eas submit`
   end-to-end against the **internal** track (dispatch) **before** the first automated
   production push — so the first prod submit isn't the first time submit runs.
4. **Full path:** after the complete bootstrap, push a trivial `apps/mobile` change to main →
   `build-android` runs → approve the `prod` gate → `submit-android` lands the release →
   set the staged-rollout % in Play Console → confirm it appears on the production track.
5. Confirm a main push touching neither `apps/mobile/**` nor the four shared packages does
   **not** trigger the workflow.

## Deferred (explicit follow-ups)

- iOS device build + App Store submit (Apple Developer account, ASC App ID, Team ID → fill eas.json iOS placeholders).
- Fully-automated staged-rollout % via Play Developer API `edits.tracks.update` (removes the manual slider step).
