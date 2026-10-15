// ---------------------------------------------------------------------------
// Tenant-runner orchestration — scale-to-zero (Phase 3 Unit 9).
//
// Resolved decision #1: tenant workflow code executes in a per-tenant ECS
// Fargate task (apps/tenant-runner) that is launched ON DEMAND via
// `ecs:RunTask` and exits on its own after an idle window (the idle-exit
// watchdog shipped in Unit 8). There is NO ECS service for runners — the
// "fleet" is whatever tasks are currently alive, and zero is the steady
// state. The ~30–60 s cold start (image pull + per-workflow venv install)
// on the first execution after idle is an accepted trade — workflows are
// async and triggers are not latency-sensitive.
//
// startedBy = tenantId (the dedupe scheme)
// ─────────────────────────────────────────
// ECS `RunTask.startedBy` accepts up to 36 characters; a canonical lowercase
// UUID is EXACTLY 36, so the tenant id itself is the tag (validated below —
// a non-UUID tenant id refuses to launch rather than silently truncating).
// `ListTasks { cluster, startedBy: tenantId }` then answers "is a runner
// already up for this tenant?" in one call, with no extra bookkeeping table.
// ListTasks' default desiredStatus filter is RUNNING, which covers tasks
// still PROVISIONING/PENDING too (their DESIRED status is already RUNNING)
// — so a runner mid-cold-start counts as "already running" and is not
// double-launched.
//
// Race posture (documented contract)
// ──────────────────────────────────
// ensureTenantRunner is check-then-act and deliberately NOT serialized: two
// concurrent calls for one tenant (e.g. the run path and the dispatcher
// sweep in the same second) can both see "no runner" and both RunTask. That
// is accepted for v1: both runners poll the same per-tenant Temporal queue,
// so work is never duplicated, and the idle-exit watchdog reaps the extra
// task within ~10 min. The window is small (ListTasks→RunTask, single-digit
// seconds at worst) and the launch sites are a 1-minute cron + a per-run
// hook, so duplicates should be rare; the cost of a distributed lock is not
// worth a transient second Fargate task.
//
// Credential exposure note (accepted v1 risk — see Unit 7/9 plan)
// ───────────────────────────────────────────────────────────────
// The per-tenant wbk_ broker token is passed as a RunTask container-override
// environment variable, which means anyone with `ecs:DescribeTasks` on the
// cluster can read it (overrides are echoed back in the task description).
// That surface is IAM-gated to operators + the dispatcher role; accepted for
// v1. A leak is revoked instantly via rotateTenantBrokerCredential
// (lib/tenant-broker-credential.ts) — rotation overwrites the stored hash so
// the old plaintext stops verifying. The token is intentionally NEVER logged
// here.
//
// Activation criterion (live since Unit 10)
// ─────────────────────────────────────────
// `executionNeedsTenantRunner` is the routing predicate, and it now delegates
// to `resolveWorkflowRoute` (lib/workflow-route.ts) so there is ONE source of
// truth for the run path and this orchestration. Unit 10 removed the old
// curated-only gate: the run path (lib/start-workflow-execution.ts) routes
// executable non-curated workflows to the tenant queue + runner, curated names
// to the stdlib queue, and only rejects non-curated AND non-executable rows as
// NOT_EXECUTABLE. So RunTask IS reached in production whenever an executable
// tenant workflow runs — this machinery is live, not inert.
//
// Config comes from TENANT_RUNNER_* env vars injected by the CDK ApiStack
// (packages/infra/lib/stacks/api-stack.ts); when absent (dev, tests, any
// env without the Fargate plane) every entry point is a clean no-op.
// ---------------------------------------------------------------------------

import {
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
  RunTaskCommand,
} from '@aws-sdk/client-ecs'
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import type { PrismaClient } from '@prisma/client'
import { getOrCreateTenantBrokerCredential } from './tenant-broker-credential'
import { resolveWorkflowRoute } from './workflow-route'
import { logger } from './logger'

// Duplicated literally from packages/infra/lib/metrics.ts for the same
// apps/api-can't-import-@pegasus/infra reason as the other emitters. Keep
// both sides in sync.
const METRIC_NAMESPACE = 'Pegasus/Workflows'
const METRIC_RUNNER_LAUNCHED = 'TenantRunnerLaunched'
const METRIC_RUNNER_LAUNCH_FAILED = 'TenantRunnerLaunchFailed'
const METRIC_RUNNERS_RUNNING = 'TenantRunnersRunning'
const METRIC_RUNNERS_NEEDED = 'TenantRunnersNeeded'
const METRIC_RUNNER_COLD_START_SECONDS = 'TenantRunnerColdStartSeconds'

/** Canonical lowercase-UUID shape — the only tenant id form we will pass as
 * `startedBy` (36 chars, exactly the ECS limit). */
const TENANT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type TenantRunnerConfig = {
  /** ECS cluster ARN the runner tasks launch into (the existing
   * pegasus-temporal-worker-<env> cluster — no second cluster). */
  clusterArn: string
  /** Task-definition FAMILY name (no revision). RunTask resolves a bare
   * family to its latest ACTIVE revision, so a CDK task-def update is picked
   * up by the next launch without re-wiring the dispatcher. */
  taskDefinition: string
  /** Container name inside the task definition — targets the env overrides. */
  containerName: string
  /** WireGuard-VPC PRIVATE_WITH_EGRESS subnet ids (same group as the stdlib
   * worker; flow logs are enabled on these subnets per Resolved #2). */
  subnetIds: string[]
  /** Egress-only security group id for runner tasks. */
  securityGroupId: string
  /** Phase 3b.2: family of the SCOPED task definition (no shared Temporal
   * key; the runner fetches its tenant's key from the broker). Null when
   * this environment hasn't deployed it yet — optional on purpose, see
   * loadTenantRunnerConfig. */
  scopedTaskDefinition: string | null
}

/**
 * Which runner task definition a launch uses (Phase 3b.2):
 *   legacy — `taskDefinition`: the shared Temporal key from the task
 *            definition; polls the shared namespace.
 *   scoped — `scopedTaskDefinition`: no Temporal secret; polls the tenant's
 *            own namespace with the key the broker serves.
 * Decided by WHERE the work lives (the execution row's temporalNamespace),
 * never by the tenant's current status.
 */
export type TenantRunnerFamily = 'legacy' | 'scoped'

/** The family an execution row needs, from its recorded namespace. */
export function runnerFamilyForNamespace(
  temporalNamespace: string | null | undefined,
): TenantRunnerFamily {
  return temporalNamespace == null ? 'legacy' : 'scoped'
}

/** The bare family name inside a task-definition ARN (`…/<family>:<rev>`). */
function taskDefinitionFamily(taskDefinitionArn: string | undefined): string | null {
  if (!taskDefinitionArn) return null
  const last = taskDefinitionArn.split('/').pop() ?? ''
  return last.split(':')[0] || null
}

/**
 * Reads the TENANT_RUNNER_* env contract injected by the CDK ApiStack.
 * Returns null unless ALL keys are present — a partial config means a
 * mis-deploy and must behave like "no runner plane" (clean no-op) rather
 * than launching half-configured tasks.
 */
export function loadTenantRunnerConfig(
  env: Record<string, string | undefined> = process.env,
): TenantRunnerConfig | null {
  const clusterArn = env['TENANT_RUNNER_CLUSTER_ARN']?.trim()
  const taskDefinition = env['TENANT_RUNNER_TASK_DEFINITION']?.trim()
  const containerName = env['TENANT_RUNNER_CONTAINER_NAME']?.trim()
  const subnetIdsRaw = env['TENANT_RUNNER_SUBNET_IDS']?.trim()
  const securityGroupId = env['TENANT_RUNNER_SECURITY_GROUP_ID']?.trim()
  if (!clusterArn || !taskDefinition || !containerName || !subnetIdsRaw || !securityGroupId) {
    return null
  }
  const subnetIds = subnetIdsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (subnetIds.length === 0) return null
  // NOT part of the all-or-nothing check above: if the API stack deploys
  // before the worker stack has the scoped task definition, every LEGACY
  // launch must keep working. Asking for the scoped family while it's unset is
  // a per-launch failure (SCOPED_UNCONFIGURED), and cutover refuses to start.
  const scopedTaskDefinition = env['TENANT_RUNNER_SCOPED_TASK_DEFINITION']?.trim() || null
  return {
    clusterArn,
    taskDefinition,
    containerName,
    subnetIds,
    securityGroupId,
    scopedTaskDefinition,
  }
}

// ---------------------------------------------------------------------------
// Activation criterion — delegates to resolveWorkflowRoute (Unit 10)
// ---------------------------------------------------------------------------

/**
 * Whether an execution of `workflow` will run on a per-tenant runner task
 * (vs the curated stdlib worker fleet).
 *
 * Unit 10: delegates entirely to resolveWorkflowRoute so there is ONE source
 * of truth for the routing decision. Callers (sweepTenantRunners, any future
 * per-execution hooks) that need "does this workflow need a runner?" now get
 * exactly the same answer as the run path.
 *
 * The `executable` field is required here (previously only `name` was needed)
 * because the real routing decision also checks eligibility. Code that calls
 * this function must supply both fields; the WorkflowRow type already does.
 */
export function executionNeedsTenantRunner(workflow: {
  name: string
  executable: boolean
}): boolean {
  return resolveWorkflowRoute(workflow) === 'TENANT_RUNNER'
}

// ---------------------------------------------------------------------------
// Clients (module-level lazy singletons; injectable for tests)
// ---------------------------------------------------------------------------

let sharedEcsClient: ECSClient | null = null
function defaultEcsClient(): ECSClient {
  sharedEcsClient ??= new ECSClient({})
  return sharedEcsClient
}

const cloudwatch = new CloudWatchClient({})

type MetricDatum = {
  MetricName: string
  Value: number
  Unit: 'Count' | 'Seconds'
  Dimensions?: Array<{ Name: string; Value: string }>
}

/** Observability, not correctness — a CloudWatch hiccup never fails the
 * caller. */
async function publishMetrics(metricData: MetricDatum[]): Promise<void> {
  if (metricData.length === 0) return
  const timestamp = new Date()
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: METRIC_NAMESPACE,
        MetricData: metricData.map((m) => ({ ...m, Timestamp: timestamp })),
      }),
    )
  } catch (err) {
    logger.error('Failed to publish tenant-runner metrics', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---------------------------------------------------------------------------
// ensureTenantRunner
// ---------------------------------------------------------------------------

export type EnsureTenantRunnerDeps = {
  /** Injectable for tests; defaults to a shared module-level client. */
  ecsClient?: ECSClient
  /** Injectable for tests; defaults to loadTenantRunnerConfig(). Pass null
   * to simulate an unconfigured environment. */
  config?: TenantRunnerConfig | null
}

export type EnsureTenantRunnerOptions = EnsureTenantRunnerDeps & {
  /** Which task definition (Phase 3b.2). Defaults to legacy. */
  family?: TenantRunnerFamily
}

export type EnsureTenantRunnerResult =
  /** No TENANT_RUNNER_* config in this environment — nothing to do. */
  | { outcome: 'SKIPPED_UNCONFIGURED' }
  /** Operator kill switch — workflowsDisabled=true on the tenant. */
  | { outcome: 'SKIPPED_DISABLED' }
  /** A runner task for this tenant is already RUNNING (or provisioning
   * toward RUNNING) — no launch needed. */
  | { outcome: 'ALREADY_RUNNING'; taskArns: string[] }
  /** RunTask accepted the launch. */
  | { outcome: 'LAUNCHED'; taskArn: string }
  /** The launch could not be performed. The execution this was ensuring a
   * runner for stays QUEUED on its Temporal queue; the dispatcher sweep
   * retries on the next tick, so this is degraded latency, not data loss. */
  | { outcome: 'LAUNCH_FAILED'; reason: string }

/**
 * Ensures a tenant-runner ECS task is up (or launching) for `tenantId`,
 * launching one via RunTask if none is found. Never throws for the failure
 * modes it models — callers (the run path, the dispatcher sweep) treat a
 * failed launch as a logged, metric-counted soft failure because the
 * dispatcher sweep retries every minute while QUEUED work exists.
 *
 * Idempotency: see the module header's "Race posture" — a lost race means a
 * transient duplicate runner, which idle-exit self-heals.
 */
export async function ensureTenantRunner(
  db: PrismaClient,
  tenantId: string,
  deps: EnsureTenantRunnerOptions = {},
): Promise<EnsureTenantRunnerResult> {
  const config = deps.config !== undefined ? deps.config : loadTenantRunnerConfig()
  if (!config) {
    return { outcome: 'SKIPPED_UNCONFIGURED' }
  }
  const family = deps.family ?? 'legacy'
  const taskDefinition = family === 'scoped' ? config.scopedTaskDefinition : config.taskDefinition

  // Kill-switch: refuse to launch a runner for a disabled tenant. The check is
  // a cheap primary-key lookup. We do NOT throw — callers treat this as a soft
  // no-op (logged below; the QUEUED execution stays on its Temporal queue but
  // cannot start until the operator re-enables the tenant).
  const tenantRow = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { workflowsDisabled: true },
  })
  if (tenantRow?.workflowsDisabled === true) {
    logger.info('Tenant-runner launch skipped — workflows disabled for tenant', { tenantId })
    return { outcome: 'SKIPPED_DISABLED' }
  }

  // startedBy carries the tenant id; ECS caps it at 36 chars. A canonical
  // lowercase UUID is exactly 36 — anything else would silently break the
  // ListTasks dedupe, so refuse to launch instead.
  if (!TENANT_ID_REGEX.test(tenantId)) {
    logger.error('Tenant id is not a canonical lowercase UUID — refusing to launch runner', {
      tenantId,
    })
    await publishMetrics([{ MetricName: METRIC_RUNNER_LAUNCH_FAILED, Value: 1, Unit: 'Count' }])
    return { outcome: 'LAUNCH_FAILED', reason: 'INVALID_TENANT_ID' }
  }

  // Scoped work with no scoped task definition deployed: fail loudly. Never
  // fall back to the legacy family — its runner polls the shared namespace
  // and would leave the tenant-namespace work stranded anyway.
  if (!taskDefinition) {
    logger.error('Scoped tenant-runner requested but no scoped task definition is configured', {
      tenantId,
    })
    await publishMetrics([{ MetricName: METRIC_RUNNER_LAUNCH_FAILED, Value: 1, Unit: 'Count' }])
    return { outcome: 'LAUNCH_FAILED', reason: 'SCOPED_UNCONFIGURED' }
  }

  const ecs = deps.ecsClient ?? defaultEcsClient()

  try {
    // Default desiredStatus filter is RUNNING, which includes tasks still
    // PROVISIONING/PENDING (their desired status is already RUNNING). A
    // STOPPED (idle-exited) runner does not match — correct: it must be
    // relaunched. One page is plenty: at most a couple of tasks per tenant
    // exist even mid-race.
    const listed = await ecs.send(
      new ListTasksCommand({ cluster: config.clusterArn, startedBy: tenantId }),
    )
    const listedArns = listed.taskArns ?? []
    // Family-aware (Phase 3b.2): `startedBy` is the tenant id alone, so it
    // matches the tenant's runners of BOTH families. Only a runner of the
    // wanted family counts — otherwise a legacy runner idling out after a
    // cutover would hold off the scoped launch for its whole idle window.
    let existing: string[] = []
    if (listedArns.length > 0) {
      const described = await ecs.send(
        new DescribeTasksCommand({ cluster: config.clusterArn, tasks: listedArns }),
      )
      existing = (described.tasks ?? [])
        .filter((t) => taskDefinitionFamily(t.taskDefinitionArn) === taskDefinition)
        .map((t) => t.taskArn)
        .filter((arn): arn is string => typeof arn === 'string')
    }
    if (existing.length > 0) {
      return { outcome: 'ALREADY_RUNNING', taskArns: existing }
    }

    // Recover the tenant's wbk_ broker-token plaintext (KMS-decrypt of
    // TenantBrokerCredential.tokenCiphertext; minted on first use). This is
    // the ONLY launch-time credential — the runner holds no AWS credentials
    // and never sees the shared broker secret (Unit 7/8 contract).
    const brokerToken = await getOrCreateTenantBrokerCredential(db, tenantId)

    const launched = await ecs.send(
      new RunTaskCommand({
        cluster: config.clusterArn,
        // Bare family name → ECS resolves the latest ACTIVE revision.
        taskDefinition,
        launchType: 'FARGATE',
        count: 1,
        startedBy: tenantId,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.subnetIds,
            securityGroups: [config.securityGroupId],
            // Egress goes via the NAT on the PRIVATE_WITH_EGRESS subnets.
            assignPublicIp: 'DISABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: config.containerName,
              // Per-launch env contract — mirrors
              // apps/tenant-runner/pegasus_tenant_runner/config.py. The
              // static half (ENV_NAME / TEMPORAL_* / PEGASUS_API_BASE_URL /
              // TEMPORAL_CLOUD_API_KEY) lives on the task definition.
              environment: [
                { name: 'TENANT_ID', value: tenantId },
                { name: 'WORKFLOW_BROKER_TOKEN', value: brokerToken },
              ],
            },
          ],
        },
      }),
    )

    // RunTask reports capacity/placement problems as a `failures` array on
    // a 200 response — they must be treated as launch failures, not success.
    const failure = launched.failures?.[0]
    const task = launched.tasks?.[0]
    if (failure || !task?.taskArn) {
      const reason = failure?.reason ?? 'NO_TASK_RETURNED'
      logger.error('Tenant-runner RunTask did not launch a task', {
        tenantId,
        reason,
        detail: failure?.detail ?? null,
      })
      await publishMetrics([{ MetricName: METRIC_RUNNER_LAUNCH_FAILED, Value: 1, Unit: 'Count' }])
      return { outcome: 'LAUNCH_FAILED', reason }
    }

    logger.info('Tenant-runner task launched', {
      tenantId,
      taskArn: task.taskArn,
      taskDefinition,
      family,
    })
    await publishMetrics([{ MetricName: METRIC_RUNNER_LAUNCHED, Value: 1, Unit: 'Count' }])
    return { outcome: 'LAUNCHED', taskArn: task.taskArn }
  } catch (err) {
    // Covers ListTasks/RunTask SDK throws AND broker-credential recovery
    // (DB/KMS) failures. Soft-fail by contract — see the result type docs.
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Tenant-runner launch failed', { tenantId, error: message })
    await publishMetrics([{ MetricName: METRIC_RUNNER_LAUNCH_FAILED, Value: 1, Unit: 'Count' }])
    return { outcome: 'LAUNCH_FAILED', reason: message }
  }
}

// ---------------------------------------------------------------------------
// Dispatcher-tick sweep (backstop) + pool metrics
// ---------------------------------------------------------------------------

export type SweepTenantRunnersResult = {
  /** Tenants that had runner-bound QUEUED/RUNNING work this tick. */
  tenantsNeedingRunner: number
  /** How many of those got a fresh RunTask this tick. */
  launched: number
  /** Launches that failed (see LAUNCH_FAILED contract). */
  launchFailed: number
}

/**
 * The crash-recovery backstop, run once per dispatcher tick (1 min): for
 * every tenant that has QUEUED/RUNNING executions whose workflow routes to a
 * tenant runner (executionNeedsTenantRunner), make sure a runner task is up.
 * This is what relaunches a runner that crashed (or idle-exited between a
 * Temporal start and its first poll) while work is still outstanding —
 * without it, a lost runner would strand QUEUED executions until a human
 * noticed.
 *
 * Live since Unit 10: executable non-curated workflows route to the tenant
 * runner and acquire QUEUED/RUNNING execution rows, so this scan picks them up
 * and relaunches a crashed/idle-exited runner while their work is outstanding.
 *
 * Also publishes the pool gauges every tick (even when 0, so the metric
 * exists and alarms in Unit 11 can use missing-data semantics deliberately):
 *   - TenantRunnersRunning — count of runner tasks with lastStatus RUNNING
 *   - TenantRunnerColdStartSeconds — startedAt-minus-createdAt for tasks
 *     that reached RUNNING within the last ~tick (window-deduped; a
 *     boundary task may emit twice, harmless for a latency stat)
 */
export async function sweepTenantRunners(
  db: PrismaClient,
  deps: EnsureTenantRunnerDeps & { now?: () => Date } = {},
): Promise<SweepTenantRunnersResult> {
  const result: SweepTenantRunnersResult = {
    tenantsNeedingRunner: 0,
    launched: 0,
    launchFailed: 0,
  }
  const config = deps.config !== undefined ? deps.config : loadTenantRunnerConfig()
  if (!config) return result

  // Tenants with outstanding runner-bound work. The row count here is small
  // by construction (Resolved #3 caps concurrent executions per tenant), so
  // an unaggregated select + in-process filter is fine.
  // `executable` is required by executionNeedsTenantRunner (Unit 10: the
  // routing decision also checks eligibility, not just name).
  const open = await db.workflowExecution.findMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
    select: {
      tenantId: true,
      temporalNamespace: true,
      workflow: { select: { name: true, executable: true } },
    },
  })
  // One demand per (tenant, family), the family read from each row's recorded
  // namespace (Phase 3b.2) rather than the tenant's current status. Mid-cutover
  // a tenant can briefly have work in both namespaces (a start that raced the
  // flip to DRAINING); each half gets the runner that can reach it.
  const demands = new Map<string, { tenantId: string; family: TenantRunnerFamily }>()
  for (const row of open) {
    if (!executionNeedsTenantRunner(row.workflow)) continue
    const family = runnerFamilyForNamespace(row.temporalNamespace)
    demands.set(`${row.tenantId}:${family}`, { tenantId: row.tenantId, family })
  }
  result.tenantsNeedingRunner = demands.size

  // Publish the demand gauge EVERY tick (0 included, like TenantRunnersRunning)
  // so the starvation alarm — Needed >= 1 while Running < 1 — has a continuous
  // series and can use NOT_BREACHING missing-data semantics. Emitted before the
  // launch loop so a slow/failing RunTask never delays or drops it.
  await publishMetrics([{ MetricName: METRIC_RUNNERS_NEEDED, Value: demands.size, Unit: 'Count' }])

  // Sequential on purpose: per-tenant isolation (one tenant's failure never
  // skips another) and no thundering RunTask herd on a busy tick.
  for (const { tenantId, family } of demands.values()) {
    const ensured = await ensureTenantRunner(db, tenantId, { ...deps, family })
    if (ensured.outcome === 'LAUNCHED') result.launched += 1
    // SKIPPED_DISABLED is a clean no-op — operator kill switch. Not a failure.
    if (ensured.outcome === 'LAUNCH_FAILED') result.launchFailed += 1
  }

  await publishTenantRunnerPoolMetrics(deps)
  return result
}

/** How far back a task's startedAt may lie and still count as "became
 * RUNNING this tick" for the cold-start metric. 90 s = one 60 s tick plus
 * margin for tick jitter; overlap double-emits are accepted (latency stat,
 * not a counter). */
const COLD_START_WINDOW_MS = 90_000

/**
 * Publishes TenantRunnersRunning (always, even 0) and
 * TenantRunnerColdStartSeconds (for tasks that just reached RUNNING).
 * Failures are logged and swallowed — pool metrics must never break a tick.
 */
export async function publishTenantRunnerPoolMetrics(
  deps: EnsureTenantRunnerDeps & { now?: () => Date } = {},
): Promise<void> {
  const config = deps.config !== undefined ? deps.config : loadTenantRunnerConfig()
  if (!config) return
  const ecs = deps.ecsClient ?? defaultEcsClient()
  const now = deps.now ? deps.now() : new Date()

  try {
    // Family filter scopes to runner tasks only (the cluster is shared with
    // the stdlib worker service). One page (100 ARNs) is far beyond v1
    // scale; if we ever run >100 concurrent tenant runners the gauge
    // saturating at 100 is the least of our problems — revisit then.
    // Both families (Phase 3b.2): the gauge counts every runner.
    const families = [config.taskDefinition, config.scopedTaskDefinition].filter(
      (f): f is string => f !== null,
    )
    const taskArns: string[] = []
    for (const family of families) {
      const listed = await ecs.send(new ListTasksCommand({ cluster: config.clusterArn, family }))
      taskArns.push(...(listed.taskArns ?? []))
    }

    let running = 0
    const metricData: MetricDatum[] = []
    if (taskArns.length > 0) {
      const described = await ecs.send(
        new DescribeTasksCommand({ cluster: config.clusterArn, tasks: taskArns }),
      )
      for (const task of described.tasks ?? []) {
        if (task.lastStatus !== 'RUNNING') continue
        running += 1
        // Cold-start latency: RunTask accept (createdAt) → container RUNNING
        // (startedAt). Emitted only for tasks that newly reached RUNNING.
        if (
          task.createdAt &&
          task.startedAt &&
          now.getTime() - task.startedAt.getTime() <= COLD_START_WINDOW_MS
        ) {
          metricData.push({
            MetricName: METRIC_RUNNER_COLD_START_SECONDS,
            Value: Math.max(0, (task.startedAt.getTime() - task.createdAt.getTime()) / 1000),
            Unit: 'Seconds',
          })
        }
      }
    }

    metricData.push({ MetricName: METRIC_RUNNERS_RUNNING, Value: running, Unit: 'Count' })
    await publishMetrics(metricData)
  } catch (err) {
    logger.error('Failed to compute tenant-runner pool metrics', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
