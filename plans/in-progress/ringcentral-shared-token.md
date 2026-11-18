# RingCentral shared access token (stop evicting legacy movemanager sessions)

**Branch:** `fix/ringcentral-shared-token` (worktree `../pegasus-ringcentral-shared-token`)
**Goal:** Every cloud caller of a RingCentral connection shares ONE access token, so the cloud
stops creating ~190 RC sessions/day that push legacy movemanager's shared token out of RC's
~5-sessions-per-user-per-app cap (NW users see 401 OAU-213 "Token not found").

## Evidence (prod, 7 days, 2026-11-18)

| Caller                                      | Runs/day                         | Mints/day |
| ------------------------------------------- | -------------------------------- | --------- |
| sync cron (15m)                             | 96, all cold starts              | 96        |
| renew cron (1h)                             | 24, all cold, mints even on noop | 24        |
| token-refresh cron (30m)                    | 48, bypasses cache by design     | 48        |
| capture worker (SQS, per webhook)           | 3–34, mostly cold                | 2–26      |
| API Lambda (send / mark-read / attachments) | low (23 sends in 60 days)        | ≤ a few   |

The in-memory cache in `services/ringcentral/client.ts` never survives because every cron
invocation is a cold start. movemanager reuses its one company-wide token for ~30 min and has no
401 recovery, so it is the party that surfaces the eviction. (Movemanager-side fix = follow-up "fix 3".)

## Design

- **L2 store**: new table `ringcentral_access_tokens` (PK `connection_id`, FK → connection,
  cascade delete): `token_ciphertext` (KMS, `WORKFLOW_TOKEN_KMS_KEY_ID`, context
  `{purpose:'ringcentral_access_token', connectionId}`), `token_hash` (sha256 of the plaintext,
  for compare-and-delete), `api_base`, `expires_at`.
- **Lookup**: L1 (per-container Map) → L2 → single-flight mint. Reuse a token only while it has
  more than 5 min left.
- **Single-flight mint**: Prisma interactive transaction + `pg_advisory_xact_lock(hashtextextended(...))`
  keyed on connection id (10 s tx timeout, under the API Lambda's 29 s wall); re-check L2 inside
  the lock and mint only if still stale. Concurrent cold containers wait instead of each minting
  (duplicate mints ARE the bug here, unlike outbound-oauth's last-write-wins). A token minted inside
  the lock is used even if storing it fails, so a write failure never costs a second session.
- **401**: `withRingCentralToken(connection, fn)` runs `fn(client)`; on a 401 from `fn` it
  compare-and-deletes the L2 row only if its hash still equals the token that failed (a newer token
  minted by another container is not thrown away), drops L1, re-acquires, and retries once. A 401
  on the retry is NOT discarded (a brand-new token rejected twice isn't a token problem). A failure
  acquiring the token is not retried. Used by sms, message-store, sync, subscription-manager;
  attachments does the same by hand (raw fetch). A 401 means RC rejected the request before acting,
  so the retry is safe.
- **Renew cron**: a healthy subscription not due for renewal returns `noop` without acquiring a token.
- **Connect / reconnect**: the validation exchange's token is adopted as the shared token
  (`adoptMintedToken`), so it is not wasted and a reconnect with new credentials (e.g. a dedicated
  RC app) takes effect immediately instead of after the old token's ~1 h.
- **Degrade**: any DB or KMS failure in L2 → plain mint (warn log). `RINGCENTRAL_SHARED_TOKEN_DISABLED=true`
  turns L2 off without a code change.
- **Health check cron**: no longer mints. It calls `GET /restapi/v1.0/account/~/extension/~` through
  `withRingCentralToken`, so it uses the shared token. EXPIRED/UNHEALTHY only when the **token
  endpoint** refuses the credentials (new `RingCentralTokenExchangeError`, 4xx except 429), the same
  as before. A 4xx from the probe call is DEGRADED, so it can't take a connection offline.
- **Observability**: one `ringcentral token` log line per acquire, with
  `outcome: l1_hit | l2_hit | l2_hit_after_lock | mint | mint_unshared`, `connectionId` and
  `instanceId`, so the mint rate can be measured in prod after deploy.
- **Raw SQL**: the advisory-lock query adds `repositories/ringcentral-access-token.repository.ts`
  to the db-access-guard allowlist (parameterized; reads no table). Flag for security review.
- **Infra**: the sync, renew, token-refresh and capture Lambdas get `WORKFLOW_TOKEN_KMS_KEY_ID` +
  `grantEncryptDecrypt` (the API Lambda already has both).

## Checklist

- [x] Prisma model + migration `ringcentral_access_tokens`
- [x] `lib/ringcentral-token-crypto.ts` (KMS encrypt/decrypt with context)
- [x] `repositories/ringcentral-access-token.repository.ts` (find, single-flight, compare-and-delete) + integration test (advisory lock serializes concurrent mints)
- [x] `services/ringcentral/client.ts`: tiered acquire + `withRingCentralToken`; unit tests
- [x] Route sms / attachments / message-store / sync / subscription-manager through `withRingCentralToken`; update tests
- [x] token-refresh cron: shared-token health probe instead of mint; tests
- [x] infra: KMS env + grant on the 4 RC Lambdas; infra tests/snapshots
- [x] typecheck, api unit + integration, infra tests
- [x] Review fixes: adopt connect token; no discard on 2nd 401; no retry on acquire failure;
      health-check EXPIRED only on token-endpoint 4xx; crypto + env-gate tests; 10 s lock timeout
- [x] GOTCHAS.md
- [ ] `npm test` (root) green; archive plan; one PR via merge queue
- [ ] Post-deploy (first hour, API + 4 RC log groups): `mint` + `mint_unshared` ≈ 1/h in total;
      zero `ringcentral shared token … failed` warns; a table/KMS problem looks like today's
      behaviour, so check, don't assume
- [ ] Then: confirm with NW that the OAU-213 reports stop (same-app/same-user premise is still
      unverified — this fix cuts cloud sessions ~190/day → ~24/day either way)
- [ ] Follow-up "fix 3": movemanager re-mints + retries once on 401 OAU-213
