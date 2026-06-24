import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { OutboxRelayStack, type OutboxRelayStackProps } from '../outbox-relay-stack'
import { MonitoringStack } from '../monitoring-stack'

function synth(overrides: Partial<OutboxRelayStackProps> = {}) {
  // Disable asset bundling so the consumer NodejsFunction isn't esbuild'd in tests.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], env: 'staging' } })
  const stack = new OutboxRelayStack(app, 'TestOutboxRelay', {
    env: { account: '111111111111', region: 'us-east-1' },
    topicName: 'pegasus-staging-outbox-events.fifo',
    queueName: 'pegasus-staging-outbox-events.fifo',
    dlqName: 'pegasus-staging-outbox-events-dlq.fifo',
    busName: 'pegasus-staging-integration-events',
    ...overrides,
  })
  return Template.fromStack(stack)
}

describe('OutboxRelayStack — SNS FIFO topic', () => {
  it('creates a FIFO topic encrypted with a customer-managed key', () => {
    synth().hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'pegasus-staging-outbox-events.fifo',
      FifoTopic: true,
      ContentBasedDeduplication: false,
      KmsMasterKeyId: Match.anyValue(),
    })
  })

  it('creates a KMS key with rotation enabled', () => {
    synth().hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true })
  })

  it('rejects a topic name that is not FIFO', () => {
    expect(() => synth({ topicName: 'pegasus-staging-outbox-events' })).toThrow(/\.fifo/)
  })
})

describe('OutboxRelayStack — SQS FIFO queue + DLQ', () => {
  it('creates a FIFO queue and a FIFO DLQ with redrive (maxReceiveCount 5)', () => {
    const t = synth()
    t.resourceCountIs('AWS::SQS::Queue', 2)
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'pegasus-staging-outbox-events.fifo',
      FifoQueue: true,
      RedrivePolicy: { maxReceiveCount: 5 },
    })
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'pegasus-staging-outbox-events-dlq.fifo',
      FifoQueue: true,
    })
  })

  it('subscribes the queue to the topic and drains it with a consumer Lambda', () => {
    const t = synth()
    t.resourceCountIs('AWS::SNS::Subscription', 1)
    t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'sqs' })
    t.resourceCountIs('AWS::Lambda::EventSourceMapping', 1)
    t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    })
  })
})

describe('OutboxRelayStack — EventBridge bus (relay cutover target)', () => {
  it('creates a custom CMK-encrypted bus with the configured name', () => {
    const t = synth()
    t.resourceCountIs('AWS::Events::EventBus', 1)
    t.hasResourceProperties('AWS::Events::EventBus', {
      Name: 'pegasus-staging-integration-events',
      KmsKeyIdentifier: Match.anyValue(),
    })
  })

  it('archives all bus events for replay (account-scoped, 90-day retention, same CMK)', () => {
    const t = synth()
    t.resourceCountIs('AWS::Events::Archive', 1)
    t.hasResourceProperties('AWS::Events::Archive', {
      ArchiveName: 'pegasus-staging-integration-events-archive',
      RetentionDays: 90,
      EventPattern: { account: ['111111111111'] },
      // Must reuse the bus CMK (never the eventBus.archive() empty-string default)
      // or EventBridge can't decrypt CMK-encrypted events to archive them.
      KmsKeyIdentifier: Match.anyValue(),
    })
  })

  it('exports the bus ARN + name for downstream wiring', () => {
    const outputs = synth().findOutputs('*')
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining(['IntegrationEventBusArn', 'IntegrationEventBusName']),
    )
  })

  it('ships additively — the SNS FIFO path is untouched', () => {
    const t = synth()
    t.resourceCountIs('AWS::SNS::Topic', 1)
    t.resourceCountIs('AWS::SNS::Subscription', 1)
    // The bus brings no Events::Rule (coarse routing arrives in a later unit).
    t.resourceCountIs('AWS::Events::Rule', 0)
  })
})

describe('OutboxRelayStack — relay publish identity (IAM Roles Anywhere)', () => {
  it('creates NO Roles Anywhere resources by default (flag off)', () => {
    const t = synth()
    t.resourceCountIs('AWS::RolesAnywhere::TrustAnchor', 0)
    t.resourceCountIs('AWS::RolesAnywhere::Profile', 0)
  })

  it('creates a trust anchor + profile + least-privilege role when configured', () => {
    const t = synth({
      rolesAnywhere: {
        acmPcaArn: 'arn:aws:acm-pca:us-east-1:111111111111:certificate-authority/abc',
      },
    })
    t.resourceCountIs('AWS::RolesAnywhere::TrustAnchor', 1)
    t.resourceCountIs('AWS::RolesAnywhere::Profile', 1)
    t.hasResourceProperties('AWS::RolesAnywhere::TrustAnchor', {
      Source: { SourceType: 'AWS_ACM_PCA' },
    })
    // The on-prem aws_signing_helper needs all three ARNs — each must be exported.
    const outputs = t.findOutputs('*')
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining(['RelayTrustAnchorArn', 'RelayProfileArn', 'RelayRoleArn']),
    )
    // sns:Publish is scoped to the topic ARN (a Ref, never "*").
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'PublishShipmentEvents',
            Action: 'sns:Publish',
            Resource: Match.objectLike({ Ref: Match.anyValue() }),
          }),
        ]),
      }),
    })
    // KMS grant present and scoped (the encrypted topic needs it).
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'PublishKms',
            // Scoped to the topic's CMK (a GetAtt of the key), never "*".
            Resource: Match.objectLike({ 'Fn::GetAtt': Match.anyValue() }),
          }),
        ]),
      }),
    })
  })

  it('uses a CERTIFICATE_BUNDLE trust anchor for the self-managed CA path', () => {
    const t = synth({
      rolesAnywhere: {
        certificateBundlePem:
          '-----BEGIN CERTIFICATE-----\nMIIBfakeCAcert\n-----END CERTIFICATE-----\n',
      },
    })
    t.resourceCountIs('AWS::RolesAnywhere::TrustAnchor', 1)
    t.resourceCountIs('AWS::RolesAnywhere::Profile', 1)
    t.hasResourceProperties('AWS::RolesAnywhere::TrustAnchor', {
      Source: Match.objectLike({
        SourceType: 'CERTIFICATE_BUNDLE',
        SourceData: Match.objectLike({ X509CertificateData: Match.stringLikeRegexp('BEGIN CERT') }),
      }),
    })
  })

  it('wires monthly leaf renewal (Lambda + schedule) on the self-managed CA path', () => {
    const t = synth({
      rolesAnywhere: {
        certificateBundlePem:
          '-----BEGIN CERTIFICATE-----\nMIIBfakeCAcert\n-----END CERTIFICATE-----\n',
      },
    })
    // consumer + renew = 2 functions; a monthly schedule drives the renew one.
    t.resourceCountIs('AWS::Lambda::Function', 2)
    t.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(30 days)',
    })
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          OUTBOX_CA_KEY_PARAM: '/pegasus/staging/outbox-relay-ca-key',
          OUTBOX_LEAF_KEY_PARAM: '/pegasus/staging/outbox-relay-leaf-key',
        }),
      }),
    })
  })

  it('does NOT wire leaf renewal when Roles Anywhere is off (no renewal Lambda/schedule)', () => {
    const t = synth()
    t.resourceCountIs('AWS::Lambda::Function', 1) // consumer only
    t.resourceCountIs('AWS::Events::Rule', 0)
  })

  it('skips the trust anchor when Roles Anywhere is requested but no CA is resolved', () => {
    // Empty rolesAnywhere (e.g. SSM param not populated yet) → topic + queue only.
    const t = synth({ rolesAnywhere: {} })
    t.resourceCountIs('AWS::RolesAnywhere::TrustAnchor', 0)
    t.resourceCountIs('AWS::RolesAnywhere::Profile', 0)
    t.resourceCountIs('AWS::SNS::Topic', 1)
    t.resourceCountIs('AWS::SQS::Queue', 2)
  })
})

// ── Outbox alarms live in MonitoringStack (fed by props from bin/app.ts) ───────
function synthMonitoring(withOutbox: boolean) {
  const app = new cdk.App()
  const stack = new MonitoringStack(app, withOutbox ? 'MonOutbox' : 'MonNoOutbox', {
    lambdaFunctionName: 'test-api-function',
    httpApiId: 'abc123def4',
    httpApiStage: '$default',
    ...(withOutbox
      ? {
          outboxQueueName: 'pegasus-staging-outbox-events.fifo',
          outboxDlqName: 'pegasus-staging-outbox-events-dlq.fifo',
          outboxTopicName: 'pegasus-staging-outbox-events.fifo',
        }
      : {}),
  })
  return Template.fromStack(stack)
}

describe('MonitoringStack — outbox alarms', () => {
  it('creates the three outbox alarms with the right metric namespaces', () => {
    const t = synthMonitoring(true)
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-outbox-dlq',
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateNumberOfMessagesVisible',
    })
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-outbox-age',
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateAgeOfOldestMessage',
    })
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-outbox-sns-failed',
      Namespace: 'AWS/SNS',
      MetricName: 'NumberOfNotificationsFailed',
    })
  })

  it('creates none of the outbox alarms when the props are absent (dev gate)', () => {
    const t = synthMonitoring(false)
    const alarms = t.findResources('AWS::CloudWatch::Alarm', {
      Properties: { AlarmName: Match.stringLikeRegexp('pegasus-outbox-.*') },
    })
    expect(Object.keys(alarms)).toHaveLength(0)
  })
})
