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
import * as events from 'aws-cdk-lib/aws-events'
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets'
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
import * as ssm from 'aws-cdk-lib/aws-ssm'
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
   * static-key path). The trust anchor's CA comes from exactly one of:
   *  - `caCertSsmParameterName` — SELF-MANAGED CA (default path). An SSM String
   *    parameter holding the CA's PUBLIC certificate (PEM). Ops generates the CA
   *    once and `aws ssm put-parameter`s the public cert; the value is inlined
   *    into the trust anchor at synth. If the parameter isn't populated yet, the
   *    trust anchor/profile/role are skipped (topic + queue still deploy).
   *  - `acmPcaArn` — managed-CA path (ACM Private CA).
   *  - `certificateBundlePem` — inline PEM (mainly for tests).
   */
  readonly rolesAnywhere?: {
    /** SSM String parameter holding the self-managed CA's PUBLIC cert (PEM). */
    readonly caCertSsmParameterName?: string
    /** ARN of an ACM Private CA acting as the trust anchor. */
    readonly acmPcaArn?: string
    /** Self-managed CA certificate bundle (PEM) — inline; mainly for tests. */
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
      const { acmPcaArn, caCertSsmParameterName, certificateBundlePem } = props.rolesAnywhere

      // Self-managed CA: resolve the PUBLIC cert PEM (inline > SSM). valueFromLookup
      // inlines the literal at synth, so the trust anchor never carries a CFN token.
      // Until the SSM parameter is populated it resolves to a dummy, so we gate on
      // the value actually looking like a certificate.
      let caPem = certificateBundlePem
      if (!acmPcaArn && !caPem && caCertSsmParameterName) {
        caPem = ssm.StringParameter.valueFromLookup(this, caCertSsmParameterName)
      }
      const usingAcmPca = !!acmPcaArn
      const haveCaBundle = !usingAcmPca && !!caPem && caPem.includes('BEGIN CERTIFICATE')

      if (!usingAcmPca && !haveCaBundle) {
        // Flag on but no usable CA yet (e.g. the SSM parameter isn't populated).
        // Skip the trust anchor/profile/role so the topic + queue still deploy; the
        // relay can use the static-key fallback meanwhile (runbook §2).
        cdk.Annotations.of(this).addWarning(
          'OutboxRelayStack: Roles Anywhere requested but no CA certificate resolved' +
            (caCertSsmParameterName ? ` (populate SSM ${caCertSsmParameterName})` : '') +
            '; skipping trust anchor/profile/role — topic + queue still deploy.',
        )
      } else {
        this.wireRolesAnywhere({ envName, topic, outboxKey, acmPcaArn, caPem })
      }
    }

    // ── Outputs (consumed by the relay deploy/config — runbook §1/§2) ──────────
    new cdk.CfnOutput(this, 'OutboxTopicArn', { value: topic.topicArn })
    new cdk.CfnOutput(this, 'OutboxQueueUrl', { value: queue.queueUrl })
    new cdk.CfnOutput(this, 'OutboxDlqArn', { value: dlq.queueArn })
  }

  /** Builds the relay role + trust anchor + profile once a CA source is known. */
  private wireRolesAnywhere(args: {
    envName: string
    topic: sns.ITopic
    outboxKey: kms.IKey
    acmPcaArn?: string
    caPem?: string
  }): void {
    const { envName, topic, outboxKey, acmPcaArn, caPem } = args

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
      source: acmPcaArn
        ? { sourceType: 'AWS_ACM_PCA', sourceData: { acmPcaArn } }
        : { sourceType: 'CERTIFICATE_BUNDLE', sourceData: { x509CertificateData: caPem } },
    })

    const profile = new rolesanywhere.CfnProfile(this, 'RelayProfile', {
      name: `pegasus-${envName}-outbox-relay`,
      enabled: true,
      roleArns: [relayRole.roleArn],
    })

    // The on-prem aws_signing_helper needs all three ARNs (--trust-anchor-arn,
    // --profile-arn, --role-arn) to mint credentials — export each.
    new cdk.CfnOutput(this, 'RelayRoleArn', { value: relayRole.roleArn })
    new cdk.CfnOutput(this, 'RelayTrustAnchorArn', { value: trustAnchor.attrTrustAnchorArn })
    new cdk.CfnOutput(this, 'RelayProfileArn', { value: profile.attrProfileArn })

    // Self-managed CA only — ACM PCA manages its own cert lifecycle.
    if (!acmPcaArn) this.wireLeafRenewal({ envName, outboxKey, relayRole })
  }

  /**
   * Automated leaf renewal for the self-managed CA path. A monthly Lambda mints a
   * fresh leaf signed by the CA key (SSM SecureString) and writes leaf.pem/.key
   * back to SSM; the on-prem host pulls + swaps them with its own creds. AWS can't
   * push to the host, so this is the cloud half — see runbook §2 step 10.
   *
   * SSM layout (per env):
   *   outbox-relay-ca-pem   (String)        CA public cert      — Lambda reads
   *   outbox-relay-ca-key   (SecureString)  CA private key      — Lambda reads
   *   outbox-relay-leaf-pem (String)        current leaf cert   — Lambda writes, host reads
   *   outbox-relay-leaf-key (SecureString)  current leaf key    — Lambda writes, host reads
   * SecureStrings are encrypted with OutboxEventsKey, which the relay role can
   * already decrypt — so the host pull needs no extra KMS grant.
   */
  private wireLeafRenewal(args: {
    envName: string
    outboxKey: kms.IKey
    relayRole: iam.IRole
  }): void {
    const { envName, outboxKey, relayRole } = args
    const p = (suffix: string): string => `/pegasus/${envName}/outbox-relay-${suffix}`
    const caCertParam = p('ca-pem')
    const caKeyParam = p('ca-key')
    const leafCertParam = p('leaf-pem')
    const leafKeyParam = p('leaf-key')
    const arn = (name: string): string =>
      `arn:aws:ssm:${this.region}:${this.account}:parameter${name}`

    const renewLogGroup = new logs.LogGroup(this, 'LeafRenewLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const renewFn = new nodejs.NodejsFunction(this, 'LeafRenewFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-outbox-leaf-renew.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'INFO',
        OUTBOX_CA_CERT_PARAM: caCertParam,
        OUTBOX_CA_KEY_PARAM: caKeyParam,
        OUTBOX_LEAF_CERT_PARAM: leafCertParam,
        OUTBOX_LEAF_KEY_PARAM: leafKeyParam,
        OUTBOX_LEAF_CN: `pegasus-${envName}-outbox-relay-dolios`,
        OUTBOX_LEAF_DAYS: '365',
        OUTBOX_KMS_KEY_ID: outboxKey.keyArn,
      },
      bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
      memorySize: 256,
      timeout: cdk.Duration.minutes(1),
      logGroup: renewLogGroup,
    })
    renewFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadCa',
        actions: ['ssm:GetParameter'],
        resources: [arn(caCertParam), arn(caKeyParam)],
      }),
    )
    renewFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'WriteLeaf',
        actions: ['ssm:PutParameter'],
        resources: [arn(leafCertParam), arn(leafKeyParam)],
      }),
    )
    // Decrypt the CA key, encrypt the new leaf key — both under OutboxEventsKey.
    outboxKey.grantEncryptDecrypt(renewFn)

    // Monthly — huge slack on a 1-yr cert, so a missed run is harmless.
    new events.Rule(this, 'LeafRenewSchedule', {
      description: 'Monthly Outbox Relay leaf-cert renewal',
      schedule: events.Schedule.rate(cdk.Duration.days(30)),
      targets: [new eventsTargets.LambdaFunction(renewFn)],
    })

    // Host pull: the relay role reads the current leaf (its KMS decrypt on
    // OutboxEventsKey already covers the SecureString key).
    relayRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'PullLeaf',
        actions: ['ssm:GetParameter'],
        resources: [arn(leafCertParam), arn(leafKeyParam)],
      }),
    )

    new cdk.CfnOutput(this, 'LeafCertParam', { value: leafCertParam })
    new cdk.CfnOutput(this, 'LeafKeyParam', { value: leafKeyParam })
  }
}
