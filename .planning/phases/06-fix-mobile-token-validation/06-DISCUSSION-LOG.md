# Phase 6: Fix Mobile Token Validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-30
**Phase:** 06-fix-mobile-token-validation
**Mode:** discuss

## Gray Areas Presented

### Audience Fix Strategy

| Assumption / Option | Selected |
| ------------------- | -------- |
| Accept array of both client IDs (`audience: [tenantClientId, mobileClientId]`) | ✓ |
| Separate `/validate-mobile-token` endpoint | — |

### Test Coverage Scope

| Option | Selected |
| ------ | -------- |
| Targeted: mobile audience cases only (2 tests) | — |
| Full endpoint suite (all validate-token cases) | ✓ |

## Corrections / Confirmations

No corrections. Both recommended options confirmed as-is.

## Pre-Answered (from audit + prior phases)

- BREAK-01 fix: `{ token: idToken }` → `{ idToken }` — already in working tree, commit as part of phase
- Session type: add `ssoProvider: string | null` — field present in API response since Phase 2; type gap
- Env guard extension: check `mobileClientId` alongside existing vars — consistent with existing pattern
