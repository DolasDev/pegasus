import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  acquireAccessToken: vi.fn(),
  makeClient: vi.fn(),
  getSyncCursor: vi.fn(),
  saveSyncCursor: vi.fn(),
  captureMessage: vi.fn(),
}))

vi.mock('../client', async (importActual) => {
  const actual = await importActual<typeof ClientModule>()
  return { ...actual, acquireAccessToken: h.acquireAccessToken, makeClient: h.makeClient }
})
vi.mock('../../../repositories/messaging.repository', () => ({
  getSyncCursor: h.getSyncCursor,
  saveSyncCursor: h.saveSyncCursor,
  captureMessage: h.captureMessage,
}))

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
    )
    expect(h.saveSyncCursor).toHaveBeenCalledWith(db, 'tnt-1', 'conn-1', 'V1', 'v1-tok')
  })

  it('ISyncs when a cursor exists', async () => {
    h.getSyncCursor.mockImplementation((_db: unknown, _t: string, _c: string, store: string) =>
      Promise.resolve(store === 'V1' ? { syncToken: 'prev' } : null),
    )
    getMock.mockResolvedValue({ records: [], syncInfo: { syncToken: 'x' } })

    await syncConnection(db, connection)

    const v1Call = getMock.mock.calls.find((c) => c[0] === V1_PATH)!
    expect(v1Call[1]).toMatchObject({ syncType: 'ISync', syncToken: 'prev' })
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
    )
    expect(h.saveSyncCursor).toHaveBeenCalledWith(db, 'tnt-1', 'conn-1', 'THREAD', 'thr-tok')
  })
})
