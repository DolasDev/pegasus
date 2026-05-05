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

- [ ] **2. Manual smoke of the diagnose button against a real
      tenant.** Once (1) is in, run `npm run dev -w apps/admin-web`
      (port 5174), open a real staging tenant, click **Run Diagnose**,
      confirm the spinner ticks, the report renders, and a deliberate
      failure (e.g. tenant offline) shows the red first-failure
      callout. The endpoint can take 30+ s — that's expected.

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
