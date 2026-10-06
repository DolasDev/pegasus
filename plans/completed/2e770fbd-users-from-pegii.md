# Add users from the pegII employee directory (optional invite, SSO-only)

## Context

Today a tenant admin creates cloud users one email at a time (Settings → Users → Invite). Each user gets a Cognito user and a temporary-password email. I3 (live 2026-10-06) gave the cloud each company's salesman directory (`GET /api/v1/pegii/salesmen`, `pegii.salesmen.list.v1`).

Steve wants admins to pick employees from that directory and create users in one go:

- a searchable list, with one or more people selectable
- **"Send invite" is optional**

**Unchecked = SSO-only.** No email and no password; the person signs in only with the tenant's SSO provider. The existing triggers already support this:

- `cognito/pre-sign-up.ts` lets a federated sign-up through when there is no native user.
- `cognito/pre-token.ts` finds the TenantUser by tenant (from the provider) and email, then promotes PENDING → ACTIVE and sets `cognitoSub`.

So an SSO-only user is just a TenantUser row with **no Cognito call**. The one hazard is today's **Resend invite**: on a PENDING row with no Cognito user it would create a native user and email a password, which silently converts the person and later gives them two Cognito identities.

**Decisions (Steve, this session):**

- **Placement:** an **"Add from pegII"** panel on the Users page.
- **SSO-only users:** labelled "SSO only". The resend route and button refuse them; there is no conversion path.
- **Linking:** after creating users, **run that company's I3 membership sync**, so they're linked (`emp`/`wun`) at once.

## API (apps/api)

**Schema and migration:**

- `TenantUser.ssoOnly Boolean @default(false) @map("sso_only")`.
- Existing rows stay `false`, so there is no behaviour change.

**`GET /settings/companies/:id/directory`** (`ReadSettings`), in `handlers/settings-companies.ts`:

- Returns the company's directory via `resolveSalesmanGateway(db, tenantId, () => resolvePegiiCaller(c, { companyId }))` → `listSalesmen({ active: true })`.
- Each entry: `{ code, name, email, branch, existingUserId | null }`. `existingUserId` comes from matching the tenant's users by email, case-insensitive, deactivated users included.
- Same guards as the sync:
  - 404 for a foreign company
  - 409 `SITE_CLOUD_AUTH_DISABLED`
  - the router's `onError` → `pegiiApiErrorToHttp`
- It's a session route, which keeps it out of the M2M OpenAPI surface, like the other `/settings` routes.

**`POST /users/import`** (`InviteUser`), in `handlers/users.ts`:

- **Body:** `{ companyId, employeeCodes: number[1..50], roleNames, sendInvite: boolean }`.
- **Server-side truth:** the server **re-reads the directory**; it never trusts emails from the client. It keeps only the requested codes that are active and have an email.
- **Per employee,** sequentially, with a per-row outcome `{ code, email, status, userId?, reason? }`:
  - **`skipped`** for: no email; already a user (any status); email active in **another** tenant. The cross-tenant check reuses the #673 roster check, so the import can't claim someone else's identity.
  - **`sendInvite: true`:** the existing `provisionCognitoUser(email, tenantCtx)`, then `repo.invite(...)`. This is the same path, ordering and error mapping as `POST /users/invite`; that code is factored into a shared helper both routes call.
  - **`sendInvite: false`:** `repo.invite(..., { ssoOnly: true })` only, with no Cognito call.
  - **`legacyWindowsUsername`** is set from the employee's `winUsername` when present, for the I3 match and the longhaul proxy.
  - A Cognito or database failure on one row fails **that row** (`failed`) and the loop continues.
- **Guards:**
  - `sendInvite: false` requires the tenant to have ≥1 enabled `TenantSsoProvider`, else 422 `SSO_NOT_CONFIGURED`. Otherwise the user could never sign in.
  - `roleNames` is validated against `ROLE_OPTIONS` (new, on this route only; noted as a gap on `/invite`).
- **After the loop:** run the company's membership sync (factor the route body into `services/company-membership-sync.ts` → `syncCompanyMemberships(db, c, companyId)`, shared with `POST /settings/companies/:id/membership-sync`). Include its summary in the response.
  - A sync failure doesn't undo the created users. It's reported as `membershipSync: { error }`.

**SSO-only hardening:**

- `POST /users/:id/resend-invite` returns 422 `SSO_ONLY` for `ssoOnly` rows, before any Cognito call.
- `POST /users/:id/reset-password` already refuses rows with no `cognitoSub`. Add an explicit `SSO_ONLY` check for rows that have signed in.
- The users list response gains `ssoOnly`.

## tenant-web

**Users page:** an **"Add from pegII"** button next to Invite opens an inline panel, following the existing `InviteForm` panel pattern in `routes/users.tsx`.

- A company `<select>` (from `companiesQueryOptions`), shown only when the tenant has more than one company.
- A search input that filters name, email, code and branch client-side.
- A checkbox list (a new small `EmployeePickList` component; there's no Combobox primitive):
  - **Disabled:** people who are already users ("Already a user") and people without an email ("No email in pegII").
  - **Select all (filtered)** with a selected count.
- Roles via the existing `RoleCheckboxList`.
- A **"Send invite"** checkbox, **unchecked by default**:
  - **Help text:** checked means a temporary password by email; unchecked means they sign in with SSO only.
  - **Without SSO:** disabled, forced checked, with a note, when the tenant has no SSO provider.
- Submit → a per-person result list (created / invited / skipped with reason / failed) plus the link summary.
- **Errors:** the 409 and 503 states reuse `syncErrorMessage` from `settings.companies.tsx`, moved to a shared module.

**Elsewhere on the Users page:**

- An **"SSO only"** badge next to Pending/Active (`StatusBadge`).
- For `ssoOnly` rows, hide Resend invite and Reset password.

**Code:** `api/queries/users.ts` (`useImportUsers`), `api/companies.ts` (`getCompanyDirectory`), `api/queries/companies.ts`.

## Docs

- **`plans/todo/cloud-identity-and-companies.md`:** a short "Users from the directory" note under I3.
- **`DECISIONS.md`:** an SSO-only users entry, covering why there's no Cognito user, the resend refusal, and the two-identity hazard.
- **SDK:** not touched. These are session-only admin routes, not workflow-facing.

## Verification

- **API unit/route tests:**
  - import with `sendInvite` true/false (Cognito called or not)
  - each skip reason, including the cross-tenant roster check
  - client-supplied codes not in the directory are ignored
  - a per-row failure doesn't stop the rest
  - `SSO_NOT_CONFIGURED`
  - role validation
  - the directory route's `existingUserId`
  - resend/reset refuse `SSO_ONLY`
- **Repository test (Postgres):** the `ssoOnly` default; import then sync links the new user.
- **pre-token test:** a PENDING `ssoOnly` row is promoted on first federated login. This proves the existing path for this row shape; add it to the existing trigger tests if they aren't already covering it.
- **tenant-web:** search and select, disabled rows, "Send invite" default, per-person result rendering.
- **Full suites:** api, tenant-web, typecheck, lint. Don't commit the `vitest.config.ts` floor bump.
- **Live on QMM** (cloud auth on; QMM has Microsoft SSO), with a tenant-admin session:
  1. Add one QMM USA employee with "Send invite" unchecked.
  2. Confirm no email is sent and the row shows "SSO only", Pending, and LINKED on Companies.
  3. That person signs in with Microsoft and becomes Active.
  - **Watch for:** pegII's `email_address` must equal the address Microsoft asserts. If the two differ, first login fails with `SSO_ERROR_NOT_ROSTERED`; say so in the panel's help text.

## Workstream

A new worktree, `scripts/workstream-start.sh feat users-from-pegii <this plan>`, off fresh `origin/main`. The finished I3 worktree is torn down separately when Steve says so.

## Implementation notes (2026-10-06)

**As built:**

- **`lib/company-directory.ts`** now holds the shared directory read and sync. Three callers use it: the membership-sync route, the new directory route, and `/users/import`.
  - `readCompanyDirectory` does the company lookup and the cloud-auth guard (`CompanyDirectoryRefused` 404/409), then the pegII read.
  - `syncCompanyMemberships` plans and applies the membership sync.
  - The import reads the directory **once** (all employees, since the sync needs leavers) and hands the same list to the sync, so there is no second pegII call.
- **`POST /users/invite` and `/users/import`** share `createTenantUser`. `/invite` keeps its exact behaviour; its tests now also pin `ssoOnly: false`.
- **Validation:** the import body is `.strict()`, so a client-supplied `emails` field is a 400. Roles are validated against `ROLE_OPTIONS`.
- **Skip reasons:** `NOT_IN_DIRECTORY`, `INACTIVE`, `NO_EMAIL` (including malformed), `ALREADY_A_USER`, `ACTIVE_IN_ANOTHER_TENANT`. Failures: `COGNITO_ERROR`, `ERROR`.
- **UI:**
  - "Send invite" is unchecked by default. It is forced on, and disabled, when no SSO provider is enabled.
  - The panel caps a submission at 50, matching the API's `IMPORT_MAX`.
  - Site errors share `lib/company-site-errors.ts` with the Companies page.
- **No OpenAPI or SDK change:** both new routes are session-only admin routes.
- **Correction to the plan (advisor review):** the `ACTIVE_IN_ANOTHER_TENANT` skip applies **only with "Send invite" on**.
  - The #673 roster rule guards the shared Cognito pool. An SSO-only row touches no Cognito state, and it is the right path for someone who already signs in elsewhere.
  - The original "skip, use Invite user" advice led straight to the two-identity hazard: `/invite` checks only native users, so it would mint a federated person a password login.
- **Tenant name/slug** are looked up once per import, not per row.
- **Batches are sequential,** so 50 invited people take roughly 10–15s against the API Lambda's 29s timeout. Re-running a timed-out batch is safe: created rows skip as `ALREADY_A_USER`.
- **Not fixed here (pre-existing):** a plain `POST /users/invite` for a person whose only Cognito identity is federated still creates a native user. Only this tenant's resend and reset paths are guarded.

**Tests:**

- API: full suite green (276 files, 3933 tests). New: `users-import.test.ts` (14), directory-route tests, an SSO-only first-login test in `pre-token.test.ts`, and the `ssoOnly` repository test against Postgres.
- tenant-web: 1542 green. New: `AddFromPegiiPanel.test.tsx` (6) and the SSO-only row test.
