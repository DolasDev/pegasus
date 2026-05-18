# Fix login tenant resolution — roster-only, remove email_domains

**Branch:** `main` — all changes stay on this branch; do not push until instructed.

**Goal:** Make Cognito login resolve the tenant purely from the authenticated user's `tenant_users` roster on every token issuance (including refresh), and remove the `email_domains` mechanism entirely. Also clean up how login failures are shown to the user.

## Context — why this work exists

A QA user (`steve.dolatowski@gmail.com`, invited to tenant `b40b082e` _Dolios E2E Tests_) could intermittently not log in. Cognito returned:

> Unable to continue — PreTokenGeneration failed with error Your account has not been granted access. Contact your administrator.

### Root cause (confirmed from CloudWatch + DB)

One login fires **multiple** PreTokenGeneration invocations (initial auth + token refresh + extra SPA calls). The CloudWatch burst at `2026-05-17T04:12` showed three invocations for the same email:

| Invocation | Resolution path                        | tenantId            | Result |
| ---------- | -------------------------------------- | ------------------- | ------ |
| `62b4ffea` | `Resolved tenant via AuthSession`      | `b40b082e` (Dolios) | ok     |
| `8392b16f` | no AuthSession → email-domain fallback | `4b2e0267`          | threw  |
| `36868b28` | no AuthSession → email-domain fallback | `4b2e0267`          | threw  |

Two compounding defects:

1. **`AuthSession` is single-use.** `pre-token.ts:137` deletes the session on first read. The first invocation consumes it; every later invocation in the same login (notably **token refresh**, which never has an AuthSession) falls back to email-domain matching.
2. **Email-domain matching is a fragile heuristic.** Tenant `4b2e0267` (_"AVP Smoke 2026-05-08"_, a leftover smoke-test tenant) has `email_domains = {gmail.com}`. The domain fallback for _any_ `@gmail.com` address resolves to that smoke tenant, which has no roster row for the user → `"not been granted access"`.

The Dolios tenant's domains are `{dolas.dev, pegasus-test.invalid}` — the gmail address can never be reached by domain resolution at all. The roster row is the real source of truth, and it is correct:
`tenant_users` → `tenant_id b40b082e…`, `email steve.dolatowski@gmail.com`, `status ACTIVE`, `role_names {operations_admin}`.

### Decision (made 2026-05-17) — drop `email_domains` entirely

`email_domains` exists today for tenant _resolution_ during login. It is a heuristic the roster already supersedes — pre-token (and resolve-tenants) always require a `tenant_users` row regardless, so a "domain-only tenant with no roster" can never log anyone in. Resolution will become a pure roster lookup keyed by the authenticated user.

Consequences, accepted:

- **The `email_domains` column and all related schema/UI are removed.** No migration of the values is needed — they have no remaining purpose.
- **Invites are unrestricted.** Any email may be invited to any tenant; `tenant_users` membership is the only authorization gate. This keeps cross-org / contractor invites working (the original design intent).
- **There is no "domain not allowed" failure mode** at invite time or login time. The earlier idea of blocking disallowed-domain invites is dropped along with the field.
- The `gmail.com`-on-smoke-tenant misconfiguration becomes **inert** the moment resolution stops consulting `email_domains` — no separate data fix is required.

## Done target

- Login and silent token refresh resolve the correct tenant for any user with exactly one active roster row, with or without a live `AuthSession`.
- The `email_domains` column, Prisma field, API schemas, resolution code, and admin-web UI are fully removed; `npm run typecheck` and `npm test` are clean.
- A login that genuinely cannot be authorised shows the user a clean, specific reason (no `PreTokenGeneration failed with error …` wrapper text).

## Plan

### Phase 1 — pre-token tenant resolution (`apps/api/src/cognito/pre-token.ts`)

- [ ] **Stop consuming the `AuthSession` on read.** Remove the fire-and-forget `db.authSession.deleteMany` at `pre-token.ts:137-142`. Let sessions expire naturally via the existing 10-minute `expiresAt` window so every invocation in one login burst resolves consistently.
- [ ] **Add expired-session cleanup** so rows do not accumulate: a cheap best-effort `deleteMany({ where: { expiresAt: { lt: now } } })` in the handler, or confirm an existing sweeper exists and note it here.
- [ ] **Replace the email-domain fallback** (`pre-token.ts:145-162`, Step 2) with a roster lookup for the no-AuthSession path:
  - Query `tenant_users` by case-insensitive email, `status != DEACTIVATED`, `tenant.status = ACTIVE` (mirror `resolve-tenants` in `auth.ts`).
  - **Exactly one row** → use that `tenantId`. (Fixes the token-refresh case for single-tenant users — the common case.)
  - **Multiple rows** → cannot disambiguate without the picker → throw `"Your session has expired. Please sign in again."` (prompts a fresh `select-tenant`).
  - **Zero rows** → throw `"Your account has not been granted access. Contact your administrator."`
- [ ] Keep the `AuthSession`-found path as the first resolution step (unchanged except no delete). Keep the admin-client short-circuit and `PENDING → ACTIVE` activation untouched. Remove the now-dead domain/`email.split('@')` handling and the "email domain not associated" error.
- [ ] Update `apps/api/src/cognito/pre-token.test.ts`: no-AuthSession + single roster row resolves; no-AuthSession + multiple rows throws session-expired; zero rows throws not-granted-access; AuthSession survives a second read. Remove the domain-fallback test cases.

### Phase 2 — resolve-tenants / validate-token (`apps/api/src/handlers/auth.ts`)

- [ ] Remove the **`resolve-tenants` step-2 email-domain fallback** (`auth.ts` ~line 248-273). `resolve-tenants` becomes purely the roster lookup (step 1). Zero roster rows → return `{ data: [] }` (the login page already handles the empty case).
- [ ] In **`validate-token`** (`auth.ts:392+`): it currently derives `tenantId` from the email domain. Since pre-token now always injects `custom:tenantId`, change `validate-token` to read that claim instead of domain-resolving. Remove the domain lookup.
- [ ] Confirm **`select-tenant`** needs no change (it validates the roster row + tenant `ACTIVE`, never touches `email_domains`).
- [ ] Update auth handler tests for the removed fallbacks.

### Phase 3 — remove the `email_domains` field

- [ ] **Prisma schema** (`apps/api/prisma/schema.prisma`): remove `emailDomains` from the `Tenant` model.
- [ ] **Migration**: run `npm run db:migrate` (from `apps/api`) to generate a migration dropping the `email_domains` column. New dir under `apps/api/prisma/migrations/`. The old `0003_tenant_email_domains` migration stays as history — do not edit it.
- [ ] **Admin tenants handler** (`apps/api/src/handlers/admin/tenants.ts`): remove `DomainSchema` (~lines 30-34); remove `emailDomains` from `CreateTenantBody` (~line 60) and `UpdateTenantBody` (~line 82); remove it from the create write (~line 262), update write (~line 351), and `LIST_SELECT` (~line 105).
- [ ] **`apps/api/src/handlers/admin/tenants.test.ts`** and **`apps/api/src/app.test.ts`**: drop `emailDomains` from fixtures/assertions.
- [ ] **admin-web**:
  - `apps/admin-web/src/api/tenants.ts` — remove `emailDomains` from the tenant type and create/update payloads.
  - `apps/admin-web/src/components/TenantFormDialog.tsx` — remove the email-domains form input + validation.
  - `apps/admin-web/src/components/__tests__/TenantFormDialog.test.tsx` — remove related cases.
  - `apps/admin-web/src/routes/_auth/tenants/$id.tsx` — remove the email-domains display on the tenant detail page.
- [ ] **e2e**: `apps/e2e/tests/browser/admin-vpn-diagnose.spec.ts` — remove `emailDomains` usage from the tenant setup in that spec.
- [ ] Grep again for `emailDomains` / `email_domains` / `DomainSchema` to confirm nothing is left (excluding the historical `0003_*` migration).

### Phase 4 — login error messaging (tenant-web)

When PreTokenGeneration throws, Cognito wraps the message as `UserLambdaValidationException` / `"PreTokenGeneration failed with error <message>."`. `login.tsx` renders that raw string under "Unable to continue".

- [ ] In `apps/tenant-web/src/auth/cognito.ts` (or `packages/auth/src/cognito-client.ts` where `CognitoError` is built), strip the `PreTokenGeneration failed with error ` prefix and any trailing period so only the Lambda's own sentence reaches the UI.
- [ ] In `apps/tenant-web/src/routes/login.tsx` error step (~line 453-472): render the cleaned message. The pre-token Lambda emits user-ready sentences (not-granted-access, session-expired from Phase 1) — no per-message mapping needed.
- [ ] Test: a `CognitoError` carrying a wrapped pre-token message renders the inner sentence only.

### Phase 5 — verification

- [ ] `npm run typecheck` and `npm test` clean across affected packages.
- [ ] DB migration applies cleanly on staging (`npm run db:migrate`).
- [ ] Manual staging check: log in as `steve.dolatowski@gmail.com`, leave the tab idle past one token-refresh cycle, confirm no logout / no PreTokenGeneration error.
- [ ] Manual staging check: create/edit a tenant in admin-web — no email-domains field, no errors.
- [ ] Optional housekeeping: delete the stale _"AVP Smoke 2026-05-08"_ tenant (`4b2e0267`) if it is disposable.
- [ ] Update `dolas/agents/project/GOTCHAS.md` (single-use-AuthSession / token-refresh resolution gap) and `DECISIONS.md` (record: `email_domains` dropped, resolution is roster-only, invites unrestricted).

## Files to modify

- `apps/api/prisma/schema.prisma` — remove `emailDomains`
- `apps/api/prisma/migrations/<new>/migration.sql` — **new**, drops the column
- `apps/api/src/cognito/pre-token.ts` + `pre-token.test.ts` — resolution rewrite
- `apps/api/src/handlers/auth.ts` + auth handler tests — remove domain fallbacks
- `apps/api/src/handlers/admin/tenants.ts` + `tenants.test.ts` — remove `DomainSchema` + schema fields
- `apps/api/src/app.test.ts` — fixture cleanup
- `apps/admin-web/src/api/tenants.ts` — type/payload cleanup
- `apps/admin-web/src/components/TenantFormDialog.tsx` + `__tests__/TenantFormDialog.test.tsx` — remove input
- `apps/admin-web/src/routes/_auth/tenants/$id.tsx` — remove display
- `apps/e2e/tests/browser/admin-vpn-diagnose.spec.ts` — remove usage
- `apps/tenant-web/src/auth/cognito.ts` and/or `packages/auth/src/cognito-client.ts` — strip Cognito wrapper prefix
- `apps/tenant-web/src/routes/login.tsx` — cleaned error rendering
- `dolas/agents/project/GOTCHAS.md`, `dolas/agents/project/DECISIONS.md`

## Risks & side effects

- **Schema migration drops a column** — destructive but intentional; `email_domains` values have no remaining use. Migration runs as part of the normal deploy path.
- **`AuthSession` no longer consumed** — rows live up to 10 min; Phase 1 adds cleanup so they do not accumulate. Volume is low.
- **Multi-tenant users on token refresh** — a user with active roster rows in _several_ tenants and no live `AuthSession` cannot be auto-resolved; Phase 1 fails them with "session expired, sign in again" rather than guessing. Confirm no current user legitimately relies on silent refresh while belonging to multiple tenants.
- **Invites are now unrestricted** — any email can be invited to any tenant. This is the accepted decision (cross-org support); there is no domain gate. Typos in an invited address are caught only by the roster owner, not the system.
- **Scope touches shared `packages/auth`** — flagged per workflow rules; the change there is limited to message-string cleanup.
- `validate-token` switching from domain-derivation to the `custom:tenantId` claim depends on pre-token always injecting that claim for tenant-client tokens — verified true in `pre-token.ts` for the non-admin path.
