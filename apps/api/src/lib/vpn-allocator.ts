// ---------------------------------------------------------------------------
// VPN overlay IP allocator.
//
// Each tenant peer is assigned a pair (octet1, octet2) that maps to the
// overlay address `10.200.<octet1>.<octet2>`. The hub reserves the pair
// (0, 1) — `10.10.200.1` is the hub overlay IP and (0, 1) is excluded from
// tenant allocation by convention so the mental model stays simple.
//
// Allocation walks lexicographically from (0, 2) through (255, 254), skipping
// the reserved pair and treating 0/255 as broadcast/network in the /24 sense
// only for the last octet (octet2 ∈ [1, 254]). Allocation is O(n) in the
// number of existing peers, which is fine at the ~100-tenant scale this VPN
// is designed for (§10 of the plan caps a single hub at ~150 tenants).
//
// Must be called inside a Prisma interactive transaction so the subsequent
// VpnPeer insert either succeeds atomically or the allocator decision is
// rolled back with it. The composite unique constraint on
// (assignedOctet1, assignedOctet2) catches the rare race where two
// concurrent allocations both choose the same pair; the loser surfaces as
// a PrismaClientKnownRequestError with code P2002.
// ---------------------------------------------------------------------------

import type { Prisma } from '@prisma/client'

/** A single overlay-IP slot, corresponding to `10.200.<octet1>.<octet2>`. */
export interface AllocatedOctet {
  octet1: number
  octet2: number
}

/** Thrown when every (octet1, octet2) pair in the pool is already taken. */
export class VpnPoolExhaustedError extends Error {
  readonly code = 'VPN_POOL_EXHAUSTED' as const
  constructor() {
    super('No free VPN overlay address remains in the pool')
    this.name = 'VpnPoolExhaustedError'
  }
}

/**
 * Pick the next free `(octet1, octet2)` pair.
 *
 * Pool coordinates:
 *   octet1 ∈ [0, 255]
 *   octet2 ∈ [1, 254]   // last-octet convention skips 0 (network) and 255 (broadcast)
 *   (0, 1) is reserved for the hub overlay address.
 *
 * The caller must pass a Prisma transaction client so the selection and the
 * subsequent VpnPeer insert commit together.
 */
export async function allocateNextOctet(tx: Prisma.TransactionClient): Promise<AllocatedOctet> {
  const existing = await tx.vpnPeer.findMany({
    select: { assignedOctet1: true, assignedOctet2: true },
  })

  const taken = new Set<number>()
  for (const row of existing) {
    taken.add(row.assignedOctet1 * 256 + row.assignedOctet2)
  }
  // Hub (0, 1) is reserved.
  taken.add(0 * 256 + 1)

  for (let o1 = 0; o1 <= 255; o1++) {
    for (let o2 = 1; o2 <= 254; o2++) {
      if (!taken.has(o1 * 256 + o2)) {
        return { octet1: o1, octet2: o2 }
      }
    }
  }

  throw new VpnPoolExhaustedError()
}

/** Format `(octet1, octet2)` as an overlay address with /32 prefix. */
export function formatOverlayAddress(octet: AllocatedOctet, prefix: '/32' | '' = ''): string {
  return `10.200.${octet.octet1}.${octet.octet2}${prefix}`
}
