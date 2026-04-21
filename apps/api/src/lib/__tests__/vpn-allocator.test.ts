import { describe, it, expect, vi } from 'vitest'
import { allocateNextOctet, formatOverlayAddress, VpnPoolExhaustedError } from '../vpn-allocator'

type Peer = { assignedOctet1: number; assignedOctet2: number }

function mockTx(existing: Peer[]) {
  return {
    vpnPeer: {
      findMany: vi.fn().mockResolvedValue(existing),
    },
  } as unknown as Parameters<typeof allocateNextOctet>[0]
}

describe('allocateNextOctet', () => {
  it('returns (0, 2) when no peers exist — (0, 1) is reserved for the hub', async () => {
    const octet = await allocateNextOctet(mockTx([]))
    expect(octet).toEqual({ octet1: 0, octet2: 2 })
  })

  it('skips existing pairs and returns the next free slot', async () => {
    const octet = await allocateNextOctet(
      mockTx([
        { assignedOctet1: 0, assignedOctet2: 2 },
        { assignedOctet1: 0, assignedOctet2: 3 },
      ]),
    )
    expect(octet).toEqual({ octet1: 0, octet2: 4 })
  })

  it('wraps octet2 at 254 and advances octet1', async () => {
    const existing: Peer[] = []
    for (let o2 = 1; o2 <= 254; o2++) existing.push({ assignedOctet1: 0, assignedOctet2: o2 })
    const octet = await allocateNextOctet(mockTx(existing))
    expect(octet).toEqual({ octet1: 1, octet2: 1 })
  })

  it('throws VpnPoolExhaustedError when the pool is full', async () => {
    const existing: Peer[] = []
    for (let o1 = 0; o1 <= 255; o1++) {
      for (let o2 = 1; o2 <= 254; o2++) {
        existing.push({ assignedOctet1: o1, assignedOctet2: o2 })
      }
    }
    await expect(allocateNextOctet(mockTx(existing))).rejects.toBeInstanceOf(VpnPoolExhaustedError)
  })

  it('never selects the hub reserved pair (0, 1) even if no peers exist', async () => {
    const octet = await allocateNextOctet(mockTx([]))
    expect(octet).not.toEqual({ octet1: 0, octet2: 1 })
  })
})

describe('formatOverlayAddress', () => {
  it('formats without prefix', () => {
    expect(formatOverlayAddress({ octet1: 7, octet2: 1 })).toBe('10.200.7.1')
  })

  it('formats with /32 prefix', () => {
    expect(formatOverlayAddress({ octet1: 7, octet2: 1 }, '/32')).toBe('10.200.7.1/32')
  })
})
