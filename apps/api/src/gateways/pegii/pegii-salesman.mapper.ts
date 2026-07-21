// ---------------------------------------------------------------------------
// pegII → SalesmanRecord mapper — the anti-corruption layer that translates a
// serialized PegiiSalesmanDto (the unwrapped inner object from the pegII
// serialized salesman endpoint) into the SalesmanRecord the SDK/runtime surface
// exposes (services/pegii-salesmen.ts).
//
// Along with pegii-salesman.dto.ts, this is the single point of change if the
// pegII serialized contract shifts.
//
// pegII gaps handled here:
//   - name is not sent as one field → composed from firstName + lastName
//   - missing name entirely         → falls back to the id (the salesman code)
//   - free-form active flag         → coerced to a boolean (default true)
//   - every other absent field      → null
// ---------------------------------------------------------------------------

import type { SalesmanRecord } from '../../services/pegii-salesmen'
import type { PegiiSalesmanDto } from './pegii-salesman.dto'

/**
 * Coerce a free-form legacy active flag onto a boolean. The sampled wire sends a
 * real boolean, but real booleans, "Y"/"N", "true"/"false", and 1/0 are all
 * recognized; an absent value defaults to active (true) — a record the source
 * still returns is assumed active unless it says otherwise.
 */
function mapActive(raw: boolean | string | number | null | undefined): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (raw == null) return true
  switch (raw.trim().toLowerCase()) {
    case 'n':
    case 'no':
    case 'false':
    case '0':
    case 'inactive':
      return false
    default:
      return true
  }
}

/** Compose a display name from the name parts pegII supplied. */
function mapName(dto: PegiiSalesmanDto, fallback: string): string {
  const composed = [dto.firstName, dto.lastName]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return composed || fallback
}

/** Map a serialized pegII salesman DTO onto the SalesmanRecord surface shape. */
export function mapPegiiSalesmanToRecord(dto: PegiiSalesmanDto): SalesmanRecord {
  const id = String(dto.code)
  return {
    id,
    avlCode: dto.avlCode ?? null,
    firstName: dto.firstName ?? null,
    lastName: dto.lastName ?? null,
    name: mapName(dto, id),
    title: dto.title ?? null,
    email: dto.email ?? null,
    extension: dto.extension ?? null,
    branch: dto.branch ?? null,
    agencyCode: dto.agencyCode ?? null,
    roles: dto.roles ?? null,
    employeeType: dto.employeeType ?? null,
    active: mapActive(dto.isActive),
    startDate: dto.startDate ?? null,
    dateTerminated: dto.dateTerminated ?? null,
  }
}
