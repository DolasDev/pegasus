// ---------------------------------------------------------------------------
// TemporalWorkerStack — ECS Fargate plane for the curated stdlib Temporal
// worker (apps/temporal-worker, lands in Phase 2 Unit 5).
//
// Lifecycle across Phase 2 units:
//   - Unit 4 (this commit): synthesise the dormant fleet. ECR repo exists
//     but contains no images yet; Fargate service is created with
//     `desiredCount: 0`, so ECS never tries to pull the placeholder image
//     and nothing actually runs. Stack synth/deploy is therefore safe with
//     no extra operator steps beyond the Secrets Manager prereqs (already
//     satisfied per the plan).
//   - Unit 5: ships the Python worker image, pushes to this ECR repo,
//     bumps `desiredCount` to 1 so the worker connects to Temporal Cloud
//     and registers on the task queue.
//   - Unit 6: wires the API to start workflows on the same namespace; the
//     fleet here is what executes them.
//   - Unit 7: tenant-web UI to trigger runs.
//
// Why the NAT Gateway lives on WireGuardStack (not here):
//   ECS Fargate tasks need outbound to Temporal Cloud (gRPC :7233), ECR
//   (image pull), CloudWatch Logs (driver), KMS (only via the API broker,
//   not directly — see runtime-token-crypto.ts), and the public API URL.
//   That's a `PRIVATE_WITH_EGRESS` workload, which needs a NAT. We added
//   the NAT + subnets to the WireGuard VPC instead of carving a second
//   VPC so cross-stack wiring stays minimal and the existing hub plane
//   doesn't change. The hub itself sits in hub-public and does NOT route
//   through the NAT (the NAT is purely outbound for these subnets).
//
// Why the API Lambda doesn't need this:
//   The Hono API Lambda is already "public-egress" — it's not VPC-attached
//   (see api-stack.ts comment "the public-egress API Lambda"), so it
//   reaches Temporal Cloud, Cognito, Neon, and KMS over the public
//   internet from Lambda's managed egress without a NAT of its own. Only
//   the Fargate worker, which is VPC-attached, needs the NAT.
//
// Cost note:
//   The dominant new monthly cost is the NAT Gateway itself, ~$35–40/mo
//   per env (us-east-1: $0.045/hr + data-processing). Fargate at
//   desiredCount: 0 is free; ECR storage is negligible until images land.
// ---------------------------------------------------------------------------

import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { type Construct } from 'constructs'

export interface TemporalWorkerStackProps extends cdk.StackProps {
  /**
   * The WireGuard VPC. The Fargate service is placed in this VPC's
   * `temporal-worker-egress` subnet group (PRIVATE_WITH_EGRESS), routing
   * outbound through the NAT Gateway provisioned on WireGuardStack.
   */
  readonly vpc: ec2.IVpc

  /**
   * Subnets the Fargate service should attach to. Sourced from
   * `WireGuardStack.temporalWorkerSubnets`. Passed explicitly (instead of
   * letting the worker stack call `vpc.selectSubnets(...)`) so the cross-
   * stack contract is in plain TypeScript and synth-time errors fire here
   * if the subnet group ever vanishes upstream.
   */
  readonly workerSubnets: ec2.ISubnet[]

  /**
   * Temporal Cloud namespace this worker connects to. Format:
   * `pegasus-<envName>` (staging / prod). Populated by app.ts.
   */
  readonly temporalNamespace: string

  /**
   * Temporal Cloud gRPC endpoint (host:port). Read from the
   * `TEMPORAL_ADDRESS` map in bin/app.ts; passed through here so the
   * stack stays declarative.
   */
  readonly temporalAddress: string

  /**
   * The shared Temporal task queue this worker polls. Format:
   * `pegasus-stdlib-<envName>`. Conventionally one queue per env.
   */
  readonly temporalTaskQueue: string

  /**
   * Public Pegasus API base URL. The worker calls
   * `POST /internal/workflow-runtime-token` and
   * `PATCH /internal/workflow-executions/:id` against this base — see the
   * plan's "Runtime token delivery" + "Execution status sync" sections.
   *
   * Caller (app.ts) computes this from the ApiCdnStack distribution
   * (staging/prod use the CloudFront-fronted api.pegasus[-qa].dolas.dev).
   */
  readonly pegasusApiBaseUrl: string

  /**
   * Environment tag — `staging` or `prod`. Used for log group naming and
   * the `ENV_NAME` container env var (so worker logs are easy to filter).
   */
  readonly envName: string
}

/**
 * Provisions the empty Fargate fleet that will host the Pegasus Temporal
 * worker. See the file-level doc-block above for the unit-by-unit lifecycle.
 */
export class TemporalWorkerStack extends cdk.Stack {
  /** ECR repository the Unit 5 image build targets. */
  public readonly workerRepository: ecr.IRepository

  /** ECS cluster — Fargate-only, containerInsights enabled. */
  public readonly cluster: ecs.ICluster

  /** Fargate service, created at `desiredCount: 0` in Unit 4. */
  public readonly service: ecs.FargateService

  /** Dedicated CloudWatch log group, retained on stack delete. */
  public readonly logGroup: logs.ILogGroup

  constructor(scope: Construct, id: string, props: TemporalWorkerStackProps) {
    super(scope, id, props)

    const {
      vpc,
      workerSubnets,
      temporalNamespace,
      temporalAddress,
      temporalTaskQueue,
      pegasusApiBaseUrl,
      envName,
    } = props

    // -----------------------------------------------------------------------
    // ECR repository — the Unit 5 image build pushes here. Created with
    // RETAIN because losing this repo would orphan any in-flight worker
    // images and force a full re-publish + Fargate roll. Scan-on-push so
    // the platform team sees CVE alerts on each new image. Lifecycle
    // policy keeps the most recent 20 images — enough room for several
    // rollbacks but bounded so storage cost stays flat.
    // -----------------------------------------------------------------------
    const repository = new ecr.Repository(this, 'WorkerRepository', {
      repositoryName: 'pegasus-temporal-worker',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // ECR default encryption (AES256) is fine here — no per-tenant
      // sensitivity in the image itself; runtime secrets are pulled
      // separately via the broker at activity start.
      encryption: ecr.RepositoryEncryption.AES_256,
      lifecycleRules: [
        {
          description: 'Retain the most recent 20 images; expire older.',
          maxImageCount: 20,
          rulePriority: 1,
        },
      ],
    })
    this.workerRepository = repository

    // -----------------------------------------------------------------------
    // ECS cluster — Fargate-only. containerInsights gives free per-task
    // CPU/memory/network metrics in CloudWatch; ~$0 for a single-task
    // fleet so the visibility is worth it.
    // -----------------------------------------------------------------------
    const cluster = new ecs.Cluster(this, 'WorkerCluster', {
      clusterName: `pegasus-temporal-worker-${envName}`,
      vpc,
      // containerInsightsV2 supersedes the boolean containerInsights prop
      // (deprecated in recent CDK). ENABLED gives standard task-level
      // CPU/memory/network metrics; ENHANCED costs more, isn't worth it
      // for a single-task fleet.
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    })
    this.cluster = cluster

    // -----------------------------------------------------------------------
    // Secrets — Temporal Cloud API key (JSON `{"apiKey":"<jwt>"}`) and the
    // broker shared secret (raw string). Both already provisioned per the
    // plan's operator prereqs. fromSecretNameV2 means the runtime always
    // pulls the latest version (no SecretVersionStage pin), which matches
    // how WORKFLOW_TOKEN_KMS_KEY_ID etc. behave elsewhere.
    // -----------------------------------------------------------------------
    const temporalCloudSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'TemporalCloudSecret',
      `pegasus/${envName}/temporal-cloud`,
    )
    const workflowBrokerSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'WorkflowBrokerSecret',
      `pegasus/${envName}/workflow-broker-secret`,
    )

    // -----------------------------------------------------------------------
    // CloudWatch log group — explicit construct, 1-month retention, RETAIN
    // on stack delete. Same shape as WireGuardStack.keyBootstrapFnLogGroup.
    // -----------------------------------------------------------------------
    const logGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
      logGroupName: `/pegasus/${envName}/temporal-worker`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })
    this.logGroup = logGroup

    // -----------------------------------------------------------------------
    // Task definition. 512 CPU / 1024 MiB memory is a comfortable starting
    // point for a single-process `temporalio` Python worker that polls one
    // task queue and runs IO-bound activities (HTTP calls into the Pegasus
    // API + Temporal Cloud gRPC). Bumped in Unit 5 if profiling demands it.
    //
    // Execution role: auto-created by FargateTaskDefinition; gets ECR pull
    // + CloudWatch Logs write via the awslogs driver below.
    //
    // Task role: the role the worker container assumes at runtime. It
    // needs `secretsmanager:GetSecretValue` on the two secrets — Fargate
    // injects them via `ecs.Secret.fromSecretsManager(...)`, which builds
    // an execution-role grant under the hood, but the runtime worker
    // process itself also reads the broker secret directly when it
    // refreshes the token. Granting on the task role is the more general
    // shape.
    // -----------------------------------------------------------------------
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WorkerTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      family: `pegasus-temporal-worker-${envName}`,
    })

    // Grant the EXECUTION role read on both secrets — required for the
    // `ecs.Secret.fromSecretsManager` injection at task start. Granting
    // via the high-level helper here is cleaner than duplicating the
    // policy statement; grants the implicit kms:Decrypt the secret needs
    // if the Secrets Manager secret were ever moved to a CMK.
    //
    // `obtainExecutionRole()` lazily creates the execution role if it
    // doesn't exist yet (it normally lands when the container is added,
    // but we grant before that here so the order-of-operations is
    // explicit). Returns the same instance on subsequent calls.
    const executionRole = taskDefinition.obtainExecutionRole()
    temporalCloudSecret.grantRead(executionRole)
    workflowBrokerSecret.grantRead(executionRole)
    // Also grant the TASK role so the worker process can re-read the
    // broker secret in-band if a future revision wants to rotate without
    // a Fargate restart. (Cheap to add now; impossible to retrofit if the
    // worker ever starts caching the value and we change auth shape.)
    temporalCloudSecret.grantRead(taskDefinition.taskRole)
    workflowBrokerSecret.grantRead(taskDefinition.taskRole)

    // Container image — `latest` from the ECR repo created above. In Unit
    // 4 this image does not yet exist; with `desiredCount: 0` ECS never
    // tries to pull it. Unit 5 ships the first image.
    taskDefinition.addContainer('WorkerContainer', {
      containerName: 'temporal-worker',
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDriver.awsLogs({
        // Auto-grants the execution role logs:CreateLogStream +
        // logs:PutLogEvents on the targeted log group.
        logGroup,
        streamPrefix: 'worker',
      }),
      environment: {
        // Plain (non-secret) env vars. The worker process resolves these
        // at startup.
        TEMPORAL_NAMESPACE: temporalNamespace,
        TEMPORAL_ADDRESS: temporalAddress,
        TEMPORAL_TASK_QUEUE: temporalTaskQueue,
        PEGASUS_API_BASE_URL: pegasusApiBaseUrl,
        ENV_NAME: envName,
      },
      secrets: {
        // Temporal Cloud API key (JWT). Secret JSON shape:
        //   {"apiKey": "<jwt>"}
        // ecs.Secret.fromSecretsManager(secret, 'apiKey') makes Fargate
        // pull only the `apiKey` field at task start, not the full JSON.
        TEMPORAL_CLOUD_API_KEY: ecs.Secret.fromSecretsManager(temporalCloudSecret, 'apiKey'),
        // Broker shared secret — raw string, no JSON path.
        WORKFLOW_BROKER_SECRET: ecs.Secret.fromSecretsManager(workflowBrokerSecret),
      },
    })

    // -----------------------------------------------------------------------
    // Security group — egress-only. The worker never accepts inbound
    // (Temporal Cloud is poll-only: the worker dials out and holds long
    // gRPC streams). Default `allowAllOutbound: true` covers the four
    // outbound destinations (Temporal Cloud, ECR, CloudWatch Logs, the
    // Pegasus API).
    // -----------------------------------------------------------------------
    const workerSg = new ec2.SecurityGroup(this, 'WorkerSg', {
      vpc,
      securityGroupName: 'pegasus-temporal-worker',
      description: 'Temporal worker Fargate task — egress only (Temporal Cloud + ECR + Logs + Pegasus API).',
      allowAllOutbound: true,
    })

    // -----------------------------------------------------------------------
    // Fargate service — desiredCount: 0 in Unit 4. Unit 5 bumps to 1.
    // -----------------------------------------------------------------------
    const service = new ecs.FargateService(this, 'WorkerService', {
      serviceName: `pegasus-temporal-worker-${envName}`,
      cluster,
      taskDefinition,
      desiredCount: 0,
      // Place in the temporal-worker-egress subnet group, not the
      // hub-public or private-lambda subnets.
      vpcSubnets: { subnets: workerSubnets },
      securityGroups: [workerSg],
      // assignPublicIp defaults to false — correct: outbound goes via NAT.
      // No load balancer (worker is poll-only).
      enableExecuteCommand: false,
    })
    this.service = service

    // -----------------------------------------------------------------------
    // CloudFormation outputs — handy for ops + Unit 5's image push.
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'WorkerRepositoryUri', {
      value: repository.repositoryUri,
      description:
        'ECR repository URI for the temporal worker image. Unit 5 pushes here.',
    })
    new cdk.CfnOutput(this, 'WorkerClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster the worker service runs on.',
    })
    new cdk.CfnOutput(this, 'WorkerServiceName', {
      value: service.serviceName,
      description:
        'Fargate service name — bump desiredCount via the AWS CLI when the Unit 5 image is published.',
    })
    new cdk.CfnOutput(this, 'WorkerLogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch log group the worker container streams to.',
    })
  }
}
