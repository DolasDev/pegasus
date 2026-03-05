# Plan: Users handler unit tests

**Branch:** main
**Goal:** Add isolated Hono handler tests for `packages/api/src/handlers/users.ts`.

## Context

`users.ts` is kept in a separate plan from the other handlers because it has three additional
layers of complexity not present in the standard handlers:

1. **RBAC middleware** — `requireRole(['tenant_admin'])` applied to all routes; must test 403
   rejection for non-admin callers.
2. **Cognito SDK** — `AdminCreateUserCommand` and `AdminDisableUserCommand` must be mocked via
   `vi.hoisted` (same pattern as `sso.test.ts`).
3. **Repository factory** — `createUsersRepository(db)` returns a plain object; the factory
   itself must be mocked to inject `vi.fn()` methods.

### Routes

| Method | Path    | Description                          |
| ------ | ------- | ------------------------------------ |
| GET    | /       | List all TenantUsers for this tenant |
| POST   | /invite | Invite a new user (Cognito + DB)     |
| PATCH  | /:id    | Update role (ADMIN ↔ USER)           |
| DELETE | /:id    | Deactivate user (Cognito + DB)       |

## Checklist

- [ ] Create `packages/api/src/handlers/users.test.ts`

### Mock setup

- [ ] `vi.hoisted` for `mockSend`
- [ ] `vi.mock('@aws-sdk/client-cognito-identity-provider', ...)` — CognitoIdentityProviderClient,
      AdminCreateUserCommand, AdminDisableUserCommand
- [ ] `vi.mock('../repositories/users', ...)` — `createUsersRepository` returns `mockRepo`
      with all methods as `vi.fn()`
- [ ] `vi.mock('../middleware/rbac', ...)` — `requireRole` returns middleware that checks
      `c.get('role')` against the allowed list; reject with 403 when not matching
- [ ] `buildApp(role = 'tenant_admin')` helper seeds context, routes to `usersHandler`
- [ ] `beforeEach(() => { vi.clearAllMocks(); mockSend.mockResolvedValue({}) })`

### GET /

- [ ] 403 when role is `'tenant_user'`
- [ ] 200 with mapped user list on success
- [ ] 500 INTERNAL_ERROR on DB error

### POST /invite

- [ ] 400 VALIDATION_ERROR — invalid email
- [ ] 409 CONFLICT — `findByEmail` returns an existing row
- [ ] 500 COGNITO_ERROR — `mockSend` throws a generic `Error` (not UsernameExistsException)
- [ ] 201 success — `mockSend` throws `{ name: 'UsernameExistsException' }` (idempotent)
- [ ] 201 success — happy path, new user created
- [ ] 409 CONFLICT — race condition: `findByEmail` returns null but `invite` throws `{ code: 'P2002' }`
- [ ] 500 INTERNAL_ERROR — `invite` throws unexpected error

### PATCH /:id

- [ ] 400 VALIDATION_ERROR — role not in enum
- [ ] 404 NOT_FOUND — `findById` returns null
- [ ] 200 updated user — `updateRole` returns updated row

### DELETE /:id

- [ ] 404 NOT_FOUND — `findById` returns null
- [ ] 422 INVALID_STATE — existing user status is `'DEACTIVATED'`
- [ ] 422 LAST_ADMIN — role=ADMIN, `countAdmins` returns 1
- [ ] 200 success — Cognito throws `{ name: 'UserNotFoundException' }` (fail-open)
- [ ] 500 INTERNAL_ERROR — Cognito throws unknown error (DB deactivate not called)
- [ ] 500 INTERNAL_ERROR — `deactivate` throws
- [ ] 200 success — happy path, user deactivated

- [ ] Run `node node_modules/.bin/turbo run test --filter=@pegasus/api`

## Files created

- `packages/api/src/handlers/users.test.ts`

## Files read (reference)

- `packages/api/src/handlers/sso.test.ts` — vi.hoisted Cognito mock pattern
- `packages/api/src/middleware/rbac.ts` — requireRole implementation to mock correctly
- `packages/api/src/handlers/users.ts` — source under test
- `packages/api/src/repositories/users.ts` — factory and TenantUserRow type

## Side effects / risks

- `requireRole` import must be mocked before the handler is loaded. Hoist the mock.
- `toResponse` in users.ts calls `.toISOString()` on Date fields — mock row must have real
  `Date` objects (not strings).
- The `logger` import in `users.ts` logs to stdout; mock or ignore as it doesn't affect assertions.

## Verification

```bash
node node_modules/.bin/turbo run test --filter=@pegasus/api
```
