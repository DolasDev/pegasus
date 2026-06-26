import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { OutboxRelayStack, type OutboxRelayStackProps } from '../outbox-relay-stack'
import { MonitoringStack } from '../monitoring-stack'

function synth(overrides: Partial<OutboxRelayStackProps> = {}) {
  // Disable asset bundling so the mapper NodejsFunction isn't esbuild'd in tests.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], env: 'staging' } })
  const stack = new OutboxRelayStack(app, 'TestOutboxRelay', {
    env: { account: '111111111111', region: 'us-east-1' },
    busName: 'pegasus-staging-integration-events',
    bufferQueueName: 'pegasus-staging-integration-events-buffer',
    bufferDlqName: 'pegasus-staging-integration-events-buffer-dlq',
    ...overrides,
  })
  return Template.fromStack(stack)
}

describe('OutboxRelayStack — EventBridge bus + archive', () => {
  it('creates a custom CMK-encrypted bus with the configured name', () => {
    const t = synth()
    t.resourceCountIs('AWS::Events::EventBus', 1)
    t.hasResourceProperties('AWS::Events::EventBus', {
      Name: 'pegasus-staging-integration-events',
      KmsKeyIdentifier: Match.anyValue(),
    })
  })

  it('creates a KMS key with rotation enabled', () => {
    synth().hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true })
  })

  it('archives all bus events for replay (account-scoped, 90-day retention, same CMK)', () => {
    const t = synth()
    t.resourceCountIs('AWS::Events::Archive', 1)
    t.hasResourceProperties('AWS::Events::Archive', {
      ArchiveName: 'pegasus-staging-integration-events-archive',
      RetentionDays: 90,
      EventPattern: { account: ['111111111111'] },
      // Must reuse the bus CMK or EventBridge can't decrypt CMK events to archive.
      KmsKeyIdentifier: Match.anyValue(),
    })
  })

  it('grants events.amazonaws.com kms:DescribeKey WITHOUT an encryption-context condition', () => {
    // Regression: DescribeKey is a metadata call carrying no encryption context,
    // so it can't be gated by kms:EncryptionContext (doing so denies the call and
    // fails archive creation). It must live in its own account-scoped statement,
    // separate from the context-gated data-plane grant.
    const t = synth()
    t.hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowEventBridgeArchiveDescribeKey',
            Action: 'kms:DescribeKey',
            Principal: { Service: 'events.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': '111111111111' } },
          }),
        ]),
      }),
    })
  })

  it('exports the bus ARN + name for downstream wiring', () => {
    const outputs = synth().findOutputs('*')
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining(['IntegrationEventBusArn', 'IntegrationEventBusName']),
    )
  })

  it('owns NO SNS resources — the legacy topic/queue path was retired (unit 6)', () => {
    const t = synth()
    t.resourceCountIs('AWS::SNS::Topic', 0)
    t.resourceCountIs('AWS::SNS::Subscription', 0)
    // Only the buffer queue + its DLQ remain (no SNS FIFO queue/DLQ).
    t.resourceCountIs('AWS::SQS::Queue', 2)
  })
})

describe('OutboxRelayStack — pegii.* routing rule + buffer queue', () => {
  it('routes every pegii.* source to the buffer queue (coarse, prefix match)', () => {
    const t = synth()
    t.resourceCountIs('AWS::Events::Rule', 1)
    t.hasResourceProperties('AWS::Events::Rule', {
      EventBusName: Match.anyValue(),
      EventPattern: { source: [{ prefix: 'pegii.' }] },
      Targets: Match.arrayWith([Match.objectLike({ Arn: Match.anyValue() })]),
    })
  })

  it('creates a STANDARD buffer queue + DLQ with redrive (not FIFO)', () => {
    const t = synth()
    t.resourceCountIs('AWS::SQS::Queue', 2)
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'pegasus-staging-integration-events-buffer',
      FifoQueue: Match.absent(),
      RedrivePolicy: { maxReceiveCount: 5 },
    })
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'pegasus-staging-integration-events-buffer-dlq',
      FifoQueue: Match.absent(),
    })
  })

  it('grants EventBridge SendMessage on the buffer queue (target policy)', () => {
    const t = synth()
    t.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['sqs:SendMessage']),
            Principal: { Service: 'events.amazonaws.com' },
          }),
        ]),
      }),
    })
  })

  it('drains the buffer with the mapper Lambda, capped at maxConcurrency 2', () => {
    const t = synth()
    // One event source (the mapper); capped so a relay backlog can't consume all
    // 10 of the account's Lambda slots.
    t.resourceCountIs('AWS::Lambda::EventSourceMapping', 1)
    t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      ScalingConfig: { MaximumConcurrency: 2 },
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    })
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
    // events:PutEvents is scoped to the bus ARN (a GetAtt, never "*"). The retired
    // SNS path's sns:Publish grant is gone.
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'PublishIntegrationEvents',
            Action: 'events:PutEvents',
            Resource: Match.objectLike({ 'Fn::GetAtt': Match.anyValue() }),
          }),
        ]),
      }),
    })
    // No sns:Publish statement survives.
    const policies = t.findResources('AWS::IAM::Policy')
    const hasSnsPublish = JSON.stringify(policies).includes('sns:Publish')
    expect(hasSnsPublish).toBe(false)
    // KMS grant present and scoped to the bus's CMK (a GetAtt of the key), never "*".
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'PublishKms',
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
    // mapper + renew = 2 functions; a monthly schedule drives renew.
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
    t.resourceCountIs('AWS::Lambda::Function', 1) // mapper only
    // The only rule is the pegii.* routing rule — no rate()/schedule rule.
    t.resourceCountIs('AWS::Events::Rule', 1)
    const scheduled = t.findResources('AWS::Events::Rule', {
      Properties: { ScheduleExpression: Match.anyValue() },
    })
    expect(Object.keys(scheduled)).toHaveLength(0)
  })

  it('skips the trust anchor when Roles Anywhere is requested but no CA is resolved', () => {
    // Empty rolesAnywhere (e.g. SSM param not populated yet) → the bus still deploys.
    const t = synth({ rolesAnywhere: {} })
    t.resourceCountIs('AWS::RolesAnywhere::TrustAnchor', 0)
    t.resourceCountIs('AWS::RolesAnywhere::Profile', 0)
    t.resourceCountIs('AWS::Events::EventBus', 1)
    t.resourceCountIs('AWS::SQS::Queue', 2)
  })
})

// ── Integration-buffer alarms live in MonitoringStack (props from bin/app.ts) ──
function synthMonitoring(withBuffer: boolean) {
  const app = new cdk.App()
  const stack = new MonitoringStack(app, withBuffer ? 'MonBuffer' : 'MonNoBuffer', {
    lambdaFunctionName: 'test-api-function',
    httpApiId: 'abc123def4',
    httpApiStage: '$default',
    ...(withBuffer
      ? {
          integrationBufferQueueName: 'pegasus-staging-integration-events-buffer',
          integrationBufferDlqName: 'pegasus-staging-integration-events-buffer-dlq',
        }
      : {}),
  })
  return Template.fromStack(stack)
}

describe('MonitoringStack — integration-buffer alarms', () => {
  it('creates the buffer DLQ + age alarms with the right metric namespaces', () => {
    const t = synthMonitoring(true)
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-integration-buffer-dlq',
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateNumberOfMessagesVisible',
    })
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-integration-buffer-age',
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateAgeOfOldestMessage',
    })
  })

  it('creates none of the buffer alarms when the props are absent (dev gate)', () => {
    const t = synthMonitoring(false)
    const alarms = t.findResources('AWS::CloudWatch::Alarm', {
      Properties: { AlarmName: Match.stringLikeRegexp('pegasus-integration-buffer-.*') },
    })
    expect(Object.keys(alarms)).toHaveLength(0)
  })
})
