# Cloud identity & companies — the cloud as identity provider, tenant ⊃ companies, on-prem hub retired

**Branch:** `docs/cloud-identity-and-companies` (design only; each phase below gets its own worktree, branch and PR; movemanager phases get their own plan files).

**Goal:**

- Make the Pegasus cloud the single source of identity and authorization for everything that touches pegII: workflows, API clients, and eventually desktop users.
- Model a customer **tenant** as an organization containing one or more **companies** (legal entities, each one legacy database).
- Retire the on-prem hub, so hub users and cloud users become the same people.

**Status:** IN PROGRESS. Direction approved 2026-10-02.

- **I1 is live** (pegasus #770 → `dd1bbc56`, 2026-10-03).
- **I2 is on alpha** (`2026.10.5.2+69e6c050`). **QMM's site has cloud auth on** (2026-10-05, verified end to end); NW and RVS are on hold (Steve).
- **I3 is built** (movemanager branch `feat/cloud-identity-i3-salesmen-list` @ `f555bed3`, not yet on `dev`; pegasus PR on `feat/cloud-identity-i3`). See "Next session — start here".

**A new session starts at "Next session — start here" below.**

**Origin:** NW pulse-texting master plan (`plans/in-progress/nw-pulse-texting-platform.md`), Phase 5. The approved flow, "provision a `pegasus-cloud` hub service user + a Secrets Manager credential on every site", was rejected as the long-term shape.

---

## Decisions (Steve, 2026-10-01 → 02)

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-I1 | **The cloud is the authorization gate.** It authenticates its principals (Cognito users, API clients, workflow runtimes = service-account `TenantUser`s) and authorizes every request with Cedar _before_ calling pegII. pegII verifies only that a token is genuine and addressed to it. It never makes per-principal access decisions. (Master-plan Phase 5 "A4".)                                                                                                                                                                                                                                              |
| D-I2 | **pegII trusts tokens the cloud issues.** This flips today's direction, where the cloud logs in to pegII as a hub user. Sites need no per-site service user and no credential stored in the cloud.                                                                                                                                                                                                                                                                                                                                                                                                                |
| D-I3 | **Tenant = customer organization; company = legal entity = one legacy company database** (today's `hub_company`). Examples: QMM operates QMM-US and QMM-Canada as **two databases**; a future customer runs a hauler and a brokerage. Shared visibility, intercompany billing and shared resource pools are tenant-level capabilities across that tenant's companies.                                                                                                                                                                                                                                             |
| D-I4 | **Move the on-prem hub to the cloud.** Hub users become Cognito users / `TenantUser`s, the company registry becomes cloud `Company` rows, and cloud identity eventually replaces pegII's own user stores (`hub_user`, then `salesman` passwords).                                                                                                                                                                                                                                                                                                                                                                 |
| D-I5 | **Cloud-dependent desktop sign-in is acceptable.** No offline or break-glass login path is required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-I6 | **Company database connection strings stay on site.** The cloud stores a company's `dataSourceKey`; the site's pegII API resolves it from its local `SpokeConnections`, as the hub does today. The cloud never holds on-prem SQL credentials for this path.                                                                                                                                                                                                                                                                                                                                                       |
| D-I7 | **Hub routes accept hub tokens only** (Steve, 2026-10-05; I2 approval item A; amends the "hub-or-cloud default policy, no endpoint changes" wording below). `GET /hub/companies/{id}/connection` serves a company's SQL connection string on token validity alone, and `/auth/me` plus the hub-user admin routes read `sub` as a hub username. So every hub route carries `AuthPolicies.HubOnly`, and only the cloud-facing routes (serialized, search, email) take either scheme. **A new hub route must use `HubOnly`:** `dev` added three hub routes while I2 was in flight, and the I2 merge had to pin them. |

---

## Next session — start here (updated 2026-10-05, evening)

**Done:**

- **I1 (pegasus):** KMS ES256 minting, `/.well-known/jwks.json`, `Site`/`Company` + backfill, `Site.cloudAuthEnabled`. Plan: `plans/completed/17a1705d-cloud-identity-i1.md`.
- **I2 (movemanager):** the `Cloud` scheme, hub routes `HubOnly` (D-I7), routing by `cid`, migrations on every `SpokeConnections` database, `pegii.cloud-auth.v1`, `install.ps1 -CloudIssuer -SiteId`. On alpha as `2026.10.5.2+69e6c050`. Plan: movemanager `plans/completed/75f99aa5-cloud-identity-i2.md`.
- **QMM rollout (2026-10-05):**
  - Site env (Machine scope): `Api__CloudAuth__Issuer`, `Api__CloudAuth__SiteId = 631fce83-…`, and `SpokeConnections__PegQMMUSA` on SQL instance `localhost\Pegasus`. `PegQMMUSA` migrated (`dbo.__SchemaMigrations` exists) once a placeholder password in that variable was fixed.
  - Cloud: `cloudAuthEnabled = true` on site `631fce83`. Verified with a positive read (`GET /pegii/salesmen/1..3` → 200 from `PegQMM`).
  - Companies: `QUALITY-MOVE-MANAGEMENT` renamed `QMM-CANADA` "QMM Canada" (default, `PegQMM`); `QMM-USA` "QMM USA" created with `dataSourceKey = PegQMMUSA`.
  - **Check the migration with SQL, not logs:** the pegII service logs to the Windows Application event log (source `PegasusApi`), where Information lines likely don't appear. `SELECT COUNT(*) FROM <db>.dbo.__SchemaMigrations` per company DB.
- **I3 built (not yet shipped):** see the I3 row below and `plans/completed/a64d3dd9-cloud-identity-i3.md`.

**Next, in order:**

1. **Land I3's movemanager half:** run `scripts/test.ps1` on Windows against branch `feat/cloud-identity-i3-salesmen-list`, merge `origin/dev`, archive its plan, fast-forward `dev`. Then confirm alpha's manifest moves past `2026.10.5.2` and QMM's `/version` lists `pegii.salesmen.list.v1`.
2. **Merge the pegasus I3 PR**, then tag and publish SDK `0.45.1`.
3. **Live check on QMM** (tenant-admin session): Settings → Companies → Sync employees on `QMM-CANADA`, then on `QMM-USA` (the first real `cid = PegQMMUSA` request).
4. **NW / RVS rollout (on hold — Steve, 2026-10-05).** Same env pair per site (ids below), confirm `/version`, then `PATCH /api/v1/settings/sites/:id {"cloudAuthEnabled": true}` with that tenant's admin session (`/settings/*` is Cognito-only; an API key is refused). For NW also set `systemEmployeeCode = 1001` on its company.
   - **Open:** do the `-test`/`-qa` tenants have their own servers? One server can hold only one site id.
   - **Why it matters:** every prod tenant has `pegii_api_key_ref = NULL`, so a site without cloud auth gets **no credential**; token-gated routes (serialized reads, order search, email, and now the salesman list) fail there.

   | Tenant slug                   | Site.id                                                |
   | ----------------------------- | ------------------------------------------------------ |
   | `nelson-westerberg`           | `29eb5c90-9a16-428d-9ba6-4236e67ffeb1`                 |
   | `nelson-westerberg-test`      | `571a3c92-19e4-48de-a70a-abb8f3c00f2c`                 |
   | `quality-move-management`     | `631fce83-f7e5-41e5-856b-fc7f630565a6` (cloud auth ON) |
   | `quality-move-management-qa`  | `658c2d40-1658-4b20-8700-d16c20d4b92b`                 |
   | `reliable-van-and-storage`    | `1a723d1d-e3fa-4fb7-ba71-ae1d2cd83d34`                 |
   | `reliable-van-and-storage-qa` | `a4988cac-e18f-41d3-a1cd-c86873b8a43f`                 |

5. **NW pulse Phases 6–7** consume `emp`/`wun` for `created_by`/`who_called`.

**Users from the directory (2026-10-06):** Users → **Add from pegII** creates logins from a company's directory, with "Send invite" optional; unchecked means SSO-only (no Cognito user until the first SSO login). New users are linked by the membership sync straight away. See `DECISIONS.md` ("SSO-only users") and `plans/completed/2e770fbd-users-from-pegii.md`.

**Companies as they are (verified 2026-10-05, read-only):**

- **NW and RVS are single-company:** their default DB is their only company.
- **QMM** (one site, one SQL instance):
  - `PegQMM` = **QMM Canada**, the default DB.
  - `PegQMMUSA` = **QMM USA**, routed by `cid = PegQMMUSA`.
  - QMM Canada **owns** QMM USA. The on-prem `PegHub.dbo.hub_company` already says so: `QMMUSA.parent_company_id = QMM`, keys `PegQMM` / `PegQMMUSA`.
  - **The cloud `Company` model has no parent yet.** Add one when intercompany billing needs it, not before (YAGNI).
- **`PegQMMEC`** also sits on QMM's instance, with the legacy schema, outside the hub registry. **Unknown purpose — leave it alone** (Steve, 2026-10-05): never add it to `SpokeConnections`.

## Where things are today (verified 2026-10-02)

**Cloud (pegasus)**

- `Tenant` carries the legacy routing directly: a single `mssqlConnectionString`, `pegiiApiBaseUrl` and `pegiiApiKeyRef`, plus `VpnPeer` (`tenantId @unique`, one tunnel per tenant). **There is no company or legal-entity concept anywhere in the schema.** QMM is one tenant pointing at `PegQMM`.
- `TenantUser`: `@@unique([tenantId, email])`, `cognitoSub`, `roleNames` (feeding the `custom:roles` claim), and `isServiceAccount`.
  - `ApiClient.actsAsUserId` points at a service-account `TenantUser`. Workflow runtimes are per-workflow `ApiClient`s whose runtime token is KMS-encrypted (`WorkflowTokenKey`, symmetric).
- **A link from a cloud identity to a legacy identity already exists:** `TenantUser.legacyWindowsUsername`, forwarded by the longhaul proxy. It is the same key the desktop uses to find a person on a company database.
- Token claims today: `custom:tenantId`, `custom:roles`.
- **No asymmetric signing key and no JWKS endpoint** (`/.well-known/jwks.json` → 404).
- Cognito app clients: admin, tenant, mobile. The mobile client already signs in through the **Hosted UI in a system browser**, which is the precedent for desktop sign-in.

**pegII (movemanager `dev`)**

- **The on-prem hub is two things:**
  - `hub_user`: the desktop's human logins via `POST /auth/login` (`Program.vb:181`), with PBKDF2 passwords and `CanAccessAllCompanies`.
  - `hub_company`: code, display name, `data_source_key`, parent.
- **Desktop API-mode sign-in:** hub login → company picker (`/hub/companies`) → the API resolves `data_source_key` → connection string from local `SpokeConnections` → the desktop connects straight to that database → `LoadApiIdentity(username)` matches the employee row by `win_username`.
  - A cross-company admin with no employee row gets a synthesized Wizard identity (`SpokeIdentityResolution`).
- **The API's data endpoints use a single local `ConnectionStrings:PegasusDb`.** Only the hub knows about multiple company databases. A two-database customer such as QMM therefore needs per-request company routing before the bridge can serve both companies.
- JWT: one HS256 scheme (`Api:Jwt:SigningKey`); cloud-facing routes carry `.RequireAuthorization()` (default policy) inside `if (authEnabled)`.

---

## Target model

```
Tenant (customer org: identity, contract, billing, Cedar boundary)
 ├─ Site            (one on-prem pegII API + tunnel; today's Tenant.pegiiApiBaseUrl + VpnPeer)
 │   └─ resolves Company.dataSourceKey → connection string locally (D-I6)
 ├─ Company         (legal entity = one legacy company DB; code, displayName, dataSourceKey, siteId)
 └─ TenantUser      (one identity per person per org; Cognito-backed, or a service account)
     └─ CompanyMembership (companyId, legacyWindowsUsername, employeeCode, status)
```

- **Identity is per organization; access to a company is per membership.** One QMM login with membership in QMM-US, QMM-CA, or both. From I4, membership replaces the hub's all-or-nothing `CanAccessAllCompanies`, and the desktop company picker lists the user's memberships. **In I3 a membership is attribution only** (`emp`/`wun` on the user's tokens); it gates nothing.
- **Cloud-native data stays tenant-scoped.** It gains an optional `companyId` only where the legal entity matters: invoices and billing, legacy routing, intercompany documents. This is deliberately not a re-scoping of every table.
- **Backfill (no behaviour change):** every existing tenant gets one `Site` (from `pegiiApiBaseUrl` + `VpnPeer`) and one `Company` (from today's single database), and memberships are **not** backfilled: the first membership sync (I3) creates them. Today's tenant columns stay, readable through the default company, until callers migrate.
- `Site`, `Company` and `CompanyMembership` go into `TENANT_SCOPED_MODELS` and the tenant-isolation suite.

## Cloud-issued pegII tokens

**One issuer, two ways in:**

- **Bridge:** the API mints a token per principal for a workflow, API client or user request.
- **Desktop session:** a Cognito session is exchanged for a pegII token for one company.

pegII trusts **only** the cloud's issuer. It never validates Cognito tokens directly, so company membership and employee mapping stay authoritative in the cloud.

| Claim         | Value                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| `iss`         | the cloud (`https://api.pegasus.dolas.dev`)                                        |
| `aud`         | `pegii-site:<siteId>`, so a token for one site is useless at another               |
| `sub`         | `TenantUser.id` (human or service account)                                         |
| `tid`         | tenant id                                                                          |
| `cid`         | the target company's `dataSourceKey`; the site routes the request to that database |
| `ptype`       | `user` \| `service`                                                                |
| `emp` / `wun` | linked employee code / Windows username in that company, or absent                 |
| `exp`         | ≤ 5 min                                                                            |
| `jti`, `kid`  |                                                                                    |

- **Attribution only:** `emp`/`wun` are used for attribution (`created_by`, `who_called`, the desktop identity load), never to grant access (D-I1).
- **Signing:** a KMS asymmetric key (`ECC_NIST_P256`, `SIGN_VERIFY`, ES256), separate from `WorkflowTokenKey`, with tokens cached per (principal, site, company) until shortly before `exp`.
  - `GET /.well-known/jwks.json` publishes the public keys (current + next) for rotation.
  - The site validates via JWKS. If a site can't reach the endpoint, it uses a pinned public key in config as the fallback; S-I1 below measures reachability.
- **pegII side:** a second `AddJwtBearer` scheme. The default authorization policy accepts the **hub scheme or the cloud scheme**. **Hub routes are the exception: they carry `HubOnly` (D-I7).**
  - `authEnabled` becomes "hub key set OR cloud issuer configured".
  - `/version` adds `pegii.cloud-auth.v1`.
  - Site config shrinks to **two non-secret values**, the cloud issuer and the site id, which `install.ps1` takes as parameters.
- **Operator switch (added in I1):** the bridge sends cloud tokens to a site only when `Site.cloudAuthEnabled` is on **and** its `/version` advertises `pegii.cloud-auth.v1`. The probe is unauthenticated, so it may confirm the cloud path but never initiate it. Rollout per site: deploy the I2 pegII build → configure the issuer and site id → confirm `/version` → `PATCH /settings/sites/:id {cloudAuthEnabled: true}`.
- **Audit:** the cloud sends `x-correlation-id` on every bridge call. pegII already echoes it and stamps it on error envelopes.

## Token contract (I1 ↔ I2) — single source of truth

Two repos implement opposite ends of one token, so the contract lives here, plus a **shared fixture**. The fixture is a throwaway test key's JWKS and sample tokens (valid, wrong `aud`, expired, bad signature, no `cid`). It is generated once by pegasus and committed verbatim to both repos: `apps/api/src/__fixtures__/pegii-token/` and movemanager `Pegasus.Api.Tests/Fixtures/cloud-token/`. Both test suites verify the same bytes. The tokens are stored as `[header, payload, signature]` segments under `tokenSegments` (join with `.`), and only the public key is written, so the secret scanner has no JWT literal or private key to flag.

- **Header:** `alg: "ES256"`, `typ: "JWT"`, `kid` = the KMS key id (UUID) of the signing key.
- **Signature:** KMS `Sign`, `ECDSA_SHA_256`, `MessageType: RAW` over the ASCII signing input. KMS returns **DER**; the JWT carries **raw R‖S (64 bytes)**, so pegasus converts it.
- **Claims:**
  - Required: `iss` = `https://api.pegasus.dolas.dev` (per environment, from `PEGII_TOKEN_ISSUER`), `aud` = `pegii-site:<Site.id>`, `sub` = `TenantUser.id`, `tid` = tenant id, `ptype` ∈ `user` | `service`, `iat`, `nbf` = `iat`, `exp` ≤ `iat` + 300, `jti` (UUID).
  - Optional: `cid` (the company's `dataSourceKey`), `emp` (int), `wun` (string).
- **Absent `cid`** means the site's **default database** (`ConnectionStrings:PegasusDb`). Every backfilled company has `dataSourceKey = null`, so it mints no `cid`. A present `cid` with no matching `SpokeConnections` entry → 404 `COMPANY_NOT_FOUND`.
- **Validation (pegII):** signature against the JWKS `kid`; `iss` exact; `aud` exact (the site's configured id); `exp`/`nbf` with **≤ 60 s** skew. Unknown claims are ignored.
- **JWKS:** `GET /.well-known/jwks.json` (app root, outside tenant middleware, no auth; the API CDN's default behaviour forwards every path) → `{"keys":[{kty:"EC",crv:"P-256",x,y,kid,alg:"ES256",use:"sig"}]}`, every key id in `PEGII_TOKEN_KMS_KEY_IDS` (current first). `Cache-Control: public, max-age=300`. pegII refreshes on an unknown `kid`.
- **Rotation:** asymmetric KMS keys have no automatic rotation. To rotate, add a new key, publish both ids, switch signing to the new id, then remove the old one after token lifetime plus JWKS cache age.

## Company routing in pegII

- **Per-request database selection:** a scoped `PegasusDbContext` factory resolves the cloud token's `cid` → `SpokeConnections[dataSourceKey]`.
  - A token with no `cid`, or a hub-scheme token, uses `ConnectionStrings:PegasusDb`, so single-company sites keep working unchanged.
  - An unknown `cid` → 404 `COMPANY_NOT_FOUND`.
- **Migrations:** the additive migration runner applies to every configured company database, not just `PegasusDb`.
- **Desktop connection lookup** (`/hub/companies/{id}/connection` today) becomes: given a cloud desktop-session token, return the connection for the token's `cid`. Authorization is implicit: the cloud only mints a `cid` the user is a member of.

## Membership & attribution sync

- **pegII:** `GET /api/v1/pegii/salesmen?active=` for a company (cloud token, routed by `cid`). The salesman view already carries `email` and `isActive`; a list endpoint is new.
- **Cloud sync** (I3: **on demand only**, per company, from Settings → Companies; minted as the clicking admin; a scheduled run is deferred until there's a reason):
  - Match a `TenantUser` (human, not deactivated) to a salesman by email, then by `win_username`, and write or refresh `CompanyMembership.employeeCode` / `legacyWindowsUsername`.
  - **Ambiguity links nobody**, in either direction (a user matching several employees, or several users matching one employee); it is reported.
  - Unmatched users are listed in Settings → Companies; the fix is their Windows username on Settings → Users, then re-sync.
  - A terminated or inactive employee is unlinked (`INACTIVE`) and kept, never deleted. A first-sync match to only a terminated employee is recorded `INACTIVE` too.
  - **No direct cloud→MSSQL access** (master-plan rule).
- **Service accounts** (workflow runtimes, API clients) map to the company's system employee: default **1001 "PEGASUS GENERATED"** (NW, verified in Phase 0 S7), set per company as `Company.systemEmployeeCode` (no default in code). A per-service-account override is deferred (Steve, 2026-10-05).

## Desktop sign-in through the cloud

1. MoveManager opens the Cognito Hosted UI in the system browser (PKCE, loopback redirect), on a **new** public app client.
2. With the Cognito tokens, the desktop calls `POST /api/v1/desktop/session {companyId?}`.
   - The cloud lists the user's memberships (the company picker).
   - For the chosen company, it returns a pegII token (`aud` = that company's site, `cid`, `wun`/`emp`) plus the site URL.
3. The desktop calls the site with that token for the connection, then loads identity by `wun`, as `LoadApiIdentity` does today.
   - A tenant admin without an employee row gets the synthesized Wizard path, gated by a cloud role instead of `CanAccessAllCompanies`.
4. Token refresh rides the Cognito refresh token.
5. SSO tenants get desktop SSO for free.

---

## Phases

| Phase     | Repo        | What                                                                                                                                                                                                                                                                                                                                                                     | Unblocks                              |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| **I1 ✅** | pegasus     | `Site` / `Company` models + backfill (`CompanyMembership` moved to I3); KMS signing key + JWKS endpoint; `lib/pegii-token.ts` minting; `pegii-api-client` sends the cloud token (plus `x-correlation-id`) when the site advertises `pegii.cloud-auth.v1`, else falls back to today's path                                                                                | I2                                    |
| **I2 ✅** | movemanager | the cloud JWT scheme (JWKS + pinned-key fallback); hub routes `HubOnly` (D-I7), cloud-facing routes hub-or-cloud; `pegii.cloud-auth.v1`; per-request company routing by `cid`; multi-database migration runner. **Built on top of** the NW Phase 5 branch (`feat/order-read-normalization-and-search`, after `149c4c82`; no rebase), so the branch pushes once with both | NW Phase 5 push; QMM's second company |
| **I3**    | both        | the `salesmen` list endpoint (`pegii.salesmen.list.v1`); `CompanyMembership` + the on-demand membership sync (email, then Windows username; ambiguity links nobody) in Settings → Companies; `emp`/`wun` on user tokens from a LINKED membership; service accounts keep the company's `systemEmployeeCode` (per-account override deferred). No cron.                     | NW Phases 6–7 attribution             |
| **I4**    | both        | the new Cognito app client (desktop); `POST /desktop/session`; MoveManager Hosted-UI sign-in + cloud company picker; site connection lookup by `cid`                                                                                                                                                                                                                     | I5                                    |
| **I5**    | movemanager | retire the on-prem hub (`hub_user`, `hub_company`, `/auth/login`, hub admin endpoints) once every API-mode site is on I4; the cloud company registry is authoritative                                                                                                                                                                                                    | I6                                    |
| **I6**    | movemanager | retire `salesman` password logins in the desktop's direct-database mode; cloud identity becomes the only user store                                                                                                                                                                                                                                                      | —                                     |

**Spikes before I1/I2 (answered by Steve, 2026-10-02):**

- **S-I1 ✅** NW's and QMM's servers **can** reach `https://api.pegasus.dolas.dev/.well-known/jwks.json`. JWKS is the default; the pinned key stays only as a fallback.
- **S-I2 ✅** QMM-US and QMM-CA are two databases on the **same host and the same SQL Server instance**, and one pegII API instance reaches both.
  - ⇒ One `Site` serves both QMM companies.
  - `cid` routing is a choice between two `SpokeConnections` entries on one instance.
  - No second tunnel, VPN peer or API install.
- **S-I3 ✅** Salesman rows have usable `email` and `win_username` values, so the sync can match on both (email first).

## Effect on the NW pulse-texting plan

- **Phase 5:** the movemanager commit `149c4c82` stays unpushed until I2. Its routes are unchanged, but they gain the cloud scheme and company routing, and NW's rollout becomes "set the site id + issuer" instead of provisioning a hub service user and a secret.
- **Phases 6–7 (tasks, memos):** writes take `created_by`/`who_called` from the token's `emp`, falling back to the company's system employee for service accounts. This replaces the fixed 1001 assumption.
- The Phase 4 hub-service-user path (`lib/pegii-auth.ts`, `pegiiApiKeyRef`) **stays as the fallback** until I5, then is removed.

## Risks

- **Cognito app clients:** editing an existing `UserPoolClient` wiped its IdPs and caused a 22-hour SSO outage (#518). I4 **adds a new client** and touches no existing one.
- **The trust anchor:** the signing key becomes pegII's trust anchor. Use a KMS key policy limited to the API role, `kid`-based rotation with an overlapping JWKS, and short `exp` (≤ 5 min).
- **Tenant isolation:** the new models must pass the tenant-isolation suite. `cid` must be validated against the token's `tid` at mint time; a `cid` from another tenant can never be minted.
- **Cloud outage = no desktop sign-in** (accepted, D-I5). Sessions already open keep working until their token expires (refresh needs Cognito).
- **Multi-database migrations** (I2) run DDL against more databases per site. Keep the additive-only guard; a failure in one company's database must not block the others.
- **Schema drift between company databases is normal** (QMM lacks views that NW has). Company routing must surface a clear per-company error, not a generic 500.

## Open questions (not blocking I1/I2)

- Per-company roles (`CompanyMembership.roleNames`) vs tenant-level roles only. Start tenant-level and add per-company roles when a customer needs a person to be admin in one company and read-only in another.
- Intercompany billing and shared resource pools: separate feature plans, enabled by this model, not designed here.
- Whether one Cognito user ever needs `TenantUser`s in **several** tenants (contractors). Not needed for D-I3; today's `@@unique([tenantId, email])` stays.
