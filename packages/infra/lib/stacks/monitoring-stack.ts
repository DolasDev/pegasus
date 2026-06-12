import * as cdk from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import { type Construct } from 'constructs'
import {
  AVP_POLICY_STORE_COUNT_METRIC_NAME,
  PEGASUS_AUTHZ_METRIC_NAMESPACE,
  PEGASUS_RINGCENTRAL_METRIC_NAMESPACE,
  PEGASUS_WORKFLOWS_METRIC_NAMESPACE,
  RC_OUTBOX_PENDING_METRIC_NAME,
  RC_OUTBOX_DEAD_METRIC_NAME,
  RC_SUBSCRIPTIONS_DEAD_METRIC_NAME,
  RC_CONNECTIONS_UNHEALTHY_METRIC_NAME,
  RC_SYNC_LAG_SECONDS_METRIC_NAME,
  TENANT_RUNNER_LAUNCHED_METRIC_NAME,
  TENANT_RUNNER_LAUNCH_FAILED_METRIC_NAME,
  TENANT_RUNNERS_RUNNING_METRIC_NAME,
  TENANT_RUNNER_COLD_START_SECONDS_METRIC_NAME,
  WORKFLOW_EXECUTION_RECONCILED_METRIC_NAME,
} from '../metrics'

export interface MonitoringStackProps extends cdk.StackProps {
  /**
   * The name of the Lambda function to monitor.
   * Used to scope the Lambda error and duration alarms.
   */
  readonly lambdaFunctionName: string

  /**
   * The HTTP API Gateway v2 API ID.
   * Used to scope the 5xx error alarm.
   */
  readonly httpApiId: string

  /**
   * The HTTP API Gateway v2 stage name (e.g. '$default').
   * Used to scope the 5xx error alarm dimension.
   */
  readonly httpApiStage: string

  /**
   * The RingCentral capture DLQ queue name. When provided, a depth alarm is
   * created (poison webhook-capture jobs). Optional so the stack still synths
   * in tests / environments that don't pass it.
   */
  readonly ringcentralCaptureDlqName?: string

  /**
   * Email address subscribed to all alarms (ALARM and OK transitions).
   * Omit to skip the subscription entirely (dev stays silent).
   *
   * Operational note: SNS email subscriptions require a one-time
   * confirmation click per address per topic — until the
   * "AWS Notification - Subscription Confirmation" email is clicked the
   * subscription sits in PendingConfirmation and deliveries drop.
   */
  readonly alarmEmail?: string

  /**
   * ECS cluster name for the Temporal worker
   * (`pegasus-temporal-worker-${envName}`). When provided together with
   * `temporalWorkerServiceName`, a `RunningTaskCount < 1` alarm is created.
   * Omit for dev (no Fargate worker there).
   */
  readonly temporalWorkerClusterName?: string

  /**
   * ECS service name for the Temporal worker. Same value as
   * `temporalWorkerClusterName` in the current naming convention
   * (`pegasus-temporal-worker-${envName}`).
   */
  readonly temporalWorkerServiceName?: string

  /**
   * Main API Lambda log-group name — used to scope the `pegasus/api-errors-by-route`
   * and `pegasus/trace-by-correlation-id` Insights query definitions. When absent
   * (dev / test), those query definitions are omitted.
   */
  readonly apiLogGroupName?: string

  /**
   * Scheduled-Lambda log-group names (cron functions). Used to scope the
   * `pegasus/cron-failures` Insights query definition. When absent or empty,
   * the cron-failures query is omitted.
   */
  readonly cronLogGroupNames?: string[]

  /**
   * Temporal worker log-group name (`/pegasus/${envName}/temporal-worker`).
   * Used to scope the `pegasus/temporal-worker-errors` Insights query.
   * When absent (dev / no worker stack), the query is omitted.
   */
  readonly temporalWorkerLogGroupName?: string
}

/**
 * MonitoringStack — CloudWatch alarms and dashboard for operational visibility.
 *
 * Resources created:
 *   - SNS topic: pegasus-alarms  (alarm notifications)
 *   - Alarm: Lambda Errors > 0 in 3 of the last 5 minutes
 *   - Alarm: API Gateway 5XXError > 1 per minute
 *   - Alarm: Lambda Duration p99 > 10 000 ms over 5 minutes
 *   - Dashboard: Pegasus-Operations
 */
export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props)

    // ── SNS topic ──────────────────────────────────────────────────────────────
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'pegasus-alarms',
    })

    if (props.alarmEmail) {
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail))
    }

    const snsAction = new cloudwatch_actions.SnsAction(alarmTopic)

    // Wire an alarm to the topic for BOTH state transitions: the ALARM page
    // and the OK recovery notice ("it self-healed at 3am" is as valuable as
    // the page itself for a solo operator).
    const wire = (alarm: cloudwatch.Alarm): void => {
      alarm.addAlarmAction(snsAction)
      alarm.addOkAction(snsAction)
    }

    // ── Lambda error alarm ─────────────────────────────────────────────────────
    const lambdaErrorsMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensionsMap: {
        FunctionName: props.lambdaFunctionName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
    })

    // Tuned to catch a sustained-failure regression — an api Lambda that
    // errors on every invocation (e.g. the cedar-wasm init crash from PR #91)
    // rather than a single bad request. On a low-traffic stage that broken
    // Lambda may never exceed a few errors per minute, so the trigger is
    // "any error" held for 3 of 5 minutes, not a per-minute count threshold.
    // This makes the alarm a deploy-cadence-independent safety net: a stage
    // left broken by a path-filtered deploy trips it within ~5 minutes.
    const lambdaErrorsAlarm = new cloudwatch.Alarm(this, 'LambdaErrorsAlarm', {
      alarmName: 'pegasus-lambda-errors',
      alarmDescription:
        'Lambda function reported errors in 3 of the last 5 minutes — likely a ' +
        'sustained regression (init crash, broken dependency) rather than a transient fault.',
      metric: lambdaErrorsMetric,
      threshold: 0,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    wire(lambdaErrorsAlarm)

    // ── API Gateway 5xx alarm ──────────────────────────────────────────────────
    const apigw5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: {
        ApiId: props.httpApiId,
        Stage: props.httpApiStage,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
    })

    const apigw5xxAlarm = new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: 'pegasus-apigw-5xx',
      alarmDescription: 'API Gateway 5xx errors exceed 1 per minute.',
      metric: apigw5xxMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    wire(apigw5xxAlarm)

    // ── Lambda p99 duration alarm ──────────────────────────────────────────────
    const lambdaDurationMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      dimensionsMap: {
        FunctionName: props.lambdaFunctionName,
      },
      // p99 requires ExtendedStatistic — CDK encodes this as the string 'p99'
      // which renders in CloudFormation as ExtendedStatistic: 'p99'.
      statistic: 'p99',
      period: cdk.Duration.minutes(5),
    })

    const lambdaDurationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationP99Alarm', {
      alarmName: 'pegasus-lambda-duration-p99',
      alarmDescription: 'Lambda p99 duration exceeds 10 seconds.',
      metric: lambdaDurationMetric,
      // 10 000 ms = 10 seconds. Lambda Duration metric is in milliseconds.
      threshold: 10000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    wire(lambdaDurationAlarm)

    // ── AVP policy-store count alarms ─────────────────────────────────────────
    // AWS Verified Permissions has a soft quota of ~100 policy stores per
    // Region per AWS account. Pegasus provisions one store per tenant via
    // POST /api/admin/tenants, so this metric is also our active-tenant count
    // in the AVP plane. The hourly emitter lives in ApiStack
    // (AvpStoreCountFunction → lambda-avp-store-count.ts).
    //
    // Two thresholds:
    //   - 60 → informational; start tracking onboarding velocity in the
    //          ops cadence
    //   - 80 → critical; file an AWS support ticket to raise the quota
    //          BEFORE provisioning more tenants, otherwise CreatePolicyStore
    //          will start failing with QuotaExceededException
    //
    // Period is 1 hour to match the emitter cadence; treatMissingData uses
    // BREACHING so a stuck publisher (which would otherwise mask an
    // over-quota state) trips the alarm instead of silently coasting.
    const avpStoreCountMetric = new cloudwatch.Metric({
      namespace: PEGASUS_AUTHZ_METRIC_NAMESPACE,
      metricName: AVP_POLICY_STORE_COUNT_METRIC_NAME,
      statistic: 'Maximum',
      period: cdk.Duration.hours(1),
    })

    const avpStoreCountWarnAlarm = new cloudwatch.Alarm(this, 'AvpStoreCountWarnAlarm', {
      alarmName: 'pegasus-avp-store-count-warn',
      alarmDescription:
        'AVP policy-store count crossed 60 (informational). Plan ahead — ' +
        'the AWS Verified Permissions soft quota is ~100 stores per Region per account.',
      metric: avpStoreCountMetric,
      threshold: 60,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
    wire(avpStoreCountWarnAlarm)

    const avpStoreCountCriticalAlarm = new cloudwatch.Alarm(this, 'AvpStoreCountCriticalAlarm', {
      alarmName: 'pegasus-avp-store-count-critical',
      alarmDescription:
        'AVP policy-store count crossed 80. File an AWS support ticket NOW to raise the ' +
        'Verified Permissions per-account policy-store quota before provisioning more tenants.',
      metric: avpStoreCountMetric,
      threshold: 80,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
    wire(avpStoreCountCriticalAlarm)

    // ── RingCentral capture-health alarms ──────────────────────────────────────
    // Gauges published every 15 min by the ringcentral-metrics emitter
    // (ApiStack → lambda-ringcentral-metrics.ts → Pegasus/RingCentral). The
    // feature is inert until RINGCENTRAL_ENABLED, and the emitter publishes 0s
    // while inert, so every alarm uses NOT_BREACHING — they stay green until the
    // feature is on AND something actually breaks, rather than paging on no-data.
    const rcGauge = (metricName: string, period = cdk.Duration.minutes(15)) =>
      new cloudwatch.Metric({
        namespace: PEGASUS_RINGCENTRAL_METRIC_NAMESPACE,
        metricName,
        statistic: 'Maximum',
        period,
      })

    const rcOutboxDeadMetric = rcGauge(RC_OUTBOX_DEAD_METRIC_NAME)
    const rcOutboxPendingMetric = rcGauge(RC_OUTBOX_PENDING_METRIC_NAME)
    const rcSubsDeadMetric = rcGauge(RC_SUBSCRIPTIONS_DEAD_METRIC_NAME)
    const rcConnUnhealthyMetric = rcGauge(RC_CONNECTIONS_UNHEALTHY_METRIC_NAME)
    const rcSyncLagMetric = rcGauge(RC_SYNC_LAG_SECONDS_METRIC_NAME)

    const rcAlarms: Array<{
      id: string
      name: string
      metric: cloudwatch.Metric
      threshold: number
      description: string
    }> = [
      {
        id: 'RcOutboxDeadAlarm',
        name: 'pegasus-rc-outbox-dead',
        metric: rcOutboxDeadMetric,
        threshold: 0, // any DEAD row = a forward that exhausted retries
        description:
          'RingCentral forward-outbox has dead-lettered rows — a captured SMS failed to ' +
          'reach on-prem after all retries. Investigate + manually redrive (set DEAD → PENDING).',
      },
      {
        id: 'RcSubscriptionsDeadAlarm',
        name: 'pegasus-rc-subscriptions-dead',
        metric: rcSubsDeadMetric,
        threshold: 0, // a dead/blacklisted subscription = no webhook delivery
        description:
          'A RingCentral webhook subscription is dead/blacklisted — near-real-time delivery ' +
          'is down for a connection (the reconciliation sync still backstops capture).',
      },
      {
        id: 'RcConnectionsUnhealthyAlarm',
        name: 'pegasus-rc-connections-unhealthy',
        metric: rcConnUnhealthyMetric,
        threshold: 0, // unhealthy = token refresh failing / connection broken
        description:
          'A RingCentral connection is UNHEALTHY — likely a failing token refresh. Capture ' +
          'for that tenant has stopped until the connection is repaired/reconnected.',
      },
      {
        id: 'RcOutboxBacklogAlarm',
        name: 'pegasus-rc-outbox-backlog',
        metric: rcOutboxPendingMetric,
        threshold: 500, // sustained backlog → on-prem unreachable or forwarder stuck
        description:
          'RingCentral forward-outbox backlog exceeds 500 pending rows — on-prem is likely ' +
          'unreachable or the forwarder is stalled. Rows park PENDING until on-prem recovers.',
      },
      {
        id: 'RcSyncLagAlarm',
        name: 'pegasus-rc-sync-lag',
        metric: rcSyncLagMetric,
        threshold: 3600, // oldest cursor >1h stale vs a 15-min sync cron
        description:
          'RingCentral sync lag exceeds 1 hour — the oldest cursor has not advanced, so ' +
          'capture is stalled (the safety-net sync runs every 15 min).',
      },
    ]

    for (const a of rcAlarms) {
      const alarm = new cloudwatch.Alarm(this, a.id, {
        alarmName: a.name,
        alarmDescription: a.description,
        metric: a.metric,
        threshold: a.threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })
      wire(alarm)
    }

    // ── RingCentral capture DLQ depth (native SQS metric) ──────────────────────
    let rcCaptureDlqMetric: cloudwatch.Metric | undefined
    if (props.ringcentralCaptureDlqName) {
      rcCaptureDlqMetric = new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { QueueName: props.ringcentralCaptureDlqName },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
      })
      const rcCaptureDlqAlarm = new cloudwatch.Alarm(this, 'RcCaptureDlqAlarm', {
        alarmName: 'pegasus-rc-capture-dlq',
        alarmDescription:
          'RingCentral capture DLQ has messages — webhook capture jobs failed past their ' +
          'redrive limit (poison events). Inspect the DLQ and redrive after fixing the cause.',
        metric: rcCaptureDlqMetric,
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })
      wire(rcCaptureDlqAlarm)
    }

    // ── Workflow plane alarms (Phase 3 Unit 11) ───────────────────────────────
    //
    // All four alarms emit into the Pegasus/Workflows namespace. The metric
    // names are duplicated here (not imported) for the same apps/api-can't-
    // import-@pegasus/infra reason as the emitters; this file IS in infra, so
    // it uses the exported constants from metrics.ts.
    //
    // Alarm descriptions name the log group /aws/lambda/* and metric source so
    // an operator paged at 3 am can find the relevant logs immediately.

    const wfMetric = (
      metricName: string,
      dimensions: Record<string, string> = {},
      statistic = 'Sum',
      period = cdk.Duration.minutes(15),
    ) =>
      new cloudwatch.Metric({
        namespace: PEGASUS_WORKFLOWS_METRIC_NAMESPACE,
        metricName,
        dimensionsMap: dimensions,
        statistic,
        period,
      })

    // TenantRunnerLaunchFailed > 0 in any 15-min window means QUEUED tenant
    // executions are stranded (no runner). Source: the API Lambda + dispatcher
    // Lambda emit this. Look in /aws/lambda/<api-function-name> for
    // "Tenant-runner launch failed" or "Tenant-runner RunTask did not launch".
    const runnerLaunchFailedMetric = wfMetric(TENANT_RUNNER_LAUNCH_FAILED_METRIC_NAME)
    const runnerLaunchFailedAlarm = new cloudwatch.Alarm(this, 'TenantRunnerLaunchFailedAlarm', {
      alarmName: 'pegasus-tenant-runner-launch-failed',
      alarmDescription:
        'One or more tenant-runner ECS task launches failed in the last 15 min — QUEUED ' +
        'tenant-workflow executions may be stranded. Source: Pegasus/Workflows ' +
        TENANT_RUNNER_LAUNCH_FAILED_METRIC_NAME +
        '. Check /aws/lambda/* for "Tenant-runner launch failed" or RunTask failures[].',
      metric: runnerLaunchFailedMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    wire(runnerLaunchFailedAlarm)

    // DomainEventDispatchBacklog > 0 means the dispatcher processed its 100-
    // event tick cap without draining all pending events. If it fires on every
    // tick it means the backlog is growing faster than the 1-min dispatcher
    // can drain. Source: lambda-dispatch-workflow-triggers. Log group:
    // /aws/lambda/<dispatcher-function-name>.
    const dispatchBacklogMetric = wfMetric(
      'DomainEventDispatchBacklog',
      {},
      'Sum',
      cdk.Duration.minutes(5),
    )
    const dispatchBacklogAlarm = new cloudwatch.Alarm(this, 'DomainEventDispatchBacklogAlarm', {
      alarmName: 'pegasus-domain-event-dispatch-backlog',
      alarmDescription:
        'Domain-event dispatch backlog hit the per-tick cap (100 events) at least once in the ' +
        'last 5 min — the outbox is growing faster than the dispatcher drains it. ' +
        'Source: Pegasus/Workflows DomainEventDispatchBacklog. Check /aws/lambda/* for ' +
        '"tick cap reached" or high domain-events table row counts.',
      metric: dispatchBacklogMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    wire(dispatchBacklogAlarm)

    // WorkflowExecutionReconciled > 5 in an hour means the reconcile poller is
    // finding crashed workers at a concerning rate. A single occasional reconcile
    // is normal (transient crash); sustained means runners are crashing mid-
    // execution. Source: lambda-reconcile-workflow-executions. Log group:
    // /aws/lambda/<reconcile-function-name>.
    const reconciledMetric = wfMetric(
      WORKFLOW_EXECUTION_RECONCILED_METRIC_NAME,
      {},
      'Sum',
      cdk.Duration.hours(1),
    )
    const reconciledAlarm = new cloudwatch.Alarm(this, 'WorkflowExecutionReconciledAlarm', {
      alarmName: 'pegasus-workflow-execution-reconciled',
      alarmDescription:
        'More than 5 workflow executions were reconciled (crashed-runner recovery) in the last ' +
        'hour — tenant-runners are crashing mid-execution at an elevated rate. ' +
        'Source: Pegasus/Workflows ' +
        WORKFLOW_EXECUTION_RECONCILED_METRIC_NAME +
        '. Check /aws/lambda/* for "Reconciled stale execution" log entries and ECS task ' +
        'stop reasons in the ECS console (cluster: pegasus-temporal-worker-*).',
      metric: reconciledMetric,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    wire(reconciledAlarm)

    // WorkflowTriggerSkipped{Reason=START_FAILED} > 0 in 15 min means at least
    // one trigger failed to start a workflow on Temporal. Persistent means a
    // hard Temporal connectivity problem. Source: lambda-dispatch-workflow-
    // triggers. Log group: /aws/lambda/<dispatcher-function-name>.
    const triggerSkippedStartFailedMetric = wfMetric(
      'WorkflowTriggerSkipped',
      { Reason: 'START_FAILED' },
      'Sum',
      cdk.Duration.minutes(15),
    )
    const triggerSkippedAlarm = new cloudwatch.Alarm(
      this,
      'WorkflowTriggerSkippedStartFailedAlarm',
      {
        alarmName: 'pegasus-workflow-trigger-skipped-start-failed',
        alarmDescription:
          'One or more workflow triggers were skipped with reason START_FAILED in the last ' +
          '15 min — Temporal workflow starts are failing. Source: Pegasus/Workflows ' +
          'WorkflowTriggerSkipped{Reason=START_FAILED}. Check /aws/lambda/* for ' +
          '"Workflow execution start failed" and verify Temporal Cloud connectivity.',
        metric: triggerSkippedStartFailedMetric,
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      },
    )
    wire(triggerSkippedAlarm)

    // Helper metrics for the workflow dashboard (no alarm on these — used only
    // for observability widgets).
    const runnerLaunchedMetric = wfMetric(
      TENANT_RUNNER_LAUNCHED_METRIC_NAME,
      {},
      'Sum',
      cdk.Duration.minutes(15),
    )
    const runnersRunningMetric = wfMetric(
      TENANT_RUNNERS_RUNNING_METRIC_NAME,
      {},
      'Maximum',
      cdk.Duration.minutes(1),
    )
    const runnerColdStartMetric = wfMetric(
      TENANT_RUNNER_COLD_START_SECONDS_METRIC_NAME,
      {},
      'p90',
      cdk.Duration.minutes(15),
    )
    const triggerFiredMetric = wfMetric('WorkflowTriggerFired', {}, 'Sum', cdk.Duration.minutes(15))
    const triggerSkippedAllMetric = wfMetric(
      'WorkflowTriggerSkipped',
      {},
      'Sum',
      cdk.Duration.minutes(15),
    )
    const executionRejectedConcurrency = wfMetric(
      'WorkflowExecutionRejected',
      { Reason: 'CONCURRENCY_LIMIT' },
      'Sum',
      cdk.Duration.minutes(15),
    )
    const executionRejectedQuota = wfMetric(
      'WorkflowExecutionRejected',
      { Reason: 'DAILY_QUOTA_EXCEEDED' },
      'Sum',
      cdk.Duration.minutes(15),
    )

    // ── Account-wide Lambda Throttles alarm (Phase 1) ─────────────────────────
    // Undimensioned → aggregates across ALL Lambda functions in the account/region.
    // One alarm covers every current and future function — critical given the
    // account-wide 10-concurrent-execution cap (Service Quotas L-B99A9384) that
    // already caused the AppGuard incident.
    const accountThrottlesMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Throttles', // no dimensionsMap → account-wide
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
    })

    const accountThrottlesAlarm = new cloudwatch.Alarm(this, 'AccountLambdaThrottlesAlarm', {
      alarmName: 'pegasus-lambda-throttles-account',
      alarmDescription:
        'Any Lambda in the account is being throttled — likely the 10-concurrent-execution ' +
        'account cap (Service Quotas L-B99A9384). Symptoms cascade as 5xx (AppGuard incident).',
      metric: accountThrottlesMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    wire(accountThrottlesAlarm)

    // ── Account-wide Lambda Errors alarm (Phase 1) ────────────────────────────
    // Covers the 13+ functions not scoped by the per-API-fn alarm: 8 cron
    // Lambdas, 3 Cognito triggers, document converter, mssql-executor, and any
    // function added in the future. The existing per-API-fn alarm is retained —
    // it has a sharper description and the API fn is the highest-traffic one.
    const accountErrorsMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors', // no dimensionsMap → account-wide
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
    })

    const accountErrorsAlarm = new cloudwatch.Alarm(this, 'AccountLambdaErrorsAlarm', {
      alarmName: 'pegasus-lambda-errors-account',
      alarmDescription:
        'Any Lambda in the account reported errors in 3 of the last 5 minutes — covers ' +
        'scheduled/cron functions (AVP, RingCentral, reconcile, document converter, ' +
        'mssql-executor) whose failures are otherwise invisible.',
      metric: accountErrorsMetric,
      threshold: 0,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    wire(accountErrorsAlarm)

    // ── Temporal worker RunningTaskCount alarm (Phase 1) ──────────────────────
    // Only created in staging/prod — dev has no Fargate worker.
    // 5-of-5 evaluation window tolerates the brief task-count dip during
    // rolling deploys (desiredCount: 1 — a normal image roll completes in well
    // under 5 min). BREACHING on missing data: Container Insights emits no
    // datapoint when zero tasks ran all period — missing data IS the failure mode.
    let runningTasksMetric: cloudwatch.Metric | undefined
    if (props.temporalWorkerClusterName && props.temporalWorkerServiceName) {
      runningTasksMetric = new cloudwatch.Metric({
        namespace: 'ECS/ContainerInsights',
        metricName: 'RunningTaskCount',
        dimensionsMap: {
          ClusterName: props.temporalWorkerClusterName,
          ServiceName: props.temporalWorkerServiceName,
        },
        statistic: 'Minimum',
        period: cdk.Duration.minutes(1),
      })
      const temporalWorkerDownAlarm = new cloudwatch.Alarm(this, 'TemporalWorkerDownAlarm', {
        alarmName: 'pegasus-temporal-worker-down',
        alarmDescription:
          'Temporal worker RunningTaskCount < 1 for 5 consecutive minutes — the worker is ' +
          'crash-looping or stopped; workflow executions will sit RUNNING until reconciled.',
        metric: runningTasksMetric,
        threshold: 1,
        evaluationPeriods: 5,
        datapointsToAlarm: 5,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      })
      wire(temporalWorkerDownAlarm)
    }

    // (Workflow-execution-reconciled alarm lives in the Phase 3 Unit 11
    // workflow-plane block above — pegasus-workflow-execution-reconciled — so
    // this plan does not add a second one.)

    // ── CloudWatch Logs Insights saved queries (Phase 2) ──────────────────────
    // Appear in the console query picker so investigation is "pick query, set
    // time range" rather than writing PPL from memory. Gated on the optional
    // props so the stack synths cleanly in dev / tests without log-group tokens.

    if (props.apiLogGroupName) {
      new logs.QueryDefinition(this, 'QueryApiErrors', {
        queryDefinitionName: 'pegasus/api-errors-by-route',
        queryString: new logs.QueryString({
          fields: ['@timestamp', 'level', 'path', 'message', 'correlationId'],
          filterStatements: ['level = "ERROR"'],
          statsStatements: ['count(*) as errors by path'],
          sort: 'errors desc',
        }),
        logGroups: [logs.LogGroup.fromLogGroupName(this, 'ApiLogGroupRef', props.apiLogGroupName)],
      })

      new logs.QueryDefinition(this, 'QueryTraceByCorrelationId', {
        queryDefinitionName: 'pegasus/trace-by-correlation-id',
        queryString: new logs.QueryString({
          fields: ['@timestamp', 'level', 'message'],
          filterStatements: ['correlationId = "PASTE_ID"'],
          sort: '@timestamp asc',
        }),
        logGroups: [
          logs.LogGroup.fromLogGroupName(this, 'ApiLogGroupRefTrace', props.apiLogGroupName),
        ],
      })
    }

    if (props.cronLogGroupNames && props.cronLogGroupNames.length > 0) {
      new logs.QueryDefinition(this, 'QueryCronFailures', {
        queryDefinitionName: 'pegasus/cron-failures',
        queryString: new logs.QueryString({
          fields: ['@timestamp', '@log', '@message'],
          filterStatements: ['@message like /ERROR|Task timed out/'],
          sort: '@timestamp desc',
        }),
        logGroups: props.cronLogGroupNames.map((name, i) =>
          logs.LogGroup.fromLogGroupName(this, `CronLogGroupRef${i}`, name),
        ),
      })
    }

    if (props.temporalWorkerLogGroupName) {
      new logs.QueryDefinition(this, 'QueryTemporalWorkerErrors', {
        queryDefinitionName: 'pegasus/temporal-worker-errors',
        queryString: new logs.QueryString({
          fields: ['@timestamp', 'level', 'message'],
          filterStatements: ['level = "ERROR"'],
          sort: '@timestamp desc',
        }),
        logGroups: [
          logs.LogGroup.fromLogGroupName(
            this,
            'TemporalWorkerLogGroupRef',
            props.temporalWorkerLogGroupName,
          ),
        ],
      })
    }

    // ── CloudWatch dashboard ───────────────────────────────────────────────────
    new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: 'Pegasus-Operations',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Lambda Errors',
            left: [lambdaErrorsMetric],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'API Gateway 5xx Errors',
            left: [apigw5xxMetric],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Lambda Duration p99',
            left: [lambdaDurationMetric],
            width: 8,
          }),
        ],
        [
          new cloudwatch.SingleValueWidget({
            title: 'AVP Policy Stores (current)',
            metrics: [avpStoreCountMetric],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'AVP Policy Store Count (trend)',
            left: [avpStoreCountMetric],
            // Annotate the soft-quota-warning thresholds inline so the chart
            // shows where 60 / 80 sit relative to the current count.
            leftAnnotations: [
              { value: 60, label: 'Warn (60)', color: cloudwatch.Color.ORANGE },
              { value: 80, label: 'Critical (80)', color: cloudwatch.Color.RED },
            ],
            width: 16,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'RingCentral Outbox (pending / dead)',
            left: [rcOutboxPendingMetric, rcOutboxDeadMetric],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'RingCentral Subscriptions Dead / Connections Unhealthy',
            left: [rcSubsDeadMetric, rcConnUnhealthyMetric],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'RingCentral Sync Lag (s)',
            left: [rcSyncLagMetric],
            leftAnnotations: [
              { value: 3600, label: 'Lag alarm (1h)', color: cloudwatch.Color.RED },
            ],
            ...(rcCaptureDlqMetric ? { right: [rcCaptureDlqMetric] } : {}),
            width: 8,
          }),
        ],
        // ── Phase 1: account-wide + worker metrics ──────────────────────────
        [
          new cloudwatch.GraphWidget({
            title: 'Account Lambda Errors (all functions)',
            left: [accountErrorsMetric],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Account Lambda Throttles (all functions)',
            left: [accountThrottlesMetric],
            width: 8,
          }),
          ...(runningTasksMetric
            ? [
                new cloudwatch.GraphWidget({
                  title: 'Temporal Worker Running Tasks',
                  left: [runningTasksMetric],
                  leftAnnotations: [
                    { value: 1, label: 'Alarm threshold (< 1)', color: cloudwatch.Color.RED },
                  ],
                  width: 8,
                }),
              ]
            : []),
          // Workflow-execution-reconciled is visualised on the dedicated
          // Pegasus-Workflows dashboard (Phase 3 Unit 11), so no widget here.
        ],
      ],
    })

    // ── Workflow execution plane dashboard (Phase 3 Unit 11) ─────────────────
    new cloudwatch.Dashboard(this, 'WorkflowsDashboard', {
      dashboardName: 'Pegasus-Workflows',
      widgets: [
        // Row 1: Runner pool health
        [
          new cloudwatch.SingleValueWidget({
            title: 'Runners running (now)',
            metrics: [runnersRunningMetric],
            width: 6,
          }),
          new cloudwatch.GraphWidget({
            title: 'Runner pool size (running count)',
            left: [runnersRunningMetric],
            width: 9,
          }),
          new cloudwatch.GraphWidget({
            title: 'Runner cold start p90 (s)',
            left: [runnerColdStartMetric],
            leftAnnotations: [
              { value: 60, label: 'Expected max (60s)', color: cloudwatch.Color.ORANGE },
            ],
            width: 9,
          }),
        ],
        // Row 2: Launch outcomes
        [
          new cloudwatch.GraphWidget({
            title: 'Runner launches / failures (15-min)',
            left: [runnerLaunchedMetric],
            right: [runnerLaunchFailedMetric],
            leftAnnotations: [],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: 'Workflow execution rejections (15-min)',
            left: [executionRejectedConcurrency, executionRejectedQuota],
            width: 12,
          }),
        ],
        // Row 3: Trigger throughput
        [
          new cloudwatch.GraphWidget({
            title: 'Triggers fired / skipped (15-min)',
            left: [triggerFiredMetric],
            right: [triggerSkippedAllMetric],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: 'Domain event dispatch backlog (5-min)',
            left: [dispatchBacklogMetric],
            leftAnnotations: [{ value: 0, label: 'Alarm threshold', color: cloudwatch.Color.RED }],
            width: 12,
          }),
        ],
        // Row 4: Reconcile (crash indicator)
        [
          new cloudwatch.GraphWidget({
            title: 'Executions reconciled by poller (hourly) — elevated = runner crashes',
            left: [reconciledMetric],
            leftAnnotations: [
              { value: 5, label: 'Alarm threshold (5/hr)', color: cloudwatch.Color.RED },
            ],
            width: 24,
          }),
        ],
      ],
    })
  }
}
