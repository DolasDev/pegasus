# Plan — Publish SDK + validate the ADE ingress/outbound suite (post-context-clear)

## Context

The five Sirva ADE SDK-feedback specs (0021/0022/0023/0025/0026) were built and merged
into `~/repos/pegasus` as five PRs (#444/#446/#447/#448/#450), bumping the Python SDK
`packages/workflows-sdk-python` cumulatively to **0.19.0**. The remaining follow-up is the
back half of the SDK feedback loop: **publish the SDK to PyPI**, **upgrade it in the
consumer repo** `~/repos/pegasus-workflows`, and **validate each spec** against its
acceptance criteria by running the ADE workflows there with their stubs removed, then mark
the specs `Validated`.

Memory: [[project_sirva_ade_ingress_outbound_suite]]. Publish precedent:
[[project_workflows_sdk_pypi_published]] (re-tag recipe for failed publishes),
[[project_sdk_060_specs_shipped]].

## PROGRESS (2026-07-16)

- **Phase 0 ✅** #450 (0021) was BLOCKED by `Secret Scanning (Betterleaks)`: 4 false-positive
  `generic-api-key` hits on fake test fixtures (`ing_abc12345`). The documented `.betterleaksignore`
  fingerprint fix would have **resurfaced on main under the squash SHA** (verified empirically) →
  wedged the queue. Fixed instead with inline `gitleaks:allow` comments (SHA-independent, survives
  squash) — amended `feat/inbound-ingress`, force-pushed; also fixed a follow-on `Ruff (SDK)` E501.
  #450 merged (main HEAD `e43a5b1`, SDK 0.19.0); **post-merge main secret-scan = green**. Runbook
  gap documented in `dolas/agents/project/GOTCHAS.md` (rides this workstream's PR).
- **Phase 1 ✅** Tagged `sdk-python-v0.19.0` on `e43a5b1`; release workflow published to PyPI
  (trusted publishing). Verified live: `pegasus-workflows-sdk 0.19.0` (wheel + sdist) on PyPI.
- **Phase 2 ✅** `~/repos/pegasus-workflows/requirements.txt` bumped to `==0.19.0`; venv reinstalled
  and reports `0.19.0`.
- **Phase 3 ⏸ BLOCKED ON ENV** Only configured `~/.pegasus/credentials` profiles (`[default]`, `[nw]`)
  point at `https://api.pegasus.dolas.dev` = **PROD**. Plan targets QA/staging; Phase 3 does live
  WRITES (schedule/ingress/blob/projection, un-stub+run). Awaiting user decision on env before
  running any write-validation. (Also still 0024-blocked for full normalize→persist runs.)

## Phase 0 — Preconditions (verify first)

1. Confirm **PR #450 (0021) has merged**: `gh pr view 450 --json state --jq .state` → `MERGED`.
   Until then `origin/main` is at SDK 0.18.0, not 0.19.0.
   `git -C ~/repos/pegasus fetch origin main -q && git -C ~/repos/pegasus show origin/main:packages/workflows-sdk-python/pyproject.toml | grep '^version'` must read `0.19.0`.
2. Tear down the last worktree once #450 is merged:
   `cd ~/repos/pegasus && scripts/rm-worktree.sh inbound-ingress` (leave `sso-account-linking` — not ours).

## Phase 1 — Publish SDK 0.19.0 to PyPI

The release workflow `.github/workflows/release-sdk-python.yml` is **tag-triggered**
(`sdk-python-v*`) and uses PyPI **trusted publishing** (OIDC — no token secret). 0.19.0 is
cumulative: it contains all five specs' SDK changes (0.16→0.19 are CHANGELOG markers; only
the latest cumulative artifact is published, matching prior releases).

```
cd ~/repos/pegasus && git checkout main && git pull
git tag sdk-python-v0.19.0            # on the merged main commit
git push origin sdk-python-v0.19.0
gh run watch $(gh run list --workflow release-sdk-python.yml -L1 --json databaseId --jq '.[0].databaseId')
```

- Verify on PyPI: `pip index versions pegasus-workflows-sdk` (or the project page) shows 0.19.0.
- **If publish fails** (latent release-workflow bugs have bitten before — SDK ruff only runs at
  release; `pip_audit` invocation): fix on a branch/PR, then **re-tag** — delete the tag local+remote
  (`git tag -d sdk-python-v0.19.0; git push origin :sdk-python-v0.19.0`), re-tag the fixed commit,
  push again. Do NOT bump the version to force a re-run.
- GOTCHA ([[project_workflow_secrets_groups]]): `gh pr checks | grep pending` settles early on
  QUEUED — use `gh run watch`.

## Phase 2 — Upgrade the SDK in the consumer repo

`~/repos/pegasus-workflows` pins the SDK in `requirements.txt` (currently
`pegasus-workflows-sdk==0.14.0`; the `.venv` had 0.15.0). Bump + reinstall:

```
cd ~/repos/pegasus-workflows
sed -i 's/^pegasus-workflows-sdk==.*/pegasus-workflows-sdk==0.19.0/' requirements.txt
.venv/bin/pip install -r requirements.txt
.venv/bin/pip show pegasus-workflows-sdk | grep Version   # expect 0.19.0
```

(If PyPI propagation lags, install from the tag:
`pip install "pegasus-workflows-sdk @ git+https://github.com/DolasDev/pegasus@sdk-python-v0.19.0#subdirectory=packages/workflows-sdk-python"`.)

## Phase 3 — Validate each spec against acceptance criteria

Specs live in `~/repos/pegasus-workflows/sdk-feedback/00NN-*.md`; the ADE workflows are in
`~/repos/pegasus-workflows/platform/allied-vanlines/` and ship **stubbed** (activities raise
`NotImplementedError`, `maximum_attempts=1`). Un-stub the relevant activity (the real body is
in each stub's docstring), then exercise it. Target env: the QA/staging API + a real ADE
sandbox endpoint (or a stub endpoint) — needs config/secrets set via
`pegasus-workflows config set` / `secrets set`.

> **BLOCKED-ON-0024 caveat:** several ADE workflows' `normalize` steps call
> `map_from_external` + a built-in `sirva_ade_*` floor (spec **0024**, NOT built). Those
> steps stay stubbed, so the _normalize→persist_ half can't run end-to-end yet. Validate the
> **capability each spec adds** in isolation (below), and note the 0024 dependency where the
> full workflow can't complete. Do 0024 first if full-workflow runs are wanted.

Per spec (mirror each spec's `## Acceptance criteria`, fill its `## Validation log`):

- **0022 `call_external`** (`ade_shipment_detail_sync` / `ade_compensation_sync`): a `GET`
  returns parsed data under `pegasus-workflows run --dry-run` (live), a `POST` is captured;
  two sequential calls mint **one** token, a forced 401 re-mints; an **XML** token/response
  parses. Config: `BASE_URL`/`AUTH_MODE=oauth2_client_credentials`/`TOKEN_URL` +
  `CLIENT_ID`/`CLIENT_SECRET`.
- **0023 scheduled triggers** (`ade_lead_poll`): `pegasus-workflows schedule create ade_lead_poll
--cron "*/5 * * * *"`; observe **≥2 fires** at cadence in `executions list`; the firing input
  is `{scheduledAt, schedule, triggerId}` (at `arg["input"]`); overlap-skip when a run overruns;
  the schedule survives a re-`push`.
- **0025 blob** (`ade_document_pull` / `ade_document_push`): `put_blob`→`get_blob` round-trips
  identical bytes up to the cap (over-cap → 413); `ade_document_pull` `response_to_blob` lands a
  GET into a blob; a `POST` `AddDocument` with `FileData:{"$blob":id}` inlines the bytes; TTL +
  tenant isolation hold. (≤5 MB inline; large files are the follow-up.)
- **0026 read model** (`ade_shipment_event_ingest`): `put_projection` persists canonical +
  `emit_event` carries the **key, not the body**; a non-workflow
  `GET /api/v1/integrations/:id/projections/:entityType?status=…` returns a **filtered subset**;
  a role without `ReadIntegrationProjection` gets 403. (Persist+notify are already real; the
  normalize step is 0024-blocked.)
- **0021 ingress** (`ade_shipment_event_ingest`): `pegasus-workflows ingress create
sirva_ade_shipment` → URL + one-time token; publish the `inbound` block on the integration
  config (eventType/dedupKeyPath/ackTemplate — see the spec's ADE example); unauth POST → **401**;
  valid POST of a sample Shipment Operational Event → **200 with the ADE `Result` Success ack
  synchronously** (before the bound workflow finishes); a bound EVENT-trigger workflow execution
  appears; a redelivered `Id` de-dupes; rotation invalidates the old token; malformed body →
  `Failed` envelope.

## Phase 4 — Record results

- For each spec: set `Status:` (`Validated` if criteria pass, `Needs work` if not — with notes),
  fill `SDK version that addresses it: 0.19.0`, and complete the `## Validation log`.
- Update the index table + statuses in `~/repos/pegasus-workflows/sdk-feedback/README.md`
  (and add a dated re-check note like the existing ones).
- Commit in `pegasus-workflows` (its own repo; no merge queue there — direct commit/push per its
  conventions). If the ADE workflow stubs were un-stubbed and published, record the publish.

## Verification

The whole plan is "green" when: PyPI shows `pegasus-workflows-sdk 0.19.0`; the consumer repo's
venv reports 0.19.0; each spec's acceptance checks are exercised and logged; and the sdk-feedback
index reflects the outcome. Where a criterion is 0024-blocked, that's an explicit noted gap, not a
failure of 0021/0022/0023/0025/0026.
