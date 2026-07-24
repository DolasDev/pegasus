# 0027 — enable the outbound OAuth shared token cache on prod

## Why

The shared token cache (sdk-feedback 0027) is proven on QA. Live measurement (2026-07-24),
6 concurrent `call_external` calls read from the QA API log group:

- flag OFF → `mints=6 l1=0 l2=0` across 6 container instanceIds (the failure 0027 reported)
- flag ON  → `mints=0 l1=1 l2=5` across 6 container instanceIds (token-endpoint hits 6 → 0)

Staging soaked clean. The operator asked to enable prod too.

## Change

`packages/infra/bin/app.ts`: widen the one gate from
`outboundOAuthSharedCacheEnabled = envName === 'staging'`
to `=== 'staging' || envName === 'prod'` — matching the shape of the adjacent
`integrationConfigPublishEnabled` gate. Nothing else changes; the prop→env-var wiring shipped
in #521 and was activated for staging in #532.

## Risk / rollback

Additive and flag-gated. If a partner turns out to reject reused tokens, revert this gate (or set
the env var off) — instantly revocable, no data migration. The L2 store is KMS-encrypted with the
same key the api Lambda already holds; a shared-tier failure degrades to a mint (never fatal); a
401 clears both tiers.

## Verify after deploy

Re-run the same 6-concurrent probe against **prod** (`api.pegasus.dolas.dev`, `[default]`/`[nw]`
credential) and read the prod API log group via `dolas-pegasus-prod-ro`: expect ~1 mint + L2 hits.
Tear down the throwaway `oauth0027probe` config afterward.

## Out of scope

- Editing `sdk-feedback/0027-*.md` — the requester validates and flips it.
