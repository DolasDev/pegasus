import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { PegiiApiError } from '../../lib/pegii-api-client'
import type { ResolvePegiiOverlayResult } from '../../lib/pegii-overlay-target'

const { resolvePegiiOverlayTarget, createPegiiReportGateway } = vi.hoisted(() => ({
  resolvePegiiOverlayTarget: vi.fn(),
  createPegiiReportGateway: vi.fn(),
}))

vi.mock('../../lib/pegii-overlay-target', () => ({ resolvePegiiOverlayTarget }))
vi.mock('../pegii-report.gateway', () => ({ createPegiiReportGateway }))

import { resolveReportGateway } from '../report-gateway.factory'

const db = {} as unknown as PrismaClient

beforeEach(() => vi.clearAllMocks())

describe('resolveReportGateway', () => {
  it('builds a pegII report gateway from the resolved overlay target', async () => {
    resolvePegiiOverlayTarget.mockResolvedValue({
      ok: true,
      target: { base: 'https://10.200.7.1:8443', apiKey: 'secret-ref' },
    } satisfies ResolvePegiiOverlayResult)
    const sentinel = { fetchReport: vi.fn() }
    createPegiiReportGateway.mockReturnValue(sentinel)

    const gateway = await resolveReportGateway(db, 'tenant-1')

    expect(createPegiiReportGateway).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      baseUrl: 'https://10.200.7.1:8443',
      apiKey: 'secret-ref',
    })
    expect(gateway).toBe(sentinel)
  })

  it('hard-errors (PEGII_API_NOT_CONFIGURED) when the tenant has no reachable target', async () => {
    resolvePegiiOverlayTarget.mockResolvedValue({
      ok: false,
      code: 'PEGII_API_NO_PEER',
      message: 'tenant has no WireGuard peer',
    } satisfies ResolvePegiiOverlayResult)

    // No degrading to an empty document — the route turns this into a 503 that
    // names the dependency.
    await expect(resolveReportGateway(db, 'tenant-1')).rejects.toMatchObject({
      name: 'PegiiApiError',
      code: 'PEGII_API_NOT_CONFIGURED',
    })
    expect(createPegiiReportGateway).not.toHaveBeenCalled()
  })

  it('throws a PegiiApiError instance for the inactive-peer case', async () => {
    resolvePegiiOverlayTarget.mockResolvedValue({
      ok: false,
      code: 'PEGII_API_PEER_INACTIVE',
      message: 'tenant peer is PENDING, not ACTIVE',
    } satisfies ResolvePegiiOverlayResult)

    await expect(resolveReportGateway(db, 'tenant-1')).rejects.toBeInstanceOf(PegiiApiError)
  })
})
