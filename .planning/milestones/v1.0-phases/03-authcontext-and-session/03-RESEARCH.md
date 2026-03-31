# Phase 3: AuthContext and Session - Research

**Researched:** 2026-03-27
**Domain:** React Native AuthContext, expo-secure-store, AppState, Jest testing patterns
**Confidence:** HIGH

## Summary

Phase 3 replaces the mock `AuthContext` (backed by `AsyncStorage`) with a real implementation that delegates authentication to an injected `authService`, persists the server-validated `Session` object to `expo-secure-store`, restores the session on cold start, clears it on logout, and detects expiry on foreground resume via `AppState`.

The Phase 2 output (`authService.ts`, `types.ts`) is the primary upstream dependency. The `AuthProvider` interface changes significantly: `driverName`/`driverEmail` disappear; `session: Session | null` arrives; `login` gains a `tenantId` parameter. The settings screen and login screen have minor call-site updates. `login.tsx` cannot complete end-to-end auth in Phase 3 (no tenant resolution yet) — its call site receives a placeholder `tenantId`.

`expo-secure-store` is not yet installed. It must be added via `npx expo install expo-secure-store` (resolves to `~15.0.8` for Expo SDK 54, confirmed against the SDK-54 branch of the expo repo). The Jest transform ignore pattern in `jest.config.js` must be updated to include `expo-secure-store` so the package is transpiled during tests.

**Primary recommendation:** Implement `AuthProvider` as a pure React component with injected `authService` prop. Keep `checkSession` and `AppState` listener inline (not extracted to custom hook) per Claude's Discretion. Store the session JSON under key `pegasus_session` in `expo-secure-store`. Mock `expo-secure-store` and `AppState` in `jest.setup.js`.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `login(email: string, password: string, tenantId: string): Promise<boolean>` — tenantId added to the signature now. Phase 4 will supply it from tenant resolution. In Phase 3, `login.tsx` cannot call this function end-to-end (no tenantId source yet); tests cover the full flow via Jest with a mock authService.

**D-02:** `session: Session | null` replaces `driverName: string` and `driverEmail: string`. The `Session` type (from `apps/mobile/src/auth/types.ts`) carries `{ sub, tenantId, role, email, expiresAt }` — consumers access `session?.email`, `session?.role`, etc. directly.

**D-03:** `isAuthenticated: boolean` is derived from `session !== null` — kept as a convenience field (auth guard and layout already use it).

**D-04:** `isLoading: boolean` is kept — used during cold-start restore before the auth guard can decide where to route.

**D-05:** `driverName` and `driverEmail` are removed entirely. `apps/mobile/app/(tabs)/settings.tsx` is updated in Phase 3 to use `session?.email` and `session?.role` (no driverName equivalent exists in the real Session).

**D-06:** `AuthProvider` accepts `authService` as a prop: `<AuthProvider authService={authService}>`. The real instance is created in `apps/mobile/app/_layout.tsx` using `createAuthService({ apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '', cognitoService })`. Tests inject a plain mock object — no `jest.mock()` needed, matching the Phase 2 factory pattern.

**D-07:** `expo-secure-store` for the persisted session (SESSION-01). Must be installed via `npx expo install expo-secure-store` (not yet in package.json). Raw Cognito tokens are discarded after `validate-token` succeeds — only the `Session` object is stored.

**D-08:** On `AsyncStorage` → `expo-secure-store` migration: the old `@moving_app_session` AsyncStorage key is abandoned. No migration needed — the old session shape is incompatible with the new Session type; cold start will find nothing in secure store and show login.

**D-09:** `checkSession()` reads secure store in a `useEffect` at mount. Sets `isLoading = true` during the read, `false` after. The auth guard in `_layout.tsx` already waits on `isLoading` before routing — this prevents the login-screen flash for authenticated drivers.

**D-10:** `logout()` deletes the secure-store entry and resets `session` to `null`. No Cognito token revocation in Phase 3 (tokens were discarded at login; nothing to revoke). The auth guard redirects to login when `isAuthenticated` goes false.

**D-11:** `AppState` change listener (react-native built-in) fires on foreground resume. Handler reads the current `session` from state; if `session.expiresAt < Date.now()`, calls `logout()`. This clears secure store and routes the driver to re-login. No modal or prompt overlay — the login screen is the re-login experience.

### Claude's Discretion

- Exact storage key string for expo-secure-store (e.g. `pegasus_session`)
- Whether `checkSession` and `AppState` listener are extracted into a custom hook or stay inline in AuthProvider
- Test file location (`AuthContext.test.tsx` stays co-located in `src/context/`)
- Whether `AppState` subscription is set up in the same `useEffect` as `checkSession` or a separate one

### Deferred Ideas (OUT OF SCOPE)

Token refresh / silent re-auth is v2 (SESSION-V2-01) and explicitly out of scope for Phase 3.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID         | Description                                                                                                                          | Research Support                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| SESSION-01 | Validated session (tenantId, role, email, sub, expiresAt) persisted in `expo-secure-store`; raw Cognito tokens discarded            | expo-secure-store `setItemAsync` / `getItemAsync` / `deleteItemAsync` API confirmed. D-07 locks approach. |
| SESSION-02 | On cold start, session restored from secure store before any route renders; no login-screen flash for authenticated driver           | `checkSession` in `useEffect` at mount with `isLoading` guard — auth guard in `_layout.tsx` already waits.|
| SESSION-03 | Driver can log out — clears secure store, resets AuthContext state, navigates to login screen                                       | `deleteItemAsync` + `session = null` + existing auth guard redirect. D-10 locks approach.                 |
| SESSION-04 | On app foreground resume, if `session.expiresAt < Date.now()`, driver shown re-login prompt (login screen, no modal)                | `AppState.addEventListener('change', handler)` — fires `'active'` on foreground. D-11 locks approach.     |

</phase_requirements>

## Standard Stack

### Core

| Library          | Version  | Purpose                                      | Why Standard                                              |
| ---------------- | -------- | -------------------------------------------- | --------------------------------------------------------- |
| expo-secure-store | ~15.0.8 | Encrypted key-value storage for Session JSON | Expo SDK 54 compatible; keychain (iOS) / Keystore (Android); required by SESSION-01 |
| react-native AppState | (built-in) | Foreground/background lifecycle events | Zero-dependency built-in; only mechanism for SESSION-04 |

### Supporting

| Library              | Version | Purpose                              | When to Use                                   |
| -------------------- | ------- | ------------------------------------ | --------------------------------------------- |
| @react-native-async-storage/async-storage | 2.2.0 | Already installed; being abandoned | Old key `@moving_app_session` is abandoned — no migration |

### Alternatives Considered

| Instead of          | Could Use            | Tradeoff                                                        |
| ------------------- | -------------------- | --------------------------------------------------------------- |
| expo-secure-store   | AsyncStorage         | AsyncStorage is not encrypted — SESSION-01 explicitly requires encrypted secure store |
| AppState (built-in) | react-native-appstate-hook | No need for an extra dependency; built-in API is clean in React hooks |

**Installation:**
```bash
cd apps/mobile && npx expo install expo-secure-store
```

**Version verification:** `npx expo install` resolves `expo-secure-store` to the SDK-54-compatible version (`~15.0.8`) automatically. Confirmed: expo repo `sdk-54` branch has `expo-secure-store` at `15.0.8`.

## Architecture Patterns

### Recommended Project Structure

No new files or directories needed. All changes are to existing files:

```
apps/mobile/
├── src/
│   └── context/
│       ├── AuthContext.tsx          # PRIMARY TARGET: full rewrite
│       └── AuthContext.test.tsx     # REWRITE: covers SESSION-01 through SESSION-04
├── app/
│   ├── _layout.tsx                  # Wire real authService into AuthProvider
│   └── (tabs)/
│       └── settings.tsx             # session?.email / session?.role
└── (auth)/
    └── login.tsx                    # Remove hint text; login() call gets placeholder tenantId
```

### Pattern 1: AuthProvider with Injected authService Prop

**What:** `AuthProvider` receives `authService` as a required prop rather than importing a singleton. The real instance is created at the call site (`_layout.tsx`). Tests inject a plain mock object.

**When to use:** Always — this is Locked Decision D-06, matching the Phase 2 factory pattern.

**Example:**
```typescript
// Source: apps/mobile/src/auth/authService.ts (Phase 2 pattern)
type AuthProviderProps = {
  authService: {
    authenticate(email: string, password: string, tenantId: string): Promise<Session>
  }
  children: React.ReactNode
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ authService, children }) => {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // ...
}
```

### Pattern 2: expo-secure-store Session Persistence

**What:** `Session` object serialised to JSON and stored under a single key. Retrieved on cold start; deleted on logout.

**When to use:** SESSION-01 (persist), SESSION-02 (restore), SESSION-03 (clear).

**Example:**
```typescript
// Source: https://docs.expo.dev/versions/v54.0.0/sdk/securestore/
import * as SecureStore from 'expo-secure-store'

const SESSION_KEY = 'pegasus_session'

// Store
await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session))

// Restore
const raw = await SecureStore.getItemAsync(SESSION_KEY)
const session = raw ? (JSON.parse(raw) as Session) : null

// Clear
await SecureStore.deleteItemAsync(SESSION_KEY)
```

### Pattern 3: AppState Listener for Expiry Detection

**What:** Subscribe to `AppState` `'change'` events. On `'active'` state, check `session?.expiresAt < Date.now()` and call `logout()` if expired. Clean up subscription on unmount.

**When to use:** SESSION-04. React-native built-in — no install needed.

**Example:**
```typescript
// Source: https://reactnative.dev/docs/appstate
import { AppState } from 'react-native'

useEffect(() => {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active' && session !== null && session.expiresAt < Date.now()) {
      logout()
    }
  })
  return () => subscription.remove()
}, [session]) // re-subscribe when session changes so handler sees current session
```

**Critical dependency array note:** The `AppState` handler captures `session` via closure. If `session` is not in the dependency array, the handler captures a stale `null` on mount and never detects expiry. Two valid approaches:
1. Put `session` in the dependency array (re-subscribes on each session change — simple, correct for this use case)
2. Use a `useRef` to hold the current session and read from the ref inside the handler (avoids re-subscribing)

Either approach works. The dependency-array approach (option 1) is simpler and preferred given the low frequency of session changes.

### Pattern 4: TestConsumer + renderWithProvider with injected mock authService

**What:** The existing `renderWithProvider` pattern from Phase 2 tests is extended to accept an `authService` mock as a parameter. The mock is a plain object — no `jest.mock()` needed.

**When to use:** All `AuthContext.test.tsx` tests.

**Example:**
```typescript
// Source: apps/mobile/src/context/AuthContext.test.tsx (existing pattern, extended)
const mockAuthService = {
  authenticate: jest.fn(),
}

function renderWithProvider(authService = mockAuthService) {
  const ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null> = { current: null }
  render(
    <AuthProvider authService={authService}>
      <TestConsumer ctxRef={ctxRef} />
    </AuthProvider>,
  )
  return ctxRef
}
```

### Anti-Patterns to Avoid

- **Storing idToken in secure store:** Raw Cognito tokens must NOT be stored. Only the `Session` object returned from `validate-token` is persisted (D-07, AUTH-03).
- **Importing authService as a singleton in AuthContext:** Breaks test isolation. Always inject via prop (D-06).
- **Reading `session` from a stale closure in AppState handler:** If the AppState `useEffect` has an empty dependency array, the handler always sees `session = null` and never triggers logout. Include `session` in the dep array or use a ref.
- **Not adding `expo-secure-store` to jest.config.js `transformIgnorePatterns`:** The current pattern covers `expo` (the package), not `expo-secure-store` (a separate package). Without this fix, Jest will fail to parse the ESM output of expo-secure-store.
- **Calling `logout()` inside an AppState handler that captures stale state:** Same issue as above — use dep array or ref.

## Don't Hand-Roll

| Problem              | Don't Build              | Use Instead         | Why                                                                |
| -------------------- | ------------------------ | ------------------- | ------------------------------------------------------------------ |
| Encrypted local storage | Custom encryption + AsyncStorage | expo-secure-store | Platform keychain/Keystore; session-01 requirement; hardware-backed |
| Foreground detection | Polling timer            | AppState (built-in) | Platform lifecycle; no polling overhead; already in react-native   |

**Key insight:** `expo-secure-store` delegates to iOS Keychain and Android Keystore — both hardware-backed on modern devices. Any custom solution would be weaker and more complex.

## Common Pitfalls

### Pitfall 1: Stale Closure in AppState Handler

**What goes wrong:** The AppState `useEffect` is set up once on mount with `[]` deps. The handler captures `session = null`. When the app comes back to foreground with an expired session, `session` reads as `null` — condition `session !== null && session.expiresAt < Date.now()` never fires.

**Why it happens:** JavaScript closures capture the value at the time the function is created. An empty `useEffect` dep array means the function is never recreated.

**How to avoid:** Add `session` to the dep array. The subscription is recreated whenever `session` changes (login/logout), and the handler always reads the current session value.

**Warning signs:** Tests that set up an expired session and trigger AppState 'active' see no logout call — verify the handler reads current state, not mount-time state.

### Pitfall 2: Jest Cannot Parse expo-secure-store

**What goes wrong:** Jest throws `SyntaxError: Cannot use import statement in a module` when importing `expo-secure-store` in tests.

**Why it happens:** `jest.config.js` `transformIgnorePatterns` currently excludes `expo` (the package itself) and several other expo packages from the default ignore. But `expo-secure-store` is a separate package and not listed — Jest's default ignores `node_modules`, so it tries to use the raw ESM output and fails.

**How to avoid:** Add `expo-secure-store` to the `transformIgnorePatterns` allowlist in `jest.config.js`:
```js
transformIgnorePatterns: [
  'node_modules/(?!(react-native|@react-native|expo|@expo|expo-status-bar|expo-router|expo-constants|expo-image-picker|expo-linking|expo-secure-store|react-native-web|react-native-safe-area-context|react-native-screens)/)',
],
```

**Warning signs:** Tests import AuthContext, which imports SecureStore, and Jest bails with a syntax error pointing at the expo-secure-store source.

### Pitfall 3: expo-secure-store Not Mocked in jest.setup.js

**What goes wrong:** Tests that exercise `checkSession`, `login`, or `logout` call into real `SecureStore` methods. In a Jest/Node environment there is no native Keychain — calls throw `TypeError: null is not an object (evaluating 'ExpoSecureStore.getValueWithKeyAsync')`.

**Why it happens:** `expo-secure-store` native methods are not available in the Jest Node environment.

**How to avoid:** Add a mock to `jest.setup.js`:
```js
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}))
```

**Warning signs:** Tests throw about null native module or missing native implementation.

### Pitfall 4: settings.tsx Still Destructures driverName / driverEmail

**What goes wrong:** TypeScript compiler error: `Property 'driverName' does not exist on type AuthContextType` after the AuthContext interface update.

**Why it happens:** `settings.tsx` currently uses `const { driverName, driverEmail, logout } = useAuth()`. If `AuthContext.tsx` is updated but `settings.tsx` is not, the build breaks.

**How to avoid:** Update `settings.tsx` in the same plan as the AuthContext rewrite (or immediately after). Replace destructuring with `const { session, logout } = useAuth()`.

### Pitfall 5: login.tsx Signature Mismatch

**What goes wrong:** `login.tsx` calls `login(email, password)` with 2 args; the new signature is `login(email, password, tenantId)`. TypeScript will error.

**Why it happens:** The old login screen passes 2 args; the new interface requires 3.

**How to avoid:** Update `login.tsx` to pass a placeholder: `login(email, password, '')`. Add a comment: `// TODO Phase 4: tenantId supplied from tenant resolution`. This is a known incompleteness per CONTEXT.md.

### Pitfall 6: isAuthenticated Derived From Session, Not a Separate State Variable

**What goes wrong:** If `isAuthenticated` is stored as a separate `useState` that is toggled independently, it can go out of sync with `session`. For example, `logout()` sets `session = null` but forgets to set `isAuthenticated = false`.

**Why it happens:** Derived state stored as independent state variables requires manual synchronisation.

**How to avoid:** Compute `isAuthenticated` as `const isAuthenticated = session !== null` (D-03). Never store it in `useState`. Pass it via context value derived at render time.

## Code Examples

Verified patterns from official sources:

### expo-secure-store: Get / Set / Delete

```typescript
// Source: https://docs.expo.dev/versions/v54.0.0/sdk/securestore/
import * as SecureStore from 'expo-secure-store'

// Store session
await SecureStore.setItemAsync('pegasus_session', JSON.stringify(session))

// Restore session (returns null if key absent)
const raw = await SecureStore.getItemAsync('pegasus_session')
const session: Session | null = raw ? (JSON.parse(raw) as Session) : null

// Delete session
await SecureStore.deleteItemAsync('pegasus_session')
```

### AppState: Subscribe and Clean Up

```typescript
// Source: https://reactnative.dev/docs/appstate
import { AppState, AppStateStatus } from 'react-native'

useEffect(() => {
  const subscription = AppState.addEventListener(
    'change',
    (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        // check session expiry here
      }
    }
  )
  return () => subscription.remove()
}, [session]) // session in dep array — avoids stale closure
```

### AuthContext Interface (new shape)

```typescript
// Derived from CONTEXT.md D-01 through D-05
interface AuthContextType {
  session: Session | null
  isAuthenticated: boolean  // derived: session !== null
  isLoading: boolean
  login: (email: string, password: string, tenantId: string) => Promise<boolean>
  logout: () => Promise<void>
}
```

### _layout.tsx wiring

```typescript
// Source: CONTEXT.md D-06
import { createAuthService } from '../src/auth/authService'
import * as cognitoService from '../src/auth/cognitoService'

const authService = createAuthService({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  cognitoService,
})

export default function RootLayout() {
  return (
    <AuthProvider authService={authService}>
      <RootLayoutNav />
    </AuthProvider>
  )
}
```

### Jest mock for expo-secure-store

```javascript
// Source: jest.setup.js — matches pattern of existing AsyncStorage mock
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}))
```

### Jest mock for AppState

```javascript
// In test file or jest.setup.js — manually trigger state change in tests
const mockAppStateListeners: Array<(state: string) => void> = []
jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
  mockAppStateListeners.push(handler as (state: string) => void)
  return { remove: jest.fn() }
})

// In test: simulate foreground
act(() => { mockAppStateListeners.forEach(fn => fn('active')) })
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
| --- | --- | --- | --- |
| `AppState.addEventListener` returning a subscription | same API (subscription pattern added in React Native 0.65) | RN 0.65 (2021) | `subscription.remove()` is the correct cleanup — `AppState.removeEventListener` is deprecated |
| Mock session in AsyncStorage | Real Session in expo-secure-store | Phase 3 | Session shape changes; old key abandoned |

**Deprecated/outdated:**

- `AppState.removeEventListener`: Deprecated in React Native 0.65 — use `subscription.remove()` (the pattern shown in the examples above).
- `@moving_app_session` AsyncStorage key: Abandoned. No migration needed (incompatible shapes).

## Open Questions

1. **cognitoService import in _layout.tsx**
   - What we know: `authService.ts` requires a `cognitoService` dep. `apps/mobile/src/auth/cognitoService.ts` was created in Phase 2.
   - What's unclear: Whether `cognitoService.ts` exports individual functions or a named namespace object (impacts the import style in `_layout.tsx`).
   - Recommendation: Executor reads `apps/mobile/src/auth/cognitoService.ts` before writing `_layout.tsx` to confirm the export shape.

2. **expo-secure-store exact version pinned by `npx expo install`**
   - What we know: The SDK 54 branch of expo/expo has `expo-secure-store` at `15.0.8`. The dist-tag `latest` is `55.0.9` (SDK 55+).
   - What's unclear: Whether `npx expo install expo-secure-store` in an SDK 54 project resolves to `~15.0.8` or a higher version.
   - Recommendation: Run `npx expo install expo-secure-store` and verify the resulting `package.json` version. If it resolves to `~15.0.x`, that's correct. If it resolves to `~55.x`, that targets a newer SDK — pin to `~15.0.8` explicitly.

## Environment Availability

| Dependency            | Required By          | Available | Version | Fallback |
| --------------------- | -------------------- | --------- | ------- | -------- |
| expo-secure-store     | SESSION-01/02/03     | Not installed | — | None — install required |
| react-native AppState | SESSION-04           | Built-in (react-native 0.81.6) | 0.81.6 | — |
| Jest / @testing-library/react-native | All tests | Installed | jest 29.7.0 / @testing-library/react-native 13.3.3 | — |

**Missing dependencies with no fallback:**

- `expo-secure-store` — must be installed before Phase 3 can be implemented. Run `cd apps/mobile && npx expo install expo-secure-store`.

**Missing dependencies with fallback:**

- None.

## Validation Architecture

### Test Framework

| Property           | Value                                                |
| ------------------ | ---------------------------------------------------- |
| Framework          | Jest 29.7.0 + @testing-library/react-native 13.3.3  |
| Config file        | `apps/mobile/jest.config.js`                         |
| Quick run command  | `cd apps/mobile && npm test -- --testPathPattern=AuthContext` |
| Full suite command | `cd apps/mobile && npm test`                         |

### Phase Requirements → Test Map

| Req ID     | Behavior                                                                  | Test Type | Automated Command                                                                              | File Exists? |
| ---------- | ------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- | ------------ |
| SESSION-01 | After login, session JSON is stored in secure-store; raw tokens absent    | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext`                                  | Rewrite existing |
| SESSION-02 | Cold start with valid secure-store session → isAuthenticated true, no flash | unit    | `cd apps/mobile && npm test -- --testPathPattern=AuthContext`                                  | Rewrite existing |
| SESSION-03 | logout() clears secure-store, session=null, isAuthenticated=false         | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext`                                  | Rewrite existing |
| SESSION-04 | AppState 'active' with expired session triggers logout()                  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext`                                  | Rewrite existing |

### Sampling Rate

- **Per task commit:** `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit`
- **Per wave merge:** `cd apps/mobile && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `jest.setup.js` — add `expo-secure-store` mock
- [ ] `jest.config.js` — add `expo-secure-store` to `transformIgnorePatterns`
- [ ] `apps/mobile/package.json` — `expo-secure-store ~15.0.8` (via `npx expo install`)
- [ ] `src/context/AuthContext.test.tsx` — full rewrite to cover SESSION-01 through SESSION-04 with mock authService

## Sources

### Primary (HIGH confidence)

- Expo SDK 54 SecureStore docs — `getItemAsync`, `setItemAsync`, `deleteItemAsync` API signatures
- React Native AppState docs — `addEventListener('change', handler)`, `AppStateStatus` values, `subscription.remove()` pattern
- `apps/mobile/src/auth/authService.ts` — Phase 2 factory injection pattern (codebase)
- `apps/mobile/src/auth/types.ts` — `Session` type shape (codebase)
- `apps/mobile/src/context/AuthContext.tsx` — current mock implementation (codebase)
- `apps/mobile/src/context/AuthContext.test.tsx` — existing TestConsumer/renderWithProvider pattern (codebase)
- `apps/mobile/jest.config.js` / `jest.setup.js` — existing mock infrastructure (codebase)
- `apps/mobile/package.json` — confirms expo ~54.0.30, jest 29.7.0 (codebase)
- `expo/expo` GitHub `sdk-54` branch — confirms expo-secure-store `15.0.8` for SDK 54

### Secondary (MEDIUM confidence)

- npm registry dist-tags for `expo-secure-store` — confirms `15.0.8` is latest in the 15.x line (pre-SDK-55)
- `AppState.removeEventListener` deprecation — React Native changelog 0.65

### Tertiary (LOW confidence)

- None

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — expo-secure-store is the only reasonable encrypted-storage option for Expo; AppState is built-in
- Architecture: HIGH — all decisions are locked in CONTEXT.md; Phase 2 patterns are confirmed in codebase
- Pitfalls: HIGH — stale-closure and Jest transform issues are verified against the codebase; expo-secure-store mock is verified against the existing AsyncStorage mock pattern

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (expo-secure-store and AppState APIs are stable)
