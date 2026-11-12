# Fix: a worker shutdown must not cancel a step's Automation (SDK 0.65.1)

- **Branch:** `fix/automation-step-shutdown-cancel` (worktree
  `../pegasus-automation-step-shutdown-cancel`). One PR through the merge queue.
- **Goal:** `run_automation()`'s activity cancels the Automation only when the
  Workflow cancels the step, not when the worker shuts down. The same PR fixes
  docs that wrongly tie steps to the SDK version a Workflow is published with.
- **Status:** DONE in this PR. The post-merge release and the staging re-check are
  tracked in `plans/todo/workflow-automation-steps-followups.md`.
- **Background:** #957 (`plans/completed/df49a7ef-workflow-automation-steps.md`).
  Follow-ups are in `plans/todo/workflow-automation-steps-followups.md`.

## What staging acceptance showed (AVP Smoke, 2026-11-12)

Workflow `accept_steps@0.1.1`, execution `be44ca25`. Its step 3 (`step_echo@0.1.1`,
row `0520e015`) was sleeping when I ran `ecs stop-task` on the runner at 22:04:22.

- 22:04:27: the Automation's own proxy activity failed: "Worker is shutting
  down and this activity did not complete in time". Automations run on the
  same runner and get one attempt, so the Automation would have ended FAILED
  regardless.
- 22:04:33: `WorkflowExecutionCancelRequested` on the Automation. **This is
  the bug.** The draining worker cancelled the in-flight `pegasus.run_automation`
  activity. Its `except asyncio.CancelledError` handler treats every
  cancellation as "the Workflow cancelled the step" and calls
  `cancel_automation_step`.
- 22:05:31: the activity retried on the relaunched runner and replayed to the
  SAME row. There was no duplicate, so idempotency held. It polled until the
  reconciler closed the row CANCELLED (22:09:39). The Workflow then failed
  with "Automation step 'step_echo' ended CANCELLED".

## Decisions (Steve, 2026-11-12)

1. Fix: skip the Automation cancel when `activity.is_worker_shutdown()` is
   true. The cancellation still propagates, and the retried activity resumes
   polling the same row.
2. **Keep FAILED** for a step whose Automation is killed by a runner stop. No
   automatic re-run, because the Automation's side effects may already have
   happened. This is the same as a plain Automation run dying today. Document
   it: authors who want a retry catch `AutomationStepFailed` and call
   `run_automation` again.

## Doc correction (found during acceptance)

Tenant venvs are built with `--system-site-packages`, and the runner image
pip-installs the repo's SDK (`apps/tenant-runner/Dockerfile`). Tenant code,
including `pegasus_workflows.steps`, therefore runs against the **image's**
SDK, not the version the author pins. `run_automation` steps work for every
Workflow once the runner image with the SDK is deployed. The author needs
0.65.0+ only locally, to import `run_automation`. Fix every place that says
"publish the Workflow with SDK 0.65.0+ (the runner registers the activity
from it)":

- `apps/tenant-runner/pegasus_tenant_runner/workflow_worker_driver.py`
  `builtin_activities` docstring
- `packages/workflows-sdk-python/README.md` (steps section)
- `packages/workflows-sdk-python/pegasus_workflows/steps.py` (`run_automation`
  docstring)
- `packages/workflows-sdk-python/pegasus_workflows/cli/mcp_server.py`, if it
  says so
- CHANGELOG: a 0.65.1 entry that also corrects the 0.65.0 note
- `~/repos/pegasus-workflows/CLAUDE.md`: commit only that hunk, after 0.65.1
  is on PyPI
- DECISIONS.md: correct "from the tenant venv's SDK"

## Checklist

- [x] TDD: test that `worker_shutdown()` followed by `cancel()` makes no cancel
      POST (ActivityEnvironment); the existing "cancel → cancel POST" test
      still passes
- [x] `steps.py`: guard the cancel with `activity.is_worker_shutdown()`
- [x] Doc corrections above; README states the runner-stop → FAILED behavior
      (decision 2)
- [x] SDK 0.65.1 (pyproject, uv.lock, CHANGELOG)
- [x] ruff + pytest (SDK), runner pytest
- [ ] (follow-ups plan) PR → merge queue → Deploy green (new runner image) → tag
      `sdk-python-v0.65.1` → PyPI → authoring-repo note
- [ ] (follow-ups plan) Re-run the runner-stop acceptance on staging: the Automation shows no
      `WorkflowExecutionCancelRequested`. The step still ends FAILED
      (decision 2), and the Workflow catches or fails as written.
- [x] Archive this plan; update the follow-ups plan's acceptance log

## Files

`packages/workflows-sdk-python/pegasus_workflows/steps.py`,
`…/tests/test_steps.py`, `…/README.md`, `…/CHANGELOG.md`, `…/pyproject.toml`,
`…/uv.lock`, possibly `…/pegasus_workflows/cli/mcp_server.py`,
`apps/tenant-runner/pegasus_tenant_runner/workflow_worker_driver.py`,
`dolas/agents/project/DECISIONS.md`,
`plans/todo/workflow-automation-steps-followups.md`.

## Risks

- `is_worker_shutdown()` is true only once the worker has started shutting
  down. A Workflow cancel that arrives during a shutdown would skip the
  Automation cancel. That is acceptable: the Automation still finishes on its
  own and its row closes.

## Outcome

- TDD: `test_a_worker_shutdown_does_not_cancel_the_automation` failed before
  the guard and passes after it. SDK pytest 618, runner pytest 161, ruff clean.
- The authoring-repo correction waits for 0.65.1 on PyPI (follow-ups plan).
