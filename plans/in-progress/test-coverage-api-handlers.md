# Plan: API handler unit tests (customers, moves, quotes, billing, inventory)

**Branch:** main
**Goal:** Add isolated Hono handler tests for all five untested business handlers.

## Context

Six handler files in `packages/api/src/handlers/` have zero tests. `sso.test.ts` is the
existing reference for the pattern. `users.ts` is tracked separately (see
`test-coverage-users-handler.md`) because of its Cognito + RBAC complexity.

Untested handlers and their routes:

| Handler        | Routes                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `customers.ts` | POST /, GET /, GET /:id, PUT /:id, DELETE /:id, POST /:id/contacts, GET /:customerId/quotes       |
| `moves.ts`     | POST /, GET /, GET /:id, PUT /:id/status, POST /:id/crew, POST /:id/vehicles, GET /:moveId/quotes |
| `quotes.ts`    | POST /, GET /, GET /:id, POST /:id/line-items, POST /:id/finalize                                 |
| `billing.ts`   | POST /, GET /, GET /:id, POST /:id/payments                                                       |
| `inventory.ts` | POST /:moveId/rooms, GET /:moveId/inventory, POST /:moveId/rooms/:roomId/items                    |

## Pattern (from `sso.test.ts`)

```ts
// 1. Build a minimal Hono app that seeds context variables
function buildApp(role = 'tenant_user') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', mockDb as unknown as PrismaClient)
    if (role !== null) c.set('role', role)
    await next()
  })
  app.route('/', theHandler)
  return app
}

// 2. Mock repositories at module level
vi.mock('../repositories', () => ({
  createCustomer: vi.fn(),
  // ...
}))

// 3. Mock domain functions selectively (keep real logic, override where needed)
vi.mock('@pegasus/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pegasus/domain')>()
  return { ...actual, hasPrimaryContact: vi.fn() }
})

// 4. beforeEach(() => vi.clearAllMocks())
```

## Checklist

### 2a — customers

- [ ] Create `packages/api/src/handlers/customers.test.ts`
  - [ ] Mock `'../repositories'`: `createCustomer`, `findCustomerById`, `listCustomers`,
        `updateCustomer`, `deleteCustomer`, `createContact`, `listQuotesByCustomerId`
  - [ ] Mock `'@pegasus/domain'` (partial): `hasPrimaryContact`
  - [ ] POST / — 201 created; 400 VALIDATION_ERROR (missing firstName); 500 DB error
  - [ ] GET / — 200 list; 500 DB error
  - [ ] GET /:id — 200 found; 404 NOT_FOUND; 500 DB error
  - [ ] PUT /:id — 200 updated; 404 NOT_FOUND; 400 VALIDATION_ERROR (bad email); 500 DB error
  - [ ] DELETE /:id — 204 deleted; 404 NOT_FOUND; 500 DB error
  - [ ] POST /:id/contacts — 201 created; 404 (customer not found); 400 VALIDATION_ERROR
  - [ ] GET /:customerId/quotes — 200 list; 404 customer not found; 422 INVALID_STATE (hasPrimaryContact=false)

### 2b — moves

- [ ] Create `packages/api/src/handlers/moves.test.ts`
  - [ ] Mock `'../repositories'`: `createMove`, `findMoveById`, `listMoves`,
        `updateMoveStatus`, `assignCrewMember`, `assignVehicle`, `listQuotesByMoveId`
  - [ ] Mock `'@pegasus/domain'` (partial): `canDispatch`, `canTransition`
  - [ ] POST / — 201 created; 400 VALIDATION_ERROR (missing scheduledDate); 500 DB error
  - [ ] GET / — 200 list; 500 DB error
  - [ ] GET /:id — 200 found; 404 NOT_FOUND; 500 DB error
  - [ ] PUT /:id/status — 200 updated; 404 move not found; 422 INVALID_STATE (canTransition=false); 422 PRECONDITION_FAILED (canDispatch=false when status=IN_PROGRESS)
  - [ ] POST /:id/crew — 200 success; 404 (assignCrewMember returns null)
  - [ ] POST /:id/vehicles — 200 success; 404 NOT_FOUND
  - [ ] GET /:moveId/quotes — 200 list; 404 move not found

### 2c — quotes

- [ ] Create `packages/api/src/handlers/quotes.test.ts`
  - [ ] Mock `'../repositories'`: `createQuote`, `findQuoteById`, `listQuotes`,
        `addLineItem`, `finalizeQuote`
  - [ ] Mock `'@pegasus/domain'` (partial): `canFinalizeQuote`
  - [ ] POST / — 201 created; 400 VALIDATION_ERROR; 500 DB error
  - [ ] GET / — 200 list
  - [ ] GET /:id — 200 found; 404 NOT_FOUND
  - [ ] POST /:id/line-items — 201 created; 404 quote not found; 422 INVALID_STATE (quote not DRAFT); 400 VALIDATION_ERROR
  - [ ] POST /:id/finalize — 200 finalized; 404; 422 INVALID_STATE (not DRAFT); 422 (canFinalizeQuote=false)

### 2d — billing

- [ ] Create `packages/api/src/handlers/billing.test.ts`
  - [ ] Mock `'../repositories'`: `findMoveById`, `findAcceptedQuoteByMoveId`,
        `findInvoiceByMoveId`, `findInvoiceById`, `listInvoices`, `createInvoice`, `recordPayment`
  - [ ] Mock `'@pegasus/domain'` (partial): `calculateInvoiceBalance`
  - [ ] POST / — 404 move not found; 409 CONFLICT (invoice exists); 422 PRECONDITION_FAILED (no accepted quote); 201 created (balance in response)
  - [ ] GET / — 200 list
  - [ ] GET /:id — 200 found with balance; 404 NOT_FOUND
  - [ ] POST /:id/payments — 201 with updated balance; 404 invoice not found; 400 VALIDATION_ERROR

### 2e — inventory

- [ ] Create `packages/api/src/handlers/inventory.test.ts`
  - [ ] Mock `'../repositories'`: `findMoveById`, `createRoom`, `findRoomById`,
        `listRoomsByMoveId`, `addItem`
  - [ ] Mock `'@pegasus/domain'` (partial): `roomTotalValue`
  - [ ] POST /:moveId/rooms — 201 created; 404 move not found; 400 VALIDATION_ERROR
  - [ ] GET /:moveId/inventory — 200 list with totalValue on each room; 404 move not found
  - [ ] POST /:moveId/rooms/:roomId/items — 201 created; 404 move not found; 404 room not found; 400 VALIDATION_ERROR

- [ ] Run `node node_modules/.bin/turbo run test --filter=@pegasus/api`

## Files created

- `packages/api/src/handlers/customers.test.ts`
- `packages/api/src/handlers/moves.test.ts`
- `packages/api/src/handlers/quotes.test.ts`
- `packages/api/src/handlers/billing.test.ts`
- `packages/api/src/handlers/inventory.test.ts`

## Side effects / risks

- `calculateInvoiceBalance` is called inline on the response object. The mock should return a
  `Money` value so the spread doesn't fail.
- `canDispatch` and `canTransition` are called with real arguments — mock returns control the
  branch taken, not the function inputs.
- No production code changes required.

## Verification

```bash
node node_modules/.bin/turbo run test --filter=@pegasus/api
```
