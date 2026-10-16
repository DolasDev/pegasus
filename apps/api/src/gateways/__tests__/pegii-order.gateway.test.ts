import { describe, it, expect, vi } from 'vitest'
import { createPegiiOrderGateway } from '../pegii-order.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import type { PegiiOrderDto } from '../pegii/pegii-order.dto'

function stubClient(
  get: PegiiApiClient['get'],
  getHealth: PegiiApiClient['getHealth'] = vi.fn(),
): PegiiApiClient {
  // findOrderById only uses get(); checkReachable() only uses getHealth().
  return { get, getHealth, post: vi.fn(), put: vi.fn(), patch: vi.fn() }
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

describe('createPegiiOrderGateway.updateOrderNative', () => {
  const fragment = { Survey: { SerivceStatus: 'In Progress' } }

  function gatewayWith(
    patch: PegiiApiClient['patch'],
    requireCapabilities = vi.fn().mockResolvedValue(undefined),
  ) {
    const client = { ...stubClient(vi.fn()), patch }
    return {
      requireCapabilities,
      gateway: createPegiiOrderGateway({
        tenantId: 't1',
        baseUrl: 'https://pegii.test:8443',
        client,
        requireCapabilities,
      }),
    }
  }

  it('PATCHes the fragment to the site and reads x-pegasus-applied', async () => {
    const order = { Id: 490317, Survey: { SerivceStatus: 'In Progress' } }
    const patch = vi
      .fn()
      .mockResolvedValue({ data: order, headers: { 'x-pegasus-applied': 'true' } })
    const { gateway, requireCapabilities } = gatewayWith(patch)

    const result = await gateway.updateOrderNative('490317', fragment)

    expect(requireCapabilities).toHaveBeenCalledWith(
      'https://pegii.test:8443',
      ['pegii.orders.write.v1'],
      {},
    )
    expect(patch).toHaveBeenCalledWith('/api/v1/pegii/orders/490317', fragment)
    expect(result).toEqual({ found: true, order, applied: true })
  })

  it('reports applied: false when the site says nothing changed (or omits the header)', async () => {
    const order = { Id: 490317 }
    const unchanged = gatewayWith(
      vi.fn().mockResolvedValue({ data: order, headers: { 'x-pegasus-applied': 'false' } }),
    )
    const noHeader = gatewayWith(vi.fn().mockResolvedValue({ data: order, headers: {} }))

    expect(await unchanged.gateway.updateOrderNative('490317', fragment)).toMatchObject({
      applied: false,
    })
    expect(await noHeader.gateway.updateOrderNative('490317', fragment)).toMatchObject({
      applied: false,
    })
  })

  it("maps the site's 404 to found: false, keeping pegII's code", async () => {
    const patch = vi
      .fn()
      .mockRejectedValue(
        new PegiiApiError(
          'PEGII_API_HTTP_ERROR',
          'pegII API 404: ORDER_SNAPSHOT_MISSING — x',
          404,
          'ORDER_SNAPSHOT_MISSING',
        ),
      )
    const { gateway } = gatewayWith(patch)

    expect(await gateway.updateOrderNative('5', fragment)).toEqual({
      found: false,
      code: 'ORDER_SNAPSHOT_MISSING',
      message: 'pegII API 404: ORDER_SNAPSHOT_MISSING — x',
    })
  })

  it("rethrows the site's 400 so the route can pass it through", async () => {
    const err = new PegiiApiError(
      'PEGII_API_HTTP_ERROR',
      "pegII API 400: VALIDATION_ERROR — 'Id'",
      400,
      'VALIDATION_ERROR',
    )
    const { gateway } = gatewayWith(vi.fn().mockRejectedValue(err))

    await expect(gateway.updateOrderNative('490317', { Id: '9' })).rejects.toBe(err)
  })

  it('refuses before writing when the site lacks pegii.orders.write.v1', async () => {
    const missing = new PegiiApiError(
      'PEGII_API_CAPABILITY_MISSING',
      'does not support: pegii.orders.write.v1',
    )
    const patch = vi.fn()
    const { gateway } = gatewayWith(patch, vi.fn().mockRejectedValue(missing))

    await expect(gateway.updateOrderNative('490317', fragment)).rejects.toBe(missing)
    expect(patch).not.toHaveBeenCalled()
  })
})

describe('createPegiiOrderGateway.searchOrders', () => {
  const item = {
    orderNumber: 490317,
    shipmentStatus: 'A',
    pack: { planned: '2026-10-20', earliest: null, latest: '2026-10-20', actual: null },
    texting: {
      status: 'Allowed',
      orderAllows: true,
      accountBlocks: false,
      parentAccountBlocks: false,
    },
  }

  function gatewayWith(
    get: PegiiApiClient['get'],
    requireCapabilities = vi.fn().mockResolvedValue(undefined),
  ) {
    return {
      requireCapabilities,
      gateway: createPegiiOrderGateway({
        tenantId: 't1',
        baseUrl: 'https://pegii.test:8443',
        client: stubClient(get),
        requireCapabilities,
      }),
    }
  }

  it('GETs the live search with the criteria as query params and returns the page', async () => {
    const get = vi.fn().mockResolvedValue({ items: [item], nextCursor: 490317 })
    const { gateway, requireCapabilities } = gatewayWith(get)

    const page = await gateway.searchOrders({
      dateField: 'plan_pack',
      from: '2026-10-20',
      to: '2026-10-21',
      status: '*',
      cursor: 100,
      limit: 50,
    })

    expect(requireCapabilities).toHaveBeenCalledWith(
      'https://pegii.test:8443',
      ['pegii.orders.search.v1'],
      {},
    )
    expect(get).toHaveBeenCalledWith('/api/v1/pegii/orders/search', {
      dateField: 'plan_pack',
      from: '2026-10-20',
      to: '2026-10-21',
      status: '*',
      cursor: 100,
      limit: 50,
    })
    expect(page).toEqual({ items: [item], nextCursor: 490317 })
  })

  it('leaves omitted criteria undefined so the site applies its defaults', async () => {
    const get = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    const { gateway } = gatewayWith(get)

    const page = await gateway.searchOrders({
      dateField: 'del_actual',
      from: '2026-10-01',
      to: '2026-10-01',
    })

    expect(get.mock.calls[0]![1]).toEqual({
      dateField: 'del_actual',
      from: '2026-10-01',
      to: '2026-10-01',
      status: undefined,
      cursor: undefined,
      limit: undefined,
    })
    expect(page).toEqual({ items: [], nextCursor: null })
  })

  it('treats a page with no items/cursor as an empty last page', async () => {
    const { gateway } = gatewayWith(vi.fn().mockResolvedValue({}))

    expect(
      await gateway.searchOrders({ dateField: 'plan_pack', from: '2026-10-20', to: '2026-10-20' }),
    ).toEqual({ items: [], nextCursor: null })
  })

  it('refuses before calling when the site lacks pegii.orders.search.v1', async () => {
    const missing = new PegiiApiError(
      'PEGII_API_CAPABILITY_MISSING',
      'does not support: pegii.orders.search.v1',
    )
    const get = vi.fn()
    const { gateway } = gatewayWith(get, vi.fn().mockRejectedValue(missing))

    await expect(
      gateway.searchOrders({ dateField: 'plan_pack', from: '2026-10-20', to: '2026-10-20' }),
    ).rejects.toBe(missing)
    expect(get).not.toHaveBeenCalled()
  })

  it("rethrows the site's 400 so the route can pass it through", async () => {
    const err = new PegiiApiError(
      'PEGII_API_HTTP_ERROR',
      'pegII API 400: VALIDATION_ERROR — limit',
      400,
      'VALIDATION_ERROR',
    )
    const { gateway } = gatewayWith(vi.fn().mockRejectedValue(err))

    await expect(
      gateway.searchOrders({ dateField: 'plan_pack', from: '2026-10-20', to: '2026-10-20' }),
    ).rejects.toBe(err)
  })
})
