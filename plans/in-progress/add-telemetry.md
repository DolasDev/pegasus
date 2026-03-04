# Plan: Add System-Wide Telemetry

**Branch:** main
**Goal:** Implement structured logging, `x-correlation-id` tracing, and standardised error handling across the full Pegasus stack — API, frontends, and infra — to make production debugging tractable without leaking internal details to clients.

---

## Scope

### `packages/api`

- [ ] Install `@aws-lambda-powertools/logger` and wire it into the Lambda entry point
- [ ] Add Hono global logging middleware: extract/generate `x-correlation-id` from each request, attach it to the logger context, and pass it through to all downstream handlers
- [ ] Replace all `console.*` calls in route handlers and services with the structured logger
- [ ] Rewrite `app.onError` to: log the full stack trace + `correlationId` server-side, return a sanitised `{ error: string, correlationId: string }` JSON payload to the client (no stack traces)
- [ ] Rewrite SSO handler (`handlers/sso.ts`) and Cognito trigger functions (`cognito/pre-token.ts`, `cognito/pre-auth.ts`) to use the structured logger

### `packages/web` & `apps/admin`

- [ ] Update API fetch clients to generate and inject `x-correlation-id` into the headers of every HTTP request
- [ ] Add `ErrorBoundary` components in both apps to catch unhandled React errors and display a user-friendly fallback

### `packages/domain`

- [ ] Introduce a `DomainError` base class for typed business-logic failures; API layer catches these and logs at `WARN` rather than `ERROR`

### `packages/infra`

- [ ] Verify Lambda and API Gateway log groups have appropriate CloudWatch retention settings; add explicit retention if missing

### Tests & Docs

- [ ] Add unit tests for the Hono logging middleware (correlation ID propagation, error sanitisation)
- [ ] Add tests for frontend fetch client (x-correlation-id header injection)
- [ ] Update `CLAUDE.md` and `PATTERNS.md` to document the logging conventions

---

## Files to Modify / Create

| File                                             | Action                                        |
| ------------------------------------------------ | --------------------------------------------- |
| `packages/api/package.json`                      | Add `@aws-lambda-powertools/logger`           |
| `packages/api/src/lambda.ts`                     | Wire logger into Lambda handler               |
| `packages/api/src/app.ts`                        | Global logging middleware + `onError` rewrite |
| `packages/api/src/handlers/*.ts`                 | Replace `console.*` with logger               |
| `packages/api/src/handlers/sso.ts`               | Structured logging                            |
| `packages/api/src/cognito/pre-token.ts`          | Structured logging                            |
| `packages/api/src/cognito/pre-auth.ts`           | Structured logging                            |
| `packages/web/src/api/client.ts` (or equivalent) | x-correlation-id injection                    |
| `packages/web/src/components/ErrorBoundary.tsx`  | Created                                       |
| `apps/admin/src/api/client.ts` (or equivalent)   | x-correlation-id injection                    |
| `apps/admin/src/components/ErrorBoundary.tsx`    | Created                                       |
| `packages/domain/src/errors.ts`                  | Created — `DomainError` base class            |
| `packages/infra/lib/stacks/api-stack.ts`         | CloudWatch log retention                      |
| `CLAUDE.md`                                      | Logging conventions                           |
| `PATTERNS.md`                                    | Logging conventions                           |

---

## Risks

- Changing the error response shape (`{ error, correlationId }`) may break any frontend code that currently pattern-matches on error strings or expects stack traces — audit before changing.
- Broad `console.*` replacement across `packages/api` will be a noisy diff; keep it functional, not stylistic.
- `DomainError` must not create circular dependencies — it lives in `packages/domain/src/shared/` with zero imports.
