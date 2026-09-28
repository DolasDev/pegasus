# Long-running Workflows + the Automations rebrand

- **Branch:** `feat/automations-rebrand` (Phase 1; worktree
  `../pegasus-automations-rebrand`). All changes for Phase 1 stay on this
  branch. This is a multi-phase plan: each later phase lands as its own
  workstream (`/workstream-start` → `<type>/<slug>` worktree off fresh
  `origin/main`) and its own PR, using the branch name in its phase heading.
  This file lands on `main` with Phase 1's PR and is updated by each later
  phase's PR.
- **Goal:** add long-running, event-driven **Workflows** (durable Temporal
  workflows, tenant-authored in Python) as a new capability, and rebrand what
  exists today as **Automations**: short sandboxed runs that fire on their own
  from triggers or run as steps called by a Workflow.
- **Status:** Approved 2026-09-25. Phase 1 in progress.
- **Supersedes:** `plans/sdk/long-running-event-correlated-workflows.md`
  (spec 0008, Proposed since 2026-06-29). Marked superseded in
  `plans/sdk/README.md` and the spec itself by Phase 1. Still owed: mirror
  that status to `~/repos/pegasus-workflows/sdk-feedback/0008-*.md` (separate
  repo).

---

## 1. Context: why long-running runs are impossible today

Tenant code never runs as a Temporal workflow. It runs as one subprocess
inside one activity:

| Layer                                      | Where                                                                                                                                                                                                                                                                 | What it does                                                                                                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proxy workflow                             | `apps/tenant-runner/pegasus_tenant_runner/proxy.py`                                                                                                                                                                                                                   | A dynamic catch-all workflow whose whole body is one `execute_activity("run_tenant_entry_point")`, with `maximum_attempts=1`.                                                                                                                 |
| Subprocess driver                          | `apps/tenant-runner/pegasus_tenant_runner/subprocess_driver.py`                                                                                                                                                                                                       | Runs the tenant's workflow class as plain asyncio with **no Temporal connection**. It swaps in plain-Python stand-ins for Temporal's functions; `wait_condition` raises "unsupported in v1". There are no signals, no queries, and no replay. |
| 900s ceiling                               | `apps/api/src/handlers/workflows.ts:170` (manifest `.max(900)`), `apps/api/src/lib/start-workflow-execution.ts:72,585`, `packages/workflows-sdk-python/pegasus_workflows/manifest.py:41`, `apps/tenant-runner/.../config.py:144` (`RUNNER_EXECUTION_TIMEOUT_SECONDS`) | The run is killed at 15 minutes.                                                                                                                                                                                                              |
| No routing of events to running executions | `apps/api/src/lambda-dispatch-workflow-triggers.ts`                                                                                                                                                                                                                   | An EVENT trigger always **starts a new** execution. Nothing in the API or the SDK signals a running one.                                                                                                                                      |
| Concurrency cap                            | `start-workflow-execution.ts:78` `TENANT_RUNNER_CONCURRENCY_CAP = 5`                                                                                                                                                                                                  | Counts QUEUED + RUNNING rows. Five waiting lifecycles would block the tenant.                                                                                                                                                                 |

The missing Temporal connection is **deliberate**. It's the sandbox's
isolation model: the runner's `wbk_` broker token stays in the trusted
runner process, and tenant code only ever sees its own `vnd_` runtime token.
The one shared Temporal Cloud API key (`pegasus/{env}/temporal-cloud`) can
read and write every tenant's executions, so it can never reach tenant
code. **Durable tenant code needs a Temporal worker connection, so isolation
is the real problem this plan has to solve** (D5 and Phase 2).

Not a blocker: `lambda-reconcile-workflow-executions.ts` copies Temporal's
terminal status after a 5-minute grace period. It has no timeout of its own.
It does, however, need a change for long-lived rows (see Risks).

---

## 2. Decision record

### D1: Workflows are tenant-authored Temporal workflows in Python

- **Decision:** a Workflow is a real Temporal workflow class that the tenant
  writes with the existing SDK (`@pegasus_workflow`, `@workflow.run`,
  `@workflow.signal`, `@workflow.query`, `workflow.wait_condition`,
  `workflow.sleep`) and publishes like an Automation.
- **Rejected:** declarative definitions (states, waits and steps interpreted
  by trusted platform code). That would have avoided the isolation problem,
  but the requirement is that Workflows are tenant-authorable in the language
  and model authors already use, and `nw/order_lifecycle` is already written
  this way.
- **Consequence:** isolation (D5) and versioning (Phase 3) are on the
  critical path.

### D2: No new concepts; map everything onto Temporal's own

| Temporal                          | Pegasus                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| Workflow (durable, deterministic) | **Workflow** (new)                                                        |
| Activity                          | **Automation** (today's sandboxed runs), called from a Workflow as a step |
| Signal / Update                   | A domain event delivered to a running Workflow                            |
| Query                             | Workflow status and read-only state for the UI and SDK                    |
| Workflow ID                       | Correlation key (e.g. the order id)                                       |
| Signal-with-start                 | An EVENT trigger in `START` mode (may create the instance)                |
| Signal                            | An EVENT trigger in `DELIVER` mode (only reaches a running instance)      |
| Continue-as-new                   | How very long Workflows keep their history bounded                        |

There is no invented "task" or "step" entity. A Workflow "waiting on a task"
means it waits on a signal or on an Automation's result. It is not a new
table.

### D3: The rebrand covers the concept and presentation only

- **Renamed to "Automation":** tenant-web and admin-web labels, docs, the SDK
  README, the MCP guide text, CLI `--help` wording, the authoring repo's
  `CLAUDE.md`, and plan vocabulary.
- **Unchanged (wire names and storage):** the `workflows`,
  `workflow_executions`, `workflow_triggers` and `workflow_secret_configs`
  tables; the `/workflows` API paths; Cedar action names; the
  `pegasus-workflows` PyPI package and `pegasus_workflows` module; the CLI
  binary; `pegasus://` MCP URIs.
- **Why:** those names are the external product boundary (see the
  "SDK is the external product boundary" section of `CLAUDE.md`). Renaming
  them breaks every external author for no benefit anyone would see.
  Revisit only with a deprecation and alias period.

### D4: Stay on Temporal Cloud (do not self-host)

- **Decision:** keep Temporal Cloud. Phase 2 must explicitly confirm that
  Cloud supports per-tenant isolation (see the criteria below).
- **What self-hosting would and wouldn't fix:**
  - _Isolation:_ only a little. Self-hosted namespaces are free, and a custom
    server authorizer (`Authorizer`/`ClaimMapper`) could enforce per-tenant
    access. But Cloud offers per-namespace access control through scoped
    service accounts and API keys, which is probably enough (the spike
    confirms this).
  - _Versioning:_ no. Worker versioning behaves the same on both.
  - _Waking the runner:_ no. Scale-to-zero is our design, not Temporal's.
  - _Signal routing and limits:_ no. That's all our code.
- **What self-hosting would cost:**
  - Running four server services (frontend, history, matching, worker) plus
    a database (Postgres or Cassandra) and, realistically, Elasticsearch for
    searching executions.
  - Upgrades, sizing, backups and failover. The history shard count is fixed
    when the cluster is created.
  - Higher stakes. Once Workflows hold weeks of state for every open order,
    losing the history database means losing where every order stands.
    Long-running Workflows make managed durability _more_ valuable, not less.
  - Migration cost. Executions can't move between clusters mid-flight; moving
    means draining one cluster and cutting over. It's cheap now, when
    everything lasts at most 15 minutes, and expensive once weeks-long
    Workflows exist. **So if we ever self-host, we should do it before
    Phase 4 ships.** The spike's result is the last cheap moment to decide.
- **Revisit self-hosting if any of these happen:**
  1. The Phase 2 spike shows Cloud can't isolate tenants acceptably:
     namespace count limits, per-namespace cost, or API-key scopes too coarse.
  2. The Cloud bill (driven by action volume and stored history) gets large
     relative to the cost of running the server ourselves. Signals, timers
     and long histories will push action counts up, so Phase 5 adds a metric
     for this.
  3. A data-residency or customer requirement says execution history can't
     live with a third party.
- **Owner of revisiting:** whoever runs Phase 2 records the spike's outcome
  against trigger 1 here, before Phase 3 starts.

### D5: Isolation approach (decided by the Phase 2 spike)

Candidates, in order of preference:

- **A. A Temporal Cloud namespace per tenant, with a namespace-scoped
  service-account API key.** The tenant worker holds a key that can only
  reach its own namespace. This is the strongest isolation. The platform's
  API Lambda keeps a key that can reach every namespace.
- **B. A gRPC proxy between tenant workers and Temporal.** The trusted
  runner holds the real key. Tenant code connects to a local proxy that
  allows only a fixed list of RPCs, and only on the tenant's task queues and
  `wfl/<tenantId>/` workflow ids. One namespace remains. Risk: Temporal's
  gRPC API is large, so the allowed list has to be proven complete, safe,
  and future-proof.
- **C. Relaying through the trusted runner.** The runner holds the
  connection and hands workflow tasks to the sandboxed subprocess. The Python
  SDK doesn't support this. Rejected unless both A and B fail.

---

## 3. Target architecture

- **One `workflows` table, a new `kind` column** (`AUTOMATION | WORKFLOW`,
  defaulting to `AUTOMATION`). Workflows reuse the whole publish pipeline:
  the artifact in S3, `artifactSha256`, the manifest, secrets and configs,
  and the runtime service account. The manifest gains `kind = "workflow"`.
  Prisma model names may be renamed in code without a migration (`@@map`
  already pins the tables), but that's optional and not part of this plan.
- **Automations:** unchanged at runtime. They keep the subprocess, the 900s
  cap, the concurrency cap of 5 and the daily quota.
- **Workflows:** run on a **long-lived tenant workflow worker**. This is a
  hardened subprocess inside the tenant runner (the same hardening as today,
  but persistent rather than one per execution) holding the isolation-scoped
  Temporal connection from D5. Its task queue is `tenant-<id>-wfl`, separate
  from the Automation queue. Workflow ids have the form
  `wfl/<tenantId>/<name>/<correlationKey>`, which cannot collide with an
  Automation's `wf/<tenantId>/<name>/<executionId>`.
- **Automations as steps:** a Workflow calls an Automation through an SDK
  helper, `await run_automation("<name>", input)`. The helper is an
  **activity** in the workflow worker that calls the API's existing run path
  (`POST /workflows/:id/run`, using the runtime token) and waits for the
  result, either by polling with heartbeats or by async activity completion.
  It is _not_ a child workflow, because child workflows only work within one
  namespace, and under D5 option A the Workflow (tenant namespace) and the
  Automation proxy (platform namespace) live in different ones. Going
  through the API also gives execution rows, runtime tokens, quotas and the
  concurrency cap for free, because it's the same path as any other run.
- **Event delivery:** a `WorkflowTrigger` bound to a `WORKFLOW`-kind target
  gets a `correlationPath` (a JSON path into the event payload, e.g.
  `payload.orderId`) and a mode, chosen per binding:
  - `START`: **signal-with-start** on `wfl/<tenant>/<name>/<key>`. It may
    create the instance; this is the `order.booked` binding.
  - `DELIVER`: a **plain signal** to that id. If no instance is running,
    record a failed delivery; never create one. This way `order.completed`
    for an order that was never booked can't start a lifecycle.

  Either way the event type is the signal name and the event envelope is the
  signal argument. The manifest declares `signals = [...]` so bindings can be
  checked at publish time. The dispatcher calls `ensureTenantRunner` right
  after it signals, since it knows it just queued work.

- **Waking the runner:** signals already wake it, because the dispatcher
  calls `ensureTenantRunner` inline. **Timers** are the gap: when a timer
  fires while the tenant runner is scaled to zero, work lands on
  `tenant-<id>-wfl` with no API call to launch a runner. The existing 1-minute dispatcher sweep
  (phase 3 of `lambda-dispatch-workflow-triggers.ts`) is extended: for every
  tenant with open Workflows, check the task-queue backlog and call
  `ensureTenantRunner`. The accepted latency is up to about 1 minute plus a
  30–60 second cold start, which is fine for business lifecycles.
- **Limits for Workflows:** a maximum number of open Workflows per tenant, a
  maximum lifetime (a workflow execution timeout, default 90 days, set by
  the manifest up to a platform maximum), and guidance on history size
  (continue-as-new before Temporal's 50k events / 50 MB limits). Open
  Workflows are **not** counted against `TENANT_RUNNER_CONCURRENCY_CAP`.

---

## 4. Phases

Each phase is one workstream and one PR, ending in a green merge queue and
deploy. Phases 1 and 2 are independent and can run in parallel.

### Phase 1: Rebrand to Automations (branch `feat/automations-rebrand`)

Low risk. No change to wire names or behavior.

- [x] Change the tenant-web nav label and page copy: `AppShell.tsx`
      (`'Workflows'` → `'Automations'`, icon `Workflow` → `Zap`),
      `routes/settings.workflows.tsx`,
      `routes/settings.workflows.$workflowId.tsx`,
      `features/settings/WorkflowSecretsConfigs.tsx`,
      `routes/settings.developer.tsx`, `routes/settings.event-types.tsx`,
      `routes/settings.feedback-forms.tsx`. `landing.tsx` was left alone: its
      "approval workflows" is ordinary English, not the product concept.
      **Changed from the draft:** the pages _moved_ to
      `/settings/automations[/$workflowId]`, and the old
      `/settings/workflows[/$workflowId]` paths redirect there (keeping
      `?tab=executions`). This frees the `/settings/workflows` path for the
      Phase 4 Workflows page, which replaces the redirects. Route source files
      keep their `settings.workflows*` names (identifiers aren't renamed).
      `__tests__/AppShell.test.tsx` updated for the new label. The redirect
      handlers live in `src/lib/legacy-workflow-redirects.ts` (unit-tested in
      `legacy-workflow-redirects.test.ts`) so they can be tested without
      mounting the router; Phase 4 deletes that module.
- [x] Change the same wording in admin-web: the nav label (`routes/_auth.tsx`;
      path stays `/workflows`), the global library page
      (`routes/_auth/workflows/index.tsx`), and the tenant detail page's
      platform-tenant copy and kill switch (`routes/_auth/tenants/$id.tsx`,
      "Automation runs", "Enable/Disable automations").
- [x] SDK: update the README, CLI `--help` strings
      (`pegasus_workflows/cli/*`), the MCP guide resources
      (`cli/mcp_server.py`, `pegasus://guide/*`) and `templates/`. Keep the
      package, module and URI names. Done across 23 files. The README and the
      MCP authoring guide now say an Automation is authored as a Temporal
      workflow class but runs as one sandboxed unit (900 s, no signals,
      queries or `wait_condition`). The `pyproject.toml` description and the
      template greeting were changed too, and there's a new `CHANGELOG.md`
      `## Unreleased` entry. **No version bump**: it ships with the next SDK
      tag. Kept as-is even in prose: the `consumerKind: "workflow"` wire
      value, role names (`workflow_developer`), and Cedar and Temporal
      identifiers. The stale "no server-side execution yet" README line was
      corrected.
- [ ] Authoring repo: update `~/repos/pegasus-workflows/CLAUDE.md` wording.
      That's a separate repo and a separate PR, which must not be published
      from this platform session.
- [x] OpenAPI (`apps/api/src/lib/openapi-spec.ts`): summaries of the
      `/workflows` read routes now say "automation". The `Workflows` **tag
      name is kept** (generated clients may group by it), with a new top-level
      `tags` entry describing it as Automations and noting that the paths,
      operation ids and Cedar names keep their original names.
- [x] Update `DECISIONS.md`: one entry covering D1–D4, pointing at this plan.
- [x] e2e browser specs: none assert on "Workflows" text or
      `/settings/workflows` (checked with `/usr/bin/grep -a`), so nothing to
      change.
- [x] Mark SDK spec 0008 superseded (`plans/sdk/README.md` plus the spec).
- **Side effects:** snapshot and text assertions in the e2e and tenant-web
  tests. `AppShell.tsx` and `router.tsx` are hot files, so serialize with any
  other stream touching them.

### Phase 2: Isolation spike + Cloud confirmation (branch `docs/durable-workflow-isolation-spike`)

A time-boxed investigation. Its output is a written decision, not production code.

- [ ] Temporal Cloud questions to answer (confirm against current Cloud docs,
      not memory):
  - The namespace limit per account and how to raise it.
  - Pricing per namespace and any minimums.
  - Whether service-account API keys can be limited to one namespace, and
    with what permissions (worker-only?).
  - Provisioning and rotating namespaces and keys through the Cloud Ops API,
    `tcld` or Terraform.
  - Whether the API Lambda can start and signal across namespaces with one
    platform key.
- [ ] Prototype option A in a throwaway namespace: a worker holding a
      namespace-scoped key must fail to reach a second namespace.
- [ ] If A fails: prototype option B's allowed list of RPCs and try to break
      out of it (listing or describing other workflows, polling other task
      queues, visibility queries).
- [ ] Record the result as the resolution of D5, and the result of D4's
      revisit trigger 1.
- [ ] Record the effect on the tenant runner's hardening: the Temporal key
      becomes visible to tenant code. Update the `security-review` notes.
- **Stop point:** if neither A nor B is acceptable, return to the user before
  Phase 3. Self-hosting (D4) or declarative Workflows (D1's rejected
  option) come back up for discussion.

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
- [ ] Provisioning: the per-tenant namespace or key (option A) or the proxy
      (option B), created at tenant or Workflow onboarding. Infra goes in
      `packages/infra/lib/stacks/temporal-worker-stack.ts` (owns the tenant
      runner task definition) plus secrets.
- [ ] Waking: extend the dispatcher sweep (task-queue backlog →
      `ensureTenantRunner`).
- [ ] Remove the `wait_condition` "unsupported in v1" path for the
      `WORKFLOW` kind only. The Automation driver keeps it.
- [ ] Tests: runner unit tests (pytest), API integration tests for `kind`
      and manifest validation, and infra assertion tests.

### Phase 4: Event delivery + Automations as steps (branch `feat/workflow-event-delivery`)

- [ ] `WorkflowTrigger`: add `mode` (`START` = signal-with-start,
      `DELIVER` = signal only; existing Automation triggers keep today's
      "start a new execution" behavior) and `correlationPath`, plus a
      migration. When a `DELIVER` binding is made, check that the
      event type is in the Workflow's declared `signals`.
- [ ] Dispatcher phase 1: for Workflow triggers, `START` does
      signal-with-start and `DELIVER` does a plain signal (if there's no
      running instance, record a failed delivery) on
      `wfl/<tenant>/<name>/<key>`, then call `ensureTenantRunner`. If the
      correlation key is missing from the payload, record a failed delivery;
      never silently start an execution with no key.
- [ ] SDK: add the `run_automation()` helper, an activity that calls the
      API's run path and waits for the result (see §3).
- [ ] API and SDK surfaces: list open Workflows, run a Workflow's query
      (status), cancel or terminate. Add Cedar actions for these (Cedar
      schema, `actions.ts` and persona files are hot files).
- [ ] Execution rows: give `WORKFLOW`-kind executions their own state (open
      or closed), keep them out of `TENANT_RUNNER_CONCURRENCY_CAP`, and add
      a per-tenant cap on open Workflows.
- [ ] Reconciler: stop re-scanning long-lived RUNNING `WORKFLOW` rows every
      tick (paginate, or reconcile on close events).
- [ ] tenant-web: add a Workflows section (open instances, their status from
      the query, delivered signals) next to Automations.

### Phase 5: Prove it with `nw/order_lifecycle` + discovery surfaces (branch `feat/workflows-discoverability`)

- [ ] Rewrite `nw/order_lifecycle` (in `~/repos/pegasus-workflows`) as a
      `kind="workflow"` Workflow plus small Automations.
- [ ] QA validation: fire `order.booked` (which starts the Workflow), then
      `packing.actual_date_set` (confirm the same execution received it
      through the status query), then `order.completed` (the Workflow
      finishes with its summary). A test run must also stay open for at
      least 20 minutes across a runner scale-to-zero and wake.
- [ ] Discovery surfaces (required by `CLAUDE.md`): the SDK README, the
      authoring repo's `CLAUDE.md`, an MCP `pegasus://guide/workflows`
      resource with `order_lifecycle` as the worked example, CLI `--help`,
      and OpenAPI (the openapi coverage test gates CI).
- [ ] Metrics: open Workflows per tenant, signals delivered or failed, the
      wake sweep's launches, and Temporal action volume (D4 revisit
      trigger 2).
- [ ] Publish the SDK version bump through a tag, never from a platform
      session.
- [ ] Update `plans/sdk/README.md`: mark spec 0008 superseded or shipped.

---

## 5. Risks and side effects

- **Isolation regression.** A Temporal credential reaches tenant code for the
  first time. Every Phase 3 and Phase 4 PR needs `/security-review`, and the
  user should consider running `/code-review` at a high level.
- **Non-determinism.** Tenants will write non-deterministic workflow code
  (I/O, `datetime.now()`, random numbers in `run`). The Automation driver
  papers over this today, and a durable worker won't. Rely on Temporal's
  Python workflow sandbox, which is **not a security boundary**, only a
  determinism check, and have `pegasus-workflows test` run a replay test
  before `push`.
- **Plan interaction:** `plans/todo/retire-curated-workflow-lane.md` is
  **compatible** with this. Workflows run in the tenant sandbox, not on
  `temporal-worker`. That plan's hazard 1 (one ECS cluster hosting two
  planes) now also covers the durable worker: check both plans' task
  definition edits before either lands.
- **The Cloud migration window closes at Phase 4** (see D4).
- **Hot files:** `schema.prisma` (Phases 3 and 4), Cedar schema, `actions.ts`
  and persona files (Phase 4), `router.tsx` and `AppShell.tsx` (Phases 1 and
  4). Serialize with other streams.
- **Worktree migrations:** after rebasing onto a migration, run
  `db:migrate` and `db:generate`.

## 6. Open questions

1. D5: the outcome of the isolation spike (Phase 2).
2. **Worker granularity and runtime-token lifetime.** `vnd_` runtime tokens
   are delivered per execution over stdin today. A weeks-long Workflow's
   activities (including `run_automation`) need a token that outlives that,
   and a persistent worker serving several Workflows needs one per runtime
   service account. Proposal: one worker subprocess per (Workflow ×
   artifact version), which fits the versioning design, plus a broker
   endpoint that refreshes the token. Decide in Phase 3.
3. The default and maximum Workflow lifetime, and the per-tenant cap on open
   Workflows (proposed: 90 days, 500 open).
4. Should the platform-authored workflow library (`workflows-stdlib`) gain
   Workflows as well as Automations?
5. **The tenant kill switch** (`tenants.workflowsDisabled`; admin-web labels
   it "Disable automations" since Phase 1) only refuses new _starts_. For
   Workflows, does it also block signal delivery to running instances, or
   pause timers? Decide in Phase 3 and relabel the switch to match.
