# Pegasus Tenant Runner

Phase 3 Unit 8 — the trusted shim that executes **untrusted tenant workflow
code**. One runner process serves exactly one tenant: it discovers that
tenant's executable workflow artifacts through the internal broker, verifies
and installs them in isolation, registers proxy workflows with Temporal, and
runs tenant entry points in locked-down subprocesses.

## Trust model (read this first)

The stdlib worker (`apps/temporal-worker`) trusts every line of code in its
image. This app is the opposite: **everything downloaded at runtime is
hostile until proven otherwise**, and even then it only ever runs:

- in a **subprocess** whose environment is built from an explicit allowlist
  (`pegasus_tenant_runner/sandbox_env.py`) — no `wbk_` broker token, no
  Temporal connection details, no `AWS_*`, no ECS credential/metadata URIs;
- with only the tenant's **own** `vnd_` runtime token (delivered over stdin,
  never argv or exec-time env), which grants the same read-mostly
  `workflow_runtime` role the tenant already holds;
- after the downloaded zip's **sha256 matched the digest recorded at
  finalize** (`artifactSha256`) — the TOCTOU defence against the artifact
  being re-uploaded through the still-valid presigned PUT URL after
  validation;
- inside a per-workflow directory + `--without-pip` venv (there is no
  installer in the venv and no code path that could fetch dependencies —
  v1 forbids them).

The shim process itself holds exactly one credential: the per-tenant
`wbk_` broker token (Unit 7). It holds **no AWS credentials at all** —
artifact downloads use broker-issued presigned GET URLs.

## Process lifecycle

1. `GET /api/v1/internal/tenant-workflows` (broker, `wbk_` auth) → the
   tenant's `executable: true` workflows with entry points, sha256 digests,
   and presigned download URLs. One row per name (latest upload wins).
2. Download → sha256 verify → safe-extract (path/symlink/zip-bomb guards,
   `RUNNER_MAX_UNPACKED_BYTES` install-size cap) → venv. A failing artifact
   is skipped and logged (`runner.artifact_sha_mismatch_SECURITY` for
   integrity failures); it never takes the runner down.
3. Register one proxy workflow per name + the single
   `run_tenant_entry_point` activity; poll `pegasus-tenant-<tenantId>-<env>`.
4. Each activity invocation: broker-proxied `vnd_` token fetch → subprocess
   run (wall-clock capped at `RUNNER_EXECUTION_TIMEOUT_SECONDS`, SIGKILL on
   overrun) → terminal `PATCH /internal/workflow-executions/:id`
   (COMPLETED / FAILED / TIMED_OUT).
5. **Idle-exit** (scale-to-zero, Resolved #1): after
   `RUNNER_IDLE_TIMEOUT_SECONDS` (default 600) with no activity, the runner
   drains the Temporal worker and exits 0. SIGTERM does the same.

### v1 execution semantics for tenant workflows

Tenant code is authored as Temporal workflow classes (SDK shape), but it
executes in **direct mode** inside the subprocess: the driver patches
`workflow.execute_activity` / `execute_local_activity` to call the activity
callable in-process, `workflow.sleep` → `asyncio.sleep`, `workflow.now` /
`workflow.uuid4` → wall-clock/random. The whole workflow is one unit of work
under the per-execution timeout; durable replay, signals, queries, and
per-activity retries are not available to tenant code in v1. Temporal sees a
single activity (`maximum_attempts=1`) under the proxy workflow.

## Configuration (env, injected by the Unit 9 dispatcher)

| Var                                | Required | Notes                                                                                                                                                |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENANT_ID`                        | ✓        | lowercase UUID                                                                                                                                       |
| `ENV_NAME`                         | ✓        | `staging` / `prod` / `dev`                                                                                                                           |
| `TEMPORAL_NAMESPACE`               | ✓        | `default` for local dev                                                                                                                              |
| `TEMPORAL_ADDRESS`                 | ✓        | gRPC `host:port`                                                                                                                                     |
| `PEGASUS_API_BASE_URL`             | ✓        | broker base URL                                                                                                                                      |
| `WORKFLOW_BROKER_TOKEN`            | ✓        | per-tenant `wbk_` token. The runner refuses anything else (notably the shared broker secret) and refuses a token whose embedded tenant ≠ `TENANT_ID` |
| `TEMPORAL_CLOUD_API_KEY`           |          | empty → local dev server (no TLS/auth)                                                                                                               |
| `RUNNER_IDLE_TIMEOUT_SECONDS`      |          | default 600                                                                                                                                          |
| `RUNNER_EXECUTION_TIMEOUT_SECONDS` |          | default 900                                                                                                                                          |
| `RUNNER_MAX_UNPACKED_BYTES`        |          | default 104857600 (100 MiB)                                                                                                                          |
| `RUNNER_MAX_OUTPUT_BYTES`          |          | default 262144                                                                                                                                       |
| `RUNNER_MAX_RESULT_BYTES`          |          | default 1048576                                                                                                                                      |
| `RUNNER_WORK_DIR`                  |          | default `/home/pegasus/work`                                                                                                                         |

The task queue is always derived: `pegasus-tenant-<TENANT_ID>-<ENV_NAME>`.

## Running tests

```bash
cd apps/tenant-runner
uv run --extra dev pytest -q
```

Same toolchain as `apps/temporal-worker` (no CI job runs Python tests today;
this is the local verification command). `tests/conftest.py` adds
`packages/workflows-sdk-python/` to `sys.path`. Several tests spawn real
subprocesses (driver + sandbox isolation proofs); they need no network and
no Temporal server.

Lint: `uv run --extra dev ruff check .`

## Local development

```bash
# Temporal + a tenant runner against your local API (run `npm run dev` in apps/api):
PEGASUS_TENANT_ID=<tenant uuid> \
PEGASUS_TENANT_BROKER_TOKEN=<wbk_ token> \
docker compose -f docker-compose.temporal.yml up temporal tenant-runner
```

Mint a local `wbk_` token for your dev tenant (no HTTP surface — lib-only by
design, Unit 7):

```bash
cd apps/api && npx tsx -e "import { db } from './src/db'; import { getOrCreateTenantBrokerCredential } from './src/lib/tenant-broker-credential'; getOrCreateTenantBrokerCredential(db, process.argv[1]).then(t => { console.log(t); process.exit(0) })" <tenant uuid>
```

The runner exits 0 immediately if the tenant has no `executable: true`
workflows — upload one first (`pegasus-workflows push`, post-Unit-6 API).
Because of idle-exit it will also stop on its own after 10 quiet minutes;
`docker compose up` again to relaunch.

## Image

```bash
docker build -f apps/tenant-runner/Dockerfile -t pegasus-tenant-runner .   # repo root context!
```

Packages are installed into the **system** interpreter (unlike the stdlib
worker's `/opt/venv`) because per-workflow venvs are created with
`--system-site-packages` and chain to the base interpreter — that is what
makes venv creation work with zero network. No tenant code is baked in.

Image build/push + ECS orchestration (ECR repo, `RunTask` dispatcher,
flow logs) is **Unit 9**, not this app.
