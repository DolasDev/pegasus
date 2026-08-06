# Push notifications — driver app

How a notification reaches a driver's phone, what is wired, and the two
credential steps that must be done by a human in a browser.

## The pipeline

```
API handler (trip save / staff send)
  └─ enqueuePush()  →  push_notification_outbox  (Postgres, transactional)
       └─ PushForwardFunction  (Lambda, EventBridge every 1 min)
            └─ Expo Push Service
                 ├─ FCM   → Android device
                 └─ APNs  → iOS device
```

Nothing else needs to be running: the forwarder is a cross-tenant DB reader, and
Expo push works unauthenticated. Delivery is durable — rows retry with backoff,
dead-letter after repeated failure, and tokens Expo reports as
`DeviceNotRegistered` are deactivated automatically.

| Piece                                  | Where                                                              |
| -------------------------------------- | ------------------------------------------------------------------ |
| Device registration                    | `src/services/pushNotifications.ts` → `POST /api/v1/device-tokens` |
| Tap → deep link                        | `setupNotificationTapHandler` (same file)                          |
| Notification copy + deep-link contract | `apps/api/src/lib/push-triggers.ts`                                |
| Outbox persistence                     | `apps/api/src/repositories/push-outbox.repository.ts`              |
| Delivery                               | `apps/api/src/lambda-push-forward.ts` + `lib/push-expo.ts`         |
| Schedule                               | `packages/infra/lib/stacks/api-stack.ts` → `PushForwardFunction`   |

### What currently triggers a push

| Type                | Fires when                                                                                           | Deep link         |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ----------------- |
| `trip.assigned`     | A longhaul trip save assigns a driver the trip didn't already have                                   | `/trip/[id]`      |
| `move.assigned`     | A crew member is assigned to a cloud Move (`POST /moves/:id/assign-crew`)                            | `/(drawer)/trips` |
| _(staff-initiated)_ | `POST /api/v1/notifications/send` — gated by the `SendNotification` Cedar action. No UI calls it yet | per payload       |

`trip.assigned` resolves the legacy `driver_id` to a login through
`TenantUser.longhaulDriverId` — the same admin-set mapping that scopes My Trips.
**An unmapped driver gets no push**, by design: they can't see the trip in the
app either. Map drivers in Settings → Users.

## Status

|                                       | State                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Backend (outbox, forwarder, triggers) | ✅ Live                                                                          |
| Mobile registration + tap routing     | ✅ Live                                                                          |
| Android delivery                      | ⏳ Firebase project + client config done; needs the FCM V1 server key (Step 1.6) |
| iOS delivery                          | ⏳ Apple enrollment done; needs `eas credentials` (Step 2)                       |
| iOS signed device build in CI         | ✅ `ios_build=device` on `mobile-release.yml`                                    |

Until the credentials exist, the failure is silent by design: `registerForPush`
catches and logs, so no token is ever registered and outbox rows simply find no
device to deliver to. Nothing errors, nothing is lost.

## Step 1 — Android (Firebase / FCM)

FCM is the only push transport Google Play devices accept, and FCM credentials
only come from a Firebase project. This is a credential container, not an
adoption of Firebase: no SDK usage, no analytics, free Spark tier.

1. **Create the Firebase project** — <https://console.firebase.google.com> → Add
   project (or "Add Firebase" to the existing GCP project). Analytics: not needed.
2. **Register the Android app** — package name **`com.movingstorage.driverapp`**
   (must match `app.json` → `android.package` exactly). Download the generated
   `google-services.json`.
3. **Enable the API** — in the Firebase console, Project settings → Cloud
   Messaging → make sure **Firebase Cloud Messaging API (V1)** is enabled.
4. **Create the FCM V1 service-account key** — Project settings → Service
   accounts → Generate new private key. This JSON is what Expo sends with.
5. **Publish the client config to EAS** — ✅ **done 2026-08-06** for Firebase
   project `pegasus-cloud-mobile` (sender id `464811936819`). Recorded here for
   when it needs rotating or repeating for another environment:

   ```
   eas env:set --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility sensitive --scope project --environment production --non-interactive
   ```

   `env:set`, not the deprecated `env:create`. Visibility is **sensitive**, not
   `secret`, deliberately: `google-services.json` ships inside every APK, so it
   is not a secret in any meaningful sense, and `secret` can never be read back
   or downgraded (#541) — which would make it unverifiable and unrotatable for
   no security gain. Confirm with
   `eas env:get production --variable-name GOOGLE_SERVICES_JSON --format long`.

   Repeat with `--environment preview` only if you want push in preview builds.

6. **Upload the FCM V1 server key** — ⬅️ **the remaining Android blocker.**
   Interactive (no non-interactive equivalent), from `apps/mobile`:

   ```
   eas credentials --platform android
   ```

   Choose the `production` build profile → **Google Service Account** → **Manage
   your Google Service Account Key for Push Notifications (FCM V1)** → upload the
   key from step 4. This is the credential Expo actually sends with; the client
   config from step 5 only lets the app mint a token. Verify it landed —
   `androidFcm` / `googleServiceAccountKeyForFcmV1` must stop being `null`:

   ```
   SECRET=$(python3 -c "import json;print(json.load(open('$HOME/.expo/state.json'))['auth']['sessionSecret'])"); curl -s https://api.expo.dev/graphql -H "Content-Type: application/json" -H "expo-session: $SECRET" -d '{"query":"query { app { byId(appId: \"a2e694fd-15da-47ba-8ef0-8a3e1cd7c4be\") { androidAppCredentials { androidFcm { id } googleServiceAccountKeyForFcmV1 { id } } } } }"}'
   ```

7. **Rebuild** — push credentials are baked in at build time, so the current APK
   /AAB cannot receive push no matter what is configured server-side. Run the
   **Mobile release** workflow (Actions → Mobile release → `platform: android`).
8. **Verify** — install the new build, log in as a mapped driver, accept the
   notification prompt, then confirm a row appears:

   ```
   curl -H "Authorization: Bearer $TOKEN" https://<api>/api/v1/device-tokens
   ```

   Reassign that driver's trip in Operations and expect a push within ~1 min
   (the forwarder's schedule). Delivery logs: CloudWatch → `PushForwardFunction`.

`app.config.js` picks up `GOOGLE_SERVICES_JSON` automatically — no code change
is needed after the upload.

## Step 2 — iOS (APNs)

**No Firebase.** APNs is Apple's own transport and EAS manages the key. The
Apple Developer Program membership (the long pole) is **done** — enrolled
2026-08.

Nothing is linked to EAS yet: `iosAppCredentials` is still `[]`. Enrolling at
Apple and wiring EAS are separate acts, and both steps below need an
interactive Apple login, so they can't be scripted in CI.

1. **Set up signing + the APNs key** — from `apps/mobile`, one interactive run
   creates the distribution certificate, the provisioning profile, and the push
   key, and stores all three on EAS:

   ```
   eas credentials --platform ios
   ```

   Choose the `production` profile → **Push Notifications: Manage your Apple
   Push Notifications Key** → **Set up a new key**. Also let it create the
   distribution certificate + provisioning profile when prompted.

2. **Register the test device** — an ad-hoc build only installs on devices in
   its provisioning profile:

   ```
   eas device:create
   ```

   Pick "Website" and open the link on the iPhone (or scan the QR), then install
   the profile Apple serves. Skipping this makes the `device` build fail in CI:
   `--non-interactive` can't stop to ask which device to provision.

3. **Build it through CI** — never `eas build` locally (#541); the workflow
   bakes the environment config:

   ```
   gh workflow run mobile-release.yml --ref main -f env=prod -f platform=ios -f ios_build=device
   ```

   `ios_build=device` uses the `ios-device` eas.json profile: signed, ad-hoc,
   internally distributed, and built against the **production** EAS environment
   (the env-var set verified correct in #541 — `preview` is still suspect, and
   EAS's stored env vars override the `.env` CI writes). Install from the build
   page: <https://expo.dev/accounts/dolas.dev/projects/moving-storage-driver/builds>

4. **Verify** exactly as in the Android step — log in as a mapped driver, accept
   the prompt, confirm `GET /api/v1/device-tokens` returns a row, reassign a
   trip, expect a push within ~1 min.

> A **simulator** build can never receive push — it has no APNs device token —
> so `ios_build=simulator` (the default) stays a pure CI signal.

### Still open for iOS: App Store submission

`ios_build=store` builds a TestFlight/App Store `.ipa`, but there is **no iOS
auto-submit** — `eas.json` → `submit.production.ios` still holds `PLACEHOLDER`
for `ascAppId`/`appleTeamId`. Wiring it needs an App Store Connect **API key**
(issuer id + key id + `.p8`) uploaded via `eas credentials`, mirroring the
EAS-hosted Google service-account key on the Android side — that avoids putting
an Apple ID and app-specific password in the repo. Do this when you actually
want TestFlight distribution; push testing does not need it.

## Optional hardening

Expo push works unauthenticated. To enable Expo's "enhanced push security",
create an access token at <https://expo.dev/settings/access-tokens>, store it in
Secrets Manager, and surface it as `EXPO_ACCESS_TOKEN` on `PushForwardFunction`
in `api-stack.ts` — `lib/push-expo.ts` already forwards it when present.

## Adding a new notification type

1. Add an `enqueue*Push` helper to `apps/api/src/lib/push-triggers.ts` — the one
   place copy and the `data` deep-link contract live. Give it a `dedupeKey` so a
   retried or repeated state change can't double-notify.
2. Call it from the handler, inside the same transaction as the state change
   where possible (`enqueuePush` takes a transaction client).
3. Add the matching `case` to `route()` in
   `src/services/pushNotifications.ts` so a tap lands somewhere useful.
