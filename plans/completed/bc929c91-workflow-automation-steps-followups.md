# Workflow automation steps (`run_automation()`): follow-ups after it ships

- **Status:** DONE 2026-11-12. Every acceptance bullet passed, apart from the
  tenant-web badge eyeball (see below).
  Previously: TODO. Release steps, the authoring-repo note, and live acceptance.
- **Branch:** none for the release/docs steps; a fix branch only if acceptance
  fails.
- **Goal:** finish what the `feat/workflow-automation-steps` PR couldn't do
  from inside the repo. Background:
  `plans/completed/df49a7ef-workflow-automation-steps.md` (design, decisions,
  deviations) and DECISIONS.md "A durable Workflow runs an Automation as a step
  through the API".
- **Written:** 2026-11-12 in that PR.

## Checklist

- [x] **Post-deploy (prod):** migration `20261112180000_automation_steps`
      applied; Deploy green for api + tenant-runner image; an NW Automation
      dry run still completes.
      **Done 2026-11-12:** #957 merged as `9d66eced` (21:14Z). Deploy run
      43308154962 is green: the migration was applied in the "Migrate prod
      database" job at 21:25:13Z, and the tenant-runner image built. NW dry
      run `nw_pulse_daily_check@0.2.3` (exec `9a4d8255`) COMPLETED in 3 s.
- [x] **Publish SDK 0.65.0:** tag `sdk-python-v0.65.0` on the REAL merge
      commit (guard against an empty mergeCommit), wait for the release run
      and PyPI.
      **Done 2026-11-12:** tag on `9d66eced`, and 0.65.0 is on PyPI. The
      simple index lagged the JSON API by a few minutes.
- [ ] **Authoring repo** (`~/repos/pegasus-workflows/CLAUDE.md`, separate repo,
      commit to its `main`), only after 0.65.0 is on PyPI: one short note.
      `run_automation(name, input, *, version=None, timeout=6h)` /
      `AutomationStepFailed`, Workflows only, newest-ACTIVE resolution, not-now
      refusals are waited out, once per call. Commit only that hunk.
      **Done 2026-11-12:** `pegasus-workflows` `165d19b` (note + pin 0.65.0).
      Its "publish with 0.65.0+" line is wrong; it is corrected after 0.65.1
      (see below).
- [x] **Staging acceptance (AVP Smoke, scratch project outside the repo,
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

## Acceptance log (staging AVP Smoke, 2026-11-12)

The scratch project lives in this session's scratchpad (`accept/accept_steps`),
not in the repo. Rows: `step_echo@0.1.0` `8c162a4d…`, `@0.1.1` `e8aaa624…`;
`step_fail@0.1.0` `d03214ef…`; `accept_steps@0.1.0` `121c874d…`, `@0.1.1`
`7dcbe470…`.

**Gotcha (both mistakes were in my own test scripts):** a durable Workflow's
run argument, AND the input of an Automation that a step runs, is the
envelope `{executionId, input, dryRun}`, not the raw input. Read
`payload["input"]`.

- 21:41:12Z `run accept_steps@0.1.0` → 409 `WORKFLOW_VERSION_STARTING`;
  21:41:32Z → exec `8e020987`. Step 1 `step_echo@0.1.0` row `d19cd372`
  (trigger WORKFLOW, queued 1 s after the Workflow) COMPLETED with its result
  returned. Step 2 `step_fail` row `a05f9bdb` FAILED → `AutomationStepFailed`,
  caught. **Result + failure bullets PASS.** `8e020987` is parked on its `go`
  signal for the kill-switch test (its step 3 will resolve `step_echo@0.1.1`,
  which sleeps 120 s).
- 22:03:39Z `run accept_steps@0.1.1` → exec `be44ca25`. 22:04:11Z `go` →
  step 3 row `0520e015` on **`step_echo@0.1.1`**: a bare name resolved to the
  version published mid-run. **Newest-live PASS.**
- 22:04:22Z `ecs stop-task` of runner `9eb48704` while step 3 slept.
  - 22:04:27Z the Automation's proxy activity failed: "Worker is shutting
    down…" (one attempt, so it dies with the runner by design).
  - 22:04:33Z `WorkflowExecutionCancelRequested` on the Automation. **BUG**:
    the draining worker cancelled `pegasus.run_automation`, and its cancel
    handler cancelled the Automation. Fixed in
    `fix/automation-step-shutdown-cancel` (plan `plans/completed/9d66eced-automation-step-shutdown-cancel.md`, SDK 0.65.1,
    `activity.is_worker_shutdown()` guard).
  - 22:05:31Z the activity retried on the relaunched runner and replayed to
    the SAME row `0520e015`. **No duplicate: step-key PASS.** The reconciler
    closed the row CANCELLED at 22:09:39Z, so the Workflow FAILED: "Automation
    step 'step_echo' ended CANCELLED". After the fix the row ends FAILED
    instead. Steve decided 2026-11-12 not to re-run it automatically; the
    behavior is documented.

## Closing log (2026-11-12)

- [x] 0.65.1 fix: #958 merged as `bc929c91`. Deploy run 43320209750 and the
      tenant-runner image are green. Tag `sdk-python-v0.65.1`; on PyPI.
      Authoring repo `f5ef317`: note corrected (the runner image's SDK runs
      every Workflow; 0.65.0+ only to import `run_automation`), the
      runner-stop → FAILED line added, pin 0.65.1.
- [x] Runner-stop re-check on the fixed image. The old runner `4152f775`
      (digest `07cad3cc…`, started before the image push) was stopped. Fresh
      runner `10a37ad3` has digest `96a5459d…`. Run `accept_steps@0.1.1`
      `12c6d833`: `go` at 22:41:16Z → step 3 row `9693a0bd`; `ecs stop-task`
      at 22:41:19Z. The Automation's proxy activity failed at 22:41:26Z
      ("Worker is shutting down…"), and this time there was **no
      `WorkflowExecutionCancelRequested`**. Before the fix it came 6 s after.
      The row closed **FAILED**, and the Workflow FAILED: "Automation step
      'step_echo' ended FAILED". That is decision 2's behavior. **PASS.**
- [x] Kill switch (Steve flipped it in admin-web). Switch ON, then `go` to
      `8e020987` at 22:30:15Z: the signal was delivered (signals aren't
      blocked). The API logged "Workflow start blocked — tenant workflows
      disabled" at 22:30:15, :21, :31, :52 and 22:31:32. That is the
      activity's backoff, about 5/10/20/40 s, and no step row was created.
      Switch OFF: the step started on its next retry (row `558c3c24`,
      22:36:33Z), ran its 120 s sleep and COMPLETED. `8e020987` COMPLETED at
      22:39Z. **PASS.**
- [ ] tenant-web "Workflow step" badge: NOT eyeballed (no browser in the
      session). The API returns `triggerSource: "WORKFLOW"` +
      `parentExecutionId` (seen via the CLI); the badge is a pure render
      branch. Glance at it next time a step runs.
- [x] Cleanup: retired `accept_steps` (0.1.0, 0.1.1), `step_echo` (0.1.0,
      0.1.1) and `step_fail` (0.1.0). Kill switch OFF verified by run
      `ns_canary@0.1.0` → `e669e25d` accepted.
