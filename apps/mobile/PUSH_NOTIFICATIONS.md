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

|                                       | State                                                    |
| ------------------------------------- | -------------------------------------------------------- |
| Backend (outbox, forwarder, triggers) | ✅ Live                                                  |
| Mobile registration + tap routing     | ✅ Live                                                  |
| Android delivery                      | ❌ Blocked — needs Firebase (below)                      |
| iOS delivery                          | ❌ Blocked — needs an Apple Developer Program membership |

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
5. **Upload both to EAS** (from `apps/mobile`, with `google-services.json` in
   this directory — it is gitignored):

   ```
   eas credentials --platform android
   ```

   Choose the `production` build profile → **Google Service Account** → **Manage
   your Google Service Account Key for Push Notifications (FCM V1)** → upload the
   key from step 4.

   Then publish the client config as a build-time file secret:

   ```
   eas env:create --name GOOGLE_SERVICES_JSON --type file --scope project --visibility secret --value ./google-services.json --environment production
   ```

   (Repeat with `--environment preview` if you want push in preview builds.)

6. **Rebuild** — push credentials are baked in at build time, so the current APK
   /AAB cannot receive push no matter what is configured server-side. Run the
   **Mobile release** workflow (Actions → Mobile release → `platform: android`).
7. **Verify** — install the new build, log in as a mapped driver, accept the
   notification prompt, then confirm a row appears:

   ```
   curl -H "Authorization: Bearer $TOKEN" https://<api>/api/v1/device-tokens
   ```

   Reassign that driver's trip in Operations and expect a push within ~1 min
   (the forwarder's schedule). Delivery logs: CloudWatch → `PushForwardFunction`.

`app.config.js` picks up `GOOGLE_SERVICES_JSON` automatically — no code change
is needed after the upload.

## Step 2 — iOS (APNs)

**No Firebase.** APNs is Apple's own transport and EAS manages the key.

1. **Enroll in the Apple Developer Program** ($99/yr,
   <https://developer.apple.com/programs/>). This is the long pole — allow days,
   and organization enrollment needs a D-U-N-S number. Everything below is
   blocked on it.
2. Fill in the real values in `eas.json` → `submit.production.ios`
   (`appleId`, `ascAppId`, `appleTeamId` are `PLACEHOLDER` today).
3. **Generate the APNs key** — from `apps/mobile`:

   ```
   eas credentials --platform ios
   ```

   Choose `production` → **Push Notifications: Manage your Apple Push
   Notifications Key** → **Set up a new key** (EAS creates and stores the .p8).

4. **Build a signed device build** — the current iOS CI build is an _unsigned
   simulator_ build, and simulators cannot receive remote push (no APNs device
   token). Testing needs a real device build, which needs step 1.

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
