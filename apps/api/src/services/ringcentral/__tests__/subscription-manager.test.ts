import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  acquireAccessToken: vi.fn(),
  makeClient: vi.fn(),
  findSubscriptionByConnection: vi.fn(),
  upsertSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
}))

vi.mock('../client', async (importActual) => {
  const actual = await importActual<typeof ClientModule>()
  return { ...actual, acquireAccessToken: h.acquireAccessToken, makeClient: h.makeClient }
})
vi.mock('../../../repositories/messaging.repository', () => ({
  findSubscriptionByConnection: h.findSubscriptionByConnection,
  upsertSubscription: h.upsertSubscription,
  updateSubscription: h.updateSubscription,
  deleteSubscription: h.deleteSubscription,
}))

import { ensureForConnection, EVENT_FILTERS } from '../subscription-manager'
import { RingCentralOAuthError } from '../oauth'
import type * as ClientModule from '../client'

const db = {} as never
const connection = { id: 'conn-1', tenantId: 'tnt-1', tokenSecretArn: 'arn:1' }
const webhookUrl = 'https://api.example/api/integrations/ringcentral/webhook'
const NOW = 1_000_000_000_000

let client: {
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.acquireAccessToken.mockResolvedValue({
    accessToken: 'at',
    apiBase: 'https://platform.devtest.ringcentral.com',
  })
  client = { post: vi.fn(), put: vi.fn(), del: vi.fn(), get: vi.fn() }
  h.makeClient.mockReturnValue(client)
  h.upsertSubscription.mockResolvedValue({})
  h.updateSubscription.mockResolvedValue({})
  h.deleteSubscription.mockResolvedValue(undefined)
})

describe('ensureForConnection', () => {
  it('creates a subscription when none exists', async () => {
    h.findSubscriptionByConnection.mockResolvedValue(null)
    client.post.mockResolvedValue({ id: 'rc-sub-1', expirationTime: '2026-06-15T00:00:00.000Z' })

    const action = await ensureForConnection(db, connection, webhookUrl, NOW)

    expect(action).toBe('created')
    const [path, body] = client.post.mock.calls[0]!
    expect(path).toBe('/restapi/v1.0/subscription')
    expect(body.deliveryMode).toMatchObject({ transportType: 'WebHook', address: webhookUrl })
    expect(body.eventFilters).toEqual([...EVENT_FILTERS])
    expect(h.upsertSubscription).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({ connectionId: 'conn-1', subscriptionId: 'rc-sub-1' }),
    )
  })

  it('no-ops when the subscription is healthy and far from expiry', async () => {
    h.findSubscriptionByConnection.mockResolvedValue({
      id: 'row-1',
      subscriptionId: 'rc-sub-1',
      status: 'ACTIVE',
      expiresAt: new Date(NOW + 5 * 24 * 60 * 60 * 1000),
    })
    const action = await ensureForConnection(db, connection, webhookUrl, NOW)
    expect(action).toBe('noop')
    expect(client.put).not.toHaveBeenCalled()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('renews when within the renewal threshold of expiry', async () => {
    h.findSubscriptionByConnection.mockResolvedValue({
      id: 'row-1',
      subscriptionId: 'rc-sub-1',
      status: 'ACTIVE',
      expiresAt: new Date(NOW + 60 * 60 * 1000), // 1h out → within 24h
    })
    client.put.mockResolvedValue({ id: 'rc-sub-1', expirationTime: '2026-06-20T00:00:00.000Z' })

    const action = await ensureForConnection(db, connection, webhookUrl, NOW)

    expect(action).toBe('renewed')
    expect(client.put).toHaveBeenCalledWith('/restapi/v1.0/subscription/rc-sub-1', {
      eventFilters: [...EVENT_FILTERS],
    })
    expect(h.updateSubscription).toHaveBeenCalledWith(
      db,
      'row-1',
      expect.objectContaining({ status: 'ACTIVE', failureCount: 0 }),
    )
  })

  it('recreates when the subscription is BLACKLISTED', async () => {
    h.findSubscriptionByConnection.mockResolvedValue({
      id: 'row-1',
      subscriptionId: 'rc-old',
      status: 'BLACKLISTED',
      expiresAt: new Date(NOW + 5 * 24 * 60 * 60 * 1000),
    })
    client.del.mockResolvedValue(undefined)
    client.post.mockResolvedValue({ id: 'rc-new' })

    const action = await ensureForConnection(db, connection, webhookUrl, NOW)

    expect(action).toBe('recreated')
    expect(client.del).toHaveBeenCalledWith('/restapi/v1.0/subscription/rc-old')
    expect(h.deleteSubscription).toHaveBeenCalledWith(db, 'row-1')
    expect(h.upsertSubscription).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({ subscriptionId: 'rc-new' }),
    )
  })

  it('recreates when a renew returns 404', async () => {
    h.findSubscriptionByConnection.mockResolvedValue({
      id: 'row-1',
      subscriptionId: 'rc-gone',
      status: 'ACTIVE',
      expiresAt: new Date(NOW + 60 * 60 * 1000),
    })
    client.put.mockRejectedValue(new RingCentralOAuthError('not found', 404))
    client.del.mockResolvedValue(undefined)
    client.post.mockResolvedValue({ id: 'rc-fresh' })

    const action = await ensureForConnection(db, connection, webhookUrl, NOW)

    expect(action).toBe('recreated')
    expect(h.upsertSubscription).toHaveBeenCalledWith(
      db,
      'tnt-1',
      expect.objectContaining({ subscriptionId: 'rc-fresh' }),
    )
  })

  it('tolerates a failed delete during recreate (stale sub already gone)', async () => {
    h.findSubscriptionByConnection.mockResolvedValue({
      id: 'row-1',
      subscriptionId: 'rc-old',
      status: 'DEAD',
      expiresAt: new Date(NOW),
    })
    client.del.mockRejectedValue(new RingCentralOAuthError('not found', 404))
    client.post.mockResolvedValue({ id: 'rc-new' })

    const action = await ensureForConnection(db, connection, webhookUrl, NOW)
    expect(action).toBe('recreated')
    expect(h.upsertSubscription).toHaveBeenCalled() // recreate still completes
  })
})
