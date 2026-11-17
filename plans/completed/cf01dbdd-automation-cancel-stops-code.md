# Cancelling an Automation stops its code

- **Branch:** `fix/automation-cancel-stops-code` (worktree `../pegasus-automation-cancel-stops-code`).
  Plan + code land in one PR via the merge queue.
- **Goal:** when an Automation run is cancelled (tenant-web Cancel, `POST
…/cancel`, a Workflow cancelling its `run_automation` step, or the terminate
  cascade), the tenant subprocess is killed and the row ends `CANCELLED`.
  Today it runs to the end and the row ends `COMPLETED`.
- **Status:** Approved 2026-11-16 (Steve chose option (a), "make cancel real",
  over documenting the gap). DONE in this PR. Runner pytest 167 green (incl. the
  new dev-server e2e), ruff clean. The post-deploy staging re-check lives in
  `plans/todo/workflow-instance-surfaces-followups.md` (the plans PR that
  follows this one).

## Why (found in staging acceptance, 2026-11-16)

The terminate cascade cancelled step `8bd2d8e1` 50 ms after the terminate.
Temporal recorded `WorkflowExecutionCancelRequested` → `ActivityTaskCancelRequested`
→ `WorkflowExecutionCanceled`, all at 19:58:08. The sleeper then ran its full
300 s, and the runner wrote the row back as `COMPLETED`. Cause, in
`apps/tenant-runner/pegasus_tenant_runner/proxy.py`: the one activity is
scheduled with no `heartbeat_timeout` and the default `TRY_CANCEL`, and it
never heartbeats. Temporal hands a running async activity its cancel only in
a heartbeat response, so the activity never learns of it, while `TRY_CANCEL`
closes the workflow at once.

## Design

- **Proxy workflow:** `execute_activity(…, heartbeat_timeout=20 s,
cancellation_type=WAIT_CANCELLATION_COMPLETED)`. The workflow then closes
  CANCELLED only after the subprocess is gone. Changing activity options isn't
  a determinism break (the Python SDK compares command type and activity type,
  not options), and a proxy run lives ≤ 15 min.
- **Proxy activity:** a background task heartbeats every 5 s while the
  executor runs, and is cancelled in `finally`. 20 s / 5 s means the SDK
  throttles at 16 s, so a cancel reaches the activity within ~16 s.
- **Executor (`_run_prepared`):** on `asyncio.CancelledError` around
  `communicate()`, SIGTERM the subprocess, then SIGKILL after 5 s, and reap it.
  Then:
  - a **real cancel** (`not activity.is_worker_shutdown()`): PATCH `CANCELLED`
    ("Cancelled while running"), then re-raise;
  - a **worker shutdown** (runner drain/stop): no PATCH, re-raise. This is
    today's behaviour: the Automation dies with the runner and the
    reconciler closes the row (FAILED, per the #958 decision). The only
    change is that the subprocess is killed now, not orphaned until the
    container exits.
- No API, SDK or Cedar change. Each Automation run already goes through the
  proxy, so this reaches every tenant when the runner image deploys.

## Tests (TDD)

- Executor: tenant code that sleeps; cancel the task; the subprocess is
  dead, PATCH `CANCELLED`, and `CancelledError` propagates. A worker-shutdown
  variant: killed, no PATCH.
- Proxy activity: heartbeats while it runs, and the heartbeat task stops when
  it returns or raises.
- Dev-server e2e (`WorkflowEnvironment.start_local`): the real proxy + activity
  with a stub executor that sleeps. Cancel the workflow → it ends CANCELLED
  only after the stub saw `CancelledError`.
- Proxy options: `heartbeat_timeout` and `cancellation_type` are set.

## Checklist

- [x] Failing tests first (executor cancel, worker-shutdown variant, proxy heartbeat).
      The 5 new tests failed for the right reason (the subprocess was still alive).
- [x] proxy.py options + heartbeat task
- [x] executor.py cancel handling
- [x] Dev-server e2e (`tests/test_proxy_cancel_e2e.py`). Mutation check: with
      `TRY_CANCEL` it fails (the workflow closed before the tenant side cleaned up).
- [x] runner pytest + ruff green
- [x] Docs: GOTCHAS, DECISIONS, the stale API comment on cancel
      (`handlers/workflows.ts`). The staging re-check goes into the follow-ups plan
      in the plans PR.
- [ ] `/security-review` (touches `apps/tenant-runner/**`)
- [ ] After deploy: staging re-check on AVP Smoke — a sleeper Automation run,
      `executions cancel` → the row is CANCELLED within ~30 s and stays so

## Risks

- A runner event loop blocked > 20 s would now fail the activity on heartbeat
  timeout. The executor's blocking calls already run in threads
  (`asyncio.to_thread`), and the subprocess is async.
- During the image rollout, a proxy run already scheduled under the old
  options keeps them (the options are recorded at schedule time). Only new runs
  get real cancel.
