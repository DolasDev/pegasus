# Phase 3: durable workflow worker

- **Branch:** `feat/durable-workflow-worker` (worktree
  `../pegasus-durable-workflow-worker`). All Phase 3 changes stay on this
  branch.
- **Goal:** tenant-authored, long-running Workflows can run durably in their
  tenant's own Temporal Cloud namespace, isolated per D5 (option A).
- **Master plan:** `plans/in-progress/long-running-workflows-and-automations.md`.
  D1–D5, the target architecture (§3) and the Phase 2 evidence
  (`plans/completed/2b1e2147-durable-workflow-isolation-spike.md`) are there.
- **Status:** detailed plan approved 2026-09-29. **3a landed** (this PR,
  2026-10-04): DNS Firewall code plus both key downgrades, which are already
  live. Still owed from 3a: the post-deploy DNS check and the namespace-cap
  request. **Next: 3b**, in its own `/workstream-start`. This file stays in
  `plans/in-progress/` until 3c lands; each part's PR updates it. (The
  "Approved outline" section at the bottom is the original checklist, copied
  verbatim from the master plan; the detailed plan above supersedes it.)

## Step 0: detailed implementation plan (approved 2026-09-29)

- [x] Survey the code each outline item touches (2026-09-29; three read-only
      surveys, summarised in "Facts the design rests on").
- [x] Write the detailed plan below, including a proposed PR split and which
      steps change the live Temporal Cloud account.
- [x] User approval (2026-09-29): plan and the 3a/3b/3c split approved,
      DECIDE-1/3/4 answered (see Decisions), 3a started in this worktree.

### Facts the design rests on (surveyed 2026-09-29)

- **One namespace everywhere.** The API (`lib/temporal-client.ts`, one cached
  client, `TEMPORAL_NAMESPACE` env), the reconcile and dispatch Lambdas, the
  stdlib worker and every tenant runner all use `pegasus-<env>` and the one
  secret `pegasus/<env>/temporal-cloud`. On the API side, the key is a plaintext
  Lambda env var resolved at deploy time (`api-stack.ts:607-610`).
- **The runner is per tenant and launched on demand** (`ensureTenantRunner`,
  RunTask overrides `TENANT_ID` + `WORKFLOW_BROKER_TOKEN`). It polls
  `pegasus-tenant-<id>-<env>` with a catch-all proxy workflow, and runs tenant
  code as a subprocess with an allowlisted env. It idle-exits after 600 s with
  nothing in flight.
- **The `vnd_` runtime token has no expiry.** It's a per-workflow-row API key,
  KMS-encrypted on `Workflow.runtimeTokenCiphertext`. The broker hands it out
  only for a QUEUED or RUNNING execution row.
- **The per-tenant `wbk_` broker credential is KMS-encrypted in Postgres**
  (`TenantBrokerCredential`), not in Secrets Manager. That's the established
  pattern for per-tenant secrets.
- **The reconciler** describes RUNNING rows older than 5 min through the
  single client, 100 per tick. It leaves RUNNING Temporal executions alone.
- **Migration safety** only blocks DROP, RENAME and `SET NOT NULL`; adding a
  column with a default is fine. `ManifestSchema` is not `.strict()`, so a
  new manifest field is silently dropped unless it's added to the schema.
- **Nothing in code uses namespace-admin Temporal RPCs** (grep of apps, SDK and
  stdlib), so every existing key can drop to Write.
- **There's no DNS or network filtering today:** the runner security group is
  `allowAllOutbound`, and there are no Route 53 Resolver constructs.
- **Nothing tests the tenant runner against a real Temporal server.** Only
  `apps/temporal-worker/tests/test_worker_e2e.py` uses `WorkflowEnvironment`.
  The SDK's `test` command can't drive signals and blocks until completion.

### Proposed split: three PRs, in order

Phase 3 is too big and too security-sensitive for one reviewable PR. Each
part below is its own workstream and PR. This worktree carries **3a**, and 3b
and 3c get their own `/workstream-start`. Each part is useful on its own and
leaves `main` deployable.

#### 3a: harden today's Temporal access (small; ships value before any Workflow code)

1. **Downgrade today's keys to Write** (⚠️ **changes the live Cloud account**:
   `tcld service-account set-namespace-permissions` on
   `pegasus-{staging,prod}-service-account`, Admin → Write).
   - Staging first, then prod. Nothing in code uses admin RPCs.
   - Verify with a probe: the key gets `PERMISSION_DENIED` on an admin-only
     call, and a Write call still works.
   - Rollback is the reverse command.
   - Covers the runner, the stdlib worker and the API in one move, because
     they share the key.
2. **Block `saas-api.tmprl.cloud` from the WireGuard VPC.** Add a Route 53
   Resolver DNS Firewall rule group (domain list `saas-api.tmprl.cloud`, action
   BLOCK), associated with the VPC, in `wireguard-stack.ts`.
   - Every workload in the VPC (the hub, private Lambdas, the stdlib worker,
     tenant runners) only needs namespace endpoints.
   - Tests go in `wireguard-stack.test.ts`.
   - Caveat: a DNS block is bypassable by hard-coding the IP. It raises the
     bar; it's not a wall. Record that in GOTCHAS.
3. **Ask Temporal support to raise the 100-namespace cap.** A user action, not
   code. Staging and prod share the account.

Acceptance: the downgrade probe passes in staging and prod, and from a runner
task (ECS exec is disabled on runners, so use a one-off RunTask with a probe
command) `saas-api.tmprl.cloud` does not resolve.

**3a progress:**

- [x] DNS Firewall in `wireguard-stack.ts`: domain list, BLOCK → NXDOMAIN
      rule group, VPC association at priority 1000, and **fail-open set
      through an `AwsCustomResource`**. The default is fail-closed, which
      would put VPC-wide DNS at risk for a speed-bump control. Tests added
      first (5 new; infra suite 15/15 files, 383 tests). GOTCHAS entry added.
      Follow-on for 3b: the provisioner Lambda must run outside this VPC.
- [x] **Staging key downgraded to Write** (2026-09-29 18:35 UTC, with the
      user's go-ahead). `pegasus-staging-service-account` went Admin → Write,
      pinned to resourceVersion `8f44507f…`.
  - Read and Write still work: DescribeNamespace and List OK, and a signal
    to a missing id returns `NOT_FOUND`.
  - An admin call (retention 30 → 31) is refused with `PermissionDenied`;
    retention was confirmed still 30.
  - Staging health since the change: the worker service is ACTIVE 1/1,
    the dispatcher and reconcile Lambdas show 0 errors, and there are 0
    permission errors in the worker and runner logs.
  - Pitfall hit: an unchanged value makes `tcld` short-circuit ("already
    set") **before** authorization, so an admin probe must request a real
    change.
- [x] **Prod key downgraded to Write** (2026-10-02 17:52 UTC, with the user's
      go-ahead after staging had soaked 3 days).
      `pegasus-prod-service-account` went Admin → Write, pinned to
      resourceVersion `1934551a…`.
  - Read and Write probe OK. The admin call (retention 30 → 31) was refused
    with `PermissionDenied`; retention was confirmed still 30.
  - After 10 minutes: the worker is ACTIVE 1/1, and the dispatcher and
    reconcile Lambdas ran 11 times each with 0 errors. 0 permission errors
    in the logs.
  - **Real traffic on the Write key:** 5 executions started after the change.
    The API started them, the tenant runner polled them and the activity
    ran. They failed only inside tenant code, for the pre-existing reason
    below.
  - **Pre-existing, unrelated (reported to the user):** every prod execution
    for at least 10 days has failed (794). 793 of them are
    `send_order_saved_sms` for tenant `a90b22bc-4393-4e6e-8fe4-4ca01a13aba8`,
    whose EVENT trigger fires on order saves, but `send_sms` returns
    `404 RingCentral is not connected for this account`. That's about 100
    failures a day; a tenant-configuration issue, not a platform fault.
- [~] Runner-task DNS acceptance check. The image's ENTRYPOINT is fixed and
  ECS can't override an entrypoint, so the check uses a throwaway
  `pegasus-dnsprobe-<env>` task definition: stock `python:3.12-slim`, no
  secrets, the runner's cluster, subnets, security group and exec role.
  It resolves two names, then deregisters itself.
  - **Baseline (2026-10-04, before deploy, staging):** `saas-api.tmprl.cloud`
    RESOLVES (6 IPs), and the control `pegasus-staging.chgel.tmprl.cloud`
    resolves. The check works.
  - **After 3a deploys:** re-run it. Expect `saas-api.tmprl.cloud` FAILS
    (NXDOMAIN) and the control still RESOLVES, in staging and prod. Run it
    with **`scripts/temporal-dns-probe.sh <staging|prod>`** (committed; the
    repo copy was re-run against staging with identical results).
- [ ] User: ask Temporal support to raise the namespace cap.

#### 3b: namespace per tenant for Automations (the security-critical part; no Workflows yet)

- **Data:** a new model `TenantTemporalNamespace`:
  - fields: `tenantId @unique`, `namespace`, `grpcAddress`, `apiKeyId`,
    `apiKeyCiphertext` (KMS, the same key as the runtime tokens),
    `apiKeyExpiresAt`, `status` (`PROVISIONING|READY|DRAINING|ACTIVE`),
    timestamps;
  - an additive migration, and an entry in `TENANT_SCOPED_MODELS`.
- **Provisioning (DECIDE-1 → automated Lambda, user decision 2026-09-29):**
  a dedicated `temporal-provisioner` Lambda per env. It is **not** the API
  Lambda, so the Cloud credential never sits in the request path. It's invoked
  asynchronously from an admin-web action ("Enable Workflows for tenant") and
  from `scripts/` for re-runs. It must **not** be VPC-attached to the WireGuard
  VPC: 3a's DNS Firewall blocks `saas-api.tmprl.cloud` there. Steps,
  idempotent and resumable from `TenantTemporalNamespace.status`:
  - create `pegasus-<env>-t-<short>` (API-key auth);
  - create a scoped **Write** service account, then its key (1-year expiry);
  - grant the platform service account Write;
  - **retry until authorized** (about 90 s seen);
  - store the key KMS-encrypted.
  - Also `rotate` and `deprovision` actions.
  - **Guardrails**, because the user accepted a Cloud credential in AWS, and
    staging and prod share the Cloud account:
    - The credential gets the **lowest account role that can create
      namespaces and service accounts**, never Owner or Global Admin. Its key
      lives in `pegasus/<env>/temporal-provisioner`, readable only by the
      provisioner Lambda's role.
    - **Verify before 3b ships:** the _staging_ provisioner key must be
      refused (`PERMISSION_DENIED`) on `pegasus-prod` and on any prod tenant
      namespace, for describe, write and delete. Use a Phase 2-style probe
      with a control.
    - If the role turns out to reach namespaces it didn't create, **stop and
      return to the user**. Options then: separate Temporal Cloud accounts
      per environment, or falling back to operator scripts.
    - It only acts on names matching the `pegasus-<env>-t-*` pattern,
      enforced in code. Every call is logged to a CloudWatch audit stream.
- **Platform identity:** a new _account-level_ (not namespace-scoped)
  platform service account per env, with account role **Read** (the minimum;
  it belongs to the trusted Lambdas, so the user-list exposure doesn't matter
  here). It gets **Write** on `pegasus-<env>` and on each tenant namespace,
  granted at provisioning. New secret `pegasus/<env>/temporal-platform`. The
  API and cron Lambdas move to it. ⚠️ Cloud account change.
- **API Temporal client becomes per-namespace, chosen by _route_ and
  _tenant_:**
  - STDLIB (curated) runs **always** go to the platform namespace, because
    that's where the stdlib worker polls.
  - TENANT_RUNNER runs go to the tenant's namespace when it's ACTIVE, and the
    shared one otherwise.
  - The chosen namespace is **stored on the row**: a new additive column,
    `WorkflowExecution.temporalNamespace`, written at start.
  - The reconciler and the cancel, retry, describe and history handlers read
    it from the row and never re-derive it from tenant status, which changes
    at cutover. Legacy rows with a null value use the shared namespace.
  - One cached client per namespace.
  - First item: **verify the regional endpoint** serves many namespaces with
    one key (the positive case Phase 2 didn't test). If it does, use one
    connection; otherwise use one per namespace endpoint.
- **Runner in scoped mode:**
  - A second task definition, `pegasus-tenant-runner-scoped-<env>`, with **no
    Temporal secret at all**.
  - At start the runner calls a new broker endpoint,
    `GET /internal/temporal-credentials` (authenticated with `wbk_`, confined
    to the tenant). It returns `{address, namespace, apiKey}` for READY or
    ACTIVE tenants and 404 otherwise.
  - `ensureTenantRunner` picks the task definition by tenant status. The
    legacy task definition stays for unprovisioned tenants.
  - This fetch-at-start design keeps the key out of RunTask overrides,
    which are readable through `ecs:DescribeTasks`. It matches how `wbk_` is
    already stored, so it's the default rather than a question.
  - **Deploy-order constraint:** `tenant-runner.yml` pushes `:latest` on every
    merge, independently of CDK, so 3b's runner code will run under the
    _legacy_ task definition before the scoped one exists. The runner must
    work under both: env-provided credentials when present, a broker fetch
    when absent, with no ordering dependency on the CDK deploy.
- **Per-tenant cutover (drain, then flip):**
  - `READY`: nothing changes yet.
  - `DRAINING`: new starts are refused with 409 `TENANT_MIGRATING`.
    SCHEDULE triggers skip (a missed tick is acceptable, per the existing
    no-catch-up contract). **EVENT outbox rows for that tenant stay
    undispatched and fire after ACTIVE.** Events are durable and must never
    be lost to the drain.
  - When there are **zero QUEUED/RUNNING rows** (Automations cap at 15
    minutes), the status becomes `ACTIVE`. From then on, starts go to the
    tenant namespace and the scoped runner.
  - Driven by `scripts/temporal/cutover-tenant.ts`.
  - The final cleanup (removing the legacy runner task definition and the
    shared key from runners) happens once every tenant is ACTIVE. That's a
    separate small PR.
- **Tests:**
  - vitest for client resolution, cutover states, the broker endpoint (tenant
    confinement and 404s) and task-definition selection;
  - pytest for the runner's credential fetch;
  - infra tests: the scoped task definition has no Temporal secret, and the
    new secret is read only by the API and cron Lambdas.
- **Acceptance:** provision one staging tenant, re-run the Phase 2 probes
  (`probe.py`, `control.py`, `cloudops_probe.sh`) against it, cut it over, and
  run an Automation end to end, including a dry run.

⚠️ **Cloud account changes in 3b:** the new platform service account, and
provisioning of one staging tenant. Each is scripted, run by the user or with
the user's go-ahead, and paired with a deprovision script.

#### 3c: durable Workflows (only for ACTIVE tenants)

- **Data and manifest:**
  - Prisma: `Workflow.kind` (`AUTOMATION|WORKFLOW`, default AUTOMATION),
    additive.
  - `ManifestSchema` gains `kind`, `signals: string[]` (declared now,
    enforced in Phase 4) and `maxLifetimeDays` (default 90, platform maximum
    365).
  - `timeoutSeconds` ≤ 900 applies to AUTOMATION only.
  - Finalize refuses `kind=WORKFLOW` unless the tenant is ACTIVE (422
    `TENANT_NAMESPACE_REQUIRED`).
  - Mirror all of this in the SDK's `manifest.py` (`kind = "workflow"` in the
    TOML).
  - **Discoverability (`CLAUDE.md` rule):** the MCP manifest reference, the SDK
    README and CLI `--help` document `kind`, `signals` and `maxLifetimeDays`
    in the same PR. The full Workflows guide stays in Phase 5.
- **Start path:** a WORKFLOW execution starts in the tenant namespace on
  `pegasus-tenant-<id>-<env>-wfl`, with
  `workflowExecutionTimeout = maxLifetimeDays`. Pinning is not a start
  option; it comes from the worker's behaviour plus the server's current
  version (see Versioning). It doesn't count toward the concurrency cap of 5;
  a new cap limits open Workflows per tenant (default 500).
- **Workflow worker in the runner:** for each WORKFLOW artifact version that is
  the latest or has open executions, the shim spawns a **long-lived, hardened
  subprocess**.
  - Its env is on the allowlist, and it's non-dumpable (inherited from the
    shim).
  - It receives its credentials over stdin: the tenant Temporal key, the
    namespace and the `vnd_` token.
  - It runs `Worker(workflows=[cls], activities=[module activities],
task_queue=…-wfl, deployment version = (name, artifactSha256))`.
  - Tenant code holds a **tenant-scoped** key only, as accepted by D5.
- **Broker:** a new `POST /internal/workflow-worker-grant {workflowId}`. It
  returns the `vnd_` token for a WORKFLOW row that is the latest executable
  version or has open executions. This resolves master-plan open question 2:
  a `vnd_` token doesn't expire, so one grant per worker subprocess is enough.
  - The broker's `tenant-workflows` list gains `kind` and `openExecutions`.
- **The idle tracker must see the worker subprocesses.** Today `IdleTracker`
  counts only the proxy activity's start and finish, so the shim would see
  zero in-flight and exit at 600 s, killing a Workflow mid-task.
  - Each worker subprocess reports task start and finish to the shim over a
    control pipe (not stdout, which tenant code owns), and the shim counts
    them as in-flight.
  - Shutdown (idle or SIGTERM) drains every worker subprocess before the shim
    exits.
  - It also keeps the runner alive while Workflows are open (DECIDE-3).
- **Versioning:**
  - Worker Deployment Versioning, GA per the Phase 2 research: deployment =
    workflow name, build id = `artifactSha256`, worker behaviour **Pinned**.
  - **The current version must be set on the server**
    (`SetWorkerDeploymentCurrentVersion`, platform key, Write) _after_ the new
    build's worker has polled at least once. Otherwise new executions don't
    move to it.
  - Who sets it: the **API**, on a broker callback from the runner once the
    new version's worker subprocess has made its first successful poll. It
    can't happen at finalize, because no worker has polled yet.
  - Old versions keep serving their pinned executions until the last one
    closes; then the runner stops that subprocess.
  - Confirm the exact Python SDK 1.33 API and its server calls before coding.
- **Waking (DECIDE-3 → keep the runner up, user decision 2026-09-29):** a
  tenant with **any open WORKFLOW execution** keeps its runner alive.
  - The dispatcher's runner sweep also covers those tenants and calls
    `ensureTenantRunner` every minute.
  - The runner does **not** idle-exit while any Workflow worker subprocess
    serves an open execution: the idle tracker counts those subprocesses as
    in-flight (see the bullet above).
  - Timers and signals are served immediately. There is no backlog check.
  - Cost: about $18/month of Fargate per tenant with open Workflows, which
    was accepted.
  - A crashed runner is relaunched within about 1 minute by the sweep.
- **Reconciler:** it must use the per-namespace client (done in 3b). It keeps
  leaving RUNNING Workflows alone. Stopping it from rescanning long-lived rows
  every tick stays in Phase 4, as planned.
- **Kill switch (master-plan open question 5, DECIDE-4):** `workflowsDisabled`
  refuses new Workflow _starts_ too. Running Workflows keep running and their
  timers fire; signal delivery is Phase 4's to gate.
  - Rationale: pausing timers would silently break lifecycles; terminating
    them is destructive.
  - Relabel the admin switch "Disable new automation and workflow runs".
- **Remove the `wait_condition` "unsupported in v1" path** for WORKFLOW only.
  The Automation driver keeps it.
- **Tests:**
  - pytest: the worker subprocess against `WorkflowEnvironment.start_local()`
    (the pattern `test_worker_e2e.py` already uses), with a Workflow that
    waits on a timer and a condition, survives a worker restart (replay), and
    stays pinned across a version publish;
  - vitest: `kind`, manifest, start routing and caps;
  - infra tests as needed.
- **Acceptance:** on the staging tenant, a published Workflow waits on a
  timer longer than the runner's idle window. The runner exits, the sweep
  wakes it, and the Workflow completes. Queried status is correct throughout.

### Decisions needed (recommendation first)

- **DECIDE-1, provisioning → an automated `temporal-provisioner` Lambda**
  (user, 2026-09-29; I recommended operator scripts). Guardrails are in 3b.
- ~~DECIDE-2~~ **Settled by convention:** tenant keys are KMS-encrypted in
  Postgres and fetched through the broker, the same as `wbk_`.
- **DECIDE-3, waking → keep the runner up while a tenant has open Workflows**
  (user, 2026-09-29; I recommended a backlog sweep). About $18/month per such
  tenant.
- **DECIDE-4, kill switch → block new starts only; running Workflows
  continue** (user, 2026-09-29).

### Risks

- **3b touches every Automation run for a tenant at cutover.** The drain,
  flip and fallback-to-shared design, plus a per-tenant rollback script
  (`ACTIVE` → shared, after its own drain), limit the blast radius to one
  tenant at a time.
- **Hot files:** `schema.prisma` (3b, 3c) and the Cedar schema (only if 3c
  adds actions; not planned). Serialize with other streams.
- **Cost:** a Temporal Cloud namespace is free. Fargate for durable workers
  follow DECIDE-3: about $18/month per tenant with open Workflows.
- **Reconciler starvation (known trade, fix in Phase 4):** the reconciler
  takes 100 RUNNING rows per tick. Once 3c ships, hundreds of long-lived
  Workflow rows can starve Automation rows of reconciliation, delaying their
  terminal status. Accepted until Phase 4 stops it rescanning long-lived
  rows.

## Approved outline (verbatim from the master plan)

### Phase 3: Durable worker + versioning (branch `feat/durable-workflow-worker`)

- [ ] Prisma: add `Workflow.kind` (`AUTOMATION|WORKFLOW`, default
      `AUTOMATION`) plus a migration. Existing rows become `AUTOMATION`.
- [ ] Manifest (`handlers/workflows.ts` `ManifestSchema`, and the SDK's
      `manifest.py`): add `kind`, `signals`, and a lifetime field for
      Workflows. `timeoutSeconds ≤ 900` still applies to Automations only.
- [ ] Tenant runner: add a long-lived, hardened workflow-worker subprocess
      that loads published `WORKFLOW` artifacts and polls `tenant-<id>-wfl`
      over the D5 connection.
- [ ] Versioning: pin each running Workflow to the artifact it started on,
      using Temporal worker versioning (build id = `artifactSha256`; confirm
      which versioning API Cloud currently supports as GA). The runner serves
      every artifact version that still has open executions, and retires a
      version when its last execution closes.
- [ ] Provisioning (D5 = option A): per tenant, create the namespace
      (API-key auth), then a namespace-scoped **Write** service account, then
      its key, then **retry until authorized** (about 90 s seen in Phase 2),
      and only then launch the runner. Do it through the Cloud Ops API.
      Rotate keys before their maximum 2-year lifetime. Infra goes in
      `packages/infra/lib/stacks/temporal-worker-stack.ts` (owns the tenant
      runner task definition) plus secrets.
- [ ] **New platform service account:** account-scoped (not
      namespace-scoped), gaining Write on each tenant namespace at
      provisioning. Today's `pegasus-{prod,staging}-service-account` are
      namespace-scoped Admin accounts and can't reach new namespaces.
- [ ] **Move Automations into the tenant namespace.** The API starts each
      tenant's Automations in that tenant's namespace, so the runner polls
      only there and holds **only** the tenant-scoped key. Without this, the
      runner keeps the platform key _and_ tenant code gets a live Temporal
      connection in the same container, which is worse than today. This is a
      migration of existing Automation routing: drain in-flight runs before
      cutting over.
- [ ] **Check the regional endpoint** (`us-east-1.aws.api.temporal.io:7233`
      takes the namespace per request). If one platform key there serves
      every tenant namespace, the API Lambda needs one connection, not N.
      Phase 2 proved only the refusal side.
- [ ] **Block the Cloud management API from tenant runners:** deny
      `saas-api.tmprl.cloud` in the runner VPC (e.g. Route 53 Resolver DNS
      Firewall). Scoped keys must keep account-level Read, which exposes the
      Cloud account's user list.
- [ ] **Namespace cap:** ask Temporal support to raise the account's
      100-namespace cap (it counts staging and prod together) before
      onboarding approaches it.
- [ ] Re-run the Phase 2 probes (`probe.py`, `control.py`,
      `cloudops_probe.sh`) against namespaces created by the real provisioning
      code, as an acceptance check.
- [ ] **Downgrade worker keys from namespace Admin to Write** (found in
      Phase 2; the user chose to roll it in here, 2026-09-29). Today the
      tenant runner and the stdlib worker both hold
      `pegasus-{prod,staging}-service-account`'s key, which has namespace
      **Admin** (delete namespace, manage access). Workers need only Write.
      Every key issued in this phase is Write-level from the start: the
      tenant-scoped keys, and a separate Write key for any worker still
      polling the platform namespace. Keep Admin only where namespace
      administration is actually done, never in a task definition. A
      namespace-scoped account's permission level can be changed (only its
      namespace can't), per the docs (untested in Phase 2), so an existing
      account may also be lowered in place.
      Verify with a probe that a worker key gets `PERMISSION_DENIED` on an
      admin-only call.
- [ ] Waking: extend the dispatcher sweep (task-queue backlog →
      `ensureTenantRunner`).
- [ ] Remove the `wait_condition` "unsupported in v1" path for the
      `WORKFLOW` kind only. The Automation driver keeps it.
- [ ] Tests: runner unit tests (pytest), API integration tests for `kind`
      and manifest validation, and infra assertion tests.
