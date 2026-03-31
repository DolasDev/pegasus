# Milestones

## v1.0 Mobile Driver Login (Shipped: 2026-03-31)

**Phases completed:** 7 phases, 14 plans, 25 tasks

**Key accomplishments:**

- GET /api/auth/mobile-config added to authHandler — validates tenant via db.tenant.findUnique and returns Cognito pool ID and mobile client ID from Lambda env vars, with four unit tests covering all response paths
- `react-native-get-random-values` installed and prepended as the absolute first import in `_layout.tsx`, unblocking `amazon-cognito-identity-js` SRP authentication in the Expo mobile app
- Promise-wrapped Cognito SRP handshake (amazon-cognito-identity-js) with AuthError, Session, and MobileConfig type contracts establishing the typed foundation for the entire mobile auth layer
- Dependency-injected authService factory (createAuthService) that orchestrates fetchMobileConfig → cognitoService.signIn → validate-token and returns a Session with no raw ID token, verified by 5 Jest unit tests
- expo-secure-store session persistence replacing AsyncStorage mock auth: AuthProvider with authService prop injection, Session type state, and passing SESSION-01/SESSION-03 tests
- AppState-based session expiry detection (SESSION-04) and cold-start restore tests (SESSION-02), with real authService wired end-to-end in _layout.tsx
- TenantResolution type, resolveTenants/selectTenant authService methods, and TenantPickerScreen with FlatList navigation to login password step
- Two-step email-first login UX with tenant resolution state machine: email step calls resolveTenants, auto-selects single tenant or navigates to picker, password step shows company name and calls AuthContext.login with tenantId
- AuthContext.login() changed from Promise<boolean> to Promise<void>/throw, with SHOW/HIDE password toggle and inline error messages replacing all Alert.alert calls
- _layout.tsx rewritten to use Stack.Protected + SplashScreen eliminating login flash on cold start, with 5 unit tests covering GUARD-01
- Three targeted auth fixes: validate-token request body field name (BREAK-01), jose audience array for mobile Cognito client (BREAK-02), and Session type extended with ssoProvider field
- 9-case Vitest unit suite for POST /api/auth/validate-token covering all happy paths and error branches via jose mock using vi.hoisted + vi.mock pattern
- Fixed JWT seconds/milliseconds unit mismatch in AuthContext (BREAK-03/SESSION-04) and updated stale body.token assertion to body.idToken in authService tests (MISSING-01)

---
