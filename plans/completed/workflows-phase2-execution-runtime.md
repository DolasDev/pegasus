# Pegasus Workflows — Phase 2: Server-Side Execution Runtime

> ## ✅ PHASE COMPLETE (last updated 2026-06-09)
>
> **All units MERGED AND LIVE on staging + prod.** Units 6.5 + 7 landed in parallel via `/batch` on 2026-06-09 (#229 + #228). Phase 2 is feature-complete; this plan is archived to `plans/completed/`.
>
> | Unit                                       | Status               | Reference                     |
> | ------------------------------------------ | -------------------- | ----------------------------- |
> | 1 — Execution schema + manifest foundation | ✅ MERGED + DEPLOYED | #134 → `9563eb8` (2026-05-22) |
> | 2 — Fork endpoint                          | ✅ MERGED + DEPLOYED | #135 → `b733257` (2026-05-22) |
> | 3 — Per-workflow runtime service account   | ✅ MERGED + DEPLOYED | #136 → `ea39600` (2026-05-22) |
> | 4 — Temporal Cloud + Fargate worker infra  | ✅ MERGED + DEPLOYED | #186 → `7d5955b` (2026-06-06) |
> | 5 — The Temporal worker process            | ✅ MERGED + DEPLOYED | #188 → `a21afb5` (2026-06-06) |
> | 6 — Execution API                          | ✅ MERGED + DEPLOYED | #195 → `b55299e` (2026-06-07) |
> | 6.1 — stdlib server args contract          | ✅ MERGED + DEPLOYED | #196 → `50d2659` (2026-06-07) |
> | 6.2 — AVP bulk-sync throttle retry         | ✅ MERGED + DEPLOYED | #198 → `57e344b` (2026-06-07) |
> | 6.5 — Reconcile poller (fast-follow)       | ✅ MERGED + DEPLOYED | #229 (2026-06-09)             |
> | 7 — tenant-web execution UI                | ✅ MERGED + DEPLOYED | #228 (2026-06-09)             |
>
> **Live runtime state (verified 2026-06-07):**
>
> - `pegasus-temporal-worker-{staging,prod}` Fargate clusters: `Running: 1`, `Rollout: COMPLETED`. Workers polling `pegasus-stdlib-{staging,prod}` task queues on Temporal Cloud namespace `pegasus-{staging,prod}.chgel`.
> - API endpoints live on both envs: public `POST /api/v1/workflows/:id/run`, `GET /:id/executions[/:executionId]`; internal (m2mV1 shared-secret-header) `POST /api/v1/internal/workflow-runtime-token`, `PATCH /api/v1/internal/workflow-executions/:id`.
> - AVP policy stores: all tenants re-synced with the new `RunWorkflow` Cedar action via #198's retry-protected `SyncAvpPoliciesTrigger`.
> - Pre-Unit-6 worker `WARN status_sync.endpoint_missing` log lines should stop appearing once a workflow actually runs (no executions have been triggered live yet — see live-smoke test below).
>
> **Operator prereqs — all satisfied (no action needed):**
>
> - ✅ Temporal Cloud namespaces, gRPC endpoints (`TEMPORAL_ADDRESS` map in `bin/app.ts`), Secrets Manager secrets with full ARNs in `TEMPORAL_SECRET_ARNS` map, KMS runtime-token key, ECR repo + Fargate scaffolding, ECR push + ECS update IAM on `pegasus-github-actions-deploy-{staging,prod}`. See `[[project_workflows_phase2_status]]` for the full inventory.
>
> **Recommended live smoke test BEFORE starting 6.5 / 7 (~5 min):**
>
> The Phase 2 happy path has been tested end-to-end at the unit + handler level but NOT triggered live yet. Worth a single execution to confirm the broker fetch + status PATCH + worker activity all wire up correctly:
>
> 1. Identify the `send_quote_followup` workflow id on a staging tenant (via the tenant-web "Workflows" page, or `SELECT id FROM workflows WHERE name = 'send_quote_followup' AND tenantId = ... LIMIT 1` after forking the global).
> 2. `curl -X POST https://api.pegasus-qa.dolas.dev/api/v1/workflows/<id>/run -H "Authorization: Bearer <vnd_…>" -H 'Content-Type: application/json' -d '{"input": {"quote_id": "Q-test"}}'` — needs an API key with the `RunWorkflow` action (any `workflow_developer`-or-higher persona).
> 3. Watch CloudWatch `/pegasus/staging/temporal-worker` — should see `worker.run` → activity → `status_sync.ok` (not `…endpoint_missing`).
> 4. `GET /api/v1/workflows/<id>/executions/<executionId>` returns `status: COMPLETED` with `result` set to the composed follow-up message.
>
> If the smoke test fails, the most likely culprits in order are: (a) `WORKFLOW_BROKER_SECRET` env mismatch between API Lambda and worker — check both reference `pegasus/staging/workflow-broker-secret`'s current value; (b) `RunWorkflow` Cedar action not granted to the calling persona — check `apps/api/src/authz/policies/30-personas/workflow-developer.cedar`; (c) workflow id `wf/<tenantId>/<name>/<executionId>` collision (unlikely — REJECT_DUPLICATE only fires on exact id reuse).
>
> **Resume-session checklist:**
>
> 1. Read this file top-to-bottom + `[[project_workflows_phase2_status]]` memory.
> 2. If picking up Unit 6.5: read the "Unit 6.5 — Reconcile poller" section below + the "Key architecture decisions" execution-status-sync paragraph. Read `apps/api/src/repositories/workflow-execution.repository.ts` on `main` to see the `markTerminal` shape the poller reuses.
> 3. If picking up Unit 7: read the "Unit 7 — tenant-web execution UI" section + skim `apps/tenant-web/src/routes/settings.workflows.tsx` to see the Phase-1 + Unit-2 fork button shape. New executions list/detail UI follows that pattern.
> 4. **6.5 and 7 are mergeable in either order and can land in parallel** — 7 is additive frontend gated on `workflow:run`; 6.5 is a standalone Lambda. Pick whichever matters more for your release pressure.
> 5. Use the established pattern: research → plan → spawn worker agent in a worktree → PR → green CI → merge. See "Resume notes" at the bottom + the hotfix-chain at the end of Units 5 and 6 for gotchas.
>
> **Lessons accrued this phase (linked from `MEMORY.md`):**
> - `[[feedback_cdk_secret_complete_arn_for_ecs]]` — ECS secret env injection requires `Secret.fromSecretCompleteArn` with the full suffixed ARN, never `fromSecretNameV2`. (Burned 5 PRs learning this on Unit 5.)
> - `[[feedback_avp_bulk_sync_throttle_retry]]` — `SyncAvpPoliciesTrigger` needs `ThrottlingException` retry + per-tenant serial CreatePolicy above ~15 tenants. (Surfaced on Unit 6's prod deploy.)
> - `[[feedback_cdk_retain_orphans_on_rollback]]` — new stacks with `RemovalPolicy.RETAIN` + deterministic names leave orphans that block the next deploy after a CREATE_FAILED. (Hit on Unit 4.)
> - `[[project_workflows_phase2_status]]` — full unit-by-unit ledger and current live state.

## Context

Phase 1 of the Pegasus Workflows feature is shipped, merged, and deployed: tenants
author Python workflows locally with the `pegasus-workflows` SDK, upload signed
artifacts, and browse them; the platform team's curated `workflows-stdlib` publishes
GLOBAL workflows. **Nothing executes server-side yet** — Phase 1 was deliberately
"developer flow only".

Phase 2 adds the **execution runtime**: a self-hosted Temporal worker (ECS Fargate)
that runs curated workflows against Temporal Cloud, a manual run API, per-workflow
runtime credentials, execution tracking, and the one-click fork that closes the
Phase-1 "download-and-reupload" workaround.

This is a large phase, built as **7 sequential units**, each in its own git
worktree + branch → its own PR, executed in dependency order (not parallel).

## Phase 2 scope — locked decisions

- **Execution scope: curated stdlib workflows only.** The Fargate worker image
  bundles `packages/workflows-stdlib/` and executes only those. No arbitrary
  tenant-uploaded code runs server-side — so no sandbox/code-isolation design is
  needed. (Executing tenant-uploaded code is Phase 3.)
- **Triggers: manual run only** (`POST /workflows/:id/run`).
- **Runtime token: per-workflow service-account `vnd_` key**, minted at finalize.
- **Worker host: ECS Fargate in the WireGuard VPC**; Temporal Cloud is the
  orchestration server (workers are self-hosted).
- **Fork: deep copy + provenance** (`forkedFromWorkflowId`/`forkedFromVersion`).

### Explicitly OUT of scope (separate future phases)

- **Event-driven triggers** — to be designed as a first-class platform event bus,
  its own plan/phase. Not hacked in here.
- **Arbitrary tenant-code execution** + sandboxing — Phase 3.
- **Per-manifest dynamic token scoping** — Phase 2 collects `requiredActions` and
  displays it, but every runtime account gets a static `workflow_runtime` role.
- **Scheduled triggers.**

## Operator prerequisites (before Unit 4)

**✅ ALL SATISFIED 2026-06-05 — see the Resume Status block at the top of this file
for namespace names, account IDs, and Secrets Manager paths.** Original
requirement list retained below for plan completeness:

1. Temporal Cloud account + namespaces `pegasus-staging`, `pegasus-prod`; register
   custom search attributes `TenantId`, `PegasusWorkflowId`; set retention (~30d).
2. Temporal Cloud namespace credentials (mTLS cert+key or API key) in Secrets
   Manager at `pegasus/{env}/temporal-cloud` (existing `Secret.fromSecretNameV2`
   convention). → **Decision: API key (JWT) auth, JSON shape `{"apiKey": "..."}`.**
3. KMS key for runtime-token encryption (created in `ApiStack`, ARN exported).
   → Done as part of Unit 3 (#136).
4. Internal shared secret at `pegasus/{env}/workflow-broker-secret`.
5. ECR repo `pegasus-temporal-worker` (created by `TemporalWorkerStack`).

## Key architecture decisions

- **Runtime token delivery.** The per-workflow `vnd_` plaintext is never stored
  (existing `ApiClient` invariant) and never placed in Temporal workflow input
  (Temporal history is durable — a credential there outlives the run). Instead, at
  finalize the API KMS-encrypts the plaintext into `Workflow.runtimeTokenCiphertext`.
  The worker fetches the live token at activity start from a worker-only endpoint
  `POST /api/v1/internal/workflow-runtime-token` (KMS-decrypts, returns over TLS,
  only while the execution is `RUNNING`). Token lives in worker memory for the
  activity's duration only.
- **Execution status sync.** Worker write-back is authoritative: the worker
  `PATCH`es `/api/v1/internal/workflow-executions/:id` on terminal events. A plain
  (non-VPC, internet-egress) reconcile Lambda on a 1-min EventBridge schedule is the
  backstop for worker crashes — may be a fast-follow; without it a crashed worker
  leaves a stale `RUNNING` row.
- **Temporal namespace model.** One shared namespace per env (`pegasus-<env>`),
  one shared task queue `pegasus-stdlib-<env>`. Temporal workflow id
  `wf/<tenantId>/<name>/<executionId>` with `REJECT_DUPLICATE` reuse policy →
  `POST /:id/run` is idempotent. Tenant isolation is enforced by the per-workflow
  runtime token (scoped to one tenant), not by Temporal — the `tenantId` in the id
  is for audit/search only.
- **Worker egress.** The Fargate worker needs outbound to Temporal Cloud + ECR +
  CloudWatch + KMS. `TemporalWorkerStack` adds a NAT Gateway + `PRIVATE_WITH_EGRESS`
  subnets to the WireGuard VPC (~$35–40/mo). The existing `private-lambda` ISOLATED
  subnets are untouched. **The API Lambda is already public-egress** (`api-stack.ts`
  — "the public-egress API Lambda"), so it starts Temporal workflows directly — no
  dispatch Lambda needed.
- **Runtime authz role.** New Cedar group `workflow_runtime` with policy
  `policies/30-personas/workflow-runtime.cedar` granting `ReadQuote/ReadMove/`
  `ReadInvoice/ReadCustomer/ReadEvent/CreateEvent` — exactly what `send_quote_followup`
  needs. Add to `role-options.ts` (drift test requires it). Internal endpoints are
  gated by a shared-secret header, not a Cedar role.

---

## Unit 1 — Execution schema + manifest foundation ✅ DONE (#134, `9563eb8`, 2026-05-22)

**Branch:** `phase2/01-execution-schema-manifest` (merged + deleted)

- `apps/api/prisma/schema.prisma` — new `WorkflowExecution` model
  (`id, tenantId, workflowId FK, status, input Json, result Json?, errorMessage?,`
  `temporalWorkflowId?, temporalRunId?, triggeredByUserId, queuedAt, startedAt?,`
  `finishedAt?, createdAt, updatedAt`; indexes on `[tenantId,workflowId]`, `[status]`;
  `@@map("workflow_executions")`, `@@schema("public")`); enum
  `WorkflowExecutionStatus { QUEUED RUNNING COMPLETED FAILED TIMED_OUT CANCELLED }`;
  add to `Workflow`: `forkedFromWorkflowId?`, `forkedFromVersion?`,
  `runtimeTokenCiphertext?`, `runtimeApiClientId?`, `executions WorkflowExecution[]`.
  Add `WorkflowExecution` to `TENANT_SCOPED_MODELS` (always tenant-owned).
- `apps/api/prisma/migrations/<ts>_add_workflow_executions/migration.sql` — generated.
- `apps/api/src/handlers/workflows.ts` — extend `ManifestSchema` with
  `requiredActions: z.array(z.string()).optional().default([])`, validated against
  the `Actions` catalog ids (unknown id → `VALIDATION_ERROR`).
- `packages/workflows-sdk-python/pegasus_workflows/manifest.py` — add
  `required_actions: list[str]` to the `Manifest` dataclass + TOML parsing +
  `to_api_manifest()` (`requiredActions`); `tests/test_manifest.py` coverage.
- `packages/workflows-stdlib/pegasus-workflows.toml` — add
  `required_actions = ["ReadQuote","ReadCustomer","CreateEvent"]`.

**Mergeable alone:** pure additive schema + optional validation; nothing reads the
new columns yet; Phase-1 uploads still pass (field defaulted).
**Verify:** `prisma migrate dev`; `apps/api` unit tests; SDK `pytest`;
`pegasus-workflows package` on `workflows-stdlib` succeeds.

## Unit 2 — Fork endpoint ✅ DONE (#135, `b733257`, 2026-05-22)

**Branch:** `phase2/02-fork-endpoint` (merged + deleted)

- `apps/api/src/repositories/workflow.repository.ts` — `forkGlobalToTenant(sourceId,
targetTenantId, createdByUserId)`: reads a GLOBAL source, S3-copies the artifact to
  a new tenant key, inserts a `TENANT` row with `forkedFrom*` provenance.
- `apps/api/src/lib/documents-s3.ts` — add `copyObject(srcKey, destKey)` if absent.
- `apps/api/src/handlers/workflows.ts` — `POST /:id/fork`, gated
  `requirePermission(Actions.UploadWorkflow)`; 404 if source not visible/not GLOBAL;
  409 on natural-key clash. Tests in `workflows.test.ts`.
- `packages/workflows-sdk-python/pegasus_workflows/api.py` — `fork_workflow(id)` + test.
- `apps/tenant-web/src/api/workflows.ts` + `queries/workflows.ts` — `forkWorkflow`
  mutation; extend `Workflow` type with `forkedFrom*`.
- `apps/tenant-web/src/routes/settings.workflows.tsx` — "Fork to my workflows"
  button on GLOBAL rows.

**Mergeable alone:** self-contained; successor to the Phase-1 download/reupload path.
**Verify:** local API — fork a GLOBAL stdlib workflow → new TENANT row + copied S3
object + provenance columns; tenant-web shows it under "Your workflows".

## Unit 3 — Per-workflow runtime service account ✅ DONE (#136, `ea39600`, 2026-05-22)

**Branch:** `phase2/03-runtime-service-account` (merged + deleted)

- `apps/api/src/handlers/workflows.ts` — in `POST /` (finalize) and `POST /:id/fork`,
  within the same transaction, provision a runtime service account exactly as
  `api-clients.ts` does (a `TenantUser` `cognitoSub=null, isServiceAccount=true,`
  `status=ACTIVE, roleNames=['workflow_runtime']` + an `ApiClient` `wf-runtime-<id>`),
  KMS-encrypt the `plainKey`, persist `runtimeTokenCiphertext` + `runtimeApiClientId`;
  discard the plaintext.
- `apps/api/src/repositories/workflow.repository.ts` — `attachRuntimeToken(...)`.
- `apps/api/src/lib/runtime-token-crypto.ts` — new; KMS encrypt/decrypt
  (`@aws-sdk/client-kms`), key id from `WORKFLOW_TOKEN_KMS_KEY_ID`.
- `apps/api/src/authz/policies/30-personas/workflow-runtime.cedar` — new policy.
- `apps/api/src/authz/role-options.ts` — add `workflow_runtime` (drift test).
- `packages/infra/lib/stacks/api-stack.ts` — KMS key for workflow tokens; env
  `WORKFLOW_TOKEN_KMS_KEY_ID`; grant API Lambda `kms:Encrypt`/`kms:Decrypt`.
- Tests in `workflows.test.ts`.

**Mergeable alone:** finalize/fork return the same shape; the account + ciphertext
are unused side effects. Pre-existing workflows lazily mint on first run (Unit 6).
**Verify:** finalize locally (real or LocalStack KMS) → `TenantUser` + `ApiClient`
rows + non-null ciphertext; `decryptRuntimeToken` round-trips; plaintext in no log.

## Unit 4 — Temporal Cloud + Fargate worker infra ✅ DONE (#186, `7d5955b`, 2026-06-06)

**Branch:** `phase2/04-temporal-worker-infra` (merged + deleted)

**What landed:**

- `packages/infra/lib/stacks/temporal-worker-stack.ts` — new stack: ECR repo `pegasus-temporal-worker` (RETAIN, image scan on push, last-20 lifecycle), ECS Fargate cluster (containerInsights), task def (512 CPU / 1024 MiB, `desiredCount: 0`, placeholder `ecr:latest` image), task role with `secretsmanager:GetSecretValue` on the two Phase-2 secrets, `awslogs` log group (1-month retention, RETAIN), security group `pegasus-temporal-worker` (egress-only), env vars `TEMPORAL_NAMESPACE`/`TEMPORAL_ADDRESS`/`TEMPORAL_TASK_QUEUE`/`PEGASUS_API_BASE_URL`/`ENV_NAME`, secret env vars `TEMPORAL_CLOUD_API_KEY` (JSON path `apiKey`) + `WORKFLOW_BROKER_SECRET` (raw).
- `packages/infra/lib/stacks/wireguard-stack.ts` — third `subnetConfiguration` entry `temporal-worker-egress` (PRIVATE_WITH_EGRESS, /24) + `natGateways: 1` so the Fargate fleet has outbound. Existing `hub-public` and `private-lambda` CIDR slots are preserved (additive expansion). Hub still routes via its own IGW — NAT is consumed only by the new subnets. Public prop `temporalWorkerSubnets: ec2.ISubnet[]`.
- `packages/infra/lib/stacks/__tests__/temporal-worker-stack.test.ts` — vitest assertion test (ECR repo, ECS cluster, Fargate service @ DesiredCount 0, NAT, SG, log group, env + secret wiring).
- Updated `packages/infra/lib/stacks/__tests__/wireguard-stack.test.ts` — subnet count 4→6 and NAT count 0→1, with a comment explaining the Phase-2 expansion; the "hub does NOT route through NAT" intent is preserved via a route-table assertion.
- `packages/infra/bin/app.ts` — instantiate for staging/prod only; depends on WireGuardStack + ApiStack. `PEGASUS_API_BASE_URL` resolved from SSM `/dolas/pegasus/api/domain-name` (same source FrontendAssetsStack uses for the SPA config.json), prefixed with `https://`.
- `.github/workflows/_deploy.yml` — `${STACK_PREFIX}-TemporalWorkerStack` added to the API-side stack list in the `Resolve CDK stack target` step.
- `.github/workflows/deploy.yml` — path filter `infra:` now includes `apps/temporal-worker/**` (forward-looking for Unit 5).

**Verified:** typecheck + lint + tests + `cdk synth` for staging and prod all green in CI; PR #186 5/5 required checks ✅. Live deploy auto-triggered on merge (`--all` forced by infra path change).

**Cost delta:** ~$35–40/mo per env for the new NAT Gateway. Fargate at desiredCount: 0 is free; empty ECR is free until Unit 5 images land.

---

## Unit 5 — The Temporal worker process ✅ DONE (#188 + #189/#192/#193 hotfixes, 2026-06-06)

**Branch:** `phase2/05-temporal-worker-process` (merged + deleted)

**What landed in #188 (`a21afb5`):**

- `apps/temporal-worker/` — new Python 3.12 app: multi-stage Dockerfile (build context = repo root so it can `COPY` from `packages/workflows-{sdk-python,stdlib}`); `pegasus_temporal_worker/` package containing `worker.py` (Temporal Cloud connect via `Client.connect(..., api_key=...)`, SIGTERM-graceful, JSON stdout logging), `registry.py` (curated-only `name → SendQuoteFollowup`, unknown name raises), `runtime_client.py` (POSTs to `…/api/v1/internal/workflow-runtime-token`, 404 → `BrokerEndpointMissing`, plaintext never logged/disked), `status_sync.py` (PATCH terminal status, 404-tolerated, exponential backoff for 5xx), `config.py` (env validation, fails-fast).
- `apps/temporal-worker/tests/` — 30/30 pytest pass incl. full E2E via `WorkflowEnvironment.start_local`.
- `packages/infra/lib/stacks/temporal-worker-stack.ts` — `desiredCount: 0 → 1`.
- `docker-compose.temporal.yml` — new `temporal-worker` service for local dev (opt-in via `up temporal-worker`).
- `.github/workflows/temporal-worker.yml` — new dedicated workflow on push to `main` matching `apps/temporal-worker/**` / `packages/workflows-{sdk-python,stdlib}/**`. Per-env jobs (staging → prod) build the image once and push `:latest` + `:$GITHUB_SHA` to each env's ECR repo, then `aws ecs update-service --force-new-deployment` to roll the Fargate task to the new image.

**Operator out-of-band step (one-time):** inline policy `temporal-worker-image-deploy` attached to `pegasus-github-actions-deploy-{staging,prod}` granting ECR push + `ecs:UpdateService/DescribeServices` on the worker resources. No `Role.fromRoleName` precedent in the codebase, so this stayed manual.

**Hotfixes that landed during first staging boot (all merged 2026-06-06):**

| PR | Sha | Bug | Fix |
| --- | --- | --- | --- |
| #189 | `027feff` | SDK wheel build failed with "duplicate file" because `pyproject.toml` had both `packages = [...]` AND a `force-include` block adding `templates/` a second time. Phase 1's `pip install -e` masked it. | Drop the redundant `force-include` block. |
| #192 | `f7538c8` | ECS task launches failed with `AccessDenied` then `ResourceNotFoundException`. Root cause: `Secret.fromSecretNameV2` produces a **no-suffix ARN** that is NOT a valid Secrets Manager `SecretId` at the API layer (verified live), so both the IAM grant Resource AND the `secrets[].valueFrom` were unmatchable. | Switch to `Secret.fromSecretCompleteArn` with full ARNs. Per-env full ARNs in new `TEMPORAL_SECRET_ARNS` map in `bin/app.ts`. |
| #193 | `28e30f6` | Worker reached `worker.connected` then crashed at namespace validation with `Worker validation failed: Namespace pegasus-staging was not found ... PermissionDenied`. Root cause: Temporal Cloud namespace IDs are `<short>.<account-id>`, not the short name alone. | Derive full namespace ID from the gRPC address (strip `.tmprl.cloud:7233`). |

PRs #190 (`9300c8c` — trailing-`*` ARN, didn't actually fix the issue) and #191 (`c141020` — bare `Resource:*`, fixed IAM but revealed the SM ResourceNotFound issue) were superseded by #192's `fromSecretCompleteArn` approach.

**Verified live (2026-06-06):** Fargate task def rev 3 on `pegasus-temporal-worker-staging` is running cleanly. Worker logs in `/pegasus/staging/temporal-worker`:

```
worker.starting   namespace=pegasus-staging.chgel  task_queue=pegasus-stdlib-staging  uses_temporal_cloud=true
worker.connected
worker.polling
```

Pre-Unit-6 expectation: starting any workflow would activity-fail with `BrokerEndpointMissing` (broker endpoint returns 404). Worker logs `WARN status_sync.endpoint_missing` on PATCH attempts. Both will clear once Unit 6 lands the internal endpoints.

---

## Unit 6 — Execution API ✅ DONE (#195 → `b55299e`, 2026-06-07)

**Branch:** `phase2/06-execution-api` (merged + deleted)

**Landed:**

- `apps/api/src/repositories/workflow-execution.repository.ts` — `create / findById / listByWorkflow / markStarted / markTerminal` with keyset pagination by `(queuedAt, id)`.
- `apps/api/src/lib/temporal-client.ts` — cached `Connection.connect({ tls: true, apiKey, metadata })` for Temporal Cloud; bare localhost connect for dev. `_setTemporalClientForTesting` injection hook.
- `apps/api/src/lib/curated-workflows.ts` — `CURATED_WORKFLOW_NAMES = { 'send_quote_followup' }` with a cross-reference comment to the worker's Python registry (the contract's other half).
- `apps/api/src/handlers/workflows.ts` — `POST /:id/run` (lazy-mints runtime account if missing, inserts QUEUED, calls Temporal Cloud with workflow id `wf/<tenantId>/<name>/<executionId>` + `REJECT_DUPLICATE`, eagerly marks RUNNING on success or FAILED on Temporal error). `GET /:id/executions[?limit=&before=]` + `GET /:id/executions/:executionId` — both tenant-scoped.
- `apps/api/src/handlers/workflow-internal.ts` — mounted on `m2mV1` at `/internal`. `POST /workflow-runtime-token` (KMS-decrypts ciphertext + returns plaintext with `Cache-Control: no-store`; 404 if execution missing/terminal or ciphertext null). `PATCH /workflow-executions/:id` (state-machine validation; idempotent terminal-self; tenant-scope derived from execution row). Gated by `X-Workflow-Broker-Secret` constant-time compare with `process.env.WORKFLOW_BROKER_SECRET`.
- `apps/api/src/authz/actions.ts` + `cedar.schema.json` + `policies/30-personas/workflow-developer.cedar` — new `RunWorkflow` action. tenant_admin already grants implicitly. role-options.ts unchanged (no new persona).
- `packages/infra/lib/stacks/api-stack.ts` + `bin/app.ts` — env wiring: `TEMPORAL_ADDRESS / TEMPORAL_NAMESPACE / TEMPORAL_TASK_QUEUE` + `TEMPORAL_CLOUD_API_KEY` (injected as plaintext env var from the `pegasus/{env}/temporal-cloud` secret's `apiKey` JSON field — same DATABASE_URL pattern) + `WORKFLOW_BROKER_SECRET` (plaintext env from `pegasus/{env}/workflow-broker-secret`). Uses `Secret.fromSecretCompleteArn` with the full ARN map already in `bin/app.ts` (per `[[feedback_cdk_secret_complete_arn_for_ecs]]`). Dev is skipped (no Phase 2 there).
- `packages/workflows-sdk-python/pegasus_workflows/api.py` — `run_workflow / list_executions / get_execution` methods + 5 mocked-transport tests.
- `packages/workflows-sdk-python/pegasus_workflows/cli/run.py` — `pegasus-workflows run <name|name@version> [--input '<json>']` CLI command for parity with `package` / `push` / `test`.

**Deliberate decisions / contract notes:**

- **Workflow args shape:** the API calls `client.workflow.start(workflow.name, { args: [{ executionId, input }] })` per the plan's "runtime token delivery" decision. The stdlib's `send_quote_followup` workflow accepts both this dict shape (server-side) AND the legacy positional `quote_id` string (`pegasus-workflows test` local-dev parity) — landed in **PR #196 (`50d2659`)** as a small fast-follow. Future curated workflows mirror the dict-or-string shape (documented in the module docstring).
- **`@temporalio/client@1.16.2` pin** (not latest 1.17.x) — `@temporalio/proto@1.17.x` exact-pins `protobufjs@7.5.5` which carries 4 high CVEs (`GHSA-66ff-xgx4-vchm` etc.); npm `overrides` doesn't propagate through exact-version sub-deps, so we couldn't bump protobufjs cleanly while staying on `@temporalio/client@1.17`. `1.16.2` uses `^7.2.5` (a range) so the tree-wide override picks up `7.6.2`. The 1.16↔1.17 client API we use (`Connection.connect`, `client.workflow.start`, `REJECT_DUPLICATE`) is identical. Revert when `@temporalio/proto@1.18+` relaxes the pin. Override registered in root `package.json` `overrides.protobufjs` + dependency-justifications block.
- **Broker-secret env var:** injected as plaintext via the CloudFormation Secrets Manager dynamic reference (same `secretValue.unsafeUnwrap()` pattern DATABASE_URL uses), NOT fetched via AWS SDK at runtime. Lambda has no `ecs.Secret` equivalent; threading the full ARN to `grantRead` keeps IAM precise.
- **Temporal Cloud API key:** also injected as plaintext via `secretValueFromJson('apiKey').unsafeUnwrap()`. Same rationale.
- **Reconcile poller deferred** — see below.

**Post-merge hotfix chain:**

| PR | Sha | Bug surfaced | Fix |
| --- | --- | --- | --- |
| #196 | `50d2659` | Stdlib `send_quote_followup.run(self, quote_id)` couldn't unpack the new `{ executionId, input }` payload — live smoke would template the whole dict into the follow-up. | Accept dict-or-string in `run()`; document the contract for future curated workflows. |
| #198 | `57e344b` | Prod deploy `UPDATE_ROLLBACK_FAILED` — `SyncAvpPoliciesTrigger` re-syncing the new `RunWorkflow` Cedar action across 15 prod tenants × 15 .cedar files × 4-wide tenant concurrency = ~60 concurrent CreatePolicy calls hit `ThrottlingException`. Staging passed (fewer tenants). | `withThrottleRetry` helper (250ms..8s exponential backoff + ±25% jitter, 7 attempts) wrapped around PutSchema / DeletePolicy / CreatePolicy AND serialize-per-tenant CreatePolicy. Recovery procedure: `aws cloudformation continue-update-rollback --resources-to-skip SyncAvpPoliciesTrigger --profile dolas-pegasus-prod`. See `[[feedback_avp_bulk_sync_throttle_retry]]`. |

---

## Unit 6.5 — Reconcile poller (fast-follow, deferred from Unit 6) ⬜ READY TO START

**Why this was deferred from Unit 6:** Unit 6 was already 9 commits touching 3 packages + tests; adding a new Lambda + EventBridge construct widens the blast radius without unblocking anything. The current worker write-back is correct on the happy path; the reconcile poller is the crash-recovery story.

**Branch:** `phase2/06.5-reconcile-poller` (base: `main` — Units 1-6 already in `main`)

**Design (~30 min implementation):**

- Plain `NodejsFunction` in `ApiStack` (no VPC; public-egress is fine for Temporal Cloud).
- `events.Rule` on `Schedule.rate(Duration.minutes(1))`.
- Handler reads `WorkflowExecution` rows where `status = 'RUNNING' AND startedAt < now() - 5m`, calls Temporal `WorkflowClient.describe(temporalWorkflowId)` for each, and PATCHes via the same `markTerminal` repo path the worker uses (NOT via the broker endpoint — same DB, direct repo call).
- Idempotent: writes via existing `workflowExecutionRepository.markTerminal` (already covers the "already-terminal no-op" case from #195).
- Bounded scope per invocation: limit to 100 stale rows per tick so a backlog can't blow the Lambda timeout. If 100 rows come back, log a metric and let the next tick pick up the rest.

**Resume-specific guidance (for the Unit 6.5 worker agent):**

- `temporal-client.ts` from #195 is the precedent — already has `Connection.connect({ apiKey })` shape and caches the client. Re-import it; don't reinvent.
- Tenant-scoping: the reconcile Lambda runs ACROSS tenants (the worker writes status for any tenant). Pull `WorkflowExecution` rows with `db.workflowExecution.findMany({ where: { status: 'RUNNING', startedAt: { lt: ... } } })` — bypass the tenant scope middleware via the same root `db` instance used by `lambda-sync-avp-policies.ts` (look at that handler for the existing precedent of a tenant-agnostic Lambda).
- The Lambda's IAM needs `temporal-cloud` secret read (full ARN — see `[[feedback_cdk_secret_complete_arn_for_ecs]]`) AND the existing Prisma DB env. Both already live in `ApiStack` for the main API Lambda; share the constructs.
- Terminal-state mapping: Temporal `WorkflowExecutionStatus` → our enum: `COMPLETED → COMPLETED`, `FAILED → FAILED`, `CANCELED → CANCELLED`, `TERMINATED → CANCELLED`, `TIMED_OUT → TIMED_OUT`. Leave `RUNNING` alone (worker is still in flight). `CONTINUED_AS_NEW` is not reachable for curated stdlib workflows; treat as RUNNING and log.
- For result/error: call Temporal `client.workflow.getHandle(temporalWorkflowId).result()` to grab the return value on `COMPLETED`, or `.describe()` then `historyEvents()` for the failure message on `FAILED`. The 5-min "still running" guard avoids racing against a healthy worker that just hasn't finished yet.
- Add a CloudWatch metric: `WorkflowExecutionReconciled{Status=...}` so we can see on a dashboard how often this kicks in vs the worker write-back.

**Mergeable alone:** purely additive — when 0 stale rows exist, the handler does nothing. Doesn't touch any happy-path code.

**Verify (staging):** crash the staging Fargate task mid-execution (e.g. force-deploy a broken image, then revert) — the orphaned `RUNNING` row should flip to `COMPLETED`/`FAILED` within 1-2 minutes. CloudWatch metric increments.

## Unit 7 — tenant-web execution UI ⬜ READY TO START

**Branch:** `phase2/07-execution-ui` (base: `main` — Units 1-6 already in `main`)

**Resume-specific guidance (for the Unit 7 worker agent):**

- This is independent of Unit 6.5 — they touch disjoint codebases (`apps/tenant-web/**` vs `packages/infra/**` + `apps/api/**`). Either order, parallel-friendly.
- The Unit-2 fork button is the closest precedent for adding new actions to `settings.workflows.tsx`; read it for the dialog + toast + react-query invalidation pattern.
- API endpoints to call (all live on staging + prod): `POST /api/v1/workflows/:id/run`, `GET /api/v1/workflows/:id/executions[?limit=&before=]`, `GET /api/v1/workflows/:id/executions/:executionId`. Auth = the existing tenant session token; no special header.
- `WorkflowExecution` type shape: see `apps/api/src/repositories/workflow-execution.repository.ts` for the row, `apps/api/src/handlers/workflows.ts` for the response wire shape (camelCase JSON). Mirror in `apps/tenant-web/src/api/workflows.ts`.
- Polling: when the executions list contains any `QUEUED` or `RUNNING` rows, refetch on a `refetchInterval: 3000` (3s) until they all settle. When all terminal, drop back to the default refetch behavior. TanStack Query's `refetchInterval: (query) => …` callback shape supports this.
- Permission gate: the per-row "Run" button only renders when the user has the `RunWorkflow` Cedar action — check via the existing `usePermissions()` hook (per `apps/tenant-web/src/auth/...`).

**Files to add/modify:**

- `apps/tenant-web/src/api/workflows.ts` — `WorkflowExecution` type, `runWorkflow / listExecutions / getExecution` HTTP wrappers.
- `apps/tenant-web/src/api/queries/workflows.ts` — `executionsQueryOptions(workflowId)` (polls while any QUEUED/RUNNING); `useRunWorkflow()` mutation hook with onSuccess → invalidate executions.
- `apps/tenant-web/src/routes/settings.workflows.tsx` — per-row "Run" button + input-JSON dialog; per-workflow executions list with status badges (QUEUED grey, RUNNING blue, COMPLETED green, FAILED red, TIMED_OUT/CANCELLED amber), timestamps, result/error rendering.
- Optionally `apps/tenant-web/src/routes/settings.workflows.$id.tsx` — dedicated execution-history route (deeper detail, paginated list). Phase-2 nice-to-have; not blocking.

**Mergeable alone:** additive frontend, gated behind the `RunWorkflow` Cedar action (Cedar action already deployed via #195, so any tenant_admin or workflow_developer can see the button).

**Verify (staging):** trigger `send_quote_followup` from the UI on a staging tenant, watch the executions list poll from QUEUED → RUNNING → COMPLETED, view the composed follow-up message in the result panel.

---

## Known gaps / Phase-3 handoffs

- `requiredActions` collected + displayed but not used for dynamic token scoping.
- No sandbox — only curated stdlib runs; arbitrary tenant code is Phase 3.
- Reconcile poller may be a fast-follow; without it a crashed worker leaves a stale
  `RUNNING` row.
- Event-driven triggers — separate future phase (platform event bus).

## Execution model

Units 1–6 were strictly sequential — each depended on the prior unit's merge
(schema → fork → runtime account → infra → worker → API). **6.5 and 7 are
parallelizable** — they touch disjoint codebases and don't depend on each
other:

- **Unit 6.5** is `packages/infra/lib/stacks/api-stack.ts` + a new
  `apps/api/src/lambda-reconcile-workflow-executions.ts` handler.
- **Unit 7** is `apps/tenant-web/src/{api,routes}/...`.

Either order, or in parallel. Once both land, Phase 2 is feature-complete and
the plan archives to `plans/completed/`. Phase-3 handoffs (sandboxed tenant
code, event-driven triggers, dynamic token scoping) are listed below.

## Critical files

- `apps/api/prisma/schema.prisma`, `apps/api/src/handlers/workflows.ts`
- `apps/api/src/repositories/{workflow,api-client}.repository.ts`
- `apps/api/src/authz/{actions.ts,role-options.ts,policies/30-personas/}`
- `packages/infra/bin/app.ts`, `packages/infra/lib/stacks/{api,wireguard}-stack.ts`
- `packages/workflows-sdk-python/pegasus_workflows/{api,manifest}.py`
- `packages/workflows-stdlib/`, `apps/tenant-web/src/routes/settings.workflows.tsx`

---

## Resume notes — lessons from the Units 1-3 run

Hard-won gotchas the next session will hit if it doesn't read these:

### Toolchain

- **Use node 24, not the default node 25.** PATH-pin
  `/home/steve/.nvm/versions/node/v24.16.0/bin` for any `npm install` / `turbo` /
  `npm test` / `npm run typecheck` / git push (husky hook). Default node 25
  corrupts `node_modules` and lockfile resolution silently diverges from CI.
  See `[[project_node_version_gate]]`.
- Repo pins `packageManager: npm@10.8.2`. Any lockfile regen MUST happen on
  node-20/npm-10.8.2 (your machine, not the agent sandbox). The agent sandbox
  has node 25 and cannot safely regenerate the lockfile.

### Stacked-PR merge mechanics (if you stack Units 4-7)

- Units 1-3 were stacked (`phase2/02` base = `phase2/01`, etc.) and squash-merged.
  **The squash-merge of an earlier unit creates conflicts when updating the next
  unit from `main`** — the squashed commit and the next unit's same-content
  original commits overlap. Resolve by taking `--ours` (the next unit's branch
  is the superset), verify with `grep` for each unit's signature features
  before committing.
- **`gh pr edit --base` is broken** (Projects-classic GraphQL deprecation
  silently aborts the base change). Use `gh api -X PATCH repos/.../pulls/N -f base=main`
  instead. See `[[project_audit_ci_jscookie_allowlist]]`.
- **Retarget a stacked PR's base to `main` BEFORE deleting its current base
  branch.** Deleting a PR's base branch auto-CLOSES the PR. (Hit this on #135.)
- `gh pr merge --delete-branch` fails (and skips remote delete) when the local
  branch is held by an agent worktree. Either remove the worktree first, or
  merge without `--delete-branch` then delete the remote branch manually.

### Required CI checks

- Required gates on `main`: `Test`, `E2E Tests`, `Lint`, `Typecheck`,
  `Secret Scanning (Betterleaks)`. All must be green to merge — admin override
  is off-limits per CLAUDE.md.
- `Test` runs `audit-ci` first. If a new high advisory drops mid-PR, all CI goes
  red repo-wide. The `js-cookie@2.2.1` advisory was hit during Units 1-3 (now
  cleared by deleting orphan `amazon-cognito-identity-js`, `232ef88`). See
  `[[project_audit_ci_jscookie_allowlist]]` for the override-vs-allowlist
  decision tree if it recurs.

### Worker agent prompt — what worked

The Unit 1-3 agents each succeeded with these elements in the prompt:

- Full task copied verbatim from the plan + explicit branch name + base branch.
- Codebase conventions section (existing patterns to mirror — repo file paths,
  Cedar policy structure, `Secret.fromSecretNameV2` usage, etc.).
- Verification recipe (the agent can't reach a live DB / KMS in worktree, so
  the achievable checks are: `prisma validate`, `prisma generate`,
  `npm test -w apps/api` with mocked repo, `npm run typecheck`, SDK `pytest`).
- Note that worker may need to symlink the repo-root `node_modules` into its
  worktree to run tests (then remove the symlink before committing).
- Note that full local-API integration verification needs Docker — agent
  should record those steps as human follow-up in the PR body, not skip
  silently.

### Where to put new per-env configuration

- `packages/infra/bin/app.ts` is the central per-env config switchboard.
  Existing precedents: `SES_SENDER_DOMAIN` map, `TEMPORAL_ADDRESS` map
  (added in #178). Add new per-env values there as
  `Record<Exclude<EnvName,'dev'>, T>` and `export const`.
- Secrets follow the AWS-Secrets-Manager-is-source-of-truth pattern. CDK
  references via `secretsmanager.Secret.fromSecretNameV2`; provisioning is
  out-of-band (manual or one-off CLI). **Never** push secret VALUES through
  GitHub Actions secrets → CI → AWS. CI gets `Get*` only, not `Put*`.

### Anti-scope reminders

- The original plan invocation was `/batch` (parallel) — but Phase 2 is
  EXPLICITLY sequential. If a future session is `/batch`-invoked, surface the
  contradiction before spawning parallel agents — they will conflict on
  `workflows.ts`, `schema.prisma`, `role-options.ts`, etc.
- Units 4-7 require **operator prereqs** (now satisfied; see Resume Status
  block at top). Do NOT re-do them. If a fresh session can't confirm the
  prereqs exist, run `aws secretsmanager describe-secret --secret-id
pegasus/{env}/temporal-cloud --profile dolas-pegasus-{env} --region us-east-1`
  to verify before planning Unit 4.
