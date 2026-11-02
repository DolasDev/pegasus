# Retire pegII hub auth — cloud-issued tokens only (cloud side)

**Branch:** `chore/retire-pegii-hub-auth` (worktree `../pegasus-retire-pegii-hub-auth`, off `origin/main`)
**Goal:** every authenticated pegII bridge call carries a cloud-issued ES256 token; the hub
service-user login (`pegii.auth.v1`), the raw-bearer `apiKey` path and `Tenant.pegiiApiKeyRef`
reads are removed, and a site that can't take a cloud token fails fast with 503
`PEGII_CAPABILITY_MISSING` before any request is sent.

Cross-repo plan (approved by the developer 2026-10-30): movemanager
`plans/in-progress/retire-hub-auth.md`, **Phase A**. Phases 0/B/C (ops + site + desktop) are not
in this repo.

## Decisions (already made)

- Fail-fast in `resolveAuth()`: no caller, `site.cloudAuthEnabled=false`, or `/version` without
  `pegii.cloud-auth.v1` ⇒ `PegiiApiError('PEGII_API_CAPABILITY_MISSING')` (→ 503
  `PEGII_CAPABILITY_MISSING`, which pegasus-workflows treats as non-retryable). No request is sent.
- A failed `/version` probe propagates its own error — no fallback.
- `getHealth()` stays unauthenticated and works without a caller (`settings-pegii.ts` calls it
  with none).
- `Tenant.pegiiApiKeyRef` Prisma column stays (dropping it is a later destructive migration); the
  code just stops reading/writing it.
- Email gateway requires `[CloudAuth, Email]` and forwards the caller's correlationId.

## Checklist

1. [x] Email gateway: red test for `[CloudAuth, Email]` + correlationId → green.
2. [x] Client fail-fast: rewrite legacy cases in `pegii-api-client-cloud-auth.test.ts` (red) →
       delete `legacyAuth`/`apiKey`/raw-bearer in `pegii-api-client.ts`, `resolveAuth()` throws.
       Update `pegii-api-client.test.ts` cases that relied on no-auth sends to use the `auth` seam.
3. [x] Move `PegiiTokenProvider` into `pegii-token.ts`; delete `pegii-auth.ts` + its test.
4. [x] Remove `PEGII_API_AUTH_UNAVAILABLE` (error union, http mapping + its test, openapi-spec).
5. [x] Stop threading `apiKey`: overlay target, gateway factories + tests, per-gateway options,
       email resolver, `settings-pegii.ts` (drop `pegiiApiKeyRef` PATCH + `pegiiApiKeyConfigured`
       GET) + tests. Prisma column kept.
6. [x] Infra: drop the `pegasus/<env>/pegii/*` GetSecretValue grant + its assertion — only if a
       grep proves nothing else uses that prefix.
7. [x] Remove `PegiiCapabilities.Auth`; fix header comments describing the legacy path.
8. [x] Docs: DECISIONS.md, PATTERNS.md, `plans/todo/cloud-identity-and-companies.md` mark the hub
       fallback removed. (pegasus-workflows comment: not this repo — not touched.)
9. [x] Targeted tests, then root `npm test`; e2e if its DB prerequisites are up.
       `/security-review` is handled by the parent session. No commit / push / PR.

## Files

- `apps/api/src/lib/pegii-api-client.ts`, `pegii-api-error.ts`, `pegii-token.ts`,
  `pegii-capabilities.ts`, `pegii-overlay-target.ts`, `openapi-spec.ts`
- deleted: `apps/api/src/lib/pegii-auth.ts`, `apps/api/src/lib/__tests__/pegii-auth.test.ts`
- `apps/api/src/gateways/*-gateway.factory.ts`, `pegii-*.gateway.ts` and their tests
- `apps/api/src/handlers/settings-pegii.ts` + test
- `packages/infra/lib/stacks/api-stack.ts` + `__tests__/api-stack.test.ts` (step 6, conditional)
- `dolas/agents/project/DECISIONS.md`, `PATTERNS.md`, `plans/todo/cloud-identity-and-companies.md`

## Risks

- A flag-off site (or one without `pegii.cloud-auth.v1`) now errors 503 where it used to send an
  unauthenticated/legacy request. Prod has no credential set anywhere (`pegii_api_key_ref` NULL), so
  prod already fails at the site; Phase 0 enables cloud auth on the remaining sites.
- Removing the `pegiiApiKeyRef` PATCH field is an API contract change for `/settings/pegii`:
  the schema is `.strict()`, so a client still sending it gets 400 VALIDATION_ERROR. No consumer
  in this repo (tenant-web, admin-web, e2e, SDK) sends it or reads `pegiiApiKeyConfigured`.

## Progress notes

- Step 1: email gateway now gates on `[CloudAuth, Email]` and takes an optional `caller` whose correlationId goes to the /version probe (new test case).
- Step 2: `resolveAuth()` now throws `PEGII_API_CAPABILITY_MISSING` for no caller / switch off /
  capability absent; a probe error propagates; a rejected auth choice is not pinned on the client
  (next call re-resolves). `pegii-api-client.test.ts` request-shape tests use the `auth` seam
  (`tokenAuth()`); the raw-bearer test was removed with the feature.
- Step 3: `PegiiTokenProvider` lives in `pegii-token.ts`; `pegii-auth.ts` + test deleted.
- Step 4: code, mapping, mapping assertion and openapi `PEGII_AUTH_UNAVAILABLE` removed.
- Step 5: overlay target returns `{ base }` only and selects only `pegiiApiBaseUrl`; all 7
  factories + 8 pegII gateways + email resolver drop `apiKey`; settings-pegii drops the PATCH field
  and GET flag (new test: PATCH with `pegiiApiKeyRef` → 400). Factory tests gained a strict
  `not.toHaveProperty('apiKey')` (plain `toHaveBeenCalledWith` ignores undefined keys).
  `customer-gateway.integration.test.ts` now passes a cloud-auth caller (it relied on the
  no-credential send). Every production factory call site already passes `callerOf`.
- Step 6: grep of the repo (code, infra, scripts, docs) found the `pegasus/<env>/pegii/*` prefix only
  in `api-stack.ts` (the grant) and plan prose; the only reader was `pegii-auth.ts`. Grant removed;
  the stack test now asserts no IAM policy names that prefix.
- Step 7: `PegiiCapabilities.Auth` removed (test asserts `pegii.auth.v1` is unknown); header
  comments in capabilities, request-context, overlay-target, factories, settings-pegii,
  db-access-guard test fixed.
- Step 8: DECISIONS.md (both cloud-identity entries), PATTERNS.md (driver-financials policy) and
  `plans/todo/cloud-identity-and-companies.md` record the fallback as removed. pegasus-workflows
  comment left untouched (separate repo, out of scope).
- Step 9: `npm run typecheck` ✓, eslint on changed files ✓, root `npm test` ✓ (16/16 tasks; api
  4692, infra 433, tenant-web 1696 … all passed). e2e run 1: 30 passed / 1 failed / 38 skipped —
  `usage-meter.spec.ts` "a person closing a task counts nothing" got 502 instead of 503; it passes
  alone (4/4) and run 2 of the full suite was clean (34 passed, 38 skipped). Cause: a cross-spec race
  — `vpn.spec.ts` seeds an ACTIVE `VpnPeer` for the same tenant, so with 2 workers the task route can
  resolve a target and fail at the tunnel (502). Pre-existing ordering flake, not this change.
- Not done here (by instruction): commit, push, PR, `/security-review`.

## Resume here

All Phase A steps done; changes are uncommitted in this worktree. Next: parent session reviews
(`/security-review`), then commit + PR per `dolas/agents/team/workflow.md` when asked.
`apps/e2e/.env.test` shows as modified — that is `scripts/new-worktree.sh` pointing it at this
worktree's DB, not part of the change; do not commit it.
