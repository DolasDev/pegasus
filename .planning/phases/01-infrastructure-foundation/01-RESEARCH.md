# Phase 1: Infrastructure Foundation - Research

**Researched:** 2026-03-27
**Domain:** AWS CDK Cognito app clients, Hono API handlers, Expo React Native polyfills
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Single shared mobile client ID — one mobile Cognito app client for all tenants. The endpoint validates the tenant exists (400 for unknown tenantId) then returns the same `{ userPoolId, clientId }` regardless of which tenant matched. No per-tenant client mapping needed.
- **D-02:** Response shape: `{ userPoolId: string, clientId: string }`. No extra fields.
- **D-03:** `generateSecret: false` — PKCE/SRP only, no client secret in the mobile app.
- **D-04:** `authFlows: { userSrp: true }` — required for `amazon-cognito-identity-js` SRP handshake. No password or OAuth flows on this client.
- **D-05:** Token validity: `idTokenValidity: 8h`, `accessTokenValidity: 8h`, `refreshTokenValidity: 30d`.
- **D-06:** `enableTokenRevocation: true` — follow existing pattern.
- **D-07:** Export mobile client ID via SSM at `/pegasus/mobile/cognito-client-id` + CFN output `PegasusCognitoMobileClientId`. Inject into API Lambda as env var `COGNITO_MOBILE_CLIENT_ID`.
- **D-08:** `apps/mobile/index.ts` must have `import 'react-native-get-random-values'` as its **absolute first statement** — before any other import.
- **D-09:** Install via `npx expo install react-native-get-random-values amazon-cognito-identity-js`.
- **D-10:** Mount `GET /api/auth/mobile-config` in the existing `packages/api/src/handlers/auth.ts` alongside the existing routes. Public — no auth middleware.

### Claude's Discretion

- CDK construct naming (logical ID within the stack)
- SSM parameter description strings
- API handler error message wording for the 400 response

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                           | Research Support                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| INFRA-01 | App entry point imports `react-native-get-random-values` before all other imports                     | See "Critical Entry Point Finding" below — `index.ts` is not the active entry; polyfill placement needs adjustment    |
| INFRA-02 | Dedicated mobile Cognito app client (CDK) with `generateSecret: false` and SRP auth flow enabled      | Existing `userPool.addClient()` + SSM + CfnOutput three-step pattern documented; mobile client follows same structure |
| API-01   | `GET /api/auth/mobile-config?tenantId=<id>` returns userPoolId and clientId; public, no auth required | Hono query validator pattern in existing auth.ts maps directly; db.tenant.findUnique for tenant existence check       |

</phase_requirements>

---

## Summary

Phase 1 lays three infrastructure prerequisites for Cognito SRP auth. All three tasks are tightly scoped code additions to existing files — no new packages, stacks, or architectural patterns are introduced.

The CDK change (INFRA-02) adds a third `userPool.addClient()` call to the existing `CognitoStack`, along with the standard SSM + CfnOutput trio and a new prop on `ApiStack` to inject `COGNITO_MOBILE_CLIENT_ID` into the Lambda environment. The API change (API-01) adds a single `GET` route to the existing `authHandler` Hono app, following the `validator('query', ...)` + Zod safeParse pattern already used throughout the file. The mobile change (INFRA-01) installs two packages and prepends one import line.

**Critical finding:** The mobile app's `package.json` has `"main": "expo-router/entry"`, which means `apps/mobile/index.ts` is NOT the active bundle entry point. Expo Router's own entry (`expo-router/entry` → `entry-classic.js`) is what Metro resolves first. Placing the polyfill import in `index.ts` alone will have NO effect — the polyfill will not load. The correct placement is the root `apps/mobile/app/_layout.tsx` as the first import in that file, which IS executed early in the expo-router module graph. This contradicts D-08 as written; the plan must address this.

**Primary recommendation:** Follow the established three-step CDK pattern (addClient → SSM → CfnOutput), follow the existing Hono query validator pattern for the API route, and place the polyfill import at the top of `app/_layout.tsx` (not `index.ts`) since expo-router bypasses `index.ts`.

## Standard Stack

### Core

| Library                          | Version (verified)             | Purpose                                   | Why Standard                                           |
| -------------------------------- | ------------------------------ | ----------------------------------------- | ------------------------------------------------------ |
| `aws-cdk-lib`                    | `^2.160.0`                     | CDK constructs for Cognito, SSM           | Already in `packages/infra/package.json`               |
| `hono`                           | (workspace dep)                | HTTP handler router for the new GET route | Already powers all API handlers                        |
| `zod`                            | `^3.23.8`                      | Query param validation schema             | Already in `packages/api/package.json`                 |
| `react-native-get-random-values` | resolved by `npx expo install` | Crypto RNG polyfill for SRP               | Required by `amazon-cognito-identity-js` for RNG in RN |
| `amazon-cognito-identity-js`     | resolved by `npx expo install` | SRP auth handshake library                | Pure JS, works in React Native without native modules  |

### Supporting

| Library                     | Version   | Purpose                 | When to Use                                   |
| --------------------------- | --------- | ----------------------- | --------------------------------------------- |
| `aws-cdk-lib/aws-ssm`       | bundled   | SSM parameter export    | Every new Cognito client ID export            |
| `@prisma/client` (via `db`) | workspace | Tenant existence lookup | `db.tenant.findUnique` in mobile-config route |

### Alternatives Considered

| Instead of                        | Could Use              | Tradeoff                                                                   |
| --------------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `npx expo install` (version lock) | `npm install` directly | `expo install` ensures Expo SDK-compatible versions; preferred for RN deps |

**Installation (mobile package, run from `apps/mobile/`):**

```bash
npx expo install react-native-get-random-values amazon-cognito-identity-js
```

## Architecture Patterns

### Pattern 1: CDK Three-Step App Client Export

**What:** Every Cognito app client in this repo is created with exactly three CDK constructs: `userPool.addClient()` → `new ssm.StringParameter()` → `new cdk.CfnOutput()`.

**When to use:** Any time a new Cognito app client is provisioned.

**Example (from existing `cognito-stack.ts`):**

```typescript
// Step 1: create client
this.mobileAppClient = this.userPool.addClient('MobileAppClient', {
  userPoolClientName: 'mobile-app-client',
  generateSecret: false,
  authFlows: { userSrp: true },
  idTokenValidity: cdk.Duration.hours(8),
  accessTokenValidity: cdk.Duration.hours(8),
  refreshTokenValidity: cdk.Duration.days(30),
  enableTokenRevocation: true,
})

// Step 2: SSM export
new ssm.StringParameter(this, 'MobileClientIdParam', {
  parameterName: '/pegasus/mobile/cognito-client-id',
  stringValue: this.mobileAppClient.userPoolClientId,
  description: '...',
})

// Step 3: CFN output
new cdk.CfnOutput(this, 'MobileClientId', {
  value: this.mobileAppClient.userPoolClientId,
  exportName: 'PegasusCognitoMobileClientId',
})
```

**Also required:** Add `public readonly mobileAppClient: cognito.UserPoolClient` to the class, add `readonly cognitoMobileClientId?: string` to `ApiStackProps`, and inject `COGNITO_MOBILE_CLIENT_ID: props.cognitoMobileClientId ?? ''` in `ApiStack` environment block. Wire in `app.ts`:

```typescript
cognitoMobileClientId: cognitoStack.mobileAppClient.userPoolClientId,
```

### Pattern 2: Hono Query Validator

**What:** GET route with query param validation using `validator('query', ...)` + Zod `safeParse`.

**When to use:** Any unauthenticated GET endpoint with query params.

**Example (mirrors existing POST pattern in `auth.ts`):**

```typescript
const MobileConfigQuery = z.object({
  tenantId: z.string().min(1),
})

authHandler.get(
  '/mobile-config',
  validator('query', (value, c) => {
    const r = MobileConfigQuery.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const { tenantId } = c.req.valid('query')

    const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? ''
    const clientId = process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''

    if (!userPoolId || !clientId) {
      return c.json({ error: 'Authentication service misconfigured', code: 'INTERNAL_ERROR' }, 500)
    }

    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) {
      return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 400)
    }

    return c.json({ data: { userPoolId, clientId } })
  },
)
```

**Note on response shape:** D-02 specifies `{ userPoolId, clientId }` — this is returned inside the project's standard `{ data: ... }` envelope to be consistent with all other auth endpoint responses.

### Pattern 3: Polyfill First Import

**What:** `react-native-get-random-values` must be imported before any module that calls `crypto.getRandomValues()`. With expo-router, the correct location is the first line of `app/_layout.tsx`.

**Why `index.ts` is wrong:** `package.json` sets `"main": "expo-router/entry"`. Metro resolves `expo-router/entry` → `entry-classic.js` → `@expo/metro-runtime` → `expo-router/build/qualified-entry` → the file-based router, which loads `app/_layout.tsx`. The `apps/mobile/index.ts` file is never loaded by the bundler in this configuration.

**Correct placement:**

```typescript
// apps/mobile/app/_layout.tsx — line 1
import 'react-native-get-random-values'
// ... all other imports follow
```

### Anti-Patterns to Avoid

- **Polyfill in `index.ts` with `"main": "expo-router/entry"`:** The `index.ts` file is dead code when expo-router entry is the `main` field. The polyfill will silently not load.
- **OAuth flows on mobile client:** The mobile client is SRP-only. Do not add `oAuth` config — the mobile app never touches the Hosted UI.
- **Setting env vars in `cognito-stack.ts`:** Lambda environment variables are set exclusively in `api-stack.ts`. The cognito stack only exports values via SSM and CfnOutput.
- **`logRetention` on NodejsFunction:** Deprecated (creates extra custom-resource Lambda). Use explicit `new logs.LogGroup()` with `logGroup:` on the function instead. (Existing stacks already follow this.)

## Don't Hand-Roll

| Problem                       | Don't Build                | Use Instead                                        | Why                                          |
| ----------------------------- | -------------------------- | -------------------------------------------------- | -------------------------------------------- |
| Tenant existence check        | Custom SQL or raw fetch    | `db.tenant.findUnique` (existing Prisma singleton) | Already set up; handles connection pooling   |
| Cognito client token validity | Custom duration math       | `cdk.Duration.hours(8)`, `cdk.Duration.days(30)`   | Type-safe, same as existing clients          |
| Query param validation        | Manual `req.query` parsing | `validator('query', ...)` + Zod schema             | Established pattern; consistent error shapes |

## Common Pitfalls

### Pitfall 1: Polyfill Placement with expo-router

**What goes wrong:** Developer adds `import 'react-native-get-random-values'` to `index.ts` and assumes it runs first. At runtime, the SRP handshake fails with a crypto error because the polyfill was never executed.

**Why it happens:** `"main": "expo-router/entry"` in `package.json` means Metro uses expo-router's entry, not the project's `index.ts`. The `index.ts` file is present in the repo but is not part of the bundle graph.

**How to avoid:** Place the polyfill import as the first line of `apps/mobile/app/_layout.tsx`. Verify by checking that `_layout.tsx` appears before any auth screen in the module load sequence.

**Warning signs:** SRP auth errors mentioning `getRandomValues is not a function` or `crypto is not defined` at runtime.

### Pitfall 2: Cognito Token Validity Unit Mismatch

**What goes wrong:** CloudFormation stores token validity in minutes, not hours/days. Tests using `template.hasResourceProperties` with raw numbers must use correct minute values.

**Why it happens:** CDK `Duration.hours(8)` → 480 minutes in CloudFormation. `Duration.days(30)` → 43200 minutes.

**How to avoid:** In CDK infra tests asserting token validity, use minutes: `AccessTokenValidity: 480`, `RefreshTokenValidity: 43200`.

**Warning signs:** CDK snapshot test assertions failing with unexpected property values.

### Pitfall 3: Mobile Client Lacks `oAuth` Config — No Hosted UI

**What goes wrong:** Developer adds `oAuth` flows to the mobile client by analogy with admin/tenant clients, causing unintended Hosted UI callbacks.

**Why it happens:** Admin and tenant clients have OAuth because they use the authorization code flow. The mobile client uses SRP only and must NOT have OAuth config.

**How to avoid:** Mobile client definition should have no `oAuth` property. Only set `authFlows: { userSrp: true }`.

### Pitfall 4: CDK Cognito Lambda Count Test Will Break

**What goes wrong:** Existing infra test asserts `template.resourceCountIs('AWS::Lambda::Function', 2)` for the CognitoStack (pre-auth + pre-token). Adding the mobile client does not add a Lambda, but this assertion is a sentinel that reviewers should verify stays correct.

**Why it happens:** The test explicitly counts Lambda functions in the Cognito stack. Adding app clients does not change this count.

**How to avoid:** Confirm the Lambda count assertion stays at 2 after the mobile client is added. The mobile app client addition changes only `AWS::Cognito::UserPoolClient` and `AWS::SSM::Parameter` and `AWS::CloudFormation::Output` resource counts.

### Pitfall 5: `tenantId` Query Param — Wrong Prisma Field

**What goes wrong:** Mobile-config handler uses `db.tenant.findFirst({ where: { id: tenantId } })` (findFirst, not findUnique) or passes wrong field name.

**Why it happens:** Other auth endpoints filter by `emailDomains` with `findFirst`. The mobile-config route looks up by the primary key `id` with `findUnique`.

**How to avoid:** Use `db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })`. The `id` field is the Prisma primary key for the Tenant model.

## Code Examples

### Existing CDK App Client (reference for mobile client)

```typescript
// Source: packages/infra/lib/stacks/cognito-stack.ts (tenant client, lines 295-316)
this.tenantAppClient = this.userPool.addClient('TenantAppClient', {
  userPoolClientName: 'tenant-app-client',
  generateSecret: false,
  preventUserExistenceErrors: true,
  authFlows: { userPassword: true },
  oAuth: { ... },
  idTokenValidity: cdk.Duration.hours(8),
  accessTokenValidity: cdk.Duration.hours(8),
  refreshTokenValidity: cdk.Duration.days(30),
})
```

Mobile client differs: `authFlows: { userSrp: true }`, no `oAuth` block, no `preventUserExistenceErrors` needed (SRP errors are Cognito-managed), no `userPassword` flow.

### Existing API Handler Query Validation (no existing GET example — POST pattern maps directly)

```typescript
// Source: packages/api/src/handlers/auth.ts (resolve-tenant, lines 129-135)
authHandler.post(
  '/resolve-tenant',
  validator('json', (value, c) => {
    const r = ResolveTenantBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => { ... }
)
// For GET: replace validator('json', ...) with validator('query', ...)
// and c.req.valid('json') with c.req.valid('query')
```

### Existing SSM + CfnOutput Pattern

```typescript
// Source: packages/infra/lib/stacks/cognito-stack.ts (lines 352-384)
new ssm.StringParameter(this, 'TenantClientIdParam', {
  parameterName: '/pegasus/tenant/cognito-client-id',
  stringValue: this.tenantAppClient.userPoolClientId,
  description: 'Pegasus tenant app client ID (no secret — PKCE only)',
})

new cdk.CfnOutput(this, 'TenantClientId', {
  value: this.tenantAppClient.userPoolClientId,
  exportName: 'PegasusCognitoTenantClientId',
})
```

### Lambda Env Var Injection (ApiStack)

```typescript
// Source: packages/infra/lib/stacks/api-stack.ts (lines 98-105)
// Pattern to follow for COGNITO_MOBILE_CLIENT_ID:
COGNITO_TENANT_CLIENT_ID: props.cognitoTenantClientId ?? '',
COGNITO_USER_POOL_ID: props.cognitoUserPoolId ?? '',
// Add:
COGNITO_MOBILE_CLIENT_ID: props.cognitoMobileClientId ?? '',
```

## State of the Art

| Old Approach                         | Current Approach                       | When Changed    | Impact                                                                     |
| ------------------------------------ | -------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| `logRetention` on NodejsFunction     | Explicit `LogGroup` + `logGroup:` prop | CDK 2.x+        | `logRetention` is deprecated; existing stacks already use the new approach |
| `index.ts` as bundle entry (bare RN) | `"main": "expo-router/entry"`          | expo-router v2+ | `index.ts` is bypassed; polyfill must go in `_layout.tsx`                  |

## Open Questions

1. **D-08 contradicts actual entry point configuration**
   - What we know: D-08 mandates the polyfill in `index.ts`. The `package.json` `"main"` field is `"expo-router/entry"`, which means `index.ts` is not in the bundle graph.
   - What's unclear: Whether the user wants to change `"main"` back to `"./index.ts"` (and have `index.ts` import from expo-router) or accept placing the polyfill in `app/_layout.tsx` instead.
   - Recommendation: The plan should implement the polyfill in `app/_layout.tsx` (which is the correct location for expo-router projects) and note that D-08 refers to the logical "app entry" rather than the literal file. This achieves the same runtime guarantee — polyfill loads before any auth code — via the correct mechanism. If the user prefers the `index.ts` approach, the plan must also change `"main"` to `"./index.ts"` and have that file import expo-router's entry.

2. **`userPoolId` source in mobile-config handler**
   - What we know: D-07 injects `COGNITO_MOBILE_CLIENT_ID` into Lambda. `COGNITO_USER_POOL_ID` is already injected (existing env var). The mobile-config response needs `userPoolId`.
   - What's unclear: Nothing — `process.env['COGNITO_USER_POOL_ID']` is already available in the Lambda. No additional plumbing needed.
   - Recommendation: Read `COGNITO_USER_POOL_ID` from existing env var; no new injection needed.

## Environment Availability

| Dependency        | Required By           | Available | Version   | Fallback                                     |
| ----------------- | --------------------- | --------- | --------- | -------------------------------------------- |
| Node.js           | CDK synth, API tests  | ✓         | (WSL2)    | —                                            |
| AWS CDK (`cdk`)   | Stack synth + deploy  | ✓         | ^2.160.0  | —                                            |
| Expo CLI          | `npx expo install`    | ✓         | via npx   | —                                            |
| Vitest            | Infra + API tests     | ✓         | workspace | —                                            |
| Docker / Postgres | API integration tests | ✗         | —         | Tests skip via `skipIf(!DATABASE_URL)` guard |

**Missing dependencies with no fallback:** None blocking this phase.

**Missing dependencies with fallback:** Docker/Postgres — API unit tests for mobile-config route mock `db` entirely (no DB needed), following the existing `auth.test.ts` pattern.

## Validation Architecture

### Test Framework

| Property            | Value                                                           |
| ------------------- | --------------------------------------------------------------- |
| Framework           | Vitest (infra: `^1.6.0`, api: workspace version)                |
| Config file (infra) | `packages/infra/vitest.config.ts`                               |
| Config file (api)   | `packages/api/vitest.config.ts`                                 |
| Infra quick run     | `node node_modules/.bin/turbo run test --filter=@pegasus/infra` |
| API quick run       | `node node_modules/.bin/turbo run test --filter=@pegasus/api`   |
| Full suite          | `node node_modules/.bin/turbo run test`                         |

### Phase Requirements → Test Map

| Req ID   | Behavior                                                     | Test Type | Automated Command                                               | File Exists?                                 |
| -------- | ------------------------------------------------------------ | --------- | --------------------------------------------------------------- | -------------------------------------------- |
| INFRA-02 | Mobile app client in CDK with correct properties             | CDK unit  | `node node_modules/.bin/turbo run test --filter=@pegasus/infra` | ✅ (extend existing `cognito-stack.test.ts`) |
| INFRA-02 | `COGNITO_MOBILE_CLIENT_ID` env var in API Lambda             | CDK unit  | `node node_modules/.bin/turbo run test --filter=@pegasus/infra` | ✅ (extend existing `api-stack.test.ts`)     |
| API-01   | GET /api/auth/mobile-config returns 200 for valid tenant     | API unit  | `node node_modules/.bin/turbo run test --filter=@pegasus/api`   | ✅ (extend existing `auth.test.ts`)          |
| API-01   | GET /api/auth/mobile-config returns 400 for unknown tenantId | API unit  | `node node_modules/.bin/turbo run test --filter=@pegasus/api`   | ✅ (extend existing `auth.test.ts`)          |
| INFRA-01 | Polyfill import is first statement in entry file             | Manual    | Code review / grep: `head -1 apps/mobile/app/_layout.tsx`       | ✅ (file exists; first line to be verified)  |

### Sampling Rate

- **Per task commit:** Run relevant package test suite (`--filter=@pegasus/infra` or `--filter=@pegasus/api`)
- **Per wave merge:** `node node_modules/.bin/turbo run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. Tests for new behaviour should be added to existing files:

- `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts` — add mobile app client assertions
- `packages/infra/lib/stacks/__tests__/api-stack.test.ts` — add `COGNITO_MOBILE_CLIENT_ID` env var assertion
- `packages/api/src/handlers/auth.test.ts` — add GET /mobile-config test cases

## Sources

### Primary (HIGH confidence)

- Direct code inspection of `packages/infra/lib/stacks/cognito-stack.ts` — existing app client structure, SSM export pattern, CfnOutput pattern
- Direct code inspection of `packages/infra/lib/stacks/api-stack.ts` — Lambda env var injection pattern, ApiStackProps wiring
- Direct code inspection of `packages/infra/bin/app.ts` — cross-stack prop wiring between CognitoStack and ApiStack
- Direct code inspection of `packages/api/src/handlers/auth.ts` — `validator('query'/'json', ...)` pattern, Hono router structure, error response shapes
- Direct code inspection of `apps/mobile/package.json` — `"main": "expo-router/entry"` confirmed
- Direct code inspection of `node_modules/expo-router/entry.js` and `entry-classic.js` — confirmed `index.ts` bypass
- Direct code inspection of `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts` — CDK Template assertion patterns, existing test structure

### Secondary (MEDIUM confidence)

- Expo Router documentation pattern: polyfill-first imports belong in root `_layout.tsx` for expo-router projects (standard community practice, consistent with expo-router module graph)

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries are already installed; versions confirmed from package.json files
- Architecture: HIGH — patterns extracted directly from existing production code in the repo
- Pitfalls: HIGH (entry point issue) / MEDIUM (CDK test count) — entry point finding is from direct file inspection; CDK token validity is from official CDK documentation behavior

**Research date:** 2026-03-27
**Valid until:** 2026-06-27 (stable stack, slow-moving dependencies)
