// ---------------------------------------------------------------------------
// Unit tests for admin workflows handler
//
// db is mocked via vi.hoisted so the same mock functions are shared across
// the vi.mock factory and test bodies.
//
// Phase 3 Unit 11 additions:
//   - GET /runner-status — tests for configPresent flag, runners list, and
//     per-tenant quota stats. ECSClient and loadTenantRunnerConfig are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'

const { mockDb, mockEcsSend, mockLoadConfig } = vi.hoisted(() => ({
  mockDb: {
    workflow: {
      findMany: vi.fn(),
    },
    workflowExecution: {
      findMany: vi.fn(),
    },
  },
  mockEcsSend: vi.fn(),
  mockLoadConfig: vi.fn(),
}))

vi.mock('../../db', () => ({ db: mockDb }))

vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: class {
    send = mockEcsSend
  },
  ListTasksCommand: class {
    constructor(public input: unknown) {}
  },
  DescribeTasksCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../../lib/tenant-runner', () => ({
  loadTenantRunnerConfig: mockLoadConfig,
}))

import { adminWorkflowsRouter } from './workflows'

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub-123')
    c.set('adminEmail', 'admin@platform.com')
    await next()
  })
  app.route('/workflows', adminWorkflowsRouter)
  return app
}

const now = new Date('2026-05-14T12:00:00Z')

const mockRow = {
  id: 'wf-1',
  tenantId: 'platform-tenant-id',
  name: 'send_quote_followup',
  version: '1.0.0',
  visibility: 'GLOBAL' as const,
  manifest: {
    name: 'send_quote_followup',
    version: '1.0.0',
    entryPoints: ['workflows.send_quote_followup:SendQuoteFollowup'],
  },
  createdByUserId: 'user-1',
  createdAt: now,
  updatedAt: now,
  tenant: { id: 'platform-tenant-id', name: 'Pegasus Platform', slug: 'platform' },
}

// A canonical lowercase UUID — the format used by ensureTenantRunner for startedBy.
const TENANT_UUID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff'

const runnerConfig = {
  clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/pegasus-runner',
  taskDefinition: 'pegasus-tenant-runner',
  subnets: ['subnet-1'],
  securityGroups: ['sg-1'],
  taskRoleArn: 'arn:aws:iam::123:role/tenant-runner',
  executionRoleArn: 'arn:aws:iam::123:role/tenant-runner-exec',
  containerName: 'tenant-runner',
  brokerCredsSecretArn: null,
}

describe('admin workflows handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: runner plane not configured (dev)
    mockLoadConfig.mockReturnValue(null)
    // Default: no active or today executions
    mockDb.workflowExecution.findMany.mockResolvedValue([])
  })

  describe('GET /', () => {
    it('returns 200 with every GLOBAL workflow + owning tenant info', async () => {
      mockDb.workflow.findMany.mockResolvedValue([mockRow])
      const res = await buildApp().request('/workflows')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(1)
      expect(data[0]!['tenantName']).toBe('Pegasus Platform')
      expect(data[0]!['tenantSlug']).toBe('platform')
      expect(data[0]!['visibility']).toBe('GLOBAL')
      // Joined `tenant` object is flattened to tenantName/tenantSlug and not leaked verbatim.
      expect('tenant' in data[0]!).toBe(false)
      expect((body.meta as JsonBody)['count']).toBe(1)
    })

    it('filters server-side to visibility=GLOBAL only', async () => {
      mockDb.workflow.findMany.mockResolvedValue([])
      await buildApp().request('/workflows')
      expect(mockDb.workflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { visibility: 'GLOBAL' } }),
      )
    })

    it('returns 200 with empty list when nothing is GLOBAL', async () => {
      mockDb.workflow.findMany.mockResolvedValue([])
      const res = await buildApp().request('/workflows')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody[]).length).toBe(0)
      expect((body.meta as JsonBody)['count']).toBe(0)
    })

    it('returns 500 INTERNAL_ERROR on DB failure', async () => {
      mockDb.workflow.findMany.mockRejectedValue(new Error('db down'))
      const res = await buildApp().request('/workflows')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── GET /runner-status (Phase 3 Unit 11) ────────────────────────────────

  describe('GET /runner-status', () => {
    it('returns configPresent=false and empty arrays when runner plane not configured', async () => {
      mockLoadConfig.mockReturnValue(null)

      const res = await buildApp().request('/workflows/runner-status')
      expect(res.status).toBe(200)
      const body = (await json(res)).data as JsonBody
      expect(body['configPresent']).toBe(false)
      expect(body['runners']).toEqual([])
      expect(body['tenantQuotas']).toEqual([])
    })

    it('returns configPresent=true with runners from ECS when configured', async () => {
      mockLoadConfig.mockReturnValue(runnerConfig)
      // ListTasks returns one task ARN
      mockEcsSend
        .mockResolvedValueOnce({ taskArns: ['arn:aws:ecs:us-east-1:123:task/runner/abc123'] })
        // DescribeTasks returns one task with UUID startedBy (= tenantId)
        .mockResolvedValueOnce({
          tasks: [
            {
              taskArn: 'arn:aws:ecs:us-east-1:123:task/runner/abc123',
              startedBy: TENANT_UUID,
              lastStatus: 'RUNNING',
              startedAt: now,
            },
          ],
        })

      const res = await buildApp().request('/workflows/runner-status')
      expect(res.status).toBe(200)
      const body = (await json(res)).data as JsonBody
      expect(body['configPresent']).toBe(true)
      const runners = body['runners'] as JsonBody[]
      expect(runners.length).toBe(1)
      expect(runners[0]!['tenantId']).toBe(TENANT_UUID)
      expect(runners[0]!['lastStatus']).toBe('RUNNING')
      expect(runners[0]!['startedAt']).toBe(now.toISOString())
    })

    it('sets tenantId=null for non-UUID startedBy tasks (stdlib worker identification)', async () => {
      mockLoadConfig.mockReturnValue(runnerConfig)
      mockEcsSend
        .mockResolvedValueOnce({
          taskArns: [
            'arn:aws:ecs:us-east-1:123:task/runner/runner1',
            'arn:aws:ecs:us-east-1:123:task/runner/stdlib1',
          ],
        })
        .mockResolvedValueOnce({
          tasks: [
            {
              taskArn: 'arn:aws:ecs:us-east-1:123:task/runner/runner1',
              startedBy: TENANT_UUID, // valid UUID → tenantId = UUID
              lastStatus: 'RUNNING',
              startedAt: now,
            },
            {
              taskArn: 'arn:aws:ecs:us-east-1:123:task/runner/stdlib1',
              startedBy: 'events.amazonaws.com', // non-UUID → tenantId = null
              lastStatus: 'RUNNING',
              startedAt: now,
            },
          ],
        })

      const res = await buildApp().request('/workflows/runner-status')
      const body = (await json(res)).data as JsonBody
      const runners = body['runners'] as JsonBody[]
      // Both tasks appear; only the non-UUID one has tenantId=null.
      expect(runners.length).toBe(2)
      const uuidRunner = runners.find((r) => r['tenantId'] === TENANT_UUID)
      const nonUuidRunner = runners.find((r) => r['tenantId'] === null)
      expect(uuidRunner).toBeDefined()
      expect(nonUuidRunner).toBeDefined()
    })

    it('returns tenantQuotas for tenants with TENANT_RUNNER-lane executions today', async () => {
      mockLoadConfig.mockReturnValue(null) // no ECS calls in dev
      // Two active executions for tenant-1
      mockDb.workflowExecution.findMany
        .mockResolvedValueOnce([{ tenantId: 'tenant-1' }, { tenantId: 'tenant-1' }]) // active
        .mockResolvedValueOnce([{ tenantId: 'tenant-1' }, { tenantId: 'tenant-1' }]) // today

      const res = await buildApp().request('/workflows/runner-status')
      const body = (await json(res)).data as JsonBody
      const quotas = body['tenantQuotas'] as JsonBody[]
      expect(quotas.length).toBe(1)
      expect(quotas[0]!['tenantId']).toBe('tenant-1')
      expect(quotas[0]!['concurrentCount']).toBe(2)
      expect(quotas[0]!['todayCount']).toBe(2)
    })

    it('returns 200 with empty runners when ECS is unreachable (graceful degradation)', async () => {
      mockLoadConfig.mockReturnValue(runnerConfig)
      // ListTasks throws (ECS unavailable)
      mockEcsSend.mockRejectedValue(new Error('ECS down'))

      const res = await buildApp().request('/workflows/runner-status')
      expect(res.status).toBe(200)
      const body = (await json(res)).data as JsonBody
      expect(body['configPresent']).toBe(true)
      // runners is empty — ECS failure is soft-swallowed
      expect(body['runners']).toEqual([])
    })
  })
})
