// ---------------------------------------------------------------------------
// OutboxRelayStack
//
// AWS side of the legacy shipment-event pipeline. The on-prem
// `Pegasus.Outbox.Relay` Windows service (a separate .NET repo) drains the
// legacy MoveManager `dbo.Outbox` table and publishes Shipment.Opened /
// Shipment.Closed to the SNS FIFO topic this stack owns. The topic fans out to
// an SQS FIFO queue, drained by the shipment-event consumer Lambda
// (apps/api/src/lambda-shipment-event-consume.ts) into platform.shipment_event_inbox.
//
// This is the first FIFO topic/queue in the codebase: the relay always sets
// MessageGroupId + MessageDeduplicationId, so neither uses content-based dedup.
//
// The relay authenticates with IAM Roles Anywhere (X.509 trust anchor → no
// long-lived keys on the on-prem host). That path is optional: it's only wired
// when `props.rolesAnywhere` is supplied (gated in bin/app.ts behind a context
// flag + per-env CA config), so the topic/queue can ship ahead of the CA and a
// static-key fallback can be used in the interim. The relay role is
// least-privilege: sns:Publish on this topic only, plus the KMS grants the
// encrypted topic requires.
//
// Runbook: plans/in-progress/legacy-outbox-relay-setup.md
// ---------------------------------------------------------------------------

import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as rolesanywhere from 'aws-cdk-lib/aws-rolesanywhere'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import { type Construct } from 'constructs'

export interface OutboxRelayStackProps extends cdk.StackProps {
  /** FIFO topic name — must end in `.fifo` (e.g. `pegasus-outbox-events.fifo`). */
  readonly topicName: string
  /** FIFO queue name — must end in `.fifo`. */
  readonly queueName: string
  /** FIFO dead-letter queue name — must end in `.fifo`. */
  readonly dlqName: string
  /**
   * IAM Roles Anywhere config for the on-prem relay's publish identity. When
   * omitted, the trust anchor / profile / role are not created (interim
   * static-key path). The CA cert is supplied either as an ACM Private CA ARN
   * or a self-managed CA certificate bundle (PEM).
   */
  readonly rolesAnywhere?: {
    /** ARN of an ACM Private CA acting as the trust anchor. */
    readonly acmPcaArn?: string
    /** Self-managed CA certificate bundle (PEM) — used when `acmPcaArn` is unset. */
    readonly certificateBundlePem?: string
  }
}

export class OutboxRelayStack extends cdk.Stack {
  public readonly topicArn: string

  constructor(scope: Construct, id: string, props: OutboxRelayStackProps) {
    super(scope, id, props)

    if (!props.topicName.endsWith('.fifo')) {
      throw new Error(`OutboxRelayStack topicName must end in .fifo (got "${props.topicName}")`)
    }

    const envName = (this.node.tryGetContext('env') as string | undefined) ?? 'dev'

    // ── KMS CMK — encrypts the SNS topic at rest ───────────────────────────────
    const outboxKey = new kms.Key(this, 'OutboxEventsKey', {
      description: 'Encrypts the legacy shipment-event SNS FIFO topic.',
      enableKeyRotation: true,
    })

    // ── SNS FIFO topic (relay publish target) ──────────────────────────────────
    // contentBasedDeduplication is OFF: the relay always sets an explicit
    // MessageDeduplicationId per published event.
    const topic = new sns.Topic(this, 'OutboxEventsTopic', {
      topicName: props.topicName,
      displayName: 'Legacy MoveManager shipment events',
      fifo: true,
      contentBasedDeduplication: false,
      masterKey: outboxKey,
    })
    this.topicArn = topic.topicArn

    // ── SQS FIFO queue + FIFO DLQ (subscriber) ─────────────────────────────────
    const dlq = new sqs.Queue(this, 'OutboxEventsDLQ', {
      queueName: props.dlqName,
      fifo: true,
      contentBasedDeduplication: false,
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    })
    const queue = new sqs.Queue(this, 'OutboxEventsQueue', {
      queueName: props.queueName,
      fifo: true,
      contentBasedDeduplication: false,
      // Must be >= the consumer's timeout so an in-flight message isn't redelivered.
      visibilityTimeout: cdk.Duration.minutes(6),
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    })

    // SNS → SQS. Raw delivery OFF so the SNS envelope (incl. the `source` message
    // attribute) reaches the consumer, which JSON-parses it.
    topic.addSubscription(new subscriptions.SqsSubscription(queue, { rawMessageDelivery: false }))

    // ── Consumer Lambda ────────────────────────────────────────────────────────
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'NeonDatabaseUrl',
      `pegasus/${envName}/database-url`,
    )

    const consumerLogGroup = new logs.LogGroup(this, 'ShipmentEventConsumeLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const consumerFunction = new nodejs.NodejsFunction(this, 'ShipmentEventConsumeFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-shipment-event-consume.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        LOG_LEVEL: 'INFO',
      },
      bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logGroup: consumerLogGroup,
    })
    dbSecret.grantRead(consumerFunction)
    consumerFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    )

    // ── IAM Roles Anywhere — relay publish identity (optional) ─────────────────
    if (props.rolesAnywhere) {
      const { acmPcaArn, certificateBundlePem } = props.rolesAnywhere
      if (!acmPcaArn && !certificateBundlePem) {
        throw new Error('OutboxRelayStack: rolesAnywhere needs acmPcaArn or certificateBundlePem')
      }

      const relayRole = new iam.Role(this, 'RelayPublishRole', {
        roleName: `pegasus-${envName}-outbox-relay-publish`,
        assumedBy: new iam.ServicePrincipal('rolesanywhere.amazonaws.com'),
        description: 'Assumed via IAM Roles Anywhere by the on-prem Outbox Relay to publish.',
      })
      // Roles Anywhere needs session-tagging + source-identity on top of AssumeRole.
      relayRole.assumeRolePolicy?.addStatements(
        new iam.PolicyStatement({
          actions: ['sts:TagSession', 'sts:SetSourceIdentity'],
          principals: [new iam.ServicePrincipal('rolesanywhere.amazonaws.com')],
        }),
      )
      // Least privilege: publish to THIS topic only…
      relayRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'PublishShipmentEvents',
          actions: ['sns:Publish'],
          resources: [topic.topicArn],
        }),
      )
      // …plus the KMS the encrypted topic requires (else publishes fail at SNS).
      relayRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'PublishKms',
          actions: ['kms:GenerateDataKey*', 'kms:Decrypt'],
          resources: [outboxKey.keyArn],
        }),
      )

      const trustAnchor = new rolesanywhere.CfnTrustAnchor(this, 'RelayTrustAnchor', {
        name: `pegasus-${envName}-outbox-relay`,
        enabled: true,
        source: {
          sourceType: acmPcaArn ? 'AWS_ACM_PCA' : 'CERTIFICATE_BUNDLE',
          sourceData: acmPcaArn ? { acmPcaArn } : { x509CertificateData: certificateBundlePem },
        },
      })

      new rolesanywhere.CfnProfile(this, 'RelayProfile', {
        name: `pegasus-${envName}-outbox-relay`,
        enabled: true,
        roleArns: [relayRole.roleArn],
      })

      new cdk.CfnOutput(this, 'RelayRoleArn', { value: relayRole.roleArn })
      new cdk.CfnOutput(this, 'RelayTrustAnchorArn', { value: trustAnchor.attrTrustAnchorArn })
    }

    // ── Outputs (consumed by the relay deploy/config — runbook §1/§2) ──────────
    new cdk.CfnOutput(this, 'OutboxTopicArn', { value: topic.topicArn })
    new cdk.CfnOutput(this, 'OutboxQueueUrl', { value: queue.queueUrl })
    new cdk.CfnOutput(this, 'OutboxDlqArn', { value: dlq.queueArn })
  }
}
