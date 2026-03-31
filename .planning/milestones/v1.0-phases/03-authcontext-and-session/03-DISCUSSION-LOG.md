# Phase 3: AuthContext and Session - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-27
**Phase:** 03-authcontext-and-session
**Mode:** discuss
**Areas discussed:** Login signature, AuthContext interface, AuthService injection

## Gray Areas Presented

| Area | Options presented | User chose |
|------|-------------------|------------|
| Login signature + Phase 4 boundary | Add tenantId now / Keep login(email, password) | Add tenantId now |
| AuthContext interface shape | session: Session \| null / Keep driverEmail + add session | session: Session \| null |
| AuthService injection | Prop on AuthProvider / Module-level singleton | Prop on AuthProvider |

## Pre-locked Decisions (not discussed)

The following were locked by prior context or REQUIREMENTS.md — not presented to user:

- `expo-secure-store` for session storage (SESSION-01 — explicitly required)
- `AppState` for foreground detection (SESSION-04 — standard RN approach)
- Expired session handling: clear auth state, auth guard redirects to login (no modal)
- `authService.authenticate(email, password, tenantId)` signature (Phase 2 output, locked)

## Discussion Detail

### Login signature

User confirmed `login(email, password, tenantId)` with tenantId added now. Consequence: `login.tsx` cannot call this end-to-end in Phase 3 (no tenantId source); Phase 4 completes the UX. Phase 3 success criteria are verified via Jest tests on AuthContext with a mock authService.

### AuthContext interface

User confirmed `session: Session | null` replacing `driverName` and `driverEmail`. `settings.tsx` is updated in Phase 3 (Phase 3 removes the fields that settings depends on, so settings must be updated in the same phase).

### AuthService injection

User confirmed prop-based injection: `<AuthProvider authService={authService}>`. Consistent with Phase 2's factory pattern. Real instance created in `_layout.tsx`.
