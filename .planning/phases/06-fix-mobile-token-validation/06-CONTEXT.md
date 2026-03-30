# Phase 6: Fix Mobile Token Validation - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the AUTH-03 gap: make `POST /api/auth/validate-token` accept mobile Cognito tokens (audience fix), commit the uncommitted BREAK-01 field name fix, align the `Session` type with the API response shape, and add a full unit test suite for the validate-token endpoint. No new features — purely closure of three audit-identified defects.

</domain>

<decisions>
## Implementation Decisions

### Audience Fix (BREAK-02)

- **D-01:** Update `jwtVerify` call in `packages/api/src/handlers/auth.ts` to accept an array: `audience: [tenantClientId, mobileClientId]` where `mobileClientId = process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''`.
- **D-02:** Extend the existing env var guard (`if (!jwksUrl || !tenantClientId)`) to also check `mobileClientId`. If absent, return 500 with `INTERNAL_ERROR` (consistent with the existing guard pattern).
- **D-03:** No separate `/validate-mobile-token` endpoint. One endpoint handles both web and mobile tokens via the audience array.

### Field Name Fix (BREAK-01)

- **D-04:** Commit the working-tree fix in `apps/mobile/src/auth/authService.ts`: request body is `{ idToken }` not `{ token: idToken }`. The code change is already in place — Phase 6 just commits it as part of the fix batch.

### Session Type Alignment

- **D-05:** Add `ssoProvider: string | null` to the `Session` type in `apps/mobile/src/auth/types.ts`. The API `validate-token` response already includes this field; the type was never updated to match.

### Test Coverage

- **D-06:** Write a **full unit test suite** for `POST /api/auth/validate-token` in `packages/api/src/handlers/auth.test.ts`. Coverage must include:
  - Tenant client ID accepted (200 with session claims)
  - Mobile client ID accepted (200 with session claims)
  - Unknown audience rejected (401 UNAUTHORIZED)
  - Expired token (401 TOKEN_EXPIRED)
  - Wrong `token_use` (access token) rejected (401 UNAUTHORIZED)
  - Missing `sub` or `email` claims (401 UNAUTHORIZED)
  - Missing `custom:tenantId` or `custom:role` claims (403 FORBIDDEN)
  - Env vars not set (500 INTERNAL_ERROR)
  - Invalid/unparseable JWT (401 UNAUTHORIZED)
- **D-07:** Tests mock `jwtVerify` from `jose` (already the pattern for isolated unit tests in this file). No real JWTs needed.

### Claude's Discretion

- Exact mock setup for `jwtVerify` (vi.mock pattern vs vi.spyOn)
- Whether to add `extractSsoProvider` helper tests inline or leave that as a side-effect of the validate-token tests
- Commit message structure (one commit vs two — BREAK-01 fix and API fix can be separate or combined)

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit findings (gap source)

- `.planning/v1.0-MILESTONE-AUDIT.md` — BREAK-01, BREAK-02, FLOW-BREAK-01 gap definitions; exact file:line references and fix options evaluated

### Implementation files to change

- `packages/api/src/handlers/auth.ts` — validate-token handler at line ~383; jwtVerify audience at line ~407; env guard at line ~393
- `packages/api/src/handlers/auth.test.ts` — existing test file; validate-token section is absent and must be added
- `apps/mobile/src/auth/authService.ts` — BREAK-01 fix is in working tree (uncommitted); diff shows `{ token: idToken }` → `{ idToken }`
- `apps/mobile/src/auth/types.ts` — Session type; add `ssoProvider: string | null`

### Prior phase context

- `.planning/phases/02-auth-service-layer/02-CONTEXT.md` — D-07: idToken passed to validate-token then discarded; auth service shape
- `.planning/phases/01-infrastructure-foundation/01-CONTEXT.md` — COGNITO_MOBILE_CLIENT_ID single env var pattern; mobile client shares one client across all tenants

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `getJwks()` singleton in `auth.ts` — already imported and used; no changes needed
- `deriveIssuer(jwksUrl)` helper — already used in jwtVerify call; no changes needed
- `extractSsoProvider(payload)` helper — already called in validate-token response; Session type just needs to match
- `vi.stubEnv` pattern — used in mobile-config tests; same pattern for validate-token env setup

### Established Patterns

- Env guard pattern: `if (!jwksUrl || !tenantClientId)` → 500 INTERNAL_ERROR — extend to include `mobileClientId`
- Test file structure: `describe` blocks per endpoint with `beforeEach`/`afterEach` for env stubs and mock clears
- `json(res)` helper for response parsing in tests (already defined in auth.test.ts)
- `describe.skipIf(!process.env['DATABASE_URL'])` not needed here — validate-token handler uses no DB

### Integration Points

- `COGNITO_MOBILE_CLIENT_ID` env var: already declared in Phase 1 CDK stack (CognitoStack → ApiStack passthrough); already used in mobile-config tests
- `COGNITO_TENANT_CLIENT_ID` env var: existing — the web client ID that validate-token currently uses
- `authService.authenticate()` in `apps/mobile/src/auth/authService.ts`: calls validate-token and uses the Session return — BREAK-01 fix makes the request payload correct; BREAK-02 fix makes the server accept it

</code_context>

<specifics>
## Specific Ideas

- The array approach was confirmed: `audience: [tenantClientId, mobileClientId]` keeps one endpoint and zero client-side changes
- Full test suite chosen over targeted — validate-token had zero tests; full coverage while in the file is correct Nyquist practice

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 06-fix-mobile-token-validation_
_Context gathered: 2026-03-30_
