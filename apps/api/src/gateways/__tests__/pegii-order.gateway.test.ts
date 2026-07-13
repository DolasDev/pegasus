import { describe, it, expect, vi } from 'vitest'
import { createPegiiOrderGateway } from '../pegii-order.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import type { PegiiOrderDto } from '../pegii/pegii-order.dto'

function stubClient(get: PegiiApiClient['get']): PegiiApiClient {
  return { get }
}

describe('createPegiiOrderGateway.findOrderById', () => {
  it('fetches the serialized order by id and maps it to an OrderRecord', async () => {
    const dto: PegiiOrderDto = { SaleId: 'ord-9', OrderNumber: 'SO-9', Status: 'Booked' }
    const get = vi.fn().mockResolvedValue(dto)
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    const order = await gateway.findOrderById('ord-9')

    expect(get).toHaveBeenCalledWith('/api/v1/pegii/serialized/orders/ord-9')
    expect(order).toMatchObject({ id: 'ord-9', orderNumber: 'SO-9', status: 'booked' })
  })

  it('url-encodes the order id in the serialized path', async () => {
    const get = vi.fn().mockResolvedValue({ SaleId: 'a/b' } satisfies PegiiOrderDto)
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    await gateway.findOrderById('a/b')
    expect(get).toHaveBeenCalledWith('/api/v1/pegii/serialized/orders/a%2Fb')
  })

  it('returns null when pegII reports a 404', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(new PegiiApiError('PEGII_API_HTTP_ERROR', 'not found', 404))
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    expect(await gateway.findOrderById('missing')).toBeNull()
  })

  it('rethrows non-404 transport/HTTP errors', async () => {
    const boom = new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'tunnel down')
    const get = vi.fn().mockRejectedValue(boom)
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    await expect(gateway.findOrderById('ord-1')).rejects.toBe(boom)
  })
})
