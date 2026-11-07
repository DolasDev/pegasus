# Durable Workflows (Phase 3c): follow-ups after it ships

- **Status:** TODO. Release steps, docs in another repo, and live acceptance.
- **Branch:** none for the release/docs steps; a fix branch only if acceptance
  fails.
- **Goal:** finish what 3c's PRs couldn't do from inside the repo. Background:
  `plans/completed/7d167652-durable-workflows-3c.md` (design B, deviations,
  progress) and DECISIONS.md "Durable Workflows are pinned AT START".
- **Written:** 2026-11-05 in the 3c.2 PR.

## Resume here (updated 2026-11-06 ~18:30 UTC)

**Status:** staging acceptance DONE (every bullet PASS) and memory measured,
on AVP Smoke `4b2e0267-c597-451e-a367-771dfac52fba` (namespace
`pg-staging-4b2e0267c597.chgel`); evidence in the Acceptance log below.

**Open:** only the namespace cap request (user's action). Both acceptance
follow-ups are DONE: CLI bare-name refusal (#930, SDK 0.57.0) and the worker
SIGSEGV on drain (#933 faulthandler, #935 `os._exit` — accepted on staging
2026-11-07). When the cap request is settled, archive this plan.

**Leftovers on staging:** `accept_3c@0.1.0` (`9f1d7544…`) and `@0.2.0`
(`e5c0910b…`) are still published on AVP Smoke; no open executions. Retire
with `pegasus-workflows retire accept_3c --profile avp-smoke` if unwanted. The
kill switch is OFF (`workflows_disabled = f`, 18:52:08 UTC, verified in the DB).

**How the acceptance was driven (reusable):** scratch project outside the
repo, CLI via `uv run --project packages/workflows-sdk-python
pegasus-workflows …`, profile `avp-smoke`. ALWAYS pass `name@version` to `run`
(see the CLI defect). Staging DB URL from the reconcile Lambda env
(`pegasus-staging-api-ReconcileWorkflowExecutionsFun-wdwJvHTDuNiP`); reconcile
logs in `pegasus-staging-api-ReconcileWorkflowExecutionsLogGroup7AF99A7D-kUsgUm4flGyb`;
runner logs `/pegasus/staging/tenant-runner`; per-task memory in
`/aws/ecs/containerinsights/pegasus-temporal-worker-staging/performance`
(`Type=Task`; the metric has no TaskId dimension). Cluster
`pegasus-temporal-worker-staging`, runner tasks `--started-by <tenant id>`.

## Acceptance log (staging AVP Smoke, 2026-11-06)

Scratch project: session scratchpad `accept/accept_3c` (not in the repo).

- 15:22:20Z `push` → `accept_3c@0.1.0` id `9f1d7544-cbef-453d-b2ba-ea8fe928f611`.
- 15:22:25Z / 15:22:41Z `run` → 409 `WORKFLOW_VERSION_STARTING` (×2);
  15:22:57Z → 201, execution `aedff089-3e6a-4fc7-bacc-9c483d90e2fb` RUNNING.
  **Bullet 1 PASS** (worker up ~37 s after publish).
- 15:23:10Z / 15:24:05Z `run ns_canary` (workflow id `2e2193f3-7df9-4419-a083-4cb9ceba6bce`)
  → `371c704e…` and `2e874d63…` both COMPLETED while `aedff089` was open.
- `aedff089` COMPLETED 15:40:39Z, result `token v0.1.0 timed-out` (timer
  15:22:57→15:37:57, wait timer →15:39:57, `probe` activity saw the runtime
  token). Runner `runner.starting` 15:22:41, `workflow_worker_started`
  15:22:44, `runner.idle_exit` only at 15:50:45 (idle 600.4 s after the close),
  so it **held through the 15-min sleep — PASS**. Reconcile Lambda logged
  `Closed durable Workflow execution` 15:40:39; row `reconciled_at`
  15:40:39.341, namespace `pg-staging-4b2e0267c597.chgel`; metric
  `Pegasus/Workflows WorkflowExecutionClosed{Status=COMPLETED}` = 1 at 15:40.
  **Reconciler WORKFLOW-lane bullet PASS.**
- 16:30:33Z (runner idle-exited at 15:50:45, no open Workflows) `run accept_3c`
  → 201 on the FIRST attempt, no 409: execution
  `4df42972-a5fc-468e-b6f7-359c329cfbdc`. **Version membership survives on
  Cloud — PASS.** Runner task `cfeee9bb57d040b5ac54d745b85f0961` launched.
- Container Insights is `enabled` on `pegasus-temporal-worker-staging`
  (memory can be read without enabling anything).
- Runner `cfeee9bb` RUNNING 16:30:55Z (worker 0.1.0 started 16:30:55); manual
  `ecs stop-task` 16:34:15Z (`runner.shutdown_signal` SIGTERM → draining →
  stopped 16:34:17; NOTE the 0.1.0 worker subprocess exited **-11 (SIGSEGV)**
  on the drain, not 0). Sweep relaunched task `0b078909…` at 16:35:08Z
  (**53 s**); `runner.starting` 16:35:23.
- 16:35:15Z `push` → `accept_3c@0.2.0` id `e5c0910b-9941-45ba-b5a7-9814768c610b`
  while `4df42972` (0.1.0) sleeps.
  - **SDK CLI defect found:** 16:35:17Z bare `run accept_3c` started **0.1.0**
    (exec `4a4cd24b-91b0-436c-858a-62c734c27434`), not 0.2.0:
    `_find_workflow` (`pegasus_workflows/cli/run.py`) sorts candidates by
    `createdAt` ASCENDING and takes the OLDEST version when several are
    visible, contrary to its docstring ("name if there is only one version").
    The server pinned it correctly to what was asked. Needs a fix (refuse
    ambiguity or pick newest) + SDK patch release.
  - 16:35:34Z `run accept_3c@0.2.0` → 201 first try, exec
    `c0cf4922-ba02-43a5-ab2b-cb4b0eb216c5`, `workflowVersion` 0.2.0. No 409
    because the relaunched runner had already taken the 0.2.0
    `workflow-worker-grant` at 16:35:27 (both workers 0.1.0 pid 18 and 0.2.0
    pid 17 started 16:35:27).
- Memory (Container Insights performance log, `Type=Task`, 1024 MiB reserved):
  runner with ns_canary warm + ONE durable worker (0.1.0): 81→92→93 MiB
  (16:31–16:33).
- `4df42972` COMPLETED 16:48:39Z, result `token v0.1.0 timed-out`, despite
  the manual runner stop mid-sleep and 0.2.0 published mid-run. **Stop →
  sweep relaunch → completes: PASS. v1 finishes on v1: PASS.**
- Memory, relaunched task `0b078909` with TWO durable workers (0.1.0 + 0.2.0)
  - ns_canary: 130–133 MiB steady (16:36–16:47). So **≈ 40 MiB per worker
    subprocess**, runner base ≈ 52 MiB ⇒ 8 workers ≈ 370 MiB of 1024 MiB.
    **The 8-worker cap fits the 1 GiB task; no change.** (Caveat: toy
    Workflow; heavy imports in a real Workflow would raise this.)
- 16:49:00Z `run accept_3c@0.2.0` → exec `63391ed8-6a48-42ef-8479-9fad36875944`
  (open Workflow for the kill-switch check).
- `c0cf4922` (0.2.0) COMPLETED 16:52:39Z, result `token v0.2.0 timed-out`.
  **New starts run v2: PASS** (publish-v2-mid-run bullet fully PASS).
  `63391ed8` (0.2.0) COMPLETED 17:06:39Z `token v0.2.0 timed-out`;
  `4a4cd24b` (the accidental 0.1.0) COMPLETED.
- Kill switch: `tenants.workflows_disabled = t` at 17:35:11Z (user, admin-web).
  17:35:32Z `run accept_3c@0.2.0` and `run ns_canary` → both 423
  `WORKFLOWS_DISABLED`. **Start refused: PASS.** "Open Workflow still
  completes" NOT yet shown: `63391ed8` had closed at 17:06, before the switch.
- Kill switch round 2: OFF; 17:44:33Z `run accept_3c@0.2.0` → `28493da2-4f31-4f9e-baaf-fa6fa43ca764`
  (TimerStarted 17:45:09, +33 s cold runner start). Switch ON 18:02:23Z —
  but Temporal had completed the run at 18:02:09 (14 s earlier); 18:02:34Z
  start → 423 again; the reconciler closed the row at 18:02:39 with the
  switch ON. So round 2 still did NOT exercise an open Workflow under the
  switch. The risky path is `ensureTenantRunner`'s DECIDE-4 exemption
  (`apps/api/src/lib/tenant-runner.ts`, launch despite the switch while
  `hasOpenDurableWorkflows`) — round 3 stops the runner with the switch ON.
- Kill switch round 3: OFF; 18:09:20Z `run accept_3c@0.2.0` →
  `dc4c79dc-6a0a-4334-aab8-2c8b3ba5774f`. Switch ON 18:09:29.812Z (DB).
  18:09:45Z manual `ecs stop-task` of runner `addb4d0b…`; the sweep
  relaunched `cef83ab6…` at 18:10:09Z (**24 s, despite the switch** — the
  DECIDE-4 exemption works). Timers 18:09:21→18:24:21→18:26:21, `probe`
  18:26:21; COMPLETED 18:26:39Z, `token v0.2.0 timed-out`, reconciled
  18:26:39.35 with the switch still ON. **Kill-switch bullet PASS** (start
  refused + open Workflow completes, even through a runner stop).
- **Worker SIGSEGV on SIGTERM drain (reproducible, not blocking):** every
  runner SIGTERM stop logged `runner.workflow_worker_stopped` with
  `exit_code: -11` in the SAME second as `runner.shutdown_signal` (16:34:17
  v0.1.0, 18:09:47 v0.2.0), while idle-exit / retirement stops exit 0 (3/3:
  15:50:45, 16:53:28, 17:17:27). No graceful drain happened, but the
  Workflows survived (the next worker replays). Suspects: the Temporal
  core / daemon control-reader thread at interpreter teardown in
  `workflow_worker_driver.py`, or the child also getting SIGTERM. An
  in-flight activity would be cut mid-run instead of drained.
- Switch OFF verified 18:52:08Z (`workflows_disabled = f`); 18:52:21Z
  `run ns_canary` → `6077639a-b9cb-4c52-9ab2-17981f2f2cfe` COMPLETED (after
  the v2 publish and both runner stops). **Automation-unaffected bullet PASS.**

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
- [x] **Staging acceptance** (the plan's "Acceptance" list), on a staging
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
    **Done 2026-11-06: ALL bullets PASS** on AVP Smoke (see the Acceptance log).
- [x] **Measure memory per worker subprocess** during acceptance (decision 4:
      cap 8 workers per 0.5 vCPU / 1 GiB runner). If 8 don't fit, lower
      `RUNNER_MAX_WORKFLOW_WORKERS` or raise the task size (and tell the user:
      it roughly doubles DECIDE-3's ~$18/month per tenant with open Workflows).
      **Done 2026-11-06:** ≈ 40 MiB per worker, runner base ≈ 52 MiB ⇒ 8
      workers ≈ 370 MiB of 1 GiB. Cap and task size unchanged.
- [x] **Fix `pegasus-workflows run <name>` picking the OLDEST version** when
      several are visible (`_find_workflow` in `cli/run.py` sorts `createdAt`
      ascending). Refuse with "name@version required" or pick the newest;
      test + SDK patch release + authoring-repo note.
      **Fixed 2026-11-06 in SDK 0.57.0** (`fix/sdk-run-ambiguous-version`):
      REFUSE, not pick-newest — the docstring already promised "bare name only
      when one version is visible", and `schedule` shares the resolver (a cron
      silently attached to a guessed version is worse than a one-off run). The
      error lists the versions (numeric semver order) and suggests the newest.
- [x] **After that PR merges:** tag `sdk-python-v0.57.0` on the real merge
      commit, wait for PyPI, then note it in `~/repos/pegasus-workflows/CLAUDE.md`
      (bare name refused when several versions are visible).
      **Done 2026-11-06:** #930 → `61c1e263`, tag `sdk-python-v0.57.0`,
      release run 42302217784, on PyPI; authoring repo `bafbb2d`.
- [x] **Diagnose the worker -11 (SIGSEGV) on runner SIGTERM drain** (see the
      Acceptance log): reproduce locally with the gate test harness, make the
      drain clean so an in-flight activity finishes.
      **Investigated 2026-11-06 (`fix/worker-drain-sigsegv`):** NOT the
      signal — ECS SIGTERMs only PID 1 (no init process; ENTRYPOINT exec
      form), and the runner's `drain_all` sends the child the same
      `{"type":"shutdown"}` line as an idle-exit. The real discriminator in the
      staging logs: both -11s came ~40 ms after the shutdown line with a
      Workflow OPEN mid-timer; the 3 clean exits (153 ms) had none open.
      Does NOT reproduce against the dev server — open Workflow mid
      `workflow.sleep(15 min)`, `pegasus_workflows` imported in the sandbox,
      inside `python:3.12-slim`: all exit 0. Untested combination: open
      Workflow + Temporal Cloud (TLS + API key). temporalio 1.35.0 both sides
      (also the latest release). Landed: `faulthandler.enable()` at the top
      of the driver's `main()` (a native crash now dumps every thread's stack
      to stderr → `runner.workflow_worker_output`) + an e2e test pinning
      "drain with an open Workflow exits 0 and it finishes on the next
      worker" (#933).
      **Root cause 2026-11-07 (staging re-test on the #933 image):** stop 1
      (worker up 62 s) exited 0; stop 2 (worker up ~3.5 min, `0a8314eb` open
      mid-timer) exited -11 with faulthandler output `Fatal Python error:
  Segmentation fault` / `Thread 0x… <no Python frame>` / `Extension
  modules: google._upb._message` — a NON-Python (Temporal core) thread
      faulting while the interpreter finalizes after `asyncio.run` returned.
      Python/temporalio/protobuf identical in the crashing (b07d0c9a) and
      current images (3.12.16 / 1.35.0 / 7.36.2). **Fix
      (`fix/worker-driver-skip-finalization`):** the driver flushes stdio and
      `os._exit(code)` instead of `sys.exit` — skips `Py_Finalize`, the drain
      is already done. **Tick only after staging:** ≥ 3 consecutive stops
      exit 0, ≥ 2 of them with the worker up ≥ 3 min, each read from
      `runner.workflow_worker_stopped`.
      **FIXED + ACCEPTED 2026-11-07:** #935 → `c55646e3`; staging image
      `sha256:81edf62e…` (14:41Z). Fresh `accept_3c@0.2.0` exec
      `825176c2-b1bd-45a3-8b08-5a1ed2e04fbc`; three consecutive `ecs
    stop-task`s on the NEW image, all `exit_code: 0`, no `Fatal Python`:
      14:47:38 (runner up ~3.5 min), 14:52:09 (~3.5 min), 14:54:36 (~1.3
      min). `825176c2` COMPLETED 15:01:39Z `token v0.2.0 timed-out`. (Pre-fix,
      same conditions: -11 in 3 of 4 stops.)

- [ ] **Namespace cap request** (owed since 3a): ask Temporal support to
      raise the 100-namespace cap shared by staging and prod (7 used on
      2026-11-04). A user action.
