# Mobile permission guidance: push, camera, contacts (iOS + Android)

- **Branch:** `feat/mobile-permission-nudges` (to be created via `/workstream-start`; NOT started)
- **Goal:** No driver ends up silently without push or the iOS scanner. Ask at the right moment
  with context. Detect denial. Nudge with a fix that works on that platform: re-ask while the OS
  allows it, otherwise deep-link to Settings.

## Findings: how it works today (apps/mobile, read 2026-11-24)

| Permission            | iOS                                                                                                                                                                                       | Android                                                                                                                                                 | Where requested                                                                                                                              | On denial today                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Push**              | One-shot prompt; after "Don't Allow" only Settings can fix it                                                                                                                             | API 33+: runtime `POST_NOTIFICATIONS` prompt; 2 denials ⇒ never shown again. API ≤32: on by default, but the user can switch off the app or its channel | `registerForPush` (`src/services/pushNotifications.ts`), called **cold right after login and again on every foreground** (`app/_layout.tsx`) | Only clue: Settings → App Information shows the raw text "Not registered — permission denied". There is no action button, and dispatch has no way to see it.                      |
| **Camera (scanner)**  | `VNDocumentCameraViewController` (VisionKit) needs camera access. The plugin (`react-native-document-scanner-plugin` 2.0.4, `ios/DocScanner/DocScanner.swift`) never checks authorization | **No app permission involved.** The ML Kit `GmsDocumentScanner` runs inside Play services                                                               | First tap on **Scan** (`AddDocumentModal.handleScan`), when the OS prompt appears                                                            | iOS: behavior unverified (the plugin has no auth check, so expect a black preview or an error). If it errors, the user sees a generic "Scanning failed", a dead end. Android: n/a |
| **"Storage" / files** | **No permission.** "Choose file" is `expo-document-picker` → `UIDocumentPicker`                                                                                                           | **No permission.** Storage Access Framework                                                                                                             | n/a                                                                                                                                          | n/a                                                                                                                                                                               |
| **Contacts**          | Prompt + iOS 18 _limited_ access                                                                                                                                                          | Runtime prompt                                                                                                                                          | `loadPhoneContacts` on Labor → Import                                                                                                        | **Already correct:** `canAskAgain` → "Allow access", else "Open Settings". Limited access → "Choose more". **This is the template to follow.**                                    |

Other facts that shape the plan:

- **Push is the one that matters.** Trip assignments, chat, `task.blocked`, and workflow messages
  all depend on it.
- **The foreground re-request is actively harmful on Android 13+.** It re-shows the system dialog
  every time the app is resumed. A driver who dismisses it twice is permanently in "don't ask
  again", which burns Android's only re-ask budget without any explanation. On iOS it is a silent
  no-op after the first answer.
- **No soft ask anywhere.** The iOS push prompt, which can only be shown once, appears with no
  context the moment the dashboard loads.
- **Unused permission baggage in `app.json`.**
  - Android: `CAMERA`, `READ_EXTERNAL_STORAGE`, and `WRITE_EXTERNAL_STORAGE` are declared but not
    needed (ML Kit scanner, SAF picker; storage permissions are ignored on API 33+ anyway).
  - `expo-image-picker` is configured as a plugin but **not imported anywhere** in `app/` or `src/`
    (only mocked in `jest.setup.js`). It adds its own camera and photos permissions.
  - iOS `NSPhotoLibraryUsageDescription` is unneeded for the document picker.
- **The iOS pre-flight needs no new native dependency.** `expo-image-picker` is already installed
  and its `getCameraPermissionsAsync` / `requestCameraPermissionsAsync` wrap
  `AVCaptureDevice` authorization. Use it for the iOS camera check. The alternative is
  `expo-camera`, which would be a new dependency and needs approval.
- `Linking.openSettings()` (already used in `app/labor/import.tsx`) opens the app's own Settings
  page on both platforms: iOS Settings → Pegasus (Notifications / Camera / Contacts toggles), and
  Android App info. Deep-linking straight to Android's notification screen would need
  `expo-intent-launcher` (a new dependency, optional, not proposed).

## Design

### 1. One permission model (`src/services/permissions.ts`, new)

```ts
type PermissionKind = 'notifications' | 'camera' | 'contacts'
type PermissionState =
  | 'granted'
  | 'limited'          // iOS contacts / provisional push
  | 'askable'          // not granted, OS will still show the prompt
  | 'blocked'          // not granted, canAskAgain=false ⇒ Settings only
  | 'channelOff'       // Android: app-level on but our 'default' channel importance NONE
  | 'notApplicable'    // web, simulator, Android camera (ML Kit needs none)
getPermission(kind): Promise<PermissionState>   // never prompts
requestPermission(kind): Promise<PermissionState> // prompts only if 'askable'
```

- Pure mapping `toPermissionState(platform, osResponse, channel?)` is exported and unit-tested,
  covering iOS, Android ≤32, and Android 33+ fixtures.
- Do **not** trust `undetermined` on Android. Branch on `granted` / `canAskAgain` only, plus our
  own `pegasus_perm_asked.<kind>` storage flag to know whether _we_ have shown the soft ask.
  (Unverified from memory: a fresh Android 13+ install may report `denied` + `canAskAgain:true`
  before any prompt. The model must be correct either way.)

### 2. Split "check" from "ask" in push

- `registerForPush` **only checks** (`getPermissionsAsync`). It never calls
  `requestPermissionsAsync`. The foreground retry stays, because it is how we notice the user
  flipped the toggle in Settings and then register immediately.
- Add a structured reason to `PushRegistrationState`:
  `{ status: 'skipped', reason: 'permission', permission: PermissionState }`. The UI branches on
  that field instead of string-matching.
- New `enableNotifications(accountKey)` does `requestPermission('notifications')` then
  `registerForPush`. It is called only from user-initiated UI.

### 3. Soft ask (pre-permission primer)

A **"Stay in the loop"** screen (`app/permissions/notifications.tsx`, modal route):

- Shown once after first login when the state is `askable` and our asked-flag is unset.
- Plain-language copy: "Dispatch sends trip assignments, chat messages and blocked-task alerts here."
- Buttons: **Turn on notifications** (→ OS prompt) and **Not now**. "Not now" does _not_ call the
  OS prompt, so iOS's single shot and Android's two shots are preserved for when the driver is
  ready.
- iOS `blocked` / Android `blocked`: the same screen swaps to "Open Settings" plus a short,
  platform-specific instruction:
  - iOS: "Settings → Pegasus → Notifications → Allow Notifications"
  - Android: "App info → Notifications → Allow"

### 4. Nudges: persistent but not nagging

| Surface                                                            | When                                 | Action                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard banner** (`src/components/PermissionBanner.tsx`)       | Push state ≠ granted / notApplicable | "Notifications are off, so you'll miss trip assignments." **Fix**: askable → primer; blocked / channelOff → Open Settings. Dismiss = snooze 3 days (storage), max 1 banner. Re-evaluates on AppState `active`, so it disappears the moment the toggle is fixed.                   |
| **Notification settings screen** (`app/notification-settings.tsx`) | Same                                 | Top banner: "Phone notifications are off. 'Push' choices below won't reach you." Same Fix button. Turning a row to "Push" while blocked offers the fix.                                                                                                                           |
| **Settings → new "Permissions" section** (`app/settings.tsx`)      | Always                               | One row per permission (Notifications, Camera (iOS only), Contacts) with status + Allow / Open Settings. Replaces the raw "Notifications: Not registered — permission denied" text (keep the diagnostic as secondary text).                                                       |
| **In context: Scan (iOS)** (`AddDocumentModal.handleScan`)         | Before launching the scanner         | `askable` → short inline explainer, then the OS prompt. `blocked` → sheet: "Camera access is off. Turn it on in Settings → Pegasus → Camera, or use **Choose file** instead." Never reach the generic "Scanning failed" for a permission cause. Android skips the check entirely. |
| **In context: Contacts**                                           | already done                         | Move onto the shared `PermissionGate`/helper so copy and behavior match; no behavior change.                                                                                                                                                                                      |

Shared UI: `src/components/PermissionPrompt.tsx` renders explanation + the right button for a
`PermissionState`, used by the primer, banner, Settings rows, and the scan sheet.

### 5. (Optional, separate phase, API change) dispatch visibility

Report the push permission state with the device-token upsert, e.g. a `pushPermission` field on
`POST /api/v1/device-tokens`, or a DELETE-and-mark. Then tenant-web can show "notifications off" on
a driver, and dispatch can tell the driver in person. Out of scope for phase 1; needs a schema
field, so plan it separately.

### 6. Manifest cleanup (separate small PR, device-verified)

- Remove `android.permission.CAMERA`, `READ_EXTERNAL_STORAGE`, and `WRITE_EXTERNAL_STORAGE` from
  `app.json` and add them to `blockedPermissions`, so plugins can't re-add them.
- Decide on `expo-image-picker`. Either keep it as the iOS camera-permission helper and drop its
  `photosPermission`, or remove it and use `expo-camera`. That second option is a new dependency
  and needs approval. Recommend: keep it, set `photosPermission: false`.
- Drop `NSPhotoLibraryUsageDescription` if nothing uses the photo library.
- This changes the Play data-safety and permission listing. Ship it on its own so a regression is
  easy to bisect.

## Checklist

- [ ] 0. On-device spikes (record results here before coding):
  - [ ] iOS: deny camera, then tap Scan. What does VisionKit do (black preview / error / its own
        alert)? What does the plugin's promise return?
  - [ ] Android 13+: `Notifications.getPermissionsAsync()` on a fresh install before any prompt
        (`status`, `canAskAgain`).
  - [ ] Android 13+: deny once, then deny twice. Confirm `canAskAgain` flips to false. Also check
        whether dismissing the dialog by tapping outside counts.
  - [ ] Android: disable the "Default" channel only. Confirm `getPermissionsAsync` still says
        granted and `getNotificationChannelAsync('default').importance === NONE`.
- [x] 1. `permissions.ts` + `toPermissionState` with unit tests (TDD, fixtures per platform).
- [x] 2. `pushNotifications.ts`: check-only `registerForPush`, structured skip reason
      (`permission` field), `enableNotifications`. `pushNotifications.test.ts` asserts **no**
      request call from `registerForPush`.
- [x] 3. `PermissionPrompt` component + `fixPermission` / `fixLabel` helpers + `usePermission`
      hook (re-reads on AppState `active`).
- [x] 4. Primer + first-login trigger (`pegasus_push_primer_shown`) + tests.
      **Deviation:** `src/components/PushPrimer.tsx` is a `Modal` mounted in `app/_layout.tsx`, not a
      route `app/permissions/notifications.tsx`. It doesn't depend on the navigator being mounted at
      login, which avoids the "navigate before mounting the Root Layout" timing trap.
- [x] 5. Dashboard `PermissionBanner` with 3-day snooze (`BANNER_SNOOZE_MS`) + tests.
- [x] 6. Settings "PERMISSIONS" section (rows hide when `notApplicable`, e.g. Camera on Android);
      notification-settings banner (no snooze).
- [x] 7. `AddDocumentModal` iOS camera pre-flight: soft-ask Alert, then the OS prompt; when
      blocked, an Alert with Cancel / Choose file / Open Settings. A fresh denial shows an inline
      error, not a Settings bounce.
- [x] 8. **DROPPED.** Labor import is unchanged on purpose. It already does `canAskAgain` →
      Allow / Open Settings correctly, and its Settings row comes from the shared model. Rewiring it
      would be churn with no behavior change.
- [x] 8b. Review-round fixes, all from reading the expo-notifications Kotlin source:
  - Android 13+ reports `granted: true` + `status: 'denied'` when the app's notifications are off
    in App info. That now maps to `blocked`; mapping it to `granted` would have hidden the nudge.
  - `requestPermission` returns `blocked` when the prompt leaves the permission still `askable`,
    so "Turn on" is never a dead button.
  - `channelOff` no longer stops token registration; it only nudges.
  - The primer's "Not now" also starts the banner snooze.
  - Added `usePermission` tests and a Settings Notifications-row test. GOTCHAS.md updated.
- [ ] 9. Device test matrix (needs real devices), run together with step 0:
  - iOS: fresh / denied / re-enabled in Settings.
  - Android 13+: deny once / deny twice / app notifications off in App info / channel off.
  - Android ≤12: app notifications off.
  - Also check:
    - **Which channel does a remote Expo push land on?** The backend sends no `channelId`
      (`apps/api/src/lib/push-expo.ts`). If it isn't our `default`, the `channelOff` check reads a
      channel nothing uses. That is harmless (the check only nudges), but it should be fixed or
      removed.
    - **iOS "Choose file" from the blocked-camera alert** opens the picker from an Alert callback.
      Confirm it presents.
- [~] 10. `PUSH_NOTIFICATIONS.md` updated ("Permission: who asks, and when"). EAS build →
  TestFlight + Play closed testing still owed.
- [x] 11. Manifest cleanup. Folded into THIS branch on 2026-11-24 at the user's request ("do the
      follow ups now"); all three changes ship in the same EAS build anyway.
  - `app.json` only (native dirs are CNG, untracked).
  - Block `android.permission.CAMERA` and `READ_/WRITE_EXTERNAL_STORAGE` via `blockedPermissions`.
  - `expo-image-picker` plugin: `microphonePermission: false` (it was adding `RECORD_AUDIO` and
    `NSMicrophoneUsageDescription`) and `photosPermission: false`. KEEP the `cameraPermission`
    string: `false` there deletes `NSCameraUsageDescription`, which VisionKit needs.
  - Drop `NSPhotoLibraryUsageDescription` from `infoPlist`.
  - Verify by diffing `npx expo config --type introspect` before and after. Android must keep
    `POST_NOTIFICATIONS` + `READ_CONTACTS`; iOS must keep the camera + contacts strings.
- [x] 12. Dispatch visibility of push-off drivers. Folded in here too. Decision (user, 2026-11-24):
      show it in **Operations → Itinerary** for dispatchers, not on the admin-only Users page.
  - Mobile: `registerForPush` ALWAYS mints and registers the token on a physical device (minting
    needs no notification permission: iOS `registerForRemoteNotifications`, Android FCM). It sends
    `permission` (the app's `PermissionState`). The cache value becomes `token|permission`, so a
    permission change re-reports; `unregisterForPush` sends only the token part.
  - API: Prisma enum `PushPermission` + nullable `DeviceToken.pushPermission` (+ migration).
    `POST /device-tokens` accepts an optional `permission`; when it's omitted (older app), the
    stored value is left untouched (null = unknown).
  - Delivery: `listActiveTokensForUser` skips `ASKABLE`/`BLOCKED` rows. Today those devices had no
    token at all, so delivery behavior is unchanged.
  - API: `GET /onprem/longhaul/drivers/phone-status?longhaulDriverId=&localDriverEmployeeId=`,
    gated by `hasOperationsRole` like `/drivers/itinerary` (no Cedar change, no hot authz files).
    It is Postgres only: TenantUsers mapped to those ids → their active devices → a summary of
    `on | off | unknown | noApp | notLinked` + per-device permission + `lastSeenAt`.
  - tenant-web: query options + a status line in `ItineraryModule` under the pickers, with
    last-seen time.
  - Privacy: a driver who declined notifications now has a device token row (no content, only
    the token + permission). Privacy-policy / Play data-safety wording is the user's call.
  - Completion gate: Playwright now APPLIES (endpoint + browser UI). Run `db:generate` after the
    migration; read GOTCHAS "Running the api tests rewrites the coverage floors" before
    restoring floors.

## Resume here

- Steps 1–8b, 11, and 12 are done. Step 11 was verified by diffing the resolved Expo config
  before and after:
  - Android permissions are now only `INTERNET`, `POST_NOTIFICATIONS`, and `READ_CONTACTS`.
    `CAMERA`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO`, and
    `WRITE_CONTACTS` are `tools:node="remove"`.
  - iOS usage strings are Camera ("scan shipment documents"), Contacts, and FaceID (from
    expo-secure-store). The microphone and photo-library strings are gone.
- Step 12 migration: `20261124164417_device_token_push_permission` (applied to the worktree DB;
  `db:generate` run). API tests: `phone-status.test.ts`, which includes the real-DB integration
  test for register → delivery filter → dispatcher read.
- Uncommitted on `feat/mobile-permission-nudges`. **Do not commit `apps/e2e/.env.test`**, which
  worktree provisioning rewrites. Also **restore `apps/api/vitest.config.ts` and
  `packages/domain/vitest.config.ts`** after any local test run: coverage floors auto-update
  (GOTCHAS).
- `apps/mobile/jest.setup.js` was already unformatted (Prettier) on `main`. Left as is.
- Completion gate results (2026-11-24): root `npm test` 16/16 tasks green. Playwright local:
  34 passed, 39 skipped. The skips are the browser specs, which need `WEB_URL`, and the
  Itinerary browser specs are QA-only, so the badge is covered by unit tests only.
- Review round 2 (after the gate):
  - `phone-status` now answers per id (`{ longhaul, local }`), with no emails.
  - The newest phone decides the verdict.
  - Settings diagnostic reads "Off — …" for a registered phone with notifications off.
- Owed device check (add to step 9): with notifications denied on each platform, confirm a
  `BLOCKED` row is written. Minting a token without permission is confirmed from expo source
  only.
- `feat/task-queue-await` (another worktree) also edits `schema.prisma` and adds a migration
  (`20261123231442_task_awaits`). The models are disjoint, but whichever lands second must
  rebase and re-run `db:generate`.
- Merging DEPLOYS the API (migration) + tenant-web via CI. The mobile half reaches drivers only
  with an EAS build. Device checks (0 / 9) happen on that build before store promotion.
- The user decides the privacy-policy / Play Data safety wording: a driver who declined
  notifications now has a device-token row (token + permission only).

## Files

- New (all under `apps/mobile/`):
  - `src/services/permissions.ts` (+ test)
  - `src/hooks/usePermission.ts`
  - `src/components/PermissionPrompt.tsx`, `src/components/PermissionBanner.tsx`,
    `src/components/PushPrimer.tsx`
  - `src/components/__tests__/PermissionNudges.test.tsx`
- Modified:
  - `src/services/pushNotifications.ts` (+ test)
  - `app/_layout.tsx` (mounts `PushPrimer`)
  - `app/settings.tsx` (+ `__tests__/app/settings.test.tsx`)
  - `app/notification-settings.tsx`
  - `app/(drawer)/index.tsx` (banner; `Dashboard.snapshot.test.tsx` now mocks `AuthContext`)
  - `src/components/AddDocumentModal.tsx`
  - `jest.setup.js`: mocks `getNotificationChannelAsync` and image-picker
    `getCameraPermissionsAsync`; `AndroidImportance` now uses the real values
    (`NONE: 2`, `DEFAULT: 5`)
  - `PUSH_NOTIFICATIONS.md`
- No new dependencies. No API / DB change in phase 1.
- Step 11: `apps/mobile/app.json`, `apps/mobile/DEPLOYMENT_GUIDE.md` (App Privacy / Data safety
  note).
- Step 12:
  - API:
    - `apps/api/prisma/schema.prisma` (enum `PushPermission`,
      `DeviceToken.pushPermission`)
    - migration `20261124164417_device_token_push_permission`
    - `src/repositories/device-tokens.repository.ts` (delivery filter,
      `listActiveDevicesForUsers`)
    - `src/handlers/device-tokens.ts` (`permission` in the body)
    - NEW `src/handlers/longhaul-cloud/phone-status.ts` (+ test)
    - `src/app.ts` (route)
  - Mobile: `src/services/pushNotifications.ts` (+ test): always register, `token|permission`
    marker. `app/settings.tsx`: diagnostic wording.
  - tenant-web:
    - `src/api/queries/driver-itinerary.ts`
    - NEW `src/features/driver-planning/components/DriverPhoneStatus.tsx`
    - `routes/ItineraryModule.tsx` (+ test)
  - Docs: `apps/mobile/PUSH_NOTIFICATIONS.md`, GOTCHAS.md, DECISIONS.md.

## Risks

- **Existing installs already burned the prompt.** Many Android 13+ drivers may already be
  `blocked` because of the foreground re-ask. The banner + Settings path is their only fix; expect
  a visible spike in banners after release. That is the point.
- **Changing `registerForPush` to check-only means nobody is prompted without the primer.** The
  primer trigger must be reliable: test the first-login path, including a restored session.
- **Snooze too short ⇒ nagging; too long ⇒ missed assignments.** 3 days is a guess; make it a
  constant.
- **iOS provisional push (quiet delivery without a prompt) is tempting but delivers silently to
  Notification Center.** Not proposed: drivers need banners.
