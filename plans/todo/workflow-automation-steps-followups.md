# Workflow automation steps (`run_automation()`): follow-ups after it ships

- **Status:** TODO. Release steps, the authoring-repo note, and live acceptance.
- **Branch:** none for the release/docs steps; a fix branch only if acceptance
  fails.
- **Goal:** finish what the `feat/workflow-automation-steps` PR couldn't do
  from inside the repo. Background:
  `plans/completed/df49a7ef-workflow-automation-steps.md` (design, decisions,
  deviations) and DECISIONS.md "A durable Workflow runs an Automation as a step
  through the API".
- **Written:** 2026-11-12 in that PR.

## Checklist

- [ ] **Post-deploy (prod):** migration `20261112180000_automation_steps`
      applied; Deploy green for api + tenant-runner image; an NW Automation
      dry run still completes.
- [ ] **Publish SDK 0.65.0:** tag `sdk-python-v0.65.0` on the REAL merge
      commit (guard against an empty mergeCommit), wait for the release run
      and PyPI.
- [ ] **Authoring repo** (`~/repos/pegasus-workflows/CLAUDE.md`, separate repo,
      commit to its `main`), only after 0.65.0 is on PyPI: one short note.
      `run_automation(name, input, *, version=None, timeout=6h)` /
      `AutomationStepFailed`, Workflows only, newest-ACTIVE resolution, not-now
      refusals are waited out, once per call. Commit only that hunk.
- [ ] **Staging acceptance (AVP Smoke, scratch project outside the repo,
      always `name@version`):**
  - Workflow `accept_steps` (SDK 0.65.0) calls Automation `step_echo` and gets
    its result back; the step row has trigger source WORKFLOW and
    `parentExecutionId`;
  - a failing Automation surfaces as `AutomationStepFailed` (caught by the
    Workflow);
  - kill switch ON while a step is waiting to start → the step waits; switch
    OFF → it starts and completes;
  - runner `ecs stop-task` mid-step → the Workflow completes and there is no
    duplicate step row (the step key);
  - tenant-web shows the "Workflow step" badge;
  - afterwards: retire the scratch rows, verify the kill switch is OFF.
