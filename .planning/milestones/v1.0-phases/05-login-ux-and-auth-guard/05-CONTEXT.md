# Phase 5: Login UX and Auth Guard - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The login experience is polished and production-ready: password show/hide, inline errors for all auth failures, input locking throughout the full flow, and a flash-free cold start for authenticated drivers via Stack.Protected + SplashScreen.

Deliverables:

- `apps/mobile/app/(auth)/login.tsx` — password toggle, inline password errors, input locking on password step
- `apps/mobile/src/context/AuthContext.tsx` — login() changed to throw AuthError on failure (returns void)
- `apps/mobile/app/_layout.tsx` — useEffect-based guard replaced with Stack.Protected + SplashScreen
  </domain>

<decisions>
## Implementation Decisions

### Error propagation (AUTH-05)

- **D-01:** `AuthContext.login()` is changed to throw `AuthError` on failure instead of returning `false`. Return type changes from `Promise<boolean>` to `Promise<void>`.
- **D-02:** `login.tsx` wraps the password step login call in `try/catch`. On `AuthError`, maps `error.code` to a human-readable inline message and sets `passwordError` state. No `Alert.alert` on the password step.
- **D-03:** Error messages to display inline for known codes:
  - `NotAuthorizedException` → "Incorrect password. Please try again."
  - `UserNotFoundException` → "Account not found."
  - `UserNotConfirmedException` → "Account not confirmed. Contact your company admin."
  - `LimitExceededException` → "Too many attempts. Please wait and try again."
  - Network/unknown → "Unable to connect. Check your internet and try again."

### Password show/hide toggle (AUTH-04)

- **D-04:** Toggle uses tappable text `SHOW` / `HIDE` positioned inside the right side of the password input container. Uppercase to match the existing label style (`EMAIL`, `PASSWORD`). `secureTextEntry` toggled via local `showPassword` boolean state.
- **D-05:** Toggle is a `TouchableOpacity` absolutely positioned (or row-flex inside the input wrapper). Style follows `colors.primary` for the active text, matching button text colour.

### Input locking (AUTH-06)

- **D-06:** `isLoading` already disables inputs and buttons on the email step — pattern is correct. Password step adds a `passwordError` state for empty-password validation (replaces the existing `Alert.alert` empty-check). All inputs use `editable={!isLoading}` and the submit button uses `disabled={isLoading}`.
- **D-07:** No additional shared loading state across screens is needed. The `isLoading` state in `login.tsx` is set to `true` before the first async call and `false` only after `login()` resolves or throws — this covers the full email-to-validate-token window.

### Auth guard (GUARD-01)

- **D-08:** `SplashScreen` is imported from `'expo-router'` — no separate `expo-splash-screen` package needed. `SplashScreen.preventAutoHideAsync()` is called at module level in `_layout.tsx` (outside the component).
- **D-09:** `SplashScreen.hideAsync()` is called in a `useEffect` when `isLoading` flips to `false`. Authenticated drivers see the home route immediately; unauthenticated drivers see login — no flash.
- **D-10:** The `useEffect`-based redirect (`router.replace`) and `ActivityIndicator` spinner are removed. Navigation control is handed entirely to `Stack.Protected`.
- **D-11:** `Stack.Protected` wraps the authenticated screens with `guard={isAuthenticated}`. Structure:
  ```
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
  </decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` §Authentication — AUTH-04, AUTH-05, AUTH-06, GUARD-01 (all Phase 5 success criteria)

### Roadmap

- `.planning/ROADMAP.md` §Phase 5 — Plan breakdown (05-01 toggle/errors/locking, 05-02 auth guard) and exact success criteria

### Files to modify

- `apps/mobile/app/(auth)/login.tsx` — password toggle, inline errors, input locking
- `apps/mobile/src/context/AuthContext.tsx` — login() throw-on-failure interface change
- `apps/mobile/app/_layout.tsx` — Stack.Protected + SplashScreen replacing useEffect guard

### Prior phase outputs (read before modifying)

- `apps/mobile/src/auth/types.ts` — `AuthError` class with `code: string` field (Phase 2)
- `apps/mobile/src/theme/colors.ts` — colour tokens used throughout login.tsx

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `AuthError` class (`apps/mobile/src/auth/types.ts:1`) — has `code: string` and `message`. Already thrown by `cognitoService` and `authService.authenticate`; login.tsx just needs to catch it.
- `colors.error` token — already used for `emailError` inline text in login.tsx (line 176); `passwordError` reuses the same style.
- `styles.errorText` — already defined in login.tsx StyleSheet; passwordError can reuse it directly.
- `isLoading` / `editable={!isLoading}` pattern — already applied to email step inputs and button; password step just needs the same applied to the remaining Alert.alert guard.

### Established Patterns

- `setEmailError` / inline error text below input — already in login.tsx for TENANT-04; `setPasswordError` follows the exact same pattern.
- `SplashScreen` from `'expo-router'` — confirmed present in expo-router v6 exports (`node_modules/expo-router/build/exports.d.ts`).
- `Stack.Protected` — confirmed in `node_modules/expo-router/build/layouts/withLayoutContext.d.ts` with `guard: boolean` prop.

### Integration Points

- `AuthContext.login()` return type change (`Promise<boolean>` → `Promise<void>`) — only call site is `login.tsx`; no other files call `useAuth().login()` directly.
- `Stack.Protected` replaces the `useEffect` in `RootLayoutNav` — `useSegments`, `useRouter` imports can be removed from `_layout.tsx` once the guard is gone.
- `AuthProvider` prop interface (`authService`) is unchanged — no ripple to `_layout.tsx` caller.

</code_context>

<specifics>
## Specific Ideas

- Auth guard code shape confirmed during discussion:

  ```tsx
  SplashScreen.preventAutoHideAsync() // module level

  function RootLayoutNav() {
    const { isAuthenticated, isLoading } = useAuth()
    useEffect(() => {
      if (!isLoading) SplashScreen.hideAsync()
    }, [isLoading])
    return (
      <Stack>
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="order" />
        </Stack.Protected>
        <Stack.Screen name="(auth)" />
      </Stack>
    )
  }
  ```

- Password toggle mockup confirmed: `SHOW`/`HIDE` text label inside right side of input, uppercase.
- Error mapping chosen explicitly (D-03) — planner should not invent error messages.
  </specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

### Reviewed Todos (not folded)

None.
</deferred>

---

_Phase: 05-login-ux-and-auth-guard_
_Context gathered: 2026-03-28_
