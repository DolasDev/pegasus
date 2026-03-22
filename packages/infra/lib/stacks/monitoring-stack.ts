import * as cdk from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as sns from 'aws-cdk-lib/aws-sns'
import { type Construct } from 'constructs'

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
 *   - Alarm: Lambda Errors > 5 per minute
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

    const lambdaErrorsAlarm = new cloudwatch.Alarm(this, 'LambdaErrorsAlarm', {
      alarmName: 'pegasus-lambda-errors',
      alarmDescription: 'Lambda function errors exceed 5 per minute.',
      metric: lambdaErrorsMetric,
      threshold: 5,
      evaluationPeriods: 1,
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
      ],
    })
  }
}
