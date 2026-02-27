# Plan: Add System-Wide Telemetry

**Current Branch:** main
**Goal:** Extend structured logging, x-correlation-id tracing, and standardized error handling across the entire Pegasus monorepo to match the SSO telemetry standards.

## Tasks

### `packages/api`

- [ ] Apply `@aws-lambda-powertools/logger` across all route handlers and services, completely replacing `console.*` calls.
- [ ] Enforce a global Hono error handler middleware to catch all unhandled exceptions:
  - [ ] Log the full stack trace and error details securely on the server including the request `correlationId`.
  - [ ] Return a sanitized JSON response (e.g., `{ error: string, correlationId: string }`) to the client without leaking internal stack traces.
- [ ] Ensure background jobs, webhooks, and asynchronous handlers also instantiate and use the structured logger.

### `packages/web` & `apps/admin`

- [ ] Update all API fetch clients (Axios/fetch/TanStack Query configuration) to guarantee an `x-correlation-id` is generated and injected into the headers of _every_ HTTP request.
- [ ] Implement global error boundaries (`ErrorBoundary.tsx`) or top-level promise rejection listeners to catch and log unhandled frontend errors.

### `packages/domain`

- [ ] Introduce strongly typed domain errors (e.g., `DomainError`) to cleanly encapsulate business logic failures. The API layer will catch these and automatically log them with lower severity (e.g., `WARN` or `INFO` for validation errors vs `ERROR` for unexpected crashes).

### `packages/infra`

- [ ] Verify AWS API Gateway and Lambda configurations ensure CloudWatch Log Groups are created with appropriate retention settings to house structured JSON logs efficiently.

### Verification

- [ ] Run `npm test --filter=api` to ensure no existing behaviour is broken.
- [ ] Add unit or integration tests for the global Hono error handler.
- [ ] Add test coverage in the frontend packages (`packages/web`, `apps/admin`) to verify `x-correlation-id` injection logic within the HTTP client.

## Files Modifying

- `packages/api/src/**/*.ts` (replacing console.log with logger)
- `packages/api/src/app.ts` (global error handler)
- `packages/web/src/api/client.ts` (or equivalent client)
- `packages/web/src/components/ErrorBoundary.tsx`
- `apps/admin/src/api/client.ts` (or equivalent client)
- `apps/admin/src/components/ErrorBoundary.tsx`
- `packages/domain/src/errors.ts` (New strongly typed errors)
- `packages/infra/lib/**/*.ts` (Verify CloudWatch retention)

## Side Effects/Risks

- Altering the error response payload globally might break frontend components that depend on specific error string matching or stack trace presence.
- Broad changes to `console.log` replacement across the entire `packages/api` might be noisy in git diffs, but is minimally risky functionally if tests pass.
- Introducing domain errors requires careful extraction into the API layer to avoid circular dependencies.

I will remain on this branch to execute the work.
