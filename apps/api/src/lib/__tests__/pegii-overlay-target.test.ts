import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolvePegiiOverlayTarget, type PegiiOverlayDb } from '../pegii-overlay-target'

function makeDb(overrides: {
  tenant?: { pegiiApiBaseUrl: string | null } | null
  peer?: { assignedOctet1: number; assignedOctet2: number; status: string } | null
}): PegiiOverlayDb {
  return {
    tenant: { findUnique: vi.fn().mockResolvedValue(overrides.tenant ?? null) },
    vpnPeer: { findUnique: vi.fn().mockResolvedValue(overrides.peer ?? null) },
  } as unknown as PegiiOverlayDb
}

afterEach(() => {
  delete process.env['PEGII_API_TUNNEL_BASE_OVERRIDE']
  delete process.env['PEGII_API_TUNNEL_SCHEME']
  delete process.env['PEGII_API_TUNNEL_PORT']
})

describe('resolvePegiiOverlayTarget', () => {
  it('prefers the tenant explicit base URL', async () => {
    const db = makeDb({
      tenant: { pegiiApiBaseUrl: 'https://pegii.local:9000/' },
    })
    const res = await resolvePegiiOverlayTarget(db, 't1')
    expect(res).toEqual({ ok: true, target: { base: 'https://pegii.local:9000' } })
  })

  it('never reads the retired tenant credential (pegiiApiKeyRef)', async () => {
    const db = makeDb({ tenant: { pegiiApiBaseUrl: 'https://pegii.local:9000' } })
    await resolvePegiiOverlayTarget(db, 't1')
    expect(db.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { pegiiApiBaseUrl: true },
    })
  })

  it('falls back to the global override when no tenant base URL is set', async () => {
    process.env['PEGII_API_TUNNEL_BASE_OVERRIDE'] = 'http://127.0.0.1:8443/'
    const db = makeDb({ tenant: { pegiiApiBaseUrl: null } })
    const res = await resolvePegiiOverlayTarget(db, 't1')
    expect(res).toEqual({ ok: true, target: { base: 'http://127.0.0.1:8443' } })
  })

  it('derives the base from the VpnPeer overlay IP with http :65274 defaults', async () => {
    const db = makeDb({
      tenant: { pegiiApiBaseUrl: null },
      peer: { assignedOctet1: 7, assignedOctet2: 1, status: 'ACTIVE' },
    })
    const res = await resolvePegiiOverlayTarget(db, 't1')
    expect(res).toEqual({ ok: true, target: { base: 'http://10.200.7.1:65274' } })
  })

  it('honors PEGII_API_TUNNEL_SCHEME / PORT overrides', async () => {
    process.env['PEGII_API_TUNNEL_SCHEME'] = 'http'
    process.env['PEGII_API_TUNNEL_PORT'] = '3001'
    const db = makeDb({
      tenant: { pegiiApiBaseUrl: null },
      peer: { assignedOctet1: 12, assignedOctet2: 34, status: 'ACTIVE' },
    })
    const res = await resolvePegiiOverlayTarget(db, 't1')
    expect(res).toEqual({ ok: true, target: { base: 'http://10.200.12.34:3001' } })
  })

  it('returns PEGII_API_NO_PEER when the tenant has no peer', async () => {
    const db = makeDb({ tenant: { pegiiApiBaseUrl: null }, peer: null })
    const res = await resolvePegiiOverlayTarget(db, 't1')
    expect(res).toMatchObject({ ok: false, code: 'PEGII_API_NO_PEER' })
  })

  it('returns PEGII_API_PEER_INACTIVE when the peer is not ACTIVE', async () => {
    const db = makeDb({
      tenant: { pegiiApiBaseUrl: null },
      peer: { assignedOctet1: 7, assignedOctet2: 1, status: 'PENDING' },
    })
    const res = await resolvePegiiOverlayTarget(db, 't1')
    expect(res).toMatchObject({ ok: false, code: 'PEGII_API_PEER_INACTIVE' })
  })
})
