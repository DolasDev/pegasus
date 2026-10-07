/**
 * End-to-end usage meter through the REAL m2mV1 router — real `vnd_` auth,
 * real Cedar (offline wasm), real handler, real meter, real database.
 *
 * The Playwright suite cannot exercise this: its local API runs with
 * SKIP_AUTH, under which dual-auth turns every caller (a `vnd_` key included)
 * into a synthetic human tenant_admin — and humans are never metered. So the
 * runtime path is proven here instead, with a key shaped exactly like a
 * workflow runtime's: a workflow_runtime service account behind an ApiClient
 * named `wf-runtime-<workflowId>`.
 *
 * CloseTask is the billable route with no external dependency (its backing
 * service is the in-memory pegII stub).
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import crypto from 'node:crypto'
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from '../db'
import { m2mV1 } from '../app'
import { _clearAuthzCache } from '../lib/authz'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'test-usage-meter-e2e'

let tenantId: string
let creatorId: string
let serviceAccountId: string
let apiClientId: string
let plainKey: string
const workflowId = crypto.randomUUID()
const orderId = `usage-meter-${Date.now().toString(36)}`
const savedSkipAuth = process.env['SKIP_AUTH']

const runtime = (path: string, init: RequestInit = {}) =>
  m2mV1.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${plainKey}`, 'Content-Type': 'application/json' },
  })

const close = (order: string) =>
  runtime('/pegii/tasks/close', {
    method: 'POST',
    body: JSON.stringify({ orderId: order, taskType: 'date_confirmation' }),
  })

const metered = () => db.usageEvent.findMany({ where: { apiClientId } })

afterAll(async () => {
  if (savedSkipAuth === undefined) delete process.env['SKIP_AUTH']
  else process.env['SKIP_AUTH'] = savedSkipAuth
  if (hasDb) {
    await db.usageEvent.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.apiClient.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.tenantUser.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('usage meter through the real m2m stack (integration)', () => {
  beforeAll(async () => {
    delete process.env['SKIP_AUTH']
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()

    const tenant = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: 'Test Tenant (Usage Meter E2E)', slug: SLUG },
      update: {},
    })
    tenantId = tenant.id
    await db.usageEvent.deleteMany({ where: { tenantId } })
    await db.apiClient.deleteMany({ where: { tenantId } })
    await db.tenantUser.deleteMany({ where: { tenantId } })

    const creator = await db.tenantUser.create({
      data: { tenantId, email: `admin-${orderId}@test.invalid`, roleNames: ['tenant_admin'] },
    })
    creatorId = creator.id
    const svc = await db.tenantUser.create({
      data: {
        tenantId,
        email: `svc-${orderId}@svc.invalid`,
        isServiceAccount: true,
        roleNames: ['workflow_runtime'],
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    })
    serviceAccountId = svc.id

    plainKey = `vnd_${crypto.randomBytes(24).toString('hex')}`
    const client = await db.apiClient.create({
      data: {
        tenantId,
        name: `wf-runtime-${workflowId}`,
        keyPrefix: plainKey.slice(0, 12),
        keyHash: crypto.createHash('sha256').update(plainKey).digest('hex'),
        scopes: [],
        createdById: creatorId,
        actsAsUserId: serviceAccountId,
      },
    })
    apiClientId = client.id
  })

  it('a runtime close counts one action, attributed to the workflow', async () => {
    const res = await close(orderId)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: { alreadyClosed: boolean } }).data.alreadyClosed).toBe(
      false,
    )
    expect(await metered()).toEqual([
      expect.objectContaining({ tenantId, action: 'CloseTask', workflowId, apiClientId }),
    ])
  })

  it('a retry of the same close is a replay and counts nothing', async () => {
    const res = await close(orderId)
    expect(((await res.json()) as { data: { alreadyClosed: boolean } }).data.alreadyClosed).toBe(
      true,
    )
    expect(await metered()).toHaveLength(1)
  })

  it('a close that matches no task is a 404 and counts nothing (sdk-feedback 0046)', async () => {
    const res = await runtime('/pegii/tasks/close', {
      method: 'POST',
      body: JSON.stringify({ orderId, taskType: 'never_existed_type' }),
    })
    expect(res.status).toBe(404)
    expect(await metered()).toHaveLength(1)
  })

  it('a billable route that fails (non-2xx) counts nothing', async () => {
    // No RingCentral platform config in the test env → /sms/send answers 503.
    const res = await runtime('/sms/send', {
      method: 'POST',
      body: JSON.stringify({ to: '+15005550006', body: 'hello' }),
    })
    expect(res.status).toBe(503)
    expect(await metered()).toHaveLength(1)
  })

  it('the runtime reads its own usage (ReadUsage)', async () => {
    const res = await runtime('/usage/summary')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as {
      data: {
        usedTermToDate: number
        byAction: Array<{ action: string; actions: number }>
        byWorkflow: Array<{ workflowId: string | null; actions: number }>
      }
    }
    expect(data.usedTermToDate).toBe(1)
    expect(data.byAction).toEqual([{ action: 'CloseTask', actions: 1 }])
    expect(data.byWorkflow).toEqual([expect.objectContaining({ workflowId, actions: 1 })])
  })
})
