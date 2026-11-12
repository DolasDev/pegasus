/**
 * Integration tests for /api/v1/automation-steps (a durable Workflow running
 * an Automation as a step).
 *
 * The real router, the real startWorkflowExecution and real Cedar RBAC run
 * against Postgres through `createTenantDb`; only the outside world is mocked
 * (Temporal, the runner launcher, CloudWatch). The caller scoping (WORKFLOW
 * caller, open parent, own steps) lives in the handler where Cedar can't see
 * it, so these tests are its gate — authz-smoke runs only after merge.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

const { mockTemporalStart, mockTemporalCancel } = vi.hoisted(() => ({
  mockTemporalStart: vi.fn(),
  mockTemporalCancel: vi.fn(),
}))

vi.mock('../lib/temporal-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withTemporalClient: vi.fn(async (_target: unknown, fn: (client: unknown) => unknown) =>
    fn({
      workflow: {
        start: mockTemporalStart,
        getHandle: () => ({ cancel: mockTemporalCancel }),
      },
    }),
  ),
}))

vi.mock('../lib/tenant-runner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureTenantRunner: vi.fn(),
}))

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = vi.fn()
  },
  PutMetricDataCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { automationStepsHandler } from './automation-steps'
import { dualAuthMiddleware } from '../middleware/dual-auth'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG = 'test-automation-steps'
const SLUG_OTHER = 'test-automation-steps-other'

let tenant: { id: string }
let otherTenant: { id: string }

/** An app acting as the runtime token `apiClientId` (or a human with no
 * apiClient) holding `roleNames` in `tenantId`. */
function appAs(
  tenantId: string,
  apiClientId: string | undefined,
  roleNames: readonly string[] = ['workflow_runtime'],
) {
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('userId', 'svc-user')
    c.set('principal', { sub: 'svc-user', tenantId, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient)
    if (apiClientId) c.set('apiClient', { id: apiClientId } as AppEnv['Variables']['apiClient'])
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/', automationStepsHandler)
  return app
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function seedWorkflow(
  tenantId: string,
  name: string,
  version: string,
  kind: 'AUTOMATION' | 'WORKFLOW',
  extra: { status?: 'ACTIVE' | 'RETIRED'; createdAt?: Date } = {},
) {
  return db.workflow.create({
    data: {
      tenantId,
      name,
      version,
      kind,
      artifactKey: `workflows/${tenantId}/${name}/${version}.zip`,
      manifest: { name, version, entryPoints: ['main:W'] },
      createdByUserId: 'creator-1',
      executable: true,
      artifactSha256: `${name}-${version}`.padEnd(64, '0'),
      runtimeApiClientId: `client-${name}-${version}`,
      runtimeTokenCiphertext: 'ciphertext',
      ...(extra.status ? { status: extra.status } : {}),
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
    },
  })
}

const PARENT_TEMPORAL_ID = 'wfl/t/order_lifecycle/o-1'

async function seedOpenParent(
  tenantId: string,
  workflowId: string,
  temporalWorkflowId = PARENT_TEMPORAL_ID,
) {
  return db.workflowExecution.create({
    data: {
      tenantId,
      workflowId,
      status: 'RUNNING',
      input: {},
      temporalWorkflowId,
      temporalRunId: 'run-1',
      queuedAt: new Date(),
      startedAt: new Date(),
    },
  })
}

function stepBody(overrides: Record<string, unknown> = {}) {
  return {
    automation: 'step_echo',
    input: { orderId: 'o-1' },
    parentTemporalWorkflowId: PARENT_TEMPORAL_ID,
    parentTemporalRunId: 'run-1',
    activityId: '3',
    ...overrides,
  }
}

type Execution = {
  id: string
  status: string
  workflowName: string
  workflowVersion: string
  triggerSource: string
  parentExecutionId: string | null
  input: unknown
  result: unknown
}

async function data(res: Response): Promise<Execution> {
  return ((await res.json()) as { data: Execution }).data
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code
}

async function wipe(ids: string[]) {
  await db.workflowExecution.deleteMany({ where: { tenantId: { in: ids } } })
  await db.workflow.deleteMany({ where: { tenantId: { in: ids } } })
  await db.tenantTemporalNamespace.deleteMany({ where: { tenantId: { in: ids } } })
}

afterAll(async () => {
  if (hasDb) {
    await wipe([tenant?.id, otherTenant?.id].filter(Boolean)).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('/automation-steps (integration)', () => {
  let lifecycle: Awaited<ReturnType<typeof seedWorkflow>>
  let parent: Awaited<ReturnType<typeof seedOpenParent>>
  let workflowApp: Hono<AppEnv>

  beforeAll(async () => {
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenant = await upsert(SLUG)
    otherTenant = await upsert(SLUG_OTHER)
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    _clearAuthzCache()
    mockTemporalStart.mockImplementation(async (_type: string, opts: { workflowId: string }) => ({
      workflowId: opts.workflowId,
      firstExecutionRunId: 'step-run-1',
    }))
    await wipe([tenant.id, otherTenant.id])
    await db.tenant.update({ where: { id: tenant.id }, data: { workflowsDisabled: false } })
    lifecycle = await seedWorkflow(tenant.id, 'order_lifecycle', '1.0.0', 'WORKFLOW')
    parent = await seedOpenParent(tenant.id, lifecycle.id)
    await seedWorkflow(tenant.id, 'step_echo', '0.1.0', 'AUTOMATION')
    workflowApp = appAs(tenant.id, lifecycle.runtimeApiClientId!)
  })

  describe('POST / (start)', () => {
    it('starts the Automation as a WORKFLOW-source step of the open parent', async () => {
      const res = await workflowApp.request('/', post(stepBody()))
      expect(res.status).toBe(201)
      const step = await data(res)
      expect(step).toMatchObject({
        status: 'RUNNING',
        workflowName: 'step_echo',
        workflowVersion: '0.1.0',
        triggerSource: 'WORKFLOW',
        parentExecutionId: parent.id,
        input: { orderId: 'o-1' },
      })
      const row = await db.workflowExecution.findUnique({ where: { id: step.id } })
      expect(row?.stepKey).toBe(`${PARENT_TEMPORAL_ID}/run-1/3`)
      expect(row?.triggeredByUserId).toBeNull()
      expect(mockTemporalStart).toHaveBeenCalledTimes(1)
    })

    it('replays the same activity to the SAME row without starting again', async () => {
      const first = await data(await workflowApp.request('/', post(stepBody())))
      const res = await workflowApp.request('/', post(stepBody()))
      expect(res.status).toBe(200)
      expect((await data(res)).id).toBe(first.id)
      expect(mockTemporalStart).toHaveBeenCalledTimes(1)
    })

    it('a different activity id is a different step', async () => {
      const first = await data(await workflowApp.request('/', post(stepBody())))
      const res = await workflowApp.request('/', post(stepBody({ activityId: '4' })))
      expect(res.status).toBe(201)
      expect((await data(res)).id).not.toBe(first.id)
    })

    it('a bare name resolves to the newest ACTIVE version by semver', async () => {
      await seedWorkflow(tenant.id, 'step_echo', '0.10.0', 'AUTOMATION')
      await seedWorkflow(tenant.id, 'step_echo', '0.9.0', 'AUTOMATION')
      await seedWorkflow(tenant.id, 'step_echo', '0.11.0', 'AUTOMATION', { status: 'RETIRED' })
      const step = await data(await workflowApp.request('/', post(stepBody())))
      expect(step.workflowVersion).toBe('0.10.0')
    })

    it('version= pins exactly', async () => {
      await seedWorkflow(tenant.id, 'step_echo', '0.2.0', 'AUTOMATION')
      const step = await data(await workflowApp.request('/', post(stepBody({ version: '0.1.0' }))))
      expect(step.workflowVersion).toBe('0.1.0')
    })

    it('404 AUTOMATION_NOT_FOUND for an unknown name, a retired or unknown version', async () => {
      await seedWorkflow(tenant.id, 'step_old', '1.0.0', 'AUTOMATION', { status: 'RETIRED' })
      for (const body of [
        stepBody({ automation: 'nope' }),
        stepBody({ automation: 'step_old' }),
        stepBody({ version: '9.9.9' }),
      ]) {
        const res = await workflowApp.request('/', post(body))
        expect(res.status).toBe(404)
        expect(await code(res)).toBe('AUTOMATION_NOT_FOUND')
      }
      expect(mockTemporalStart).not.toHaveBeenCalled()
    })

    it('422 STEP_TARGET_NOT_AUTOMATION when the name is a durable Workflow', async () => {
      const res = await workflowApp.request('/', post(stepBody({ automation: 'order_lifecycle' })))
      expect(res.status).toBe(422)
      expect(await code(res)).toBe('STEP_TARGET_NOT_AUTOMATION')
    })

    it('an own durable Workflow does not hide a GLOBAL Automation of the same name', async () => {
      await seedWorkflow(tenant.id, 'shared_name', '1.0.0', 'WORKFLOW')
      const global = await seedWorkflow(otherTenant.id, 'shared_name', '2.0.0', 'AUTOMATION')
      await db.workflow.update({ where: { id: global.id }, data: { visibility: 'GLOBAL' } })
      const res = await workflowApp.request('/', post(stepBody({ automation: 'shared_name' })))
      // Resolved to the GLOBAL Automation, which (not curated) must be forked
      // first — the same rule as POST /workflows/:id/run.
      expect(res.status).toBe(403)
      expect(await code(res)).toBe('WORKFLOW_MUST_FORK')
    })

    it("does not resolve another tenant's Automation", async () => {
      await seedWorkflow(otherTenant.id, 'their_step', '1.0.0', 'AUTOMATION')
      const res = await workflowApp.request('/', post(stepBody({ automation: 'their_step' })))
      expect(res.status).toBe(404)
    })

    it("403 STEP_CALLER_NOT_WORKFLOW for an Automation's runtime token", async () => {
      const res = await appAs(tenant.id, 'client-step_echo-0.1.0').request('/', post(stepBody()))
      expect(res.status).toBe(403)
      expect(await code(res)).toBe('STEP_CALLER_NOT_WORKFLOW')
      expect(mockTemporalStart).not.toHaveBeenCalled()
    })

    it('403 for a caller with no runtime token (a human)', async () => {
      const res = await appAs(tenant.id, undefined, ['tenant_admin']).request('/', post(stepBody()))
      expect(res.status).toBe(403)
      expect(await code(res)).toBe('STEP_CALLER_NOT_WORKFLOW')
    })

    it("403 for a WORKFLOW token presented in another tenant (the row is the other tenant's)", async () => {
      const res = await appAs(otherTenant.id, lifecycle.runtimeApiClientId!).request(
        '/',
        post(stepBody()),
      )
      expect(res.status).toBe(403)
    })

    it('403 from Cedar for a persona without RunAutomationStep', async () => {
      const res = await appAs(tenant.id, lifecycle.runtimeApiClientId!, ['viewer']).request(
        '/',
        post(stepBody()),
      )
      expect(res.status).toBe(403)
      expect(mockTemporalStart).not.toHaveBeenCalled()
    })

    it("404 PARENT_NOT_OPEN for a closed parent, or another Workflow's instance", async () => {
      await db.workflowExecution.update({ where: { id: parent.id }, data: { status: 'COMPLETED' } })
      let res = await workflowApp.request('/', post(stepBody()))
      expect(res.status).toBe(404)
      expect(await code(res)).toBe('PARENT_NOT_OPEN')

      const other = await seedWorkflow(tenant.id, 'other_lifecycle', '1.0.0', 'WORKFLOW')
      await seedOpenParent(tenant.id, other.id, 'wfl/t/other_lifecycle/o-1')
      res = await workflowApp.request(
        '/',
        post(stepBody({ parentTemporalWorkflowId: 'wfl/t/other_lifecycle/o-1' })),
      )
      expect(res.status).toBe(404)
      expect(await code(res)).toBe('PARENT_NOT_OPEN')
    })

    it('423 WORKFLOWS_DISABLED under the kill switch (the SDK retries it)', async () => {
      await db.tenant.update({ where: { id: tenant.id }, data: { workflowsDisabled: true } })
      const res = await workflowApp.request('/', post(stepBody()))
      expect(res.status).toBe(423)
      expect(await code(res)).toBe('WORKFLOWS_DISABLED')
      expect(await db.workflowExecution.count({ where: { stepKey: { not: null } } })).toBe(0)
    })

    it('429 CONCURRENCY_LIMIT when the tenant is at the Automation cap', async () => {
      const automation = await db.workflow.findFirstOrThrow({ where: { name: 'step_echo' } })
      for (let i = 0; i < 5; i++) {
        await db.workflowExecution.create({
          data: {
            tenantId: tenant.id,
            workflowId: automation.id,
            status: 'RUNNING',
            input: {},
            queuedAt: new Date(),
          },
        })
      }
      const res = await workflowApp.request('/', post(stepBody()))
      expect(res.status).toBe(429)
      expect(await code(res)).toBe('CONCURRENCY_LIMIT')
    })

    it('a failed Temporal start frees the step key, so the retry starts afresh', async () => {
      mockTemporalStart.mockRejectedValueOnce(new Error('unavailable'))
      const res = await workflowApp.request('/', post(stepBody()))
      expect(res.status).toBe(502)
      const failed = await db.workflowExecution.findFirstOrThrow({ where: { status: 'FAILED' } })
      expect(failed.stepKey).toBeNull()
      expect(failed.parentExecutionId).toBe(parent.id)

      const retry = await workflowApp.request('/', post(stepBody()))
      expect(retry.status).toBe(201)
      expect((await data(retry)).id).not.toBe(failed.id)
    })

    it('400 on a malformed body', async () => {
      const res = await workflowApp.request('/', post({ automation: 'Bad Name' }))
      expect(res.status).toBe(400)
    })
  })

  describe('GET /:executionId and POST /:executionId/cancel', () => {
    it("returns the caller's own step with its result", async () => {
      const step = await data(await workflowApp.request('/', post(stepBody())))
      await db.workflowExecution.update({
        where: { id: step.id },
        data: { status: 'COMPLETED', result: { echoed: 'o-1' }, finishedAt: new Date() },
      })
      const res = await workflowApp.request(`/${step.id}`)
      expect(res.status).toBe(200)
      expect(await data(res)).toMatchObject({ status: 'COMPLETED', result: { echoed: 'o-1' } })
    })

    it("404 for another Workflow's step, and for a non-step execution", async () => {
      const step = await data(await workflowApp.request('/', post(stepBody())))
      const other = await seedWorkflow(tenant.id, 'other_lifecycle', '1.0.0', 'WORKFLOW')
      const otherApp = appAs(tenant.id, other.runtimeApiClientId!)
      expect((await otherApp.request(`/${step.id}`)).status).toBe(404)
      expect((await otherApp.request(`/${step.id}/cancel`, { method: 'POST' })).status).toBe(404)
      expect((await workflowApp.request(`/${parent.id}`)).status).toBe(404)
    })

    it('cancels a running step on Temporal (202)', async () => {
      const step = await data(await workflowApp.request('/', post(stepBody())))
      const res = await workflowApp.request(`/${step.id}/cancel`, { method: 'POST' })
      expect(res.status).toBe(202)
      expect(mockTemporalCancel).toHaveBeenCalledTimes(1)
    })

    it('409 EXECUTION_NOT_CANCELLABLE for a finished step', async () => {
      const step = await data(await workflowApp.request('/', post(stepBody())))
      await db.workflowExecution.update({ where: { id: step.id }, data: { status: 'FAILED' } })
      const res = await workflowApp.request(`/${step.id}/cancel`, { method: 'POST' })
      expect(res.status).toBe(409)
    })
  })
})
