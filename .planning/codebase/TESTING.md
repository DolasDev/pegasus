# Testing Patterns

**Analysis Date:** 2026-03-27

## Test Framework

**Runner:**

- Vitest 2.1.8
- Config: `vitest.config.ts` per package (multiple workspaces in root `vitest.workspace.ts`)
- Globals enabled: `true` (describe, it, expect available without imports)
- Environment:
  - `packages/domain`: node
  - `packages/api`: node (with globalSetup for Docker Postgres)
  - `packages/infra`: node, forked pool to allow esbuild spawning
  - `apps/admin`: jsdom (for React components)

**Assertion Library:**

- Vitest's built-in expect (compatible with Jest syntax)

**Run Commands:**

```bash
npm test                           # Run all tests across all packages
npm test -- packages/domain        # Run tests in one package
npm test -- --coverage             # Generate coverage report (v8 provider)
npm run typecheck                  # Type-check all packages (separate from tests)
```

## Test File Organization

**Location:**

- Domain (`packages/domain/src`): co-located with source — `{file}.test.ts` next to `{file}.ts`
- API handlers and middleware (`packages/api/src`): co-located — `{handler}.test.ts` in same directory
- API repositories (`packages/api/src/repositories`): co-located in `__tests__/` subdirectory
- Infrastructure (`packages/infra/lib/stacks`): co-located in `__tests__/` subdirectory
- Admin app (`apps/admin/src`): co-located in `__tests__/` subdirectory

**Naming:**

- `{target}.test.ts` for unit tests
- `{target}.repository.test.ts` for integration tests on repositories
- Test files are never transpiled to dist (excluded in vitest configs)

**Structure:**

```
packages/domain/
├── src/
│   ├── shared/
│   │   ├── types.ts
│   │   ├── __tests__/
│   │   │   └── types.test.ts
│   │   └── errors.ts
│   └── customer/
│       ├── index.ts
│       └── (no test file — logic in shared)

packages/api/
├── src/
│   ├── handlers/
│   │   ├── customers.ts
│   │   └── customers.test.ts
│   ├── repositories/
│   │   ├── customer.repository.ts
│   │   └── __tests__/
│   │       └── customer.repository.test.ts
│   └── middleware/
│       ├── correlation.ts
│       └── correlation.test.ts
```

## Test Structure

**Suite Organization:**

```typescript
// Test file header explains scope:
/**
 * Unit tests for the customers handler.
 *
 * All database calls are isolated via vi.mock('../repositories').
 * No database connection required.
 */

// Module mocks — declared before imports (hoisted by Vitest)
vi.mock('../repositories', () => ({
  createCustomer: vi.fn(),
  findCustomerById: vi.fn(),
  // ...
}))

// Import the module under test
import { customersHandler } from './customers'

// ─────────────────────────────────────────────────────────────
// Helpers (test utilities, builders, factories)
// ─────────────────────────────────────────────────────────────

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ─────────────────────────────────────────────────────────────
// Fixtures (test data)
// ─────────────────────────────────────────────────────────────

const mockCustomer = {
  id: 'cust-1',
  tenantId: 'test-tenant-id',
  // ... full object
}

const validCreateBody = {
  userId: 'user-1',
  firstName: 'Jane',
  // ...
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('customers handler', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('POST /', () => {
    it('returns 201 with the created customer', async () => {
      // Arrange
      vi.mocked(createCustomer).mockResolvedValue(mockCustomer as never)

      // Act
      const res = await buildApp().request('/', post(validCreateBody))

      // Assert
      expect(res.status).toBe(201)
      const body = await json(res)
      expect((body.data as JsonBody)['id']).toBe('cust-1')
    })

    it('returns 400 VALIDATION_ERROR when firstName is missing', async () => {
      const { firstName: _f, ...bodyWithout } = validCreateBody
      const res = await buildApp().request('/', post(bodyWithout))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })
  })
})
```

**Patterns:**

- Setup: `beforeEach(() => vi.clearAllMocks())` to reset mocks between tests
- Teardown: `afterEach(() => vi.restoreAllMocks())` or `afterAll(...)` for cleanup
- Fixtures: static mock objects placed before describe blocks
- Arrange-Act-Assert: organize test logic clearly (comments optional but clear)

## Mocking

**Framework:** Vitest's `vi.*` API (compatible with Jest)

**Patterns:**

### Module mocks (top-level hoisting)

```typescript
vi.mock('../repositories', () => ({
  createCustomer: vi.fn(),
  findCustomerById: vi.fn(),
  // ... all exports as vi.fn()
}))

// Then import normally
import { createCustomer, findCustomerById } from '../repositories'

// Then use vi.mocked() to set expectations
vi.mocked(createCustomer).mockResolvedValue(mockCustomer as never)
```

### Function mocks

```typescript
const fetchSpy = vi
  .spyOn(globalThis, 'fetch')
  .mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ data: 'ok' }), { status: 200 })),
  )

// Assert calls
expect(fetchSpy).toHaveBeenCalledWith('/test')

// Clean up
vi.restoreAllMocks()
```

### Multiple fetch calls

```typescript
// Use mockImplementation (not mockResolvedValue) to create a fresh Response per call
vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
  Promise.resolve(new Response(JSON.stringify({ data: 'ok' }), { status: 200 })),
)

// Each await fetch() call gets its own Response object
```

**What to Mock:**

- Repository functions in handler tests (isolated unit tests of handler logic)
- Hono context middleware in handler tests (tenantId, db, userId)
- External services (AWS SDK, Cognito, etc.)
- Global objects (fetch, crypto if needed)

**What NOT to Mock:**

- Domain logic (test it live)
- Zod validators (test validation directly)
- Hono request/response (use `app.request()` to test real serialization)
- Database operations in integration tests (use real DATABASE_URL)

## Fixtures and Factories

**Test Data:**

### Factory helpers

```typescript
function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: toAddressId('a-1'),
    line1: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postalCode: '97201',
    country: 'US',
    ...overrides,
  }
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: toCustomerId('cust-1'),
    userId: toUserId('user-1'),
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    contacts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}
```

### Static fixtures

```typescript
const mockCustomer = {
  id: 'cust-1',
  tenantId: 'test-tenant-id',
  userId: 'user-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  contacts: [
    {
      id: 'c-1',
      customerId: 'cust-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      isPrimary: true,
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
}
```

**Location:**

- Helpers and factories: defined within test file in `// ─ Helpers ─` section
- Reusable fixtures: if needed across files, place in `__tests__/fixtures.ts` (rarely done; prefer inline)
- Prisma/database fixtures: use `beforeAll()` to create real objects; `afterAll()` to clean up

## Coverage

**Requirements:** None enforced (coverage is measured but not gated)

**View Coverage:**

```bash
npm test -- --coverage              # Runs tests with coverage report
# Output to coverage/ directory in each package
# Reporters: text (console) + lcov (for CI/tools)
```

**Coverage configuration at package level:**

```typescript
// vitest.config.ts
test: {
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov'],
    reportsDirectory: './coverage',
  },
}
```

## Test Types

**Unit Tests (packages/domain, packages/api handlers, middleware):**

- Scope: Single function or module in isolation
- Mocking: Yes — all dependencies (repositories, services, context)
- Database: No — DATABASE_URL not required
- Location: Co-located with source (`.test.ts` files)
- Speed: <100ms per test
- Example: `packages/api/src/handlers/customers.test.ts`

**Integration Tests (packages/api repositories):**

- Scope: Repository function with real Postgres
- Mocking: No — calls real Prisma and database
- Database: Yes — requires DATABASE_URL
- Guarding: `describe.skipIf(!process.env['DATABASE_URL'])` — skipped without DB
- Setup: Global setup at `packages/api/vitest.global-setup.ts` starts Docker Compose if needed
- Cleanup: `afterAll()` deletes test records
- Location: `packages/api/src/repositories/__tests__/{domain}.repository.test.ts`
- Speed: 1-5s per test (DB I/O)
- Example: `packages/api/src/repositories/__tests__/customer.repository.test.ts`

**Infrastructure Tests (packages/infra CDK stacks):**

- Scope: CDK stack synthesis — verifies CloudFormation template
- Mocking: No — uses real CDK assertions
- Database: No
- Framework: Vitest + `@aws-cdk/assertions` Template API
- Patterns: `Template.fromStack()`, `template.resourceCountIs()`, `template.hasResourceProperties()`
- Location: `packages/infra/lib/stacks/__tests__/{stack-name}.test.ts`
- Example: Verifies Lambda runtime, memory, IAM permissions, API Gateway config
- Speed: <200ms per test

**Component Tests (apps/admin React components):**

- Environment: jsdom (browser-like DOM)
- Setup: `setupFiles: ['./src/__tests__/setup.ts']` in vitest.config.ts
- Framework: Vitest + @testing-library/react
- Location: `apps/admin/src/__tests__/{Component}.test.tsx`
- Deduplication: React/React-DOM aliased to root node_modules to prevent multiple instances

**E2E / Acceptance Tests (apps/e2e Playwright):**

- Scope: Full browser tests and HTTP API tests
- Framework: Playwright + @playwright/test
- Location: `apps/e2e/tests/{api,browser}/*.spec.ts`
- Config: `apps/e2e/playwright.config.ts`
- Setup: `apps/e2e/global-setup.ts` starts Docker Postgres + test fixtures
- Run: `npm run e2e` from `apps/e2e/`
- Not included in root `npm test`

## Common Patterns

**Async Testing:**

```typescript
// Using async/await (preferred)
it('creates a customer', async () => {
  vi.mocked(createCustomer).mockResolvedValue(mockCustomer as never)
  const res = await buildApp().request('/', post(validCreateBody))
  expect(res.status).toBe(201)
})

// Database integration test
it('createCustomer returns a Customer with branded ID', async () => {
  const customer = await createCustomer(testDb, testTenantId, input, primaryContact)
  expect(customer.id).toBeDefined()
})
```

**Error Testing:**

```typescript
// Testing error throws
it('throws for a negative amount', () => {
  expect(() => createMoney(-1, 'USD')).toThrow('negative')
})

// Testing error responses
it('returns 400 VALIDATION_ERROR when firstName is missing', async () => {
  const { firstName: _f, ...bodyWithout } = validCreateBody
  const res = await buildApp().request('/', post(bodyWithout))
  expect(res.status).toBe(400)
  expect((await json(res)).code).toBe('VALIDATION_ERROR')
})
```

**Skip Guards for Database Tests:**

```typescript
const hasDb = Boolean(process.env['DATABASE_URL'])

describe.skipIf(!hasDb)('CustomerRepository (integration)', () => {
  // Tests skipped if DATABASE_URL is not set
  it('creates a customer', async () => {
    const customer = await createCustomer(testDb, testTenantId, input, primaryContact)
    expect(customer.id).toBeDefined()
  })
})
```

**Global Setup for Database (packages/api/vitest.global-setup.ts):**

- Exported as `export async function setup(): Promise<void>`
- No teardown function (container left running between test runs)
- Automatically called by Vitest before any tests
- Checks for DATABASE_URL; if set, uses it directly (respects CI/external DB)
- Otherwise checks if localhost:5432 is reachable; if not, runs `docker compose up -d postgres`
- Applies pending migrations via `prisma migrate deploy`
- Warns (not throws) if Docker unavailable; DB-dependent tests skip gracefully

**Domain Tests (Property-Based Testing):**

- Examples in `packages/domain/src/shared/__tests__/properties.test.ts`
- Test invariants: `expect(() => createMoney(-1, 'USD')).toThrow()`
- Test commutativity: `expect(addMoney(a, b)).toEqual(addMoney(b, a))`
- No external dependencies; pure function testing

## Test Task Completion

**A task is complete when all test layers pass:**

1. **Unit + Integration suite (always required):**

   ```bash
   npm test
   # All Vitest tests across all packages must pass
   ```

2. **E2E suite (required if task touches API endpoints, UI behavior, or auth):**

   ```bash
   cd apps/e2e && npm run e2e
   # Create .env.test if it doesn't exist (copy from .env.test.example)
   # Global setup automatically starts Docker Postgres
   ```

3. **Skip E2E only if task is internal** (domain logic, infra config, dev tooling) and no existing E2E spec is affected.

**Never:**

- Skip, disable, or delete a failing test
- Comment out assertions
- Mark a task complete despite failures
- Use `as any`, `// @ts-ignore`, or `// eslint-disable` to suppress real errors (except in test mocks where unavoidable)

---

_Testing analysis: 2026-03-27_
