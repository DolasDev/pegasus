# Pegasus Workflows — Phase 2: Server-Side Execution Runtime

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

1. Temporal Cloud account + namespaces `pegasus-staging`, `pegasus-prod`; register
   custom search attributes `TenantId`, `PegasusWorkflowId`; set retention (~30d).
2. Temporal Cloud namespace credentials (mTLS cert+key or API key) in Secrets
   Manager at `pegasus/{env}/temporal-cloud` (existing `Secret.fromSecretNameV2`
   convention).
3. KMS key for runtime-token encryption (created in `ApiStack`, ARN exported).
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

## Unit 1 — Execution schema + manifest foundation

**Branch:** `phase2/01-execution-schema-manifest`

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

## Unit 2 — Fork endpoint

**Branch:** `phase2/02-fork-endpoint`

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

## Unit 3 — Per-workflow runtime service account

**Branch:** `phase2/03-runtime-service-account`

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

## Unit 4 — Temporal Cloud + Fargate worker infra

**Branch:** `phase2/04-temporal-worker-infra`

- `packages/infra/lib/stacks/temporal-worker-stack.ts` — new stack: NAT Gateway +
  `PRIVATE_WITH_EGRESS` subnets added to `WireGuardStack.vpc`; ECR repo
  `pegasus-temporal-worker`; ECS cluster + Fargate service (image from Unit 5, start
  at `desiredCount: 0`); task role with `secretsmanager:GetSecretValue` on
  `pegasus/{env}/temporal-cloud` + CloudWatch logs; env `TEMPORAL_NAMESPACE`,
  `TEMPORAL_ADDRESS`, `TEMPORAL_TASK_QUEUE=pegasus-stdlib-<env>`,
  `PEGASUS_API_BASE_URL`, `WORKFLOW_BROKER_SECRET` ref.
- `packages/infra/bin/app.ts` — instantiate for staging/prod (dev uses local
  Temporal); `addDependency` on `WireGuardStack` + `ApiStack`.
- `packages/infra/lib/stacks/__tests__/temporal-worker-stack.test.ts` — `Template`
  snapshot/assertion test.
- `.github/workflows/deploy.yml` / `_deploy.yml` — path filter for
  `packages/infra/**` + `apps/temporal-worker/**`; include the new stack in the CDK
  target; worker-image build+push to ECR (image build may land with Unit 5).

**Mergeable alone:** synthesizes/deploys with `desiredCount: 0`; nothing references
it. Staging only.
**Verify:** `cdk synth` + snapshot test in CI; deploy to staging; confirm NAT
Gateway, ECR repo, ECS cluster exist and a hello-world task reaches `temporal.io`.

## Unit 5 — The Temporal worker process

**Branch:** `phase2/05-temporal-worker-process`

- `apps/temporal-worker/` — new Python app: `Dockerfile` (installs `temporalio`,
  the SDK, **bundles `packages/workflows-stdlib/`**); `worker.py` (connects to
  Temporal Cloud via the secret, registers curated stdlib workflows + activities,
  polls `pegasus-stdlib-<env>`); `runtime_client.py` (on activity start fetches the
  per-workflow token from the internal broker by `executionId`, builds
  `PegasusClient`); `status_sync.py` (PATCH terminal status); `registry.py` (maps
  `Workflow.name` → stdlib class; rejects any non-curated name — the curated-only
  boundary); `tests/` using `temporalio.testing` + mocked broker/API.
- `docker-compose.temporal.yml` (repo root) — extend so the worker runs locally
  against local Temporal.
- `packages/workflows-stdlib/` — add an explicit activity export surface if needed
  so the worker can register `compose_followup`.

**Mergeable alone:** standalone process; runnable + unit-tested against local
Temporal without prod. CI builds the image to the Unit-4 ECR repo; bump Fargate
`desiredCount` to 1 here.
**Verify (local):** `docker-compose.temporal.yml` up; start `send_quote_followup`
with a mocked broker token → activity composes the message, status PATCH attempted.
**Verify (staging):** deploy image, scale Fargate to 1 → connects to Temporal Cloud,
registers on `pegasus-stdlib-staging`.

## Unit 6 — Execution API

**Branch:** `phase2/06-execution-api`

- `apps/api/src/repositories/workflow-execution.repository.ts` — new repo.
- `apps/api/src/lib/temporal-client.ts` — Temporal Cloud client for the (public-
  egress) API Lambda; creds from `pegasus/{env}/temporal-cloud`.
- `apps/api/src/handlers/workflows.ts` — `POST /:id/run` (new `Actions.RunWorkflow`;
  validate the workflow is a curated/executable one, lazily mint the runtime account
  if missing, insert `QUEUED WorkflowExecution`, `start_workflow` on Temporal Cloud
  with id `wf/<tenantId>/<name>/<executionId>`, return the row); `GET /:id/executions`;
  `GET /:id/executions/:executionId`.
- `apps/api/src/handlers/workflow-internal.ts` — new, mounted on `m2mV1` under
  `/internal`, shared-secret-header gated: `POST /workflow-runtime-token` (broker,
  KMS-decrypt) and `PATCH /workflow-executions/:id` (worker write-back).
- `apps/api/src/app.ts` — mount the internal handler on `m2mV1`.
- `apps/api/src/authz/actions.ts` + `cedar.schema.json` — add `RunWorkflow`;
  grant it in `workflow-developer.cedar` (and `tenant_admin`).
- `packages/infra/lib/stacks/api-stack.ts` — env: Temporal creds secret,
  `WORKFLOW_BROKER_SECRET`; the reconcile-poller Lambda (plain, internet-egress,
  1-min EventBridge) — or note as fast-follow.
- `packages/workflows-sdk-python/pegasus_workflows/api.py` — `run_workflow`,
  `list_executions`, `get_execution`.
- Tests in `workflows.test.ts`.

**Mergeable alone:** depends on Units 3–5; if the worker fleet is at `desiredCount:0`
executions sit `QUEUED` harmlessly. Internal endpoints inert without the worker.
**Verify (staging — full Temporal Cloud path):** with the staging worker running,
`POST /workflows/:id/run` on `send_quote_followup` → `QUEUED→RUNNING→COMPLETED`
execution row; worker fetched the scoped runtime token from the broker and the
activity called the Pegasus API; `GET /:id/executions` reflects status.

## Unit 7 — tenant-web execution UI

**Branch:** `phase2/07-execution-ui`

- `apps/tenant-web/src/api/workflows.ts` — `WorkflowExecution` type, `runWorkflow`,
  `listExecutions`, `getExecution`.
- `apps/tenant-web/src/api/queries/workflows.ts` — `executionsQueryOptions` (polls
  `refetchInterval` while any execution is `QUEUED`/`RUNNING`); `useRunWorkflow`.
- `apps/tenant-web/src/routes/settings.workflows.tsx` — per-row "Run" button +
  input dialog; per-workflow executions list with status badges, timestamps,
  result/error. Optionally a `settings.workflows.$id.tsx` execution-history route.

**Mergeable alone:** additive frontend, gated behind the `workflow:run` permission.
**Verify (staging):** run a stdlib workflow from the UI, watch it poll to
`COMPLETED`, view the result.

---

## Known gaps / Phase-3 handoffs

- `requiredActions` collected + displayed but not used for dynamic token scoping.
- No sandbox — only curated stdlib runs; arbitrary tenant code is Phase 3.
- Reconcile poller may be a fast-follow; without it a crashed worker leaves a stale
  `RUNNING` row.
- Event-driven triggers — separate future phase (platform event bus).

## Execution model

Sequential — one unit at a time, in the order above (1→7), each in its own git
worktree + branch → its own PR. Units 1–3 (API/SDK only) can land before any
Temporal Cloud provisioning; Units 4–7 require the operator prerequisites. No
parallelism — each unit depends on prior units' merges.

## Critical files

- `apps/api/prisma/schema.prisma`, `apps/api/src/handlers/workflows.ts`
- `apps/api/src/repositories/{workflow,api-client}.repository.ts`
- `apps/api/src/authz/{actions.ts,role-options.ts,policies/30-personas/}`
- `packages/infra/bin/app.ts`, `packages/infra/lib/stacks/{api,wireguard}-stack.ts`
- `packages/workflows-sdk-python/pegasus_workflows/{api,manifest}.py`
- `packages/workflows-stdlib/`, `apps/tenant-web/src/routes/settings.workflows.tsx`
