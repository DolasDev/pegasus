# Plan: Add System-Wide Telemetry

**Branch:** main
**Goal:** Implement structured logging, `x-correlation-id` tracing, and standardised error handling across the full Pegasus stack — API, frontends, and infra — to make production debugging tractable without leaking internal details to clients.

---

## Scope

### `packages/api`

- [x] Install `@aws-lambda-powertools/logger` and wire it into the Lambda entry point
- [x] Add Hono global logging middleware: extract/generate `x-correlation-id` from each request, attach it to the logger context, and pass it through to all downstream handlers
- [x] Replace all `console.*` calls in route handlers and services with the structured logger
- [x] Rewrite `app.onError` to: log the full stack trace + `correlationId` server-side, return a sanitised `{ error: string, correlationId: string }` JSON payload to the client (no stack traces)
- [x] Rewrite SSO handler (`handlers/sso.ts`) and Cognito trigger functions (`cognito/pre-token.ts`, `cognito/pre-auth.ts`) to use the structured logger

### `packages/web` & `apps/admin`

- [x] Update API fetch clients to generate and inject `x-correlation-id` into the headers of every HTTP request
- [x] Add `ErrorBoundary` components in both apps to catch unhandled React errors and display a user-friendly fallback

### `packages/domain`

- [x] Introduce a `DomainError` base class for typed business-logic failures; API layer catches these and logs at `WARN` rather than `ERROR`

### `packages/infra`

- [x] Verify Lambda and API Gateway log groups have appropriate CloudWatch retention settings; add explicit retention if missing

### Tests & Docs

- [x] Add unit tests for the Hono logging middleware (correlation ID propagation, error sanitisation)
- [x] Add tests for frontend fetch client (x-correlation-id header injection)
- [x] Update `CLAUDE.md` and `PATTERNS.md` to document the logging conventions

---

## Files Modified / Created

| File                                              | Action   |
| ------------------------------------------------- | -------- |
| `packages/api/package.json`                       | Modified |
| `packages/api/src/lib/logger.ts`                  | Created  |
| `packages/api/src/app.ts`                         | Modified |
| `packages/api/src/types.ts`                       | Modified |
| `packages/api/src/middleware/correlation.ts`      | Created  |
| `packages/api/src/middleware/correlation.test.ts` | Created  |
| `packages/api/src/handlers/auth.ts`               | Modified |
| `packages/api/src/handlers/sso.ts`                | Modified |
| `packages/api/src/handlers/admin/tenants.ts`      | Modified |
| `packages/api/src/cognito/pre-token.ts`           | Modified |
| `packages/api/src/cognito/pre-auth.ts`            | Modified |
| `packages/domain/src/shared/errors.ts`            | Created  |
| `packages/domain/src/index.ts`                    | Modified |
| `packages/web/src/api/client.ts`                  | Modified |
| `packages/web/src/components/ErrorBoundary.tsx`   | Created  |
| `packages/web/src/routes/__root.tsx`              | Modified |
| `packages/web/src/__tests__/client.test.ts`       | Created  |
| `apps/admin/src/api/client.ts`                    | Modified |
| `apps/admin/src/components/ErrorBoundary.tsx`     | Created  |
| `apps/admin/src/routes/__root.tsx`                | Modified |
| `apps/admin/src/__tests__/client.test.ts`         | Created  |
| `packages/infra/lib/stacks/api-stack.ts`          | Modified |
| `PATTERNS.md`                                     | Modified |
