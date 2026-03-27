# Phase 4: Tenant Resolution Flow - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-27
**Phase:** 04-tenant-resolution-flow
**Mode:** discuss
**Areas discussed:** Login screen architecture, authService extension, Picker → password handoff

## Gray Areas Presented

| Area                      | Description                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Login screen architecture | Do email + password steps both live in login.tsx, or is the password step a separate screen? |
| authService extension     | Add resolveTenants/selectTenant to factory, or inline fetch calls in login.tsx?              |
| Picker → password handoff | How does selected tenantId reach the password step after picker?                             |

## Decisions Made

### Login screen architecture

| Option                                   | Selected |
| ---------------------------------------- | -------- |
| Steps in login.tsx (local state machine) | ✓        |
| Separate password screen                 | —        |

User confirmed: email + password steps both in `login.tsx` via `step: 'email' | 'password'` local state. Tenant picker is the only new screen.

### authService extension

| Option                    | Selected |
| ------------------------- | -------- |
| Yes, extend authService   | ✓        |
| Direct calls in login.tsx | —        |

User confirmed: `resolveTenants(email)` and `selectTenant(email, tenantId)` added to `createAuthService` factory. Consistent with Phase 2 pattern.

### Picker → password handoff

| Option                      | Selected |
| --------------------------- | -------- |
| Replace-nav with URL params | ✓        |
| Module-level flow store     | —        |

User confirmed: Picker calls `router.replace('/(auth)/login', { step: 'password', tenantId, tenantName, email })`. Login.tsx reads `useLocalSearchParams()` on mount to determine starting step.

## No Corrections

All recommended options were confirmed — no corrections needed.
