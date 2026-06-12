// ---------------------------------------------------------------------------
// TemporalWorkerStack — ECS Fargate plane for the curated stdlib Temporal
// worker (apps/temporal-worker, lands in Phase 2 Unit 5).
//
// Lifecycle across Phase 2 units:
//   - Unit 4: synthesised the dormant fleet. ECR repo exists but contained
//     no images; Fargate service was created with `desiredCount: 0` so ECS
//     never tried to pull the placeholder image.
//   - Unit 5 (this commit): the Python worker image now lives in
//     `apps/temporal-worker/` and is built+pushed to the ECR repo by
//     `.github/workflows/temporal-worker.yml` on every push to main that
//     touches the worker source or its bundled SDK/stdlib packages.
//     `desiredCount` is bumped to 1 so the worker connects to Temporal
//     Cloud and registers on the shared task queue.
//   - Unit 6: wires the API to start workflows on the same namespace; the
//     fleet here is what executes them.
//   - Unit 7: tenant-web UI to trigger runs.
//   - Phase 3 Unit 9: this stack also hosts the TENANT-RUNNER plane (ECR
//     repo + RunTask-only task definition, no service) — see the
//     "Tenant-runner plane" section below for why it lives here.
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
//   per env (us-east-1: $0.045/hr + data-processing). Unit 5 adds the
//   Fargate task cost: 0.5 vCPU + 1 GiB ~= $13/mo per env. ECR storage
//   stays negligible.
// ---------------------------------------------------------------------------

import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as iam from 'aws-cdk-lib/aws-iam'
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

  /**
   * Full Secrets Manager ARN (with the 6-char random suffix) for the
   * Temporal Cloud API-key secret. Sourced from `TEMPORAL_SECRET_ARNS`
   * in `bin/app.ts`. Required: ECS task-secret injection fails with
   * `ResourceNotFoundException` if given the no-suffix ARN that
   * `Secret.fromSecretNameV2` produces, so we use
   * `Secret.fromSecretCompleteArn` to thread the suffix through.
   */
  readonly temporalCloudSecretArn: string

  /**
   * Full Secrets Manager ARN (with the 6-char random suffix) for the
   * workflow-broker shared secret. Same rationale as
   * `temporalCloudSecretArn`.
   */
  readonly workflowBrokerSecretArn: string
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

  /** Fargate service, running at `desiredCount: 1` since Unit 5. */
  public readonly service: ecs.FargateService

  /** Dedicated CloudWatch log group, retained on stack delete. */
  public readonly logGroup: logs.ILogGroup

  /** ECR repository the tenant-runner image build pushes to (Phase 3 Unit 9). */
  public readonly tenantRunnerRepository: ecr.IRepository

  /** Tenant-runner Fargate task definition — launched via RunTask, never a
   * service (scale-to-zero, Phase 3 Unit 9). */
  public readonly tenantRunnerTaskDefinition: ecs.FargateTaskDefinition

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
    // plan's operator prereqs.
    //
    // Why `fromSecretCompleteArn` (with the suffix), not `fromSecretNameV2`:
    // `Secret.fromSecretNameV2` produces a no-suffix ARN
    // (`arn:...:secret:pegasus/<env>/<name>`). ECS task-secret injection
    // then puts that no-suffix ARN into the container's
    // `secrets[].valueFrom`. When Fargate calls
    // `secretsmanager:GetSecretValue` with that ARN, Secrets Manager
    // returns `ResourceNotFoundException: Secrets Manager can't find the
    // specified secret` — verified live 2026-06-06 from the staging
    // account. The no-suffix ARN is NOT a valid SecretId at the SM API,
    // despite some AWS docs implying it is. Using the full ARN
    // (with the 6-char suffix) fixes both the ECS lookup AND lets the
    // default `grantRead` IAM grant match the actual call. The per-env
    // ARN values live in `TEMPORAL_SECRET_ARNS` in bin/app.ts.
    // -----------------------------------------------------------------------
    const temporalCloudSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'TemporalCloudSecret',
      props.temporalCloudSecretArn,
    )
    const workflowBrokerSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'WorkflowBrokerSecret',
      props.workflowBrokerSecretArn,
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
    // With `fromSecretCompleteArn` above, the standard `grantRead` helper
    // produces a policy whose Resource is exactly the full ARN (with
    // suffix) that ECS injects into `secrets[].valueFrom` — so IAM
    // evaluation matches the actual SM API call. No wildcard needed.
    const executionRole = taskDefinition.obtainExecutionRole()
    temporalCloudSecret.grantRead(executionRole)
    workflowBrokerSecret.grantRead(executionRole)
    // Also grant the TASK role so the worker process can re-read the
    // broker secret in-band if a future revision wants to rotate without
    // a Fargate restart. (Cheap to add now; impossible to retrofit if the
    // worker ever starts caching the value and we change auth shape.)
    temporalCloudSecret.grantRead(taskDefinition.taskRole)
    workflowBrokerSecret.grantRead(taskDefinition.taskRole)

    // Container image — `latest` from the ECR repo created above. Unit 5
    // ships the first image via .github/workflows/temporal-worker.yml.
    // Each push to main that touches apps/temporal-worker/ (or the
    // bundled SDK/stdlib) rolls a new `:latest` tag and forces a Fargate
    // redeploy with `aws ecs update-service --force-new-deployment`.
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
      // EC2 rejects non-ASCII in SecurityGroup GroupDescription ("Character
      // sets beyond ASCII are not supported"). Keep this string plain ASCII —
      // the file-level comments above can stay UTF-8 since they never reach AWS.
      description:
        'Temporal worker Fargate task - egress only (Temporal Cloud + ECR + Logs + Pegasus API).',
      allowAllOutbound: true,
    })

    // -----------------------------------------------------------------------
    // Fargate service — running at desiredCount: 1 since Phase 2 Unit 5.
    // The first image landed via .github/workflows/temporal-worker.yml so
    // ECS now has something to pull.
    // -----------------------------------------------------------------------
    const service = new ecs.FargateService(this, 'WorkerService', {
      serviceName: `pegasus-temporal-worker-${envName}`,
      cluster,
      taskDefinition,
      // Phase 2 Unit 5: image present, one task per env is enough for
      // the curated stdlib's expected load. Scale up here when manual
      // load justifies it.
      desiredCount: 1,
      // Place in the temporal-worker-egress subnet group, not the
      // hub-public or private-lambda subnets.
      vpcSubnets: { subnets: workerSubnets },
      securityGroups: [workerSg],
      // assignPublicIp defaults to false — correct: outbound goes via NAT.
      // No load balancer (worker is poll-only).
      enableExecuteCommand: false,
      // Deployment circuit breaker — if the worker image is broken (which
      // it will be on the first Unit 5 deploy if the bundle has a defect),
      // we want CFN to roll back in ~5 min instead of the default 3-hour
      // wait. Rollback flips the service back to the previous task def.
      circuitBreaker: { rollback: true },
      // For a single-task fleet this is moot (desiredCount: 0 → 1 in
      // Unit 5), but pinning the percentages explicit silences the
      // upstream CDK warning and documents the rolling-deploy shape.
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
    })
    this.service = service

    // =========================================================================
    // Tenant-runner plane (Phase 3 Unit 9 — scale-to-zero).
    //
    // The tenant runner (apps/tenant-runner) executes UNTRUSTED tenant
    // workflow code, one tenant per task. Unlike the stdlib worker above
    // there is deliberately NO FargateService: runners are launched on
    // demand by the API-side dispatcher via `ecs:RunTask` (Resolved
    // decision #1) into THIS stack's cluster, and self-terminate after an
    // idle window (the Unit-8 idle-exit watchdog). Zero running tasks is
    // the steady state, so the only always-on cost here is ECR storage.
    //
    // Extending this stack (vs a new TenantRunnerStack) is deliberate:
    //   - the cluster, VPC subnets, secret ARNs, and env wiring already
    //     live here — a sibling stack would re-import all of them; and
    //   - a brand-new stack whose first deploy fails leaves RETAINed
    //     orphans (ECR repo, log groups) that block every retry with
    //     "already exists" (see [[feedback_cdk_retain_orphans_on_rollback]]).
    //     This stack is live and healthy in both envs, so these additions
    //     ride a routine UPDATE. (An update rollback could still orphan the
    //     new named RETAIN resources — accepted: nothing in this change is
    //     validated at deploy time, unlike a service rollout, so the
    //     realistic failure window is ~nil. Cleanup commands are in the
    //     Unit 9 PR body if it ever happens.)
    //
    // Cross-stack contract with ApiStack (the dispatcher side) is BY NAME,
    // not by construct ref: TemporalWorkerStack already depends on ApiStack
    // (PEGASUS_API_BASE_URL), so passing constructs back would be a cycle.
    // The names below are therefore load-bearing and mirrored in
    // api-stack.ts — change both sides together:
    //   - cluster        pegasus-temporal-worker-<env>   (above)
    //   - task family    pegasus-tenant-runner-<env>
    //   - task role      pegasus-tenant-runner-task-<env>
    //   - exec role      pegasus-tenant-runner-exec-<env>
    // =========================================================================

    // ECR repository — mirror of the worker repo's settings (RETAIN, scan on
    // push, last-20 lifecycle). The image is built + pushed by
    // .github/workflows/tenant-runner.yml; the task definition tracks
    // `:latest`, which RunTask resolves at every launch, so a fresh image
    // needs no CDK deploy and no service roll — the next runner launch just
    // picks it up (already-running runners keep their image until idle-exit).
    const tenantRunnerRepository = new ecr.Repository(this, 'TenantRunnerRepository', {
      repositoryName: 'pegasus-tenant-runner',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: ecr.RepositoryEncryption.AES_256,
      lifecycleRules: [
        {
          description: 'Retain the most recent 20 images; expire older.',
          maxImageCount: 20,
          rulePriority: 1,
        },
      ],
    })
    this.tenantRunnerRepository = tenantRunnerRepository

    // Dedicated log group — runner logs must never interleave with the
    // trusted worker's (different trust domains, different retention needs
    // could diverge later). RETAIN like the worker's: runner logs are the
    // primary audit trail for tenant-code executions.
    const tenantRunnerLogGroup = new logs.LogGroup(this, 'TenantRunnerLogGroup', {
      logGroupName: `/pegasus/${envName}/tenant-runner`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // Task role — assumed by the running container. Deliberately EMPTY of
    // permissions: the runner holds NO AWS credentials by design (artifact
    // downloads use broker-issued presigned URLs; the broker token is its
    // only credential — see apps/tenant-runner/README.md "Trust model").
    // The role still exists (rather than letting CDK synthesize one) so its
    // NAME is deterministic for the dispatcher's iam:PassRole grant.
    const tenantRunnerTaskRole = new iam.Role(this, 'TenantRunnerTaskRole', {
      roleName: `pegasus-tenant-runner-task-${envName}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description:
        'Tenant-runner task role - intentionally NO permissions (runner holds no AWS credentials).',
    })

    // Execution role — used by the ECS agent (not the container): ECR pull,
    // awslogs delivery, and the Secrets Manager read for the one secret env
    // var injected below. Deterministic name for the same PassRole reason.
    const tenantRunnerExecutionRole = new iam.Role(this, 'TenantRunnerExecutionRole', {
      roleName: `pegasus-tenant-runner-exec-${envName}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Tenant-runner execution role - ECR pull + awslogs + secret injection.',
    })

    // Task definition. Same 0.5 vCPU / 1 GiB as the stdlib worker — the
    // runner is equally IO-bound (Temporal polling + HTTP + a venv install
    // at startup); the per-execution subprocess inherits this envelope,
    // which doubles as the fixed CPU/memory limit from Resolved #3.
    const tenantRunnerTaskDef = new ecs.FargateTaskDefinition(this, 'TenantRunnerTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      family: `pegasus-tenant-runner-${envName}`,
      taskRole: tenantRunnerTaskRole,
      executionRole: tenantRunnerExecutionRole,
    })
    this.tenantRunnerTaskDefinition = tenantRunnerTaskDef

    tenantRunnerTaskDef.addContainer('TenantRunnerContainer', {
      // Mirrored in api-stack.ts as TENANT_RUNNER_CONTAINER_NAME — the
      // dispatcher's containerOverrides target this name at RunTask time.
      containerName: 'tenant-runner',
      image: ecs.ContainerImage.fromEcrRepository(tenantRunnerRepository, 'latest'),
      logging: ecs.LogDriver.awsLogs({
        logGroup: tenantRunnerLogGroup,
        streamPrefix: 'runner',
      }),
      environment: {
        // STATIC half of the runner env contract
        // (apps/tenant-runner/pegasus_tenant_runner/config.py). The
        // per-launch half — TENANT_ID + WORKFLOW_BROKER_TOKEN — arrives as
        // RunTask containerOverrides from the dispatcher
        // (apps/api/src/lib/tenant-runner.ts); it is per-tenant and cannot
        // live on a shared task definition.
        ENV_NAME: envName,
        TEMPORAL_NAMESPACE: temporalNamespace,
        TEMPORAL_ADDRESS: temporalAddress,
        PEGASUS_API_BASE_URL: pegasusApiBaseUrl,
      },
      secrets: {
        // Same complete-ARN secret object as the worker container above —
        // see the fromSecretCompleteArn block for why the suffixed ARN is
        // mandatory. NOTE the asymmetry vs the worker: the runner gets the
        // Temporal Cloud key ONLY. The shared WORKFLOW_BROKER_SECRET must
        // NEVER reach a tenant-runner task (Unit 7's whole point) — its
        // per-tenant wbk_ token arrives via RunTask override instead.
        TEMPORAL_CLOUD_API_KEY: ecs.Secret.fromSecretsManager(temporalCloudSecret, 'apiKey'),
      },
    })

    // Secret read for the injection above. Execution role only — the
    // container's task role stays empty (the runner process never calls
    // AWS APIs, and tenant code must find nothing if it ever reaches the
    // task-role credentials endpoint).
    temporalCloudSecret.grantRead(tenantRunnerExecutionRole)

    // -----------------------------------------------------------------------
    // CloudFormation outputs — handy for ops + Unit 5's image push.
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'WorkerRepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR repository URI for the temporal worker image. Unit 5 pushes here.',
    })
    new cdk.CfnOutput(this, 'WorkerClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster the worker service runs on.',
    })
    new cdk.CfnOutput(this, 'WorkerServiceName', {
      value: service.serviceName,
      description:
        'Fargate service name. Use with `aws ecs update-service --force-new-deployment` to roll to a freshly-pushed worker image.',
    })
    new cdk.CfnOutput(this, 'WorkerLogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch log group the worker container streams to.',
    })
    new cdk.CfnOutput(this, 'TenantRunnerRepositoryUri', {
      value: tenantRunnerRepository.repositoryUri,
      description:
        'ECR repository URI for the tenant-runner image. .github/workflows/tenant-runner.yml pushes here.',
    })
    new cdk.CfnOutput(this, 'TenantRunnerTaskDefinitionFamily', {
      value: tenantRunnerTaskDef.family,
      description:
        'Tenant-runner task-definition family. The dispatcher RunTasks the latest ACTIVE revision of this family.',
    })
    new cdk.CfnOutput(this, 'TenantRunnerLogGroupName', {
      value: tenantRunnerLogGroup.logGroupName,
      description: 'CloudWatch log group tenant-runner tasks stream to.',
    })
  }
}
