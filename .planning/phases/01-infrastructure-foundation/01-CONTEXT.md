# Phase 1: Infrastructure Foundation - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Lay the three infrastructure prerequisites so Cognito SRP auth code can be written and tested end-to-end without hitting configuration blockers:

1. Dedicated mobile Cognito app client in CDK
2. `GET /api/auth/mobile-config?tenantId=<id>` public endpoint
3. `react-native-get-random-values` polyfill installed and wired into the mobile entry point

Tenant resolution UX, session persistence, and the auth service layer are separate phases.
</domain>

<decisions>
## Implementation Decisions

### mobile-config Response Model

- **D-01:** Single shared mobile client ID — one mobile Cognito app client for all tenants. The endpoint validates the tenant exists (400 for unknown tenantId) then returns the same `{ userPoolId, clientId }` regardless of which tenant matched. No per-tenant client mapping needed.
- **D-02:** Response shape: `{ userPoolId: string, clientId: string }`. No extra fields.

### Mobile Cognito App Client (CDK)

- **D-03:** `generateSecret: false` — PKCE/SRP only, no client secret in the mobile app.
- **D-04:** `authFlows: { userSrp: true }` — required for `amazon-cognito-identity-js` SRP handshake. No password or OAuth flows on this client.
- **D-05:** Token validity: `idTokenValidity: 8h`, `accessTokenValidity: 8h`, `refreshTokenValidity: 30d`. Matches a standard driver shift; re-login at the next shift start is acceptable for v1.
- **D-06:** `enableTokenRevocation: true` — follow existing pattern (admin and tenant clients both set this).
- **D-07:** Export mobile client ID via SSM at `/pegasus/mobile/cognito-client-id` + CFN output `PegasusCognitoMobileClientId`. Inject into API Lambda as env var `COGNITO_MOBILE_CLIENT_ID`.

### Entry-Point Polyfill

- **D-08:** `apps/mobile/index.ts` must have `import 'react-native-get-random-values'` as its **absolute first statement** — before any other import. Required so the Cognito SRP crypto operations have a working RNG at runtime.
- **D-09:** Install via `npx expo install react-native-get-random-values amazon-cognito-identity-js` to ensure Expo-compatible versions are resolved.

### API Endpoint Placement

- **D-10:** Mount `GET /api/auth/mobile-config` in the existing `packages/api/src/handlers/auth.ts` handler alongside the existing resolve-tenant and validate-token routes. Public — no auth middleware.

### Claude's Discretion

- CDK construct naming (logical ID within the stack)
- SSM parameter description strings
- API handler error message wording for the 400 response
  </decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` — INFRA-01, INFRA-02, API-01 (success criteria for this phase)

### Existing CDK patterns to follow

- `packages/infra/lib/stacks/cognito-stack.ts` — Existing app client definitions (`adminAppClient`, `tenantAppClient`), SSM export pattern, CFN output pattern, token validity settings
- `packages/infra/lib/stacks/api-stack.ts` — Where Lambda env vars are injected (e.g., `COGNITO_TENANT_CLIENT_ID`)

### Existing API patterns to follow

- `packages/api/src/handlers/auth.ts` — Unauthenticated route pattern, Zod validation, Hono handler structure, error response shape

### Mobile entry point

- `apps/mobile/index.ts` — Current entry point; polyfill must be prepended here

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `packages/api/src/db.ts` — Prisma client singleton; use `db.tenant.findUnique({ where: { id: tenantId } })` to validate tenant exists in mobile-config handler
- `packages/api/src/handlers/auth.ts` — Hono router with unauthenticated routes; `mobileConfig` route goes here, following the same `validator('query', ...)` + zod safeParse pattern

### Established Patterns

- CDK app client: `userPool.addClient(id, { ... })` → SSM `StringParameter` → `CfnOutput` (three-step, always done together)
- API handler: `validator('query', (value, c) => { const r = Schema.safeParse(value); if (!r.success) return c.json({ error: '...', code: '...' }, 400); return r.data })` — matches existing query param validation style
- Lambda env vars: set in `api-stack.ts`, not in `cognito-stack.ts`

### Integration Points

- `CognitoStack` → `ApiStack`: mobile client ID flows via SSM param or CDK output (consistent with how `COGNITO_TENANT_CLIENT_ID` is already wired)
- `apps/mobile/index.ts`: Expo entry point — polyfill prepended before `registerRootComponent`
- `packages/api/src/handlers/auth.ts`: New `GET /api/auth/mobile-config` route registered on the existing `auth` Hono app

</code_context>

<specifics>
## Specific Ideas

No specific UI or interaction requirements — this phase is pure infrastructure. Standard approaches apply.
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.
</deferred>

---

_Phase: 01-infrastructure-foundation_
_Context gathered: 2026-03-27_
