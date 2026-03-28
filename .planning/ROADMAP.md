# Roadmap: Pegasus Mobile — Driver Login

## Overview

Three infrastructure blockers must be cleared first (Cognito app client, crypto polyfill, mobile-config endpoint), then the auth service layer is built and tested in isolation, then session persistence is wired into AuthContext, then the multi-step tenant resolution UX is layered on top, and finally the login screen is polished and the auth guard hardened. Each phase delivers a coherent, independently verifiable capability. The ordering is non-negotiable: infrastructure misconfigurations cannot be fixed after auth code is written against them.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Infrastructure Foundation** - Cognito mobile app client, crypto polyfill entry point, and mobile-config API endpoint (completed 2026-03-27)
- [ ] **Phase 2: Auth Service Layer** - cognitoService and authService built test-first; SRP handshake proven in isolation
- [x] **Phase 3: AuthContext and Session** - AuthContext replaces mock auth; session persisted to secure store; logout and expiry detection working (completed 2026-03-27)
- [ ] **Phase 4: Tenant Resolution Flow** - Two-step email-first login, tenant picker screen, back navigation, and error states
- [ ] **Phase 5: Login UX and Auth Guard** - Password show/hide, inline errors, input locking, and flash-free auth guard

## Phase Details

### Phase 1: Infrastructure Foundation

**Goal**: All infrastructure prerequisites exist so auth code can be written and tested end-to-end without hitting configuration blockers
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, API-01
**Success Criteria** (what must be TRUE):

1. A dedicated mobile Cognito app client exists in the CDK stack with `generateSecret: false` and `ALLOW_USER_SRP_AUTH` enabled, verified in the AWS Console after deployment
2. `GET /api/auth/mobile-config?tenantId=<id>` returns `{ userPoolId, clientId }` for a valid tenant and a 400 for an unknown tenantId
3. `apps/mobile/app/_layout.tsx` imports `react-native-get-random-values` as its absolute first statement (polyfill is in \_layout.tsx, not index.ts — expo-router bypasses index.ts); the app runs as a development build (not Expo Go)
4. `amazon-cognito-identity-js` and `react-native-get-random-values` are installed via `npx expo install` and appear in `apps/mobile/package.json`

**Plans**: 3 plans

Plans:

- [x] 01-01-PLAN.md — CDK mobile Cognito app client (CognitoStack + ApiStack + CDK tests)
- [x] 01-02-PLAN.md — GET /api/auth/mobile-config endpoint + API unit tests
- [x] 01-03-PLAN.md — Entry-point polyfill and dependency installation

### Phase 2: Auth Service Layer

**Goal**: The full Cognito SRP authentication sequence can be exercised in tests with mocked boundaries, proving correctness before any UI work
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):

1. `cognitoService.signIn(email, password, poolId, clientId)` resolves with `{ idToken }` when the Cognito SDK returns success and rejects with a typed `AuthError` on failure
2. `authService.fetchMobileConfig(tenantId)` calls `GET /api/auth/mobile-config` and returns `{ userPoolId, clientId }`
3. `authService.authenticate(email, password, tenantId)` calls `fetchMobileConfig`, then `cognitoService.signIn`, then `POST /api/auth/validate-token`, and returns a validated `Session` — all verified with mocked API and Cognito responses
4. Raw Cognito ID tokens are never stored; only the server-validated `Session` object is returned from `authenticate`

**Plans**: 2 plans

Plans:

- [x] 02-01-PLAN.md — Auth types (AuthError, Session, MobileConfig) and cognitoService (SRP wrapper + tests)
- [x] 02-02-PLAN.md — authService factory (fetchMobileConfig, authenticate) + tests

### Phase 3: AuthContext and Session

**Goal**: The app has a working AuthContext backed by real auth logic; sessions survive app restarts; logout clears all state; expired sessions are detected on foreground
**Depends on**: Phase 2
**Requirements**: SESSION-01, SESSION-02, SESSION-03, SESSION-04
**Success Criteria** (what must be TRUE):

1. After successful authentication, the `Session` (tenantId, role, email, sub, expiresAt) is persisted to `expo-secure-store` — inspecting secure store shows the session; raw Cognito tokens are absent
2. On cold start with a valid stored session, the app renders the authenticated route without navigating to the login screen
3. Driver can log out; secure store is cleared, `AuthContext` user is null, and the login screen is shown
4. On app resume (foreground event) with an expired session, the driver sees a re-login prompt rather than proceeding to the authenticated route

**Plans**: 2 plans

Plans:

- [x] 03-01-PLAN.md — expo-secure-store install + Jest config + AuthContext rewrite (login, logout, SESSION-01, SESSION-03)
- [x] 03-02-PLAN.md — Cold-start restore + AppState expiry detection + \_layout.tsx wiring + call-site updates (SESSION-02, SESSION-04)

### Phase 4: Tenant Resolution Flow

**Goal**: The complete email-first login flow works end-to-end: email submission triggers tenant resolution, the picker appears only when needed, the driver can navigate back, and all error states produce clear messages
**Depends on**: Phase 3
**Requirements**: TENANT-01, TENANT-02, TENANT-03, TENANT-04, TENANT-05, TENANT-06
**Success Criteria** (what must be TRUE):

1. Driver submits their email and the app calls `POST /api/auth/resolve-tenants`; if exactly one tenant matches, the password step appears immediately without showing a picker
2. When multiple tenants match, the driver sees a list of company names; selecting one calls `POST /api/auth/select-tenant` and advances to the password step
3. The resolved company name is visible above the password input so the driver can confirm they are logging into the right company
4. When no tenants match the email, an inline error message ("Email not registered with Pegasus") appears on the email step without navigating away
5. Tapping back from the tenant picker returns to the email step with all auth state reset

**Plans**: 2 plans

Plans:

- [x] 04-01-PLAN.md — TenantResolution type + authService extension (resolveTenants, selectTenant) + tenant-picker screen + auth layout update
- [x] 04-02-PLAN.md — login.tsx two-step state machine (email step + password step + URL param handoff)

### Phase 5: Login UX and Auth Guard

**Goal**: The login experience is polished and production-ready; inputs are locked during async operations preventing race conditions; the auth guard shows no login-screen flash for authenticated drivers
**Depends on**: Phase 4
**Requirements**: AUTH-04, AUTH-05, AUTH-06, GUARD-01
**Success Criteria** (what must be TRUE):

1. The password field has a show/hide toggle; tapping it reveals or conceals the password in place
2. Authentication errors (wrong password, account locked, network failure) appear as inline text below the relevant input — no `Alert.alert` popups are triggered
3. From the moment the driver submits their email through the completion of `validate-token`, all inputs are non-editable and the submit button is disabled; double-tapping cannot initiate a second concurrent flow
4. An authenticated driver cold-launching the app never sees the login screen flash before the home route renders

**Plans**: TBD

Plans:

- [ ] 05-01: Password toggle, inline errors, and input locking
- [ ] 05-02: Auth guard with expo-splash-screen (Stack.Protected)
      **UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase                        | Plans Complete | Status      | Completed  |
| ---------------------------- | -------------- | ----------- | ---------- |
| 1. Infrastructure Foundation | 3/3            | Complete    | 2026-03-27 |
| 2. Auth Service Layer        | 1/2            | In Progress |            |
| 3. AuthContext and Session   | 2/2            | Complete    | 2026-03-27 |
| 4. Tenant Resolution Flow    | 1/2 | In Progress|  |
| 5. Login UX and Auth Guard   | 0/2            | Not started | -          |
