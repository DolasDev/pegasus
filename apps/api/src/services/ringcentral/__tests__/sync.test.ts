import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  acquireAccessToken: vi.fn(),
  makeClient: vi.fn(),
  getSyncCursor: vi.fn(),
  saveSyncCursor: vi.fn(),
  captureMessage: vi.fn(),
  saveBackfillProgress: vi.fn(),
  applyInboundKeyword: vi.fn(),
}))

vi.mock('../client', async (importActual) => {
  const actual = await importActual<typeof ClientModule>()
  return { ...actual, acquireAccessToken: h.acquireAccessToken, makeClient: h.makeClient }
})
vi.mock('../../../repositories/messaging.repository', () => ({
  getSyncCursor: h.getSyncCursor,
  saveSyncCursor: h.saveSyncCursor,
  captureMessage: h.captureMessage,
  saveBackfillProgress: h.saveBackfillProgress,
}))

vi.mock('../../sms/opt-out-keywords', () => ({ applyInboundKeyword: h.applyInboundKeyword }))

import { syncConnection } from '../sync'
import { RingCentralOAuthError } from '../oauth'
import type * as ClientModule from '../client'

const db = {} as never
const connection = {
  id: 'conn-1',
  tenantId: 'tnt-1',
  ownerNumber: '+19085760908',
  tokenSecretArn: 'arn:1',
}

const V1_PATH = '/restapi/v1.0/account/~/extension/~/message-sync'
const THREAD_PATH = '/restapi/v1.0/account/~/message-threads/entries/sync'
const V1_LIST_PATH = '/restapi/v1.0/account/~/extension/~/message-store'

let getMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.acquireAccessToken.mockResolvedValue({
    accessToken: 'at',
    apiBase: 'https://platform.devtest.ringcentral.com',
  })
  getMock = vi.fn()
  h.makeClient.mockReturnValue({ get: getMock, post: vi.fn(), put: vi.fn(), del: vi.fn() })
  h.getSyncCursor.mockResolvedValue(null) // no cursor → FSync by default
  h.captureMessage.mockResolvedValue({})
  h.saveSyncCursor.mockResolvedValue({})
  h.saveBackfillProgress.mockResolvedValue({})
  h.applyInboundKeyword.mockResolvedValue(null)
})

const v1Sms = (id: number) => ({
  id,
  type: 'SMS',
  direction: 'Outbound',
  creationTime: '2026-05-31T08:00:00.000Z',
  subject: 'hi',
  from: { phoneNumber: '+19085760908' },
  to: [{ phoneNumber: '+12015550123' }],
})

describe('syncConnection — v1 store', () => {
  it('FSyncs on first run (no cursor), captures SMS, and saves the cursor', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH)
        return Promise.resolve({ records: [v1Sms(1)], syncInfo: { syncToken: 'v1-tok' } })
      return Promise.resolve({ records: [], syncInfo: { syncToken: 't-tok' } })
    })

    const { captured } = await syncConnection(db, connection)

    expect(captured).toBe(1)
    const v1Call = getMock.mock.calls.find((c) => c[0] === V1_PATH)!
    expect(v1Call[1]).toMatchObject({ syncType: 'FSync', messageType: 'SMS' })
    expect(h.captureMessage).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({ source: 'V1_STORE', externalId: '1' }),
      'conn-1',
      { emitReceivedEvent: false },
    )
    expect(h.saveSyncCursor).toHaveBeenCalledWith(db, 'tnt-1', 'conn-1', 'V1', 'v1-tok')
  })

  it('ISyncs when a cursor exists', async () => {
    h.getSyncCursor.mockImplementation((_db: unknown, _t: string, _c: string, store: string) =>
      Promise.resolve(store === 'V1' ? { syncToken: 'prev' } : null),
    )
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === V1_PATH
          ? { records: [v1Sms(4)], syncInfo: { syncToken: 'x' } }
          : { records: [], syncInfo: { syncToken: 'x' } },
      ),
    )

    await syncConnection(db, connection)

    const v1Call = getMock.mock.calls.find((c) => c[0] === V1_PATH)!
    expect(v1Call[1]).toMatchObject({ syncType: 'ISync', syncToken: 'prev' })
    // Incremental pull ⇒ a first-time inbound capture announces sms.received.
    expect(h.captureMessage).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({ externalId: '4' }),
      'conn-1',
      { emitReceivedEvent: true },
    )
  })

  it('falls back to FSync on SYNC_TOKEN_INVALID', async () => {
    h.getSyncCursor.mockImplementation((_db: unknown, _t: string, _c: string, store: string) =>
      Promise.resolve(store === 'V1' ? { syncToken: 'stale' } : null),
    )
    let v1Calls = 0
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH) {
        v1Calls++
        if (v1Calls === 1)
          return Promise.reject(new RingCentralOAuthError('SYNC_TOKEN_INVALID', 400))
        return Promise.resolve({ records: [v1Sms(2)], syncInfo: { syncToken: 'fresh' } })
      }
      return Promise.resolve({ records: [], syncInfo: { syncToken: 't' } })
    })

    const { captured } = await syncConnection(db, connection)
    expect(captured).toBe(1)
    expect(v1Calls).toBe(2)
    expect(getMock.mock.calls.filter((c) => c[0] === V1_PATH)[1]![1]).toMatchObject({
      syncType: 'FSync',
    })
    // The FSync fallback re-reads history — it must not fire workflows.
    expect(h.captureMessage).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({ externalId: '2' }),
      'conn-1',
      { emitReceivedEvent: false },
    )
  })

  it('skips a non-SMS record without aborting the sync', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH)
        return Promise.resolve({
          records: [{ id: 9, type: 'Fax', creationTime: '2026-05-31T08:00:00.000Z' }, v1Sms(3)],
          syncInfo: { syncToken: 'v1' },
        })
      return Promise.resolve({ records: [], syncInfo: { syncToken: 't' } })
    })

    const { captured } = await syncConnection(db, connection)
    expect(captured).toBe(1) // only the SMS
    expect(h.captureMessage).toHaveBeenCalledTimes(1)
  })
})

describe('syncConnection — v1 backfill beyond the FSync cap', () => {
  const NOW = Date.parse('2026-09-28T12:00:00.000Z')
  const at = (iso: string, id: number) => ({ ...v1Sms(id), creationTime: iso })
  const listPages = (pages: Array<{ records: unknown[]; last?: boolean }>) => {
    let page = 0
    return () => {
      const p = pages[page++]!
      return Promise.resolve({
        records: p.records,
        navigation: p.last ? {} : { nextPage: { uri: 'next' } },
      })
    }
  }

  it('pages the message list when FSync reports older records, then clears progress', async () => {
    const nextList = listPages([
      { records: [at('2026-09-20T00:00:00.000Z', 10), at('2026-08-01T00:00:00.000Z', 11)] },
      { records: [at('2026-07-01T00:00:00.000Z', 12)], last: true },
    ])
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH)
        return Promise.resolve({
          records: [at('2026-09-22T00:00:00.000Z', 1)],
          syncInfo: { syncToken: 'v1-tok', olderRecordsExist: true },
        })
      if (path === V1_LIST_PATH) return nextList()
      return Promise.resolve({ records: [], syncInfo: { syncToken: 't' } })
    })

    const { captured } = await syncConnection(db, connection, { now: NOW })

    expect(captured).toBe(4)
    const listCalls = getMock.mock.calls.filter((c) => c[0] === V1_LIST_PATH)
    expect(listCalls).toHaveLength(2)
    // Bounded by the backfill window and the oldest FSync record; newest first.
    expect(listCalls[0]![1]).toMatchObject({
      messageType: 'SMS',
      dateFrom: '2026-06-30T12:00:00.000Z',
      dateTo: '2026-09-22T00:00:00.000Z',
      perPage: '1000',
      page: '1',
    })
    expect(listCalls[1]![1]).toMatchObject({ page: '2' })
    // History never fires workflows.
    for (const call of h.captureMessage.mock.calls) {
      expect(call[4]).toEqual({ emitReceivedEvent: false })
    }
    expect(h.saveBackfillProgress).toHaveBeenLastCalledWith(db, 'tnt-1', 'conn-1', 'V1', null)
  })

  it('bounds the backfill by now when FSync returned no records, and tolerates odd pages', async () => {
    const nextList = listPages([
      // A record with no creationTime is skipped by the normalizer and ignored
      // for the resume boundary; an empty follow-up page ends the backfill.
      { records: [{ ...v1Sms(20), creationTime: undefined }] },
      { records: [] },
    ])
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH)
        return Promise.resolve({ syncInfo: { syncToken: 'v1-tok', olderRecordsExist: true } })
      if (path === V1_LIST_PATH) return nextList()
      return Promise.resolve({ records: [], syncInfo: { syncToken: 't' } })
    })

    const { captured } = await syncConnection(db, connection, { now: NOW })

    expect(captured).toBe(0)
    const listCalls = getMock.mock.calls.filter((c) => c[0] === V1_LIST_PATH)
    expect(listCalls[0]![1]).toMatchObject({ dateTo: new Date(NOW).toISOString() })
    expect(listCalls).toHaveLength(2)
    expect(h.saveBackfillProgress).toHaveBeenLastCalledWith(db, 'tnt-1', 'conn-1', 'V1', null)
  })

  it('does not page when FSync returned everything', async () => {
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === V1_PATH
          ? { records: [v1Sms(1)], syncInfo: { syncToken: 'v1-tok', olderRecordsExist: false } }
          : { records: [], syncInfo: { syncToken: 't' } },
      ),
    )

    await syncConnection(db, connection, { now: NOW })

    expect(getMock.mock.calls.some((c) => c[0] === V1_LIST_PATH)).toBe(false)
    expect(h.saveBackfillProgress).not.toHaveBeenCalled()
  })

  it('stops at the per-run page cap and saves where to resume', async () => {
    const full = Array.from({ length: 3 }, (_, i) => ({
      records: [at(`2026-0${9 - i}-01T00:00:00.000Z`, 100 + i)],
    }))
    const nextList = listPages(full)
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH)
        return Promise.resolve({
          records: [at('2026-09-22T00:00:00.000Z', 1)],
          syncInfo: { syncToken: 'v1-tok', olderRecordsExist: true },
        })
      if (path === V1_LIST_PATH) return nextList()
      return Promise.resolve({ records: [], syncInfo: { syncToken: 't' } })
    })

    await syncConnection(db, connection, { now: NOW })

    expect(getMock.mock.calls.filter((c) => c[0] === V1_LIST_PATH)).toHaveLength(3)
    expect(h.saveBackfillProgress).toHaveBeenLastCalledWith(db, 'tnt-1', 'conn-1', 'V1', {
      from: new Date('2026-06-30T12:00:00.000Z'),
      before: new Date('2026-07-01T00:00:00.000Z'),
    })
  })

  it('resumes a saved backfill on a later incremental run', async () => {
    h.getSyncCursor.mockImplementation((_db: unknown, _t: string, _c: string, store: string) =>
      Promise.resolve(
        store === 'V1'
          ? {
              syncToken: 'prev',
              backfillFrom: new Date('2026-06-30T12:00:00.000Z'),
              backfillBefore: new Date('2026-07-01T00:00:00.000Z'),
            }
          : null,
      ),
    )
    const nextList = listPages([{ records: [at('2026-06-30T20:00:00.000Z', 200)], last: true }])
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH) return Promise.resolve({ records: [], syncInfo: { syncToken: 'x' } })
      if (path === V1_LIST_PATH) return nextList()
      return Promise.resolve({ records: [], syncInfo: { syncToken: 'x' } })
    })

    await syncConnection(db, connection, { now: NOW })

    const listCall = getMock.mock.calls.find((c) => c[0] === V1_LIST_PATH)!
    expect(listCall[1]).toMatchObject({
      dateFrom: '2026-06-30T12:00:00.000Z',
      dateTo: '2026-07-01T00:00:00.000Z',
    })
    expect(h.captureMessage).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({ externalId: '200' }),
      'conn-1',
      { emitReceivedEvent: false },
    )
    expect(h.saveBackfillProgress).toHaveBeenLastCalledWith(db, 'tnt-1', 'conn-1', 'V1', null)
  })
})

describe('syncConnection — thread store', () => {
  it('resolves the external number via Read Thread (cached) and captures with direction-correct phones', async () => {
    const READ = '/restapi/v1.0/account/~/message-threads/thread-1'
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH) return Promise.resolve({ records: [], syncInfo: { syncToken: 'v1' } })
      if (path === THREAD_PATH)
        return Promise.resolve({
          records: [
            {
              id: 100,
              type: 'SMS',
              threadId: 'thread-1',
              direction: 'Inbound',
              text: 'in',
              creationTime: '2026-06-02T10:00:00.000Z',
            },
            {
              id: 101,
              type: 'SMS',
              threadId: 'thread-1',
              direction: 'Outbound',
              text: 'out',
              creationTime: '2026-06-02T10:05:00.000Z',
            },
          ],
          syncInfo: { syncToken: 'thr-tok' },
        })
      if (path === READ)
        return Promise.resolve({
          id: 'thread-1',
          recipients: [{ phoneNumber: '+12015550123' }, { phoneNumber: '+19085760908' }],
        })
      return Promise.reject(new Error(`unexpected path ${path}`))
    })

    const { captured } = await syncConnection(db, connection)

    expect(captured).toBe(2)
    // Read Thread called exactly once despite two entries on the same thread.
    expect(getMock.mock.calls.filter((c) => c[0] === READ)).toHaveLength(1)
    // Inbound: from external, to company.
    expect(h.captureMessage).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({
        externalId: '100',
        direction: 'INBOUND',
        fromNumber: '+12015550123',
        toNumber: '+19085760908',
      }),
      'conn-1',
      { emitReceivedEvent: false },
    )
    // Outbound: from company, to external.
    expect(h.captureMessage).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({
        externalId: '101',
        direction: 'OUTBOUND',
        fromNumber: '+19085760908',
        toNumber: '+12015550123',
      }),
      'conn-1',
      { emitReceivedEvent: false },
    )
    expect(h.saveSyncCursor).toHaveBeenCalledWith(db, 'tnt-1', 'conn-1', 'THREAD', 'thr-tok')
  })

  it('on ISync, emits for an explicit Inbound entry but not a direction-less one', async () => {
    const READ = '/restapi/v1.0/account/~/message-threads/thread-2'
    h.getSyncCursor.mockImplementation((_db: unknown, _t: string, _c: string, store: string) =>
      Promise.resolve(store === 'THREAD' ? { syncToken: 'prev' } : null),
    )
    getMock.mockImplementation((path: string) => {
      if (path === V1_PATH) return Promise.resolve({ records: [], syncInfo: { syncToken: 'v1' } })
      if (path === THREAD_PATH)
        return Promise.resolve({
          records: [
            {
              id: 200,
              type: 'SMS',
              threadId: 'thread-2',
              direction: 'Inbound',
              text: 'YES',
              creationTime: '2026-06-02T10:00:00.000Z',
            },
            {
              id: 201,
              type: 'SMS',
              threadId: 'thread-2',
              text: '?',
              creationTime: '2026-06-02T10:01:00.000Z',
            },
          ],
          syncInfo: { syncToken: 'thr-tok' },
        })
      if (path === READ)
        return Promise.resolve({ id: 'thread-2', recipients: [{ phoneNumber: '+12015550123' }] })
      return Promise.reject(new Error(`unexpected path ${path}`))
    })

    await syncConnection(db, connection)

    const flagFor = (externalId: string) =>
      h.captureMessage.mock.calls.find(
        (c) => (c[2] as { externalId: string }).externalId === externalId,
      )![4]
    expect(flagFor('200')).toEqual({ emitReceivedEvent: true })
    // Still captured (and forwarded), but a missing direction never fires a workflow.
    expect(flagFor('201')).toEqual({ emitReceivedEvent: false })
  })
})

describe('syncConnection — opt-out keywords', () => {
  const captured = { id: 'm-1', direction: 'INBOUND', body: 'STOP', fromNumber: '+12015550123' }

  it('applies keywords on a full sync too, where sms.received is NOT emitted', async () => {
    h.captureMessage.mockResolvedValue(captured)
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === V1_PATH
          ? { records: [v1Sms(7)], syncInfo: { syncToken: 'v1-tok' } }
          : { records: [], syncInfo: { syncToken: 't' } },
      ),
    )

    await syncConnection(db, connection)

    expect(h.captureMessage).toHaveBeenCalledWith(db, 'tnt-1', expect.anything(), 'conn-1', {
      emitReceivedEvent: false,
    })
    expect(h.applyInboundKeyword).toHaveBeenCalledWith(db, 'tnt-1', captured)
  })

  it('a keyword failure never aborts capture', async () => {
    h.captureMessage.mockResolvedValue(captured)
    h.applyInboundKeyword.mockRejectedValue(new Error('db down'))
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === V1_PATH
          ? { records: [v1Sms(8)], syncInfo: { syncToken: 'v1-tok' } }
          : { records: [], syncInfo: { syncToken: 't' } },
      ),
    )

    const { captured: count } = await syncConnection(db, connection)
    expect(count).toBe(1)
  })
})
