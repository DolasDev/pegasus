// ---------------------------------------------------------------------------
// Pure diff between desired state (from the admin API) and observed state
// (from `wg show wg0 dump`). Decides which peers to add, remove, or update.
// No I/O — easy to unit test.
// ---------------------------------------------------------------------------

import type { WgPeer } from './wg-parser'

export interface DesiredPeer {
  /** VpnPeer.id — used when PATCHing kernel observations back. */
  id: string
  tenantId: string
  publicKey: string
  /** Dotted-quad with /32 — e.g. `10.200.7.1/32`. */
  allowedIps: string
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED'
}

export interface Diff {
  /** Peers to add — `wg set wg0 peer <pub> allowed-ips <ip>`. */
  add: DesiredPeer[]
  /** Peers to remove — `wg set wg0 peer <pub> remove`. Keyed by public key. */
  remove: string[]
  /** Peers present in both — telemetry and PENDING→ACTIVE promotion may apply. */
  observed: Array<{ desired: DesiredPeer; kernel: WgPeer }>
}

/**
 * Compute the diff. Desired peers whose status is SUSPENDED or REVOKED should
 * NOT be present on the hub; if they are, they end up in `remove`.
 */
export function diffState(desired: DesiredPeer[], kernel: WgPeer[]): Diff {
  const kernelByKey = new Map<string, WgPeer>()
  for (const p of kernel) kernelByKey.set(p.publicKey, p)

  const add: DesiredPeer[] = []
  const remove: string[] = []
  const observed: Array<{ desired: DesiredPeer; kernel: WgPeer }> = []
  const desiredKeys = new Set<string>()

  for (const d of desired) {
    const shouldBePresent = d.status === 'PENDING' || d.status === 'ACTIVE'
    if (shouldBePresent) desiredKeys.add(d.publicKey)

    const k = kernelByKey.get(d.publicKey)
    if (shouldBePresent && !k) {
      add.push(d)
    } else if (!shouldBePresent && k) {
      remove.push(d.publicKey)
    } else if (shouldBePresent && k) {
      observed.push({ desired: d, kernel: k })
    }
  }

  // Peers present in the kernel that aren't in the desired list — orphans.
  for (const k of kernel) {
    if (!desiredKeys.has(k.publicKey) && !remove.includes(k.publicKey)) {
      remove.push(k.publicKey)
    }
  }

  return { add, remove, observed }
}
