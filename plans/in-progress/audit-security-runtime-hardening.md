# Runtime Security Hardening — CORS, Throttling, Tenant-Isolation Guards, Security Headers

> **Status: SCOPED** — 2026-06-10

Audit unit 6 of the lean-delivery audit batch. Scope: the **running** API + frontends' security posture. Explicitly out of scope (owned by sibling units/plans): SAST/dependency scanning/SBOM (Unit 5), observability (Unit 4), workflow-sandbox security (already scoped in `plans/todo/workflows-phase3-sandboxed-tenant-code-and-triggers.md`), and the Cognito/jose/Cedar auth chain itself — which was spot-checked and is solid (see Context §5).

## Context

### 1. CORS is wide open — at TWO layers

- **Hono**: `apps/api/src/app.ts:83` — `app.use('*', cors())` with no options → `Access-Control-Allow-Origin: *` on every response.
- **API Gateway**: `packages/infra/lib/stacks/api-stack.ts:1199-1204` — `corsPreflight: { allowOrigins: ['*'], allowMethods: [ANY], ... }`.

Important interaction: when an HTTP API has `corsPreflight` configured, API Gateway answers `OPTIONS` itself and **overrides CORS headers returned by the integration** — so in deployed environments the API GW config is authoritative and the Hono `cors()` only matters for the local dev server (`apps/api/src/server.ts`) and any direct-served path. Both layers must be fixed, from one source of truth.

Severity framing (honest): auth is bearer-token (no cookies), so there is no ambient-credential CSRF today. `*` mainly removes the browser same-origin backstop and becomes a real hole the day a cookie or credentialed request appears. It is also a ~1-hour fix — pure quick win.

Deployed origins to allow: `https://pegasus.dolas.dev` + admin domain (prod), `https://pegasus-qa.dolas.dev` + admin equivalent (QA) — exact admin hostnames live in SSM (`/dolas/pegasus/admin/domain-name`, see `packages/infra/lib/stacks/admin-frontend-stack.ts:11-12`) and should be passed per-env from `packages/infra/bin/app.ts` context rather than guessed. Dev environments use raw CloudFront domains → keep `['*']` for dev. The mobile app (React Native fetch) and the Python workflows CLI do **not** enforce CORS — locking the allowlist cannot break them.

### 2. No rate limiting / throttling anywhere

- `grep -ri throttl packages/infra/lib` → one comment hit only. The HTTP API `$default` stage (`api-stack.ts:1197-1205`) has no `defaultRouteSettings`; no WAF is attached to any distribution; no middleware throttling exists.
- This combines badly with the **account-wide Lambda concurrency cap of 10** (known issue, Service Quotas case L-B99A9384): ~10 concurrent slow requests starve the entire platform — including the crons sharing the account.
- Amplifier: `GET /health?deep=true` (`apps/api/src/app.ts:117-137`) is unauthenticated and performs a DB round-trip per call — a free concurrency-exhaustion lever today.
- The API CDN (`api-cdn-stack.ts:79-94`) is cache-disabled by design, so CloudFront absorbs nothing.

**Chosen primary path: API Gateway stage throttling** (free, 5 lines of CDK, applies even to callers that bypass CloudFront and hit the execute-api endpoint directly). AWS WAF on the CloudFront distribution (per-IP rate rules, ~$5+/mo) is deliberately **deferred** — it does not cover the execute-api bypass path and the tenant count doesn't justify the spend yet. Hono-middleware rate limiting is **rejected**: Lambda is stateless, so it needs a shared store (DynamoDB/Redis) — recurring cost + code for a worse version of what API GW gives free.

### 3. Tenant isolation — well-built, app-layer only, two guard gaps

- `apps/api/src/lib/prisma.ts:19-47` — `TENANT_SCOPED_MODELS` (17 models) + `createTenantDb` query extension scoping all read/update/delete ops (`prisma.ts:64-107`). Creates intentionally pass `tenantId` explicitly.
- **The schema-sync test already exists**: `apps/api/src/lib/__tests__/prisma-tenant-isolation.test.ts:829-889` asserts every `schema.prisma` model with a `tenantId` column is in `TENANT_SCOPED_MODELS` or the documented `INTENTIONALLY_UNSCOPED` set. Gap: it is nested inside `describe.skipIf(!hasDb)` (line 46) even though it only reads files — it silently skips on any machine without `DATABASE_URL`. CI does set `DATABASE_URL` (`.github/workflows/ci.yml:111,192`), so it runs in CI today; hoisting it makes it run everywhere.
- **Raw SQL footprint is tiny**: the only `$queryRaw`/`$executeRaw` in non-test API code is the health check (`apps/api/src/app.ts:121`, no user input). Nothing currently dangerous — the risk is future drift.
- **`basePrisma` (direct `db` import) is used by 49 non-test files** — almost all legitimately (auth middleware, crons/`lambda-*.ts`, admin handlers, longhaul handlers that read tenant config then talk to MSSQL). No automation stops a future _tenant_ handler from importing `db` and skipping scoping. Fix = a pure-file vitest guard with an explicit allowlist (Phase 3). ESLint `no-restricted-imports` was considered and rejected: per-file allowlisting in flat config means dozens of override blocks; a single test with a frozen file list is one file and reads better in review.
- **Postgres RLS assessment (Neon supports it)** — verdict: **defer**. It would require a per-request `SET app.current_tenant` inside a transaction wrapper around every query (awkward with Prisma + pooled Neon connections), a `BYPASSRLS`-style split for the 10+ cron Lambdas and auth middleware that legitimately query cross-tenant, and migration of all 49 base-client call sites. That is weeks of rework to defend against the same failure mode the extension + the two CI guards below already cover, with the guards costing ~2 hours total. Revisit only if a compliance driver (SOC 2 / enterprise customer DD) demands DB-enforced isolation.

### 4. Security headers — none, anywhere

`grep -rn ResponseHeadersPolicy packages/infra/lib` → zero hits. All three CloudFront distributions ship no HSTS, no `X-Content-Type-Options`, no frame-ancestors/CSP:

- Tenant SPA: `packages/infra/lib/stacks/frontend-stack.ts:74` (`SiteDistribution`)
- Admin SPA: `packages/infra/lib/stacks/admin-frontend-stack.ts:73` (`AdminDistribution`)
- API CDN: `packages/infra/lib/stacks/api-cdn-stack.ts:79` (`ApiDistribution`)

### 5. Middleware spot-check — auth chain is solid; two small gaps

Verified good (no action): all secret comparisons are timing-safe (`handlers/workflow-internal.ts:80-81`, `middleware/api-client-auth.ts:72,122`, `middleware/m2m-app-auth.ts:46-54` — SHA-256 then `timingSafeEqual`); the RingCentral webhook validates the per-subscription verification token (`handlers/integrations/ringcentral-webhook.ts:58-66`); `tenantMiddleware` verifies issuer + audience + `token_use` + alg pinning (`middleware/tenant.ts:56-72`) and enforces tenant lifecycle status (`tenant.ts:117-122`); the global error handler never leaks stack traces (`app.ts:92-109`).

Gaps found:

- **`SKIP_AUTH` has no production guard** — `app.ts:228-239` (and `app.server.ts:21`) bypasses ALL authentication on a plain env-var check, with only a log warning. One mistaken env var on the deployed Lambda = fully open API. A fail-fast boot guard is a 15-minute fix.
- **`/docs` + `/openapi.json` are public** (`app.ts:111-112`) — information disclosure of the full route map only. Low priority; gate behind an env flag or accept deliberately.

### 6. Accepted as-is (documented, no action)

Secrets injected as plaintext Lambda env vars via `unsafeUnwrap()` (`api-stack.ts:234` DATABASE_URL, `:416-419` TEMPORAL_CLOUD_API_KEY, `:522` WORKFLOW_BROKER_SECRET). Encrypted at rest by Lambda, readable only with `lambda:GetFunctionConfiguration` IAM. Runtime SDK fetch would add cold-start latency and code for marginal gain at this scale. Known solo-dev trade-off — leave.

### AI integration verdict

Mostly **no AI needed** — CORS, headers, and throttling are one-time CDK/code fixes; the isolation guards are deterministic CI checks (strictly better than an LLM for this). The one genuinely valuable AI hook: run the existing `/security-review` skill on any PR touching `apps/api/src/middleware/**`, `apps/api/src/lib/prisma.ts`, or `apps/api/src/handlers/admin/**` (Phase 4 item — a tiny path-filtered CI job or a checklist habit; Unit 5 owns general PR scanning, so keep this scoped to the auth-critical paths or fold it into Unit 5's pipeline if that plan lands first).

## Plan

### Phase 1 — Quick wins (~half day total)

- [x] **CORS allowlist, env-driven, both layers** (~1h). Single source of truth: a per-env origins array in `packages/infra/bin/app.ts` context, threaded into `ApiStackProps`.
  - `api-stack.ts`: add `readonly corsAllowedOrigins?: string[]` to `ApiStackProps`; at `:1199` replace `allowOrigins: ['*']` with `allowOrigins: props.corsAllowedOrigins ?? ['*']` (dev fallback stays `*`); also inject `apiFunction.addEnvironment('CORS_ALLOWED_ORIGINS', (props.corsAllowedOrigins ?? []).join(','))`.
  - `bin/app.ts`: pass per env — prod `['https://pegasus.dolas.dev', 'https://<admin prod domain>']`, staging the `-qa` equivalents (confirm exact admin hostnames from the SSM params `/dolas/pegasus/admin/domain-name` in each account: `aws ssm get-parameter --name /dolas/pegasus/admin/domain-name --query Parameter.Value --output text`); dev: omit.
  - `apps/api/src/app.ts:83`:
    ```ts
    const allowedOrigins = (process.env['CORS_ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean)
    app.use(
      '*',
      cors({
        origin: (origin) =>
          allowedOrigins.length === 0 || allowedOrigins.includes(origin) ? origin : '',
        allowHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'X-Tenant-Slug'],
        exposeHeaders: ['x-correlation-id'],
      }),
    )
    ```
    Empty env (local dev/E2E) → reflect any origin, preserving current DX. Deployed envs get the allowlist at both API GW (authoritative) and Hono (defense in depth / direct-served path).
- [x] **SKIP_AUTH production fail-fast** (~15 min). In `apps/api/src/app.ts` just above line 228 (mirror in `app.server.ts:21`):
  ```ts
  if (process.env['SKIP_AUTH'] === 'true' && process.env['NODE_ENV'] === 'production') {
    throw new Error('SKIP_AUTH=true is forbidden when NODE_ENV=production')
  }
  ```
  The Lambda always sets `NODE_ENV=production` (`api-stack.ts:232`), so a mis-set `SKIP_AUTH` now fails closed at cold start instead of silently opening the API.
- [x] **API Gateway stage throttling** (~30 min). In `api-stack.ts` immediately after the `HttpApi` construct (~line 1205):
  ```ts
  const defaultStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage
  defaultStage.defaultRouteSettings = {
    throttlingRateLimit: 25, // steady-state rps across all callers
    throttlingBurstLimit: 50,
  }
  ```
  Values sized to current real traffic (single-digit rps) with generous headroom; tune via context later if needed. Excess requests get 429 from API GW without consuming a Lambda slot — directly mitigating the concurrency-10 starvation. Honest limitation: this is a stage-wide token bucket, not per-IP; a targeted attacker still 429s legitimate users. Per-IP needs WAF (deferred, Phase 4).
- [x] **Hoist the schema-sync test out of the DB-gated block** (~15 min). Move the `describe('Schema-sync: …')` block (`prisma-tenant-isolation.test.ts:829-889`) outside `describe.skipIf(!hasDb)` (line 46) — it only reads `schema.prisma` and needs no DB. It then runs on every `npm test` everywhere, not just CI.

### Phase 2 — Security headers on all three distributions (~half day)

- [ ] **Add a `ResponseHeadersPolicy` to each stack** (~2h incl. snapshot updates). Identical block in `frontend-stack.ts`, `admin-frontend-stack.ts`, `api-cdn-stack.ts` (per-stack construct — cheap, avoids new cross-stack export coupling):
  ```ts
  const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
    securityHeadersBehavior: {
      strictTransportSecurity: {
        accessControlMaxAge: cdk.Duration.days(365),
        includeSubdomains: true,
        override: true,
      },
      contentTypeOptions: { override: true }, // X-Content-Type-Options: nosniff
      frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
      referrerPolicy: {
        referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        override: true,
      },
    },
  })
  ```
  Attach `responseHeadersPolicy: securityHeaders` to: `frontend-stack.ts` `defaultBehavior` (line ~80) **and** the `/config.json` additional behavior (line ~89); `admin-frontend-stack.ts` equivalents; `api-cdn-stack.ts` `defaultBehavior` (line ~84). Note for the API CDN: CloudFront response-header policies do not clobber the CORS headers API GW emits unless `override: true` collides on the same header — the set above touches none of the ACAO family, so it composes safely.
- [ ] **CSP — report-only first, tenant SPA only** (~1h now, enforce later). Add to the _frontend_ policy only, via `customHeadersBehavior` so it ships as Report-Only:
  ```ts
  customHeadersBehavior: {
    customHeaders: [{
      header: 'Content-Security-Policy-Report-Only',
      value: "default-src 'self'; connect-src 'self' https://api.pegasus.dolas.dev https://*.amazoncognito.com https://cognito-idp.us-east-1.amazonaws.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      override: true,
    }],
  }
  ```
  (Adjust the api hostname per env — thread it as a prop the same way `attachCustomDomain` works.) Run the app for a week, check the browser console for violations, then promote to enforced `contentSecurityPolicy` in `securityHeadersBehavior`. Do NOT enforce blind — Vite/TanStack inline chunks or third-party assets can break the whole SPA.

### Phase 3 — Tenant-isolation CI guards (~2h)

- [ ] **Raw-SQL + base-client allowlist guard test** (~2h). New pure-file test `apps/api/src/__tests__/db-access-guard.test.ts` (no DB needed, runs everywhere):
  1. Recursively scan `apps/api/src` (excluding `*.test.ts`, `__tests__`) for `$queryRaw`/`$executeRaw` — assert the set of matching files equals exactly `['app.ts']` (the health check).
  2. Scan `apps/api/src/handlers/**` for imports of the base client (regex `from '(\.\./)+db'`) — assert every match is in a frozen `ALLOWED_BASE_CLIENT_HANDLERS` list seeded with the current 23 handler files: `admin/tenants.ts`, `admin/tenant-users.ts`, `admin/vpn-diagnose.ts`, `admin/vpn.ts`, `admin/workflows.ts`, `auth.ts`, `integrations/ringcentral-oauth.ts`, `integrations/ringcentral-webhook.ts`, the 17 `longhaul-cloud/*.ts` files, `pegii/middleware.ts`, `settings.ts`, `vpn-agent.ts`, `workflow-internal.ts`. (Middleware, `lambda-*.ts` crons, and `lib/` are intentionally unguarded — they are the legitimate cross-tenant surface.)
  3. Failure message must say: _"New handler imports the unscoped base Prisma client. Either use `c.get('db')` (tenant-scoped) or add the file to ALLOWED_BASE_CLIENT_HANDLERS with a justification comment."_ — turning every future violation into a deliberate, reviewable decision instead of silent drift. No AI needed; deterministic is better here.
- [ ] **Record the RLS verdict** (~10 min): add a short entry to `dolas/agents/project/DECISIONS.md` ("RLS deferred — app-layer extension + CI guards chosen; revisit on compliance driver") so the assessment isn't re-litigated next audit.

### Phase 4 — Deferred / ops follow-ups

- [ ] **Lambda concurrency Service Quotas increase** (15 min of console work, then wait): re-chase case L-B99A9384 on BOTH pegasus accounts. Throttling (Phase 1) shrinks the blast radius but the cap of 10 remains the platform's tightest availability bottleneck.
- [ ] **WAF on the API CloudFront distribution** — deferred until either public/unauthenticated endpoints grow (webhooks beyond RingCentral, public quote forms) or a real abuse incident. When triggered: rate-based rule (per-IP) + AWS managed common rule set on `ApiDistribution`; budget ~$5-10/mo. Pair with locking API GW to CloudFront-only via a shared custom origin header check if the bypass path matters by then.
- [ ] **Gate `/docs` + `/openapi.json`** behind `EXPOSE_API_DOCS=true` env (default off in prod) — or explicitly accept them as public. 15 min either way; decide, don't drift.
- [ ] **Path-filtered security review** (the one AI item): add a tiny CI step (or adopt as habit) — when a PR touches `apps/api/src/middleware/**`, `apps/api/src/lib/prisma.ts`, or `apps/api/src/handlers/admin/**`, run `/security-review` on the diff before merge. Coordinate with Unit 5's scanning plan to avoid double-tooling; if Unit 5 ships a PR-scan pipeline, fold this in as a path filter there instead.

## Files to Modify / Create

| File                                                         | Change                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app.ts`                                        | CORS allowlist from `CORS_ALLOWED_ORIGINS` (line 83); SKIP_AUTH prod fail-fast (above line 228)                     |
| `apps/api/src/app.server.ts`                                 | Same SKIP_AUTH fail-fast (line 21)                                                                                  |
| `packages/infra/lib/stacks/api-stack.ts`                     | `corsAllowedOrigins` prop → `corsPreflight.allowOrigins` (line 1200) + Lambda env; stage throttling after line 1205 |
| `packages/infra/bin/app.ts`                                  | Per-env `corsAllowedOrigins` wiring                                                                                 |
| `packages/infra/lib/stacks/frontend-stack.ts`                | ResponseHeadersPolicy + attach (lines ~74-96); CSP report-only header                                               |
| `packages/infra/lib/stacks/admin-frontend-stack.ts`          | ResponseHeadersPolicy + attach (line ~73)                                                                           |
| `packages/infra/lib/stacks/api-cdn-stack.ts`                 | ResponseHeadersPolicy + attach (line ~84)                                                                           |
| `apps/api/src/lib/__tests__/prisma-tenant-isolation.test.ts` | Hoist schema-sync describe (829-889) out of `skipIf` (46)                                                           |
| `apps/api/src/__tests__/db-access-guard.test.ts`             | **NEW** — raw-SQL + base-client allowlist guard                                                                     |
| `packages/infra/lib/stacks/__tests__/*`                      | Snapshot updates for the three stacks + api-stack assertions                                                        |
| `dolas/agents/project/DECISIONS.md`                          | RLS-deferred decision entry                                                                                         |

## Side Effects & Risks

- **CORS lockdown breaking clients**: browsers on un-allowlisted origins (a forgotten preview/CloudFront URL) will hard-fail. Mitigations: dev envs keep `*` (empty prop); mobile RN and the Python CLI don't enforce CORS so they cannot break; verify the QA E2E suite (which targets the API via its base URL with Playwright `request` — not browser CORS-bound) still passes before prod. If the admin SPA hostname is wrong in the allowlist, admin logins break — confirm both SSM domain params before deploy.
- **API GW CORS config change redeploys the stage** — brief propagation, no downtime expected; deploy to staging first via normal CI.
- **Throttle limits too low**: AppGuard's reference-data bootstrap was previously bursty (collapsed to ~3 calls via `/reference-data`, `app.ts:293-299`); 50 burst is ~16x that, but watch 429s in the first week (API GW 4xx metric already flows to MonitoringStack). Raising the number is a 1-line change.
- **HSTS is sticky**: once browsers see `max-age=31536000` on `pegasus.dolas.dev`, HTTP fallback is gone for a year. All three properties are already REDIRECT_TO_HTTPS-only (`frontend-stack.ts:82`, `api-cdn-stack.ts:86`), so this is safe — but don't add `preload` casually.
- **Enforced CSP can blank the SPA** — that's why Phase 2 ships Report-Only first.
- **Frame DENY** breaks any future embedding of the app in an iframe (none exists today).
- **SKIP_AUTH guard** throws at cold start: if anything legitimately sets both vars (nothing in-repo does — verified: only local/on-prem paths use SKIP_AUTH), the API 500s loudly rather than opening up. That is the intended failure direction.
- **Guard-test allowlist friction**: every new admin/longhaul-style handler needs one allowlist line. That's the point — one deliberate line vs. silent isolation bypass.

## Acceptance Criteria / Verification

```bash
# 1. CORS — disallowed origin gets no ACAO (preflight answered by API GW):
curl -si -X OPTIONS https://api.pegasus-qa.dolas.dev/api/v1/customers -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET' | grep -ci 'access-control-allow-origin'   # expect 0
# Allowed origin is echoed:
curl -si -X OPTIONS https://api.pegasus-qa.dolas.dev/api/v1/customers -H 'Origin: https://pegasus-qa.dolas.dev' -H 'Access-Control-Request-Method: GET' | grep -i 'access-control-allow-origin: https://pegasus-qa.dolas.dev'

# 2. SKIP_AUTH guard — boot fails closed:
cd apps/api && SKIP_AUTH=true NODE_ENV=production node -e "import('./dist/app.js').catch(e => { console.log('FAILED CLOSED OK:', e.message); process.exit(0) }).then(() => process.exit(1))"

# 3. Throttling present on the stage:
aws apigatewayv2 get-stages --api-id <httpApiId> --query 'Items[0].DefaultRouteSettings'   # expect ThrottlingRateLimit: 25, ThrottlingBurstLimit: 50

# 4. Security headers on all three hosts:
for h in pegasus-qa.dolas.dev admin.<qa-admin-domain> api.pegasus-qa.dolas.dev; do curl -sI "https://$h/" | grep -iE 'strict-transport-security|x-content-type-options|x-frame-options|referrer-policy'; done
# expect all four headers on the SPAs; HSTS+nosniff at minimum on the API host

# 5. Tenant-isolation guards run WITHOUT a database:
cd apps/api && npx vitest run src/lib/__tests__/prisma-tenant-isolation.test.ts src/__tests__/db-access-guard.test.ts
# expect: schema-sync + guard tests PASS (not skipped) with DATABASE_URL unset

# 6. Full isolation suite against local Postgres (unchanged behaviour):
cd apps/api && DATABASE_URL=postgresql://pegasus:pegasus@localhost:5432/pegasus?schema=public npx vitest run src/lib/__tests__/prisma-tenant-isolation.test.ts

# 7. Infra tests + snapshots updated:
cd packages/infra && npm test

# 8. Regression gate before prod: QA E2E suite green (apps/e2e — `npm run e2e`).
```
