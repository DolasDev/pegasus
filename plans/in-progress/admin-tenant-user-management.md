# Plan: Platform Admin — Tenant User Management

**Branch:** main
**Goal:** Allow platform admins to view, invite, change role, and deactivate tenant users from the admin UI, solving the bootstrap problem (first admin created wrong email) and providing ongoing oversight.

---

## Background

When a tenant is created via the admin frontend, one `TenantUser` row is created for the `adminEmail`. If that email is wrong, or if a new admin user needs to be added/removed, there is currently no way to do this from the platform admin UI. Tenant admins can manage their own roster via `/api/v1/users`, but only after they can log in.

---

## Scope

Four operations, mirroring the existing `/api/v1/users` handler but accessed by platform admins over the unscoped base Prisma client:

| Operation       | Who benefits                                         |
| --------------- | ---------------------------------------------------- |
| List users      | See current roster; diagnose login issues            |
| Invite user     | Bootstrap additional admins; fix wrong initial email |
| Update role     | Promote/demote ADMIN ↔ USER                          |
| Deactivate user | Remove access without deleting data                  |

---

## Implementation Plan

### Step 1 — API: `packages/api/src/handlers/admin/tenant-users.ts` (new file)

New Hono router mounted at `/api/admin/tenants/:tenantId/users`.

**Endpoints:**

```
GET    /api/admin/tenants/:tenantId/users
POST   /api/admin/tenants/:tenantId/users
PATCH  /api/admin/tenants/:tenantId/users/:userId
DELETE /api/admin/tenants/:tenantId/users/:userId
```

**GET /** — list all TenantUsers for the tenant (ordered by `invitedAt` desc)

- 404 if tenant not found
- Response: `{ data: TenantUserResponse[], meta: { count } }`

**POST /** — invite a new user

- Body: `{ email: string, role?: 'ADMIN' | 'USER' }` (same schema as `/api/v1/users/invite`)
- 404 if tenant not found
- 409 if email already in roster for this tenant
- Calls Cognito `AdminCreateUser` (suppressed in non-prod; idempotent on `UsernameExistsException`)
- Creates `TenantUser` with `status: 'PENDING'`
- Writes an audit log entry: `ADMIN_INVITE_TENANT_USER`
- Response: `{ data: TenantUserResponse }` (201)

**PATCH /:userId** — update role

- Body: `{ role: 'ADMIN' | 'USER' }`
- 404 if user not found in this tenant
- Response: `{ data: TenantUserResponse }` (200)
- Writes audit log: `ADMIN_UPDATE_TENANT_USER_ROLE`

**DELETE /:userId** — deactivate user

- 404 if user not found in this tenant
- 422 if already deactivated
- 422 `LAST_ADMIN` if deactivating the last active admin (same lockout guard as the tenant handler)
- Calls Cognito `AdminDisableUser` (fail-open on `UserNotFoundException` — user may never have logged in)
- Writes audit log: `ADMIN_DEACTIVATE_TENANT_USER`
- Response: `{ data: TenantUserResponse }` (200)

**Implementation notes:**

- Uses `db` (base Prisma singleton from `../../db`) — not the tenant-scoped extension
- Reuses `createUsersRepository(db as PrismaClient)` since it takes an unscoped client and `tenantId` is passed explicitly in every call
- Reuses the `getCognito()` / `provisionCognitoAdminUser` pattern from `admin/tenants.ts`; extract shared Cognito helper to `admin/cognito.ts`
- `writeAuditLog` from `./audit` for all mutating operations

### Step 2 — API: update `packages/api/src/handlers/admin/index.ts`

Mount the new router:

```ts
import { adminTenantUsersRouter } from './tenant-users'
adminRouter.route('/tenants', adminTenantsRouter)
// Nested under /tenants so the URL structure is /api/admin/tenants/:id/users
adminTenantsRouter.route('/:tenantId/users', adminTenantUsersRouter)
```

Wait — Hono nested routing: mount on `adminTenantsRouter` directly:

```ts
// In admin/tenants.ts, at the bottom:
import { adminTenantUsersRouter } from './tenant-users'
adminTenantsRouter.route('/:tenantId/users', adminTenantUsersRouter)
```

This keeps index.ts clean and co-locates tenant sub-resources.

### Step 3 — Admin API client: `apps/admin/src/api/tenant-users.ts` (new file)

Types and fetch wrappers:

```ts
export type TenantUserRole = 'ADMIN' | 'USER'
export type TenantUserStatus = 'PENDING' | 'ACTIVE' | 'DEACTIVATED'

export interface TenantUser {
  id: string
  email: string
  cognitoSub: string | null
  role: TenantUserRole
  status: TenantUserStatus
  invitedAt: string
  activatedAt: string | null
  deactivatedAt: string | null
}

export function listTenantUsers(
  tenantId: string,
): Promise<{ data: TenantUser[]; meta: { count: number } }>
export function inviteTenantUser(
  tenantId: string,
  body: { email: string; role?: TenantUserRole },
): Promise<TenantUser>
export function updateTenantUserRole(
  tenantId: string,
  userId: string,
  role: TenantUserRole,
): Promise<TenantUser>
export function deactivateTenantUser(tenantId: string, userId: string): Promise<TenantUser>
```

### Step 4 — Admin UI: `apps/admin/src/components/TenantUsersSection.tsx` (new file)

A self-contained component that takes `tenantId: string` and renders:

1. **User list table** — columns: Email, Role badge, Status badge, Invited date, Actions
2. **"Invite user" button** — opens an inline form (not a modal, to keep it simple):
   - Email input + Role select (Admin / User)
   - Submit calls `inviteTenantUser`; on success resets form and refetches list
3. **Per-row actions:**
   - Role toggle button: "Make admin" / "Make user" (calls `updateTenantUserRole`)
   - "Deactivate" button (disabled if DEACTIVATED or if it would trigger LAST_ADMIN; shows error inline)
4. **Error handling:** inline error banners per mutation, not global toast

State managed with `useQuery` / `useMutation` from TanStack Query.

### Step 5 — Admin UI: update `apps/admin/src/routes/_auth/tenants/$id.tsx`

Add a "Users" section to `TenantDetailPage` below "Status management":

```tsx
<section className="space-y-3">
  <h2 className="text-sm font-semibold text-foreground">Users</h2>
  <TenantUsersSection tenantId={id} />
</section>
```

Only rendered when `tenant.status !== 'OFFBOARDED'` (same condition as the edit button and danger zone).

### Step 6 — API handler tests: `packages/api/src/handlers/admin/tenant-users.test.ts` (new)

Unit tests, same pattern as existing handler tests (`moves.test.ts`, `customers.test.ts`, etc.).

**Mock setup:**

```ts
vi.mock('../../db', () => ({ db: mockDb })) // base Prisma singleton
vi.mock('../../repositories/users', () => ({
  createUsersRepository: vi.fn().mockReturnValue(mockRepo),
}))
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
  AdminCreateUserCommand: vi.fn((input) => input),
  AdminDisableUserCommand: vi.fn((input) => input),
}))
vi.mock('./audit', () => ({ writeAuditLog: vi.fn() }))
```

`buildApp()` seeds `adminSub` and `adminEmail` into Hono context (bypasses `adminAuthMiddleware`).

**Test cases:**

`GET /` — list users

- [ ] 200 with user list when tenant exists
- [ ] 404 NOT_FOUND when tenant does not exist

`POST /` — invite user

- [ ] 201 with new TenantUser on success
- [ ] 404 NOT_FOUND when tenant does not exist
- [ ] 409 CONFLICT when email already in roster
- [ ] 400 VALIDATION_ERROR when email is missing/invalid
- [ ] 500 COGNITO_ERROR when Cognito `AdminCreateUser` fails (non-`UsernameExistsException`)
- [ ] 201 when Cognito returns `UsernameExistsException` (idempotent — user already exists)

`PATCH /:userId` — update role

- [ ] 200 with updated user on success
- [ ] 404 NOT_FOUND when user does not exist in this tenant
- [ ] 400 VALIDATION_ERROR when role is invalid

`DELETE /:userId` — deactivate

- [ ] 200 with deactivated user on success
- [ ] 404 NOT_FOUND when user does not exist in this tenant
- [ ] 422 INVALID_STATE when user is already deactivated
- [ ] 422 LAST_ADMIN when deactivating the last active admin
- [ ] 500 INTERNAL_ERROR when Cognito `AdminDisableUser` fails (non-`UserNotFoundException`)
- [ ] 200 when Cognito returns `UserNotFoundException` (fail-open — user never logged in)

### Step 7 — UI component tests: `apps/admin/src/__tests__/TenantUsersSection.test.tsx` (new)

Uses `@testing-library/react` + `vi.mock` (same setup as existing `TenantFormDialog.test.tsx`).

**Mock setup:**

```ts
vi.mock('@/api/tenant-users', () => ({
  listTenantUsers: vi.fn(),
  inviteTenantUser: vi.fn(),
  updateTenantUserRole: vi.fn(),
  deactivateTenantUser: vi.fn(),
}))
```

Wrap renders in a minimal `QueryClientProvider` (same pattern as other admin component tests).

**Test cases:**

Rendering:

- [ ] Shows a loading state while the query is in flight
- [ ] Renders a row per user with email, role badge, and status badge
- [ ] Shows "No users" empty state when the list is empty

Invite form:

- [ ] "Invite user" button reveals the invite form
- [ ] Submit calls `inviteTenantUser` with the entered email and selected role
- [ ] Shows an inline error when `inviteTenantUser` rejects
- [ ] Hides the form and refetches the list on success

Role toggle:

- [ ] "Make admin" button calls `updateTenantUserRole` with `'ADMIN'`
- [ ] "Make user" button calls `updateTenantUserRole` with `'USER'`
- [ ] Shows an inline error when `updateTenantUserRole` rejects

Deactivate:

- [ ] "Deactivate" button calls `deactivateTenantUser` for the correct user
- [ ] Deactivate button is disabled for already-deactivated users
- [ ] Shows an inline error when `deactivateTenantUser` rejects with LAST_ADMIN

---

## Files Modified / Created

| File                                                   | Status                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `packages/api/src/handlers/admin/cognito.ts`           | New — shared Cognito helper extracted from `tenants.ts`           |
| `packages/api/src/handlers/admin/tenant-users.ts`      | New                                                               |
| `packages/api/src/handlers/admin/tenants.ts`           | Modified — extract Cognito helper; mount `adminTenantUsersRouter` |
| `packages/api/src/handlers/admin/tenant-users.test.ts` | New                                                               |
| `apps/admin/src/api/tenant-users.ts`                   | New                                                               |
| `apps/admin/src/components/TenantUsersSection.tsx`     | New                                                               |
| `apps/admin/src/routes/_auth/tenants/$id.tsx`          | Modified — add Users section                                      |
| `apps/admin/src/__tests__/TenantUsersSection.test.tsx` | New                                                               |

---

## Risks / Side Effects

- **Cognito coupling:** `AdminDisableUser` and `AdminCreateUser` are called from the new admin handler. In dev/test these are suppressed (`NODE_ENV !== 'production'`). The existing `provisionCognitoAdminUser` helper in `admin/tenants.ts` will be extracted to a shared `admin/cognito.ts` module — this is a pure refactor of existing code, no behaviour change.
- **Last-admin guard:** implemented server-side, same logic as `/api/v1/users`. No risk of bypassing — platform admins are also subject to it.
- **Audit log action strings:** four new action codes (`ADMIN_INVITE_TENANT_USER`, `ADMIN_UPDATE_TENANT_USER_ROLE`, `ADMIN_DEACTIVATE_TENANT_USER`) added to `writeAuditLog` calls. The audit table stores `action` as a plain string — no schema change needed.
- **No schema changes** — the `TenantUser` model already exists with all required fields.
- **`db` import in new handler:** must use `import { db } from '../../db'` (base Prisma), never the tenant-scoped client.

---

## Out of Scope

- Re-activating a deactivated user (out of scope — would require re-enabling in Cognito)
- Resending the invite email (Cognito handles this separately)
- Viewing audit history in the UI

---

## Checklist

- [x] Extract Cognito helper to `packages/api/src/handlers/admin/cognito.ts`
- [x] Write `packages/api/src/handlers/admin/tenant-users.test.ts` (18 cases — all failing)
- [x] Implement `packages/api/src/handlers/admin/tenant-users.ts` (make handler tests pass)
- [x] Mount router in `packages/api/src/handlers/admin/tenants.ts`
- [x] Implement `apps/admin/src/api/tenant-users.ts`
- [x] Write `apps/admin/src/__tests__/TenantUsersSection.test.tsx` (13 cases — all failing)
- [x] Implement `apps/admin/src/components/TenantUsersSection.tsx` (make component tests pass)
- [x] Update `apps/admin/src/routes/_auth/tenants/$id.tsx`
- [x] Run full test suite — all tests pass
