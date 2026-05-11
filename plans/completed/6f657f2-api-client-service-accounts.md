# API clients act as service-account TenantUsers (Cedar-gated)

**Branch:** TBD
**Goal:** Replace freeform `ApiClient.scopes` for tenant-scoped clients with a service-account model. Every tenant API client binds to a dedicated `TenantUser` (no Cognito identity); request-time authz runs through the existing Cedar/AVP path against that user's roles. Platform-scoped clients (`vpn:sync`) keep the current scope flow unchanged.

**Final disposition:** Move this file to `plans/in-progress/<date>-api-client-service-accounts.md` once approved.

## Background

Tenant API clients today carry an arbitrary `scopes: string[]`. The UI lets admins type any string (incl. `*`, which `hasScope` doesn't actually expand). Enforcement is `Array.includes` in `apps/api/src/lib/scopes.ts:12-33`, applied as `requireScope('orders:read')` in `apps/api/src/handlers/orders.ts` and `apps/api/src/handlers/events.ts`. Meanwhile human users go through Cedar/AVP (`apps/api/src/middleware/rbac.ts`, `apps/api/src/lib/authz.ts`, `apps/api/src/authz/actions.ts`). Two parallel authz systems for the same data is the wrong shape — it's how typo-scoped clients silently get nothing or wildcard-scoped clients get everything.

User intuition: integration calls should run in a user/permissions context. Adopt that as the rule: every tenant ApiClient resolves to a TenantUser (`isServiceAccount=true`, `cognitoSub=null`), and Cedar — the authz system already trusted for humans — gates everything. The "view-only export integration" use case becomes a `Reporting` role, not a new scope.

User has confirmed: **no data backfill** — they will delete and recreate API clients after the migration ships.

## Key existing pieces (reuse, don't duplicate)

- `TenantUser.cognitoSub` is **already nullable** (`apps/api/prisma/schema.prisma:319`). Service-account rows just need a flag.
- Cognito middleware already produces the canonical principal shape `{sub, tenantId, roleNames}` and sets `principal/userId/tenantId/db` on context (`apps/api/src/middleware/tenant.ts:127-148`). The api-client middleware will produce the _same_ shape, so downstream code (Cedar, RBAC, repositories) is untouched.
- Cedar harness (`apps/api/src/lib/authz.ts`, `apps/api/src/middleware/rbac.ts`, `apps/api/src/authz/actions.ts`, `apps/api/src/authz/cedar.schema.json`) already handles Move/Quote/Invoice and ApiClient management actions. We extend it for orders/events.
- `vpn:sync` platform path (`apps/api/src/middleware/api-client-auth.ts:114-142`, `apps/api/src/handlers/vpn-agent.ts`) stays as-is.

## Approach

### Schema (Prisma)

- `TenantUser`: add `isServiceAccount Boolean @default(false)`. Tighten the `tenantId+email` unique constraint usage by minting synthetic emails (`svc+<id>@<tenant-slug>.invalid`) for service accounts so the existing unique index keeps working without a separate name field.
- `ApiClient`: add `actsAsUserId String?` with FK to `TenantUser.id` (`onDelete: Restrict`).
- App-level invariant (enforced in handlers, not at the DB):
  - tenant-scoped client (`tenantId != null`) → `actsAsUserId` required, must reference a `TenantUser` in the same `tenantId` with `isServiceAccount=true`.
  - platform-scoped client (`tenantId == null`, `vpn:sync` only) → `actsAsUserId` null, `scopes` non-empty.
- Single Prisma migration. No data backfill (user deletes existing clients post-deploy).

### Cedar additions

- `apps/api/src/authz/cedar.schema.json`: add `Order` and `Event` resource types under the existing tenant entity hierarchy.
- `apps/api/src/authz/actions.ts`: add `ReadOrder`, `CreateOrder`, `UpdateOrder`, `DeleteOrder`, `ReadEvent`, `CreateEvent`, `DeleteEvent` (mirror current scope verbs).
- Policy files (alongside existing policies in `apps/api/src/authz/policies/`):
  - `Reporting` group → `Read*` on Move, Quote, Invoice, Order, Event.
  - `Integrations` group → `Read*`/`Create*`/`Update*` on Order and Event (matches the prior `orders:write` / `events:write` reach).
  - Existing `TenantAdmin` keeps full access (no policy change beyond the new actions).
- Validate via the existing Cedar policy tests in `apps/api/src/authz/__tests__/`.

### Auth middleware

`apps/api/src/middleware/api-client-auth.ts`:

- Load `ApiClient` row as today (`keyPrefix` lookup, timing-safe hash compare, revocation check).
- **Tenant-scoped branch:** load `TenantUser` by `actsAsUserId` (single Prisma query). Reject 403 if missing, wrong tenant, not a service account, or status != ACTIVE. Then set the same context the Cognito middleware sets: `principal: {sub: user.id, tenantId, roleNames: user.roleNames}`, `tenantId`, `userId: user.id`, `db: tenantPrisma(tenantId)`. Do **not** set `apiClient` for tenant-scoped routes — downstream code should be unable to tell which auth path supplied the principal.
- **Platform branch (vpn:sync):** unchanged — keeps the synthetic context and scope check.
- Drop `ApiClient.scopes` reads on the tenant-scoped branch entirely.

### Handlers

- `apps/api/src/handlers/orders.ts`: `requireScope('orders:read'|'orders:write')` → `requirePermission(Actions.ReadOrder | Actions.CreateOrder | …)`. Delete the local `requireScope` helper.
- `apps/api/src/handlers/events.ts`: same pattern. Delete local helper.
- `apps/api/src/handlers/vpn-agent.ts`: unchanged.
- `apps/api/src/handlers/api-clients.ts` (CRUD):
  - Create/update payloads drop `scopes`, gain `actsAsUserId`. Validate (zod) + invariant check.
  - List/get responses replace `scopes` with the resolved service-account user (id, name).
  - Permission gating already exists (`Actions.CreateApiClient` etc.), no change there.
- New endpoints (or extend `apps/api/src/handlers/users.ts`) for service-account lifecycle: create (name + roles), list (filter `isServiceAccount=true`), update roles, deactivate. Reuse existing user-management patterns; gate with new Cedar actions `CreateServiceAccount` / `ManageServiceAccount` (or reuse `CreateUser` if scope is judged equivalent — decide in implementation, default to a new action for auditability).
- Shared lib: `apps/api/src/lib/scopes.ts` stays (used by `vpn-agent.ts`). The shared `requireScope` middleware is the only remaining consumer.

### Tenant Web UI

`apps/tenant-web/src/routes/settings.developer.tsx`:

- Replace the freeform "Scopes" textarea with a service-account selector.
- Create-client form: pick existing service account _or_ "Create new service account" inline (name + role multi-select drawn from the tenant's role catalog). On submit, the API creates the user (if new), creates the ApiClient bound to it, returns the plaintext key once.
- Edit-client form: change which service account the key acts as (rare) and toggle revocation. Roles are managed via the existing user-management UI for that service account.
- List view: show service-account name + roles instead of a scope list.

(Service-account management can also live on a dedicated settings page; leaving the deeper UX call to implementation.)

### Tests

- Unit / Cedar policy: extend `apps/api/src/authz/__tests__/` — `Reporting` allows `ReadOrder`, denies `CreateOrder`; `Integrations` allows `CreateOrder`, denies `DeleteOrder`; empty `roleNames` denies all.
- Integration: rewrite `apps/api/src/handlers/api-clients.test.ts` for the new shape (no `scopes` field, `actsAsUserId` required, validation rejects non-service-account or cross-tenant users). Update `apps/api/src/middleware/__tests__/api-client-auth.test.ts` (or equivalent) to assert principal shape + Cedar pass/deny via the api-client path.
- Handler: orders/events handler tests swap `requireScope` setup for principal-with-roles setup.
- E2E: `apps/e2e/tests/api/` — full flow: create service account → assign `Reporting` → mint key → `GET /api/v1/orders` returns 200; `POST /api/v1/orders` returns 403; reassign `Integrations` → POST returns 200; revoke key → 401. Sanity check that `vpn:sync` platform path still works.

### Migration / rollout

- Single PR. Deploy migration + code together.
- After deploy, user deletes the (now-broken) existing tenant ApiClient rows manually and recreates them via the new UI. Document this step in the PR description.
- vpn:sync platform key continues working through deploy (no schema change touches it; `actsAsUserId` is nullable).

## Files to modify

- `apps/api/prisma/schema.prisma` (+ new migration)
- `apps/api/src/middleware/api-client-auth.ts`
- `apps/api/src/handlers/api-clients.ts`
- `apps/api/src/handlers/orders.ts`
- `apps/api/src/handlers/events.ts`
- `apps/api/src/handlers/users.ts` (or new `service-accounts.ts`)
- `apps/api/src/authz/actions.ts`
- `apps/api/src/authz/cedar.schema.json`
- `apps/api/src/authz/policies/*` (new policy files)
- `apps/api/src/lib/scopes.ts` (no API change; verify only `vpn-agent.ts` still imports)
- `apps/tenant-web/src/routes/settings.developer.tsx` (+ any service-account UI components)
- Tests across `apps/api/**/*.test.ts`, `apps/api/src/authz/__tests__/`, and `apps/e2e/tests/api/api-clients.spec.ts` (new or extended).

## Files to leave alone

- `apps/api/src/handlers/vpn-agent.ts`
- `apps/api/src/middleware/tenant.ts` (Cognito path is the source of truth for principal shape; api-client path conforms to it)

## Verification

1. `npm run db:migrate` from `apps/api`, then `npm test` from repo root — all unit/integration/Cedar tests pass.
2. `npm run e2e` from `apps/e2e` — new spec covers the full create-mint-call-revoke flow plus role swap.
3. Manual smoke against staging:
   - Create service account "Reporting bot" with `Reporting` role; mint key.
   - `curl -H "Authorization: Bearer vnd_…" .../api/v1/orders` → 200.
   - `curl -X POST … /api/v1/orders` → 403.
   - Revoke key → 401.
   - VPN agent (`/api/vpn/sync`) continues to work with the existing platform key.
4. Confirm the freeform-scopes textarea is gone from the tenant developer settings page and that no handler references `requireScope` outside `vpn-agent.ts`.

## Out of scope

- Cross-tenant or platform-issued service accounts.
- Resource-row-level constraints (e.g. "can read moves only in branch X"). If needed later, layer Cedar conditions on top — no schema change required.
- Migrating `vpn:sync` itself to the user-principal model. Platform integrations are a different blast radius and should be considered separately.
- Migrating `middleware/longhaul-user.ts` M2M mode (which still checks `apiClient.scopes` for `longhaul:read`) to Cedar. The middleware rewrite preserves `apiClient` on the AppEnv context for backward compat so longhaul keeps working unchanged. Tracked as a follow-up — needs a `Longhaul` resource type, `ReadLonghaul`/`WriteLonghaul` actions, and a policy update to whichever role(s) should grant it.
