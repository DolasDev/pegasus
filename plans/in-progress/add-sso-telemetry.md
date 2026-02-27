# Plan: Add System-Wide Telemetry for SSO Debugging

**Current Branch:** main
**Goal:** Implement comprehensive structured logging and `x-correlation-id` tracing across the frontend to the backend API, and propagate telemetry to debug SSO issues without leaking stack traces.

## Tasks

- [ ] Add `@aws-lambda-powertools/logger` to `packages/api`
- [ ] Add Hono global logging middleware reading `x-correlation-id`
- [ ] Refactor `app.onError` to return sanitised JSON with `correlationId` and log full error stacks
- [ ] Rewrite SSO and Cognito token webhooks to use structured logger instead of console
- [ ] Update frontend fetch client (`apiFetch`) to attach correlation IDs
- [ ] Add UI Error Boundaries in `packages/web` and `apps/admin` (if applicable)
- [ ] Add tests for Hono logging middleware and frontend fetch correlation ID injection
- [ ] Update `CLAUDE.md` and `PATTERNS.md`
- [ ] Pass all tests

## Files Modifying

- `packages/api/package.json`
- `packages/api/src/app.ts`
- `packages/api/src/cognito/pre-token.ts`
- `packages/api/src/handlers/sso.ts`
- `packages/web/src/api/client.ts` (or similar)
- `packages/web/src/components/ErrorBoundary.tsx`
- `CLAUDE.md`
- `PATTERNS.md`

## Side Effects/Risks

- Changing error schema responses from `packages/api` might break specific frontend checks if they depend on stack traces or stringified text, though the Hono API seems to already prefer JSON `{ error, code }`.
- Added overhead in importing Powertools but negligible for serverless deployment constraints.

I will remain on this branch to execute the work.
