// ---------------------------------------------------------------------------
// Which local driver to PRE-SELECT when an admin maps a login's local driver.
//
// At some tenants a person's longhaul driver number and local crew number are
// the same; at others the same number names two different people. So we only
// suggest — never set — and only when the number matches AND the names agree.
// The admin still confirms with Save; the system never infers the mapping.
// ---------------------------------------------------------------------------

import type { LocalDriver } from '@/api/queries/local-drivers'
import type { LonghaulDriver } from '@/api/queries/longhaul-drivers'

/** Letter-only uppercase words of a name ("Tunyla Jr, Edward M" → TUNYLA JR EDWARD M). */
function words(name: string): string[] {
  return name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
}

/**
 * True when every word of the local record's surname (the text before the
 * comma) appears in the longhaul driver's name. Tolerates suffixes and the
 * different "LAST, FIRST" layouts the two tables use.
 */
export function namesAgree(localName: string, longhaulName: string): boolean {
  const surname = words(localName.split(',')[0] ?? '').filter((w) => w.length > 1)
  if (surname.length === 0) return false
  const other = new Set(words(longhaulName))
  return surname.every((w) => other.has(w))
}

export function suggestLocalDriverId(
  user: { longhaulDriverId: number | null; localDriverEmployeeId: number | null },
  longhaulDrivers: readonly LonghaulDriver[],
  localDrivers: readonly LocalDriver[],
): number | null {
  if (user.localDriverEmployeeId != null || user.longhaulDriverId == null) return null
  const longhaul = longhaulDrivers.find((d) => d.driver_id === user.longhaulDriverId)
  const local = localDrivers.find((d) => d.employeeId === user.longhaulDriverId)
  if (!longhaul || !local) return null
  return namesAgree(local.name, longhaul.driver_name) ? local.employeeId : null
}
