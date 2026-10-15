import { describe, it, expect, vi } from 'vitest'
import { createPegiiDriverGateway } from '../pegii-driver.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import { PegiiCapabilities } from '../../lib/pegii-capabilities'
import type { PegiiDriverFinancialsDto } from '../pegii/pegii-driver.dto'

function stubClient(get: PegiiApiClient['get']): PegiiApiClient {
  return { get, getHealth: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }
}

const DTO: PegiiDriverFinancialsDto = {
  driverId: 4766,
  asOf: '2026-10-15',
  runningBalance: 1234.56,
  escrowHeld: 800,
  monthEnd: { year: 2026, month: 9, balance: 1100 },
  pendingSettlement: { total: 2500, count: 2 },
}

describe('createPegiiDriverGateway.getFinancials', () => {
  it('gates on the capability, then GETs the financials path and maps it', async () => {
    const get = vi.fn().mockResolvedValue(DTO)
    const requireCapabilities = vi.fn().mockResolvedValue(undefined)
    const gateway = createPegiiDriverGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
      requireCapabilities,
    })

    const out = await gateway.getFinancials(4766)

    expect(requireCapabilities).toHaveBeenCalledWith(
      'https://pegii.test:8443',
      [PegiiCapabilities.DriversFinancials],
      {},
    )
    expect(PegiiCapabilities.DriversFinancials).toBe('pegii.drivers.financials.v1')
    expect(get).toHaveBeenCalledWith('/api/v1/pegii/drivers/4766/financials')
    expect(out).toEqual({
      runningBalance: 1234.56,
      escrowHeld: 800,
      monthEnd: { year: 2026, month: 9, balance: 1100 },
      pendingSettlement: { total: 2500, count: 2 },
    })
  })

  it('does not call the endpoint when the capability is missing', async () => {
    const get = vi.fn()
    const gateway = createPegiiDriverGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
      requireCapabilities: vi
        .fn()
        .mockRejectedValue(new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'old build')),
    })
    await expect(gateway.getFinancials(1)).rejects.toMatchObject({
      code: 'PEGII_API_CAPABILITY_MISSING',
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('maps null balances, a missing month-end and an absent pending block', async () => {
    const get = vi.fn().mockResolvedValue({
      driverId: 9,
      runningBalance: null,
      escrowHeld: null,
      monthEnd: null,
    } satisfies PegiiDriverFinancialsDto)
    const gateway = createPegiiDriverGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
      requireCapabilities: vi.fn().mockResolvedValue(undefined),
    })
    expect(await gateway.getFinancials(9)).toEqual({
      runningBalance: null,
      escrowHeld: null,
      monthEnd: null,
      pendingSettlement: { total: 0, count: 0 },
    })
  })

  it('propagates upstream errors (e.g. 403 / tunnel) unchanged', async () => {
    const err = new PegiiApiError('PEGII_API_HTTP_ERROR', 'forbidden', 403)
    const gateway = createPegiiDriverGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(vi.fn().mockRejectedValue(err)),
      requireCapabilities: vi.fn().mockResolvedValue(undefined),
    })
    await expect(gateway.getFinancials(1)).rejects.toBe(err)
  })
})
