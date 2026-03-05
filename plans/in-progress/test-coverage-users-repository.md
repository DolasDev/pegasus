# Plan: Users repository integration test

**Branch:** main
**Goal:** Add `packages/api/src/repositories/__tests__/users.repository.test.ts`.

## Context

`packages/api/src/repositories/users.ts` is the only repository without an integration test.
The other five (`customer`, `quote`, `billing`, `inventory`, `move`) each have a corresponding
`__tests__/<name>.repository.test.ts` file. The pattern is consistent and well-established.

The repository exposes: `listByTenant`, `findById`, `findByEmail`, `invite`, `updateRole`,
`deactivate`, `countAdmins`.

## Pattern (from `customer.repository.test.ts`)

```ts
const hasDb = Boolean(process.env['DATABASE_URL'])

describe.skipIf(!hasDb)('UsersRepository (integration)', () => {
  let testDb: PrismaClient
  let testTenantId: string
  const createdIds: string[] = []

  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: 'test-users-repo' },
      create: { name: 'Test Tenant (Users Repo)', slug: 'test-users-repo' },
      update: {},
    })
    testTenantId = tenant.id
    testDb = createTenantDb(db, testTenantId) as unknown as PrismaClient
  })

  afterAll(async () => {
    // clean up by tenantId to catch anything not in createdIds
    await db.tenantUser.deleteMany({ where: { tenantId: testTenantId } })
    await db.$disconnect()
  })
})
```

## Checklist

- [ ] Create `packages/api/src/repositories/__tests__/users.repository.test.ts`
- [ ] Import `db` from `'../../db'`, `createTenantDb` from `'../../lib/prisma'`
- [ ] Import `createUsersRepository` from `'../users'`
- [ ] `describe.skipIf(!hasDb)` guard
- [ ] `beforeAll` — upsert test tenant, create `testDb` via `createTenantDb`
- [ ] `afterAll` — delete all rows where tenantId=testTenantId, `db.$disconnect()`

### Test scenarios

- [ ] `listByTenant` — empty initially; returns invited user after `invite`
- [ ] `invite` — creates row with status=PENDING, invitedAt set, correct email and role
- [ ] `findByEmail` — returns null for unknown email; returns row for known email
- [ ] `findById` — returns null for unknown id; returns null for id belonging to different tenant; returns row for correct (id, tenantId) pair
- [ ] `updateRole` — changes role from USER to ADMIN
- [ ] `deactivate` — sets status=DEACTIVATED and populates deactivatedAt
- [ ] `countAdmins` — returns 0 when no admins; returns 1 after inviting ADMIN; excludes DEACTIVATED admins

- [ ] Run `DATABASE_URL=<neon-dev-url> node node_modules/.bin/turbo run test --filter=@pegasus/api`
- [ ] Confirm test auto-skips when DATABASE_URL is unset

## Files created

- `packages/api/src/repositories/__tests__/users.repository.test.ts`

## Files read (reference)

- `packages/api/src/repositories/__tests__/customer.repository.test.ts`
- `packages/api/src/repositories/users.ts`
- `packages/api/src/lib/prisma.ts` (for `createTenantDb`)
- `packages/api/src/db.ts` (for `db` singleton)

## Side effects / risks

- Creates real rows in the Neon dev DB (or Docker Postgres). Cleanup in `afterAll` uses
  `deleteMany({ where: { tenantId } })` — safe because the tenant slug is unique to tests.
- Tenant upsert uses `'test-users-repo'` slug — must not collide with other test tenants
  (existing ones use `'test-customer-repo'`, `'test-quote-repo'`, etc.).

## Verification

```bash
# With DATABASE_URL set (Neon dev or Docker):
DATABASE_URL=<url> node node_modules/.bin/turbo run test --filter=@pegasus/api

# Without DATABASE_URL — integration tests must be skipped, not error:
node node_modules/.bin/turbo run test --filter=@pegasus/api
```
