// ---------------------------------------------------------------------------
// Workflow routing — the single source of truth for which queue/lane a
// workflow execution runs on (Phase 3 Unit 10).
//
// Unit 10 FLIPS THE SANDBOX LIVE: this module replaces:
//   (a) the curated-names gate in start-workflow-execution.ts, and
//   (b) executionNeedsTenantRunner in tenant-runner.ts
// with ONE routing decision so there is no way for the two to drift apart.
//
// ## Route table
//
// | Condition                                          | Route              |
// |----------------------------------------------------|-------------------|
// | workflow.name ∈ CURATED_WORKFLOW_NAMES             | STDLIB             |
// | name ∉ curated AND workflow.executable === true    | TENANT_RUNNER      |
// | name ∉ curated AND workflow.executable !== true    | NOT_EXECUTABLE     |
//
// ## STDLIB lane — curated naming, forked-curated shadowing
//
// Curated workflows (names in CURATED_WORKFLOW_NAMES) run on the shared
// `pegasus-stdlib-<env>` task queue, served by the stdlib Fargate worker whose
// image bakes in the curated code. This covers three cases:
//   1. The platform-tenant GLOBAL row for a curated workflow (e.g.
//      `send_quote_followup` uploaded under the platform tenant).
//   2. A TENANT-visibility fork of a curated GLOBAL workflow (POST /:id/fork).
//      The row's name matches the curated name, so it STILL routes STDLIB.
//      This means the stdlib worker's baked-in code for that name is what runs,
//      NOT the tenant's forked artifact bytes. This is intentional for v1:
//      the stdlib worker has no mechanism to load per-tenant code, and the fork
//      operation is a row-level copy, not a code-level customisation.
//      Tenants that want custom behaviour must upload under a DIFFERENT name
//      (which routes TENANT_RUNNER).
//   3. Any row whose name later becomes curated via an SDK update — same as #1.
//
// ## TENANT_RUNNER lane
//
// Non-curated workflows with executable=true start on the per-tenant Temporal
// task queue `pegasus-tenant-<tenantId>-<env>` (queue name derived exactly as
// `RunnerConfig.task_queue` in apps/tenant-runner/pegasus_tenant_runner/
// config.py: f"pegasus-tenant-{tenant_id}-{env_name}"). The Unit 9
// `ensureTenantRunner` hook is called BEFORE the Temporal start so the runner's
// ~30–60 s cold start overlaps the insert and start.
//
// ## Execution limits (TENANT_RUNNER lane only)
//
// The curated stdlib lane is uncapped — it runs exactly as before Unit 10.
// All four v1-blocking limits (Resolved decision #3) apply only to
// TENANT_RUNNER executions:
//   (a) Per-execution Temporal workflow timeout — set at Temporal start.
//   (b) Per-tenant concurrent-execution cap — checked before the QUEUED insert.
//   (c) Per-tenant daily quota — checked before the QUEUED insert.
//   (d) Artifact size cap — already enforced at finalize (Unit 6); not here.
// See start-workflow-execution.ts for where (b) and (c) are enforced.
//
// ## Per-env tenant task-queue name
//
// The API derives the queue at start time from TEMPORAL_TASK_QUEUE_ENV_SUFFIX
// (the env suffix injected by the CDK ApiStack alongside the stdlib
// TEMPORAL_TASK_QUEUE). When unset, falls back to "dev" — matching the runner's
// default ENV_NAME fallback. The stdlib task queue is still read from
// TEMPORAL_TASK_QUEUE (unchanged).
// ---------------------------------------------------------------------------

import { CURATED_WORKFLOW_NAMES } from './curated-workflows'

// ---------------------------------------------------------------------------
// Route type
// ---------------------------------------------------------------------------

/**
 * The lane/queue an execution of `workflow` will run on.
 *
 *   STDLIB         — start on temporalTaskQueue() (the shared stdlib worker).
 *   TENANT_RUNNER  — start on the per-tenant queue; ensureTenantRunner needed.
 *   NOT_EXECUTABLE — non-curated + not executable; reject before any insert.
 */
export type WorkflowRoute = 'STDLIB' | 'TENANT_RUNNER' | 'NOT_EXECUTABLE'

// ---------------------------------------------------------------------------
// Task-queue derivation
// ---------------------------------------------------------------------------

/**
 * The per-env suffix used to build the tenant task-queue name.
 * CDK ApiStack injects TEMPORAL_TASK_QUEUE_ENV_SUFFIX (e.g. "staging", "prod");
 * "dev" is the fallback matching the runner's default ENV_NAME.
 */
export function tenantTaskQueueEnv(env: Record<string, string | undefined> = process.env): string {
  return (env['TEMPORAL_TASK_QUEUE_ENV_SUFFIX'] ?? '').trim() || 'dev'
}

/**
 * Per-tenant Temporal task queue for TENANT_RUNNER-routed executions.
 * Must match RunnerConfig.task_queue in:
 *   apps/tenant-runner/pegasus_tenant_runner/config.py
 *   `f"pegasus-tenant-{tenant_id}-{env_name}"`
 */
export function tenantTaskQueue(tenantId: string): string {
  return `pegasus-tenant-${tenantId}-${tenantTaskQueueEnv()}`
}

// ---------------------------------------------------------------------------
// Routing function — one decision, one place
// ---------------------------------------------------------------------------

/**
 * Resolves the routing lane for a workflow execution.
 *
 * This is the SINGLE source of truth for the routing decision. Both the run
 * path (start-workflow-execution.ts) and the runner-orchestration sweep
 * (tenant-runner.ts) delegate here so they can never diverge.
 *
 * See the module header for the full decision table and the curated-shadowing
 * contract.
 */
export function resolveWorkflowRoute(workflow: {
  name: string
  executable: boolean
}): WorkflowRoute {
  if (CURATED_WORKFLOW_NAMES.has(workflow.name)) {
    return 'STDLIB'
  }
  if (workflow.executable) {
    return 'TENANT_RUNNER'
  }
  return 'NOT_EXECUTABLE'
}
