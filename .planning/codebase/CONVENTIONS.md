# Coding Conventions

**Analysis Date:** 2026-03-27

## Naming Patterns

**Files:**

- Handler files: `{domain}.ts` (e.g., `customers.ts`, `moves.ts`)
- Repository files: `{domain}.repository.ts` (e.g., `customer.repository.ts`)
- Repository index: `index.ts` barrel re-exporting all functions
- Test files: `{target}.test.ts` (e.g., `customers.test.ts`, `customer.repository.test.ts`)
- Middleware: `{name}.ts` (e.g., `correlation.ts`, `tenant.ts`)
- Domain types: `index.ts` per bounded context (e.g., `packages/domain/src/customer/index.ts`)
- Shared utilities: `{name}.ts` in appropriate context or `lib/` (e.g., `logger.ts`, `env.ts`)

**Functions:**

- camelCase: standard for all function names
- Prefixes describe operation: `create*`, `find*`, `list*`, `update*`, `delete*`
- Repository functions: `{verb}{Entity}` (e.g., `createCustomer`, `findCustomerById`, `listCustomers`)
- Middleware: `{purpose}Middleware` (e.g., `correlationMiddleware`, `tenantMiddleware`)
- Factories: `make*` prefix for test fixtures (e.g., `makeAddress()`, `makeCustomer()`)
- Validators: `validate*` (e.g., `validateAddress`)
- Mappers: `map*` (e.g., `mapCustomer`, `mapContact`)

**Variables:**

- camelCase: function locals, parameters, properties
- Types/Interfaces: PascalCase (e.g., `Customer`, `Contact`, `CreateCustomerInput`)
- Constants: camelCase (e.g., `customerInclude`, `mockCustomer`)
- Unused parameters: prefix with `_` to suppress lint (e.g., `firstName: _f`)
- `readonly` fields: used throughout domain and value objects to enforce immutability

**Types:**

- Branded types for IDs: `type CustomerId = Brand<string, 'CustomerId'>` with corresponding `toCustomerId()` cast function
- Zod schemas: PascalCase ending in `Body` or `Schema` (e.g., `CreateCustomerBody`, `UpdateCustomerBody`)
- Prisma query shapes: `RawCustomer` for Prisma response types before mapping
- Type imports: always use `import type { ... }` (enforced by ESLint)
- Inline type imports: `import type { Customer }` preferred over separate `import type` statement

## Code Style

**Formatting:**

- **Tool:** Prettier 3.3.3
- **Key settings:**
  - `semi: false` — no semicolons
  - `singleQuote: true` — 'strings' not "strings"
  - `trailingComma: "all"` — trailing commas on multiline structures
  - `printWidth: 100` — 100 char line width
  - `tabWidth: 2` — 2 spaces per indent
  - `arrowParens: "always"` — `(x) => x` not `x => x`

**Linting:**

- **Tool:** ESLint 8.57.1 + @typescript-eslint/eslint-plugin
- **Key rules enforced:**
  - `@typescript-eslint/no-explicit-any: error` — forbid `any` type
  - `@typescript-eslint/consistent-type-imports: error` — enforce `import type` syntax
  - `@typescript-eslint/no-unused-vars: ['error', { argsIgnorePattern: '^_' }]` — flag unused vars unless prefixed with `_`

## Import Organization

**Order:**

1. Standard library imports (`import fs from 'node:fs'`)
2. Third-party imports (Hono, Zod, Prisma, etc.)
3. Type imports from third-party (on same line or separate `import type` statement)
4. Relative imports (`../repositories`, `./types`)
5. Barrel imports (`@pegasus/domain`)

**Path Aliases:**

- `@pegasus/domain` — resolves to `packages/domain/src/index.ts` (configured in package-level vitest.config.ts)
- `@/` — resolves to `src/` in frontend apps (apps/admin, packages/web)
- Root tsconfig.base.json uses `"moduleResolution": "Node"`; no custom path aliases at root level

## Error Handling

**Patterns:**

- Domain layer: throw `DomainError` for business-rule violations (defined at `packages/domain/src/shared/errors.ts`)
- API layer: catch exceptions in handlers; log at WARN level for `DomainError`, ERROR for unexpected failures
- Prisma/DB errors: caught and returned as 500 `INTERNAL_ERROR` responses with sanitised message
- Validation errors: caught in Zod safeParse; returned as 400 with code `VALIDATION_ERROR`
- Not found: return 404 with code `NOT_FOUND` (no exception thrown)

**Error Response Shape:**

```typescript
// Success:
{ data: T, meta?: { count, total, limit, offset } }

// Error:
{ error: string, code: string }  // e.g. VALIDATION_ERROR, NOT_FOUND, INTERNAL_ERROR
```

## Logging

**Framework:** @aws-lambda-powertools/logger v2

**Patterns:**

- Singleton logger at `packages/api/src/lib/logger.ts` named `logger`
- Structured logging: `logger.info(msg, { key: value })` not `console.log`
- Correlation middleware (`packages/api/src/middleware/correlation.ts`) automatically appends `correlationId`, `method`, `path` to all logs for this request
- Each log line includes `serviceName` (e.g., 'pegasus-api'), timestamp, level, message
- Frontend fetch helpers inject `x-correlation-id` header to propagate IDs across API boundaries
- Never log sensitive data (passwords, API keys, PII); use correlationId + server logs for debugging

## Comments

**When to Comment:**

- Invariants and constraints on types/functions: use JSDoc
- Non-obvious business logic: explain why, not what
- Workarounds and temporary solutions: explain the issue and expected fix
- Section dividers: `// ───────────────────────────────────────────────────────` for visual clarity (70+ dashes)

**JSDoc/TSDoc:**

- Functions: `/** Brief description. @throws {Error} when ... */`
- Interfaces: `/** Multi-line description with @invariant constraints. */`
- Immutable fields: `/** Description. @readonly */`
- Example:

```typescript
/**
 * Validates an Address and returns a list of human-readable error messages.
 * An empty array means the address is valid.
 *
 * @invariant `line1`, `city`, `state`, `postalCode`, and `country` must be non-empty strings.
 */
export function validateAddress(addr: Address): readonly string[] { ... }
```

## Function Design

**Size:** Keep functions small. Large handlers are broken into helpers (e.g., handler calls `createCustomer`, which calls `hasPrimaryContact`).

**Parameters:**

- Input types are named (e.g., `CreateCustomerInput`, `CreateContactInput`)
- Required context passed explicitly (e.g., `db: PrismaClient`, `tenantId: string`)
- No implicit context unless it's the Hono `Context` object

**Return Values:**

- Domain functions return the entity type directly (e.g., `Customer`)
- Repository functions return domain types after mapping from Prisma
- Handlers return via Hono response methods (`c.json()`)
- Async functions return `Promise<T>`
- Nullable results: return `T | null` not `T | undefined` (except for optional object fields)

**Error propagation:** Errors are thrown (not returned as `Result<T>`). Hono's `app.onError` handler catches and formats them.

## Module Design

**Exports:**

- Domain bounded contexts export both types and functions via barrel `index.ts` at `packages/domain/src/{context}/index.ts`
- Repositories export functions only (no classes); collected via barrel at `packages/api/src/repositories/index.ts`
- Handlers export a Hono router instance (e.g., `export const customersHandler = new Hono<AppEnv>()`)
- Each module has a clear responsibility; no god objects

**Barrel Files:**

- `packages/domain/src/index.ts` — re-exports all types and functions from all contexts
- `packages/api/src/repositories/index.ts` — re-exports all repository functions
- Used to simplify imports at call sites: `import { Customer, createCustomer } from '@pegasus/domain'`

## TypeScript Strict Mode

**Configuration at `tsconfig.base.json`:**

- `"strict": true` — enables all strict checks
- `"exactOptionalPropertyTypes": true` — `field?: T` means the property may be absent, not that it's `T | undefined`
- `"noUncheckedIndexedAccess": true` — indexed access on objects requires null checks
- `"noImplicitOverride": true` — virtual methods must explicitly declare `override` keyword
- Target: ES2022, module CommonJS

**Impact on code:**

- Nullable values must be explicit: `{ id: string } | null` not `{ id?: string }`
- Optional object properties use spread pattern: `...(field != null ? { field } : {})`
- No `as any`, `// @ts-ignore`, or `// eslint-disable` except for test mocks (where they're unavoidable)

## Async/Await

- Preferred over `.then()` chains
- Functions using `await` must be `async`
- Exceptions from `await` propagate and are caught at handler/middleware level

## Testing Comments

- Test files include a comment block explaining the test scope (unit vs integration)
- Fixtures and helpers are grouped in a `// ─── Helpers ─────────────────` section
- Test cases are grouped by describe blocks with clear names: `describe('customers handler')`
- No snapshots unless essential (CDK constructs use Template assertions instead)

---

_Convention analysis: 2026-03-27_
