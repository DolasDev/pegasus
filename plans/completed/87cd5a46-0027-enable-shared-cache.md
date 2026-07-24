# 0027 step 2 — enable the shared OAuth token cache on staging/QA

## Why

The flag-off measurement is done and **confirms the diagnosis** behind sdk-feedback 0027.
On QA (staging), with `OUTBOUND_OAUTH_SHARED_CACHE_ENABLED` off, **6 concurrent `call_external`
calls produced 6 token mints across 6 distinct container `instanceId`s, 0 cache hits** — each
Lambda container mints its own token because the L1 cache is per-container. Raw log evidence
(2026-07-24, QA API log group `pegasus-staging-api-ApiLogGroup…`):

```
mints=6  l1_hits=0  l2_hits=0   distinct instanceIds=6
```

That is exactly the failure 0027 reported, now reproduced deterministically and observed in the
logs rather than inferred.

## Change

`packages/infra/bin/app.ts`: add `outboundOAuthSharedCacheEnabled = envName === 'staging'` and
thread it into the `ApiStack` props (alongside `integrationConfigPublishEnabled`). **Staging/QA
only** — prod stays off until QA re-probe confirms the fix (user's explicit choice).

The prop → env-var wiring already shipped in #521; this only turns it on for one environment.

## Verify after deploy

Re-run the identical 6-concurrent probe against QA. Expect **~1 mint + ~5 `l2_hit`** (a small
cold-start stampede of 2–3 mints is acceptable and benign — last-write-wins upsert). That is 0027's
acceptance criterion demonstrated live.

Then tear down the QA probe config (group `oauth0027probe`: BASE_URL/AUTH_MODE/TOKEN_URL configs +
CLIENT_ID/CLIENT_SECRET secrets).

## Out of scope

- Prod enablement (separate, after QA confirmation).
- Editing the `sdk-feedback/0027-*.md` status line — the requester validates and flips it.
