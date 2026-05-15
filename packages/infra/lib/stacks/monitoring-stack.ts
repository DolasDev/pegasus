import * as cdk from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as sns from 'aws-cdk-lib/aws-sns'
import { type Construct } from 'constructs'
import { AVP_POLICY_STORE_COUNT_METRIC_NAME, PEGASUS_AUTHZ_METRIC_NAMESPACE } from '../metrics'

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
      ],
    })
  }
}
