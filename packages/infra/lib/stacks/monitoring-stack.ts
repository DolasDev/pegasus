import * as cdk from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as sns from 'aws-cdk-lib/aws-sns'
import { type Construct } from 'constructs'
import {
  AVP_POLICY_STORE_COUNT_METRIC_NAME,
  PEGASUS_AUTHZ_METRIC_NAMESPACE,
  PEGASUS_RINGCENTRAL_METRIC_NAMESPACE,
  RC_OUTBOX_PENDING_METRIC_NAME,
  RC_OUTBOX_DEAD_METRIC_NAME,
  RC_SUBSCRIPTIONS_DEAD_METRIC_NAME,
  RC_CONNECTIONS_UNHEALTHY_METRIC_NAME,
  RC_SYNC_LAG_SECONDS_METRIC_NAME,
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

    const snsAction = new cloudwatch_actions.SnsAction(alarmTopic)

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

    lambdaErrorsAlarm.addAlarmAction(snsAction)

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

    apigw5xxAlarm.addAlarmAction(snsAction)

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

    lambdaDurationAlarm.addAlarmAction(snsAction)

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
    avpStoreCountWarnAlarm.addAlarmAction(snsAction)

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
    avpStoreCountCriticalAlarm.addAlarmAction(snsAction)

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
      alarm.addAlarmAction(snsAction)
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
      rcCaptureDlqAlarm.addAlarmAction(snsAction)
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
      ],
    })
  }
}
