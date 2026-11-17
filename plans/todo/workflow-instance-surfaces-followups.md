# Open-Workflow surfaces (list / query / cancel / terminate): follow-ups after it ships

- **Status:** IN PROGRESS. Release and staging acceptance DONE (2026-11-16). Left:
  the authoring-repo note, and the post-deploy re-check of the Automation-cancel fix
  (#970, merged `9b3c0bef` 2026-11-17).
- **Branch:** none for the release/docs steps; a fix branch only if acceptance
  fails.
- **Goal:** finish what the `feat/workflow-instance-surfaces` PR couldn't do
  from inside the repo. Background: the archived plan
  `plans/completed/f4a4de71-workflow-instance-surfaces.md` (design, decisions,
  deviations) and DECISIONS.md "Open Workflows are listed, queried, cancelled
  and terminated by execution id alone".
- **Written:** 2026-11-14 in that PR.

## Checklist

- [x] **Post-deploy:** Deploy green for api (no migration in this PR). AVP
      policies re-synced (two new actions: `QueryWorkflowExecution`,
      `TerminateWorkflowExecution`). authz-smoke green after merge.
      **Done 2026-11-14:** #963 merged as `e1c71634`; Deploy run 43540365969 green.
- [x] **Publish SDK 0.66.0:** tag `sdk-python-v0.66.0` on the REAL merge commit
      (guard against an empty mergeCommit), wait for the release run and PyPI.
      Re-check `git tag -l 'sdk-python-v*'` first: versions collide often.
      **Done 2026-11-14:** tag on `e1c71634`; release run 43555462247 green; 0.66.0 on PyPI.
- [ ] **Authoring repo** (`~/repos/pegasus-workflows/CLAUDE.md`, separate repo),
      only after 0.66.0 is on PyPI: a short note covering `queries = [...]`,
      `list_workflow_executions` / `query_execution` / `terminate_execution`,
      and the CLI `executions open | query | cancel | terminate`. Pin 0.66.0.
      Commit only that hunk.
- [x] **Staging acceptance (AVP Smoke, scratch project outside the repo,
      always `name@version`):**
  - a Workflow with `queries = ["status"]` and a `@workflow.query def status`;
    start one by hand and one through an event-routed START trigger;
  - `executions open` lists both, the keyed one with its `correlationKey`;
    `--name … --key …` finds exactly the keyed one;
  - wait for the runner to idle-exit (10 min), then `executions query … --name
status`: the first reply is 503 `WORKFLOW_WORKER_STARTING`, the CLI waits,
    the answer arrives within `--wait` (record how long the cold start took);
  - an undeclared query → 422 `QUERY_NOT_DECLARED`, listing `status`;
  - a Workflow that continues-as-new, then `executions cancel` → it reaches
    CANCELLED (the `firstExecutionRunId` fix, live);
  - a Workflow waiting on a `run_automation` step whose Automation sleeps:
    `executions terminate … --reason accept --yes` → the parent row is
    CANCELLED "Terminated: accept" at once, and the step's row turns CANCELLED;
  - a `viewer` key → 403 on query and terminate, 200 on `open`;
  - afterwards: retire the scratch rows, verify the kill switch is OFF.
    **Done 2026-11-16: all PASS except the viewer bullet (not run live) — see the
    Acceptance log. It found that cancelling an Automation never stopped its code
    (pre-existing); fixed in #970 (`9b3c0bef`).**
- [ ] **Post-deploy re-check of #970** (cancelling an Automation stops its code), on
      AVP Smoke: run a sleeping Automation (`accept_wis_sleeper`-style, 300 s), then
      `executions cancel <id>` → within ~30 s the row is `CANCELLED` with "Cancelled
      while running; the Automation's process was stopped", and it stays CANCELLED
      (no later COMPLETED write-back). Repeat with a Workflow `run_automation` step +
      `executions terminate`: the step row ends CANCELLED too.
- [ ] **Next Phase 4 item:** the tenant-web Workflows section. It can now link a
      step's "Workflow step" badge to its parent via `GET
/workflow-executions/:id`. **Constraint:** don't poll queries on a timer
      (each query wakes the runner); run one on open / on refresh.

## Acceptance log (staging AVP Smoke, 2026-11-16)

Tenant `4b2e0267-c597-451e-a367-771dfac52fba`; CLI/SDK 0.66.0, profile `avp-smoke`.
Scratch project (outside the repo): durable `accept_wis@0.1.0`
(`9fccbaa1-3aaf-4552-9d83-971e368e0169`, `signals = ["order_event", "finish"]`,
`queries = ["status"]`; modes wait / continue-as-new / step) and Automation
`accept_wis_sleeper@0.1.0` (`f15553be-…`, sleeps 300 s). START trigger
`fb12012d-…` on `pegasus_event.received`, `correlationPath = "payload.eventType"`,
filter `eventPublisher = accept-wis` (custom events are OFF on staging).

- **List + key — PASS.** 19:56:23Z manual run `a85cd21f` (`wf/…`); 19:56:26Z
  emit `K1` → 19:57:03Z `e0779392` (`wfl/…/accept_wis/K1`). `executions open` lists
  both, `KEY` = `K1` on the event-started one and `-` on the manual one;
  `--name accept_wis --key K1` returns only `e0779392`.
- **Query (warm) — PASS.** `executions query e0779392 --name status` → `{stage:
"waiting (gen 0)", events: 1, gen: 0}` in 0.66 s (`events: 1` = the
  signal-with-start delivery). Undeclared `secrets` → 422 `QUERY_NOT_DECLARED`
  "(declared: status)". `GET /workflow-executions/a85cd21f` → `kind: WORKFLOW`,
  `correlationKey: null`, `signals`, `queries`.
- **Cancel after continue-as-new — PASS.** `b0306453` (`mode: can`) continued as new
  at ~19:57:50Z; the query reached the new run (`gen: 1`). 19:57:55Z `executions
cancel` → accepted; row CANCELLED at 20:02:39Z (reconciler). Before #963 this
  cancel addressed the closed first run and failed.
- **Terminate — PASS for #963; found a pre-existing gap.** `7ec5db38` (`mode: step`)
  started step `8bd2d8e1` (trigger WORKFLOW, `parentExecutionId` set). 19:58:08Z
  `executions terminate --reason accept --yes` → parent CANCELLED "Terminated:
  accept" at once (`finishedAt` 19:58:08.615Z). The cascade cancelled the step on
  Temporal 50 ms later (`WorkflowExecutionCancelRequested` → `ActivityTaskCancelRequested`
  → `WorkflowExecutionCanceled`). **But the sleeper ran its full 300 s and the row
  ended COMPLETED (20:03:03Z):** the runner's Automation activity never heartbeated,
  so no cancel ever reached it, and `TRY_CANCEL` closed the workflow without waiting.
  This affected every Automation cancel. Steve chose to fix it (option (a)): #970.
- **Cold-runner query — PASS.** The runner holds while any durable Workflow is open
  (DECIDE-3), so it never idle-exits here; a cold worker comes from a stop. Staging
  AWS is profile `dolas-pegasus-staging` (account 248812875460), cluster
  `pegasus-temporal-worker-staging`. 21:20:25Z `ecs stop-task` of runner `cc6abf30`
  → STOPPED 21:21:05Z; a replacement `85e8b9fe` was created 21:21:04Z and RUNNING at
  21:21:20Z. 21:21:14Z raw query → **503 `WORKFLOW_WORKER_STARTING`, Retry-After 15,
  after 8.4 s** (the deadline). The CLI query started 21:21:14Z and answered after
  25 s (one Retry-After wait).
- **Viewer 403 — NOT run live** (no viewer key for AVP Smoke). Covered by
  `handlers/workflow-executions.test.ts` (real Cedar policies: viewer and
  `workflow_runtime` → 403 on query/terminate, viewer → 200 on list/get) and
  authz-smoke after merge.
- **Cleanup:** `finish` signalled to `a85cd21f` and `e0779392` (both COMPLETED);
  trigger deleted; `accept_wis` and `accept_wis_sleeper` retired. The kill switch
  was never touched (runs were accepted throughout).
