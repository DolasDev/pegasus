import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { MonitoringStack } from '../monitoring-stack'

function synthMonitoringStack() {
  const app = new cdk.App()
  const stack = new MonitoringStack(app, 'TestMonitoring', {
    lambdaFunctionName: 'test-api-function',
    httpApiId: 'abc123def4',
    httpApiStage: '$default',
    ringcentralCaptureDlqName: 'test-rc-capture-dlq',
    alarmEmail: 'alerts@example.com',
  })
  return Template.fromStack(stack)
}

function synthMonitoringStackWithoutDlq() {
  const app = new cdk.App()
  const stack = new MonitoringStack(app, 'TestMonitoringNoDlq', {
    lambdaFunctionName: 'test-api-function',
    httpApiId: 'abc123def4',
    httpApiStage: '$default',
  })
  return Template.fromStack(stack)
}

function synthMonitoringStackWithWorker() {
  const app = new cdk.App()
  const stack = new MonitoringStack(app, 'TestMonitoringWorker', {
    lambdaFunctionName: 'test-api-function',
    httpApiId: 'abc123def4',
    httpApiStage: '$default',
    ringcentralCaptureDlqName: 'test-rc-capture-dlq',
    alarmEmail: 'alerts@example.com',
    temporalWorkerClusterName: 'pegasus-temporal-worker-staging',
    temporalWorkerServiceName: 'pegasus-temporal-worker-staging',
  })
  return Template.fromStack(stack)
}

function synthMonitoringStackWithQueries() {
  const app = new cdk.App()
  const stack = new MonitoringStack(app, 'TestMonitoringQueries', {
    lambdaFunctionName: 'test-api-function',
    httpApiId: 'abc123def4',
    httpApiStage: '$default',
    alarmEmail: 'alerts@example.com',
    apiLogGroupName: '/aws/lambda/test-api-function',
    apiAccessLogGroupName: '/pegasus/staging/api-access',
    cronLogGroupNames: ['/aws/lambda/cron-one', '/aws/lambda/cron-two'],
    temporalWorkerLogGroupName: '/pegasus/staging/temporal-worker',
  })
  return Template.fromStack(stack)
}

describe('MonitoringStack — SNS topic', () => {
  it('creates exactly one SNS topic for alarm notifications', () => {
    const template = synthMonitoringStack()
    template.resourceCountIs('AWS::SNS::Topic', 1)
  })

  it('names the SNS topic correctly', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'pegasus-alarms',
    })
  })
})

describe('MonitoringStack — alarm email subscription', () => {
  it('subscribes the alarm email to the topic when alarmEmail is provided', () => {
    const template = synthMonitoringStack()
    template.resourceCountIs('AWS::SNS::Subscription', 1)
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alerts@example.com',
    })
  })

  it('creates no subscription when alarmEmail is absent (dev stays silent)', () => {
    const template = synthMonitoringStackWithoutDlq()
    template.resourceCountIs('AWS::SNS::Subscription', 0)
  })
})

describe('MonitoringStack — OK actions', () => {
  it('wires every alarm with both AlarmActions and OKActions', () => {
    const template = synthMonitoringStack()
    const alarms = template.findResources('AWS::CloudWatch::Alarm')
    // 11 original + 4 workflow-plane (Unit 11) + 2 account-wide (throttles,
    // errors) + 1 rating (FSC-update failure) = 18. No worker-down alarm here
    // (default synth has no worker props); reconcile alarm is Unit 11's.
    expect(Object.keys(alarms)).toHaveLength(18)
    for (const [id, alarm] of Object.entries(alarms)) {
      expect(alarm['Properties']?.['AlarmActions'], `${id} AlarmActions`).toHaveLength(1)
      expect(alarm['Properties']?.['OKActions'], `${id} OKActions`).toHaveLength(1)
    }
  })
})

describe('MonitoringStack — Lambda error alarm', () => {
  it('creates a Lambda errors alarm', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Statistic: 'Sum',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
    })
  })

  it('trips the Lambda errors alarm on any error sustained 3 of 5 minutes', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Period: 60,
      EvaluationPeriods: 5,
      DatapointsToAlarm: 3,
    })
  })

  it('wires the Lambda errors alarm to the SNS topic', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
    })
  })
})

describe('MonitoringStack — API Gateway 5xx alarm', () => {
  it('creates an API Gateway 5xx alarm', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/ApiGateway',
      MetricName: '5XXError',
      Threshold: 1,
      ComparisonOperator: 'GreaterThanThreshold',
    })
  })

  it('evaluates the API Gateway 5xx alarm over a 1-minute period', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/ApiGateway',
      MetricName: '5XXError',
      Period: 60,
      EvaluationPeriods: 1,
    })
  })

  it('wires the API Gateway 5xx alarm to the SNS topic', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/ApiGateway',
      MetricName: '5XXError',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
    })
  })
})

describe('MonitoringStack — Lambda p99 duration alarm', () => {
  it('creates a Lambda p99 duration alarm', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Duration',
      ExtendedStatistic: 'p99',
      Threshold: 10000,
      ComparisonOperator: 'GreaterThanThreshold',
    })
  })

  it('de-flaps the p99 duration alarm with a 2-of-3 five-minute window', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Duration',
      ExtendedStatistic: 'p99',
      Period: 300,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 2,
    })
  })

  it('wires the Lambda p99 duration alarm to the SNS topic', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Duration',
      ExtendedStatistic: 'p99',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
    })
  })
})

describe('MonitoringStack — AVP policy-store count alarms', () => {
  it('creates a warn alarm at 60 stores on the Pegasus/Authorization namespace', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'Pegasus/Authorization',
      MetricName: 'PolicyStoreCount',
      Threshold: 60,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'breaching',
    })
  })

  it('creates a critical alarm at 80 stores on the Pegasus/Authorization namespace', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'Pegasus/Authorization',
      MetricName: 'PolicyStoreCount',
      Threshold: 80,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'breaching',
    })
  })

  it('wires both AVP alarms to the SNS topic', () => {
    const template = synthMonitoringStack()
    // Both alarms register an action — assert by alarm name to disambiguate
    // from the AWS/Lambda + AWS/ApiGateway alarms that share the topic.
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-avp-store-count-warn',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
    })
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-avp-store-count-critical',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
    })
  })
})

describe('MonitoringStack — CloudWatch dashboards', () => {
  it('creates exactly two CloudWatch dashboards', () => {
    const template = synthMonitoringStack()
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 2)
  })

  it('names the operations dashboard correctly', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'Pegasus-Operations',
    })
  })

  it('names the workflows dashboard correctly', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'Pegasus-Workflows',
    })
  })
})

describe('MonitoringStack — RingCentral capture-health alarms', () => {
  it('alarms on any dead forward-outbox row (NOT_BREACHING while inert)', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-rc-outbox-dead',
      Namespace: 'Pegasus/RingCentral',
      MetricName: 'OutboxDead',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('alarms on dead subscriptions and unhealthy connections', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-rc-subscriptions-dead',
      MetricName: 'SubscriptionsDead',
      Threshold: 0,
    })
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-rc-connections-unhealthy',
      MetricName: 'ConnectionsUnhealthy',
      Threshold: 0,
    })
  })

  it('alarms on a sustained outbox backlog (>500) and sync lag (>1h)', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-rc-outbox-backlog',
      MetricName: 'OutboxPending',
      Threshold: 500,
    })
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-rc-sync-lag',
      MetricName: 'SyncLagSeconds',
      Threshold: 3600,
    })
  })

  it('alarms on capture DLQ depth when a queue name is provided', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-rc-capture-dlq',
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Threshold: 0,
    })
  })

  it('omits the DLQ alarm when no queue name is provided', () => {
    const template = synthMonitoringStackWithoutDlq()
    const alarms = template.findResources('AWS::CloudWatch::Alarm', {
      Properties: { AlarmName: 'pegasus-rc-capture-dlq' },
    })
    expect(Object.keys(alarms)).toHaveLength(0)
  })
})

describe('MonitoringStack — alarm count', () => {
  it('creates 18 alarms (3 service + 2 AVP + 5 RC gauges + 1 DLQ + 4 workflow-plane + 2 account-wide + 1 rating)', () => {
    const template = synthMonitoringStack()
    template.resourceCountIs('AWS::CloudWatch::Alarm', 18)
  })

  it('creates 17 alarms when the capture DLQ name is absent', () => {
    const template = synthMonitoringStackWithoutDlq()
    template.resourceCountIs('AWS::CloudWatch::Alarm', 17)
  })

  it('creates 19 alarms when the temporal worker props are provided (+1 RunningTaskCount)', () => {
    const template = synthMonitoringStackWithWorker()
    template.resourceCountIs('AWS::CloudWatch::Alarm', 19)
  })

  it('creates the FSC-update failure alarm on Pegasus/Rating, NOT_BREACHING, wired to SNS', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-fsc-update-failure',
      Namespace: 'Pegasus/Rating',
      MetricName: 'FscUpdateFailure',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
      OKActions: Match.arrayWith([Match.objectLike({})]),
    })
  })
})

describe('MonitoringStack — workflow execution-plane alarms (Phase 3 Unit 11)', () => {
  it('alarms on any tenant-runner launch failure in 15 min', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-tenant-runner-launch-failed',
      Namespace: 'Pegasus/Workflows',
      MetricName: 'TenantRunnerLaunchFailed',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('alarms on a non-zero domain-event dispatch backlog in 5 min', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-domain-event-dispatch-backlog',
      Namespace: 'Pegasus/Workflows',
      MetricName: 'DomainEventDispatchBacklog',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('alarms when more than 5 executions are reconciled in an hour (elevated crash rate)', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-workflow-execution-reconciled',
      Namespace: 'Pegasus/Workflows',
      MetricName: 'WorkflowExecutionReconciled',
      Threshold: 5,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('alarms on any trigger skipped with START_FAILED reason in 15 min', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-workflow-trigger-skipped-start-failed',
      Namespace: 'Pegasus/Workflows',
      MetricName: 'WorkflowTriggerSkipped',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('wires all four workflow alarms to the SNS topic', () => {
    const template = synthMonitoringStack()
    for (const name of [
      'pegasus-tenant-runner-launch-failed',
      'pegasus-domain-event-dispatch-backlog',
      'pegasus-workflow-execution-reconciled',
      'pegasus-workflow-trigger-skipped-start-failed',
    ]) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: name,
        AlarmActions: Match.arrayWith([Match.objectLike({})]),
        OKActions: Match.arrayWith([Match.objectLike({})]),
      })
    }
  })
})

describe('MonitoringStack — account-wide Lambda Throttles alarm (Phase 1)', () => {
  it('creates an account-wide Throttles alarm on the AWS/Lambda namespace without dimensions', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-lambda-throttles-account',
      Namespace: 'AWS/Lambda',
      MetricName: 'Throttles',
      Statistic: 'Sum',
      Threshold: 0,
      EvaluationPeriods: 1,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('wires the account-wide Throttles alarm to the SNS topic', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-lambda-throttles-account',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
      OKActions: Match.arrayWith([Match.objectLike({})]),
    })
  })
})

describe('MonitoringStack — account-wide Lambda Errors alarm (Phase 1)', () => {
  it('creates an account-wide Lambda Errors alarm covering all functions', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-lambda-errors-account',
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Statistic: 'Sum',
      Threshold: 0,
      EvaluationPeriods: 5,
      DatapointsToAlarm: 3,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    })
  })

  it('wires the account-wide Errors alarm to the SNS topic', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-lambda-errors-account',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
      OKActions: Match.arrayWith([Match.objectLike({})]),
    })
  })
})

describe('MonitoringStack — Temporal worker RunningTaskCount alarm (Phase 1)', () => {
  it('creates a RunningTaskCount alarm when temporal worker props are provided', () => {
    const template = synthMonitoringStackWithWorker()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-temporal-worker-down',
      Namespace: 'ECS/ContainerInsights',
      MetricName: 'RunningTaskCount',
      Statistic: 'Minimum',
      Threshold: 1,
      EvaluationPeriods: 5,
      DatapointsToAlarm: 5,
      ComparisonOperator: 'LessThanThreshold',
      TreatMissingData: 'breaching',
      Dimensions: [
        { Name: 'ClusterName', Value: 'pegasus-temporal-worker-staging' },
        { Name: 'ServiceName', Value: 'pegasus-temporal-worker-staging' },
      ],
    })
  })

  it('omits the RunningTaskCount alarm when temporal worker props are absent', () => {
    const template = synthMonitoringStackWithoutDlq()
    const alarms = template.findResources('AWS::CloudWatch::Alarm', {
      Properties: { AlarmName: 'pegasus-temporal-worker-down' },
    })
    expect(Object.keys(alarms)).toHaveLength(0)
  })

  it('wires the RunningTaskCount alarm to the SNS topic', () => {
    const template = synthMonitoringStackWithWorker()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-temporal-worker-down',
      AlarmActions: Match.arrayWith([Match.objectLike({})]),
      OKActions: Match.arrayWith([Match.objectLike({})]),
    })
  })
})

describe('MonitoringStack — Logs Insights query definitions (Phase 2)', () => {
  it('creates 7 query definitions when all log-group props are provided', () => {
    const template = synthMonitoringStackWithQueries()
    template.resourceCountIs('AWS::Logs::QueryDefinition', 7)
  })

  it('creates the api-errors-by-route query scoped to the api log group', () => {
    const template = synthMonitoringStackWithQueries()
    template.hasResourceProperties('AWS::Logs::QueryDefinition', {
      Name: 'pegasus/api-errors-by-route',
      LogGroupNames: ['/aws/lambda/test-api-function'],
    })
  })

  it('creates the trace-by-correlation-id query scoped to the api log group', () => {
    const template = synthMonitoringStackWithQueries()
    template.hasResourceProperties('AWS::Logs::QueryDefinition', {
      Name: 'pegasus/trace-by-correlation-id',
      LogGroupNames: ['/aws/lambda/test-api-function'],
    })
  })

  it('creates the cron-failures query scoped to the cron log groups', () => {
    const template = synthMonitoringStackWithQueries()
    template.hasResourceProperties('AWS::Logs::QueryDefinition', {
      Name: 'pegasus/cron-failures',
      LogGroupNames: ['/aws/lambda/cron-one', '/aws/lambda/cron-two'],
    })
  })

  it('creates the temporal-worker-errors query scoped to the worker log group', () => {
    const template = synthMonitoringStackWithQueries()
    template.hasResourceProperties('AWS::Logs::QueryDefinition', {
      Name: 'pegasus/temporal-worker-errors',
      LogGroupNames: ['/pegasus/staging/temporal-worker'],
    })
  })

  it('creates the api-latency-by-route query ranking routes by p99 durationMs', () => {
    const template = synthMonitoringStackWithQueries()
    template.hasResourceProperties('AWS::Logs::QueryDefinition', {
      Name: 'pegasus/api-latency-by-route',
      LogGroupNames: ['/aws/lambda/test-api-function'],
      QueryString: Match.stringLikeRegexp(
        '[\\s\\S]*request\\.completed[\\s\\S]*pct\\(durationMs, 99\\)[\\s\\S]*',
      ),
    })
  })

  it('creates the api-slow-requests triage query over 5s', () => {
    const template = synthMonitoringStackWithQueries()
    template.hasResourceProperties('AWS::Logs::QueryDefinition', {
      Name: 'pegasus/api-slow-requests',
      LogGroupNames: ['/aws/lambda/test-api-function'],
      QueryString: Match.stringLikeRegexp('[\\s\\S]*durationMs > 5000[\\s\\S]*'),
    })
  })

  it('creates the api-access-by-route query scoped to the access-log group', () => {
    const template = synthMonitoringStackWithQueries()
    template.hasResourceProperties('AWS::Logs::QueryDefinition', {
      Name: 'pegasus/api-access-by-route',
      LogGroupNames: ['/pegasus/staging/api-access'],
    })
  })

  it('creates no query definitions when log-group props are absent', () => {
    const template = synthMonitoringStackWithoutDlq()
    template.resourceCountIs('AWS::Logs::QueryDefinition', 0)
  })
})
