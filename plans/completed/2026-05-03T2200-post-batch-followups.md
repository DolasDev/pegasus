# Post-batch follow-ups (PRs #87, #88, #89)

## Context

Three plans landed together via squash-merge on 2026-05-01:

- **#87** `feat(admin-web): wire VPN Diagnose button on tenant detail`
- **#88** `ci(deploy): gate prod on staging E2E smoke`
- **#89** `fix(infra): pin remaining cognito cross-stack exports`

Each shipped with deferred validation that requires real staging/prod
infrastructure or auth scaffolding the workers were not allowed to
introduce. This plan tracks what's left so the work doesn't go stale.

## Goal

Close out the three deferred validation tasks and the one stale-file
loose end, in the order safest-first.

## Plan

- [x] **1. Drift-check the Cognito pinning on the next staging deploy.**
      _Verified 2026-05-02 against deploy run 25238353996 (c5a93fb, the
      #89 merge itself). Staging cognito stack reported `(no changes)`
      and all four pinned exports (`ExportsOutputRefUserPool…`,
      `…TenantAppClient…`, `…MobileAppClient…`, `…HostedUiDomain…`)
      surfaced with their original auto-generated logical IDs intact.
      Best-case CFN outcome: zero adds/modifies/destroys._

      PR #89 confirmed `cdk synth` is byte-identical for the four
      newly-pinned exports, but CFN drift is the real contract. On the
      next push to `main` that triggers `deploy-staging`, confirm the
      CognitoStack changeset shows **only** metadata edits — no
      `Modify`/`Delete` on the `ExportsOutputRefUserPool…` outputs.
      If anything resource-level surfaces, hold the prod gate and
      investigate before promoting.

      _Verify:_ open the deploy run, expand the
      `pegasus-staging-cognito` step, confirm
      `Resources: 0 to add | 0 to modify | 0 to destroy`. Outputs may
      show 4 to add (new explicit `CfnOutput`s) and 4 to remove (auto
      ones) — or, if CFN matches by export name, zero.

- [x] **2. Green-path validation of the staging-E2E gate (PR #88).**
      _Verified organically by deploy run 25238913734 (243dc77,
      tenant-web changes — flips `any=true` the same way an
      `apps/api/**` change would). Chain: deploy-staging ✅ →
      e2e-staging ✅ (Run E2E remote + Upload Playwright report both
      green) → deploy-prod ✅. Note: prod auto-promoted with no
      required-reviewer pause; this is the desired design — green gate
      is the only promotion criterion._

      Push a no-op change touching an `apps/api/**` path (e.g. a
      comment in `apps/api/src/server.ts`) so `changes.outputs.any` is
      true. Walk through the run:
      - `deploy-staging` → green
      - `e2e-staging` → green (only `health.spec.ts` + `landing.spec.ts`
        execute, per the `@local-only` invert)
      - `deploy-prod` → blocked on required-reviewer gate as before
      Confirm the `playwright-report-staging` artifact uploads.

- [x] **3. Red-path validation of the staging-E2E gate (PR #88).**
      _Verified 2026-05-03 against deploy run 25292028462. Throwaway
      branch `redpath-e2e-gate-test` (now deleted) carried two edits:
      removed the `github.ref == 'refs/heads/main'` guards on the three
      deploy jobs (workflow_dispatch from non-main branches is
      otherwise hard-blocked) and broke `health.spec.ts` to expect
      status 599. Triggered via `gh workflow run deploy.yml --ref
    redpath-e2e-gate-test -f target=api`. Result: deploy-staging ✅
      → e2e-staging ❌ (Run E2E remote failed) → deploy-prod
      **skipped** (not failed-and-promotable) → run conclusion
      `failure`. `playwright-report-staging` artifact uploaded
      (629 KB)._

      On a throwaway branch (or via `workflow_dispatch` then immediate
      revert), break a gate-eligible assertion in `health.spec.ts` or
      `landing.spec.ts`. Push, observe:
      - `e2e-staging` fails
      - `deploy-prod` is **skipped** (not failed-and-promotable)
      - `playwright-report-staging` artifact contains the failure
      Revert the assertion change in the same session.

- [ ] **4. Authenticated browser-spec helper, then un-skip the VPN
      diagnose spec (PR #87).**
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

- [ ] **5. Manual smoke of the diagnose button against a real
      tenant.** Once (4a) is in, run `npm run dev -w apps/admin-web`
      (port 5174), open a real staging tenant, click **Run Diagnose**,
      confirm the spinner ticks, the report renders, and a deliberate
      failure (e.g. tenant offline) shows the red first-failure
      callout. The endpoint can take 30+ s — that's expected.

- [x] **6. Tidy stale `plans/todo/` entry.**
      _Done in 66824ae (2026-05-03). `plans/todo/gate-prod-deploy-on-staging-e2e.md`
      removed; `plans/completed/79135c7-…` is the canonical copy._
      PR #88 archived its plan
      to `plans/completed/79135c7-gate-prod-deploy-on-staging-e2e.md`
      but left `plans/todo/gate-prod-deploy-on-staging-e2e.md` on
      `main`. Delete it in a one-line chore commit so `plans/todo/`
      reflects only actually-pending work.

## Out of scope

- Expanding the staging-E2E gate beyond `health` + `landing`. That's
  a separate plan once authenticated remote specs are practical.
- Migrating the diagnose endpoint to streaming/SSE (still in PR #87's
  out-of-scope list).
- Re-pinning DocumentsStack or WireGuardStack cross-stack refs. Wait
  until they actually drift, per the precedent set by PR #89.

## References

- PR #87: <https://github.com/DolasDev/pegasus/pull/87>
- PR #88: <https://github.com/DolasDev/pegasus/pull/88>
- PR #89: <https://github.com/DolasDev/pegasus/pull/89>
- Archived plans: `plans/completed/admin-web-vpn-diagnose-button.md`,
  `plans/completed/79135c7-gate-prod-deploy-on-staging-e2e.md`,
  `plans/completed/a7485ee-pin-remaining-cognito-cross-stack-exports.md`
