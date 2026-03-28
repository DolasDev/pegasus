# Phase 5: Login UX and Auth Guard - Research

**Researched:** 2026-03-28
**Domain:** React Native login UX, expo-router v6 auth guard
**Confidence:** HIGH

## Summary

Phase 5 is a refinement phase over a fully-wired login flow. Three existing files need targeted surgical changes: `login.tsx` (password toggle + inline errors + input locking), `AuthContext.tsx` (throw-on-failure interface change), and `_layout.tsx` (SplashScreen + Stack.Protected guard). No new packages, no new screens, no new routes.

The key risk is test-suite coherence: existing `AuthContext.test.tsx` asserts `login()` returns a boolean; that contract must be broken deliberately (return type changes to `Promise<void>`, throws on failure). Several existing login test cases also test the old Alert-based paths; they need replacement tests for the inline error pattern. The jest.setup.js mock for expo-router does not include `SplashScreen` or `Stack.Protected` — the setup file must be extended before `_layout.tsx` tests can run cleanly.

All APIs are confirmed present in the installed `expo-router` build. `Stack.Protected` is exported from `withLayoutContext` with a single `guard: boolean` prop. `SplashScreen.preventAutoHideAsync()`, `SplashScreen.hideAsync()`, and `SplashScreen.hide()` are all available as named exports from `expo-router`'s `SplashScreen` namespace (re-exported via `exports.d.ts`).

**Primary recommendation:** Execute in two plans — (1) login.tsx + AuthContext.tsx changes with test coverage, (2) \_layout.tsx auth guard replacement with test coverage. The AuthContext change is the load-bearing coupling point; plan it first so login.tsx can depend on the new throw-on-failure interface.

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `AuthContext.login()` is changed to throw `AuthError` on failure instead of returning `false`. Return type changes from `Promise<boolean>` to `Promise<void>`.

**D-02:** `login.tsx` wraps the password step login call in `try/catch`. On `AuthError`, maps `error.code` to a human-readable inline message and sets `passwordError` state. No `Alert.alert` on the password step.

**D-03:** Error messages to display inline for known codes:

- `NotAuthorizedException` → "Incorrect password. Please try again."
- `UserNotFoundException` → "Account not found."
- `UserNotConfirmedException` → "Account not confirmed. Contact your company admin."
- `LimitExceededException` → "Too many attempts. Please wait and try again."
- Network/unknown → "Unable to connect. Check your internet and try again."

**D-04:** Toggle uses tappable text `SHOW` / `HIDE` positioned inside the right side of the password input container. Uppercase to match the existing label style (`EMAIL`, `PASSWORD`). `secureTextEntry` toggled via local `showPassword` boolean state.

**D-05:** Toggle is a `TouchableOpacity` absolutely positioned (or row-flex inside the input wrapper). Style follows `colors.primary` for the active text, matching button text colour.

**D-06:** `isLoading` already disables inputs and buttons on the email step — pattern is correct. Password step adds a `passwordError` state for empty-password validation (replaces the existing `Alert.alert` empty-check). All inputs use `editable={!isLoading}` and the submit button uses `disabled={isLoading}`.

**D-07:** No additional shared loading state across screens is needed. The `isLoading` state in `login.tsx` is set to `true` before the first async call and `false` only after `login()` resolves or throws — this covers the full email-to-validate-token window.

**D-08:** `SplashScreen` is imported from `'expo-router'` — no separate `expo-splash-screen` package needed. `SplashScreen.preventAutoHideAsync()` is called at module level in `_layout.tsx` (outside the component).

**D-09:** `SplashScreen.hideAsync()` is called in a `useEffect` when `isLoading` flips to `false`. Authenticated drivers see the home route immediately; unauthenticated drivers see login — no flash.

**D-10:** The `useEffect`-based redirect (`router.replace`) and `ActivityIndicator` spinner are removed. Navigation control is handed entirely to `Stack.Protected`.

**D-11:** `Stack.Protected` wraps the authenticated screens with `guard={isAuthenticated}`. Structure:

```tsx
<Stack>
  <Stack.Protected guard={isAuthenticated}>
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="order" />
  </Stack.Protected>
  <Stack.Screen name="(auth)" />
</Stack>
```

### Claude's Discretion

- Exact layout of the show/hide toggle inside the input (absolute position vs flex row) — planner decides based on TextInput constraints in React Native
- Whether `passwordError` is cleared on each `onChangeText` or only on submit — planner decides
- Test strategy for SplashScreen (mock vs skip) — planner decides based on testability

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                            | Research Support                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-04  | Password field includes a show/hide toggle so the driver can verify what they typed                                    | `showPassword` boolean state + `secureTextEntry={!showPassword}` on TextInput; SHOW/HIDE TouchableOpacity with `colors.primary` text     |
| AUTH-05  | Authentication errors (wrong password, account locked, network failure) displayed inline — not as `Alert.alert` popups | `AuthContext.login()` throws `AuthError`; `login.tsx` catches, maps `error.code` to D-03 messages, sets `passwordError` state            |
| AUTH-06  | Submit button disabled and all inputs non-editable throughout entire login flow to prevent concurrent requests         | `editable={!isLoading}` on all TextInputs; `disabled={isLoading}` on all buttons; `isLoading` held true from first call to final resolve |
| GUARD-01 | Root layout uses `Stack.Protected` + `SplashScreen.preventAutoHideAsync()` eliminating login screen flash              | `Stack.Protected` confirmed in expo-router build with `guard: boolean`; SplashScreen APIs confirmed present in expo-router exports       |

</phase_requirements>

---

## Standard Stack

### Core (no new installs required)

| Library        | Version     | Purpose                                                   | Why Standard                                                                      |
| -------------- | ----------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| expo-router    | (installed) | Stack.Protected auth guard, SplashScreen                  | Confirmed present; Stack.Protected and SplashScreen re-exported from package root |
| react-native   | (installed) | TextInput secureTextEntry, TouchableOpacity, View layout  | All primitives needed are standard RN                                             |
| @pegasus/theme | (installed) | `colors.primary`, `colors.error`, spacing/fontSize tokens | Already in use throughout login.tsx                                               |

### No New Packages

All requirements are met with already-installed libraries. The CONTEXT.md explicitly locks `SplashScreen` to `expo-router` (D-08) — `expo-splash-screen` is NOT imported separately.

**Installation:** None required.

---

## Architecture Patterns

### Recommended File Change Scope

```
apps/mobile/
├── app/(auth)/login.tsx          # AUTH-04, AUTH-05, AUTH-06 (password step changes)
├── src/context/AuthContext.tsx   # AUTH-05 (login() return type: Promise<boolean> → Promise<void>)
└── app/_layout.tsx               # GUARD-01 (Stack.Protected + SplashScreen)
```

### Pattern 1: AuthContext throw-on-failure (D-01)

**What:** Change `login()` return type from `Promise<boolean>` to `Promise<void>`. Re-throw `AuthError` from the catch block instead of returning `false`. The internal try/catch structure is kept but `return false` becomes `throw error`.

**When to use:** Any context method that surfaces domain errors to callers. Throw-on-failure is the idiomatic TypeScript/async pattern — it lets callers use try/catch instead of inspecting boolean return values.

**Impact on existing code:**

- `AuthContext.tsx` line 64: signature changes, catch block re-throws
- `AuthContext.test.tsx`: existing tests asserting `result === false` and `result === true` must be rewritten — `true` case becomes "resolves without throwing", `false` case becomes "throws AuthError"
- `login.tsx` line 95: `const success = await login(...)` and the `if (!success)` check are replaced with try/catch

**Code shape (AuthContext.tsx):**

```typescript
// Source: CONTEXT.md D-01
const login = async (email: string, password: string, tenantId: string): Promise<void> => {
  try {
    const newSession = await authService.authenticate(email, password, tenantId)
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(newSession))
    setSession(newSession)
    logger.logAuth('login', email)
  } catch (error) {
    logger.error('Login failed', error)
    throw error // re-throw so login.tsx can catch and display inline error
  }
}
```

### Pattern 2: Password show/hide toggle (D-04, D-05)

**What:** Wrap the `TextInput` for password in a flex-row `View`. The `TextInput` takes `flex: 1` and `borderWidth: 0` (border moves to the outer wrapper). A `TouchableOpacity` sits to the right showing "SHOW" or "HIDE".

**Why flex row over absolute positioning:** `TextInput` in React Native does not reliably support children, and absolutely positioning over a TextInput can clip touch events on Android. A flex row wrapper avoids both issues. This falls under Claude's Discretion — planner confirms this layout.

**Code shape (login.tsx password step):**

```tsx
// Source: CONTEXT.md D-04, D-05; UI-SPEC interaction contract
const [showPassword, setShowPassword] = useState(false)
// ...
<View style={styles.inputWrapper}>
  <TextInput
    style={[styles.input, styles.inputFlex]}
    secureTextEntry={!showPassword}
    editable={!isLoading}
    // ...
  />
  <TouchableOpacity
    onPress={() => setShowPassword(prev => !prev)}
    style={styles.toggleButton}
    activeOpacity={0.8}
  >
    <Text style={styles.toggleText}>{showPassword ? 'HIDE' : 'SHOW'}</Text>
  </TouchableOpacity>
</View>
```

**Style notes from UI-SPEC:**

- `toggleText`: `fontSize: fontSize.medium` (16px), `fontWeight: '700'`, `color: colors.primary`, `letterSpacing: 0.5`
- Toggle tappable during `isLoading` — no `disabled` prop on it (no async side effect per UI-SPEC)
- `inputWrapper`: replaces bare `styles.input` on the outer container; holds the 2px border

### Pattern 3: Inline password error (D-02, D-03)

**What:** `handleLogin` becomes a try/catch. Empty-password guard sets `passwordError` directly (replaces `Alert.alert`). `AuthError` catch maps `error.code` to D-03 messages. All error display uses the existing `styles.errorText`.

**passwordError clearing:** Clear on `onChangeText` for the password field — this is the better UX (error disappears as user starts correcting, same as `emailError` pattern already in the email step). Falls under Claude's Discretion — planner confirms.

**Code shape (login.tsx handleLogin):**

```tsx
// Source: CONTEXT.md D-02, D-03
const handleLogin = async () => {
  if (!password) {
    setPasswordError('Please enter your password.')
    return
  }
  setPasswordError(null)
  setIsLoading(true)
  try {
    await login(email, password, tenantId)
    // navigation handled by Stack.Protected — no explicit router.replace needed
  } catch (error) {
    const code = error instanceof AuthError ? error.code : 'unknown'
    const messages: Record<string, string> = {
      NotAuthorizedException: 'Incorrect password. Please try again.',
      UserNotFoundException: 'Account not found.',
      UserNotConfirmedException: 'Account not confirmed. Contact your company admin.',
      LimitExceededException: 'Too many attempts. Please wait and try again.',
    }
    setPasswordError(messages[code] ?? 'Unable to connect. Check your internet and try again.')
  } finally {
    setIsLoading(false)
  }
}
```

### Pattern 4: Stack.Protected + SplashScreen auth guard (D-08 to D-11)

**What:** Module-level `SplashScreen.preventAutoHideAsync()` call prevents native splash from hiding before auth state resolves. `useEffect` watches `isLoading` and calls `SplashScreen.hideAsync()` when false. `Stack.Protected` with `guard={isAuthenticated}` replaces the imperative `useEffect` + `router.replace` redirect.

**Removal checklist from current \_layout.tsx:**

- `import { useRouter, useSegments }` — removed (no longer needed)
- `const segments = useSegments()` — removed
- `const router = useRouter()` — removed
- `useEffect([isAuthenticated, isLoading, segments])` — removed
- `if (isLoading) return <ActivityIndicator>` — removed
- `import { View, ActivityIndicator, StyleSheet }` — removed (if no other usage)
- `const styles = StyleSheet.create(...)` — removed (if no other usage)

**Code shape (\_layout.tsx):**

```tsx
// Source: CONTEXT.md D-08, D-09, D-10, D-11; specifics code shape
import 'react-native-get-random-values'
import { useEffect } from 'react'
import { Stack, SplashScreen } from 'expo-router'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { createAuthService } from '../src/auth/authService'
import * as cognitoService from '../src/auth/cognitoService'

SplashScreen.preventAutoHideAsync()

export const authService = createAuthService({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  cognitoService,
})

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync()
  }, [isLoading])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="order" />
      </Stack.Protected>
      <Stack.Screen name="(auth)" />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider authService={authService}>
      <RootLayoutNav />
    </AuthProvider>
  )
}
```

### Anti-Patterns to Avoid

- **Calling `SplashScreen.preventAutoHideAsync()` inside the component body:** It must be module-level (outside the component) so it fires synchronously at import time, before React renders anything.
- **Using `expo-splash-screen` directly:** CONTEXT.md D-08 locks the import to `'expo-router'`. The expo-router build re-exports the same functions.
- **Keeping `router.replace` for post-login navigation:** With `Stack.Protected`, navigation is automatic when `isAuthenticated` changes. An explicit `router.replace` after successful login would cause a double-navigation.
- **Passing `disabled` to the SHOW/HIDE toggle:** The toggle has no async side effect; disabling it during loading degrades UX (user can't see what they typed to confirm before retry).
- **Leaving `Alert` import in login.tsx:** Once `Alert.alert` calls are removed, the `Alert` import becomes unused and will produce a lint warning. Remove it.

---

## Don't Hand-Roll

| Problem                      | Don't Build                             | Use Instead                                                        | Why                                                                                               |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Auth route protection        | Custom useEffect + router.replace guard | `Stack.Protected` from expo-router                                 | Built-in, handles edge cases (back press, deep links); useEffect fires after render causing flash |
| Splash screen control        | Custom loading overlay component        | `SplashScreen` from expo-router                                    | Native OS splash; custom overlay cannot prevent the pre-render flash                              |
| Error code → message mapping | Switch statement or if/else chain       | Plain object literal (Record<string, string>) + nullish coalescing | Simpler, directly testable, easy to extend                                                        |

---

## Common Pitfalls

### Pitfall 1: jest.setup.js mock for expo-router missing Stack.Protected and SplashScreen

**What goes wrong:** Tests that render `_layout.tsx` or anything that imports from expo-router will fail with `TypeError: Cannot read properties of undefined (reading 'Protected')` because the current mock only stubs `Stack.Screen`, not `Stack.Protected`.

**Why it happens:** The mock was written before `Stack.Protected` was introduced. Current mock:

```js
Stack: {
  Screen: jest.fn(({ children }) => children),
},
```

`Stack.Protected` is `undefined` in tests.

**How to avoid:** Extend the expo-router mock in `jest.setup.js` to add:

```js
Stack: {
  Screen: jest.fn(({ children }) => children),
  Protected: jest.fn(({ children }) => children),
},
SplashScreen: {
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
},
```

**Warning signs:** Test crashes with TypeError on `Stack.Protected` or silent mock failures where `SplashScreen.hideAsync` is not tracked.

### Pitfall 2: AuthContext.test.tsx breaking on login() interface change

**What goes wrong:** Four existing test assertions in `AuthContext.test.tsx` directly test the boolean return value of `login()`. After the change to `Promise<void>`, those tests will fail or give false passes.

**Why it happens:** The return type change is a breaking interface change. Tests that do `expect(result).toBe(true)` or `expect(result).toBe(false)` need replacement patterns.

**How to avoid:** Replace boolean-return test assertions with:

- Success case: `await expect(ctxRef.current!.login(...)).resolves.toBeUndefined()` (or just assert session state changed)
- Failure case: `await expect(ctxRef.current!.login(...)).rejects.toThrow(AuthError)` or `rejects.toMatchObject({ code: 'NotAuthorizedException' })`

**Also:** `AuthContextType` interface in `AuthContext.tsx` line 13 (`login: (...) => Promise<boolean>`) must be updated to `Promise<void>`.

### Pitfall 3: login.tsx test suite asserting Alert.alert behavior

**What goes wrong:** `login.test.tsx` currently imports `Alert` from `react-native` and tests are likely to check the old `Alert.alert('Error', ...)` call on failed login. After the change, those assertions will fail.

**Current state confirmed in test file:** The test imports `Alert` at line 3 but the existing test suite does NOT currently assert on `Alert.alert` in the password step tests (they only test `mockLogin.mockResolvedValueOnce(true)` and loading state). The `Alert.alert` path for empty-password guard is not directly tested. This means the existing tests are compatible — but new tests for inline errors ARE needed.

**How to avoid:** Add new tests asserting `passwordError` state (via rendered text) rather than `Alert.alert`. The `Alert` import in `login.test.tsx` can be removed.

### Pitfall 4: Double navigation after successful login

**What goes wrong:** If `handleLogin` calls `router.replace('/(tabs)')` after `await login()` succeeds (old pattern), and `Stack.Protected` also navigates when `isAuthenticated` flips, the driver gets a double navigation which can cause a blank flash or broken back-stack.

**Why it happens:** `Stack.Protected` is reactive — it automatically navigates when `guard` prop changes. Any imperative navigation after login is redundant and conflicts.

**How to avoid:** `handleLogin` does NOT call `router.replace` or `router.push` after successful auth. It sets `isLoading(false)` and returns. `Stack.Protected` handles the rest.

### Pitfall 5: `isLoading` held false during empty-password guard early return

**What goes wrong:** The empty-password check in `handleLogin` returns early before setting `isLoading(true)`, so `isLoading` stays false. This is correct — but if the `finally` block approach is used without wrapping the early return, `setIsLoading(false)` will not be called (it's never set true). Using `try/finally` cleanly handles this.

**How to avoid:** Structure `handleLogin` so the empty check returns before the `setIsLoading(true)` call, and use `try/finally` only around the async block after the guard. The code shape in Pattern 3 above demonstrates this correctly.

---

## Validation Architecture

### Test Framework

| Property           | Value                                                                         |
| ------------------ | ----------------------------------------------------------------------------- | ----------- | ------------------------ |
| Framework          | Jest (react-native preset) + @testing-library/react-native                    |
| Config file        | `apps/mobile/jest.config.js`                                                  |
| Quick run command  | `cd apps/mobile && node ../../node_modules/.bin/jest --testPathPattern="login | AuthContext | \_layout" --no-coverage` |
| Full suite command | `cd apps/mobile && node ../../node_modules/.bin/jest --no-coverage`           |

### Phase Requirements → Test Map

| Req ID            | Behavior                                                                                                          | Test Type | Automated Command                      | File Exists?                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------- | -------------------------------------------------------- |
| AUTH-04           | SHOW renders when `secureTextEntry=true`; HIDE renders when toggled; tapping toggles visibility                   | unit      | `jest --testPathPattern="login"`       | Needs new tests in existing `login.test.tsx`             |
| AUTH-05           | Correct inline message renders per `AuthError.code`; no `Alert.alert` called; empty-password shows inline message | unit      | `jest --testPathPattern="login"`       | Needs new tests in existing `login.test.tsx`             |
| AUTH-06           | Inputs non-editable and button disabled during `isLoading`; SHOW/HIDE toggle remains tappable                     | unit      | `jest --testPathPattern="login"`       | Needs new tests in existing `login.test.tsx`             |
| AUTH-05 (context) | `login()` throws `AuthError` on failure; resolves on success; session state updated                               | unit      | `jest --testPathPattern="AuthContext"` | Existing tests must be updated in `AuthContext.test.tsx` |
| GUARD-01          | `SplashScreen.hideAsync()` called when `isLoading` flips false; `Stack.Protected` renders authenticated screens   | unit      | `jest --testPathPattern="_layout"`     | Wave 0 gap — `_layout.tsx` has no test file              |

### Sampling Rate

- **Per task commit:** `cd apps/mobile && node ../../node_modules/.bin/jest --testPathPattern="login|AuthContext" --no-coverage`
- **Per wave merge:** `cd apps/mobile && node ../../node_modules/.bin/jest --no-coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/mobile/app/_layout.test.tsx` — covers GUARD-01 (SplashScreen + Stack.Protected behavior). No existing test file for `_layout.tsx`.
- [ ] `jest.setup.js` — extend expo-router mock with `Stack.Protected` and `SplashScreen` stubs (required before any test importing \_layout can run)

_(Existing `login.test.tsx` and `AuthContext.test.tsx` exist but require case updates — not new files)_

---

## Code Examples

### expo-router Stack.Protected (confirmed from installed types)

```typescript
// Source: node_modules/expo-router/build/views/Protected.d.ts
export type ProtectedProps = {
  guard: boolean
  children?: ReactNode
}
export declare const Protected: FunctionComponent<ProtectedProps>
```

### expo-router SplashScreen (confirmed from installed types)

```typescript
// Source: node_modules/expo-router/build/utils/splash.d.ts
export declare function hideAsync(): Promise<void>
export declare function preventAutoHideAsync(): Promise<any>
```

### Existing errorText style (reuse for passwordError)

```typescript
// Source: apps/mobile/app/(auth)/login.tsx line 246
errorText: {
  color: colors.error,
  fontSize: fontSize.medium,
  marginTop: spacing.sm,
},
```

### Existing isLoading guard pattern (replicate for password step)

```tsx
// Source: apps/mobile/app/(auth)/login.tsx line 173
editable={!isLoading}
// and button:
disabled={isLoading}
style={[styles.button, isLoading && styles.buttonDisabled]}
```

---

## Project Constraints (from CLAUDE.md)

| Directive                            | Detail                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript strict mode               | All files in monorepo use `strict: true` — `login()` return type change must be reflected in the `AuthContextType` interface      |
| No direct DB imports in app packages | Not applicable to this phase                                                                                                      |
| Testing layers                       | Unit tests in `apps/mobile` via Vitest-compatible Jest (react-native preset); existing pattern is `@testing-library/react-native` |
| Agent files                          | After completing significant work, update `dolas/agents/project/DECISIONS.md` and `PATTERNS.md`                                   |
| Polyfill placement                   | `import 'react-native-get-random-values'` must remain as the first import in `_layout.tsx` (Phase 1 decision)                     |

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/config changes within the existing React Native / Expo project. No external services, CLIs, or runtimes beyond the project's own Node/Jest toolchain are required.

---

## Sources

### Primary (HIGH confidence)

- `node_modules/expo-router/build/views/Protected.d.ts` — `Stack.Protected` props confirmed: `guard: boolean`, `children?: ReactNode`
- `node_modules/expo-router/build/utils/splash.d.ts` — `SplashScreen.preventAutoHideAsync()` and `SplashScreen.hideAsync()` confirmed
- `node_modules/expo-router/build/exports.d.ts` — `SplashScreen` namespace re-exported: `export * as SplashScreen from './views/Splash'`
- `apps/mobile/app/(auth)/login.tsx` — current implementation (lines 88-101: Alert-based password flow, line 246: errorText style)
- `apps/mobile/src/context/AuthContext.tsx` — current `login()` signature (line 13, 64-75)
- `apps/mobile/app/_layout.tsx` — current useEffect guard (lines 21-31)
- `apps/mobile/jest.setup.js` — current expo-router mock confirming Stack.Protected and SplashScreen are absent
- `apps/mobile/app/(auth)/login.test.tsx` — existing test patterns to extend
- `apps/mobile/src/context/AuthContext.test.tsx` — existing tests that break on interface change
- `.planning/phases/05-login-ux-and-auth-guard/05-CONTEXT.md` — all locked decisions
- `.planning/phases/05-login-ux-and-auth-guard/05-UI-SPEC.md` — visual contract, spacing/color/interaction details

### Secondary (MEDIUM confidence)

- None required — all critical APIs verified from installed package types

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries verified from installed package types, no new dependencies
- Architecture: HIGH — all code shapes derived from existing files + confirmed API types
- Pitfalls: HIGH — all identified pitfalls are from direct inspection of existing code and test files (not hypothetical)

**Research date:** 2026-03-28
**Valid until:** 2026-05-28 (expo-router APIs are stable; fast-moving areas: none in scope)
