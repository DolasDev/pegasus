import { describe, it, expect, vi } from 'vitest'
import { createPegiiOrderGateway } from '../pegii-order.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import type { PegiiOrderDto } from '../pegii/pegii-order.dto'

function stubClient(
  get: PegiiApiClient['get'],
  getHealth: PegiiApiClient['getHealth'] = vi.fn(),
): PegiiApiClient {
  // findOrderById only uses get(); checkReachable() only uses getHealth().
  return { get, getHealth }
}

describe('createPegiiOrderGateway.findOrderById', () => {
  it('maps a populated native serialized order to real OrderRecord fields', async () => {
    const dto: PegiiOrderDto = {
      Id: '464377',
      Survey: { SerivceStatus: 'InProgress', ShipperName: 'Jane Shipper' },
      InvolvedParties: { ShipperEmployer: { Identity: { Description: 'O-60232' } } },
      KeyMoveDates: { Survey: { Planned: '2024-05-25' }, Pack: { Actual: '2024-06-01' } },
      OrderDate: '2024-05-01T00:00:00.000Z',
      ModifiedDate: '2026-07-16T16:42:45.013Z',
    }
    const get = vi.fn().mockResolvedValue(dto)
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    const order = await gateway.findOrderById('464377')

    expect(get).toHaveBeenCalledWith('/api/v1/pegii/serialized/orders/464377')
    expect(order).toEqual({
      id: '464377',
      orderNumber: 'O-60232',
      status: 'in_progress',
      customerName: 'Jane Shipper',
      scheduledDate: '2024-05-25',
      packingActualDate: '2024-06-01',
      createdAt: '2024-05-01T00:00:00.000Z',
      updatedAt: '2026-07-16T16:42:45.013Z',
    })
  })

  it('returns null for a stub/empty payload with no resolvable Id — never an "undefined" record', async () => {
    // The bug in sdk-feedback 0029: only status/updatedAt populated, identity fields absent.
    const get = vi.fn().mockResolvedValue({ ModifiedDate: '2026-07-20T00:00:00.000Z' })
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    expect(await gateway.findOrderById('464377')).toBeNull()
  })

  it('url-encodes the order id in the serialized path', async () => {
    const get = vi.fn().mockResolvedValue({ Id: 'a/b' } satisfies PegiiOrderDto)
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

describe('createPegiiOrderGateway.findOrderNativeById', () => {
  it('returns the RAW serialized payload unmapped', async () => {
    const native = {
      Id: '490574',
      Survey: { SerivceStatus: 'Accepted', ShipperName: 'Jane Shipper' },
      InvolvedParties: { Coordinator: { Identity: { Description: 'Suzanne Polo' } } },
      WarehouseSummary: { anything: true },
    }
    const get = vi.fn().mockResolvedValue(native)
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    const raw = await gateway.findOrderNativeById('490574')

    expect(get).toHaveBeenCalledWith('/api/v1/pegii/serialized/orders/490574')
    // No projection: the object is passed through verbatim.
    expect(raw).toBe(native)
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

    expect(await gateway.findOrderNativeById('missing')).toBeNull()
  })

  it('rethrows non-404 transport/HTTP errors', async () => {
    const boom = new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'tunnel down')
    const get = vi.fn().mockRejectedValue(boom)
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    await expect(gateway.findOrderNativeById('ord-1')).rejects.toBe(boom)
  })
})

describe('createPegiiOrderGateway.checkReachable', () => {
  it('resolves by probing /health when the source answers', async () => {
    const getHealth = vi.fn().mockResolvedValue({ status: 'healthy' })
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(vi.fn(), getHealth),
    })

    await expect(gateway.checkReachable()).resolves.toBeUndefined()
    expect(getHealth).toHaveBeenCalledTimes(1)
  })

  it('propagates the PegiiApiError when the source is unreachable', async () => {
    const boom = new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'tunnel down')
    const getHealth = vi.fn().mockRejectedValue(boom)
    const gateway = createPegiiOrderGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(vi.fn(), getHealth),
    })

    await expect(gateway.checkReachable()).rejects.toBe(boom)
  })
})
