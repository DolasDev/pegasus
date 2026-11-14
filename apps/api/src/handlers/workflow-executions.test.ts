/**
 * Integration tests for /api/v1/workflow-executions (executions by id alone:
 * list open Workflows, query, cancel, terminate).
 *
 * The real router and real Cedar RBAC run against Postgres through
 * `createTenantDb`; only Temporal and the runner launcher are mocked. Tenant
 * scoping is in the handler where Cedar can't see it, and authz-smoke runs
 * only after merge, so these tests are its gate.
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

const { mockGetHandle, mockCancel, mockTerminate, mockQuery, mockWithDeadline } = vi.hoisted(() => {
  const cancel = vi.fn()
  const terminate = vi.fn()
  const query = vi.fn()
  return {
    mockCancel: cancel,
    mockTerminate: terminate,
    mockQuery: query,
    mockGetHandle: vi.fn(() => ({ cancel, terminate, query })),
    mockWithDeadline: vi.fn(async (_deadline: number, fn: () => Promise<unknown>) => fn()),
  }
})

vi.mock('../lib/temporal-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withTemporalClient: vi.fn(async (_target: unknown, fn: (client: unknown) => unknown) =>
    fn({ workflow: { getHandle: mockGetHandle }, connection: { withDeadline: mockWithDeadline } }),
  ),
}))

vi.mock('../lib/tenant-runner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureTenantRunner: vi.fn(async () => ({ outcome: 'ALREADY_RUNNING' })),
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { workflowExecutionsHandler, QUERY_RETRY_AFTER_SECONDS } from './workflow-executions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { ensureTenantRunner } from '../lib/tenant-runner'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG = 'test-workflow-executions'
const SLUG_OTHER = 'test-workflow-executions-other'

let tenant: { id: string }
let otherTenant: { id: string }

function appAs(tenantId: string, roleNames: readonly string[] = ['workflow_developer']) {
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('userId', 'dev-user')
    c.set('principal', { sub: 'dev-user', tenantId, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient)
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/', workflowExecutionsHandler)
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
  manifestExtra: Record<string, unknown> = {},
) {
  return db.workflow.create({
    data: {
      tenantId,
      name,
      version,
      kind,
      artifactKey: `workflows/${tenantId}/${name}/${version}.zip`,
      manifest: { name, version, entryPoints: ['main:W'], ...manifestExtra },
      createdByUserId: 'creator-1',
      executable: true,
      artifactSha256: `${name}-${version}`.padEnd(64, '0'),
      runtimeApiClientId: `client-${name}-${version}`,
      runtimeTokenCiphertext: 'ciphertext',
    },
  })
}

async function seedExecution(
  tenantId: string,
  workflowId: string,
  extra: {
    status?: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
    temporalWorkflowId?: string | null
    parentExecutionId?: string
    queuedAt?: Date
  } = {},
) {
  return db.workflowExecution.create({
    data: {
      tenantId,
      workflowId,
      status: extra.status ?? 'RUNNING',
      input: {},
      temporalWorkflowId:
        extra.temporalWorkflowId === undefined
          ? `wf/${tenantId}/x/${Math.random()}`
          : extra.temporalWorkflowId,
      temporalRunId: extra.temporalWorkflowId === null ? null : 'first-run',
      queuedAt: extra.queuedAt ?? new Date(),
      startedAt: new Date(),
      ...(extra.parentExecutionId
        ? { parentExecutionId: extra.parentExecutionId, triggerSource: 'WORKFLOW' as const }
        : {}),
    },
  })
}

type Row = {
  id: string
  status: string
  kind: string | null
  correlationKey: string | null
  workflowName: string
  errorMessage: string | null
  signals?: string[]
  queries?: string[]
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

async function wipe(ids: string[]) {
  await db.workflowExecution.deleteMany({ where: { tenantId: { in: ids } } })
  await db.workflow.deleteMany({ where: { tenantId: { in: ids } } })
}

afterAll(async () => {
  if (hasDb) {
    await wipe([tenant?.id, otherTenant?.id].filter(Boolean)).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('/workflow-executions (integration)', () => {
  let lifecycleV1: Awaited<ReturnType<typeof seedWorkflow>>
  let lifecycleV2: Awaited<ReturnType<typeof seedWorkflow>>
  let automation: Awaited<ReturnType<typeof seedWorkflow>>

  beforeAll(async () => {
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenant = await upsert(SLUG)
    otherTenant = await upsert(SLUG_OTHER)
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    _clearAuthzCache()
    await wipe([tenant.id, otherTenant.id])
    await db.tenant.update({ where: { id: tenant.id }, data: { workflowsDisabled: false } })
    const durable = { kind: 'workflow', signals: ['order_event'], queries: ['status'] }
    lifecycleV1 = await seedWorkflow(tenant.id, 'order_lifecycle', '1.0.0', 'WORKFLOW', durable)
    lifecycleV2 = await seedWorkflow(tenant.id, 'order_lifecycle', '1.1.0', 'WORKFLOW', durable)
    automation = await seedWorkflow(tenant.id, 'step_echo', '0.1.0', 'AUTOMATION')
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('lists OPEN durable Workflows across every version, newest first, with the correlation key', async () => {
      const t0 = Date.now()
      const a = await seedExecution(tenant.id, lifecycleV1.id, {
        temporalWorkflowId: `wfl/${tenant.id}/order_lifecycle/o-1`,
        queuedAt: new Date(t0 - 2000),
      })
      const b = await seedExecution(tenant.id, lifecycleV2.id, {
        temporalWorkflowId: `wf/${tenant.id}/order_lifecycle/manual`,
        queuedAt: new Date(t0 - 1000),
      })
      await seedExecution(tenant.id, lifecycleV1.id, { status: 'COMPLETED' })
      await seedExecution(tenant.id, automation.id)
      await seedExecution(
        otherTenant.id,
        (await seedWorkflow(otherTenant.id, 'order_lifecycle', '1.0.0', 'WORKFLOW')).id,
      )

      const res = await appAs(tenant.id).request('/')
      expect(res.status).toBe(200)
      const rows = (await json(res)).data as Row[]
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id])
      expect(rows[0]).toMatchObject({ kind: 'WORKFLOW', correlationKey: null })
      expect(rows[1]).toMatchObject({ kind: 'WORKFLOW', correlationKey: 'o-1' })
    })

    it('a viewer can list (ReadWorkflow)', async () => {
      const res = await appAs(tenant.id, ['viewer']).request('/')
      expect(res.status).toBe(200)
    })

    it('filters by name + correlationKey to one keyed instance', async () => {
      const keyed = await seedExecution(tenant.id, lifecycleV1.id, {
        temporalWorkflowId: `wfl/${tenant.id}/order_lifecycle/o-7`,
      })
      await seedExecution(tenant.id, lifecycleV1.id, {
        temporalWorkflowId: `wfl/${tenant.id}/order_lifecycle/o-8`,
      })
      const res = await appAs(tenant.id).request('/?name=order_lifecycle&correlationKey=o-7')
      const rows = (await json(res)).data as Row[]
      expect(rows.map((r) => r.id)).toEqual([keyed.id])
    })

    it('400 when correlationKey comes without name', async () => {
      const res = await appAs(tenant.id).request('/?correlationKey=o-7')
      expect(res.status).toBe(400)
    })

    it('kind=AUTOMATION lists Automations, closed ones included by default', async () => {
      const done = await seedExecution(tenant.id, automation.id, { status: 'COMPLETED' })
      const res = await appAs(tenant.id).request('/?kind=AUTOMATION')
      const rows = (await json(res)).data as Row[]
      expect(rows.map((r) => r.id)).toEqual([done.id])
    })

    it('open=false includes closed Workflows', async () => {
      await seedExecution(tenant.id, lifecycleV1.id, { status: 'COMPLETED' })
      await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(tenant.id).request('/?open=false')
      expect(((await json(res)).data as Row[]).length).toBe(2)
    })

    it('pages with the before cursor', async () => {
      const t0 = Date.now()
      const older = await seedExecution(tenant.id, lifecycleV1.id, {
        queuedAt: new Date(t0 - 5000),
      })
      const newer = await seedExecution(tenant.id, lifecycleV1.id, { queuedAt: new Date(t0) })
      const app = appAs(tenant.id)
      const first = (await json(await app.request('/?limit=1'))).data as Row[]
      expect(first.map((r) => r.id)).toEqual([newer.id])
      const second = (await json(await app.request(`/?limit=1&before=${newer.id}`))).data as Row[]
      expect(second.map((r) => r.id)).toEqual([older.id])
    })
  })

  // ── GET /:executionId ─────────────────────────────────────────────────────

  describe('GET /:executionId', () => {
    it('returns the execution with its Workflow version’s declared signals and queries', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(tenant.id, ['viewer']).request(`/${exec.id}`)
      expect(res.status).toBe(200)
      expect((await json(res)).data).toMatchObject({
        id: exec.id,
        kind: 'WORKFLOW',
        workflowName: 'order_lifecycle',
        signals: ['order_event'],
        queries: ['status'],
      })
    })

    it('an Automation declares none', async () => {
      const exec = await seedExecution(tenant.id, automation.id)
      const res = await appAs(tenant.id).request(`/${exec.id}`)
      expect((await json(res)).data).toMatchObject({ kind: 'AUTOMATION', signals: [], queries: [] })
    })

    it('404 for another tenant’s execution', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(otherTenant.id).request(`/${exec.id}`)
      expect(res.status).toBe(404)
    })
  })

  // ── POST /:executionId/query ──────────────────────────────────────────────

  describe('POST /:executionId/query', () => {
    it('runs a declared query on the chain (firstExecutionRunId) and returns its result', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      mockQuery.mockResolvedValue({ stage: 'packing' })
      const res = await appAs(tenant.id).request(
        `/${exec.id}/query`,
        post({ name: 'status', args: [1] }),
      )
      expect(res.status).toBe(200)
      expect((await json(res)).data).toEqual({ result: { stage: 'packing' } })
      expect(mockGetHandle).toHaveBeenCalledWith(exec.temporalWorkflowId, undefined, {
        firstExecutionRunId: 'first-run',
      })
      expect(mockQuery).toHaveBeenCalledWith('status', 1)
      expect(mockWithDeadline).toHaveBeenCalledTimes(1)
      expect(ensureTenantRunner).toHaveBeenCalledWith(expect.anything(), tenant.id)
    })

    it('runs under the kill switch (a read)', async () => {
      await db.tenant.update({ where: { id: tenant.id }, data: { workflowsDisabled: true } })
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      mockQuery.mockResolvedValue('ok')
      const res = await appAs(tenant.id).request(`/${exec.id}/query`, post({ name: 'status' }))
      expect(res.status).toBe(200)
    })

    it('503 WORKFLOW_WORKER_STARTING + Retry-After when no worker answers', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const grpc = Object.assign(new Error('no poller seen for task queue recently'), {
        code: 9,
        details: 'no poller seen for task queue recently, worker may be down',
        metadata: {},
      })
      mockQuery.mockRejectedValue(
        Object.assign(new Error('Failed to query Workflow'), { name: 'ServiceError', cause: grpc }),
      )
      const res = await appAs(tenant.id).request(`/${exec.id}/query`, post({ name: 'status' }))
      expect(res.status).toBe(503)
      expect(res.headers.get('Retry-After')).toBe(String(QUERY_RETRY_AFTER_SECONDS))
      expect((await json(res)).code).toBe('WORKFLOW_WORKER_STARTING')
      expect(ensureTenantRunner).toHaveBeenCalled()
    })

    it('422 QUERY_FAILED when the query handler raised', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      mockQuery.mockRejectedValue(
        Object.assign(new Error('handler blew up'), { name: 'QueryNotRegisteredError' }),
      )
      const res = await appAs(tenant.id).request(`/${exec.id}/query`, post({ name: 'status' }))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('QUERY_FAILED')
      expect(String(body.error)).toContain('handler blew up')
    })

    it('422 QUERY_NOT_DECLARED for a name the version does not declare — Temporal untouched', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(tenant.id).request(`/${exec.id}/query`, post({ name: 'secrets' }))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('QUERY_NOT_DECLARED')
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('422 NOT_A_WORKFLOW for an Automation', async () => {
      const exec = await seedExecution(tenant.id, automation.id)
      const res = await appAs(tenant.id).request(`/${exec.id}/query`, post({ name: 'status' }))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('NOT_A_WORKFLOW')
    })

    it('409 EXECUTION_NOT_QUERYABLE when closed or not started', async () => {
      const closed = await seedExecution(tenant.id, lifecycleV1.id, { status: 'COMPLETED' })
      const queued = await seedExecution(tenant.id, lifecycleV1.id, {
        status: 'QUEUED',
        temporalWorkflowId: null,
      })
      const app = appAs(tenant.id)
      for (const id of [closed.id, queued.id]) {
        const res = await app.request(`/${id}/query`, post({ name: 'status' }))
        expect(res.status).toBe(409)
        expect((await json(res)).code).toBe('EXECUTION_NOT_QUERYABLE')
      }
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('409 when Temporal no longer has the instance', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      mockQuery.mockRejectedValue(
        Object.assign(new Error('gone'), { name: 'WorkflowNotFoundError' }),
      )
      const res = await appAs(tenant.id).request(`/${exec.id}/query`, post({ name: 'status' }))
      expect(res.status).toBe(409)
    })

    it('502 on any other Temporal failure', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      mockQuery.mockRejectedValue(new Error('grpc down'))
      const res = await appAs(tenant.id).request(`/${exec.id}/query`, post({ name: 'status' }))
      expect(res.status).toBe(502)
      expect((await json(res)).code).toBe('TEMPORAL_QUERY_FAILED')
    })

    it('404 for another tenant’s execution', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(otherTenant.id).request(`/${exec.id}/query`, post({ name: 'status' }))
      expect(res.status).toBe(404)
    })

    it.each([['viewer'], ['workflow_runtime']])('403 for %s', async (role) => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(tenant.id, [role]).request(
        `/${exec.id}/query`,
        post({ name: 'status' }),
      )
      expect(res.status).toBe(403)
    })
  })

  // ── POST /:executionId/cancel ─────────────────────────────────────────────

  describe('POST /:executionId/cancel', () => {
    it('requests a cooperative cancel by id and returns 202 with the still-open row', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV2.id)
      const res = await appAs(tenant.id).request(`/${exec.id}/cancel`, post({}))
      expect(res.status).toBe(202)
      expect(mockCancel).toHaveBeenCalledTimes(1)
      expect(((await json(res)).data as Row).status).toBe('RUNNING')
    })

    it('does not cascade to steps (the Workflow cancels its own)', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      await seedExecution(tenant.id, automation.id, { parentExecutionId: exec.id })
      await appAs(tenant.id).request(`/${exec.id}/cancel`, post({}))
      expect(mockCancel).toHaveBeenCalledTimes(1)
    })

    it('403 for a viewer; 404 for another tenant', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      expect(
        (await appAs(tenant.id, ['viewer']).request(`/${exec.id}/cancel`, post({}))).status,
      ).toBe(403)
      expect((await appAs(otherTenant.id).request(`/${exec.id}/cancel`, post({}))).status).toBe(404)
    })
  })

  // ── POST /:executionId/terminate ──────────────────────────────────────────

  describe('POST /:executionId/terminate', () => {
    it('terminates with the reason, closes the row as CANCELLED, and cancels open steps', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const openStep = await seedExecution(tenant.id, automation.id, { parentExecutionId: exec.id })
      await seedExecution(tenant.id, automation.id, {
        parentExecutionId: exec.id,
        status: 'COMPLETED',
      })
      const res = await appAs(tenant.id).request(
        `/${exec.id}/terminate`,
        post({ reason: 'order voided' }),
      )
      expect(res.status).toBe(202)
      expect((await json(res)).data).toMatchObject({
        status: 'CANCELLED',
        errorMessage: 'Terminated: order voided',
      })
      expect(mockTerminate).toHaveBeenCalledWith('order voided')
      // Parent terminated; exactly the one OPEN step cancelled.
      expect(mockCancel).toHaveBeenCalledTimes(1)
      expect(mockGetHandle).toHaveBeenCalledWith(openStep.temporalWorkflowId, undefined, {
        firstExecutionRunId: 'first-run',
      })
      const row = await db.workflowExecution.findUnique({ where: { id: exec.id } })
      expect(row?.status).toBe('CANCELLED')
      expect(row?.finishedAt).not.toBeNull()
    })

    it('a step cancel that fails does not fail the terminate', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      await seedExecution(tenant.id, automation.id, { parentExecutionId: exec.id })
      mockCancel.mockRejectedValue(new Error('grpc down'))
      const res = await appAs(tenant.id).request(`/${exec.id}/terminate`, post({ reason: 'x' }))
      expect(res.status).toBe(202)
    })

    it('runs under the kill switch, on an Automation too', async () => {
      await db.tenant.update({ where: { id: tenant.id }, data: { workflowsDisabled: true } })
      const exec = await seedExecution(tenant.id, automation.id)
      const res = await appAs(tenant.id).request(`/${exec.id}/terminate`, post({ reason: 'stuck' }))
      expect(res.status).toBe(202)
    })

    it('400 without a reason', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(tenant.id).request(`/${exec.id}/terminate`, post({ reason: '  ' }))
      expect(res.status).toBe(400)
      expect(mockTerminate).not.toHaveBeenCalled()
    })

    it('409 EXECUTION_NOT_TERMINABLE when already terminal or not started', async () => {
      const done = await seedExecution(tenant.id, lifecycleV1.id, { status: 'COMPLETED' })
      const queued = await seedExecution(tenant.id, lifecycleV1.id, {
        status: 'QUEUED',
        temporalWorkflowId: null,
      })
      const app = appAs(tenant.id)
      for (const id of [done.id, queued.id]) {
        const res = await app.request(`/${id}/terminate`, post({ reason: 'x' }))
        expect(res.status).toBe(409)
        expect((await json(res)).code).toBe('EXECUTION_NOT_TERMINABLE')
      }
    })

    it('409 when Temporal no longer has it; the row is left for the reconciler', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      mockTerminate.mockRejectedValue(
        Object.assign(new Error('gone'), { name: 'WorkflowNotFoundError' }),
      )
      const res = await appAs(tenant.id).request(`/${exec.id}/terminate`, post({ reason: 'x' }))
      expect(res.status).toBe(409)
      const row = await db.workflowExecution.findUnique({ where: { id: exec.id } })
      expect(row?.status).toBe('RUNNING')
    })

    it('502 on a Temporal failure; the row stays open', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      mockTerminate.mockRejectedValue(new Error('grpc down'))
      const res = await appAs(tenant.id).request(`/${exec.id}/terminate`, post({ reason: 'x' }))
      expect(res.status).toBe(502)
      const row = await db.workflowExecution.findUnique({ where: { id: exec.id } })
      expect(row?.status).toBe('RUNNING')
    })

    it('404 for another tenant’s execution', async () => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(otherTenant.id).request(
        `/${exec.id}/terminate`,
        post({ reason: 'x' }),
      )
      expect(res.status).toBe(404)
      expect(mockTerminate).not.toHaveBeenCalled()
    })

    it.each([['viewer'], ['workflow_runtime']])('403 for %s', async (role) => {
      const exec = await seedExecution(tenant.id, lifecycleV1.id)
      const res = await appAs(tenant.id, [role]).request(
        `/${exec.id}/terminate`,
        post({ reason: 'x' }),
      )
      expect(res.status).toBe(403)
    })
  })
})
