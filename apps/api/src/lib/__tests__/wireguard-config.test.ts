// ---------------------------------------------------------------------------
// Unit tests for apps/api/src/lib/wireguard-config.ts — `client.conf`
// renderer. Pure function, no I/O.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'

import { renderClientConfig } from '../wireguard-config'

const SAMPLE_PRIV = 'cGVnYXN1c1ByaXZhdGVLZXlUZXN0RGF0YUFBQUFBQUFBQUFFPQ=='
const SAMPLE_HUB_PUB = 'SHViUHVibGljS2V5VGVzdERhdGFBQUFBQUFBQUFBQUFBQUE9'
const SAMPLE_ADDRESS = '10.200.7.1/32'
const SAMPLE_ENDPOINT = 'vpn.pegasus.internal:51820'

describe('renderClientConfig()', () => {
  it('contains the [Interface] section header', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain('[Interface]')
  })

  it('contains the [Peer] section header', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain('[Peer]')
  })

  it('renders the private key line', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain(`PrivateKey = ${SAMPLE_PRIV}`)
  })

  it('renders the address line', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain(`Address = ${SAMPLE_ADDRESS}`)
  })

  it('renders MTU = 1380', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain('MTU = 1380')
  })

  it('renders the hub public key line', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain(`PublicKey = ${SAMPLE_HUB_PUB}`)
  })

  it('renders the endpoint line', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain(`Endpoint = ${SAMPLE_ENDPOINT}`)
  })

  it('pins AllowedIPs to the hub overlay /32', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain('AllowedIPs = 10.10.200.1/32')
  })

  it('renders PersistentKeepalive = 25', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).toContain('PersistentKeepalive = 25')
  })

  it('omits DNS line when dnsServer is not provided', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
    })
    expect(out).not.toContain('DNS =')
  })

  it('includes DNS line when dnsServer is provided', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
      dnsServer: '10.10.200.1',
    })
    expect(out).toContain('DNS = 10.10.200.1')
  })

  it('places DNS line inside the [Interface] section, above [Peer]', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
      dnsServer: '10.10.200.1',
    })
    const dnsIdx = out.indexOf('DNS = 10.10.200.1')
    const peerIdx = out.indexOf('[Peer]')
    expect(dnsIdx).toBeGreaterThan(0)
    expect(peerIdx).toBeGreaterThan(dnsIdx)
  })

  it('omits DNS line when dnsServer is the empty string', () => {
    const out = renderClientConfig({
      privateKey: SAMPLE_PRIV,
      address: SAMPLE_ADDRESS,
      hubPublicKey: SAMPLE_HUB_PUB,
      endpoint: SAMPLE_ENDPOINT,
      dnsServer: '',
    })
    expect(out).not.toContain('DNS =')
  })
})
