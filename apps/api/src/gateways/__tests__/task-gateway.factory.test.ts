import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { PegiiApiError } from '../../lib/pegii-api-client'
import type { ResolvePegiiOverlayResult } from '../../lib/pegii-overlay-target'

const {
  resolvePegiiOverlayTarget,
  createPegiiTaskGateway,
  createCloudTaskGateway,
  resolveOrderGateway,
} = vi.hoisted(() => ({
  resolvePegiiOverlayTarget: vi.fn(),
  createPegiiTaskGateway: vi.fn(),
  createCloudTaskGateway: vi.fn(),
  resolveOrderGateway: vi.fn(),
}))

vi.mock('../../lib/pegii-overlay-target', () => ({ resolvePegiiOverlayTarget }))
vi.mock('../pegii-task.gateway', () => ({ createPegiiTaskGateway }))
vi.mock('../cloud-task.gateway', () => ({ createCloudTaskGateway }))
vi.mock('../order-gateway.factory', () => ({ resolveOrderGateway }))

import {
  resolveTaskGateway,
  resolveTaskGatewayForStore,
  hasLegacyTaskStore,
} from '../task-gateway.factory'
import type { CloudTaskGatewayOptions } from '../cloud-task.gateway'

const db = {} as unknown as PrismaClient

beforeEach(() => vi.clearAllMocks())

describe('resolveTaskGateway', () => {
  it('builds a pegII task gateway from the resolved overlay target', async () => {
    resolvePegiiOverlayTarget.mockResolvedValue({
      ok: true,
      target: { base: 'https://10.200.7.1:8443' },
    } satisfies ResolvePegiiOverlayResult)
    const sentinel = { getTask: vi.fn() }
    createPegiiTaskGateway.mockReturnValue(sentinel)

    const gateway = await resolveTaskGateway(db, 'tenant-1')

    expect(createPegiiTaskGateway).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      baseUrl: 'https://10.200.7.1:8443',
    })
    // The retired hub credential is never threaded to the gateway.
    expect(vi.mocked(createPegiiTaskGateway).mock.calls[0]![0]).not.toHaveProperty('apiKey')
    expect(gateway).toBe(sentinel)
  })

  it('hard-errors (PEGII_API_NOT_CONFIGURED) when the tenant has no reachable target', async () => {
    resolvePegiiOverlayTarget.mockResolvedValue({
      ok: false,
      code: 'PEGII_API_NO_PEER',
      message: 'tenant has no WireGuard peer',
    } satisfies ResolvePegiiOverlayResult)

    await expect(resolveTaskGateway(db, 'tenant-1')).rejects.toMatchObject({
      name: 'PegiiApiError',
      code: 'PEGII_API_NOT_CONFIGURED',
    })
    expect(createPegiiTaskGateway).not.toHaveBeenCalled()
  })

  it('throws a PegiiApiError instance for the unconfigured case', async () => {
    resolvePegiiOverlayTarget.mockResolvedValue({
      ok: false,
      code: 'PEGII_API_PEER_INACTIVE',
      message: 'tenant peer is PENDING, not ACTIVE',
    } satisfies ResolvePegiiOverlayResult)

    await expect(resolveTaskGateway(db, 'tenant-1')).rejects.toBeInstanceOf(PegiiApiError)
  })
})

const NO_PEER = {
  ok: false,
  code: 'PEGII_API_NO_PEER',
  message: 'tenant has no WireGuard peer',
} satisfies ResolvePegiiOverlayResult
const INACTIVE = {
  ok: false,
  code: 'PEGII_API_PEER_INACTIVE',
  message: 'tenant peer is PENDING, not ACTIVE',
} satisfies ResolvePegiiOverlayResult
const OK = { ok: true, target: { base: 'https://10.200.7.1:8443' } } as ResolvePegiiOverlayResult

describe('resolveTaskGatewayForStore', () => {
  /** Builds the cloud gateway and returns the options the factory gave it. */
  async function cloudOpts(): Promise<CloudTaskGatewayOptions> {
    createCloudTaskGateway.mockReturnValue({ store: 'cloud' })
    await resolveTaskGatewayForStore('cloud', { db, tenantId: 'tenant-1', actorUserId: 'u-1' })
    return vi.mocked(createCloudTaskGateway).mock.calls[0]![0] as CloudTaskGatewayOptions
  }

  it('cloud never resolves the pegII target up front, so it works with no peer at all', async () => {
    const opts = await cloudOpts()

    expect(resolvePegiiOverlayTarget).not.toHaveBeenCalled()
    expect(createPegiiTaskGateway).not.toHaveBeenCalled()
    expect(opts).toMatchObject({ tenantId: 'tenant-1', actorUserId: 'u-1' })
  })

  it("cloud's order check is skipped for a tenant with no pegII peer", async () => {
    resolvePegiiOverlayTarget.mockResolvedValue(NO_PEER)
    const opts = await cloudOpts()

    expect(await opts.orderExists!(490317)).toBe(true)
    expect(resolveOrderGateway).not.toHaveBeenCalled()
  })

  it("cloud's order check asks the order gateway when a peer exists", async () => {
    resolvePegiiOverlayTarget.mockResolvedValue(OK)
    const findOrderById = vi.fn().mockResolvedValueOnce({ id: 'x' }).mockResolvedValueOnce(null)
    resolveOrderGateway.mockResolvedValue({ findOrderById })
    const opts = await cloudOpts()

    expect(await opts.orderExists!(490317)).toBe(true)
    expect(await opts.orderExists!(999)).toBe(false)
    expect(findOrderById).toHaveBeenNthCalledWith(1, '490317')
  })

  it("a peer that exists but is down fails cloud's order check loudly", async () => {
    resolvePegiiOverlayTarget.mockResolvedValue(INACTIVE)
    resolveOrderGateway.mockRejectedValue(new PegiiApiError('PEGII_API_NOT_CONFIGURED', 'down'))
    const opts = await cloudOpts()

    await expect(opts.orderExists!(490317)).rejects.toMatchObject({
      code: 'PEGII_API_NOT_CONFIGURED',
    })
  })

  it('legacy resolves exactly as resolveTaskGateway does', async () => {
    resolvePegiiOverlayTarget.mockResolvedValue(NO_PEER)

    await expect(
      resolveTaskGatewayForStore('legacy', { db, tenantId: 'tenant-1' }),
    ).rejects.toMatchObject({ code: 'PEGII_API_NOT_CONFIGURED' })
    expect(createCloudTaskGateway).not.toHaveBeenCalled()
  })
})

describe('hasLegacyTaskStore', () => {
  it('is false only when the tenant has no pegII peer', async () => {
    resolvePegiiOverlayTarget.mockResolvedValueOnce(NO_PEER)
    expect(await hasLegacyTaskStore(db, 't')).toBe(false)
    resolvePegiiOverlayTarget.mockResolvedValueOnce(INACTIVE)
    expect(await hasLegacyTaskStore(db, 't')).toBe(true)
    resolvePegiiOverlayTarget.mockResolvedValueOnce(OK)
    expect(await hasLegacyTaskStore(db, 't')).toBe(true)
  })
})
