# pegasus-temporal-worker

The Pegasus Temporal worker — a small Python process that executes the
curated workflows from `packages/workflows-stdlib/` against Temporal Cloud
(staging / prod) or a local Temporal dev server (dev).

Lands as part of **Phase 2 Unit 5** of the Workflows execution-runtime
plan. The full plan and unit-by-unit context lives at
`plans/in-progress/workflows-phase2-execution-runtime.md`.

---

## What it does

1. Loads config from env vars (see [Environment variables](#environment-variables)).
2. Connects to Temporal — Cloud (API-key auth, TLS auto) or local
   dev-server (no auth, no TLS). The branch is driven entirely by whether
   `TEMPORAL_CLOUD_API_KEY` is set.
3. Registers the workflow + activity classes listed in
   `pegasus_temporal_worker.registry` — **only those**. This is the
   curated-only boundary described in the Phase 2 plan; any non-listed
   workflow id never reaches the worker.
4. Polls the configured task queue for new tasks.
5. On each activity invocation that needs Pegasus API access, fetches the
   per-execution runtime token from the API broker at
   `POST /api/v1/internal/workflow-runtime-token` and builds a scoped
   `PegasusClient`. Token lives in memory only, for the activity's
   duration.
6. On workflow completion / failure / timeout / cancel, PATCHes terminal
   status back to `PATCH /api/v1/internal/workflow-executions/{id}`.
7. Handles `SIGTERM` gracefully — ECS sends it on scale-in or
   `--force-new-deployment`; the worker drains in-flight activities up to
   `graceful_shutdown_timeout` (5s) before exiting.

---

## Pre-Unit-6 behavior

**Unit 6 has not landed yet.** The two API endpoints the worker calls
(`workflow-runtime-token` and the execution-status `PATCH`) do not exist
on `main` and will return **404** until Unit 6 ships. The worker is
deliberately designed to expect this:

- `runtime_client.py` raises `BrokerEndpointMissing` on 404 from the
  broker. Activities that depend on a Pegasus token will fail; Temporal's
  retry policy holds the workflow as `RUNNING` until the broker is
  available (then the next retry succeeds).
- `status_sync.py` logs a single `status_sync.endpoint_missing` WARN on
  404 from the status `PATCH` and returns silently. The reconcile poller
  (a Phase-2 fast-follow) is the backstop for stale `RUNNING` rows in the
  meantime.

A future reader who sees those WARN lines in CloudWatch should **not**
treat them as a bug — they're the documented pre-Unit-6 state.

---

## Local-dev workflow

The repo-root `docker-compose.temporal.yml` is the one-stop local setup:

```sh
# Worker + Temporal dev server together (Phase 2 Unit 5 onwards):
docker compose -f docker-compose.temporal.yml up

# Or, SDK-only (Phase 1 behavior, no worker — for `pegasus-workflows test`):
docker compose -f docker-compose.temporal.yml up temporal
```

The worker container will start once the Temporal dev server reports
healthy. It connects to `temporal:7233`, uses the `default` namespace
(local dev only ships one), and polls `pegasus-stdlib-dev`. With
`apps/api` running locally (`npm run dev`), it reaches the API at
`http://host.docker.internal:3000` — every broker call will currently
404 until Unit 6, but the worker keeps running.

---

## Running tests

The worker uses `uv` for env management (same as the Phase-1 SDK package).
From `apps/temporal-worker/`:

```sh
uv venv .venv && source .venv/bin/activate
uv pip install -e . -e ../../packages/workflows-sdk-python pytest pytest-asyncio
pytest -q
```

`tests/conftest.py` adds `packages/workflows-sdk-python/` and
`packages/workflows-stdlib/` to `sys.path` so an editable install of the
worker alone is enough to run the suite.

The `test_worker_e2e.py::test_send_quote_followup_via_workflow_environment`
case spins up `temporalio.testing.WorkflowEnvironment.start_local()`,
which downloads a small Temporal test-server binary the first time. The
test is skipped automatically if the download fails (e.g. air-gapped CI);
the activity-level coverage in the same file still gates import +
registration shape.

---

## Environment variables

| Var                      | Required? | What it is                                                                                                                            |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TEMPORAL_NAMESPACE`     | yes       | Cloud namespace (`pegasus-staging` / `pegasus-prod`) or `default` for local.                                                          |
| `TEMPORAL_ADDRESS`       | yes       | Temporal gRPC host:port. `pegasus-<env>.chgel.tmprl.cloud:7233` in prod-tier envs.                                                    |
| `TEMPORAL_TASK_QUEUE`    | yes       | Task queue the worker polls (`pegasus-stdlib-<env>`).                                                                                 |
| `PEGASUS_API_BASE_URL`   | yes       | Base URL for broker + status-sync calls. CloudFront-fronted API URL in staging/prod.                                                  |
| `ENV_NAME`               | yes       | `dev` / `staging` / `prod`. Used only for log tagging + Temporal client identity.                                                     |
| `TEMPORAL_CLOUD_API_KEY` | no        | Temporal Cloud JWT. Empty (or unset) means "local Temporal dev server, no auth, no TLS".                                              |
| `WORKFLOW_BROKER_SECRET` | no        | Shared secret in the `X-Workflow-Broker-Secret` header. Required for any non-local broker call; failures here raise at the call site. |

The infra-side source of truth is `packages/infra/lib/stacks/temporal-worker-stack.ts`
— that stack injects every var above into the Fargate task. The worker's
own `config.py` is the symmetric receiver; the two files must stay in lockstep.

---

## How CI builds + ships the image

`.github/workflows/temporal-worker.yml` is the canonical path:

- Trigger: any push to `main` that touches `apps/temporal-worker/**`,
  `packages/workflows-sdk-python/**`, `packages/workflows-stdlib/**`, or
  the workflow file itself. (Manual `workflow_dispatch` for ad-hoc
  rebuilds.)
- Per env, it logs in to ECR via OIDC, runs
  `docker build -f apps/temporal-worker/Dockerfile .` (context = repo
  root — the Dockerfile reaches into sibling packages), pushes two tags
  (`:latest` and `:$GITHUB_SHA`), then forces a Fargate redeploy with
  `aws ecs update-service --force-new-deployment`.
- The ECS deployment circuit breaker (configured in
  `TemporalWorkerStack`) auto-rolls-back if the new task fails its
  health checks.

The `infra` path filter in `deploy.yml` also lists
`apps/temporal-worker/**`; an edit there triggers a `--all` deploy which
re-synthesises `TemporalWorkerStack`. The image push and the stack
deploy happen in parallel — both are safe (the stack just touches
`desiredCount` and config; it doesn't gate on the ECR image).

### Operator prerequisite — IAM perms on the deploy role

The OIDC role assumed by the workflow (the same one used by
`_deploy.yml`) needs:

- `ecr:GetAuthorizationToken`
- `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`,
  `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`,
  `ecr:BatchGetImage` — scoped to
  `arn:aws:ecr:us-east-1:*:repository/pegasus-temporal-worker`.
- `ecs:UpdateService` + `ecs:DescribeServices` — scoped to
  `arn:aws:ecs:us-east-1:*:service/pegasus-temporal-worker-<env>/*`.

These grants are NOT in the CDK (the deploy role was provisioned
out-of-band, see `packages/infra/lib/stacks/e2e-staging-role-stack.ts`
for the trust-policy precedent). Attach the additional inline policy
manually in each env account before the first workflow run.

---

## Observability

The worker logs JSON-line to stdout; the Fargate `awslogs` driver writes
to CloudWatch log group `/pegasus/<env>/temporal-worker`. Useful Insights
queries:

```text
# All worker startup events:
fields @timestamp, level, message, env, namespace
| filter logger = 'pegasus_temporal_worker'
| filter message like /worker\./
| sort @timestamp desc

# Pre-Unit-6 broker 404s — known good:
fields @timestamp, execution_id, message
| filter message = 'status_sync.endpoint_missing'
| sort @timestamp desc
```
