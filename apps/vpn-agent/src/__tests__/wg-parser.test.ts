import { describe, it, expect } from 'vitest'
import { parseWgDump } from '../wg-parser'

const SAMPLE = [
  // Interface line: private, public, listen-port, fwmark
  'PRIVKEY\tHUBPUB\t51820\toff',
  // Peer A — active, handshake 30s ago
  'PEER_A_PUB\t(none)\t198.51.100.7:51820\t10.200.7.1/32\t1745234430\t1234\t5678\toff',
  // Peer B — no handshake yet
  'PEER_B_PUB\t(none)\t(none)\t10.200.8.1/32\t0\t0\t0\toff',
].join('\n')

describe('parseWgDump', () => {
  it('parses the interface line', () => {
    const d = parseWgDump(SAMPLE)
    expect(d.iface.publicKey).toBe('HUBPUB')
    expect(d.iface.listenPort).toBe(51820)
  })

  it('parses peers with handshake + byte counters', () => {
    const d = parseWgDump(SAMPLE)
    expect(d.peers).toHaveLength(2)
    const a = d.peers[0]!
    expect(a.publicKey).toBe('PEER_A_PUB')
    expect(a.allowedIps).toBe('10.200.7.1/32')
    expect(a.lastHandshakeAt?.getTime()).toBe(1745234430 * 1000)
    expect(a.rxBytes).toBe(1234n)
    expect(a.txBytes).toBe(5678n)
  })

  it('returns null lastHandshakeAt when epoch is 0', () => {
    const d = parseWgDump(SAMPLE)
    expect(d.peers[1]?.lastHandshakeAt).toBeNull()
  })

  it('handles empty output gracefully', () => {
    const d = parseWgDump('')
    expect(d.iface.publicKey).toBe('')
    expect(d.peers).toHaveLength(0)
  })

  it('is tolerant of trailing newlines and blank lines', () => {
    const d = parseWgDump(`${SAMPLE}\n\n`)
    expect(d.peers).toHaveLength(2)
  })
})
