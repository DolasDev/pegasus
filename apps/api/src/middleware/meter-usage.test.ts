// ---------------------------------------------------------------------------
// Unit tests for the usage meter middleware — the counting rules.
//
// The repository and the CloudWatch emitter are mocked: these tests pin WHEN
// the meter records and WHAT it records. The dedup + tenant-isolation
// guarantees need a real database and live in
// repositories/__tests__/usage.repository.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv, ApiClientContext } from '../types'
import { Actions } from '../authz/actions'

const { mockRecord, mockEmit } = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  mockEmit: vi.fn(),
}))

vi.mock('../repositories/usage.repository', () => ({
  createUsageRepository: vi.fn(() => ({ record: mockRecord })),
}))
vi.mock('../lib/usage/meter-metrics', () => ({
  emitMeterWriteFailed: mockEmit,
}))

import { meterUsage } from './meter-usage'

const TENANT = 'tenant-a'
const WORKFLOW_ID = '7f1c2a9e-0d4b-4e57-9b0e-1f2a3b4c5d6e'

function client(name: string): ApiClientContext {
  return { id: `client-${name}`, name } as ApiClientContext
}

const RUNTIME = client(`wf-runtime-${WORKFLOW_ID}`)
const PLAIN = client('acme-erp-sync')

type Respond = { status: number; body: unknown }

function appFor(
  action: (typeof Actions)[keyof typeof Actions],
  respond: Respond,
  apiClient: ApiClientContext | undefined,
) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', TENANT)
    c.set('db', {} as PrismaClient)
    c.set('correlationId', 'corr-1')
    c.set('apiClient', apiClient)
    await next()
  })
  app.post('/x', meterUsage(action), (c) => c.json(respond.body as object, respond.status as 200))
  return app
}

async function call(app: Hono<AppEnv>, body: unknown = {}) {
  return app.request('/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue(true)
  mockEmit.mockReset().mockResolvedValue(undefined)
})

describe('meterUsage — counting rules', () => {
  it('a new send counts one, keyed on the SmsSend row', async () => {
    const app = appFor(
      Actions.SendSms,
      { status: 202, body: { data: { id: 'send-1', status: 'Queued', alreadySent: false } } },
      RUNTIME,
    )
    const res = await call(app)
    expect(res.status).toBe(202)
    expect(mockRecord).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledWith({
      tenantId: TENANT,
      action: 'SendSms',
      subjectKey: 'sms:send-1',
      apiClientId: RUNTIME.id,
      workflowId: WORKFLOW_ID,
      correlationId: 'corr-1',
    })
  })

  it.each([
    ['SendSms', Actions.SendSms, { id: 's', alreadySent: true }],
    ['SendEmail', Actions.SendEmail, { id: 'e', alreadySent: true }],
    ['UpdateTextMessage', Actions.UpdateTextMessage, { id: 'm', alreadyRead: true }],
    ['CloseTask', Actions.CloseTask, { id: 't', alreadyClosed: true }],
  ])('a %s replay counts zero', async (_name, action, data) => {
    const app = appFor(action, { status: 200, body: { data } }, RUNTIME)
    expect((await call(app)).status).toBe(200)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('a Cognito (human) caller counts zero', async () => {
    const app = appFor(
      Actions.SendSms,
      { status: 202, body: { data: { id: 'send-1', alreadySent: false } } },
      undefined,
    )
    expect((await call(app)).status).toBe(202)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it.each([400, 404, 409, 429, 502, 503])('a %i counts zero', async (status) => {
    const app = appFor(Actions.SendSms, { status, body: { error: 'nope', code: 'X' } }, RUNTIME)
    expect((await call(app)).status).toBe(status)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('keys each action on its own subject prefix', async () => {
    const cases = [
      [Actions.SendEmail, { id: 'e1', alreadySent: false }, 'email:e1'],
      [Actions.UpdateTextMessage, { id: 'm1', readStatus: 'Read', alreadyRead: false }, 'read:m1'],
      [Actions.CloseTask, { id: 't1', status: 'closed', alreadyClosed: false }, 'close:t1'],
    ] as const
    for (const [action, data, key] of cases) {
      mockRecord.mockClear()
      await call(appFor(action, { status: 200, body: { data } }, RUNTIME))
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: action.id, subjectKey: key }),
      )
    }
  })

  it("normalizes RingCentral's numeric id so a replay's string id is the same subject", async () => {
    await call(
      appFor(
        Actions.SendSms,
        { status: 202, body: { data: { id: 123456, alreadySent: false } } },
        RUNTIME,
      ),
    )
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ subjectKey: 'sms:123456' }))
  })

  it('a sent text RingCentral returned no id for still counts, under a minted key', async () => {
    await call(
      appFor(
        Actions.SendSms,
        { status: 202, body: { data: { id: null, status: null, alreadySent: false } } },
        RUNTIME,
      ),
    )
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ subjectKey: expect.stringMatching(/^sms:unidentified:/) }),
    )
  })
})

describe('meterUsage — outbound integration calls', () => {
  it('a successful delivery counts once, with a server-minted key', async () => {
    const app = appFor(
      Actions.DeliverToExternal,
      { status: 200, body: { data: { delivered: true, status: 201, dryRun: false } } },
      RUNTIME,
    )
    await call(app)
    await call(app)
    expect(mockRecord).toHaveBeenCalledTimes(2)
    const [first, second] = mockRecord.mock.calls.map(
      (c) => (c[0] as { subjectKey: string }).subjectKey,
    )
    expect(first).toMatch(/^deliver:[0-9a-f-]{36}$/)
    // A client-suppliable correlation id is never the key: two deliveries under
    // the same x-correlation-id are two actions.
    expect(second).not.toBe(first)
  })

  it('a delivery the PARTNER rejected (200 envelope, delivered:false) counts zero', async () => {
    const app = appFor(
      Actions.DeliverToExternal,
      { status: 200, body: { data: { delivered: false, status: 500, dryRun: false } } },
      RUNTIME,
    )
    await call(app)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('a mutating call-external counts one', async () => {
    const app = appFor(
      Actions.CallExternal,
      { status: 200, body: { data: { ok: true, status: 200, dryRun: false } } },
      RUNTIME,
    )
    await call(app, { method: 'POST', path: '/orders' })
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CallExternal',
        subjectKey: expect.stringMatching(/^call:/),
      }),
    )
  })

  it('a GET call-external is a read and counts zero (reads run live under dry-run)', async () => {
    const app = appFor(
      Actions.CallExternal,
      { status: 200, body: { data: { ok: true, status: 200, dryRun: false } } },
      RUNTIME,
    )
    await call(app, { method: 'GET', path: '/orders/1' })
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('honors the mutating override in both directions', async () => {
    const app = appFor(
      Actions.CallExternal,
      { status: 200, body: { data: { ok: true, status: 200, dryRun: false } } },
      RUNTIME,
    )
    await call(app, { method: 'POST', path: '/search', mutating: false })
    expect(mockRecord).not.toHaveBeenCalled()
    await call(app, { method: 'GET', path: '/trigger', mutating: true })
    expect(mockRecord).toHaveBeenCalledOnce()
  })

  it('a call-external the partner failed counts zero', async () => {
    const app = appFor(
      Actions.CallExternal,
      { status: 200, body: { data: { ok: false, status: 503, dryRun: false } } },
      RUNTIME,
    )
    await call(app, { method: 'POST', path: '/orders' })
    expect(mockRecord).not.toHaveBeenCalled()
  })
})

describe('meterUsage — attribution', () => {
  it('a plain API client resolves workflowId null', async () => {
    const app = appFor(
      Actions.SendSms,
      { status: 202, body: { data: { id: 'send-2', alreadySent: false } } },
      PLAIN,
    )
    await call(app)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ apiClientId: PLAIN.id, workflowId: null }),
    )
  })

  it('a bare `wf-runtime-` name resolves null, not an empty id', async () => {
    const app = appFor(
      Actions.SendSms,
      { status: 202, body: { data: { id: 'send-3', alreadySent: false } } },
      client('wf-runtime-'),
    )
    await call(app)
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ workflowId: null }))
  })
})

describe('meterUsage — resilience', () => {
  it('a meter DB failure still returns the handler response, and raises the metric', async () => {
    mockRecord.mockRejectedValue(new Error('connection reset'))
    const app = appFor(
      Actions.SendSms,
      { status: 202, body: { data: { id: 'send-1', alreadySent: false } } },
      RUNTIME,
    )
    const res = await call(app)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ data: { id: 'send-1', alreadySent: false } })
    expect(mockEmit).toHaveBeenCalledWith('SendSms')
  })

  it('a 2xx without the subject field is a contract break: reported, not counted', async () => {
    const app = appFor(
      Actions.SendEmail,
      { status: 202, body: { data: { alreadySent: false } } },
      RUNTIME,
    )
    expect((await call(app)).status).toBe(202)
    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockEmit).toHaveBeenCalledWith('SendEmail')
  })

  it('a 2xx that is not JSON is reported, not thrown', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('tenantId', TENANT)
      c.set('apiClient', RUNTIME)
      await next()
    })
    app.post('/x', meterUsage(Actions.SendSms), (c) => c.text('ok', 200))
    const res = await call(app)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(mockEmit).toHaveBeenCalledWith('SendSms')
  })

  it('refuses to mount on an action with no registry entry', () => {
    expect(() => meterUsage(Actions.ReadWorkflowState)).toThrow(/no entry in BILLABLE_ACTIONS/)
  })
})
