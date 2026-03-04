# Phase 4 — Dynamic Identity Provider Provisioning in Cognito

**Branch:** main
**Goal:** Wire `sso.ts` POST/PUT/DELETE handlers to AWS Cognito via the SDK so that tenant IdPs are provisioned, updated, and deleted at runtime — never statically in CDK.

---

## Task Restatement

The `sso.ts` handler already persists tenant SSO provider records to Postgres via Prisma, but does not touch Cognito. Phase 4 completes the loop: after each DB mutation, the handler calls the Cognito Identity Provider SDK to keep Cognito in sync. If Cognito provisioning fails on POST, the DB record is rolled back to maintain consistency.

---

## Step-by-step Implementation Plan

- [x] 1. Write plan → await approval _(this file)_
- [x] 2. Update `sso.ts` — add Cognito SDK calls to POST, PUT, DELETE
- [x] 3. Update `api-stack.ts` — add IAM permissions for IdP CRUD actions
- [x] 4. Update `sso.test.ts` — mock Cognito client, add tests for each operation
- [x] 5. Run `npm test` — confirm all tests pass (183 API tests pass; 15 pre-existing infra bundling failures unrelated to this change)

---

## Files to Modify

| File                                     | Change                                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api/src/handlers/sso.ts`       | Import Cognito SDK; add `oidcClientSecret` to create/update schemas; call CreateIdentityProviderCommand, UpdateIdentityProviderCommand, DeleteIdentityProviderCommand; rollback on POST failure |
| `packages/api/src/handlers/sso.test.ts`  | Mock `@aws-sdk/client-cognito-identity-provider`; add tests verifying correct SDK calls and `authorize_scopes = "openid email profile"`                                                         |
| `packages/infra/lib/stacks/api-stack.ts` | Extend the existing IAM policy block to include `cognito-idp:CreateIdentityProvider`, `cognito-idp:UpdateIdentityProvider`, `cognito-idp:DeleteIdentityProvider`                                |

**No new files.** No DB schema changes. No CDK Cognito stack modifications.

---

## Detailed Implementation Notes

### Environment variable

`COGNITO_USER_POOL_ID` is already injected into the Lambda environment and available via `process.env['COGNITO_USER_POOL_ID']`. No changes needed to the env-var plumbing.

### Cognito client singleton (in `sso.ts`)

A module-level `CognitoIdentityProviderClient` singleton (identical pattern to `tenants.ts`). The client is created once and reused across warm invocations.

```ts
import {
  CognitoIdentityProviderClient,
  CreateIdentityProviderCommand,
  UpdateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const cognito = new CognitoIdentityProviderClient({})
const USER_POOL_ID = process.env['COGNITO_USER_POOL_ID'] ?? ''
```

### Schema changes

Add `oidcClientSecret` (optional string) to `CreateSsoProviderBody` and `UpdateSsoProviderBody`. This value is passed directly to Cognito and is **never persisted to the DB or returned in any response**.

### POST /providers — Create flow

1. Validate body (Zod).
2. `db.tenantSsoProvider.create(...)` → get `provider` row.
3. Build `ProviderDetails`:
   - **OIDC**: `{ client_id, client_secret, attributes_request_method: 'GET', oidc_issuer, authorize_scopes: 'openid email profile' }`
     - `oidc_issuer`: strip `/.well-known/openid-configuration` suffix from `metadataUrl` if present; otherwise use `metadataUrl` as-is. Cognito appends the suffix itself.
   - **SAML**: `{ MetadataURL: metadataUrl }` (no client secret, no scopes).
4. Call `CreateIdentityProviderCommand({ UserPoolId, ProviderName: cognitoProviderName, ProviderType, ProviderDetails, AttributeMapping: { email: 'email' } })`.
5. **If Cognito throws**: log the error, `db.tenantSsoProvider.delete({ where: { id: provider.id } })` (rollback), return `500 INTERNAL_ERROR`.
6. On success: return `201` with the provider row.

### PUT /providers/:id — Update flow

1. Validate body (Zod).
2. `db.tenantSsoProvider.findUnique({ where: { id }, select: { id, cognitoProviderName, type, metadataUrl, oidcClientId } })` — fetch existing record for Cognito call context.
3. Return 404 if not found.
4. `db.tenantSsoProvider.update(...)` → get updated `provider` row.
5. Build `ProviderDetails` from merged state (updated fields take priority, fall back to existing):
   - **OIDC**: `{ client_id, attributes_request_method: 'GET', oidc_issuer, authorize_scopes: 'openid email profile' }` + `client_secret` only if `body.oidcClientSecret` is provided.
   - **SAML**: `{ MetadataURL }`.
6. Call `UpdateIdentityProviderCommand({ UserPoolId, ProviderName: existing.cognitoProviderName, ProviderDetails })`.
7. **If Cognito throws**: log the error, return `500 INTERNAL_ERROR` (DB is already updated; the inconsistency is surfaced as an error so the caller can retry).
8. On success: return `200` with the provider row.

### DELETE /providers/:id — Delete flow

1. `db.tenantSsoProvider.findUnique({ where: { id }, select: { id, cognitoProviderName } })`.
2. Return 404 if not found.
3. Call `DeleteIdentityProviderCommand({ UserPoolId, ProviderName: existing.cognitoProviderName })`.
   - If Cognito throws with `NotAuthorizedException` or `ResourceNotFoundException` (IdP already gone), log a warning and continue — Cognito is already clean.
   - If Cognito throws with any other error: log and return `500 INTERNAL_ERROR` (do not delete from DB).
4. `db.tenantSsoProvider.delete({ where: { id } })`.
5. Return `204`.

### IAM additions (`api-stack.ts`)

Extend the existing `if (props.cognitoUserPoolId)` block to a single `PolicyStatement` covering all four IdP actions:

```ts
new iam.PolicyStatement({
  actions: [
    'cognito-idp:AdminCreateUser',
    'cognito-idp:CreateIdentityProvider',
    'cognito-idp:UpdateIdentityProvider',
    'cognito-idp:DeleteIdentityProvider',
  ],
  resources: [
    `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.cognitoUserPoolId}`,
  ],
})
```

### Tests to add (`sso.test.ts`)

Mock strategy: `vi.mock('@aws-sdk/client-cognito-identity-provider', ...)` — mock `CognitoIdentityProviderClient` so `send()` is a `vi.fn()`.

New test groups:

**POST — Cognito provisioning**

- ✅ Calls `CreateIdentityProviderCommand` with correct `ProviderName`, `ProviderType: 'OIDC'`, and `ProviderDetails` containing `authorize_scopes: 'openid email profile'`.
- ✅ Calls `CreateIdentityProviderCommand` with `ProviderType: 'SAML'` for a SAML provider (no `authorize_scopes`).
- ✅ On Cognito failure: returns 500, deletes the DB record (rollback).

**PUT — Cognito sync**

- ✅ Calls `UpdateIdentityProviderCommand` with the provider's `cognitoProviderName` and `authorize_scopes: 'openid email profile'` for OIDC.
- ✅ On Cognito failure: returns 500.

**DELETE — Cognito cleanup**

- ✅ Calls `DeleteIdentityProviderCommand` with the provider's `cognitoProviderName`.
- ✅ `ResourceNotFoundException` from Cognito on DELETE is treated as a warning; DB record still deleted and 204 returned.
- ✅ Other Cognito errors on DELETE return 500 and DB record is preserved.

---

## Risks & Side Effects

| Risk                                                 | Mitigation                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `oidcClientSecret` in request body                   | Never persisted to DB, never returned in response; only flows to Cognito.             |
| POST rollback races                                  | Simple sequential delete; Prisma `id` is known from the created row.                  |
| PUT partial inconsistency                            | Callers get 500 so they know to retry; logged with correlation ID for ops visibility. |
| DELETE Cognito "not found"                           | Treated as idempotent success so re-runs of a failed delete don't block DB cleanup.   |
| IAM wildcard fallback                                | Unchanged — same `if (props.cognitoUserPoolId)` guard as before.                      |
| No DB schema changes                                 | `oidcClientSecret` never touches Prisma — zero migration needed.                      |
| `@aws-sdk/client-cognito-identity-provider` bundling | Already listed in `externalModules: ['@aws-sdk/*']` — Lambda runtime provides it.     |
