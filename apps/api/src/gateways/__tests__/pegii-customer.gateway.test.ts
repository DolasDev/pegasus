import { describe, it, expect, vi } from 'vitest'
import { createPegiiCustomerGateway } from '../pegii-customer.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import { happyPathCustomer, customerList } from '../pegii/__fixtures__/pegii-customer.fixtures'

function gatewayWith(get: PegiiApiClient['get']) {
  return createPegiiCustomerGateway({
    tenantId: 't1',
    baseUrl: 'https://h',
    client: { get } as PegiiApiClient,
  })
}

describe('createPegiiCustomerGateway', () => {
  it('findCustomerById hydrates a domain Customer from the DTO', async () => {
    const get = vi.fn().mockResolvedValue(happyPathCustomer)
    const gw = gatewayWith(get)
    const c = await gw.findCustomerById('1001')
    expect(get).toHaveBeenCalledWith('/customers/1001')
    expect(c?.id).toBe('1001')
    expect(c?.firstName).toBe('Ada')
  })

  it('findCustomerById returns null on a pegII 404', async () => {
    const get = vi.fn().mockRejectedValue(new PegiiApiError('PEGII_API_HTTP_ERROR', 'gone', 404))
    const gw = gatewayWith(get)
    expect(await gw.findCustomerById('nope')).toBeNull()
  })

  it('findCustomerById rethrows non-404 errors', async () => {
    const get = vi.fn().mockRejectedValue(new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'down'))
    const gw = gatewayWith(get)
    await expect(gw.findCustomerById('x')).rejects.toMatchObject({ code: 'PEGII_API_TUNNEL_ERROR' })
  })

  it('listCustomers passes limit/offset and maps every row', async () => {
    const get = vi.fn().mockResolvedValue(customerList)
    const gw = gatewayWith(get)
    const rows = await gw.listCustomers({ limit: 10, offset: 20 })
    expect(get).toHaveBeenCalledWith('/customers', { limit: 10, offset: 20 })
    expect(rows.map((r) => r.id)).toEqual(['1001', '1002', '1003'])
  })

  it('findCustomerByEmail returns the first mapped match or null', async () => {
    const get = vi.fn().mockResolvedValue([])
    const gw = gatewayWith(get)
    expect(await gw.findCustomerByEmail('none@x')).toBeNull()
    expect(get).toHaveBeenCalledWith('/customers', { email: 'none@x' })
  })

  it('countCustomers unwraps { total }', async () => {
    const get = vi.fn().mockResolvedValue({ total: 7 })
    const gw = gatewayWith(get)
    expect(await gw.countCustomers()).toBe(7)
    expect(get).toHaveBeenCalledWith('/customers/count')
  })
})
