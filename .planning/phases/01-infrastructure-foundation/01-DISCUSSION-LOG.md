# Phase 1: Infrastructure Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-27
**Phase:** 01-infrastructure-foundation
**Mode:** discuss
**Areas discussed:** mobile-config response model, mobile token lifetime

## Gray Areas Presented

Two areas were identified as genuinely open; everything else was pre-determined by REQUIREMENTS.md, existing CDK patterns, or PROJECT.md.

| Area                         | Why it was open                                                                        | How resolved                                  |
| ---------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| mobile-config response model | STATE.md explicitly flagged: single shared client ID vs per-tenant mapping             | User confirmed single shared mobile client ID |
| Mobile token lifetime        | Affects driver UX (shift-based re-login frequency); multiple reasonable values existed | User chose 8h (matches standard shift)        |

## Decisions Made

### mobile-config response model

- **Question:** Single shared mobile client ID for all tenants, or per-tenant mapping?
- **User choice:** Single shared client ID
- **Rationale:** Consistent with single-pool Cognito architecture; simpler CDK and endpoint design

### Mobile token lifetime

- **Question:** How long before drivers must re-login?
- **User choice:** 8 hours (idTokenValidity + accessTokenValidity)
- **Rationale:** Matches standard shift; re-login at shift start acceptable for v1; refreshTokenValidity 30d for silent re-auth between shifts

## Pre-Locked Decisions (not discussed)

These were already determined before discussion:

- `generateSecret: false` — INFRA-02 requirement
- `ALLOW_USER_SRP_AUTH` — required by amazon-cognito-identity-js
- Polyfill as absolute first import — INFRA-01 requirement
- `npx expo install` for dependencies — INFRA-01 specification
- CDK SSM + CFN output export pattern — follows existing cognito-stack.ts
- Auth handler placement — follows existing handler structure

## Scope

No deferred ideas. Discussion stayed within phase boundaries.
