# Phase 4: Tenant Resolution Flow - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

The complete email-first login flow works end-to-end: email submission triggers tenant resolution, the picker appears only when needed (multiple tenants), the driver can navigate back, and all error states produce clear inline messages.

Deliverables:

- `apps/mobile/src/auth/authService.ts` — extended with `resolveTenants(email)` and `selectTenant(email, tenantId)` methods inside the factory
- `apps/mobile/app/(auth)/tenant-picker.tsx` — new screen; list of company names, driver taps one, screen calls `select-tenant` then replace-navigates to login with password params
- `apps/mobile/app/(auth)/_layout.tsx` — registers `tenant-picker` screen in the auth Stack
- `apps/mobile/app/(auth)/login.tsx` — refactored to two-step local state machine (`step: 'email' | 'password'`), reads URL params on mount to determine starting step
- Tests for all TENANT-01 through TENANT-06 success criteria
  </domain>

<decisions>
## Implementation Decisions

### Login screen architecture

- **D-01:** The two-step flow lives entirely within `login.tsx` via local state (`step: 'email' | 'password'`). The tenant picker is the only new screen. Email and password steps are not separate routes — they are conditional renders in the same component.
- **D-02:** `login.tsx` reads `useLocalSearchParams()` on mount; if `{ step: 'password', tenantId, tenantName, email }` params are present, it initialises directly in the password step. This is how the picker hands off after a selection.
- **D-03:** Back from the password step returns to the email step (the login.tsx with email step was under the picker in the navigation stack). Back from the picker (before selecting) returns to the login.tsx email step directly (TENANT-06).

### authService extension

- **D-04:** `resolveTenants(email: string): Promise<TenantResolution[]>` is added to the `createAuthService` factory. Calls `POST /api/auth/resolve-tenants`. Returns an empty array when no tenants found (does not throw) — login.tsx shows inline error if empty (TENANT-04).
- **D-05:** `selectTenant(email: string, tenantId: string): Promise<void>` is added to the factory. Calls `POST /api/auth/select-tenant`. Throws `AuthError` on non-2xx.
- **D-06:** `AuthContext` is NOT changed in this phase — it only exposes `login(email, password, tenantId)`. The tenant resolution calls are made directly in `login.tsx` via the injected `authService` prop (or via a prop passed to login from the layout — see integration points).

### Picker → password handoff

- **D-07:** After the driver selects a tenant, `tenant-picker.tsx` calls `authService.selectTenant(email, tenantId)`, then calls `router.replace({ pathname: '/(auth)/login', params: { step: 'password', tenantId, tenantName, email } })`. No shared module-level state is needed.
- **D-08:** `login.tsx` reads `useLocalSearchParams<{ step?: string; tenantId?: string; tenantName?: string; email?: string }>()` on mount. If `step === 'password'`, it initialises with those values and renders the password step immediately.

### Auto-selection (single tenant)

- **D-09:** When `resolveTenants` returns exactly one result, `login.tsx` calls `authService.selectTenant(email, tenants[0].tenantId)` immediately (no navigation), then transitions to `step='password'` in local state. No picker screen is shown (TENANT-02).

### Error handling

- **D-10:** When `resolveTenants` returns an empty array, `login.tsx` displays an inline error text below the email input: "Email not registered with Pegasus" (TENANT-04). The driver stays on the email step; no navigation occurs.
- **D-11:** Company name (`tenantName`) is displayed as a label above the password input field so the driver can confirm the correct tenant (TENANT-05). Source: `tenants[0].tenantName` for auto-selected, or the picked tenant's name passed via URL param.

### Claude's Discretion

- Exact styling of the inline error text (follow existing `colors` theme)
- Whether to animate the step transition within `login.tsx` (slide/fade or instant swap)
- Storage key for the pending email between steps (local state is fine)
- Test file location for tenant-picker (`tenant-picker.test.tsx` co-located in `app/(auth)/`)
- How `authService` is accessed inside `login.tsx` — either passed as a prop from the auth layout or accessed via a re-export from `_layout.tsx`; planner decides based on expo-router patterns
  </decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` §Tenant Resolution — TENANT-01 through TENANT-06 (all success criteria for this phase)

### Phase 4 ROADMAP

- `.planning/ROADMAP.md` §Phase 4 — Exact plan breakdown (04-01 picker screen, 04-02 two-step flow) and acceptance conditions

### Auth service (Phase 2 output — to be extended)

- `apps/mobile/src/auth/authService.ts` — factory to extend with `resolveTenants` and `selectTenant`
- `apps/mobile/src/auth/types.ts` — `Session`, `MobileConfig`, `AuthError` types; `TenantResolution` type may need to be added here

### Web reference implementation

- `packages/web/src/auth/tenant-resolver.ts` — reference for `resolveTenantsForEmail` and `selectTenant` API call signatures and response shapes; mobile implementation mirrors this

### Files modified in Phase 4

- `apps/mobile/app/(auth)/login.tsx` — refactored to two-step state machine
- `apps/mobile/app/(auth)/_layout.tsx` — adds `tenant-picker` to Stack
- `apps/mobile/app/(auth)/tenant-picker.tsx` — new file
- `apps/mobile/src/auth/authService.ts` — extended with resolve/select methods
- `apps/mobile/src/auth/types.ts` — may need `TenantResolution` type added

### Existing patterns to match

- `apps/mobile/src/auth/authService.ts` — factory injection pattern (D-04, D-05)
- `apps/mobile/app/(auth)/login.tsx` — existing theme imports (`colors`, `spacing`, `fontSize`, etc.)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `apps/mobile/src/auth/authService.ts` — `createAuthService({ apiBaseUrl, cognitoService })` factory; Phase 4 adds `resolveTenants` and `selectTenant` closures inside this factory
- `apps/mobile/src/auth/types.ts` — `AuthError` class reused for resolve/select failures; `TenantResolution` type likely needs adding here
- `apps/mobile/src/theme/colors.ts` — re-exports from `@pegasus/theme`; login.tsx already uses `colors`, `spacing`, `fontSize`, `borderRadius`, `touchTarget`
- `apps/mobile/app/(auth)/login.tsx` — existing `KeyboardAvoidingView`, `StyleSheet`, `TextInput`, `TouchableOpacity` structure stays; restructured to step-based rendering

### Established Patterns

- **Factory injection (Phase 2):** `createAuthService({ apiBaseUrl, cognitoService })` — new methods are closures inside the factory, using `apiBaseUrl` from the outer scope
- **Error handling:** `throw new AuthError('ErrorCode', message)` — picker and login.tsx catch these and display inline
- **useLocalSearchParams:** expo-router's typed local params hook — used in `login.tsx` to detect if starting in password step

### Integration Points

- `apps/mobile/app/(auth)/_layout.tsx` — needs `<Stack.Screen name="tenant-picker" />` added (currently only has `login`)
- `apps/mobile/app/_layout.tsx` — creates `authService` and passes to `AuthProvider`; `login.tsx` needs access to authService for resolve/select calls — how this is wired is Claude's discretion (prop-drilling via layout, context, or a separate access pattern)

</code_context>

<specifics>
## Specific Ideas

- Replace-navigation from picker: `router.replace({ pathname: '/(auth)/login', params: { step: 'password', tenantId, tenantName, email } })` — exact API confirmed
- Inline error text for TENANT-04: "Email not registered with Pegasus" — exact string from REQUIREMENTS.md
- Company name display (TENANT-05): label above the password input, sourced from `tenantName` URL param (replace-nav case) or `tenants[0].tenantName` (auto-select case)
  </specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

Password show/hide toggle and inline auth errors (wrong password, account locked) are AUTH-04, AUTH-05 in Phase 5.
Auth guard flash fix (GUARD-01) is Phase 5.
</deferred>

---

_Phase: 04-tenant-resolution-flow_
_Context gathered: 2026-03-27_
