/**
 * Integration tests for the WorkflowState repository.
 *
 * These run through `createTenantDb` rather than the root client: the model is
 * in TENANT_SCOPED_MODELS, so isolation comes from the Prisma extension and not
 * from any `where` clause in the repository.
 *
 * The cases that need a real database are the concurrency guarantees the store
 * exists to provide — the unique index is the claim lock and the version filter
 * is the compare-and-set — which a mocked client cannot exercise.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { createWorkflowStateRepository } from '../workflow-state.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const TENANT_A_SLUG = 'test-workflow-state-a'
const TENANT_B_SLUG = 'test-workflow-state-b'
const NS = 'nw_pulse'
const USER = 'svc-workflow-state-test'

let tenantAId: string
let tenantBId: string

afterAll(async () => {
  if (hasDb) {
    await db.workflowState
      .deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
      .catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('WorkflowStateRepository (integration)', () => {
  let repoA: ReturnType<typeof createWorkflowStateRepository>
  let repoB: ReturnType<typeof createWorkflowStateRepository>

  const input = (key: string, state: object = { status: 'pending' }) => ({
    tenantId: tenantAId,
    namespace: NS,
    key,
    state,
    updatedByUserId: USER,
  })

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      db.tenant.upsert({
        where: { slug: TENANT_A_SLUG },
        create: { name: 'Test Tenant (Workflow State A)', slug: TENANT_A_SLUG },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: TENANT_B_SLUG },
        create: { name: 'Test Tenant (Workflow State B)', slug: TENANT_B_SLUG },
        update: {},
      }),
    ])
    tenantAId = a.id
    tenantBId = b.id
    const scoped = (id: string) =>
      createTenantDb(db as unknown as PrismaClient, id) as unknown as PrismaClient
    repoA = createWorkflowStateRepository(scoped(tenantAId))
    repoB = createWorkflowStateRepository(scoped(tenantBId))
  })

  beforeEach(async () => {
    await db.workflowState.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
  })

  describe('claim', () => {
    it('creates the row at version 1 when the key is free', async () => {
      const result = await repoA.claim(input('pulse:1:pack'))
      expect(result.outcome).toBe('created')
      if (result.outcome === 'created') expect(result.row.version).toBe(1)
    })

    it('returns the existing row instead of overwriting it', async () => {
      await repoA.claim(input('pulse:1:pack', { status: 'sent' }))
      const result = await repoA.claim(input('pulse:1:pack', { status: 'pending' }))
      expect(result.outcome).toBe('exists')
      if (result.outcome === 'exists') expect(result.current.state).toEqual({ status: 'sent' })
    })

    it('gives exactly one winner when overlapping runs claim the same key', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          repoA.claim(input('phone:+15555550100:2026-09-29', { run: i })),
        ),
      )
      expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1)
      expect(results.filter((r) => r.outcome === 'exists')).toHaveLength(7)
    })
  })

  describe('compareAndSet', () => {
    it('writes and bumps the version when the expected version matches', async () => {
      await repoA.claim(input('pulse:2:load'))
      const result = await repoA.compareAndSet({
        ...input('pulse:2:load', { status: 'sent' }),
        expectedVersion: 1,
      })
      expect(result.outcome).toBe('updated')
      if (result.outcome === 'updated') {
        expect(result.row.version).toBe(2)
        expect(result.row.state).toEqual({ status: 'sent' })
      }
    })

    it('refuses a stale version and reports the current row', async () => {
      await repoA.claim(input('pulse:3:load'))
      await repoA.put(input('pulse:3:load', { status: 'failed' }))
      const result = await repoA.compareAndSet({
        ...input('pulse:3:load', { status: 'pending' }),
        expectedVersion: 1,
      })
      expect(result.outcome).toBe('conflict')
      if (result.outcome === 'conflict') expect(result.current?.version).toBe(2)
    })

    it('reports a conflict with no current row when the key does not exist', async () => {
      const result = await repoA.compareAndSet({ ...input('pulse:missing'), expectedVersion: 1 })
      expect(result).toEqual({ outcome: 'conflict', current: null })
    })

    it('lets exactly one of two racing reclaims win', async () => {
      await repoA.claim(input('pulse:4:pack', { status: 'failed' }))
      const results = await Promise.all([
        repoA.compareAndSet({
          ...input('pulse:4:pack', { status: 'pending', run: 'a' }),
          expectedVersion: 1,
        }),
        repoA.compareAndSet({
          ...input('pulse:4:pack', { status: 'pending', run: 'b' }),
          expectedVersion: 1,
        }),
      ])
      expect(results.filter((r) => r.outcome === 'updated')).toHaveLength(1)
      expect(results.filter((r) => r.outcome === 'conflict')).toHaveLength(1)
    })
  })

  describe('put', () => {
    it('creates, then overwrites with a bumped version', async () => {
      const first = await repoA.put(input('cfg'))
      expect(first).toMatchObject({ created: true, row: { version: 1 } })
      const second = await repoA.put(input('cfg', { status: 'x' }))
      expect(second).toMatchObject({ created: false, row: { version: 2, state: { status: 'x' } } })
    })
  })

  describe('remove', () => {
    it('deletes unconditionally and reports not_found afterwards', async () => {
      await repoA.put(input('gone'))
      expect(await repoA.remove(NS, 'gone')).toEqual({ outcome: 'deleted' })
      expect(await repoA.remove(NS, 'gone')).toEqual({ outcome: 'not_found' })
    })

    it('refuses a delete at a stale version', async () => {
      await repoA.put(input('guarded'))
      await repoA.put(input('guarded'))
      const result = await repoA.remove(NS, 'guarded', 1)
      expect(result.outcome).toBe('conflict')
      expect(await repoA.find(NS, 'guarded')).not.toBeNull()
    })
  })

  describe('list', () => {
    it('pages by key and filters by prefix', async () => {
      for (const k of [
        'pulse:10:load',
        'pulse:10:pack',
        'pulse:11:pack',
        'phone:+1555:2026-09-29',
      ]) {
        await repoA.put(input(k))
      }
      const page1 = await repoA.list(NS, { prefix: 'pulse:', limit: 2 })
      expect(page1.map((r) => r.key)).toEqual(['pulse:10:load', 'pulse:10:pack'])
      const page2 = await repoA.list(NS, { prefix: 'pulse:', limit: 2, cursor: 'pulse:10:pack' })
      expect(page2.map((r) => r.key)).toEqual(['pulse:11:pack'])
    })
  })

  describe('tenant isolation', () => {
    it('never exposes one tenant’s state to another, and lets each claim the same key', async () => {
      await repoA.put(input('shared-key', { owner: 'a' }))
      expect(await repoB.find(NS, 'shared-key')).toBeNull()
      expect(await repoB.list(NS, { limit: 10 })).toEqual([])
      const claimB = await repoB.claim({
        ...input('shared-key', { owner: 'b' }),
        tenantId: tenantBId,
      })
      expect(claimB.outcome).toBe('created')
      expect(await repoB.remove(NS, 'shared-key')).toEqual({ outcome: 'deleted' })
      expect((await repoA.find(NS, 'shared-key'))?.state).toEqual({ owner: 'a' })
    })
  })
})
