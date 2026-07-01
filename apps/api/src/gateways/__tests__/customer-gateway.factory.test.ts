import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../repositories', () => ({
  findCustomerById: vi.fn(),
  findCustomerByEmail: vi.fn(),
  listCustomers: vi.fn().mockResolvedValue([]),
  countCustomers: vi.fn().mockResolvedValue(0),
}))
vi.mock('../pegii-customer.gateway', () => ({
  createPegiiCustomerGateway: vi.fn(() => ({ __pegii: true })),
}))
vi.mock('../../lib/pegii-overlay-target', () => ({
  resolvePegiiOverlayTarget: vi.fn(),
}))

import { resolveCustomerGateway } from '../customer-gateway.factory'
import * as customerRepo from '../../repositories'
import { createPegiiCustomerGateway } from '../pegii-customer.gateway'
import { resolvePegiiOverlayTarget } from '../../lib/pegii-overlay-target'

function dbWithSource(customerSource: string | null): PrismaClient {
  return {
    tenant: { findUnique: vi.fn().mockResolvedValue({ customerSource }) },
  } as unknown as PrismaClient
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveCustomerGateway', () => {
  it('returns the Prisma-backed gateway when customerSource is null (default)', async () => {
    const db = dbWithSource(null)
    const gw = await resolveCustomerGateway(db, 't1')
    await gw.listCustomers({ limit: 5 })
    expect(customerRepo.listCustomers).toHaveBeenCalledWith(db, { limit: 5 })
    expect(createPegiiCustomerGateway).not.toHaveBeenCalled()
  })

  it('returns the pegII gateway with the resolved base + apiKey when source is pegii', async () => {
    vi.mocked(resolvePegiiOverlayTarget).mockResolvedValue({
      ok: true,
      target: { base: 'https://10.200.7.1:8443', apiKey: 'arn:k' },
    })
    const db = dbWithSource('pegii')
    const gw = (await resolveCustomerGateway(db, 't1')) as unknown as { __pegii: boolean }
    expect(gw.__pegii).toBe(true)
    expect(createPegiiCustomerGateway).toHaveBeenCalledWith({
      tenantId: 't1',
      baseUrl: 'https://10.200.7.1:8443',
      apiKey: 'arn:k',
    })
  })

  it('throws PEGII_API_NOT_CONFIGURED when a pegii tenant has no reachable target', async () => {
    vi.mocked(resolvePegiiOverlayTarget).mockResolvedValue({
      ok: false,
      code: 'PEGII_API_PEER_INACTIVE',
      message: 'tenant peer is PENDING, not ACTIVE',
    })
    const db = dbWithSource('pegii')
    await expect(resolveCustomerGateway(db, 't1')).rejects.toMatchObject({
      code: 'PEGII_API_NOT_CONFIGURED',
    })
  })

  it('propagates the fail-fast throw on an invalid customerSource value', async () => {
    const db = dbWithSource('garbage')
    await expect(resolveCustomerGateway(db, 't1')).rejects.toThrow(/Unknown customerSource/)
  })
})
