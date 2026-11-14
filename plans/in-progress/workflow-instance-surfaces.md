# Open Workflows: list, query, cancel, terminate

- **Branch:** `feat/workflow-instance-surfaces` (worktree `../pegasus-workflow-instance-surfaces`).
  All changes stay on this branch; plan + code land in one PR via the merge queue.
- **Goal:** tenants (UI, SDK, CLI, their AI agents) can see their open durable
  Workflows tenant-wide, ask one for its status through a Temporal query,
  and stop one, cooperatively (cancel) or forcibly (terminate). This is the
  Phase 4 item "API and SDK surfaces: list open Workflows, run a Workflow's
  query (status), cancel or terminate" in
  `plans/in-progress/long-running-workflows-and-automations.md`. It also
  supplies the "open an execution by id alone" route that the tenant-web
  Workflows section (the next item) needs to link a step's badge to its parent.
- **Status:** Approved 2026-11-13 (all four decisions → the recommended option).

## What exists today (verified on `main` @ `cb273cfd`)

- `GET /workflows/:id/executions[/:executionId]` lists and reads executions,
  but only for **one version row** (`:id` is a Workflow row id). A durable
  Workflow's open instances span every version of its name. There is no
  tenant-wide list, and no route that opens an execution by id alone.
- `POST /workflows/:id/executions/:executionId/cancel` (Cedar
  `CancelWorkflowExecution`, granted to `workflow_developer`) is
  cooperative and returns 202. **Bug:** `requestCancelResponse` addresses
  `getHandle(temporalWorkflowId, temporalRunId)`, a run-pinned handle. A
  durable Workflow that has continued-as-new has closed that run, so cancel
  fails for exactly the long-lived Workflows that need it. The signal helper
  already does it right with `{ firstExecutionRunId }`.
- No terminate route. The reconciler maps Temporal `TERMINATED` → `CANCELLED`
  (`lambda-reconcile-workflow-executions.ts`, `mapTemporalStatus`).
- No query route, and the manifest has no `queries` declaration (only
  `signals`).
- Temporal workflow ids: event-routed instances are
  `wfl/<tenant>/<name>/<key>`; a manually `/run` durable Workflow is
  `wf/<tenant>/<name>/<executionId>`. So a correlation key exists only for
  `wfl/` ids.
- The tenant runner idle-exits after 600 s (`RUNNER_IDLE_TIMEOUT_SECONDS`).
  A Temporal query needs a live worker to answer, so **a query against a
  sleeping tenant has no one to answer it**. The API Lambda's timeout behind
  API Gateway is 29 s; a runner cold start is 30–60 s.
- SDK `PegasusClient` has `list_executions`, `get_execution`,
  `cancel_execution`, `signal_execution`, `retry_execution`. The CLI
  `executions` group has list / show / signal; its module docstring says
  cancel/retry "stay UI-only".

## Decisions (Steve, 2026-11-13)

1. **Query when the runner is asleep: wake + 503 retry.** The route calls
   `ensureTenantRunner` and tries the query with a short deadline (~8 s).
   If no worker answers, it returns 503 `WORKFLOW_WORKER_STARTING` with
   `Retry-After: 15`. The SDK's `query_execution` retries that for up to
   90 s (the existing "not now" idiom). The CLI does the same.
   _Alternatives:_ wait in the handler (capped by API Gateway's 29 s, which is
   shorter than a cold start, so it mostly fails anyway); or, in addition, a
   worker-free status: an SDK `set_status(dict)` that writes a Temporal memo,
   read via `describe` with no worker. That makes list views cheap, but
   every update is a history event.
2. **Declare queries in the manifest: yes.** Add
   `queries = [...]`, validated exactly like `signals` (Python identifier,
   ≤ 50, Workflow kind only), and refuse an undeclared name with 422 before
   anything touches Temporal. That keeps the discovery surface honest (the
   UI and agents can list a Workflow's queries) and mirrors signals.
3. **Terminate: its own action, granted to developers.** A new Cedar action
   `TerminateWorkflowExecution`, granted to `workflow_developer` (tenant_admin
   gets it implicitly), and not to viewer or `workflow_runtime`. It requires
   a `reason` (≤ 500 chars) that is passed to Temporal and recorded. It is
   allowed on both kinds (an Automation's stuck run as well).
   **Cascade:** terminating (or cancelling) a durable Workflow also cancels
   its open step Automations (`parentExecutionId` = this row). A terminated
   Workflow gives `run_automation`'s activity no cancel hook, so without the
   cascade a step runs on until its own timeout.
4. **Status of a terminated run: CANCELLED + message.** Keep `CANCELLED` and set
   `errorMessage = "Terminated: <reason>"`. No enum migration, and every
   consumer that switches on status keeps working. _Alternative:_ add
   `TERMINATED` to `WorkflowExecutionStatus` (migration + reconciler +
   tenant-web + SDK typing).

Settled defaults (not asked; say if you disagree):

- **Routes** go on a new router mounted at `/api/v1/workflow-executions`
  (like `automation-steps.ts`, so nothing collides with `/workflows/:id`).
- **Kill switch:** list / get / query are reads and are never gated. Cancel and
  terminate are allowed under the switch (they close things, which is what
  an operator flipping it wants), consistent with DECIDE-4 for signals.
- **No new grants on `workflow_runtime`.** A Workflow can't query or terminate
  other Workflows (the steps-work rule).
- **CLI** gains `executions open`, `executions query`, `executions cancel`
  and `executions terminate` (the SDK discoverability rule in CLAUDE.md:
  anything reachable in the API must be reachable through the SDK).

## Design

### API: new router `apps/api/src/handlers/workflow-executions.ts` at `/api/v1/workflow-executions`

Tenant-scoped on every route (`tenantId` from context; 404 for another
tenant's row, never 403).

- `GET /` (`ReadWorkflow`): a tenant-wide list, newest first, cursor-paged
  like `/:id/executions` (`(queuedAt, id)` cursor, `limit` ≤ max).
  - Filters: `kind=WORKFLOW|AUTOMATION` (default `WORKFLOW`),
    `open=true` (QUEUED|RUNNING; default true when kind=WORKFLOW), `name`,
    `correlationKey` (matches `temporalWorkflowId = wfl/<tenant>/<name>/<key>`
    via the existing `(tenantId, temporalWorkflowId)` index; requires `name`).
  - Each row is `WorkflowExecutionResponse` plus `{ workflowName,
workflowVersion, kind, correlationKey | null }`. The correlation key is
    parsed from a `wfl/` id and is null for `wf/` ids.
  - Needs a `kind` filter on the join to `workflows`. Check the plan with
    `EXPLAIN` on a seeded DB; add an index only if it's needed.
- `GET /:executionId` (`ReadWorkflow`): one execution by id alone, with the
  same enriched shape plus `parentExecutionId`, and, for a Workflow, its
  declared `signals` and `queries` (so the UI and agents know what they can
  send and ask).
- `POST /:executionId/query` (`QueryWorkflowExecution`, decision 1) with
  body `{ name, args?: unknown[] }`: Workflow kind only (422 otherwise);
  declared name only (422, decision 2); open rows only (409
  `EXECUTION_NOT_QUERYABLE`).
  - Addressing is the signal helper's: `getHandle(id, undefined,
{ firstExecutionRunId })`.
  - Ensure the runner, then query with a deadline. No answer → 503
    `WORKFLOW_WORKER_STARTING` + `Retry-After`. A query handler that raised →
    422 `QUERY_FAILED` with its message. Result is capped (e.g. 256 KiB → 413
    `QUERY_RESULT_TOO_LARGE`).
  - First, **verify against the dev server what the TS client actually does
    with no poller on the queue** (a fast "no poller" error, or a hang until
    the RPC deadline), and write the finding into GOTCHAS.md.
- `POST /:executionId/cancel` (`CancelWorkflowExecution`): the by-id twin of
  the existing route, calling the same (fixed) `requestCancelResponse` plus
  the step cascade.
- `POST /:executionId/terminate` (`TerminateWorkflowExecution`, decision 3)
  with body `{ reason }`: terminal → 409; not started → 409; Temporal
  `terminate(reason)` via the `firstExecutionRunId` handle; then the cascade.
  Returns 202 with the row (the reconciler closes it, as with cancel).
  - Should terminate also write the row closed immediately, so the UI doesn't
    wait up to a reconcile tick? Lean yes: the handler marks it
    CANCELLED/`Terminated: …` once Temporal accepts. Confirm the reconciler
    tolerates an already-terminal row.

### Fixes to existing code

- `requestCancelResponse`: switch to `{ firstExecutionRunId }` addressing.
  Write a test that fails first (a run-pinned handle against a
  continued-as-new id).
- Extract one helper `durableHandle(client, execution)` used by signal, cancel,
  terminate and query, so the addressing can't drift again.

### Manifest (`ManifestSchema` + SDK `manifest.py`)

- `queries: string[]` (identifier, ≤ 64 chars, ≤ 50 entries, Workflow kind
  only), the same validation as `signals`. Optional; omitted means "declares
  none", and the query route refuses everything.

### Cedar (hot files: serialize)

- `cedar.schema.json` + `actions.ts`: `QueryWorkflowExecution`,
  `TerminateWorkflowExecution`.
- `workflow-developer.cedar`: both. `20-viewer.cedar`: `QueryWorkflowExecution`?
  A query is read-only by contract but runs tenant code. Lean: **developer
  only** for now, so viewers see the list and status but can't wake runners.
- Policy tests for each grant and each non-grant (viewer, `workflow_runtime`).

### SDK (`packages/workflows-sdk-python`), 0.66.0

- `PegasusClient`: `list_open_workflows(name=None, correlation_key=None, …)`,
  `get_execution_by_id`, `query_execution(execution_id, name, *args,
wait=timedelta(seconds=90))` (retries 503 `WORKFLOW_WORKER_STARTING`),
  `cancel_execution_by_id`, `terminate_execution(execution_id, reason)`.
  Matching `testing.FakeClient` stubs.
- Manifest `queries`, and `pegasus-workflows package` warns when a
  `@workflow.query` method isn't declared (mirror any existing signals check;
  if none exists, skip the warning).
- CLI `executions open | query | cancel | terminate` (terminate asks for
  confirmation unless `--yes`). Update the module docstring that says
  "UI-only".
- README section "Inspecting and stopping open Workflows"; MCP guide
  resource text; CHANGELOG.
- Re-check `git tag -l 'sdk-python-v*'` and `origin/main`'s `pyproject.toml`
  right before the PR.

### OpenAPI

- Register all five routes plus the manifest `queries` field; the coverage
  test gates CI.

### Out of scope

- The tenant-web Workflows section (the next Phase 4 item). This PR only
  supplies the routes it will use.
- A worker-free status memo (decision 1's alternative; not picked).
- Authoring repo `~/repos/pegasus-workflows/CLAUDE.md`: a note after 0.66.0
  is on PyPI, separate repo, my hunk only.

## Checklist

- [ ] Probe: TS client query with no poller (dev server); record in GOTCHAS.md
- [ ] `durableHandle` helper + cancel `firstExecutionRunId` fix (failing test first)
- [ ] Manifest `queries` (API schema + SDK) + publish-time validation tests
- [ ] Cedar: two actions, persona grants, policy tests
- [ ] `workflow-executions.ts` router + mount + real-Postgres integration tests:
      tenant isolation (404), kind/open/name/correlationKey filters, cursor
      paging, by-id read, query (undeclared → 422, closed → 409, Automation →
      422, no worker → 503 + Retry-After, handler error → 422), cancel by id,
      terminate (reason required, terminal → 409, cascade cancels open steps,
      row closed), kill switch ON doesn't block any of them
- [ ] Reconciler: an already-terminal row is left alone (test)
- [ ] OpenAPI registration
- [ ] SDK client + FakeClient + CLI + README + MCP + CHANGELOG, bump 0.66.0, pytest
- [ ] Runner: no change expected (queries are served by the existing worker). Confirm.
- [ ] `/security-review` (parent plan §5: every Phase 4 PR)
- [ ] Parent plan: tick the Phase 4 checklist item; update "Resume here"
- [ ] DECISIONS.md entry; GOTCHAS.md (query-with-no-poller finding)
- [ ] After merge: tag `sdk-python-v0.66.0`; staging acceptance on AVP Smoke
      (list → query while the runner sleeps → 503 then answer → terminate →
      the step cascade)

## Side effects / risks

- Hot files: `cedar.schema.json`, `actions.ts`, persona `.cedar`,
  `schema.prisma` (only if decision 4 picks the enum), `openapi-spec.ts`.
  Serialize with other streams.
- Query runs tenant code inside the worker. Temporal enforces read-only
  (a query can't mutate workflow state), but a slow or looping handler holds
  a workflow-task slot. The deadline bounds the API side only.
- Waking a runner on every query costs money if a UI polls. The tenant-web
  item must not poll queries on a timer; that's a constraint on the next PR.
