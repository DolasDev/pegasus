# Signal delivery into running durable Workflows (direct + event-routed)

- **Branch:** `feat/workflow-signal-delivery` (worktree `../pegasus-workflow-signal-delivery`)
- **Goal:** let callers and platform events deliver Temporal **signals** to a
  running durable Workflow (`kind = "workflow"`): a direct API route
  (`POST …/executions/:executionId/signal`) and EVENT triggers that route a
  domain event to the Workflow instance for a business key (`START` =
  signal-with-start, `DELIVER` = signal only). Exposed and discoverable through
  the SDK, CLI, MCP and OpenAPI.
- **Status:** APPROVED 2026-11-10 (two PRs) — PR 1 (A + C-direct, SDK 0.60.0) built 2026-11-10; PR 2 (B + C-triggers) not started.
- **Parent:** `plans/in-progress/long-running-workflows-and-automations.md`
  Phase 4 (this plan = its event-delivery slice; see "Out of scope").

## Background (read this first — enough to resume without re-reading code)

- **Signals today are declared, never delivered.** Manifest `signals = [...]`
  is validated (`apps/api/src/handlers/workflows.ts` `ManifestSchema`,
  `SIGNAL_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/`, max 50; refused on an
  Automation) and stored ONLY inside the `workflows.manifest` JSON. Nothing
  reads it after publish. The signal name is the `@workflow.signal` method
  name. The SDK mirrors it in `pegasus_workflows/manifest.py`.
- **Starting a durable Workflow:** `apps/api/src/lib/start-workflow-execution.ts`
  `startWorkflowExecution(db, opts)` → outcome object (never throws for modeled
  outcomes). Durable = `route === 'TENANT_RUNNER' && workflow.kind === 'WORKFLOW'`.
  Order: dry-run refused → kill switch (`WORKFLOWS_DISABLED`, new starts only;
  DECIDE-4 keeps a runner up for open Workflows) → MUST_FORK → namespace
  (`TENANT_MIGRATING` / `_PROVISIONING` / `_UNAVAILABLE`) → open cap
  (`OPEN_WORKFLOW_LIMIT`, 500) → daily quota → `ensureTenantRunner` → QUEUED
  row → `client.workflow.start(...)` with `workflowId = opts.temporalWorkflowId
?? wf/<tenant>/<name>/<executionId>`, `versioningOverride.pinnedTo
{deploymentName: name, buildId: artifactSha256}`, `workflowIdReusePolicy:
REJECT_DUPLICATE`, timeout `maxLifetimeDays × 86400`. Errors:
  `WorkflowExecutionAlreadyStartedError` → `ALREADY_STARTED`; "Pinned version
  … is not present in task queue" → row deleted, `WORKFLOW_VERSION_STARTING`.
  The reconciler is the ONLY writer of a durable row's terminal status.
- **Temporal client:** `withTemporalClient({tenantId, namespace}, fn)`
  (`apps/api/src/lib/temporal-client.ts`) — per-namespace cached client from
  the tenant's DB-stored namespace key; always pass the ROW's
  `temporalNamespace`. No `.signal(` / `signalWithStart` exists in `apps/api/src`
  yet. Temporal TS client 1.24: `signalWithStart` options extend
  `WorkflowOptions` (so `versioningOverride` is accepted) and take
  `signal` + `signalArgs`.
- **Pattern to copy for the route:** `POST /:id/executions/:executionId/cancel`
  in `handlers/workflows.ts` — `loadExecutionForTenant`, 409 when terminal or
  no `temporalWorkflowId`, `withTemporalClient(...).workflow.getHandle(id,
runId).cancel()`, 502 on Temporal error, 202 + row. Cedar action
  `CancelWorkflowExecution` (`permission: 'workflow:cancel_execution'`).
- **Cedar touch points (HOT FILES — serialize with other streams):**
  `apps/api/src/authz/actions.ts`, `apps/api/src/authz/cedar.schema.json`,
  `apps/api/src/authz/policies/30-personas/workflow-developer.cedar`
  (`10-tenant-admin.cedar` already permits all; `20-viewer.cedar` read-only;
  `workflow-runtime.cedar` = runtime service account), labels in
  `authz/role-options.ts`. Enforcement `requirePermission` (`middleware/rbac.ts`).
- **Triggers today:** `WorkflowTrigger` (`apps/api/prisma/schema.prisma`):
  `kind` EVENT|SCHEDULE, `eventType`, `filter`, `cronExpression`, `enabled`,
  `dryRun`. Created via `POST /workflows/:id/triggers` (`CreateTriggerBody`,
  `ManageWorkflowTriggers`; dry-run refused for durable). Dispatcher
  `apps/api/src/lambda-dispatch-workflow-triggers.ts` (every minute + kicks,
  reserved concurrency 1): `dispatchEvents` matches enabled EVENT triggers by
  `(tenantId, eventType)` + `matchesTriggerFilter`, then `fireTrigger` →
  `startWorkflowExecution` with id `wf/<tenant>/<name>/trg/<triggerId>/<eventId>`
  and input envelope `{domainEventId, eventType, occurredAt, payload}`.
  Outcomes are logged skips + metrics, no table (`WORKFLOW_VERSION_STARTING`
  parks the event ≤ 24 h; `TENANT_MIGRATING` defers; `WORKFLOWS_DISABLED`
  skips). `dispatchedAt` is stamped after ALL of an event's triggers — a crash
  mid-event re-dispatches it (so delivery is at-least-once).
- **Event type names contain dots** (`sms.received`, `quote.accepted`,
  `trip.accepted`, `pegii.*`) and can't be signal names (regex above).
- **History timeline:** `summarizeWorkflowHistory` (`lib/temporal-client.ts`)
  maps attribute keys via `HISTORY_EVENT_ATTR_TYPES`; unmapped ones print
  `Unknown` (the CLI timeline showed many). Signaled events are unmapped today.
- **SDK:** `pegasus_workflows/api.py` (`run_workflow`, `cancel_execution`,
  `retry_execution`; typed errors via `_raise_for_tenant_namespace` /
  `_raise_for_status`); every new `PegasusClient` method must be classified in
  `pegasus_workflows/testing/__init__.py` `_IGNORED` (drift check). CLI: Typer,
  `cli/executions.py` has only `list`/`show` (docstring says cancel/retry are
  UI-only in v1). MCP: `cli/mcp_server.py` `resource_guide_authoring`
  (durable section says signals "not available yet"),
  `resource_reference_manifest`; `pegasus://reference/api` introspects
  `PegasusClient` docstrings. README "Durable Workflows" section says sending a
  signal "is not available yet"; README intro (~:9-11, ~:144-146) still says
  Workflows don't exist. SDK was 0.58.0 on 2026-11-09 — **verify
  `pyproject.toml` on the branch and bump the next minor** (PR 1, then PR 2).
- **OpenAPI:** hand-written `apps/api/src/lib/openapi-spec.ts` (run :~2925,
  cancel :~2964, retry :~2977; ~:949 still calls Workflows "upcoming").
  `openapi-spec.coverage.test.ts` only gates GET routes — POSTs are added by
  hand, so don't forget them.

## Decisions (settled — don't relitigate)

1. **Scope = direct route + event-routed signals** (user, 2026-11-09).
2. **Kill switch does NOT block signals** (user, 2026-11-09; consistent with
   DECIDE-4: the switch stops new runs, open Workflows keep running). It DOES
   block a `START` binding from CREATING a new instance (that is a new run);
   if the instance is already open, the signal flows.
3. **Trigger carries an explicit `signalName`** (deviation from the master
   plan's "event type is the signal name"): event types contain dots and
   can't be signal names. Required for `START`/`DELIVER`; must be in the
   Workflow's declared `signals` (checked at trigger create/update AND at
   dispatch, since a later version may drop it).
4. **Trigger `mode`:** new enum `WorkflowTriggerMode { NEW, START, DELIVER }`,
   default `NEW` = today's behavior (each event starts a new execution) for
   every existing row and every Automation trigger. `START`/`DELIVER` only for
   EVENT triggers on a `WORKFLOW`-kind target.
5. **Correlation:** `correlationPath` (dot path into the event ENVELOPE, e.g.
   `payload.orderId`), required for `START`/`DELIVER`. Value must be a string
   or integer; normalized to string; must match `^[A-Za-z0-9._:-]{1,128}$`.
   Temporal id: `wfl/<tenantId>/<workflowName>/<key>` (cannot collide with
   `wf/…`). Missing/invalid key → failed delivery, never a start.
6. **Finding the open instance:** DB lookup of a QUEUED/RUNNING row with
   `temporal_workflow_id = wfl/...` (the dispatcher is serialized —
   reserved concurrency 1 — and the direct `run` route can't mint `wfl/` ids).
   Open → plain signal on that row. None → `START`: `startWorkflowExecution`
   with `temporalWorkflowId = wfl/...` and a new `startSignal {name, args}`
   option that switches `workflow.start` to `workflow.signalWithStart` (same
   pin, timeout, memo, reuse policy); `DELIVER`: failed delivery
   (`NO_OPEN_INSTANCE`). Keep `REJECT_DUPLICATE`: a key whose instance already
   CLOSED is not restarted (`ALREADY_STARTED` → failed delivery
   `INSTANCE_CLOSED`). Revisit only if a real Workflow needs re-runs per key.
   **The DB can lag Temporal** (a `wfl/` row marked FAILED although the start
   went through; reconciler lag). `signalWithStart` signals a RUNNING
   instance regardless of reuse policy and the TS client has no "started"
   flag — it returns a handle with `signaledRunId`. So after signalWithStart:
   if another row already has `temporalRunId = signaledRunId`, DELETE the new
   QUEUED row and return outcome `SIGNALLED_EXISTING` (no double row, no
   double quota). Test it.
7. **One shared signal helper** `signalDurableExecution(db, {execution,
signalName, args})` in a new `apps/api/src/lib/signal-workflow-execution.ts`,
   used by the route AND the dispatcher: refuses non-durable / terminal / no
   Temporal id; `withTemporalClient(row namespace)` →
   `getHandle(temporalWorkflowId, undefined, {firstExecutionRunId:
temporalRunId}).signal(name, ...args)` — signal by workflow id (the
   CURRENT run), NOT the row's run id: a Workflow that continues-as-new gets
   a new run id and a run-pinned signal would fail forever;
   `firstExecutionRunId` keeps it chain-safe (never a different instance
   reusing the id). Verify the option name in TS client 1.24.
   `WorkflowNotFoundError` (or closed) → `NOT_RUNNING`; then
   `ensureTenantRunner(tenantId)` (cheap; covers a runner that just exited).
   **No namespace-migration defer needed:** durable Workflows live only in
   the tenant's own namespace; a REVERTING cutover waits until nothing is
   open there and the key stays until then, so the row's namespace is always
   signallable while the row is open. (A START for a NEW key during
   DRAINING/REVERTING already gets `TENANT_MIGRATING` → deferred.)
8. **Signal arguments:** direct route body `{ name: string, payload?: JSON }`
   → exactly one arg when `payload` is present, none otherwise. Event-routed:
   always one arg = the envelope `{domainEventId, eventType, occurredAt,
payload}`. Body cap 128 KiB (413 `SIGNAL_PAYLOAD_TOO_LARGE`).
9. **Delivery is at-least-once** (dispatcher re-dispatch; client retries).
   Documented in README/MCP: dedupe on `domainEventId` in the handler.
10. **Failed deliveries = logs + metrics** like today's skips
    (`Pegasus/Workflows SignalDelivered`, `SignalDeliveryFailed{Reason}`) — no
    new table in this plan. The event is marked dispatched (a failed delivery
    is final, not retried), EXCEPT `WORKFLOW_VERSION_STARTING` (park, as today)
    and `TENANT_MIGRATING` (defer, as today).
    **Signals cost nothing against quotas:** a plain signal is not an
    execution — no daily-quota or open-cap charge. Only a START that creates
    a new instance goes through `startWorkflowExecution` and is charged.
11. **Authz:** new Cedar action `SignalWorkflowExecution`
    (`permission: 'workflow:signal_execution'`, resource `Workflow`), granted to
    workflow-developer (tenant-admin already has all). NOT to viewer, NOT to the
    runtime service account (Workflow→Workflow signalling is a later call).

12. **Two PRs, one worktree each** — see "Delivery" below.

## Delivery

- **PR 1 (this worktree, `feat/workflow-signal-delivery`):** Checklist A +
  C-direct (SDK `signal_execution`, CLI `executions signal`, MCP/README/
  OpenAPI for the direct route) + D-verify, SDK 0.60.0 — this plan file lands
  with it (keep it in `plans/in-progress/`, NOT archived: PR 2 continues it).
- **PR 2 (fresh worktree off `main` after PR 1 merges,
  `feat/workflow-signal-triggers`):** Checklist B + C-triggers + its
  acceptance, SDK 0.61.0; archives this plan.
- Each PR touches hot files (A: Cedar; B: `schema.prisma`) — landing them
  serially is the point of the split.

## Out of scope (stays in the parent plan's Phase 4/5)

`run_automation()` helper; list open Workflows / query / terminate routes;
tenant-web Workflows section; reconciler pagination; `nw/order_lifecycle`
rewrite + QA scenario; a persisted delivery-log table / UI.

## Checklist

### A. Shared signal helper + direct route

- [x] `lib/signal-workflow-execution.ts` (decision 7) + unit tests (mock
      `withTemporalClient` as `start-workflow-execution.test.ts` does): happy
      path signals with the row's namespace + run id; refuses Automation rows
      (`NOT_DURABLE`), terminal rows, no Temporal id; maps
      `WorkflowNotFoundError` → `NOT_RUNNING`; calls `ensureTenantRunner`.
- [x] Cedar: `SignalWorkflowExecution` in `authz/actions.ts`,
      `cedar.schema.json`, `workflow-developer.cedar`, `role-options.ts` label
      if listed. Persona/authz tests that enumerate actions.
- [x] Route `POST /:id/executions/:executionId/signal` in
      `handlers/workflows.ts` (copy cancel): body `{name, payload?}` (zod;
      name regex; 128 KiB cap → 413); 400 `SIGNAL_NOT_DECLARED` when `name` is
      not in that execution's workflow-version manifest `signals`; 409
      `EXECUTION_NOT_SIGNALLABLE` (terminal / not durable / not running in
      Temporal); 502 `TEMPORAL_SIGNAL_FAILED`; 202 + execution row. NOT gated
      by the kill switch. Tests in `workflows.test.ts` next to cancel (viewer
      403, developer 202, each refusal).
- [x] History: map `workflowExecutionSignaledEventAttributes` →
      `WorkflowExecutionSignaled` (+ `signalName`) in
      `HISTORY_EVENT_ATTR_TYPES` / `summarizeWorkflowHistory`; while there, map
      the other common unmapped types that printed `Unknown`
      (WorkflowTaskScheduled/Started/Completed, TimerStarted is mapped).
- [x] OpenAPI: document the signal route (+ fix the "upcoming" Workflows line).

### B. Event-routed signals (triggers + dispatcher)

- [ ] Migration: `WorkflowTriggerMode` enum + `mode` (default `NEW`),
      `correlation_path`, `signal_name` on `workflow_triggers`; index on
      `workflow_executions (tenant_id, temporal_workflow_id)` for the open-
      instance lookup. `schema.prisma` is a HOT FILE.
- [ ] Trigger API: `CreateTriggerBody` / update accept `mode`,
      `correlationPath`, `signalName`; validate (decisions 3-5): START/DELIVER
      only for EVENT + WORKFLOW kind; both fields required; signal declared;
      path syntax. Responses + OpenAPI include the fields. Tests.
- [ ] `startWorkflowExecution`: `startSignal` option → `signalWithStart`
      (same pin/timeout/memo/reuse). Tests incl. pinned-version-not-present →
      `WORKFLOW_VERSION_STARTING` on the signal-with-start path, and the
      `signaledRunId` already-has-a-row case → new row deleted,
      `SIGNALLED_EXISTING` (decision 6).
- [ ] Dispatcher: for `mode` START/DELIVER — extract key (decision 5) →
      lookup open `wfl/` row (decision 6) → `signalDurableExecution` or START
      via `startWorkflowExecution({temporalWorkflowId, startSignal})`; re-check
      the signal is declared on the target version; outcomes → metrics + logs
      (decision 10); kill switch per decision 2. Tests in
      `__tests__/lambda-dispatch-workflow-triggers.test.ts`: START creates then
      a second event signals the same instance; DELIVER with no instance fails;
      missing/invalid key; undeclared signal; kill switch on (open → signals,
      none → skipped); version starting parks; NEW mode unchanged.
- [ ] Infra: metric names only (no new resources expected) — confirm nothing
      in `packages/infra` needs the new metrics/alarms; add an alarm only if
      cheap and obviously useful.

### C. SDK 0.60.0 + discovery surfaces

- [ ] `PegasusClient.signal_execution(workflow_id, execution_id, name,
payload=None)` (+ classify in `testing/__init__.py`); typed errors reuse
      `PegasusApiError` codes. `create_trigger` / `update_trigger` gain `mode`,
      `correlation_path`, `signal_name`. Tests (`tests/test_api.py`,
      `tests/test_durable_workflows.py`, `tests/test_api_triggers.py`).
- [ ] **(PR 1 half DONE: `executions signal` + `show` prints `signal: <name>`;
      PR 2: trigger flags)** CLI: `pegasus-workflows executions signal <workflow> <execution-id>
--name proceed [--payload JSON]`; `schedule`/trigger CLI (find where EVENT
      triggers are created) gains `--mode/--correlation-path/--signal-name`.
      Update the executions docstring ("cancel/retry UI-only" — signal is
      CLI-able now). Tests.
- [ ] **(PR 1 half DONE: direct delivery documented; PR 2: event-routed +
      `domainEventId` dedupe)** MCP: `resource_guide_authoring` durable section (signals now
      deliverable, both ways, at-least-once + dedupe on `domainEventId`,
      handler signature `def name(self, payload: dict | None = None)`),
      `resource_reference_manifest` `signals` text.
- [ ] **(PR 1 half DONE: intro fixed, "Sending a signal", CHANGELOG 0.60.0,
      bump; PR 2: triggers section, 0.61.0)** README: durable section + triggers section; fix the stale intro lines.
      CHANGELOG 0.60.0. `pyproject.toml` + `uv.lock` bump.
- [ ] **(DECISIONS entry "Signals reach a durable Workflow by workflow id…"
      added in PR 1 — PR 2 extends it with REJECT_DUPLICATE per key)** GOTCHAS/DECISIONS: decision 3 (explicit signalName), 6 (REJECT_DUPLICATE
      per key), 9 (at-least-once) as a DECISIONS entry.

### D. Verify + land

- [ ] `npm run typecheck`, API tests (`apps/api`, Docker Postgres), SDK
      `uv run pytest` + `ruff check`, `openapi` coverage test.
- [ ] `/workstream-finish` (self-review incl. `/security-review`: authz +
      migration + workflows). One PR PER DELIVERY STEP (see Delivery), merge queue.
- [ ] After each merge + deploy: tag the new SDK version (`sdk-python-v0.60.0` for PR 1) on the real merge commit
      → PyPI → authoring repo `~/repos/pegasus-workflows/CLAUDE.md` note
      (commit ONLY that hunk — that file has had others' uncommitted edits).
- [ ] Staging acceptance on AVP Smoke (`--profile avp-smoke`, staging AWS
      `dolas-pegasus-staging`): publish a scratch Workflow declaring
      `signals = ["proceed", "note"]` that waits on `proceed` (no timeout) and
      records `note` payloads; (1) direct `executions signal … --name proceed`
      completes it; (2) undeclared name → 400; (3) EVENT trigger START on a
      test event with `correlationPath` → instance `wfl/…/<key>` created; a
      second event, same key → same instance signalled (no new row); (4)
      DELIVER with an unknown key → `SignalDeliveryFailed{NO_OPEN_INSTANCE}`;
      (5) kill switch ON (user flips it in admin-web): direct signal still
      delivered; START for a NEW key skipped. Retire the scratch Workflow
      after. Pick the test event type from `DOMAIN_EVENT_TYPES` /
      custom tenant events that can be emitted on staging on demand — find
      one before starting (e.g. a custom `TenantEventType`). **Fallback:**
      insert a `DomainEvent` outbox row on staging with `psql` (DB URL from
      the reconcile Lambda env, see `plans/todo/durable-workflows-3c-followups.md`)
      and kick/wait for the dispatcher. (PR 2's acceptance; PR 1's is items
      1, 2 and the kill-switch half of 5.)

## Files

**Modify:** `apps/api/src/handlers/workflows.ts`,
`apps/api/src/lib/start-workflow-execution.ts`,
`apps/api/src/lambda-dispatch-workflow-triggers.ts`,
`apps/api/src/lib/temporal-client.ts`, `apps/api/src/lib/openapi-spec.ts`,
`apps/api/prisma/schema.prisma` (+ new migration),
`apps/api/src/authz/actions.ts`, `apps/api/src/authz/cedar.schema.json`,
`apps/api/src/authz/policies/30-personas/workflow-developer.cedar`,
`apps/api/src/authz/role-options.ts` (if actions are listed), trigger
repository (find: `workflow-trigger.repository.ts` or similar), and tests next
to each; `packages/workflows-sdk-python/{pegasus_workflows/api.py,
pegasus_workflows/testing/__init__.py, pegasus_workflows/cli/executions.py,
pegasus_workflows/cli/schedule.py (or wherever EVENT triggers are created),
pegasus_workflows/cli/mcp_server.py, README.md, CHANGELOG.md, pyproject.toml,
uv.lock, tests/…}`; `dolas/agents/project/DECISIONS.md`, `GOTCHAS.md` if a
trap turns up.
**Create:** `apps/api/src/lib/signal-workflow-execution.ts` (+ test), the
Prisma migration.

## Risks / side effects

- **Hot files:** `schema.prisma`, `cedar.schema.json`, `actions.ts`, persona
  `.cedar`. Check `/workstream-board` for other streams touching them; rebase
  before finishing.
- **Existing triggers must behave exactly as before** (`mode` default `NEW`);
  the dispatcher change is gated on `mode`.
- **Signal-with-start + pinning:** verify on the dev server/staging that the
  pinned version applies to the started run; the not-registered error string
  may differ on the signalWithStart path — test it.
- **Reconciler:** a `wfl/` row is an ordinary durable row (it closes through
  the WORKFLOW lane) — confirm nothing keys on the `wf/` prefix
  (`grep -rn "'wf/" apps/api/src`).
- **Event payload in a signal is tenant data** crossing into tenant code —
  same trust boundary as today's trigger input; nothing new, but don't add
  platform-internal fields to the envelope.
- **Temporal limits:** 10,000 signals per execution, 2 MB payload; our 128 KiB
  cap keeps us well inside.

## Resume here

**PR 1 built (2026-11-10)** on `feat/workflow-signal-delivery`: Checklist A
complete; C-direct done (SDK `signal_execution`, CLI `executions signal`, MCP
guide + manifest reference, README "Sending a signal" + stale intro fixed,
CHANGELOG/pyproject/uv.lock 0.60.0, DECISIONS entry). Verified: `npm run
typecheck`, `npm run lint`, all `apps/api` tests (4976), SDK `pytest` (572) +
`ruff check`. History mapping also labels WorkflowTask*/CancelRequested/
Marker/TimerCanceled events.

Next: land PR 1 (`/workstream-finish`), then tag `sdk-python-v0.60.0` on the
real merge commit, add the authoring-repo `CLAUDE.md` note, and run PR 1's
staging acceptance (D items 1, 2 and the kill-switch half of 5). (Atlas-fetch #942
landed first and took SDK 0.59.0, so PR 1 is 0.60.0 and PR 2 is 0.61.0.) Then PR 2 in a fresh worktree
(`feat/workflow-signal-triggers`) — Checklist B + the C-trigger halves, SDK
0.61.0, archive this plan. Never commit `apps/e2e/.env.test` /
`package-lock.json` (local provisioning artifacts).
