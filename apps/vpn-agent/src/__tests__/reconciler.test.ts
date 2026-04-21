import { describe, it, expect } from 'vitest'
import { diffState, type DesiredPeer } from '../reconciler'
import type { WgPeer } from '../wg-parser'

function desired(over: Partial<DesiredPeer>): DesiredPeer {
  return {
    id: 'vpn_1',
    tenantId: 'tnt_1',
    publicKey: 'A',
    allowedIps: '10.200.0.2/32',
    status: 'PENDING',
    ...over,
  }
}

function kernel(over: Partial<WgPeer>): WgPeer {
  return {
    publicKey: 'A',
    allowedIps: '10.200.0.2/32',
    lastHandshakeAt: null,
    rxBytes: 0n,
    txBytes: 0n,
    ...over,
  }
}

describe('diffState', () => {
  it('adds a PENDING peer that is not yet in the kernel', () => {
    const d = diffState([desired({})], [])
    expect(d.add).toHaveLength(1)
    expect(d.remove).toHaveLength(0)
  })

  it('marks a matching peer as observed for telemetry', () => {
    const d = diffState([desired({ status: 'ACTIVE' })], [kernel({})])
    expect(d.observed).toHaveLength(1)
    expect(d.add).toHaveLength(0)
    expect(d.remove).toHaveLength(0)
  })

  it('removes a SUSPENDED peer still in the kernel', () => {
    const d = diffState([desired({ status: 'SUSPENDED' })], [kernel({})])
    expect(d.remove).toEqual(['A'])
    expect(d.add).toHaveLength(0)
  })

  it('does not add a SUSPENDED or REVOKED peer missing from the kernel', () => {
    const d = diffState(
      [desired({ status: 'SUSPENDED' }), desired({ publicKey: 'B', status: 'REVOKED' })],
      [],
    )
    expect(d.add).toHaveLength(0)
    expect(d.remove).toHaveLength(0)
  })

  it('removes kernel peers that are not in the desired list (orphans)', () => {
    const d = diffState([], [kernel({ publicKey: 'ORPHAN' })])
    expect(d.remove).toEqual(['ORPHAN'])
  })

  it('does not double-remove an orphan that matches a SUSPENDED desired entry', () => {
    const d = diffState([desired({ status: 'SUSPENDED' })], [kernel({})])
    expect(d.remove).toEqual(['A'])
  })
})
