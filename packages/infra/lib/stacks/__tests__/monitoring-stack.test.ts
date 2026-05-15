import { describe, it } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { MonitoringStack } from '../monitoring-stack'

function synthMonitoringStack() {
  const app = new cdk.App()
  const stack = new MonitoringStack(app, 'TestMonitoring', {
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

describe('MonitoringStack — CloudWatch dashboard', () => {
  it('creates exactly one CloudWatch dashboard', () => {
    const template = synthMonitoringStack()
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1)
  })

  it('names the dashboard correctly', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'Pegasus-Operations',
    })
  })
})

describe('MonitoringStack — alarm count', () => {
  it('creates exactly five CloudWatch alarms (3 service alarms + 2 AVP store-count alarms)', () => {
    const template = synthMonitoringStack()
    template.resourceCountIs('AWS::CloudWatch::Alarm', 5)
  })
})
