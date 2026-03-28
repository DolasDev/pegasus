# Requirements: Pegasus Mobile — Driver Login

**Defined:** 2026-03-27
**Core Value:** A driver can log in with their real company credentials and the app knows which tenant they belong to — no mock data, no hardcoded sessions.

## v1 Requirements

### Infrastructure

- [x] **INFRA-01**: App entry point imports `react-native-get-random-values` before all other imports so the Cognito SRP handshake has a working crypto implementation at runtime
- [x] **INFRA-02**: A dedicated mobile Cognito app client exists (CDK) with `generateSecret: false` and SRP auth flow enabled — no client secret, separate from the web app client

### API

- [x] **API-01**: `GET /api/auth/mobile-config?tenantId=<id>` returns the Cognito user pool ID and mobile app client ID for the given tenant; public endpoint, no authentication required

### Tenant Resolution

- [x] **TENANT-01**: Driver enters email and app calls `POST /api/auth/resolve-tenants`, receiving a list of tenants the email belongs to
- [x] **TENANT-02**: If exactly one tenant matches, app auto-selects it and calls `POST /api/auth/select-tenant` without showing a picker
- [x] **TENANT-03**: If multiple tenants match, driver sees a list of company names and selects one; app then calls `POST /api/auth/select-tenant`
- [x] **TENANT-04**: If no tenants match the email, driver sees an inline error message ("Email not registered with Pegasus") without navigating away
- [x] **TENANT-05**: The resolved company name is displayed above the password input field so the driver can confirm they are logging into the right company
- [x] **TENANT-06**: Back navigation from the tenant picker screen returns to the email entry step and resets all auth state

### Authentication

- [x] **AUTH-01**: After tenant selection, app fetches `GET /api/auth/mobile-config?tenantId=<id>` to obtain the Cognito user pool ID and mobile client ID at runtime (never baked into app bundle)
- [x] **AUTH-02**: Driver enters password and app authenticates via Cognito SRP using `amazon-cognito-identity-js` — entirely in-app, no browser redirect
- [x] **AUTH-03**: On successful SRP auth, app calls `POST /api/auth/validate-token` with the Cognito ID token and uses the returned claims (tenantId, role, email, sub, expiresAt) as the session
- [x] **AUTH-04**: Password field includes a show/hide toggle so the driver can verify what they typed
- [x] **AUTH-05**: Authentication errors (wrong password, account locked, network failure) are displayed inline — not as `Alert.alert` popups
- [x] **AUTH-06**: Submit button is disabled and all inputs are non-editable throughout the entire login flow (email → tenant resolution → password → SRP → token validation) to prevent concurrent requests and the associated cross-tenant session race

### Session

- [x] **SESSION-01**: Validated session object (tenantId, role, email, sub, expiresAt) is persisted in `expo-secure-store` (encrypted); raw Cognito tokens are discarded after `validate-token` succeeds
- [x] **SESSION-02**: On cold start, app restores session from secure store before rendering any route so the auth guard never flickers to login for an already-authenticated driver
- [x] **SESSION-03**: Driver can log out — clears secure store, resets AuthContext state, and navigates to login screen
- [x] **SESSION-04**: On app resume (foreground event), if the stored session's `expiresAt` is in the past, driver is shown a re-login prompt rather than silently failing on API calls

### Auth Guard

- [x] **GUARD-01**: Root layout uses `Stack.Protected` with `guard={isAuthenticated}` (expo-router v6) plus `SplashScreen.preventAutoHideAsync()` instead of the current `useEffect`-based redirect, eliminating the login screen flash on cold start for authenticated drivers

## v2 Requirements

### Session

- **SESSION-V2-01**: Silent token refresh — app transparently renews Cognito tokens before expiry so drivers are not interrupted mid-shift
- **SESSION-V2-02**: Biometric auth (Face ID / Touch ID) — driver can re-authenticate with biometrics instead of re-entering password after session expiry

### Account Management

- **ACCT-V2-01**: Forgot password / reset — driver can request a password reset email from the login screen
- **ACCT-V2-02**: Force password change — app handles the Cognito `NEW_PASSWORD_REQUIRED` challenge for drivers whose account was just provisioned

## Out of Scope

| Feature                     | Reason                                                                    |
| --------------------------- | ------------------------------------------------------------------------- |
| SSO / SAML federated login  | Drivers don't use corporate SSO; email+password only for v1               |
| Sign-up / self-registration | Drivers are provisioned by tenant admins, not self-service                |
| Token refresh (v1)          | Shift-based usage (8 hours); re-login at shift start is acceptable for v1 |
| Multiple active sessions    | Single device assumed; no multi-device session management                 |
| Admin / tenant-admin login  | Mobile app is driver-only; admin access is via web                        |

## Traceability

| Requirement | Phase   | Status  |
| ----------- | ------- | ------- |
| INFRA-01    | Phase 1 | Complete |
| INFRA-02    | Phase 1 | Complete |
| API-01      | Phase 1 | Complete |
| TENANT-01   | Phase 4 | Complete |
| TENANT-02   | Phase 4 | Complete |
| TENANT-03   | Phase 4 | Complete |
| TENANT-04   | Phase 4 | Complete |
| TENANT-05   | Phase 4 | Complete |
| TENANT-06   | Phase 4 | Complete |
| AUTH-01     | Phase 2 | Complete |
| AUTH-02     | Phase 2 | Complete |
| AUTH-03     | Phase 2 | Complete |
| AUTH-04     | Phase 5 | Complete |
| AUTH-05     | Phase 5 | Complete |
| AUTH-06     | Phase 5 | Complete |
| SESSION-01  | Phase 3 | Complete |
| SESSION-02  | Phase 3 | Complete |
| SESSION-03  | Phase 3 | Complete |
| SESSION-04  | Phase 3 | Complete |
| GUARD-01    | Phase 5 | Complete |

**Coverage:**

- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---

_Requirements defined: 2026-03-27_
_Last updated: 2026-03-27 after roadmap creation_
