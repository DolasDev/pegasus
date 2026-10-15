// ---------------------------------------------------------------------------
// Tenant namespace cutover drains (3b.2) — integration tests against a live
// Postgres (skipped without DATABASE_URL). The count's WHERE clause IS the
// logic here (which rows hold a drain open), so it runs against real SQL.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import { db } from '../../db'
import {
  advanceNamespaceMigrations,
  countOpenTenantRunnerExecutions,
  STALE_QUEUED_MS,
} from '../temporal-namespace-cutover'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG = 'test-temporal-namespace-cutover'
const NS = 'pg-test-cutover00001.chgel'
const NOW = new Date('2030-06-01T12:00:00.000Z')
let tenantId: string
let tenantWorkflowId: string
let curatedWorkflowId: string

async function execution(data: {
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  temporalNamespace?: string | null
  workflowId?: string
  queuedAt?: Date
}) {
  return db.workflowExecution.create({
    data: {
      tenantId,
      workflowId: data.workflowId ?? tenantWorkflowId,
      status: data.status,
      input: {},
      queuedAt: data.queuedAt ?? NOW,
      temporalNamespace: data.temporalNamespace ?? null,
    },
  })
}

async function setStatus(status: 'READY' | 'DRAINING' | 'ACTIVE' | 'REVERTING') {
  await db.tenantTemporalNamespace.update({ where: { tenantId }, data: { status } })
}

async function statusNow() {
  return (await db.tenantTemporalNamespace.findUniqueOrThrow({ where: { tenantId } })).status
}

describe.skipIf(!hasDb)('temporal namespace cutover drains (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: 'Test Tenant (namespace cutover)', slug: SLUG },
      update: {},
    })
    tenantId = tenant.id
    await db.workflowExecution.deleteMany({ where: { tenantId } })
    await db.workflow.deleteMany({ where: { tenantId } })
    const base = {
      tenantId,
      version: '1.0.0',
      visibility: 'TENANT' as const,
      createdByUserId: 'user-1',
    }
    tenantWorkflowId = (
      await db.workflow.create({
        data: {
          ...base,
          name: 'tenant_custom_workflow',
          executable: true,
          artifactKey: `workflows/${tenantId}/a/1.0.0.zip`,
          manifest: { name: 'tenant_custom_workflow', version: '1.0.0' },
        },
      })
    ).id
    curatedWorkflowId = (
      await db.workflow.create({
        data: {
          ...base,
          name: 'send_quote_followup',
          executable: true,
          artifactKey: `workflows/${tenantId}/b/1.0.0.zip`,
          manifest: { name: 'send_quote_followup', version: '1.0.0' },
        },
      })
    ).id
  })

  beforeEach(async () => {
    await db.workflowExecution.deleteMany({ where: { tenantId } })
    await db.tenantTemporalNamespace.deleteMany({ where: { tenantId } })
    await db.tenantTemporalNamespace.create({
      data: { tenantId, namespace: NS, grpcAddress: `${NS}.tmprl.cloud:7233`, status: 'READY' },
    })
  })

  afterAll(async () => {
    await db.workflowExecution.deleteMany({ where: { tenantId } })
    await db.workflow.deleteMany({ where: { tenantId } })
    await db.tenantTemporalNamespace.deleteMany({ where: { tenantId } })
    await db.tenant.deleteMany({ where: { id: tenantId } })
  })

  describe('countOpenTenantRunnerExecutions', () => {
    it('counts RUNNING and fresh QUEUED tenant-runner rows in the given namespace only', async () => {
      await execution({ status: 'RUNNING' })
      await execution({ status: 'QUEUED' })
      await execution({ status: 'RUNNING', temporalNamespace: NS })
      await execution({ status: 'COMPLETED' })
      await execution({ status: 'FAILED' })

      expect(await countOpenTenantRunnerExecutions(db, tenantId, null, NOW)).toBe(2)
      expect(await countOpenTenantRunnerExecutions(db, tenantId, NS, NOW)).toBe(1)
    })

    it('ignores curated (STDLIB) rows: they never drain, and are never refused', async () => {
      await execution({ status: 'RUNNING', workflowId: curatedWorkflowId })
      expect(await countOpenTenantRunnerExecutions(db, tenantId, null, NOW)).toBe(0)
    })

    it('ignores an orphaned QUEUED row older than STALE_QUEUED_MS (it would wedge the drain)', async () => {
      await execution({
        status: 'QUEUED',
        queuedAt: new Date(NOW.getTime() - STALE_QUEUED_MS - 1000),
      })
      expect(await countOpenTenantRunnerExecutions(db, tenantId, null, NOW)).toBe(0)
    })
  })

  describe('advanceNamespaceMigrations', () => {
    it('holds DRAINING while a shared-namespace run is open, then moves to ACTIVE', async () => {
      await setStatus('DRAINING')
      const run = await execution({ status: 'RUNNING' })

      const held = await advanceNamespaceMigrations(db, NOW, { tenantIds: [tenantId] })
      expect(held.waiting).toContainEqual({ tenantId, status: 'DRAINING', open: 1 })
      expect(await statusNow()).toBe('DRAINING')

      await db.workflowExecution.update({ where: { id: run.id }, data: { status: 'COMPLETED' } })
      const moved = await advanceNamespaceMigrations(db, NOW, { tenantIds: [tenantId] })
      expect(moved.advanced).toContainEqual({ tenantId, from: 'DRAINING', to: 'ACTIVE' })
      expect(await statusNow()).toBe('ACTIVE')
    })

    it('a DRAINING tenant is not held by a run already in its own namespace', async () => {
      await setStatus('DRAINING')
      await execution({ status: 'RUNNING', temporalNamespace: NS })
      await advanceNamespaceMigrations(db, NOW, { tenantIds: [tenantId] })
      expect(await statusNow()).toBe('ACTIVE')
    })

    it('holds REVERTING while a tenant-namespace run is open, then moves to READY', async () => {
      await setStatus('REVERTING')
      const run = await execution({ status: 'RUNNING', temporalNamespace: NS })
      // A shared-namespace run doesn't hold a rollback.
      await execution({ status: 'RUNNING' })

      await advanceNamespaceMigrations(db, NOW, { tenantIds: [tenantId] })
      expect(await statusNow()).toBe('REVERTING')

      await db.workflowExecution.update({ where: { id: run.id }, data: { status: 'FAILED' } })
      await advanceNamespaceMigrations(db, NOW, { tenantIds: [tenantId] })
      expect(await statusNow()).toBe('READY')
    })

    it('leaves READY and ACTIVE rows alone', async () => {
      for (const status of ['READY', 'ACTIVE'] as const) {
        await setStatus(status)
        await advanceNamespaceMigrations(db, NOW, { tenantIds: [tenantId] })
        expect(await statusNow()).toBe(status)
      }
    })
  })
})
