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
// MIGRATION IN PROGRESS: this stack also owns a custom EventBridge bus
// (`IntegrationEventBus`) that the relay will publish to instead of SNS once it
// switches to events:PutEvents. The bus is additive and ships ahead of the relay
// cutover; the SNS path above keeps running until the relay is confirmed live on
// EventBridge, after which the topic/queue/consumer are retired. See
// plans/in-progress/pegii-eventbridge-integration.md.
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
   * Custom EventBridge bus the relay will publish legacy MoveManager events to
   * once it switches from `sns:Publish` to `events:PutEvents` (see
   * plans/in-progress/pegii-eventbridge-integration.md). The bus is additive —
   * it ships ahead of the relay cutover and the SNS path keeps running until
   * the relay is confirmed live on EventBridge.
   */
  readonly busName: string
  /**
   * Standard SQS buffer queue the bus rule delivers `pegii.*` events into. The
   * mapper Lambda (unit 4) drains it; buffering decouples the bus from the
   * 10-concurrent-exec Lambda cap so a burst can't throttle the rest of the
   * fleet. Standard (not FIFO) — ordering isn't required, consumers idempotent.
   */
  readonly bufferQueueName: string
  /** Redrive DLQ for the buffer queue — poison messages land here after retries. */
  readonly bufferDlqName: string
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
  public readonly eventBusArn: string

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

    // ── EventBridge bus (next-gen relay target) ────────────────────────────────
    // Additive: the relay still publishes to the SNS FIFO topic above. This bus
    // ships ahead of the relay cutover (sns:Publish → events:PutEvents); once the
    // relay is live on it, the SNS topic/queue/consumer are retired. Custom bus so
    // legacy MoveManager events get their own routing namespace + replay archive,
    // and so future "other situations" can fan out from rules rather than new SNS
    // subscriptions. CMK-encrypted — payloads carry light PII (shippedTo/driver).
    // Plan: plans/in-progress/pegii-eventbridge-integration.md
    const eventBus = new events.EventBus(this, 'IntegrationEventBus', {
      eventBusName: props.busName,
      description: 'Legacy pegII / MoveManager domain events (relay PutEvents target).',
      kmsKey: outboxKey,
    })
    this.eventBusArn = eventBus.eventBusArn

    // Archive every event on the bus so new consumers can be onboarded via replay
    // (the growth lever that justified EventBridge over SNS). 90 days is ample for
    // backfilling a freshly-added workflow trigger without unbounded retention.
    //
    // An archive of a CMK-encrypted bus must use the SAME CMK or EventBridge can't
    // decrypt events to store them — so kmsKeyIdentifier is required, not optional.
    // We can't use the L2 events.Archive / eventBus.archive() here: its KMS grant
    // pins the EncryptionContext to a GetAtt of the bus, which — combined with the
    // bus's GetAtt reference to the key — makes the key and bus mutually dependent
    // (an undeployable CloudFormation cycle). Instead, grant the events service on
    // the key ourselves using the bus ARN as a LITERAL (formatArn, no GetAtt), and
    // create the archive via L1 CfnArchive. The grant omits a SourceArn condition
    // because archive KMS calls carry the archive's ARN, not the bus's.
    const busArnLiteral = this.formatArn({
      service: 'events',
      resource: 'event-bus',
      resourceName: props.busName,
    })
    outboxKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowEventBridgeArchiveKms',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('events.amazonaws.com')],
        actions: ['kms:Decrypt', 'kms:GenerateDataKey', 'kms:ReEncrypt*', 'kms:DescribeKey'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'kms:EncryptionContext:aws:events:event-bus:arn': busArnLiteral },
        },
      }),
    )
    new events.CfnArchive(this, 'IntegrationEventArchive', {
      archiveName: `${props.busName}-archive`,
      description: 'Replayable archive of all pegII integration events.',
      sourceArn: eventBus.eventBusArn,
      // Account-scoped pattern = archive everything published to this bus.
      eventPattern: { account: [this.account] },
      retentionDays: 90,
      kmsKeyIdentifier: outboxKey.keyArn,
    })

    new cdk.CfnOutput(this, 'IntegrationEventBusArn', { value: eventBus.eventBusArn })
    new cdk.CfnOutput(this, 'IntegrationEventBusName', { value: eventBus.eventBusName })

    // ── Route pegii.* → SQS buffer (mapper Lambda drains it in unit 4) ──────────
    // Buffer first, never EB→Lambda direct: both accounts cap Lambda at 10
    // concurrent execs, so a relay backlog draining all at once must not starve
    // the rest of the fleet. The mapper (unit 4) sets reserved concurrency on the
    // SqsEventSource side. Standard queue + redrive DLQ — ordering isn't required
    // and the mapper is idempotent (dedupes on the legacy eventId).
    const bufferDlq = new sqs.Queue(this, 'IntegrationBufferDLQ', {
      queueName: props.bufferDlqName,
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    })
    const bufferQueue = new sqs.Queue(this, 'IntegrationBufferQueue', {
      queueName: props.bufferQueueName,
      // Must be >= the mapper Lambda's timeout (unit 4) so an in-flight message
      // isn't redelivered mid-processing.
      visibilityTimeout: cdk.Duration.minutes(6),
      enforceSSL: true,
      deadLetterQueue: { queue: bufferDlq, maxReceiveCount: 5 },
    })

    // Coarse routing: every legacy pegII source (pegii.movemanager today, more as
    // the registry grows) → the buffer. All FINE filtering stays in the v2
    // WorkflowTrigger.filter model on the resulting DomainEvent, not here.
    new events.Rule(this, 'IntegrationEventRule', {
      eventBus,
      description: 'Route all pegII integration events to the mapper buffer queue.',
      eventPattern: { source: events.Match.prefix('pegii.') },
      targets: [new eventsTargets.SqsQueue(bufferQueue)],
    })

    new cdk.CfnOutput(this, 'IntegrationBufferQueueUrl', { value: bufferQueue.queueUrl })
    new cdk.CfnOutput(this, 'IntegrationBufferDlqArn', { value: bufferDlq.queueArn })

    // ── Mapper Lambda — buffer → tenant-scoped DomainEvent ─────────────────────
    // Drains the buffer and writes a DomainEvent per legacy event; the existing
    // workflow-trigger dispatcher then matches + starts workflows (no new trigger
    // code). maxConcurrency caps how many invocations the SQS poller runs at once
    // (min 2) so a relay backlog can't consume all of the account's 10 Lambda
    // slots and starve the rest of the fleet — without reserving capacity away
    // from the pool. Reuses the consumer's DB secret + DATABASE_URL wiring.
    const mapperLogGroup = new logs.LogGroup(this, 'IntegrationEventMapLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const mapperFunction = new nodejs.NodejsFunction(this, 'IntegrationEventMapFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-integration-event-map.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        LOG_LEVEL: 'INFO',
      },
      bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logGroup: mapperLogGroup,
    })
    dbSecret.grantRead(mapperFunction)
    mapperFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(bufferQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        maxConcurrency: 2,
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
        this.wireRolesAnywhere({ envName, topic, eventBus, outboxKey, acmPcaArn, caPem })
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
    eventBus: events.IEventBus
    outboxKey: kms.IKey
    acmPcaArn?: string
    caPem?: string
  }): void {
    const { envName, topic, eventBus, outboxKey, acmPcaArn, caPem } = args

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
    // KEPT during the SNS→EventBridge cutover: the relay still publishes to SNS
    // until it flips to PutEvents and is confirmed live (then unit 6 retires both
    // this grant and the topic). Removing it before the relay cuts over would
    // break the live SNS path.
    relayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PublishShipmentEvents',
        actions: ['sns:Publish'],
        resources: [topic.topicArn],
      }),
    )
    // …and PutEvents to the integration bus (the relay's next-gen target). Granted
    // additively so the relay can cut over from sns:Publish without an IAM change
    // racing the deploy. The bus reuses outboxKey, so the PublishKms grant below
    // already covers the kms:GenerateDataKey PutEvents needs on the CMK bus.
    relayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PublishIntegrationEvents',
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      }),
    )
    // …plus the KMS the encrypted topic + bus require (else publishes fail).
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
