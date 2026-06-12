// ---------------------------------------------------------------------------
// Custom CloudWatch metric constants — used by the CDK stacks that build the
// alarms and dashboard widgets. The publisher side
// (apps/api/src/lambda-avp-store-count.ts) repeats the same strings literally
// rather than importing from here: apps/api does not depend on
// @pegasus/infra, and reversing that dep direction would let CDK code reach
// into the API bundle (and vice-versa). Duplication is the cheaper trade.
// If either string changes here, update the matching constant in the
// publisher in the same commit.
// ---------------------------------------------------------------------------

export const PEGASUS_AUTHZ_METRIC_NAMESPACE = 'Pegasus/Authorization'

/**
 * Count of `tenants` rows with a non-null `policy_store_id`. Emitted hourly
 * by the avp-store-count scheduled Lambda. AWS Verified Permissions has a
 * soft limit of ~100 policy stores per Region per AWS account; we provision
 * one per tenant, so this is also the active-tenant count in the AVP plane.
 *
 * Alarm thresholds (in MonitoringStack):
 *   - 60 → informational ("plan ahead")
 *   - 80 → critical ("file an AWS support ticket NOW to raise the quota")
 */
export const AVP_POLICY_STORE_COUNT_METRIC_NAME = 'PolicyStoreCount'

// ---------------------------------------------------------------------------
// RingCentral message-capture health metrics.
//
// Emitted every 15 minutes by the ringcentral-metrics scheduled Lambda
// (apps/api/src/lambda-ringcentral-metrics.ts), which repeats these strings
// literally for the same apps/api-can't-import-@pegasus/infra reason as above.
// The MonitoringStack alarms reference them from here. Keep both sides in sync.
//
// All are gauges (Maximum statistic). The emitter publishes 0 when the feature
// is inert (empty tables), so the alarms use treatMissingData NOT_BREACHING and
// fire only on real values once RINGCENTRAL_ENABLED is on.
// ---------------------------------------------------------------------------

export const PEGASUS_RINGCENTRAL_METRIC_NAMESPACE = 'Pegasus/RingCentral'

/** Forward-outbox rows awaiting delivery (status PENDING or FAILED). */
export const RC_OUTBOX_PENDING_METRIC_NAME = 'OutboxPending'
/** Forward-outbox rows dead-lettered after exhausting retries (status DEAD). */
export const RC_OUTBOX_DEAD_METRIC_NAME = 'OutboxDead'
/** Webhook subscriptions in a dead/blacklisted state (delivery broken). */
export const RC_SUBSCRIPTIONS_DEAD_METRIC_NAME = 'SubscriptionsDead'
/** Connections whose token/health is UNHEALTHY (e.g. token refresh failing). */
export const RC_CONNECTIONS_UNHEALTHY_METRIC_NAME = 'ConnectionsUnhealthy'
/** Seconds since the oldest sync cursor last advanced (capture staleness). */
export const RC_SYNC_LAG_SECONDS_METRIC_NAME = 'SyncLagSeconds'

// ---------------------------------------------------------------------------
// Workflow execution-runtime metrics (Phase 2).
//
// Emitted by the reconcile poller (apps/api/src/lambda-reconcile-workflow-
// executions.ts), which repeats these strings literally for the same
// apps/api-can't-import-@pegasus/infra reason as the emitters above. Keep both
// sides in sync if either string changes.
// ---------------------------------------------------------------------------

export const PEGASUS_WORKFLOWS_METRIC_NAMESPACE = 'Pegasus/Workflows'

/**
 * Count of orphaned RUNNING executions the reconcile poller flipped to a
 * terminal state (a crashed worker never wrote back). One datapoint per
 * reconciled row, dimensioned by the resolved terminal `Status`. A sustained
 * non-zero value means workers are crashing mid-execution.
 */
export const WORKFLOW_EXECUTION_RECONCILED_METRIC_NAME = 'WorkflowExecutionReconciled'

// ---------------------------------------------------------------------------
// Tenant-runner orchestration metrics (Phase 3 Unit 9).
//
// Emitted by apps/api/src/lib/tenant-runner.ts (from both the API Lambda's
// run-path hook and the trigger dispatcher's per-minute sweep), which repeats
// these strings literally for the same apps/api-can't-import-@pegasus/infra
// reason as the emitters above. Keep both sides in sync. Alarms/dashboards
// land in Phase 3 Unit 11; the metrics exist from Unit 9.
// ---------------------------------------------------------------------------

/** Count of tenant-runner ECS tasks successfully launched via RunTask. */
export const TENANT_RUNNER_LAUNCHED_METRIC_NAME = 'TenantRunnerLaunched'

/** Count of failed tenant-runner launches (RunTask failures[], SDK errors,
 * broker-credential recovery failures). Sustained non-zero = QUEUED tenant
 * executions are waiting on a runner that cannot start. */
export const TENANT_RUNNER_LAUNCH_FAILED_METRIC_NAME = 'TenantRunnerLaunchFailed'

/** Gauge: tenant-runner tasks with lastStatus RUNNING, published every
 * dispatcher tick (0 included — scale-to-zero is the steady state). */
export const TENANT_RUNNERS_RUNNING_METRIC_NAME = 'TenantRunnersRunning'

/** Cold-start latency in seconds (RunTask accept → task RUNNING), emitted
 * for tasks that reached RUNNING within the last tick window. The accepted
 * Resolved-#1 budget is ~30–60 s. */
export const TENANT_RUNNER_COLD_START_SECONDS_METRIC_NAME = 'TenantRunnerColdStartSeconds'
