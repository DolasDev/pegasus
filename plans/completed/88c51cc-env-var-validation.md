# Environment Variable Validation

**Branch:** `feature/env-var-validation`
**Goal:** Add Zod-based env var validation with fail-fast startup so missing config is caught immediately instead of causing silent failures.

## Context

Currently `process.env['X']` with `?? ''` fallbacks. Missing `COGNITO_JWKS_URL` causes silent auth failure at runtime. No startup validation exists.

## Implementation Checklist

### 1. Env validation module

- [x] Write test: `packages/api/src/lib/__tests__/env.test.ts`
  - Valid env passes
  - Missing required var throws with clear message
  - `SKIP_AUTH=true` relaxes Cognito requirements
  - `DATABASE_URL` always required
- [x] Create `packages/api/src/lib/env.ts`
  - Zod schema for: `DATABASE_URL`, `COGNITO_JWKS_URL`, `COGNITO_TENANT_CLIENT_ID`, `COGNITO_USER_POOL_ID`
  - `SKIP_AUTH` mode makes Cognito vars optional
  - Export validated env object and type

### 2. Wire into entry points

- [x] Modify `packages/api/src/server.ts` — call `validateEnv()` at startup
- [x] Modify `packages/api/src/lambda.ts` — call `validateEnv()` at cold start

### 3. Verify

- [x] `npm test` — all pass (12 new env tests pass; pre-existing failures in prisma-tenant-isolation.test.ts are unrelated)
- [x] `npm run typecheck` — no new type errors in modified files
- [x] Server refuses to start when required env vars are missing

## Files

| Action | Path |
|--------|------|
| Create | `packages/api/src/lib/env.ts` |
| Create | `packages/api/src/lib/__tests__/env.test.ts` |
| Modify | `packages/api/src/server.ts` |
| Modify | `packages/api/src/lambda.ts` |

## Risks / Side Effects

- Adding startup validation could break existing deployments if env vars are missing — consider warn-only mode initially
- Must ensure test environments work with `SKIP_AUTH=true`

## Dependencies

None — can start immediately.
