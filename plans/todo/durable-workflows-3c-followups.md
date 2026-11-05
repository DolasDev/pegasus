# Durable Workflows (Phase 3c): follow-ups after it ships

- **Status:** TODO. Release steps, docs in another repo, and live acceptance.
- **Branch:** none for the release/docs steps; a fix branch only if acceptance
  fails.
- **Goal:** finish what 3c's PRs couldn't do from inside the repo. Background:
  `plans/completed/7d167652-durable-workflows-3c.md` (design B, deviations,
  progress) and DECISIONS.md "Durable Workflows are pinned AT START".
- **Written:** 2026-11-05 in the 3c.2 PR.

## Checklist

- [x] **Publish SDK 0.56.0** once 3c.2 is merged and deployed: tag
      `sdk-python-v0.56.0` on the merge commit (see the release workflow;
      guard the tag on a real merge commit).
      **Done 2026-11-05:** tag `sdk-python-v0.56.0` on merge commit `b07d0c9a` (#925); release run 42089236963 green; on PyPI.
- [x] **Authoring repo docs** (`~/repos/pegasus-workflows/CLAUDE.md`, a
      separate repo, commits to its `main`), only after 0.56.0 is on PyPI:
      manifest rules gain `kind` (`"automation"` default / `"workflow"`),
      `signals` and `max_lifetime_days` (Workflows only; `timeout_seconds`
      Automations only); the run/retry error list gains
      `WorkflowVersionStarting` (409 `WORKFLOW_VERSION_STARTING`) and
      `OPEN_WORKFLOW_LIMIT` (429); one paragraph on what a durable Workflow is
      (timers/wait_condition/replay, pinned to its version, no dry runs).
      **Done 2026-11-05:** `pegasus-workflows` `c131380` (manifest rules + `WorkflowVersionStarting` / `OPEN_WORKFLOW_LIMIT`).
- [x] **Post-deploy checks (prod):** the migration `durable_workflow_kind`
      applied; the `pegasus-workflow-execution-reconciled` alarm stays quiet;
      an NW Automation (dry run is enough) still completes.
      **Done 2026-11-05 ~18:57 UTC:** migration `20261105175848_durable_workflow_kind` applied (50 rows, all AUTOMATION); `pegasus-workflow-execution-reconciled` OK; reconcile ticks clean with the new `durableScanned` field; NW dry run `b8a525f3` COMPLETED.
- [ ] **Staging acceptance** (the plan's "Acceptance" list), on a staging
      tenant with an ACTIVE namespace:
  - publish a Workflow that sleeps 15 min, then waits on a condition with a
    timeout; a start right after publish may get `WORKFLOW_VERSION_STARTING`,
    and a retry starts it;
  - the runner stays up through the sleep (hold); stop it by hand, the sweep
    relaunches it within ~1 min, and the Workflow completes;
  - after every Workflow closes and the runner idle-exits, a start of the same
    version is accepted (membership survives on Cloud, not just the dev
    server);
  - publish v2 mid-run: v1 finishes on v1, new starts run v2;
  - the row closes via the reconciler's WORKFLOW lane
    (`WorkflowExecutionClosed` metric);
  - kill switch on: a start is refused, the open Workflow still completes;
  - an Automation for the same tenant is unaffected throughout.
- [ ] **Measure memory per worker subprocess** during acceptance (decision 4:
      cap 8 workers per 0.5 vCPU / 1 GiB runner). If 8 don't fit, lower
      `RUNNER_MAX_WORKFLOW_WORKERS` or raise the task size (and tell the user:
      it roughly doubles DECIDE-3's ~$18/month per tenant with open Workflows).
- [ ] **Namespace cap request** (owed since 3a): ask Temporal support to
      raise the 100-namespace cap shared by staging and prod (7 used on
      2026-11-04). A user action.
