import { describe, it, expect, vi } from 'vitest'
import { createPegiiMemoGateway } from '../pegii-memo.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import type { PegiiMemoDto } from '../pegii/pegii-memo.dto'

const BASE = 'https://pegii.test:8443'

const memo = (over: Partial<PegiiMemoDto> = {}): PegiiMemoDto => ({
  id: 88,
  orderNumber: 490317,
  memoType: 4,
  subject: 'PULSE REPLY',
  text: 'Thanks',
  nextAction: null,
  nextDate: '2026-10-19',
  callDate: '2026-10-19',
  callTime: '2026-10-19T14:05:00',
  whoCalled: 'PEGASUS GENERATED',
  shipper: 'DOE, JANE',
  personCode: 8121,
  acknowledged: false,
  createdBy: 1001,
  ...over,
})

const body = { memoType: 4, subject: 'Pulse reply', text: 'Thanks' }

function gatewayWith(
  client: Partial<PegiiApiClient>,
  requireCapabilities = vi.fn().mockResolvedValue(undefined),
) {
  const full: PegiiApiClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    getHealth: vi.fn(),
    ...client,
  }
  return {
    requireCapabilities,
    gateway: createPegiiMemoGateway({
      tenantId: 't1',
      baseUrl: BASE,
      client: full,
      requireCapabilities,
    }),
  }
}

describe('createPegiiMemoGateway — capability gates', () => {
  it('requires pegii.memos.v1 for memos and pegii.text-messages.v1 for messages, before the site', async () => {
    const missing = new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'old site')
    const get = vi.fn()
    const post = vi.fn()
    const { gateway, requireCapabilities } = gatewayWith(
      { get, post },
      vi.fn().mockRejectedValue(missing),
    )

    await expect(gateway.createMemo(1, body)).rejects.toBe(missing)
    await expect(gateway.listMemoTypes()).rejects.toBe(missing)
    await expect(gateway.markTextMessageRead('4455')).rejects.toBe(missing)
    await expect(gateway.getTextMessageLinks('4455')).rejects.toBe(missing)

    expect(requireCapabilities.mock.calls.map((call) => call[1])).toEqual([
      ['pegii.memos.v1'],
      ['pegii.memos.v1'],
      ['pegii.text-messages.v1'],
      ['pegii.text-messages.v1'],
    ])
    expect(get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('createPegiiMemoGateway — memos', () => {
  it('posts the memo to the order and returns the site result', async () => {
    const post = vi.fn().mockResolvedValue({ memo: memo(), alreadyExists: false })
    const { gateway } = gatewayWith({ post })

    const result = await gateway.createMemo(490317, { ...body, idempotencyKey: 'k1' })

    expect(post).toHaveBeenCalledWith('/api/v1/pegii/orders/490317/memos', {
      ...body,
      idempotencyKey: 'k1',
    })
    expect(result).toEqual({ found: true, memo: memo(), alreadyExists: false })
  })

  it("maps the site's 404 to not-found, keeping its code", async () => {
    const post = vi
      .fn()
      .mockRejectedValue(
        new PegiiApiError(
          'PEGII_API_HTTP_ERROR',
          'pegII API 404: ORDER_NOT_FOUND',
          404,
          'ORDER_NOT_FOUND',
        ),
      )
    const { gateway } = gatewayWith({ post })

    expect(await gateway.createMemo(1, body)).toMatchObject({
      found: false,
      code: 'ORDER_NOT_FOUND',
    })
  })

  it("lets the site's 400/409 propagate", async () => {
    const reused = new PegiiApiError(
      'PEGII_API_HTTP_ERROR',
      'pegII API 409: IDEMPOTENCY_KEY_REUSED',
      409,
      'IDEMPOTENCY_KEY_REUSED',
    )
    const { gateway } = gatewayWith({ post: vi.fn().mockRejectedValue(reused) })

    await expect(gateway.createMemo(1, body)).rejects.toBe(reused)
  })

  it('reads the memo types', async () => {
    const types = { company: 'NW', items: [{ code: 4, label: 'Customer Service' }] }
    const get = vi.fn().mockResolvedValue(types)
    const { gateway } = gatewayWith({ get })

    expect(await gateway.listMemoTypes()).toEqual(types)
    expect(get).toHaveBeenCalledWith('/api/v1/pegii/memo-types')
  })
})

describe('createPegiiMemoGateway — text messages', () => {
  it("marks read and reads links by RingCentral's message id", async () => {
    const post = vi.fn().mockResolvedValue({ messageId: '4455', applied: true })
    const get = vi.fn().mockResolvedValue({ messageId: '4455', orderNumbers: [] })
    const { gateway } = gatewayWith({ post, get })

    await gateway.markTextMessageRead('4455')
    await gateway.getTextMessageLinks('4455')

    expect(post).toHaveBeenCalledWith('/api/v1/pegii/text-messages/4455/read', {})
    expect(get).toHaveBeenCalledWith('/api/v1/pegii/text-messages/4455/links')
  })

  it.each(['', '../orders/1', '44 55', 'x'.repeat(101)])(
    'refuses a message id (%j) that is not a pegII id before building a path',
    async (id) => {
      const post = vi.fn()
      const get = vi.fn()
      const { gateway } = gatewayWith({ post, get })

      await expect(gateway.markTextMessageRead(id)).rejects.toThrow('not a pegII text message id')
      await expect(gateway.getTextMessageLinks(id)).rejects.toThrow('not a pegII text message id')
      expect(post).not.toHaveBeenCalled()
      expect(get).not.toHaveBeenCalled()
    },
  )
})
