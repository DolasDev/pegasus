import { describe, it, expect, vi } from 'vitest'
import { createPegiiSalesmanGateway } from '../pegii-salesman.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import type { PegiiSalesmanDto } from '../pegii/pegii-salesman.dto'

function stubClient(
  get: PegiiApiClient['get'],
  getHealth: PegiiApiClient['getHealth'] = vi.fn(),
): PegiiApiClient {
  // findSalesmanById only uses get(); checkReachable() only uses getHealth().
  return { get, getHealth }
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

describe('createPegiiSalesmanGateway.checkReachable', () => {
  it('resolves by probing /health when the source answers', async () => {
    const getHealth = vi.fn().mockResolvedValue({ status: 'healthy' })
    const gateway = createPegiiSalesmanGateway({
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
    const gateway = createPegiiSalesmanGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(vi.fn(), getHealth),
    })

    await expect(gateway.checkReachable()).rejects.toBe(boom)
  })
})
