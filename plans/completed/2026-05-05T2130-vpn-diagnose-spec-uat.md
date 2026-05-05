# VPN Diagnose spec — un-skip + manual UAT

## Context

Carved out of `plans/completed/2026-05-03T2200-post-batch-followups.md`
(items 4 and 5). Items 1, 2, 3, 6 of that plan all closed; the two
remaining tasks were deliberately deferred because they will collide
with the in-flight AuthZ rewrite on `feat/avp-authz-foundation`
(Cedar policies, new `me` handler, RBAC changes, `policy_store_id`
schema column). Building the auth fixture against the old auth model
would mean rebuilding it after AuthZ lands.

**Pick this up once `feat/avp-authz-foundation` is merged.** The
`SKIP_AUTH=true` semantics may have changed by then; build the
fixture against the new auth model, not the old one.

## Goal

Get `apps/e2e/tests/browser/admin-vpn-diagnose.spec.ts` running locally
(un-skipped, gate-excluded), and hand-verify the diagnose button
against a real staging tenant.

## Plan

- [x] **1. Authenticated browser-spec helper, then un-skip the VPN
      diagnose spec.** Done via path (a) — admin-web's `authGuard`
      (`apps/admin-web/src/routes/_auth.tsx`) is still a synchronous
      `sessionStorage` check post-AVP merge (#91), so the new
      Cedar/AVP contract is server-only and the spec mocks every API
      call anyway. Implementation: - `apps/e2e/fixtures/auth.ts` exports `seedAdminAuth(page)`,
      which uses `page.addInitScript` to prime the three
      `pegasus_admin_*_token` keys before any page script runs. - `apps/e2e/tests/browser/admin-vpn-diagnose.spec.ts` is
      un-skipped, wrapped in `test.describe('@local-only ...', ...)`
      so `playwright.config.ts` `grepInvert: /@local-only/` excludes
      it from the staging gate, mocks `GET
    /api/admin/tenants/:id` + `/vpn/status` alongside the
      existing diagnose route, and seeds auth in `beforeEach`. - Verified locally: `WEB_URL=http://localhost:5174 npm
    --prefix apps/e2e run e2e -- --project=browser
    admin-vpn-diagnose` → 2/2 passing. Confirmed
      `E2E_TARGET=remote` skips both tests ("No tests found").

      Path (b) — Cognito hosted-UI login fixture — remains its own
      future plan; not needed until the staging E2E gate expands
      beyond `health` + `landing`.

- [x] **2. Manual smoke of the diagnose button against a real
      tenant.** Done against prod (`https://admin.pegasus.dolas.dev`)
      on tenant `32dd89be-72b3-4038-a54e-9c520ca4547e` after the
      blockers below were fixed: spinner ticks, ~10–30 s wall time,
      green PASS pill renders. Fail-path was deferred — both candidate
      methods (suspend the peer; pick an already-broken tenant) carry
      customer-impact risk in prod and there were none readily
      available in staging at the moment of UAT.

## Findings — three latent bugs uncovered during UAT

The UAT was the first real exercise of the deploy path for the VPN
diagnose feature, and surfaced three independent infra bugs that the
mocked vitest tests had no chance of catching. Captured in
`dolas/agents/project/GOTCHAS.md` under "Cedar-WASM Bundling for
Lambda" and "ssm:SendCommand IAM Statement Shape".

1. **`fix(infra): keep cedar-wasm external so its .wasm asset survives
bundling`** (`19c0798`). `@cedar-policy/cedar-wasm/nodejs` does a
   `__dirname`-relative `readFileSync('cedar_wasm_bg.wasm')` at module
   init. esbuild bundles the JS but drops the `.wasm`; Lambda init
   crashed with `ENOENT` and API Gateway returned a bare 500 before
   Hono's `onError` could format an envelope. Fix: list the package
   under `bundling.nodeModules` (not `externalModules`) in the
   `NodejsFunction` so CDK installs it as a real `node_modules` dep.
   **Has been broken on staging since 2026-05-03 (PR #91 merge).**
   Prod was protected by the staging E2E gate but had no working
   image either — see #3 below for why prod was hitting a different
   bug instead.

2. **`fix(infra): scope ssm:SendCommand to AWS-managed doc ARN`**
   (`8b32df1`). The original SendCommand statement listed the
   document as `arn:aws:ssm:${region}:${account}:document/...`, but
   `AWS-RunShellScript` is AWS-managed and its ARN has an empty
   account portion. The templated ARN never matched the runtime
   resource so the call was denied.

3. **`fix(infra): split ssm:SendCommand statement so the document
isn't gated on instance tag`** (`e08b3c8`). After fixing the ARN,
   SendCommand was still denied because the `ssm:resourceTag/Name`
   condition (which scopes the _instance_ to the WireGuard hub) was
   in the same statement as the document. Tag conditions evaluate
   per-resource and the AWS-managed document has no customer tags,
   so the statement was filtered out for the document side of the
   authorization. Fix: split into two statements — instance with the
   tag condition (the actual safety guarantee), document
   unconditional.

### Plumbing improvement queued as a follow-up

Staging was red for two days before anyone noticed. The E2E gate
caught PR #91's broken deploy and correctly stopped it at staging,
but the next two pushes were plan-only — path filter excluded the
api so no fresh deploy fired, no fresh failure was visible, and
nothing else alarmed on staging being at a 100 % 5xx rate. Carved
out as `plans/todo/staging-api-health-alarm.md`.

## Out of scope

- Path (b) — Cognito hosted-UI login fixture for remote specs. Its own
  plan once authenticated remote specs are actually needed (gate
  expansion beyond `health` + `landing`).
- Migrating the diagnose endpoint to streaming/SSE (still in PR #87's
  out-of-scope list).

## References

- Parent plan (closed): `plans/completed/2026-05-03T2200-post-batch-followups.md`
- Original feature plan: `plans/completed/admin-web-vpn-diagnose-button.md`
- Spec to un-skip: `apps/e2e/tests/browser/admin-vpn-diagnose.spec.ts`
- Endpoint under test: `apps/admin-web` tenant detail → **Run Diagnose**
- AuthZ branch to wait on: `feat/avp-authz-foundation`
