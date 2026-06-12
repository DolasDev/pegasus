// ---------------------------------------------------------------------------
// Unit tests for the tenant-runner orchestration lib (Phase 3 Unit 9).
//
// Covers the full dispatcher contract with a mocked ECS client:
//   - config loading (all-or-nothing TENANT_RUNNER_* env)
//   - the inert-today activation criterion (curated complement)
//   - ensureTenantRunner: skip-unconfigured, startedBy dedupe vs ListTasks,
//     the RunTask launch shape (network config + per-launch env overrides),
//     KMS broker-token recovery ordering, failures[] handling, soft-fail on
//     SDK/broker errors, and the documented double-launch race posture
//   - sweepTenantRunners: tenant dedupe, curated filtering, per-tenant
//     failure isolation, no-op without config
//   - pool metrics: running gauge (emitted even at 0) + cold-start window
//
// The ECS client is injected via deps (no module mock needed — commands are
// matched with instanceof against the real SDK classes). The CloudWatch SDK
// and the broker-credential lib are module-mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DescribeTasksCommand,
  ListTasksCommand,
  RunTaskCommand,
  type ECSClient,
} from '@aws-sdk/client-ecs'
import type { PrismaClient } from '@prisma/client'

const { mockCwSend, putMetricDataInputs, mockGetOrCreateCredential } = vi.hoisted(() => ({
  mockCwSend: vi.fn(),
  putMetricDataInputs: [] as Array<{
    Namespace?: string
    MetricData?: Array<{ MetricName?: string; Value?: number; Unit?: string }>
  }>,
  mockGetOrCreateCredential: vi.fn(),
}))

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = mockCwSend
  },
  PutMetricDataCommand: class {
    public input: unknown
    constructor(input: unknown) {
      this.input = input
      putMetricDataInputs.push(input as (typeof putMetricDataInputs)[number])
    }
  },
}))

vi.mock('./tenant-broker-credential', () => ({
  getOrCreateTenantBrokerCredential: mockGetOrCreateCredential,
}))

import {
  ensureTenantRunner,
  executionNeedsTenantRunner,
  loadTenantRunnerConfig,
  publishTenantRunnerPoolMetrics,
  sweepTenantRunners,
  type TenantRunnerConfig,
} from './tenant-runner'

// ── Fixtures ─────────────────────────────────────────────────────────────

const TENANT_ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const OTHER_TENANT_ID = '11111111-2222-4333-8444-555555555555'
const BROKER_TOKEN = `wbk_${TENANT_ID}_${'ab'.repeat(24)}`

const config: TenantRunnerConfig = {
  clusterArn: 'arn:aws:ecs:us-east-1:111111111111:cluster/pegasus-temporal-worker-staging',
  taskDefinition: 'pegasus-tenant-runner-staging',
  containerName: 'tenant-runner',
  subnetIds: ['subnet-aaa', 'subnet-bbb'],
  securityGroupId: 'sg-ccc',
}

const fullEnv = {
  TENANT_RUNNER_CLUSTER_ARN: config.clusterArn,
  TENANT_RUNNER_TASK_DEFINITION: config.taskDefinition,
  TENANT_RUNNER_CONTAINER_NAME: config.containerName,
  TENANT_RUNNER_SUBNET_IDS: 'subnet-aaa,subnet-bbb',
  TENANT_RUNNER_SECURITY_GROUP_ID: config.securityGroupId,
}

/** Fake ECS client whose send() routes by command class. */
function fakeEcs(handlers: {
  listTasks?: (input: ListTasksCommand['input']) => unknown
  runTask?: (input: RunTaskCommand['input']) => unknown
  describeTasks?: (input: DescribeTasksCommand['input']) => unknown
}) {
  const calls = {
    listTasks: [] as Array<ListTasksCommand['input']>,
    runTask: [] as Array<RunTaskCommand['input']>,
    describeTasks: [] as Array<DescribeTasksCommand['input']>,
  }
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ListTasksCommand) {
      calls.listTasks.push(command.input)
      return handlers.listTasks ? handlers.listTasks(command.input) : { taskArns: [] }
    }
    if (command instanceof RunTaskCommand) {
      calls.runTask.push(command.input)
      return handlers.runTask
        ? handlers.runTask(command.input)
        : { tasks: [{ taskArn: 'arn:task/launched' }], failures: [] }
    }
    if (command instanceof DescribeTasksCommand) {
      calls.describeTasks.push(command.input)
      return handlers.describeTasks ? handlers.describeTasks(command.input) : { tasks: [] }
    }
    throw new Error(`unexpected ECS command: ${String(command)}`)
  })
  return { client: { send } as unknown as ECSClient, calls, send }
}

const db = {} as PrismaClient

function emittedMetricNames(): string[] {
  return putMetricDataInputs.flatMap((p) => (p.MetricData ?? []).map((m) => m.MetricName ?? ''))
}

beforeEach(() => {
  vi.clearAllMocks()
  putMetricDataInputs.length = 0
  mockGetOrCreateCredential.mockResolvedValue(BROKER_TOKEN)
  mockCwSend.mockResolvedValue({})
})

// ── loadTenantRunnerConfig ───────────────────────────────────────────────

describe('loadTenantRunnerConfig', () => {
  it('parses a complete TENANT_RUNNER_* env (splitting subnet ids)', () => {
    expect(loadTenantRunnerConfig(fullEnv)).toEqual(config)
  })

  it.each(Object.keys(fullEnv))('returns null when %s is missing (all-or-nothing)', (key) => {
    const env: Record<string, string | undefined> = { ...fullEnv }
    delete env[key]
    expect(loadTenantRunnerConfig(env)).toBeNull()
  })

  it('returns null for an effectively empty subnet list', () => {
    expect(loadTenantRunnerConfig({ ...fullEnv, TENANT_RUNNER_SUBNET_IDS: ' , ' })).toBeNull()
  })
})

// ── executionNeedsTenantRunner ───────────────────────────────────────────

describe('executionNeedsTenantRunner', () => {
  it('is false for curated stdlib names (they run on the shared worker fleet)', () => {
    expect(executionNeedsTenantRunner({ name: 'send_quote_followup' })).toBe(false)
  })

  it('is true for non-curated names — the curated-gate complement Unit 10 will flip', () => {
    expect(executionNeedsTenantRunner({ name: 'tenant_custom_workflow' })).toBe(true)
  })
})

// ── ensureTenantRunner ───────────────────────────────────────────────────

describe('ensureTenantRunner', () => {
  it('no-ops cleanly when TENANT_RUNNER_* config is absent (dev/test envs)', async () => {
    const ecs = fakeEcs({})
    const result = await ensureTenantRunner(db, TENANT_ID, {
      ecsClient: ecs.client,
      config: null,
    })

    expect(result).toEqual({ outcome: 'SKIPPED_UNCONFIGURED' })
    expect(ecs.send).not.toHaveBeenCalled()
    expect(mockGetOrCreateCredential).not.toHaveBeenCalled()
  })

  it('refuses a non-UUID tenant id (startedBy is capped at 36 chars)', async () => {
    const ecs = fakeEcs({})
    const result = await ensureTenantRunner(db, 'Tenant-1', {
      ecsClient: ecs.client,
      config,
    })

    expect(result).toEqual({ outcome: 'LAUNCH_FAILED', reason: 'INVALID_TENANT_ID' })
    expect(ecs.send).not.toHaveBeenCalled()
    expect(emittedMetricNames()).toContain('TenantRunnerLaunchFailed')
  })

  it('returns ALREADY_RUNNING without RunTask or token recovery when a task exists', async () => {
    const ecs = fakeEcs({ listTasks: () => ({ taskArns: ['arn:task/existing'] }) })
    const result = await ensureTenantRunner(db, TENANT_ID, {
      ecsClient: ecs.client,
      config,
    })

    expect(result).toEqual({ outcome: 'ALREADY_RUNNING', taskArns: ['arn:task/existing'] })
    expect(ecs.calls.listTasks).toEqual([
      // startedBy = the tenant id, default desiredStatus (RUNNING) covers
      // PROVISIONING/PENDING tasks too.
      { cluster: config.clusterArn, startedBy: TENANT_ID },
    ])
    expect(ecs.calls.runTask).toHaveLength(0)
    // The wbk_ plaintext must not be KMS-recovered when it is not needed.
    expect(mockGetOrCreateCredential).not.toHaveBeenCalled()
  })

  it('launches with the full RunTask contract when no runner exists', async () => {
    const ecs = fakeEcs({})
    const result = await ensureTenantRunner(db, TENANT_ID, {
      ecsClient: ecs.client,
      config,
    })

    expect(result).toEqual({ outcome: 'LAUNCHED', taskArn: 'arn:task/launched' })
    // KMS recovery of the per-tenant wbk_ token via the Unit-7 lib.
    expect(mockGetOrCreateCredential).toHaveBeenCalledWith(db, TENANT_ID)
    expect(ecs.calls.runTask).toEqual([
      {
        cluster: config.clusterArn,
        // Bare family name — RunTask resolves the latest ACTIVE revision.
        taskDefinition: 'pegasus-tenant-runner-staging',
        launchType: 'FARGATE',
        count: 1,
        startedBy: TENANT_ID,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: ['subnet-aaa', 'subnet-bbb'],
            securityGroups: ['sg-ccc'],
            assignPublicIp: 'DISABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: 'tenant-runner',
              environment: [
                { name: 'TENANT_ID', value: TENANT_ID },
                { name: 'WORKFLOW_BROKER_TOKEN', value: BROKER_TOKEN },
              ],
            },
          ],
        },
      },
    ])
    expect(emittedMetricNames()).toContain('TenantRunnerLaunched')
  })

  it('treats a RunTask failures[] entry as LAUNCH_FAILED (200-with-failures shape)', async () => {
    const ecs = fakeEcs({
      runTask: () => ({
        tasks: [],
        failures: [{ reason: 'RESOURCE:FARGATE', detail: 'capacity unavailable' }],
      }),
    })
    const result = await ensureTenantRunner(db, TENANT_ID, {
      ecsClient: ecs.client,
      config,
    })

    expect(result).toEqual({ outcome: 'LAUNCH_FAILED', reason: 'RESOURCE:FARGATE' })
    expect(emittedMetricNames()).toContain('TenantRunnerLaunchFailed')
  })

  it('soft-fails (never throws) when the ECS SDK throws', async () => {
    const ecs = fakeEcs({
      listTasks: () => {
        throw new Error('ecs down')
      },
    })
    const result = await ensureTenantRunner(db, TENANT_ID, {
      ecsClient: ecs.client,
      config,
    })

    expect(result).toEqual({ outcome: 'LAUNCH_FAILED', reason: 'ecs down' })
    expect(emittedMetricNames()).toContain('TenantRunnerLaunchFailed')
  })

  it('soft-fails when broker-token recovery (DB/KMS) throws, without calling RunTask', async () => {
    mockGetOrCreateCredential.mockRejectedValue(new Error('kms unavailable'))
    const ecs = fakeEcs({})
    const result = await ensureTenantRunner(db, TENANT_ID, {
      ecsClient: ecs.client,
      config,
    })

    expect(result).toEqual({ outcome: 'LAUNCH_FAILED', reason: 'kms unavailable' })
    expect(ecs.calls.runTask).toHaveLength(0)
  })

  it('documents the accepted race: two concurrent ensures can both launch', async () => {
    // Both callers observe "no runner" before either RunTask lands. The
    // duplicate is deliberate v1 posture: both poll the same queue and the
    // idle-exit watchdog reaps the extra task. This test pins the behaviour
    // so a future "fix" is a conscious contract change.
    const ecs = fakeEcs({ listTasks: () => ({ taskArns: [] }) })
    const [a, b] = await Promise.all([
      ensureTenantRunner(db, TENANT_ID, { ecsClient: ecs.client, config }),
      ensureTenantRunner(db, TENANT_ID, { ecsClient: ecs.client, config }),
    ])

    expect(a.outcome).toBe('LAUNCHED')
    expect(b.outcome).toBe('LAUNCHED')
    expect(ecs.calls.runTask).toHaveLength(2)
  })
})

// ── sweepTenantRunners ───────────────────────────────────────────────────

describe('sweepTenantRunners', () => {
  function dbWithOpenExecutions(rows: Array<{ tenantId: string; workflow: { name: string } }>): {
    db: PrismaClient
    findMany: ReturnType<typeof vi.fn>
  } {
    const findMany = vi.fn().mockResolvedValue(rows)
    return { db: { workflowExecution: { findMany } } as unknown as PrismaClient, findMany }
  }

  it('no-ops (and never touches the DB) without config', async () => {
    const { db: sweepDb, findMany } = dbWithOpenExecutions([])
    const result = await sweepTenantRunners(sweepDb, { config: null })

    expect(result).toEqual({ tenantsNeedingRunner: 0, launched: 0, launchFailed: 0 })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('ensures one runner per unique tenant with non-curated open work', async () => {
    const { db: sweepDb, findMany } = dbWithOpenExecutions([
      // Curated rows never need a runner — filtered out.
      { tenantId: TENANT_ID, workflow: { name: 'send_quote_followup' } },
      // Two open executions for the same tenant — deduped to one ensure.
      { tenantId: TENANT_ID, workflow: { name: 'tenant_custom_workflow' } },
      { tenantId: TENANT_ID, workflow: { name: 'another_tenant_workflow' } },
      { tenantId: OTHER_TENANT_ID, workflow: { name: 'tenant_custom_workflow' } },
    ])
    const ecs = fakeEcs({})

    const result = await sweepTenantRunners(sweepDb, { ecsClient: ecs.client, config })

    expect(findMany).toHaveBeenCalledWith({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      select: { tenantId: true, workflow: { select: { name: true } } },
    })
    expect(result).toEqual({ tenantsNeedingRunner: 2, launched: 2, launchFailed: 0 })
    expect(ecs.calls.runTask.map((c) => c.startedBy)).toEqual([TENANT_ID, OTHER_TENANT_ID])
    // The pool gauge is published as part of the sweep.
    expect(emittedMetricNames()).toContain('TenantRunnersRunning')
  })

  it('isolates per-tenant failures — one broken launch never skips the next tenant', async () => {
    const { db: sweepDb } = dbWithOpenExecutions([
      { tenantId: TENANT_ID, workflow: { name: 'tenant_custom_workflow' } },
      { tenantId: OTHER_TENANT_ID, workflow: { name: 'tenant_custom_workflow' } },
    ])
    let listCalls = 0
    const ecs = fakeEcs({
      listTasks: (input) => {
        listCalls += 1
        // First tenant's dedupe lookup explodes; everything after succeeds
        // (including the family-scoped pool-metrics ListTasks at the end).
        if (listCalls === 1 && input.startedBy === TENANT_ID) throw new Error('ecs down')
        return { taskArns: [] }
      },
    })

    const result = await sweepTenantRunners(sweepDb, { ecsClient: ecs.client, config })

    expect(result).toEqual({ tenantsNeedingRunner: 2, launched: 1, launchFailed: 1 })
    expect(ecs.calls.runTask.map((c) => c.startedBy)).toEqual([OTHER_TENANT_ID])
  })

  it('finds nothing to do today (curated-only open work) — the inert posture', async () => {
    const { db: sweepDb } = dbWithOpenExecutions([
      { tenantId: TENANT_ID, workflow: { name: 'send_quote_followup' } },
    ])
    const ecs = fakeEcs({})

    const result = await sweepTenantRunners(sweepDb, { ecsClient: ecs.client, config })

    expect(result).toEqual({ tenantsNeedingRunner: 0, launched: 0, launchFailed: 0 })
    expect(ecs.calls.runTask).toHaveLength(0)
  })
})

// ── publishTenantRunnerPoolMetrics ───────────────────────────────────────

describe('publishTenantRunnerPoolMetrics', () => {
  const now = new Date('2026-06-12T12:00:00Z')

  it('publishes TenantRunnersRunning even when zero tasks exist', async () => {
    const ecs = fakeEcs({ listTasks: () => ({ taskArns: [] }) })
    await publishTenantRunnerPoolMetrics({ ecsClient: ecs.client, config, now: () => now })

    // Family-scoped listing (the cluster is shared with the stdlib worker).
    expect(ecs.calls.listTasks).toEqual([
      { cluster: config.clusterArn, family: config.taskDefinition },
    ])
    const gauge = putMetricDataInputs
      .flatMap((p) => p.MetricData ?? [])
      .find((m) => m.MetricName === 'TenantRunnersRunning')
    expect(gauge).toMatchObject({ Value: 0, Unit: 'Count' })
  })

  it('counts only RUNNING tasks and emits cold-start latency inside the window', async () => {
    const ecs = fakeEcs({
      listTasks: () => ({ taskArns: ['arn:1', 'arn:2', 'arn:3'] }),
      describeTasks: () => ({
        tasks: [
          {
            // Fresh runner: reached RUNNING 30 s ago after a 45 s cold start.
            lastStatus: 'RUNNING',
            createdAt: new Date(now.getTime() - 75_000),
            startedAt: new Date(now.getTime() - 30_000),
          },
          {
            // Old runner: RUNNING since well outside the 90 s window — its
            // cold start was already reported on an earlier tick.
            lastStatus: 'RUNNING',
            createdAt: new Date(now.getTime() - 600_000),
            startedAt: new Date(now.getTime() - 540_000),
          },
          // Still provisioning — not RUNNING yet, no gauge, no cold start.
          { lastStatus: 'PENDING', createdAt: new Date(now.getTime() - 5_000) },
        ],
      }),
    })

    await publishTenantRunnerPoolMetrics({ ecsClient: ecs.client, config, now: () => now })

    const metricData = putMetricDataInputs.flatMap((p) => p.MetricData ?? [])
    expect(metricData.find((m) => m.MetricName === 'TenantRunnersRunning')).toMatchObject({
      Value: 2,
    })
    const coldStarts = metricData.filter((m) => m.MetricName === 'TenantRunnerColdStartSeconds')
    expect(coldStarts).toHaveLength(1)
    expect(coldStarts[0]).toMatchObject({ Value: 45, Unit: 'Seconds' })
  })

  it('swallows ECS errors — pool metrics never break a dispatcher tick', async () => {
    const ecs = fakeEcs({
      listTasks: () => {
        throw new Error('ecs down')
      },
    })
    await expect(
      publishTenantRunnerPoolMetrics({ ecsClient: ecs.client, config }),
    ).resolves.toBeUndefined()
  })
})
