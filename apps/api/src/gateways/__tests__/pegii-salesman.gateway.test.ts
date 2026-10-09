import { describe, it, expect, vi } from 'vitest'
import { createPegiiSalesmanGateway } from '../pegii-salesman.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import type { PegiiSalesmanDto } from '../pegii/pegii-salesman.dto'

function stubClient(
  get: PegiiApiClient['get'],
  getHealth: PegiiApiClient['getHealth'] = vi.fn(),
): PegiiApiClient {
  return { get, getHealth, post: vi.fn(), put: vi.fn(), patch: vi.fn() }
}

describe('createPegiiSalesmanGateway.findSalesmanById', () => {
  it('fetches the serialized salesman by id and maps it to a SalesmanRecord', async () => {
    const dto: PegiiSalesmanDto = { code: 213056, firstName: 'STEVE', lastName: 'GAVIN' }
    const get = vi.fn().mockResolvedValue(dto)
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    const salesman = await gateway.findSalesmanById('213056')

    expect(get).toHaveBeenCalledWith('/api/v1/pegii/serialized/salesmen/213056')
    expect(salesman).toMatchObject({ id: '213056', name: 'STEVE GAVIN' })
  })

  it('url-encodes the salesman id in the serialized path', async () => {
    const get = vi.fn().mockResolvedValue({ code: 'a/b' } satisfies PegiiSalesmanDto)
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    await gateway.findSalesmanById('a/b')
    expect(get).toHaveBeenCalledWith('/api/v1/pegii/serialized/salesmen/a%2Fb')
  })

  it('returns null when pegII reports a 404', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(new PegiiApiError('PEGII_API_HTTP_ERROR', 'not found', 404))
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    expect(await gateway.findSalesmanById('missing')).toBeNull()
  })

  it('rethrows non-404 transport/HTTP errors', async () => {
    const boom = new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'tunnel down')
    const get = vi.fn().mockRejectedValue(boom)
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    await expect(gateway.findSalesmanById('sm-1')).rejects.toBe(boom)
  })
})

describe('createPegiiSalesmanGateway.listSalesmen', () => {
  const okCaps = vi.fn().mockResolvedValue(undefined)

  it('gates on pegii.salesmen.list.v1, then pages the directory at the max page size', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ code: 1, email: 'a@nw.com', winUsername: ' a ', isActive: true }],
        nextCursor: 1,
      })
      .mockResolvedValueOnce({ items: [{ code: 2, isActive: false }], nextCursor: null })
    const requireCapabilities = vi.fn().mockResolvedValue(undefined)
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
      requireCapabilities,
    })

    const all = await gateway.listSalesmen({ active: true })

    expect(requireCapabilities).toHaveBeenCalledWith(
      'https://pegii.test:8443',
      ['pegii.salesmen.list.v1'],
      {},
    )
    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/pegii/salesmen', { limit: 500, active: 'true' })
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/pegii/salesmen', {
      limit: 500,
      active: 'true',
      cursor: 1,
    })
    expect(all.map((s) => [s.id, s.active, s.winUsername])).toEqual([
      ['1', true, 'a'],
      ['2', false, null],
    ])
  })

  it('omits the active filter when none is given', async () => {
    const get = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
      requireCapabilities: okCaps,
    })

    expect(await gateway.listSalesmen()).toEqual([])
    expect(get).toHaveBeenCalledWith('/api/v1/pegii/salesmen', { limit: 500 })
  })

  it('never calls the list on a site without the capability', async () => {
    const get = vi.fn()
    const missing = new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'old build')
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
      requireCapabilities: vi.fn().mockRejectedValue(missing),
    })

    await expect(gateway.listSalesmen()).rejects.toBe(missing)
    expect(get).not.toHaveBeenCalled()
  })

  it('fails loudly instead of looping on a cursor that never ends', async () => {
    const get = vi.fn().mockResolvedValue({ items: [], nextCursor: 7 })
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
      requireCapabilities: okCaps,
    })

    await expect(gateway.listSalesmen()).rejects.toMatchObject({ code: 'PEGII_API_BAD_ENVELOPE' })
    expect(get).toHaveBeenCalledTimes(50)
  })
})
