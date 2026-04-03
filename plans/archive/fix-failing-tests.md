# Fix Failing Tests

Generated: 2026-04-02

## Test Run Summary

| Package             | Files                  | Tests                   | Status      |
| ------------------- | ---------------------- | ----------------------- | ----------- |
| `packages/domain`   | 7                      | 219                     | ✅ all pass |
| `packages/theme`    | 1                      | 7                       | ✅ all pass |
| `packages/api-http` | 1                      | 11                      | ✅ all pass |
| `apps/web`          | 14                     | 82                      | ✅ all pass |
| `apps/admin`        | 5                      | 26                      | ✅ all pass |
| `apps/mobile`       | 1                      | 1                       | ✅ all pass |
| `apps/api`          | 31 passing, 16 failing | 474 passing, 15 failing | ❌          |
| `packages/infra`    | 6 passing, 1 failing   | 101 passing, 16 failing | ❌          |
| `apps/longhaul`     | 2 failing              | 0 tests loaded          | ❌          |

---

## Area 1 — `apps/api`: `@pegasus/domain` module resolution (16 files, 15+ tests)

### Root cause

`apps/api/vitest.config.ts` has:

```ts
'@pegasus/domain': path.resolve(__dirname, '../domain/src/index.ts'),
```

`__dirname` is `apps/api`, so this resolves to `apps/domain/src/index.ts` — **a path that doesn't exist**.  
The domain package lives at `packages/domain/src/index.ts`.

### Affected test files

- `src/__tests__/health.test.ts` (3 tests) — imports `app.ts` which mounts `customers.ts`
- `src/__tests__/openapi.test.ts` (6 tests)
- `src/__tests__/optional-auth.test.ts` (3 tests)
- `src/__tests__/server.test.ts` (3 tests)
- `src/app.test.ts` (0 tests loaded)
- `src/handlers/billing.test.ts`
- `src/handlers/customers.test.ts`
- `src/handlers/inventory.test.ts`
- `src/handlers/moves.test.ts`
- `src/handlers/orders.test.ts`
- `src/handlers/quotes.test.ts`
- `src/repositories/__tests__/billing.repository.test.ts`
- `src/repositories/__tests__/inventory.repository.test.ts`
- `src/repositories/__tests__/move.repository.test.ts`
- `src/repositories/__tests__/quote.repository.test.ts`
- `src/repositories/__tests__/customer.repository.test.ts`

### Fix

**File:** `apps/api/vitest.config.ts`

Change the alias path from `'../domain/src/index.ts'` to `'../../packages/domain/src/index.ts'`:

```ts
resolve: {
  alias: {
    '@pegasus/domain': path.resolve(__dirname, '../../packages/domain/src/index.ts'),
  },
},
```

### Effort: trivial (one-line change)

---

## Area 2 — `packages/infra`: CDK ApiStack tests fail due to esbuild bundling (16 tests in 1 file)

### Root cause

`lib/stacks/__tests__/api-stack.test.ts` calls `synthApiStack()` which instantiates `ApiStack` containing a `NodejsFunction`. CDK's `NodejsFunction` triggers a real esbuild bundling pass during synthesis — even in tests. The bundling command (`bash -c npx --no-install esbuild ...`) fails because:

1. On WSL2 the `esbuild` binary lacks execute permission, and
2. `npx --no-install` refuses to install if not found.

The CDK `Template.fromStack()` assertion tests only need the synthesized CloudFormation template, not an actual bundle. Bundling is pure I/O noise during unit tests.

### Fix

Set `process.env.CDK_BUNDLING_STACKS = ''` before CDK synthesis. CDK reads this env var to decide which stacks to bundle; an empty string means "bundle nothing", so `NodejsFunction` skips the esbuild step and synthesises the CloudFormation template without trying to run esbuild.

Add a `setupFiles` entry to `packages/infra/vitest.config.ts`:

```ts
// packages/infra/vitest.config.ts
export default defineConfig({
  test: {
    // ...existing...
    setupFiles: ['./vitest.setup.ts'],
  },
})
```

Create `packages/infra/vitest.setup.ts`:

```ts
// Prevent CDK from attempting real esbuild bundling during template synthesis tests.
// CDK_BUNDLING_STACKS='' means "bundle no stacks" — the CloudFormation template is
// still synthesised correctly; only the asset bundling step is skipped.
process.env['CDK_BUNDLING_STACKS'] = ''
```

> **Note:** The 101 tests in the other 6 infra test files (database-stack, static-site-stack, etc.) already pass. Only `api-stack.test.ts` is affected.

### Effort: small (new 2-line file + config change)

---

## Area 3 — `apps/longhaul`: broken `@testing-library/jest-dom` import (2 files, 0 tests loaded)

### Root cause

`apps/longhaul/src/setupTests.js` contains:

```js
import '@testing-library/jest-dom/extend-expect'
```

The `/extend-expect` sub-path export was **removed in `@testing-library/jest-dom` v6.0**. Vite resolves package exports strictly and throws `Missing "./extend-expect" specifier`. Neither test file can load so zero tests run.

### Fix

**File:** `apps/longhaul/src/setupTests.js`

Change:

```js
import '@testing-library/jest-dom/extend-expect'
```

To:

```js
import '@testing-library/jest-dom'
```

### Effort: trivial (one-line change)

---

## Skipped Tests Explained

Eight `describe.skipIf(!hasDb)` blocks across the repository integration test suites:

| File                                                                | Guard    |
| ------------------------------------------------------------------- | -------- |
| `apps/api/src/lib/__tests__/prisma-tenant-isolation.test.ts`        | `!hasDb` |
| `apps/api/src/repositories/__tests__/api-client.repository.test.ts` | `!hasDb` |
| `apps/api/src/repositories/__tests__/users.repository.test.ts`      | `!hasDb` |
| `apps/api/src/repositories/__tests__/billing.repository.test.ts`    | `!hasDb` |
| `apps/api/src/repositories/__tests__/customer.repository.test.ts`   | `!hasDb` |
| `apps/api/src/repositories/__tests__/move.repository.test.ts`       | `!hasDb` |
| `apps/api/src/repositories/__tests__/inventory.repository.test.ts`  | `!hasDb` |
| `apps/api/src/repositories/__tests__/quote.repository.test.ts`      | `!hasDb` |

### Why they skip

`hasDb = Boolean(process.env.DATABASE_URL)`. These tests hit a real PostgreSQL database — they run migrations, insert seed rows, and verify round-trip persistence. Without a live DB the tests would fail with connection errors, so the guard makes them a no-op in environments without a database.

### Current status on this machine

`DATABASE_URL` **is set** in the local environment. These tests would run today if Area 1 (`@pegasus/domain` alias) is fixed. They currently fail to even load the test file, which masks the skip logic entirely.

### Eliminating the skip condition in CI

1. **Add a Postgres service to CI** (GitHub Actions `services` block or a Docker Compose step in the workflow). The `apps/e2e/global-setup.ts` already contains Docker Compose logic — a similar pattern can be extracted for unit test runs.
2. **Run `prisma migrate deploy`** before the test suite so the schema is current.
3. **Set `DATABASE_URL`** in the CI environment (already done via secrets for the E2E suite).

With those three steps the integration tests run unconditionally in CI, removing the skip guards entirely or converting them to a hard precondition check.

---

## Execution Order

1. **Area 1** — fix `apps/api/vitest.config.ts` alias (one line). This unblocks 16 test files and also unblocks the `describe.skipIf` repository tests from even loading.
2. **Area 3** — fix `apps/longhaul/src/setupTests.js` import (one line).
3. **Area 2** — add `packages/infra/vitest.setup.ts` + update `vitest.config.ts` (two files, ~5 lines total).
4. Rerun full suite: `node node_modules/.bin/turbo run test --continue` from repo root.
