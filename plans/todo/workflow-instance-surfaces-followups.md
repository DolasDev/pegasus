# Open-Workflow surfaces (list / query / cancel / terminate): follow-ups after it ships

- **Status:** TODO. Release steps, the authoring-repo note, and live acceptance.
- **Branch:** none for the release/docs steps; a fix branch only if acceptance
  fails.
- **Goal:** finish what the `feat/workflow-instance-surfaces` PR couldn't do
  from inside the repo. Background: the archived plan
  `plans/completed/f4a4de71-workflow-instance-surfaces.md` (design, decisions,
  deviations) and DECISIONS.md "Open Workflows are listed, queried, cancelled
  and terminated by execution id alone".
- **Written:** 2026-11-14 in that PR.

## Checklist

- [ ] **Post-deploy:** Deploy green for api (no migration in this PR). AVP
      policies re-synced (two new actions: `QueryWorkflowExecution`,
      `TerminateWorkflowExecution`). authz-smoke green after merge.
- [ ] **Publish SDK 0.66.0:** tag `sdk-python-v0.66.0` on the REAL merge commit
      (guard against an empty mergeCommit), wait for the release run and PyPI.
      Re-check `git tag -l 'sdk-python-v*'` first: versions collide often.
- [ ] **Authoring repo** (`~/repos/pegasus-workflows/CLAUDE.md`, separate repo),
      only after 0.66.0 is on PyPI: a short note covering `queries = [...]`,
      `list_workflow_executions` / `query_execution` / `terminate_execution`,
      and the CLI `executions open | query | cancel | terminate`. Pin 0.66.0.
      Commit only that hunk.
- [ ] **Staging acceptance (AVP Smoke, scratch project outside the repo,
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
- [ ] **Next Phase 4 item:** the tenant-web Workflows section. It can now link a
      step's "Workflow step" badge to its parent via `GET
  /workflow-executions/:id`. **Constraint:** don't poll queries on a timer
      (each query wakes the runner); run one on open / on refresh.
