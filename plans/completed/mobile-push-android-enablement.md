# Driver-app push — close the unblocked gaps, document the credential-blocked ones

## Context

Push infrastructure shipped in #257 (outbox + Expo forwarder + device
registration + tap routing) and has been inert since. An audit found three
distinct reasons nothing has ever reached a phone:

1. **Android has no FCM credentials.** The EAS project
   (`a2e694fd-15da-47ba-8ef0-8a3e1cd7c4be`) returns `androidFcm: null` and
   `googleServiceAccountKeyForFcmV1: null` — only the Play _submissions_ key
   exists. `app.json` also had no `android.googleServicesFile`, so a real
   Android build cannot mint a token at all: `getExpoPushTokenAsync()` throws,
   `registerForPush` catches and logs, and zero device rows are ever created.
2. **iOS has no credentials either.** `iosAppCredentials: []` — no Apple team,
   no APNs key. `mobile-release.yml` builds iOS unsigned/simulator-only for
   exactly this reason, and simulators can't receive remote push regardless.
3. **Nothing meaningfully generates pushes.** The only automated trigger was
   `enqueueCrewAssignmentPush` on `POST /moves/:id/assign-crew` — a route no
   client calls. Driver work comes from **longhaul trips**, not cloud Moves;
   the tap handler even said so ("a cloud moveId doesn't map to a longhaul trip
   id"). The staff-initiated `POST /notifications/send` has no UI caller.

(1) and (2) are blocked on human-in-a-browser credential work. (3) is not
blocked at all — and it's the gap that would have left the feature dead even
after the credentials landed.

## Scope

**In:** the trigger gap, its deep link, Android build plumbing that is inert
until the credential exists, and a runbook for the blocked steps.

**Out:** tenant-web UI for staff-initiated `/notifications/send` (a product
feature, not a gap-fill); replacing Expo's relay with direct FCM/APNs (no
benefit today — revisit only if notification bodies start carrying PII, since
the Expo relay sees payloads; it's a swap of `lib/push-expo.ts` plus the token
type).

## Work

- [x] **`trip.assigned` trigger.** `enqueueTripAssignmentPush` in
      `lib/push-triggers.ts` resolves the legacy `driver_id` → login via
      `TenantUser.longhaulDriverId` (the same mapping `/me/driver` uses to scope
      My Trips), then enqueues. Unmapped driver → no-op returning `false`: they
      can't see the trip either, so there's nothing to notify. Deactivated users
      and service accounts are excluded. Dedupe key `trip.assigned:<trip>:<driver>`.
- [x] **Wired into `handlers/longhaul-cloud/trip-save.ts`**, post-commit, firing
      only when a save _assigns_ a driver the trip didn't already have (create
      with driver, or a change on update) — so the routine trip edit, which
      re-saves the header every time, stays silent.
- [x] **Deep link** `trip.assigned` → `/trip/[id]` (falls back to the trips list
      with no `tripId`). Previously only `move.assigned` → trips list.
- [x] **`app.config.js`** layering `android.googleServicesFile` onto `app.json`
      from the `GOOGLE_SERVICES_JSON` EAS file secret, plus `POST_NOTIFICATIONS`
      in the permission list. Gitignored the JSON.
- [x] **`PUSH_NOTIFICATIONS.md`** — pipeline map, trigger table, and the exact
      click-path + commands for the Firebase and Apple steps.

## Decisions

**Post-commit, not transactional — deliberately.** Everywhere else the outbox
commits atomically with the state change. It can't here: the trip lives in
MSSQL on-prem, the outbox in Postgres, so there is no shared transaction to
enlist in. The trip is already committed by the time we can enqueue, so the
enqueue is best-effort and fully caught — a notification problem must never
turn a successful save into a 500. Tested (`still returns the saved trip when
the push enqueue throws`). The exposure is a lost notification on a Postgres
blip, not a lost or corrupted trip.

**Dedupe suppresses A → B → A.** Reassigning a driver away and back won't
re-notify, because the `(trip, driver)` key already exists. Accepted: silent
duplicate suppression on every routine re-save is worth more than re-notifying
a rare flip-flop.

**Config existence check.** Pointing Expo at a missing `googleServicesFile`
fails prebuild hard. Declaring it only when the file is really present is what
makes this landable _before_ the Firebase project exists — with no file the
resolved config is byte-identical to today's. Verified both ways with
`expo config --type public --json`.

## Verification

- `push-triggers.test.ts` (4 new) — enqueue shape, dedupe key + non-resetting
  update, unmapped no-op, deactivated/service-account exclusion.
- `trip-save.test.ts` (5 new, 12 total) — enqueues on create and on driver
  change; silent on unchanged driver and on the "None" sentinel `0`; save still
  returns 200 when the enqueue throws.
- `pushNotifications.test.ts` (2 new, 12 total) — deep link and its fallback.
- `expo config` resolved with and without `GOOGLE_SERVICES_JSON`.

## Left blocked

Android delivery needs the Firebase project + FCM V1 key uploaded to EAS and a
rebuild. iOS delivery needs Apple Developer Program enrollment before an APNs
key or a signed device build is possible. Both runbooked in
`apps/mobile/PUSH_NOTIFICATIONS.md`.
