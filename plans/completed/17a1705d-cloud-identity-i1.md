# Cloud identity I1 — Site/Company model + cloud-issued pegII tokens (pegasus)

**Branch:** `feat/cloud-identity-i1` (worktree `../pegasus-cloud-identity-i1`, from `origin/main` @ `b856a279`). Design: `plans/todo/cloud-identity-and-companies.md`.

**Goal:**

- The cloud issues short-lived, site-scoped ES256 tokens for pegII, signed by KMS and published at `/.well-known/jwks.json`.
- Every pegII bridge call carries one on behalf of the request's principal, whenever the site advertises `pegii.cloud-auth.v1`.
- Introduce the `Site` and `Company` models (tenant ⊃ companies), backfilled one-to-one from today's tenant columns, with no behaviour change.

**Status:** APPROVED 2026-10-02 (incl. the `CompanyMembership` → I3 deviation). In progress. The token contract is fixed in the design doc's "Token contract (I1 ↔ I2)" section; this plan implements the issuing end.

**Upstream / downstream:**

- **Design:** `plans/todo/cloud-identity-and-companies.md` (decisions D-I1…D-I6).
- **Next, I2 (movemanager):** the verifying end + company routing, built on the NW Phase 5 branch.
- **Gates:** I1 + I2 gate the NW pulse Phase 5 push.

---

## Scope

**In:**

1. Prisma models `Site`, `Company` (+ migration + backfill), both tenant-scoped.
2. Company/Site read + manage API for tenant admins (`/api/v1/settings/companies`, `/api/v1/settings/sites`), with the authz trio and OpenAPI.
3. KMS asymmetric signing key (infra) + `lib/pegii-token.ts` (mint, cache, `Signer` seam) + `GET /.well-known/jwks.json`.
4. Principal plumbing: all pegII gateway factories receive the request's principal and company. `pegii-api-client` sends the cloud token when the site advertises `pegii.cloud-auth.v1`, else falls back to today's path (the Secrets Manager hub service user / raw key).
5. `x-correlation-id` forwarded on every bridge call (A4 audit join).
6. The shared token fixture (key pair, JWKS, sample tokens), consumed again by I2.

**Out (and where it goes):**

- **`CompanyMembership` → I3.** _Deviation from the design, proposed for approval._ Nothing reads `emp`/`wun` until NW Phases 6–7 and the desktop (I4), so I1 mints neither for users. Service tokens get `emp` from `Company.systemEmployeeCode`, a column on `Company`. This keeps I1 at two new tenant-scoped models.
- **Tenant-web Settings → Companies UI → I3**, together with the membership admin view. In I1 a tenant admin manages companies through the API.
- **SDK `company=` parameter → I2/I3.** I1 has **no SDK surface change and no SDK bump**: every workflow call targets the tenant's default company.
- Desktop session exchange (`POST /desktop/session`) → I4.

## Design details

### Models (`apps/api/prisma/schema.prisma`)

```prisma
model Site {            // one on-prem pegII API + tunnel
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  tenant    Tenant    @relation(fields: [tenantId], references: [id])
  companies Company[]
  @@unique([tenantId, name])
  @@map("sites") @@schema("public")
}

model Company {         // legal entity = one legacy company DB
  id                  String   @id @default(uuid())
  tenantId            String   @map("tenant_id")
  siteId              String   @map("site_id")
  code                String                       // e.g. "QMM-US"; unique per tenant
  displayName         String   @map("display_name")
  dataSourceKey       String?  @map("data_source_key")   // null ⇒ the site's default DB (no cid)
  systemEmployeeCode  Int?     @map("system_employee_code") // emp for service-account tokens (NW: 1001)
  isDefault           Boolean  @default(false) @map("is_default")
  isActive            Boolean  @default(true)  @map("is_active")
  ...timestamps, relations
  @@unique([tenantId, code])
  @@unique([siteId, dataSourceKey])
  @@map("companies") @@schema("public")
}
```

- **Exactly one default company per tenant**, enforced by a partial unique index in raw migration SQL: `CREATE UNIQUE INDEX … ON companies(tenant_id) WHERE is_default`. Also at most one company per site with `dataSourceKey IS NULL` (partial unique).
- **Base URL and tunnel stay on `Tenant` in I1.** `resolvePegiiOverlayTarget` is unchanged, so `Site` is identity-only. `VpnPeer` is `tenantId @unique` today, and S-I2 confirmed QMM's two companies share one host, so one site per tenant covers every known customer. Moving `pegiiApiBaseUrl` + `VpnPeer` onto `Site` waits for the first multi-site customer.
- **Backfill** (same migration, idempotent SQL): for every tenant with `pegii_api_base_url` set or a `vpn_peer` row, insert one `Site` (name `"Primary"`) and one `Company` (`code` = the tenant slug upper-cased, or `"MAIN"`; `displayName` = the tenant name; `dataSourceKey = NULL`; `isDefault = true`).
  - Other tenants get theirs lazily, when a pegII setting is first saved.
  - QMM's second company (QMM-CA) is added by an admin after I2 ships, with its real `dataSourceKey`. The backfilled QMM company becomes QMM-US, renamed through the API.
- Both models go into `TENANT_SCOPED_MODELS` + the tenant-isolation suite.

### Token minting (`apps/api/src/lib/pegii-token.ts`)

- `mintPegiiToken({ tenantId, siteId, company, principal }): Promise<string>`, following the contract exactly.
  - `principal` = `{ tenantUserId, isServiceAccount }`.
  - `ptype` = `service` when the TenantUser is a service account.
  - `emp` = `company.systemEmployeeCode` for service accounts only; no `emp`/`wun` for users in I1.
  - `cid` = `company.dataSourceKey` when non-null.
- **`Signer` interface:** `{ keyId: string; sign(input: Uint8Array): Promise<Uint8Array /* raw R‖S, 64 bytes */> }`.
  - `KmsSigner`: `SignCommand({ KeyId, Message, MessageType: 'RAW', SigningAlgorithm: 'ECDSA_SHA_256' })`, then **DER → R‖S** conversion. A unit test covers the conversion edge cases: leading-zero padding and 31/33-byte integers.
  - `LocalSigner` (`node:crypto` P-256) for tests and the fixture.
- **Cache:** per `(sub, siteId, cid)` until `exp − 60 s`. `exp` = `iat + 300`.
- **Refuse to mint without a subject:** no subject ⇒ throw `PegiiApiError('PEGII_PRINCIPAL_UNRESOLVED')` → 503. That covers an API client with a null `actsAsUserId` (legacy rows) and a Cognito request whose `userId` didn't resolve. A token without a subject is never issued.
- **Env** (wired in CDK, never read with a silent default in prod):
  - `PEGII_TOKEN_KMS_KEY_IDS` (comma-separated; first = signing key)
  - `PEGII_TOKEN_ISSUER`

### JWKS (`apps/api/src/handlers/jwks.ts`)

- `app.get('/.well-known/jwks.json')` is mounted beside `/health`: outside tenant middleware, no auth. The API CDN's default behaviour forwards every path; verified: `/health` → 200, and unknown paths reach the Lambda's 404.
- It calls `GetPublicKey` per key id, cached in-process. It builds the JWK with **`jose`** (`importSPKI` → `exportJWK`) plus `kid`, `alg`, `use`, and sends `Cache-Control: public, max-age=300`.
- It is documented in `openapi-spec.ts` as a public operation, like `/health`.

### Bridge integration

- `PegiiTokenProvider` already exists as the client's auth seam (`getToken` / `invalidate`). Add `createCloudTokenProvider({ tenantId, siteId, company, principal })`.
- `createPegiiApiClient` chooses the provider:
  - **cloud** when `getPegiiVersionInfo(baseUrl)` includes `pegii.cloud-auth.v1` (new constant `PegiiCapabilities.CloudAuth`);
  - else the existing ARN service-user provider;
  - else a raw key.
  - On a 401 with the cloud token: invalidate it, mint once more, and retry once, mirroring the current behaviour.
- **Principal + company resolution:** `lib/pegii-request-context.ts`, `resolvePegiiCaller(c)`.
  - It reads `c.get('apiClient')?.actsAsUserId ?? c.get('userId')` and loads the TenantUser (`isServiceAccount`).
  - It loads the tenant's default `Company` and its `Site`, plus `c.get('correlationId')`.
- **Call sites to change** (each factory gains a `caller` argument):
  - `gateways/order-gateway.factory.ts`, `salesman-gateway.factory.ts`, `customer` gateway factory, `report-gateway.factory.ts`, `pegii-email.gateway.ts` (+ `services/email/outbound.ts`)
  - their handlers: `handlers/pegii-runtime.ts`, `pegii-reports.ts`, `email.ts`, and every other `resolve*Gateway` caller
  - `handlers/settings-pegii.ts:164` (the connection test runs as the tenant admin)
- **`x-correlation-id`:** `pegii-api-client` sends `caller.correlationId` on every request, including `/version` and `/health`.

### Infra (`packages/infra/lib/stacks/api-stack.ts`)

- `new kms.Key(this, 'PegiiTokenSigningKey', { keySpec: kms.KeySpec.ECC_NIST_P256, keyUsage: kms.KeyUsage.SIGN_VERIFY, removalPolicy: RETAIN, description })`.
  - **Grant only `kms:Sign` + `kms:GetPublicKey`** to the API function, through an explicit policy statement. Do not use `grantEncryptDecrypt`, which is wrong for this key.
  - **RETAIN is deliberate** for a trust anchor. The memory note "CDK RETAIN orphans block redeploy" applies on a failed first create, so run the first deploy to staging and check it before prod.
  - **No `enableKeyRotation`:** asymmetric keys don't support it. Rotation is the multi-key env list in the contract.
- Add the env vars `PEGII_TOKEN_KMS_KEY_IDS` = the key id and `PEGII_TOKEN_ISSUER` = the API's public URL per environment.
- CDK assertion test: key spec and usage, the exact grants (no Encrypt/Decrypt), and the env vars present.

### Shared fixture

`apps/api/src/__fixtures__/pegii-token/`:

- `jwks.json`, `private-key.pem` (**a test-only key, labelled so**)
- `tokens.json`: valid / wrong-aud / expired / bad-signature / no-cid / service-with-emp, with a fixed `now`
- `README.md` describing how they were generated and that I2 copies them verbatim

A generator script under `apps/api/scripts/` regenerates them deterministically. The pegasus tests verify every sample with `jose.jwtVerify` against `jwks.json`.

## Checklist (TDD)

- [x] 0. Approval of this plan, including the `CompanyMembership` → I3 deviation; the docs PR merged; `workstream-start`.
- [x] 1. **Fixture + `LocalSigner` + `mintPegiiToken`** (red: claims, header, `exp` ≤ 300, `cid` omitted when null, service `emp`, refusal without a subject; `jose.jwtVerify` passes against the JWKS) → green.
- [x] 2. **DER → R‖S** unit tests (red, with KMS-shaped DER vectors) → `KmsSigner` (green, SDK client mocked).
- [x] 3. **JWKS handler** (red: shape, multiple keys, cache header, no auth) → green; OpenAPI entry.
- [x] 4. **Prisma:** `Site`/`Company` + the partial unique indexes + the backfill migration.
  - Red: repository integration tests (backfill idempotent; one default per tenant; tenant isolation) → green.
  - Apply to local Docker before push.
- [x] 5. **Settings API** `/settings/sites`, `/settings/companies` (GET list; POST/PATCH company, tenant_admin): authz trio, OpenAPI, route tests (400s, 409 duplicate code/dataSourceKey, cross-tenant 404).
- [x] 6. **`resolvePegiiCaller` + cloud token provider + client selection.**
  - Red: version advertises cloud-auth ⇒ cloud bearer; else the ARN path; 401 ⇒ re-mint + one retry; unresolved principal ⇒ 503; `x-correlation-id` always sent.
  - Green.
- [x] 7. **Gateway factory signatures + every call site;** existing handler tests updated for the new argument (no behaviour change when the site lacks cloud-auth).
- [x] 8. **Infra:** key + grants + env; CDK assertion tests; `cdk synth`.
- [x] 9. Coverage ratchet committed; `npm run typecheck`, `npm test`, `npm run lint` green.
- [ ] 10. (post-merge) PR through the merge queue; deploy; check `GET https://api.pegasus.dolas.dev/.well-known/jwks.json` on staging, then prod.
- [~] 11. (phase table + memory post-merge) Docs: `dolas/agents/project/DECISIONS.md` (the cloud is the IdP for pegII); update the design doc's phase table to I1 ✅; memory.

## Implementation notes (2026-10-02)

**Built:**

- `lib/pegii-signer.ts`: the `Signer` interface, `createKmsSigner` (DER → R‖S), `createLocalSigner`.
- `lib/pegii-token.ts`: claims, signing, the cached minter, `getPegiiTokenMinter` (env-configured), `createCloudTokenProvider`.
- `handlers/jwks.ts`, mounted at `/.well-known/jwks.json`, with an OpenAPI entry.
- `Site`/`Company` + migration `20261002234626_add_sites_companies` (partial unique indexes + idempotent backfill) + `repositories/company.repository.ts`.
- `handlers/settings-companies.ts`: `GET/POST /settings/companies`, `PATCH /settings/companies/:id`.
- `lib/pegii-request-context.ts` (`resolvePegiiCaller`).
- `pegii-api-client`: lazy cloud-vs-legacy auth choice + `x-correlation-id`. Every gateway factory takes a `callerOf` thunk.
- Infra: `PegiiTokenSigningKey` + Sign/GetPublicKey-only grant + env; `PEGII_TOKEN_ISSUER` per environment from `bin/app.ts`.
- The shared fixture under `src/__fixtures__/pegii-token/`.

**Deviations from the plan text, all within the approved scope:**

- **Authz:** the companies routes reuse the existing `ReadSettings` / `UpdateSettings` actions, as `/settings/pegii` does, instead of new Cedar actions. Settings routes are session-only and not part of the OpenAPI document (the coverage gate covers M2M routes), so the companies routes are not either.
- **`/settings/sites` is only `PATCH /settings/sites/:id`** (name + the cloud-auth switch). Sites are listed by `GET /settings/companies` (`{sites, companies}`), and a company created without a `siteId` lands on the Primary site, which is created on first use.
- **The fixture commits no private key.** Each generator run uses a throwaway key and writes only `jwks.json` + `tokens.json`, so the secret scanner has nothing to flag. Regenerating changes every byte, and movemanager re-copies the directory.
- **The settings connection test (`POST /settings/pegii/test`) is unchanged.** It only calls the unauthenticated `/health`, so no token path is involved.
- **Caller resolution is lazy:** a factory invokes `callerOf` only when it actually builds a pegII gateway. A tenant whose customers come from cloud Postgres never resolves a caller or creates a site.
- **Operator switch `Site.cloudAuthEnabled` (added in review, default off).** The `/version` probe is unauthenticated, so letting it decide on its own would let anything answering on the overlay (a spoofed or stale slot) receive a signed token. The bridge now sends cloud tokens only when the switch is on **and** `/version` advertises `pegii.cloud-auth.v1`. With the switch off it doesn't probe at all. It is flipped per site with `PATCH /settings/sites/:id {cloudAuthEnabled}` after I2 reaches that site. Separate migration: `20261003000538_add_site_cloud_auth_enabled`.
- **A failed `/version` probe falls back to the legacy credential path** instead of failing the call, so read paths gain no new failure mode before I2.
- **Two existing handler tests were edited** (`customers.test.ts`, `pegii-reports.test.ts`) to expect the new third factory argument.

## Files

**New:**

- `apps/api/src/lib/pegii-token.ts`, `lib/pegii-signer.ts` (`Signer`, `KmsSigner`, `LocalSigner`, DER conversion), `lib/pegii-request-context.ts`
- `apps/api/src/handlers/jwks.ts`, `handlers/settings-companies.ts`
- `apps/api/src/repositories/company.repository.ts`
- `apps/api/prisma/migrations/<ts>_sites_companies/` (DDL + partial indexes + backfill)
- `apps/api/src/__fixtures__/pegii-token/*`, `apps/api/scripts/generate-pegii-token-fixture.ts`
- Tests next to each

**Modified:**

- `prisma/schema.prisma`, `lib/prisma.ts` (`TENANT_SCOPED_MODELS`)
- `lib/pegii-api-client.ts`, `lib/pegii-capabilities.ts`
- Gateway factories (order, salesman, customer, report, email) and their gateways
- `handlers/pegii-runtime.ts`, `pegii-reports.ts`, `email.ts`, `settings-pegii.ts`
- `app.ts` (JWKS mount, settings route mount)
- `authz/{actions.ts,cedar.schema.json,policies/…}` (Manage/Read Company)
- `lib/openapi-spec.ts`
- `packages/infra/lib/stacks/api-stack.ts` + its test

## Risks

- **Multi-call signatures:** the gateway factory change touches every pegII call path. Mitigation: the cloud token is used only when the site advertises `pegii.cloud-auth.v1`, so until I2 ships nothing on the wire changes except the new `x-correlation-id` header.
- **KMS cost/latency:** one `Sign` per (principal, site, company) per ~4 minutes. Negligible at current volume. The Lambda concurrency cap of 10 is unaffected.
- **Backfill on prod:** additive and idempotent; tenants without pegII config get no rows.
- **Tenant isolation:** a company or site from another tenant must be unreachable through the settings API or the minting path. `resolvePegiiCaller` reads through the tenant-scoped `db` only.
