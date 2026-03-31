# Phase 4: Tenant Resolution Flow - Research

**Researched:** 2026-03-27
**Domain:** React Native (Expo) — multi-step auth flow, expo-router navigation, authService factory extension
**Confidence:** HIGH

## Summary

Phase 4 implements the email-first tenant resolution flow on top of the authService factory and AuthContext that were built in Phases 2-3. The work is self-contained: two new methods added to the existing factory (`resolveTenants`, `selectTenant`), one new type (`TenantResolution`) in `types.ts`, one new screen (`tenant-picker.tsx`), and a refactored `login.tsx` that switches from a single-step to a two-step local state machine.

All upstream code (authService factory, AuthContext, jest setup, expo-router mocking patterns) is already in place and well-understood. The API endpoints (`POST /api/auth/resolve-tenants` and `POST /api/auth/select-tenant`) are already implemented in `packages/api/src/handlers/auth.ts` and return `{ data: TenantResolution[] }` / `{ data: TenantResolution }` shapes respectively.

The critical architectural decision is that `login.tsx` owns tenant resolution state locally — it does NOT go through `AuthContext.login()` for the resolve/select steps. The `authService` instance created at module scope in `apps/mobile/app/_layout.tsx` is the vehicle for passing `resolveTenants` and `selectTenant` to `login.tsx`; how exactly it is accessed (prop threading vs. a separate context) is left to the planner.

**Primary recommendation:** Prop-thread `authService` down from the auth `_layout.tsx` to `login.tsx` — the auth `_layout.tsx` already receives no props and renders children via `<Stack>`, so a React Context for auth service scoped to the `(auth)` group is the cleanest zero-coupling approach; alternatively, export the singleton directly from `apps/mobile/app/_layout.tsx` as a named export, which is simpler but creates a module coupling.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** The two-step flow lives entirely within `login.tsx` via local state (`step: 'email' | 'password'`). The tenant picker is the only new screen. Email and password steps are not separate routes — they are conditional renders in the same component.

**D-02:** `login.tsx` reads `useLocalSearchParams()` on mount; if `{ step: 'password', tenantId, tenantName, email }` params are present, it initialises directly in the password step. This is how the picker hands off after a selection.

**D-03:** Back from the password step returns to the email step (the login.tsx with email step was under the picker in the navigation stack). Back from the picker (before selecting) returns to the login.tsx email step directly (TENANT-06).

**D-04:** `resolveTenants(email: string): Promise<TenantResolution[]>` is added to the `createAuthService` factory. Calls `POST /api/auth/resolve-tenants`. Returns an empty array when no tenants found (does not throw) — login.tsx shows inline error if empty (TENANT-04).

**D-05:** `selectTenant(email: string, tenantId: string): Promise<void>` is added to the factory. Calls `POST /api/auth/select-tenant`. Throws `AuthError` on non-2xx.

**D-06:** `AuthContext` is NOT changed in this phase — it only exposes `login(email, password, tenantId)`. The tenant resolution calls are made directly in `login.tsx` via the injected `authService` prop (or via a prop passed to login from the layout — see integration points).

**D-07:** After the driver selects a tenant, `tenant-picker.tsx` calls `authService.selectTenant(email, tenantId)`, then calls `router.replace({ pathname: '/(auth)/login', params: { step: 'password', tenantId, tenantName, email } })`. No shared module-level state is needed.

**D-08:** `login.tsx` reads `useLocalSearchParams<{ step?: string; tenantId?: string; tenantName?: string; email?: string }>()` on mount. If `step === 'password'`, it initialises with those values and renders the password step immediately.

**D-09:** When `resolveTenants` returns exactly one result, `login.tsx` calls `authService.selectTenant(email, tenants[0].tenantId)` immediately (no navigation), then transitions to `step='password'` in local state. No picker screen is shown (TENANT-02).

**D-10:** When `resolveTenants` returns an empty array, `login.tsx` displays an inline error text below the email input: "Email not registered with Pegasus" (TENANT-04). The driver stays on the email step; no navigation occurs.

**D-11:** Company name (`tenantName`) is displayed as a label above the password input field so the driver can confirm the correct tenant (TENANT-05). Source: `tenants[0].tenantName` for auto-selected, or the picked tenant's name passed via URL param.

### Claude's Discretion

- Exact styling of the inline error text (follow existing `colors` theme)
- Whether to animate the step transition within `login.tsx` (slide/fade or instant swap)
- Storage key for the pending email between steps (local state is fine)
- Test file location for tenant-picker (`tenant-picker.test.tsx` co-located in `app/(auth)/`)
- How `authService` is accessed inside `login.tsx` — either passed as a prop from the auth layout or accessed via a re-export from `_layout.tsx`; planner decides based on expo-router patterns

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

Password show/hide toggle and inline auth errors (wrong password, account locked) are AUTH-04, AUTH-05 in Phase 5.
Auth guard flash fix (GUARD-01) is Phase 5.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID        | Description                                                                                                        | Research Support                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| TENANT-01 | Driver enters email and app calls `POST /api/auth/resolve-tenants`, receiving a list of tenants                    | API endpoint exists; `resolveTenants()` factory method pattern established by D-04                       |
| TENANT-02 | If exactly one tenant matches, app auto-selects it and calls `POST /api/auth/select-tenant` without showing picker | D-09 specifies exact behaviour; `selectTenant()` factory method by D-05                                  |
| TENANT-03 | If multiple tenants match, driver sees list of company names; app calls `POST /api/auth/select-tenant`             | `tenant-picker.tsx` new screen; D-07 specifies replace-nav handoff to login                              |
| TENANT-04 | No tenants → inline error "Email not registered with Pegasus" without navigating away                              | D-10 exact string; inline `<Text>` component below email input in login.tsx email step                   |
| TENANT-05 | Resolved company name displayed above password input                                                               | D-11: `tenantName` from URL param (picker path) or `tenants[0].tenantName` (auto-select path)            |
| TENANT-06 | Back from tenant picker returns to email step, resets all auth state                                               | D-03: picker navigation is `router.push` from login, so hardware back and header back both work natively |

</phase_requirements>

## Standard Stack

### Core

| Library                       | Version | Purpose                                                       | Why Standard                                 |
| ----------------------------- | ------- | ------------------------------------------------------------- | -------------------------------------------- |
| expo-router                   | ~6.0.21 | File-system routing, `useLocalSearchParams`, `useRouter`      | Already installed; all nav patterns in place |
| react-native                  | 0.81.6  | View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet | Already in use throughout login.tsx          |
| @testing-library/react-native | ^13.3.3 | Component testing with `render`, `fireEvent`, `act`           | Already in use across all auth tests         |
| jest                          | ^29.7.0 | Test runner (preset: react-native)                            | Configured in `apps/mobile/jest.config.js`   |

### Supporting

| Library           | Version | Purpose                                                        | When to Use                                       |
| ----------------- | ------- | -------------------------------------------------------------- | ------------------------------------------------- |
| @pegasus/theme    | \*      | `colors`, `spacing`, `fontSize`, `borderRadius`, `touchTarget` | All styling in new screens and modified login.tsx |
| expo-secure-store | ~15.0.8 | Already used by AuthContext                                    | Not needed in Phase 4 directly                    |

### Alternatives Considered

| Instead of                          | Could Use                 | Tradeoff                                                                                        |
| ----------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| Local state in login.tsx (D-01)     | Separate route screens    | Separate routes would complicate back-navigation and URL param passing; local state is simpler  |
| `router.replace` from picker (D-07) | `router.push` from picker | `replace` prevents picker appearing in back-stack for password step; correct behaviour per spec |

**Installation:** No new dependencies required. All needed libraries are already installed.

## Architecture Patterns

### Recommended Project Structure

```
apps/mobile/
├── app/(auth)/
│   ├── _layout.tsx          # ADD: <Stack.Screen name="tenant-picker" />
│   ├── login.tsx            # REFACTOR: two-step state machine
│   └── tenant-picker.tsx    # NEW: tenant list screen
├── src/auth/
│   ├── authService.ts       # EXTEND: resolveTenants + selectTenant
│   └── types.ts             # EXTEND: TenantResolution type
```

### Pattern 1: Factory Method Extension

**What:** New methods are closures inside the `createAuthService` factory, reusing `apiBaseUrl` from the outer scope.
**When to use:** Any new authService capability (established in Phase 2).

```typescript
// Source: apps/mobile/src/auth/authService.ts (Phase 2 pattern)
export function createAuthService({ apiBaseUrl, cognitoService }: AuthServiceDeps) {
  async function resolveTenants(email: string): Promise<TenantResolution[]> {
    const res = await fetch(`${apiBaseUrl}/api/auth/resolve-tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      throw new AuthError('ResolveTenantsFailed', `resolve-tenants returned ${res.status}`)
    }
    const body = (await res.json()) as { data: TenantResolution[] }
    return body.data
    // Returns [] when no tenants match — API always 200 for unknown email (D-04)
  }

  async function selectTenant(email: string, tenantId: string): Promise<void> {
    const res = await fetch(`${apiBaseUrl}/api/auth/select-tenant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tenantId }),
    })
    if (!res.ok) {
      throw new AuthError('SelectTenantFailed', `select-tenant returned ${res.status}`)
    }
  }

  return { fetchMobileConfig, authenticate, resolveTenants, selectTenant }
}
```

**IMPORTANT:** Per D-04, `resolveTenants` must NOT throw when the API returns an empty array — empty array is a 200 response. It only throws on actual network failures / non-2xx status codes.

**IMPORTANT:** Per D-05, `selectTenant` returns `Promise<void>` — the web reference returns `TenantResolution` but mobile does not need the return value at this step.

### Pattern 2: Two-Step Local State Machine in login.tsx

**What:** `login.tsx` holds `step: 'email' | 'password'` in local state and conditionally renders different form sections. URL params detected on mount can force immediate password step (picker handoff path).

```typescript
// Conceptual shape — planner determines exact implementation
type LoginStep = 'email' | 'password'

interface LoginState {
  step: LoginStep
  email: string
  tenantId: string
  tenantName: string
  isLoading: boolean
  emailError: string | null
}

// Mount: check for params from picker handoff (D-08)
const params = useLocalSearchParams<{
  step?: string
  tenantId?: string
  tenantName?: string
  email?: string
}>()

// initialise state based on params presence
```

### Pattern 3: useLocalSearchParams in Tests

**What:** The jest global setup mocks `expo-router` with `useLocalSearchParams: jest.fn(() => ({}))`. Tests override this per-describe block.

```typescript
// Source: apps/mobile/app/order/[id].test.tsx (established pattern)
import { useLocalSearchParams, useRouter } from 'expo-router'

// In beforeEach:
;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'ORD-TEST-001' })
;(useRouter as jest.Mock).mockReturnValue({
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
})
```

For Phase 4 tests, the same pattern applies with `{ step: 'password', tenantId: 'tid', tenantName: 'Acme', email: 'a@b.com' }`.

### Pattern 4: Tenant Picker Screen

**What:** A screen that receives email via `useLocalSearchParams`, lists tenant names in a scrollable list, calls `selectTenant` on tap, then `router.replace` to login with password params.

```typescript
// app/(auth)/tenant-picker.tsx — conceptual shape
import { useLocalSearchParams, useRouter } from 'expo-router'
import { FlatList, TouchableOpacity, Text } from 'react-native'

export default function TenantPickerScreen() {
  const { email, tenantsJson } = useLocalSearchParams<{
    email: string
    tenantsJson: string
  }>()
  // Parse tenants from URL param OR receive as navigation state
  // ...
}
```

**Navigation to picker from login.tsx (TENANT-03):**

```typescript
router.push({
  pathname: '/(auth)/tenant-picker',
  params: { email, tenantsJson: JSON.stringify(tenants) },
})
```

**Replace-nav from picker back to login (D-07):**

```typescript
router.replace({
  pathname: '/(auth)/login',
  params: { step: 'password', tenantId, tenantName, email },
})
```

### Pattern 5: authService Access in login.tsx

**What:** `authService` is created at module scope in `apps/mobile/app/_layout.tsx`. The auth layout's `_layout.tsx` renders a `<Stack>` — it does not pass props to child screens directly via React.

**Constraint:** expo-router screen components receive URL params only, not arbitrary React props from parent layouts. The `authService` singleton cannot be prop-drilled through expo-router's file-system routing.

**Recommended approach (Claude's Discretion):** Create a minimal `AuthServiceContext` scoped to the `(auth)` group, or import the module-scope `authService` directly from `apps/mobile/app/_layout.tsx` as a named export. The named export approach is the simplest and avoids a new context:

```typescript
// apps/mobile/app/_layout.tsx — add named export
export const authService = createAuthService({ ... })
```

```typescript
// apps/mobile/app/(auth)/login.tsx — import directly
import { authService } from '../_layout'
```

This is consistent with how `createAuthService` is instantiated once and reused. The planner should pick one approach and document it.

### Anti-Patterns to Avoid

- **Do not route to separate `/email-step` and `/password-step` screens:** D-01 locks this — the entire two-step flow lives in `login.tsx`.
- **Do not store tenants in AuthContext or secure store:** Tenant list is transient resolution state, not a session. Local component state is sufficient.
- **Do not pass tenants as multiple individual URL params:** JSON-stringify them into a single `tenantsJson` param to avoid URL length issues and type complexity.
- **Do not throw from `resolveTenants` for an empty array:** The API returns 200 with `[]` for unknown emails — this is not an error condition (D-04).
- **Do not use Alert.alert for TENANT-04 error:** The existing login.tsx uses Alert for empty field validation; Phase 4 replaces this with inline text (login.tsx will be refactored). The TENANT-04 error must be inline `<Text>` below the email input.

## Don't Hand-Roll

| Problem                | Don't Build                                   | Use Instead                                     | Why                                            |
| ---------------------- | --------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Typed URL params       | Manual URLSearchParams parsing                | `useLocalSearchParams<T>()`                     | Type-safe, already mocked in jest setup        |
| Navigation with params | Manual router state management                | `router.push({ pathname, params })`             | Expo-router handles serialisation              |
| Tenant list rendering  | Custom scroll view with manual touch handling | `FlatList` or `ScrollView` + `TouchableOpacity` | Handles recycling, accessibility, Android back |

**Key insight:** The expo-router patterns for typed params and navigation are already established in `apps/mobile/app/order/[id].tsx` and its test — the planner should copy these patterns exactly.

## Common Pitfalls

### Pitfall 1: URL Params Are Always Strings

**What goes wrong:** `useLocalSearchParams` returns all params as `string | string[]`, never as objects or numbers. Attempting to use a param directly as a typed object fails.
**Why it happens:** expo-router serialises everything through the URL string.
**How to avoid:** Stringify complex data before navigation (`JSON.stringify(tenants)`) and parse after (`JSON.parse(tenantsJson as string) as TenantResolution[]`).
**Warning signs:** TypeScript errors about `string` not assignable to `TenantResolution[]`.

### Pitfall 2: useLocalSearchParams Returns Empty Object Until Params Are Set

**What goes wrong:** When `login.tsx` is navigated to without params (initial email-step start), `useLocalSearchParams()` returns `{}` — all fields are `undefined`. Destructuring without defaults crashes.
**Why it happens:** Params are optional — login.tsx is used both as the initial entry point and as the post-picker target.
**How to avoid:** Always use optional chaining or default values: `const { step, tenantId, tenantName, email } = params` then check `step === 'password'` before using the others.
**Warning signs:** Runtime errors accessing `.length` or `.toLowerCase()` on `undefined`.

### Pitfall 3: router.replace vs router.push for Picker Handoff

**What goes wrong:** Using `router.push` from the picker to login (password step) means the back button from password step goes to the picker, not the email step. This violates D-03.
**Why it happens:** `push` adds to the navigation stack; `replace` replaces the current entry.
**How to avoid:** Always use `router.replace({ pathname: '/(auth)/login', params: {...} })` from tenant-picker (D-07).
**Warning signs:** Tapping back from password step shows the picker again instead of the email step.

### Pitfall 4: selectTenant Throwing on 403/404

**What goes wrong:** If the user is no longer an active tenant member between resolve and select, `selectTenant` throws `AuthError`. The picker does not handle this, causing an unhandled rejection.
**Why it happens:** The API returns 403 (FORBIDDEN) or 404 (NOT_FOUND) for invalid selections.
**How to avoid:** Wrap the `selectTenant` call in `tenant-picker.tsx` in a try/catch that sets an inline error state. Show an error message rather than crashing.
**Warning signs:** Red box errors in dev when selecting a tenant that no longer exists.

### Pitfall 5: jest.clearAllMocks() in afterEach Resets useRouter/useLocalSearchParams

**What goes wrong:** `jest.setup.js` calls `jest.clearAllMocks()` in `afterEach`, which resets mock implementations. If a test file does not re-set up `useLocalSearchParams` in `beforeEach`, subsequent tests get the default `{}` return instead of the expected params.
**Why it happens:** `clearAllMocks` resets `mockReturnValue` implementations, not just call counts.
**How to avoid:** Always set `useLocalSearchParams` and `useRouter` mock return values inside `beforeEach` in each test file, not at module scope.
**Warning signs:** Second or later tests in a file fail with unexpected `undefined` params.

### Pitfall 6: Missing `tenantsJson` in jest.config.js transformIgnorePatterns

**What goes wrong:** New screen files in `app/(auth)/` that import from expo-router may fail with transform errors if any transitively-required module is not listed in `transformIgnorePatterns`.
**Why it happens:** The jest preset does not transform ESM modules in `node_modules` by default.
**How to avoid:** The existing `transformIgnorePatterns` in `jest.config.js` already covers `expo-router` — no changes needed. Verify if any new import paths require additions.
**Warning signs:** SyntaxError about `export` keyword in test output.

## Code Examples

Verified patterns from existing codebase:

### useLocalSearchParams typed access (from order/[id].tsx)

```typescript
// Source: apps/mobile/app/order/[id].tsx
import { useLocalSearchParams, useRouter } from 'expo-router'
const { id } = useLocalSearchParams<{ id: string }>()
```

### router.replace with params (D-07 confirmed pattern)

```typescript
// Source: apps/mobile/app/_layout.tsx (router.replace usage established)
router.replace('/(auth)/login')
// Extended form with params (D-07):
router.replace({
  pathname: '/(auth)/login',
  params: { step: 'password', tenantId, tenantName, email },
})
```

### Mocking useLocalSearchParams in tests

```typescript
// Source: apps/mobile/app/order/[id].test.tsx
import { useLocalSearchParams, useRouter } from 'expo-router'
beforeEach(() => {
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'ORD-TEST-001' })
  ;(useRouter as jest.Mock).mockReturnValue({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })
})
```

### authService factory return pattern (from authService.ts)

```typescript
// Source: apps/mobile/src/auth/authService.ts
return { fetchMobileConfig, authenticate }
// Phase 4 extends to:
return { fetchMobileConfig, authenticate, resolveTenants, selectTenant }
```

### Inline error text pattern (colour usage from login.tsx StyleSheet)

```typescript
// Pattern for inline error text (mirrors existing login.tsx label style)
{emailError && (
  <Text style={styles.errorText}>{emailError}</Text>
)}
// In StyleSheet:
errorText: {
  color: colors.error,         // or colors.danger if that token exists
  fontSize: fontSize.medium,
  marginTop: spacing.sm,
},
```

Check `packages/theme/src/index.ts` for the exact error colour token name before implementing.

### API response shape for resolve-tenants

```typescript
// Source: packages/api/src/handlers/auth.ts (documented in comments)
// POST /api/auth/resolve-tenants
// Body:    { email: string }
// Success: { data: TenantResolution[] }   — always 200; [] = unknown email
// Error:   { error, code: 'VALIDATION_ERROR' }  — 400 for malformed email

// POST /api/auth/select-tenant
// Body:    { email: string, tenantId: string }
// Success: { data: TenantResolution }     — 200
// Errors:  403 FORBIDDEN, 404 NOT_FOUND, 400 VALIDATION_ERROR
```

### TenantResolution type (from web reference)

The web `TenantResolution` type includes `providers` and `cognitoAuthEnabled` which are SSO-related. For mobile, only `tenantId` and `tenantName` are needed in Phase 4. The type in `types.ts` should include all fields returned by the API but mobile code only reads what it needs:

```typescript
// Add to apps/mobile/src/auth/types.ts
export type TenantResolution = {
  tenantId: string
  tenantName: string
  cognitoAuthEnabled: boolean
  // providers omitted — not needed in Phase 4; add if Phase 5 needs SSO
}
```

## Validation Architecture

### Test Framework

| Property           | Value                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Framework          | Jest 29.7 + @testing-library/react-native 13.3                                               |
| Config file        | `apps/mobile/jest.config.js`                                                                 |
| Quick run command  | `cd apps/mobile && node ../../node_modules/.bin/jest --forceExit --testPathPattern="(auth)"` |
| Full suite command | `cd apps/mobile && node ../../node_modules/.bin/jest --forceExit`                            |

### Phase Requirements to Test Map

| Req ID    | Behaviour                                                   | Test Type        | Automated Command                             | File Exists?                                                   |
| --------- | ----------------------------------------------------------- | ---------------- | --------------------------------------------- | -------------------------------------------------------------- |
| TENANT-01 | Email submit calls resolveTenants                           | unit             | `jest --testPathPattern="authService"`        | Partial — authService.test.ts exists, needs new describe block |
| TENANT-01 | login.tsx calls resolveTenants on email submit              | unit (component) | `jest --testPathPattern="login.test"`         | Partial — login.test.tsx exists, needs new tests               |
| TENANT-02 | Single tenant: auto-select + no picker navigation           | unit (component) | `jest --testPathPattern="login.test"`         | Partial                                                        |
| TENANT-03 | Multiple tenants: picker shown; selectTenant called on pick | unit (component) | `jest --testPathPattern="tenant-picker.test"` | No — Wave 0 gap                                                |
| TENANT-04 | Empty result: inline error text visible                     | unit (component) | `jest --testPathPattern="login.test"`         | Partial                                                        |
| TENANT-05 | tenantName displayed above password input                   | unit (component) | `jest --testPathPattern="login.test"`         | Partial                                                        |
| TENANT-06 | Back from picker resets auth state                          | unit (component) | `jest --testPathPattern="tenant-picker.test"` | No — Wave 0 gap                                                |

### Sampling Rate

- **Per task commit:** `cd apps/mobile && node ../../node_modules/.bin/jest --forceExit --testPathPattern="(auth|login|tenant)"`
- **Per wave merge:** `cd apps/mobile && node ../../node_modules/.bin/jest --forceExit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/mobile/app/(auth)/tenant-picker.test.tsx` — covers TENANT-03, TENANT-06; new file needed
- [ ] `apps/mobile/src/auth/authService.test.ts` — extend existing file with `resolveTenants` and `selectTenant` describe blocks (TENANT-01, TENANT-02)
- [ ] `apps/mobile/app/(auth)/login.test.tsx` — extend existing file with two-step state machine tests (TENANT-01 through TENANT-05)

## Environment Availability

Step 2.6: This phase is purely frontend code changes with no new external tool dependencies. The API endpoints already exist. No new CLIs, runtimes, or services are required.

All required libraries are already installed (`expo-router ~6.0.21`, `react-native 0.81.6`, `@testing-library/react-native ^13.3.3`).

## Sources

### Primary (HIGH confidence)

- `apps/mobile/src/auth/authService.ts` — factory pattern and return shape
- `apps/mobile/src/auth/types.ts` — AuthError class, existing types
- `apps/mobile/app/(auth)/login.tsx` — current login screen structure and StyleSheet
- `apps/mobile/app/(auth)/_layout.tsx` — current auth Stack configuration
- `apps/mobile/app/_layout.tsx` — authService singleton creation location
- `apps/mobile/src/context/AuthContext.tsx` — AuthContext API; confirmed not changing
- `apps/mobile/jest.config.js` + `jest.setup.js` — test infrastructure, mock patterns
- `apps/mobile/app/order/[id].tsx` + `[id].test.tsx` — useLocalSearchParams + useRouter mock pattern
- `packages/api/src/handlers/auth.ts` — resolve-tenants and select-tenant API contracts
- `packages/web/src/auth/tenant-resolver.ts` — TenantResolution type shape reference

### Secondary (MEDIUM confidence)

- `apps/mobile/package.json` — confirmed expo-router ~6.0.21, jest 29.7 versions

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries verified from installed package.json; no new installs needed
- Architecture: HIGH — all patterns verified from existing source files in this repo
- API contracts: HIGH — read directly from packages/api/src/handlers/auth.ts
- Pitfalls: HIGH — derived from existing code patterns and test infrastructure
- Test patterns: HIGH — directly verified from existing test files

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable stack, no fast-moving external dependencies)
