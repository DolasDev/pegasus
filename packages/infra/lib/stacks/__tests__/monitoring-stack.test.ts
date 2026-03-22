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
      Threshold: 5,
      ComparisonOperator: 'GreaterThanThreshold',
    })
  })

  it('evaluates the Lambda errors alarm over a 1-minute period', () => {
    const template = synthMonitoringStack()
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Period: 60,
      EvaluationPeriods: 1,
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
  it('creates exactly three CloudWatch alarms', () => {
    const template = synthMonitoringStack()
    template.resourceCountIs('AWS::CloudWatch::Alarm', 3)
  })
})
