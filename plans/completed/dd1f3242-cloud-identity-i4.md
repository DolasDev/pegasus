# Cloud identity I4: desktop sign-in through the cloud

**Status:** APPROVED 2026-10-06 (Steve; items A–F as recommended). **Part A (pegasus) IMPLEMENTED 2026-10-06** on `feat/cloud-identity-i4`; see "Implementation notes" at the end. Part B (movemanager) is next, in its own repo-format plan file `plans/in-progress/cloud-identity-i4-desktop-sign-in.md`.

**Upstream:** design doc `plans/todo/cloud-identity-and-companies.md` (Phase I4, "Desktop sign-in through the cloud", Risks), and I1–I3, all live. **Downstream:** I5 (retire the on-prem hub).

## Context

MoveManager's API-mode sign-in today:

1. Hub login (`POST /auth/login`, PBKDF2 `hub_user`). This returns a 480-minute HS256 token that is never refreshed.
2. The hub company picker.
3. `GET /hub/companies/{id}/connection` (`HubOnly`, keyed by the hub's integer id).
4. A direct SQL connection, then `LoadApiIdentity(win_username)`.
5. If there's no employee row, a synthesized Wizard identity, but only when the hub user has `CanAccessAllCompanies`.

I4 replaces this with Cognito sign-in (the Hosted UI in the system browser, PKCE). The cloud then decides which companies the person may open, and mints a pegII token for the chosen company. The site serves the connection for that token's `cid`.

**Desktop SSO is not automatic.** IdPs are attached to app clients at runtime, and only the tenant client gets them today. I4 has to wire them onto the desktop client too.

**A correction to the design doc.** The doc says "authorization is implicit: the cloud only mints a `cid` the user is a member of". That is false today. `resolvePegiiCaller` mints `ptype=user` + `cid` for the default company for any tenant-web user, whether or not they have a membership. Those bridge tokens stay server-side, but a pegII "give me the connection string" route that accepted any cloud user token would be gated by nothing. I4 therefore adds:

- a **mint-side access check**, which is where "membership becomes an access decision" actually happens;
- a **scope claim**, so the site serves connections only to desktop-session tokens.

**Decided this session (Steve, 2026-10-06):**

- **Site URL:** the desktop keeps its own `My.Settings.ApiBaseUrl`. No `Site.desktopBaseUrl` (YAGNI). If the desktop points at the wrong site, it fails closed: the token's `aud` is `pegii-site:<id>`, so that site answers 401.
- **Redirect:** a loopback `http://localhost:<port>/callback` on a temporary `HttpListener` (RFC 8252). Cognito needs exact URLs, so register 3 fixed ports.
- **Wizard gate:** the `tenant_admin` role. `tenant_admin` also sees every active company in the picker.

## Approval items (recommendations marked)

- **A. Discriminator claim:** `scp: "desktop"`, minted only by `/desktop/session`. Bridge tokens stay unscoped. pegII ignores unknown claims, so this is additive. Update the contract table, and add a **new** fixture token instead of regenerating the shared fixture bytes.
- **B. Company list:**
  - Normal users see companies with a LINKED membership.
  - `tenant_admin` sees all active companies.
  - Both are limited to sites with `cloudAuthEnabled`. INACTIVE memberships and on-hold sites are excluded.
  - Minting for a company outside that list → 403 `COMPANY_ACCESS_DENIED`; a company on a site with cloud auth off → 409 `SITE_CLOUD_AUTH_DISABLED` (the I3 code).
- **C. Hub login stays** as today's `Api` connection mode until I5. Cloud sign-in is a new `ConnectionMode = "Cloud"` (Settings radio button). Nothing is auto-detected, and no site is switched implicitly.
- **D. Desktop client token validity:** ID/access 1 h, refresh 30 d, token revocation on (mobile uses 8 h / 8 h / 30 d). A shorter ID token is fine because the desktop renews silently.
- **E. `/validate-token`** accepts the desktop id when it's set, but doesn't **require** it: it filters out a missing id instead of answering 500, so a missing env var can't break tenant-web.
- **F. pegII token lifetime stays ≤ 5 min (contract).** The desktop re-mints through `/desktop/session` before `exp`, and refreshes Cognito tokens with the refresh token when the ID token expires.

## Part A — pegasus (one worktree, one PR; deployable with no consumer)

### Infra (`packages/infra/lib/stacks/cognito-stack.ts`)

- **New `desktop-app-client`**, cloned from the mobile client (573–587):
  - Public client (`generateSecret: false`), authorization-code grant, `email`/`openid`/`profile` scopes.
  - Callback URLs `http://localhost:{47615,47616,47617}/callback`; logout URL on the same ports at `/signed-out`.
  - The validity from item D.
  - **No other `UserPoolClient` is touched.**
- **Plumbing, mirroring mobile:**
  - SSM `/pegasus/desktop/cognito-client-id`.
  - `CfnOutput PegasusCognitoDesktopClientId` plus a pinned export.
  - `api-stack.ts` imports it as `COGNITO_DESKTOP_CLIENT_ID`.
- **Tests (`cognito-stack.test.ts`):** a desktop `describe` block, and a guard that the stack has **exactly 4** `AWS::Cognito::UserPoolClient` resources. The guard also snapshots the admin, tenant and mobile client property sets, so a future accidental edit fails CI (#494/#518 has no automated guard today).
- **Gate before merge:** `cdk diff` on staging shows **zero** changes to the existing three clients.

### Token audience allowlists

- `apps/api/src/middleware/tenant.ts:53–66`: add `COGNITO_DESKTOP_CLIENT_ID` to `audience` (filtered when unset). `token_use === 'id'` stays, so the desktop sends its **ID** token.
- `apps/api/src/handlers/auth.ts:429–447` (`/validate-token`): the same change (item E).
- The pre-token Lambda needs no change: it branches only on the admin client.

### SSO IdPs on the desktop client

- `apps/api/src/lib/cognito-app-client.ts` + `handlers/sso.ts` (~61, 268–279, 675–692): add, remove and reconcile across **all tenant-facing client ids** (tenant + desktop, desktop skipped when unset). Factor this as `tenantFacingClientIds()` instead of a second copy.
- `reconcileTenantAppClientFromEnv` (225–240, which runs on `POST /api/auth/resolve-tenants`) self-heals the desktop client the same way. This matters because a later CDK edit to the desktop client wipes its IdPs exactly as it did the tenant client's, and the runtime reconcile is the only repair.
- **Tests:** the existing sso/app-client tests are extended to assert both clients receive Describe-then-Update, and the tenant client's behaviour is unchanged.

### `POST /api/v1/desktop/session`

- **Handler:** new `apps/api/src/handlers/desktop.ts`, mounted on `v1` in `app.ts` (Cognito only).
  - There is no `requirePermission`. This follows the `/me` and `/device-tokens` precedent: the access decision is the membership check below.
  - A service account (`isServiceAccount`) → 403.
- **Request:** `{companyId?: string}`, validated with Zod.
- **Response:**
  ```
  { companies: [{id, code, displayName, siteId, isDefault, employeeCode?, winUsername?}],
    bootstrapAllowed: boolean,                 // roleNames includes 'tenant_admin'
    session?: { companyId, siteId, token, expiresAt } }   // only when companyId given
  ```
- **Company list:** built per item B. Without `companyId`, the response is the picker list only.
- **Access check:** with `companyId`, the company must be in that list, else 403 `COMPANY_ACCESS_DENIED`.
- **Minting:** `getPegiiTokenMinter().mint(...)` with `cid` = that company's `dataSourceKey`, and `emp`/`wun` from the LINKED membership (none for an unlinked `tenant_admin`). It also sets the new **`scope: 'desktop'`** → `scp` claim.
- **New repository method:** `createCompanyMembershipRepository(db).listForUser(tenantUserId)` (LINKED rows plus company and site). Tenant-scoped.
- **`lib/pegii-token.ts`:** `PegiiTokenClaims` gains `scp?: 'desktop'`, and the cache key includes it. Bridge mints are unchanged.
- **Fixture:** a **new** file `apps/api/src/__fixtures__/pegii-token/desktop-tokens.json`, signed with the same throwaway key, holding a valid desktop token with `cid`, one without `cid`, and a bridge-shaped token with no `scp`. The existing fixture files are not regenerated.
- **Not in `openapi-spec.ts`:** that's the M2M/API-key surface (recorded in I3).
- **Tests:** route tests covering:
  - a LINKED user gets a token with `cid`/`emp`/`wun`/`scp`;
  - an unlinked non-admin → 403;
  - `tenant_admin` gets every company and `bootstrapAllowed`, with no `emp`;
  - a hold site → 409;
  - a service account → 403;
  - the default company (`dataSourceKey` null) → a token with no `cid`;
  - cross-tenant `companyId` → 404;
  - the `listForUser` repository against the worktree Postgres, plus the isolation suite.

### Docs (same PR)

- **Design doc:** fix the "authorization is implicit" sentence (mint-side check + `scp`); add `scp` to the claim table and the contract; replace "SSO tenants get desktop SSO for free" with "IdPs wired onto the desktop client". Record decisions A–F as D-I8, and mark I4 cloud half done on merge.
- **`DECISIONS.md`:** desktop session = membership as access decision + `scp`.
- **`GOTCHAS.md`:** the existing-client guard test, and that the desktop client needs IdP reconcile.

## Part B — movemanager (after Part A is deployed; lands on `dev` without a PR, per the repo's rule)

### Pegasus.Api (net8, tests run on Linux)

- **`Security/AuthSchemes.cs`:** a new policy `AuthPolicies.CloudDesktop` = Cloud scheme only + `ptype == user` + `scp == desktop`.
- **New `Endpoints/DesktopEndpoints.cs`:** `GET /api/v1/pegii/desktop/connection` (`CloudDesktop`), which returns `ConnectionInfoDto {data_source_key, connection_string}` for the token's `cid`.
  - **Absent `cid`** → `ConnectionStrings:PegasusDb`, so the default company (QMM-CANADA, NW, RVS) can sign in.
  - Unavailable → 503 `COMPANY_SCHEMA_UNAVAILABLE`; unknown → 404 `COMPANY_NOT_FOUND` (reusing `CompanyConnectionResolver`/`CompanyAvailability`).
  - Mapped only when cloud auth is configured.
- **`/hub/companies/{id}/connection` stays `HubOnly`** (D-I7).
- **`/version`:** add `pegii.desktop-session.v1` (update pinned `VersionEndpointTests`, the `Program.cs` docs list, and `deploy/README.md`).
- **Tests (`Pegasus.Api.Tests/CloudAuth/`):**
  - the fixture desktop token → 200 with the routed connection;
  - no `cid` → default;
  - a bridge token (no `scp`) → 403;
  - a `service` token → 403;
  - a hub token → 401/403;
  - an unknown `cid` → 404.
    The new fixture `desktop-tokens.json` is copied verbatim.

### Desktop (net48; Windows tiers only)

- **Testable logic in C# (`Pegasus.WebClient`):**
  - `Cloud/PkceSession` (verifier, S256 challenge, `state`).
  - `Cloud/CognitoTokenClient` (`/oauth2/token` for code and refresh).
  - `Cloud/DesktopSessionClient` (`POST /desktop/session`).
  - `Cloud/CloudTokenSource`, an `IBearerTokenSource` that returns a cached pegII token and re-mints within 60 s of `exp`. It refreshes Cognito tokens on expiry; if refresh fails, it raises a re-sign-in signal.
  - `PegasusApiClient` asks the token source **per request** instead of a fixed header (the hub path keeps `SetBearerToken`).
- **Loopback listener:** `Cloud/LoopbackRedirectListener` (an `HttpListener` on the first free of the 3 ports; `state` validated; a 5-minute timeout). The browser is launched with `Process.Start` + `UseShellExecute=True` (precedent `MsixUpdateChecker.vb:172`).
- **Tenant selection** (multi-tenant native users fail pre-token without an `AuthSession`): an email prompt → `POST /api/auth/resolve-tenants` → (if more than one) pick → `select-tenant` → Hosted UI with `login_hint` / `identity_provider`. This copies `apps/mobile/src/auth/authService.ts:80–118`.
- **Remember me:** the refresh token is stored with `ProtectedData` (CurrentUser). In Cloud mode no password is saved.
- **`Program.vb`:** a new `TryCloudModeLogin`:
  1. Sign in.
  2. Pick from `companies` (a `CompanyPickerForm` variant fed from the session response; Add Company / Import Users hidden).
  3. Mint.
  4. `GET /desktop/connection`.
  5. `LoadApiIdentity(wun ?? cognito email-derived username)`.
  6. A mid-session switch re-runs steps 2–5.
- **Identity:** `SpokeIdentityResolution` takes `bootstrapAllowed` in place of `CanAccessAllCompanies` in Cloud mode. This is a domain change, with unit tests.
- **Config (`app.config`):** `PegasusCloud:BaseUrl`, `Cognito:Domain`, `Cognito:DesktopClientId` (non-secret; prod defaults; staging override).
- **Tests (`Pegasus.Tests.Unit`, xUnit/Moq):** PKCE vectors, state mismatch, the token-source re-mint/refresh timing, the session client's 403/409 handling, the listener's state check, and `SpokeIdentityResolution` cloud cases. `scripts/test.ps1` must be green on Steve's Windows box before commit.

## Files

- **pegasus:**
  - `packages/infra/lib/stacks/{cognito-stack,api-stack}.ts` and `__tests__/cognito-stack.test.ts`
  - `apps/api/src/{app.ts, middleware/tenant.ts, handlers/auth.ts, handlers/sso.ts, handlers/desktop.ts (new), lib/cognito-app-client.ts, lib/pegii-token.ts, repositories/company-membership.repository.ts}` + tests
  - `apps/api/src/__fixtures__/pegii-token/desktop-tokens.json` (new)
  - the design doc, `DECISIONS.md`, `GOTCHAS.md`
- **movemanager:**
  - `Pegasus.Api/{Security/AuthSchemes.cs, Security/ApiAuthentication.cs, Endpoints/DesktopEndpoints.cs (new), Endpoints/VersionEndpoints.cs, Program.cs}`
  - `Pegasus.Api.Tests/CloudAuth/*` + `Fixtures/cloud-token/desktop-tokens.json`
  - `Pegasus.WebClient/Cloud/*` (new) and `PegasusApiClient.cs`
  - `Pegasus.Domain/Auth/SpokeIdentityResolution.cs`
  - `MoveManager/{Program.vb, _Masters/CompanyPickerForm.vb, _zUnsorted/SettingsForm.vb, LoginForm.vb, app.config, My Project/Settings.settings}`
  - `Pegasus.Tests.Unit/*`

## Risks

- **Cognito client edits (#518):** only an addition; a CI guard plus a zero-diff `cdk diff` on the existing clients.
- **API clients the desktop uses after sign-in** (Warehouse, Projects, Outbox): they now carry a cloud token with `cid`. Before building, verify their routes use the default (hub-or-cloud) policy, not `HubOnly`; any `HubOnly` one is an approval item, not a silent change. Side benefit: they finally route to the picked company instead of the default DB.
- **Port collisions on 47615–47617:** three are registered, and an error names them if all are busy.
- **`scp` is the only thing between a bridge token and a connection string.** Covered by a negative test in both repos against the same fixture bytes.

## Verification

- **pegasus:**
  - `npm test -w apps/api` (route, token, repository, isolation, sso reconcile)
  - `npm test -w packages/infra` (the client guard)
  - typecheck; the coverage ratchet
  - staging `cdk diff` (zero changes to existing clients)
- **After deploy:** SSM has the desktop client id; `POST /desktop/session` with a QMM ID token lists QMM-CANADA + QMM-USA (Steve = `tenant_admin`, `bootstrapAllowed`). Minting for QMM-USA decodes to `cid=PegQMMUSA`, `scp=desktop`. After a `resolve-tenants` call, `describe-user-pool-client` on the desktop client lists QMM's Entra IdP.
- **movemanager:**
  - Linux: `Pegasus.Api.Tests` (`dotnet restore … --configfile ~/.nuget/nugetorg-only.config`, then `dotnet test --no-restore`).
  - Windows: `scripts/test.ps1` (Steve).
- **Live on QMM, after alpha:**
  1. Cloud mode sign-in with Microsoft.
  2. The picker shows both companies.
  3. QMM-USA opens on `PegQMMUSA` (Steve → Wizard bootstrap).
  4. A linked QMM employee opens on their own employee row.
  5. Leave it idle for more than 5 minutes; an API-backed screen still works (the re-mint).

## Implementation notes — Part A (2026-10-06)

**As built, and where it differs from the plan above:**

- **Fixture:** a separate directory, `apps/api/src/__fixtures__/pegii-token-desktop/`, with its **own** throwaway key and `jwks.json`. The plan said "signed with the same throwaway key", but the I1 fixture never wrote its private key, so that wasn't possible.
  - Generator: `apps/api/scripts/generate-pegii-desktop-token-fixture.ts`.
  - Samples: `desktop`, `desktopNoCid`, `desktopUnlinked` (serve); `bridgeUser`, `serviceScoped`, `otherScope` (refuse).
  - `expectDesktopConnection` states which must be served. pegasus asserts that the verdict equals `ptype=user && scp=desktop`.
  - movemanager copies the directory to `Fixtures/cloud-token-desktop/`.
- **Export name:** the desktop client's pinned export is `<stack>:DesktopAppClientRefExport`; the logical id is the same name. A new api-stack test checks every `Fn::ImportValue` against the real `CognitoStack` exports, because a mismatch synthesizes fine and only fails at deploy. That test caught the first draft's `…:DesktopAppClientRef`.
- **The #518 guard:** `cognito-stack.test.ts` "existing app clients are frozen" snapshots the admin, tenant and mobile clients (`__snapshots__/cognito-stack.test.ts.snap`) and asserts exactly 4 clients. The diff to `cognito-stack.ts` is additions only, so the snapshot equals `main`'s clients.
- **SSO paths:**
  - **Create:** permitting the provider on the desktop client is **best-effort**. A desktop failure logs a warning and does not roll back: the tenant client already lists the provider, and deleting the IdP would poison it. `resolve-tenants` repairs the desktop client on the next sign-in.
  - **Delete:** revokes on **both** clients before deleting the IdP; a failure on either is a 500.
  - **Ids:** `sso.ts` reads the desktop id per call, so tests can stub it. The tenant id stays unconditional, which keeps behaviour unchanged.
  - **Login path:** `reconcileTenantAppClientFromEnv` loops `ssoAppClientIdsFromEnv()` (tenant + desktop). Each client fails open independently.
- **Audiences:** `lib/cognito-audiences.ts` `tenantIdTokenAudiences()` (tenant, mobile, desktop; unset ids filtered out) is used by both `tenantMiddleware` and `/validate-token`. `/validate-token` still requires the tenant and mobile ids, and never the desktop id (item E).
- **Session route:**
  - **Pure rule:** `services/desktop-session.ts` (`desktopCompanies`, `desktopCompanyRefusal`, `canBootstrapDesktop`).
  - **Who may call:** a deactivated user or a service account → 403 `FORBIDDEN`; an unresolved `TenantUser` → 409 `NO_USER`.
  - **Request body:** `.strict()`, so unknown fields → 400.
  - **Hold-site companies:** reported as 409 only to someone who could open the company once its site goes live. Anyone else gets 403, so the route doesn't reveal what exists.
  - **`expiresAt`:** read back from the minted token's `exp` (`pegiiTokenExpiresAt`). A cached token may have as little as 60 s left, and the desktop re-mints before then.
- **Repository:** the method is named `listLinkedForUser`, and it returns a `Map` keyed by `companyId`.
- **Minter:** `scope: 'desktop'` → `scp`. A service account with a scope is refused (`PEGII_PRINCIPAL_UNRESOLVED`). `scope` is part of the cache key, so a bridge token and a desktop token never share a slot.

**Tests:**

- **API: 277 files, 3969 tests, all green.** New coverage:
  - desktop route (12);
  - token scope, cache and fixture;
  - SSO desktop paths (5);
  - env reconcile (2);
  - audiences (tenant middleware + validate-token);
  - `listLinkedForUser` against the worktree Postgres.
- **Infra: 17 files green.** New coverage: desktop client (5), frozen clients (4), api-stack desktop env, and the cross-stack import guard. `api-stack.bundle.test.ts` needs `packages/domain` built first, which is environmental.

**After deploy** (the verification list above):

1. Check `/pegasus/desktop/cognito-client-id` in SSM.
2. Check the IdPs on the desktop client after a `resolve-tenants` call.
3. Mint a QMM-USA session and decode it: `cid=PegQMMUSA`, `scp=desktop`. This needs Steve's QMM ID token.
