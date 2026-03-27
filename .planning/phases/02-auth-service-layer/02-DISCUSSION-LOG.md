# Phase 2: Auth Service Layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-27
**Phase:** 02-auth-service-layer
**Mode:** discuss
**Areas discussed:** Module structure, AuthError shape, AuthService API config, Session type and location

## Gray Areas Presented

| Area | Description | Selected? |
|------|-------------|-----------|
| Module structure | Functions vs static class; matters for mockability | ✓ |
| AuthError shape | Class with code vs tagged union | ✓ |
| AuthService API config | How authService knows the API base URL | ✓ |
| Session type and location | Where Session type lives | ✓ |

## Decisions Made

### Module Structure

- **Question:** `cognitoService` and `authService` — functions or static class?
- **User answer:** Match the patterns already in use by the web app
- **Resolution:** Plain exported functions (web app uses this throughout `apps/admin/src/auth/cognito.ts`, `packages/web/src/auth/`)

### AuthError Shape

- **Question:** Single class with code field vs tagged union
- **User answer:** Single class with code field (matches admin pattern)
- **Resolution:** `class AuthError extends Error { code: string }` — same as `CognitoError` in admin app

### AuthService API Config

- **Question:** How does authService know the API base URL?
- **User answer:** Injected parameter → factory function
- **Follow-up:** Given ROADMAP signature `fetchMobileConfig(tenantId)` (single arg), how is the URL injected?
- **User answer:** Factory function — `createAuthService({ apiBaseUrl, cognitoService })` returns the service object
- **Resolution:** Factory pattern; app creates real instance at startup; tests inject fakes

### Session Type and Location

- **Question:** `src/types/index.ts` vs new `src/auth/` directory
- **User answer:** New `apps/mobile/src/auth/` directory
- **Resolution:** Mirror web/admin `src/auth/` structure; `types.ts` holds Session, AuthError, MobileConfig

## No Corrections Made

All decisions were first-answer selections — no revisions needed.
