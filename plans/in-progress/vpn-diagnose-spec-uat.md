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

- [ ] **1. Authenticated browser-spec helper, then un-skip the VPN
      diagnose spec.**
      `apps/e2e/tests/browser/admin-vpn-diagnose.spec.ts` ships
      `test.skip`-gated with a TODO. The blocker: no helper exists to
      log a Playwright session into admin-web's `_auth` routes. Two
      paths:

      a. **Local-only path** (cheaper, ships sooner): use
         `SKIP_AUTH=true` against the local API (matches what most
         existing API specs assume) and add a thin `loginAsAdmin()`
         fixture that seeds a session cookie. Tag the spec
         `@local-only` so the staging gate still excludes it. This
         un-skips the spec for local CI but keeps the gate scope
         narrow.

      b. **Remote-capable path** (eventually needed): wire a Cognito
         hosted-UI login fixture using
         `E2E_COGNITO_USER_POOL_ID` / `E2E_COGNITO_CLIENT_ID` (both
         already plumbed by PR #88, currently unused). This is its own
         plan — sketch it but don't build it here.

      Recommend (a) for this follow-up. Verify by removing
      `test.skip` and running
      `npm --prefix apps/e2e run e2e -- admin-vpn-diagnose` locally.

      **Re-evaluate after AuthZ lands**: if the new model gates admin
      routes through Cedar policies rather than a simple `SKIP_AUTH`
      bypass, path (a) may need to seed a Cedar entity/policy instead
      of (or in addition to) the cookie. Check
      `apps/api/src/lib/authz.ts` and `apps/api/src/handlers/me.ts`
      for the new contract before writing the fixture.

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
