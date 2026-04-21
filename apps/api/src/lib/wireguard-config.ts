// ---------------------------------------------------------------------------
// WireGuard `client.conf` renderer.
//
// Produces the ini-format config blob that a tenant pastes into WireGuard for
// Windows (or any standard WireGuard client). See §3 of
// `plans/in-progress/wireguard-multi-tenant-vpn.md` for the exact shape.
//
// Pure function — no I/O, no env, no global state.
// ---------------------------------------------------------------------------

export interface RenderClientConfigParams {
  /** Tenant's base64-encoded X25519 private key. */
  privateKey: string
  /** Tenant's assigned overlay address with prefix, e.g. `10.200.7.1/32`. */
  address: string
  /** Hub's base64-encoded X25519 public key. */
  hubPublicKey: string
  /** Hub endpoint including port, e.g. `vpn.pegasus.internal:51820`. */
  endpoint: string
  /** Optional DNS server for the tenant's tunnel. */
  dnsServer?: string
}

/**
 * Render a WireGuard `client.conf` for a single tenant peer.
 *
 * The tenant's `AllowedIPs` is intentionally only the hub overlay IP — the
 * tenant never initiates traffic to other tenant ranges.
 */
export function renderClientConfig(params: RenderClientConfigParams): string {
  const interfaceLines = [
    '[Interface]',
    `PrivateKey = ${params.privateKey}`,
    `Address = ${params.address}`,
  ]
  if (params.dnsServer !== undefined && params.dnsServer !== '') {
    interfaceLines.push(`DNS = ${params.dnsServer}`)
  }
  interfaceLines.push('MTU = 1380')

  const peerLines = [
    '[Peer]',
    `PublicKey = ${params.hubPublicKey}`,
    `Endpoint = ${params.endpoint}`,
    'AllowedIPs = 10.10.200.1/32',
    'PersistentKeepalive = 25',
  ]

  return `${interfaceLines.join('\n')}\n\n${peerLines.join('\n')}\n`
}
