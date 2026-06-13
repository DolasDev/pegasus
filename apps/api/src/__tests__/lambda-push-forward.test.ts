// Unit tests for the push-notification forwarder cron.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  listPendingPush: vi.fn(),
  markPushSent: vi.fn(),
  markPushFailed: vi.fn(),
  listActiveTokensForUser: vi.fn(),
  deactivateTokensByValue: vi.fn(),
  sendToTokens: vi.fn(),
}))

vi.mock('../db', () => ({ db: {} }))
vi.mock('../lib/push-expo', () => ({ sendToTokens: h.sendToTokens }))
vi.mock('../repositories/push-outbox.repository', () => ({
  listPendingPush: h.listPendingPush,
  markPushSent: h.markPushSent,
  markPushFailed: h.markPushFailed,
}))
vi.mock('../repositories/device-tokens.repository', () => ({
  listActiveTokensForUser: h.listActiveTokensForUser,
  deactivateTokensByValue: h.deactivateTokensByValue,
}))

import { handler } from '../lambda-push-forward'

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pn-1',
    tenantId: 't1',
    userId: 'user-1',
    crewMember: null,
    attempts: 0,
    payload: { title: 'New assignment', body: 'Tap to view.', data: { type: 'move.assigned' } },
    ...overrides,
  }
}

function okSend(overrides: Record<string, unknown> = {}) {
  return { ticketIds: ['tk-1'], invalidTokens: [], anyAccepted: true, ...overrides }
}

beforeEach(() => {
  for (const v of Object.values(h)) (v as ReturnType<typeof vi.fn>).mockReset()
})

describe('push-forward handler', () => {
  it('no-ops when the outbox is empty', async () => {
    h.listPendingPush.mockResolvedValue([])
    await handler()
    expect(h.sendToTokens).not.toHaveBeenCalled()
    expect(h.markPushSent).not.toHaveBeenCalled()
  })

  it('delivers to a user target and marks SENT with the ticket id', async () => {
    h.listPendingPush.mockResolvedValue([outboxRow()])
    h.listActiveTokensForUser.mockResolvedValue(['ExponentPushToken[aaa]'])
    h.sendToTokens.mockResolvedValue(okSend())

    await handler()

    expect(h.listActiveTokensForUser).toHaveBeenCalledWith({}, 't1', 'user-1')
    expect(h.markPushSent).toHaveBeenCalledWith({}, 'pn-1', 'tk-1')
    expect(h.markPushFailed).not.toHaveBeenCalled()
  })

  it('resolves a crew target through its linked tenant user', async () => {
    h.listPendingPush.mockResolvedValue([
      outboxRow({ userId: null, crewMember: { tenantUserId: 'driver-9' } }),
    ])
    h.listActiveTokensForUser.mockResolvedValue(['ExponentPushToken[bbb]'])
    h.sendToTokens.mockResolvedValue(okSend())

    await handler()

    expect(h.listActiveTokensForUser).toHaveBeenCalledWith({}, 't1', 'driver-9')
    expect(h.markPushSent).toHaveBeenCalledTimes(1)
  })

  it('retries (FAILED) when the target has no active devices', async () => {
    h.listPendingPush.mockResolvedValue([outboxRow()])
    h.listActiveTokensForUser.mockResolvedValue([])

    await handler()

    expect(h.sendToTokens).not.toHaveBeenCalled()
    expect(h.markPushFailed).toHaveBeenCalledWith(
      {},
      'pn-1',
      expect.objectContaining({ nextStatus: 'FAILED' }),
    )
  })

  it('retries (FAILED) when a crew target has no linked tenant user', async () => {
    h.listPendingPush.mockResolvedValue([
      outboxRow({ userId: null, crewMember: { tenantUserId: null } }),
    ])

    await handler()

    expect(h.listActiveTokensForUser).not.toHaveBeenCalled()
    expect(h.markPushFailed).toHaveBeenCalledWith(
      {},
      'pn-1',
      expect.objectContaining({ nextStatus: 'FAILED' }),
    )
  })

  it('deactivates DeviceNotRegistered tokens while still marking SENT if any accepted', async () => {
    h.listPendingPush.mockResolvedValue([outboxRow()])
    h.listActiveTokensForUser.mockResolvedValue([
      'ExponentPushToken[good]',
      'ExponentPushToken[dead]',
    ])
    h.sendToTokens.mockResolvedValue(
      okSend({ ticketIds: ['tk-2'], invalidTokens: ['ExponentPushToken[dead]'] }),
    )

    await handler()

    expect(h.deactivateTokensByValue).toHaveBeenCalledWith({}, ['ExponentPushToken[dead]'])
    expect(h.markPushSent).toHaveBeenCalledWith({}, 'pn-1', 'tk-2')
  })

  it('records a failure when Expo accepts no messages', async () => {
    h.listPendingPush.mockResolvedValue([outboxRow()])
    h.listActiveTokensForUser.mockResolvedValue(['ExponentPushToken[x]'])
    h.sendToTokens.mockResolvedValue({
      ticketIds: [],
      invalidTokens: [],
      anyAccepted: false,
      error: 'all rejected',
    })

    await handler()

    expect(h.markPushSent).not.toHaveBeenCalled()
    expect(h.markPushFailed).toHaveBeenCalledWith(
      {},
      'pn-1',
      expect.objectContaining({ nextStatus: 'FAILED', error: 'all rejected' }),
    )
  })

  it('dead-letters (DEAD) after exhausting the attempt budget', async () => {
    // attempts=7 → this attempt is the 8th (MAX_ATTEMPTS), so it dead-letters.
    h.listPendingPush.mockResolvedValue([outboxRow({ attempts: 7 })])
    h.listActiveTokensForUser.mockResolvedValue([])

    await handler()

    expect(h.markPushFailed).toHaveBeenCalledWith(
      {},
      'pn-1',
      expect.objectContaining({ nextStatus: 'DEAD' }),
    )
  })

  it('catches a send throw and records a failed attempt', async () => {
    h.listPendingPush.mockResolvedValue([outboxRow()])
    h.listActiveTokensForUser.mockResolvedValue(['ExponentPushToken[x]'])
    h.sendToTokens.mockRejectedValue(new Error('network down'))

    await handler()

    expect(h.markPushFailed).toHaveBeenCalledWith(
      {},
      'pn-1',
      expect.objectContaining({ nextStatus: 'FAILED', error: 'network down' }),
    )
  })
})
