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
| iOS delivery                          | ✅ APNs key on EAS (Step 2); unverified end-to-end until a device build runs     |
| iOS signed device build in CI         | ✅ `ios_build=device` on `mobile-release.yml`                                    |
| iOS TestFlight auto-submit            | ✅ `ios_build=store` + `submit=true`                                             |

Where credentials are still missing, the failure is silent by design:
`registerForPush` catches and logs, so no token is ever registered and outbox
rows simply find no device to deliver to. Nothing errors, nothing is lost.

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
4. **Create the FCM V1 service-account key** — this JSON is what Expo actually
   sends with, and it lives on Expo's servers, so give it the least privilege
   that works.

   **Do NOT use** Firebase Console → Project settings → Service accounts →
   Generate new private key. That is the convenient path and it does work with
   no role assignment — the auto-provisioned
   `firebase-adminsdk-*@pegasus-cloud-mobile.iam.gserviceaccount.com` already
   holds **Firebase Admin SDK Administrator Service Agent**
   (`roles/firebase.sdkAdminServiceAgent`). But that identity also reaches
   Firestore, Cloud Storage, and the rest of the project — far beyond "send a
   notification" — and handing all of it to a third party for the life of the
   key is a bad trade.

   Instead, GCP Console → IAM & Admin → Service Accounts → Create, in project
   `pegasus-cloud-mobile`. Name it e.g. `expo-push-fcm` and grant exactly one
   role:

   |                         |                                                      |
   | ----------------------- | ---------------------------------------------------- |
   | Role                    | **Firebase Cloud Messaging API Admin**               |
   | Role ID                 | `roles/firebasecloudmessaging.admin`                 |
   | Permission that matters | `cloudmessaging.messages.create`                     |
   | Scope Expo requests     | `https://www.googleapis.com/auth/firebase.messaging` |

   Then Keys → Add key → **JSON**. Use the role _ID_ to find it — Google
   renames display names periodically. Step 3's API enablement is a hard
   prerequisite: without `fcm.googleapis.com`, even a correctly-roled account
   gets 403.

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

**Credentials are linked** (2026-08, team `9NJ2BGU4TR`): distribution
certificate, App Store provisioning profile `54TZ7K8T77`, APNs key, and an App
Store Connect API key all live on EAS. Step 1 below is done; it is kept as the
recovery procedure, since certificates and profiles expire (both 2027-08-13) and
have to be regenerated the same way.

1. **Set up signing + the APNs key** — ✅ done. From `apps/mobile`, one
   interactive run creates the distribution certificate, the provisioning
   profile, and the push key, and stores all three on EAS:

   ```
   eas credentials --platform ios
   ```

   Choose the `production` profile → **All: Set up all the required
   credentials**, then **Push Notifications: Manage your Apple Push
   Notifications Key** → **Set up a new key**, then upload the App Store Connect
   API key. Export `EXPO_ASC_API_KEY_PATH` / `EXPO_ASC_KEY_ID` /
   `EXPO_ASC_ISSUER_ID` / `EXPO_APPLE_TEAM_ID` / `EXPO_APPLE_TEAM_TYPE` first and
   EAS authenticates with the API key instead of prompting for a password + 2FA.

   > **Gotcha:** capability sync fails — "Failed to patch capabilities" plus an
   > Apple API error about an invalid request document object. Enable **Push
   > Notifications** by hand on the App ID in the Apple developer console, then
   > re-run with `EXPO_NO_CAPABILITY_SYNC=1`. Enable it _before_ the
   > provisioning profile is generated: the profile only carries the
   > `aps-environment` entitlement if the capability was already on. If push
   > tokens fail on a real device, suspect the profile, not the key.

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

### iOS App Store submission

Wired. `eas.json` → `submit.production.ios` carries the real `ascAppId`
(`6800979383`) and `appleTeamId`, and the App Store Connect API key is hosted by
EAS — mirroring the Google service-account key on the Android side, so no Apple
ID or app-specific password lives in the repo. `submit.production.ios` has no
`appleId` field on purpose: the API key authenticates, and an Apple ID there
would be dead config.

```
gh workflow run mobile-release.yml --ref main -f env=prod -f platform=ios -f ios_build=store -f submit=true
```

That builds a signed `.ipa` and lands it in **TestFlight**. Releasing from
TestFlight to the App Store stays a manual act in App Store Connect, and needs
the listing work — screenshots, privacy policy, App Privacy answers, and a
reviewer demo account (this app is login-walled, so a reviewer without working
credentials is a guaranteed Guideline 2.1 rejection).

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
