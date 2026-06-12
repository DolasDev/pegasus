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
    // 11 original + 4 workflow-plane alarms (Phase 3 Unit 11) = 15
    expect(Object.keys(alarms)).toHaveLength(15)
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

  it('evaluates the Lambda p99 duration alarm over a 5-minute period', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Duration',
      ExtendedStatistic: 'p99',
      Period: 300,
      EvaluationPeriods: 1,
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
  it('creates 15 alarms (3 service + 2 AVP + 5 RingCentral gauges + 1 capture DLQ + 4 workflows)', () => {
    const template = synthMonitoringStack()
    template.resourceCountIs('AWS::CloudWatch::Alarm', 15)
  })

  it('creates 14 alarms when the capture DLQ name is absent', () => {
    const template = synthMonitoringStackWithoutDlq()
    template.resourceCountIs('AWS::CloudWatch::Alarm', 14)
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
