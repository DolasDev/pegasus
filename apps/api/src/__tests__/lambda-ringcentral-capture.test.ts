// Unit tests for the RingCentral capture worker (SQS consumer).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQSEvent } from 'aws-lambda'

const h = vi.hoisted(() => ({
  readOAuthConfig: vi.fn(),
  syncConnection: vi.fn(),
  findConnectionById: vi.fn(),
  markWebhookEventProcessed: vi.fn(),
  markWebhookEventFailed: vi.fn(),
  kickTriggerDispatcher: vi.fn(),
}))

vi.mock('../db', () => ({ db: {} }))
vi.mock('../services/ringcentral/oauth', () => ({ readOAuthConfig: h.readOAuthConfig }))
vi.mock('../services/ringcentral/sync', () => ({ syncConnection: h.syncConnection }))
vi.mock('../repositories/messaging.repository', () => ({
  findConnectionById: h.findConnectionById,
  markWebhookEventProcessed: h.markWebhookEventProcessed,
  markWebhookEventFailed: h.markWebhookEventFailed,
}))

vi.mock('../lib/trigger-dispatch-kick', () => ({
  kickTriggerDispatcher: h.kickTriggerDispatcher,
}))

import { handler } from '../lambda-ringcentral-capture'

const CONFIG = {
  clientId: 'c',
  clientSecret: 's',
  redirectUri: 'r',
  apiBase: 'b',
  stateSecret: 'x',
}

function sqsEvent(jobs: Array<Record<string, unknown>>): SQSEvent {
  return {
    Records: jobs.map((job, i) => ({ messageId: `m-${i}`, body: JSON.stringify(job) })),
  } as SQSEvent
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.readOAuthConfig.mockReturnValue(CONFIG)
  h.markWebhookEventProcessed.mockResolvedValue({})
  h.markWebhookEventFailed.mockResolvedValue({})
  h.kickTriggerDispatcher.mockResolvedValue(true)
})

describe('lambda-ringcentral-capture', () => {
  it('runs the sync for the job connection and marks the event processed', async () => {
    h.findConnectionById.mockResolvedValue({ id: 'conn-1', tenantId: 'tnt-1' })
    h.syncConnection.mockResolvedValue({ captured: 2 })

    const res = await handler(
      sqsEvent([
        { webhookEventId: 'evt-1', connectionId: 'conn-1', tenantId: 'tnt-1', subscriptionId: 's' },
      ]),
    )

    expect(h.syncConnection).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'conn-1', tenantId: 'tnt-1' },
      {},
    )
    expect(h.markWebhookEventProcessed).toHaveBeenCalledWith(expect.anything(), 'evt-1')
    expect(res.batchItemFailures).toEqual([])
  })

  it('runs a webhook-less backfill job with backfillDays and no webhook bookkeeping', async () => {
    h.findConnectionById.mockResolvedValue({ id: 'conn-1', tenantId: 'tnt-1' })
    h.syncConnection.mockResolvedValue({ captured: 17 })

    const res = await handler(
      sqsEvent([
        { webhookEventId: null, connectionId: 'conn-1', tenantId: 'tnt-1', backfillDays: 30 },
      ]),
    )

    expect(h.syncConnection).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      backfillDays: 30,
    })
    // No originating webhook event → no processed/failed bookkeeping.
    expect(h.markWebhookEventProcessed).not.toHaveBeenCalled()
    expect(h.markWebhookEventFailed).not.toHaveBeenCalled()
    expect(res.batchItemFailures).toEqual([])
  })

  it('reports a batch failure for a backfill job without touching webhook bookkeeping', async () => {
    h.findConnectionById.mockResolvedValue({ id: 'conn-1', tenantId: 'tnt-1' })
    h.syncConnection.mockRejectedValue(new Error('RC down'))

    const res = await handler(
      sqsEvent([{ webhookEventId: null, connectionId: 'conn-1', tenantId: 'tnt-1' }]),
    )

    expect(h.markWebhookEventFailed).not.toHaveBeenCalled()
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-0' }])
  })

  it('drops the job when the integration is disabled (no failure)', async () => {
    h.readOAuthConfig.mockReturnValue(null)
    const res = await handler(sqsEvent([{ webhookEventId: 'evt-1', connectionId: 'conn-1' }]))
    expect(h.syncConnection).not.toHaveBeenCalled()
    expect(res.batchItemFailures).toEqual([])
  })

  it('reports a batch-item failure (for SQS retry/DLQ) when sync throws', async () => {
    h.findConnectionById.mockResolvedValue({ id: 'conn-1', tenantId: 'tnt-1' })
    h.syncConnection.mockRejectedValue(new Error('RC down'))

    const res = await handler(
      sqsEvent([
        { webhookEventId: 'evt-1', connectionId: 'conn-1', tenantId: 'tnt-1', subscriptionId: 's' },
      ]),
    )

    expect(h.markWebhookEventFailed).toHaveBeenCalledWith(expect.anything(), 'evt-1', 'RC down')
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-0' }])
  })

  it('isolates failures per record in a batch', async () => {
    h.findConnectionById.mockResolvedValue({ id: 'c', tenantId: 't' })
    h.syncConnection.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ captured: 0 })

    const res = await handler(
      sqsEvent([
        { webhookEventId: 'e1', connectionId: 'c', tenantId: 't', subscriptionId: 's' },
        { webhookEventId: 'e2', connectionId: 'c', tenantId: 't', subscriptionId: 's' },
      ]),
    )

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-0' }])
  })

  it('marks the event failed and drops when the connection is gone', async () => {
    h.findConnectionById.mockResolvedValue(null)
    const res = await handler(
      sqsEvent([
        { webhookEventId: 'evt-1', connectionId: 'gone', tenantId: 't', subscriptionId: 's' },
      ]),
    )
    expect(h.markWebhookEventFailed).toHaveBeenCalledWith(
      expect.anything(),
      'evt-1',
      'connection not found',
    )
    expect(res.batchItemFailures).toEqual([]) // dropped, not retried
  })

  describe('trigger dispatcher kick', () => {
    beforeEach(() => {
      h.findConnectionById.mockResolvedValue({ id: 'conn-1', tenantId: 't-1' })
    })

    it('kicks once per batch when the batch emitted sms.received', async () => {
      h.syncConnection
        .mockResolvedValueOnce({ captured: 2, emitted: 1 })
        .mockResolvedValueOnce({ captured: 3, emitted: 2 })
      await handler(
        sqsEvent([
          { webhookEventId: 'w-1', connectionId: 'conn-1' },
          { webhookEventId: 'w-2', connectionId: 'conn-1' },
        ]),
      )
      expect(h.kickTriggerDispatcher).toHaveBeenCalledTimes(1)
      expect(h.kickTriggerDispatcher).toHaveBeenCalledWith('sms_received')
    })

    it('does not kick when nothing was emitted (re-captures, outbound only)', async () => {
      h.syncConnection.mockResolvedValue({ captured: 4, emitted: 0 })
      await handler(sqsEvent([{ webhookEventId: 'w-1', connectionId: 'conn-1' }]))
      expect(h.kickTriggerDispatcher).not.toHaveBeenCalled()
    })

    it('still kicks for the records that emitted when another record failed', async () => {
      h.syncConnection
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ captured: 1, emitted: 1 })
      const out = await handler(
        sqsEvent([
          { webhookEventId: 'w-1', connectionId: 'conn-1' },
          { webhookEventId: 'w-2', connectionId: 'conn-1' },
        ]),
      )
      expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'm-0' }])
      expect(h.kickTriggerDispatcher).toHaveBeenCalledTimes(1)
    })
  })
})
