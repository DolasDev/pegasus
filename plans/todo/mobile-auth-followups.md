# Mobile auth — follow-ups after silent session refresh

- **Parent:** `plans/completed/mobile-session-refresh.md` —
  proposals #1 (silent refresh-token renewal) + #2 (clean expiry handling).
- **Filed:** 2026-11-24 (Steve). Neither item below fixes the "logged in but nothing works"
  bug on its own — both are layers on top of the stored refresh token from the parent work.
  Ranked #3 and #4 in the original proposal.

## #3 — Biometric unlock (Face ID / fingerprint, device passcode fallback)

**What it is:** a security layer, not a session fix. The refresh token already lives in
SecureStore; this gates _access_ to it behind the device's biometrics.

- Store `pegasus_refresh` with `expo-secure-store` `requireAuthentication: true`
  (+ `authenticationPrompt`), or gate app entry with `expo-local-authentication`
  `authenticateAsync({ disableDeviceFallback: false })` so the device passcode is the fallback.
- Works the same for password **and SSO** users — it unlocks the refresh token, not a password.
- Settings toggle ("Require Face ID to open Pegasus"), default off; prompt to enable after the
  first successful sign-in.
- Decide: prompt on every cold start, or only after N minutes in background.

Gotchas to plan for:

- **Android keys invalidate when biometric enrollment changes** (new fingerprint added) →
  `requireAuthentication` items become unreadable → treat as "sign in again", not a crash.
- iOS needs `NSFaceIDUsageDescription` in `app.json` (`expo-local-authentication` plugin) →
  native change → **store build**, not OTA.
- Shared crew devices: biometric lock on a shared phone may be the wrong default — ask ops.
- Background refresh (proactive, before the user opens the app) can't read an
  auth-required item → refresh only after unlock.

Effort: ~1–2 days + a store release.

## #4 — Biometrics + stored password (silent re-sign-in)

**What it is:** keep the driver's password in SecureStore behind biometrics and replay
`USER_PASSWORD_AUTH` when the session is gone.

**Recommendation: don't build unless #1 proves insufficient.** After #1 a driver re-enters
credentials only after 30 days idle or a revocation; #4 would only save that rare sign-in.

Why it ranks low:

- **No SSO coverage** — federated users have no password to store.
- Breaks on every password change/reset (stale stored password → failed sign-in → must
  detect `NotAuthorizedException` and clear it).
- Storing a reusable password is a weaker posture than storing a revocable, client-scoped
  refresh token; security reviewers will ask why.
- Same Android enrollment-invalidation and iOS Face ID plist gotchas as #3.

If built anyway: only on top of #3's biometric gate, password users only, opt-in, cleared on
logout and on any `NotAuthorizedException`.

## Not pursued

- **App PIN/passcode (own PIN UI)** — set/reset/lockout flows for less than #3 gives via the
  device passcode fallback.
- **Longer Cognito token lifetimes** — ID token max is 1 day, and any `UserPoolClient` edit
  wipes tenant IdPs (#518, 22h SSO outage).
