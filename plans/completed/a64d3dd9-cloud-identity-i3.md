# Cloud identity I3: company memberships, the salesmen list, attribution claims

**Status:** IMPLEMENTED 2026-10-05 (approved the same day). The movemanager half is on branch `feat/cloud-identity-i3-salesmen-list` @ `f555bed3`, waiting for the Windows test tiers before it lands on `dev`.

## Context

I1 (cloud-issued pegII tokens, `Site`/`Company`) and I2 (pegII trusts them and routes by `cid`) are live. QMM's site runs cloud auth as of 2026-10-05. The NW and RVS rollouts are on hold at Steve's request.

The cloud still can't say **which pegII employee** a cloud user is in a given company:

- User tokens carry no `emp` or `wun`. Only service tokens carry `emp`, from `Company.systemEmployeeCode`.
- `CompanyMembership` was designed but **never built**. `plans/todo/cloud-identity-and-companies.md` credits it to I1, which is wrong.
- The cloud's `GET /pegii/salesmen` list is an empty in-memory stub (`services/pegii-salesmen.ts`) because pegII has no list endpoint.

NW pulse Phases 6–7 (tasks and memos) need `created_by`/`who_called` attribution, which comes from these claims. I3 delivers that link.

**Decisions (Steve, this session):**

- **Sync trigger:** on demand only. An admin clicks "Sync employees" per company, and the bridge call is minted as that admin (`ptype=user`). There is no cron, and no new principal.
- **Admin view:** a new **Settings → Companies** page.
- **Service-account employee override:** deferred. The company-level `systemEmployeeCode` is enough for now.

## Part A — movemanager (lands first on `dev`, ships to alpha by auto-update)

Plan file `plans/todo/cloud-identity-i3-salesmen-list.md` (repo format), archived on landing.

- **`GET /api/v1/pegii/salesmen?active=&cursor=&limit=`**: a new `Pegasus.Api/Endpoints/SalesmanListEndpoints.cs`, copying `OrderSearchEndpoints.cs`.
  - Keyset cursor on `code`; `limit` 1–500, default 200; fetch `Limit+1` rows.
  - Response `{items, nextCursor}`, in a contract record under `Contracts/`.
  - Default auth policy (hub or cloud), not `HubOnly`. Mapped inside `if (authFlags.AuthEnabled)`.
- **Item shape:** `code, firstName, lastName, email, winUsername, isActive, dateTerminated, employeeType, branch`.
  - `win_username` is mapped deliberately on the list projection only; the serialized DTO stays unchanged.
  - `password` is never mapped, and a test asserts that no password-like field appears.
  - Trim `win_username` and `email_address` (the `SpokeUserDirectory` precedent).
- **Repository:** `ISalesmanListRepository`, scoped, on `PegasusDbContext`, so company routing by `cid` comes for free. Don't copy `SpokeUserDirectory`'s explicit connection string.
- **Capability:** `pegii.salesmen.list.v1` in `VersionEndpoints.ComputeCapabilities`, in the `authEnabled` block. Update the pinned `VersionEndpointTests`, the docs list in `Program.cs`, and `deploy/README.md`.
- **Tests:**
  - Endpoint tests (`WebApplicationFactory` + fake repository, like `OrderSearchEndpointTests`): paging, the `active` filter, 401.
  - A cloud-token routing test using `CloudTestHost`'s `RoutingRecorder`: a token with `cid` lands on that company's database.
  - A `[SqlServerFact]` repository test with sentinel codes.
  - The full Windows `scripts/test.ps1` run before commit (repo rule).

## Part B — pegasus (one worktree, one PR, after Part A is on alpha)

### Data

- **New model `CompanyMembership`:**
  - Fields: `id, tenantId, companyId, tenantUserId, employeeCode Int?, legacyWindowsUsername String?, status (LINKED | INACTIVE), matchedBy (EMAIL | WIN_USERNAME), lastSyncedAt, createdAt, updatedAt`.
  - `@@unique([companyId, tenantUserId])`.
  - A hand-written **partial** unique index on `(company_id, employee_code) WHERE status = 'LINKED'`.
    - Partial, because INACTIVE rows are kept forever: when user B takes over an employee user A once held, the retained (A, 100) row must not block LINKED(B, 100).
    - It lives in the migration's "Hand-written" block, like the existing partial indexes.
  - Add it to `TENANT_SCOPED_MODELS` (`lib/prisma.ts`) and the isolation suite.
  - A migration under `apps/api/prisma/migrations/`. **No backfill:** the first sync creates the rows.
- Unmatched users are **computed** (active, non-service `TenantUser`s with no LINKED membership in that company), not stored.

### Gateway and bridge

- Add `listSalesmen({active})` to `gateways/salesman.gateway.ts` and `pegii-salesman.gateway.ts`. It pages through the pegII cursor with an explicit `limit=500` (cap 50 pages) and maps through `pegii-salesman.mapper.ts` (DTO gains `winUsername`). Before calling, it checks `requirePegiiCapabilities(PegiiCapabilities.SalesmenList)` and returns 503 `PEGII_API_CAPABILITY_MISSING` on an older site.
- Replace the stub in `handlers/pegii-runtime.ts` `GET /salesmen` with the gateway call, and delete the stub's store and list (`services/pegii-salesmen.ts`).
  - `toSalesmanResponse` keeps its current shape: `winUsername` is **not** exposed to workflows.
  - SDK `list_salesmen` now returns live data with no code change. Patch bump **0.45.1**: CHANGELOG/README note covering the capability and the 503. Tag and publish after merge (standing rule).
  - **Behavior change:** today the stub returns `[]` everywhere. After I3, a site **without** cloud auth (NW and RVS until their rollouts) gets no credential from the bridge, pegII answers 401, and the route returns a 5xx. A site on an older build returns 503 `PEGII_API_CAPABILITY_MISSING`.
    - Say so in the CHANGELOG.
    - No workflow in `workflows-stdlib` or `~/repos/pegasus-workflows` calls `list_salesmen` (grepped). Before merge, also check prod's published workflow versions for it.
  - **Discoverability surfaces** to check for "returns []" or stub wording: SDK README, `~/repos/pegasus-workflows/CLAUDE.md`, the MCP `pegasus://reference/*` resources, and OpenAPI.
- `lib/pegii-request-context.ts`: factor `resolvePegiiCaller(c)` so a caller can be built for a **named company**: `resolvePegiiCaller(c, { companyId })`, which loads that company plus its site, tenant-scoped. Today's default-company path is unchanged. The sync needs this to reach `QMM-USA` (`cid=PegQMMUSA`).

### Sync

- **`services/company-membership-sync.ts`**, a pure function plus a repository, unit-tested.
  - **Input:** all salesmen of the company (active and inactive), plus the tenant's non-service `TenantUser`s.
  - **Match order:**
    1. Case-insensitive, trimmed **email**.
    2. Otherwise `TenantUser.legacyWindowsUsername` ↔ `winUsername`.
  - **Ambiguity** applies in both directions; neither case is linked, and both are reported:
    - one user matches more than one salesman;
    - more than one user matches the same salesman.
  - **Writes:**
    - An active match is upserted LINKED (`employeeCode`, `legacyWindowsUsername` = the salesman's `winUsername`, `matchedBy`).
    - A previously LINKED row whose salesman is now inactive, terminated or gone becomes **INACTIVE**, never deleted.
    - On a first sync, a user whose only match is an inactive or terminated salesman gets an **INACTIVE** row, so the view shows "matched, but terminated" rather than "unmatched".
  - **Errors:** pegII's `COMPANY_NOT_FOUND` (404: the `cid` isn't in the site's `SpokeConnections`) and `COMPANY_SCHEMA_UNAVAILABLE` (503) surface from the sync route as legible errors that name the company, alongside the capability-missing 503.
  - **Returns** `{linked, newlyLinked, deactivated, unmatchedUserIds, ambiguous[]}`.
  - The fix for an unmatched user is the existing Users-page `legacyWindowsUsername` editor, then re-sync. No new manual-edit endpoint.
- **Routes** in `handlers/settings-companies.ts` (existing actions, no new Cedar actions):
  - `POST /settings/companies/:id/membership-sync` (`UpdateSettings`). Mints as the calling admin. Logs a summary line with no PII beyond counts.
  - `GET /settings/companies/:id/memberships` (`ReadSettings`): members joined to user email/name, plus the computed unmatched list.

### Token claims

- In `lib/pegii-token.ts` and `pegii-request-context.ts`, a **user** principal with a LINKED membership in the target company now gets `emp` = `employeeCode` and `wun` = `legacyWindowsUsername`. Service tokens are unchanged (`emp` = `systemEmployeeCode`).
- Both claims are attribution only (D-I1), and pegII already parses them (`CloudCaller`).
- `PegiiTokenClaims` gains `wun?`.
- A membership change takes effect within the token cache's ≤5 min. That's documented and accepted.
- **Don't regenerate `apps/api/src/__fixtures__/pegii-token/`.** `wun` is already optional in the contract, and pegII parses it. The fixture is shared byte for byte with movemanager.

### UI

**`apps/tenant-web/src/routes/settings.companies.tsx`**, registered in `router.tsx` under the admin settings layout, with queries in `api/queries/companies.ts`:

- A companies table: code, display name, `dataSourceKey`, default, and an editable system employee code through the existing `PATCH /settings/companies/:id`.
- Per company:
  - A **Sync employees** button that shows the result summary.
  - A linked-members table (user, employee code, Windows username, status, matched by).
  - An unmatched-users list linking to Users.
- An error state for 503 (site lacks the capability or isn't reachable).

### Docs

- **OpenAPI:** the two new routes in `lib/openapi-spec.ts`.
- **Design doc:** correct the I1 row (no `CompanyMembership`) **in this same PR**; the fix has already slipped once. Mark I3 done, and replace "membership replaces CanAccessAllCompanies" wording where I3 changes it.
- **Agent files:** update `DECISIONS.md`.
- **Plan file:** seed this plan as `plans/todo/cloud-identity-i3.md` into the worktree via `workstream-start` (plan and code in one PR). Move it to `plans/completed/` before opening the PR.

## Verification

- **movemanager:**
  - Unit, endpoint and routing tests green; `scripts/test.ps1` on Windows.
  - After alpha publishes: `/version` on QMM lists `pegii.salesmen.list.v1`.
- **pegasus:**
  - `npm test -w apps/api`: sync unit tests (email match, `win_username` fallback, ambiguity, deactivation, idempotent re-run), the isolation suite, and route tests.
  - Token tests for `emp`/`wun` on user tokens.
  - tenant-web tests and typecheck; coverage ratchet.
- **Live on QMM (the only cloud-auth site), using a QMM tenant-admin session:**
  1. Sync `QMM-CANADA` and confirm the linked count makes sense.
  2. Sync `QMM-USA`. This is the **first real `cid=PegQMMUSA` request**, and it proves company routing end to end.
  3. `GET /pegii/salesmen?active=true` returns live rows.
- **Afterwards:** NW pulse Phases 6–7 consume `emp` for `created_by`/`who_called`. NW needs its rollout (on hold) and `systemEmployeeCode = 1001` on its company.

## Implementation notes (2026-10-05)

**As built, and where it differs from the plan above:**

- **OpenAPI:** the two new admin routes are **not** in `lib/openapi-spec.ts`. That spec (and its coverage test) is the API-key / M2M surface, and none of the session-only `/settings/*` routes are in it. Only the `/pegii/salesmen` description changed (live directory, 503 on an old site).
- **`CompanyMembership.employeeCode` is required** (not `Int?`): the sync always has one.
- **Release-first apply:** the plan names every user whose LINKED row changes (`releaseUserIds`). The repository flips those to INACTIVE first, then upserts. This lets two users swap employees in one sync without tripping the partial index. A real-DB test covers it.
- **Token cache key** now includes `emp`/`wun`, so a sync takes effect on the next call instead of within 5 minutes.
- **`isPegiiNotFound` no longer null-maps the site's `COMPANY_NOT_FOUND`.** Before this, a by-id read for a company the site doesn't know answered "Salesman not found". `pegiiApiErrorToHttp` maps `COMPANY_NOT_FOUND` → 404 and `COMPANY_SCHEMA_UNAVAILABLE` → 503 with their own codes.
- **The sync refuses with 409 `SITE_CLOUD_AUTH_DISABLED`** while the company's site has cloud auth off (the advisor caught this). Without the guard, NW and RVS admins on hold sites would get a misleading capability or 502 error, because the bridge sends those sites no credential.
- **The sync considers** human, not-deactivated users (PENDING included), and never touches rows of users outside that set.
- **Prod check before merge:** the only published workflow declaring `ReadSalesman` is `weichert-milestone-update` (0.6.x, GLOBAL plus an NW copy). It calls `get_salesman` only, which is unchanged, so `list_salesmen` going live breaks no caller.

**Tests:**

- API: full suite green (275 files, 3913 tests), including:
  - the membership repository against the worktree's Postgres (swap, takeover, partial index, isolation)
  - planner units
  - route, gateway and token tests
- tenant-web: page tests (sync, errors).
- SDK: 440 green.
- movemanager: Api.Tests 161; Infrastructure.Tests 231, with the SQL tests run against Docker SQL Server.
