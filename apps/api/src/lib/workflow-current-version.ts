// ---------------------------------------------------------------------------
// Which workflow rows are "current" for a tenant
//
// Every upload of (name, version) is its own row, and a tenant sees its own
// rows plus every GLOBAL one — so a curated workflow republished six times
// arrives as six rows, each declaring the secret/config keys IT read. Summing
// requirements across all of them reports keys a long-superseded version
// needed (weichert-milestone-update v0.4.0 still declaring SEND_* in `global`
// long after v0.5.0 dropped them). A row is current when it is:
//
//   - the newest version (semver, upload time breaking ties) of its
//     (owning tenant, name) — a tenant's fork and the GLOBAL original are
//     separate workflows; or
//   - the target of one of the caller's ENABLED triggers — a trigger pinned to
//     an older version still runs it, so that version's keys still matter.
// ---------------------------------------------------------------------------

import { compareSemver } from '@pegasus/domain'

type VersionRow = {
  id: string
  tenantId: string
  name: string
  version: string
  createdAt: Date
}

/** Ids of the rows that are current — see the module header. */
export function currentWorkflowIds(
  rows: VersionRow[],
  triggeredWorkflowIds: Iterable<string>,
): Set<string> {
  const newest = new Map<string, VersionRow>()
  for (const row of rows) {
    // JSON pair: no (tenantId, name) combination can collide.
    const key = JSON.stringify([row.tenantId, row.name])
    const best = newest.get(key)
    if (!best || isNewer(row, best)) newest.set(key, row)
  }
  const current = new Set([...newest.values()].map((r) => r.id))
  const visible = new Set(rows.map((r) => r.id))
  for (const id of triggeredWorkflowIds) if (visible.has(id)) current.add(id)
  return current
}

function isNewer(a: VersionRow, b: VersionRow): boolean {
  const bySemver = compareSemver(a.version, b.version)
  if (bySemver !== 0) return bySemver > 0
  return a.createdAt.getTime() > b.createdAt.getTime()
}
