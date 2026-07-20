// ---------------------------------------------------------------------------
// pegII → OrderRecord mapper — the anti-corruption layer that translates a
// serialized PegiiOrderDto (legacy Sale shape) into the OrderRecord the
// SDK/runtime surface exposes (services/pegii-orders.ts).
//
// Along with pegii-order.dto.ts, this is the single point of change when the
// real pegII serialized contract firms up. It reads the REAL native keys the
// mapping engine already consumes (`Id`, `Survey.SerivceStatus`,
// `InvolvedParties.ShipperEmployer.Identity.Description`, `KeyMoveDates.*`) —
// earlier revisions read a guessed flat shape that never resolved, projecting an
// `id: "undefined"` stub as a 200 (sdk-feedback 0029).
//
// FAIL-LOUD: a payload with no real `Id` yields `null`, not a placeholder record.
// The gateway turns that null into a 404 so a caller can never mistake an
// unresolvable projection for a real order. See sdk-feedback 0029 acceptance:
// "a projection that resolves nothing but status/updatedAt should fail loudly,
// not succeed."
//
// pegII gaps still handled softly (a real Id is present, a secondary field is
// not):
//   - missing orderNumber    → derived "SO-<id>"
//   - unknown/absent status  → 'booked' (the safe default)
//   - missing customer name  → null
//   - missing timestamps     → epoch (new Date(0)), matching pegii-customer.mapper
// ---------------------------------------------------------------------------

import type { OrderRecord } from '../../services/pegii-orders'
import type { PegiiOrderDto } from './pegii-order.dto'

const EPOCH = new Date(0).toISOString()

/**
 * Narrow a free-form legacy sale status onto the OrderRecord union. Recognizes
 * the union values verbatim plus the common legacy MoveManager synonyms; any
 * unrecognized value falls back to 'booked'.
 */
function mapStatus(raw: string | null | undefined): OrderRecord['status'] {
  // Compact to lowercase alphanumerics so 'InProgress', 'in_progress', and
  // 'In Progress' all collapse to the same key.
  switch ((raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')) {
    case 'inprogress':
    case 'active':
    case 'packing':
    case 'intransit':
      return 'in_progress'
    case 'completed':
    case 'complete':
    case 'closed':
    case 'delivered':
      return 'completed'
    case 'booked':
    case 'open':
    case 'confirmed':
    default:
      return 'booked'
  }
}

/** Trim a possibly-null legacy string to a non-empty value, else undefined. */
function nonEmpty(raw: string | null | undefined): string | undefined {
  const trimmed = (raw ?? '').trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Map a serialized pegII order DTO onto the OrderRecord surface shape, or `null`
 * when the payload carries no resolvable `Id` (an empty/stub projection). A null
 * return is the honest "not a real order" signal the gateway maps to a 404 —
 * NEVER an `id: "undefined"` / `orderNumber: "SO-undefined"` record.
 */
export function mapPegiiOrderToRecord(dto: PegiiOrderDto): OrderRecord | null {
  const id = nonEmpty(dto.Id == null ? undefined : String(dto.Id))
  if (!id) return null

  const orderNumber =
    nonEmpty(dto.InvolvedParties?.ShipperEmployer?.Identity?.Description) ?? `SO-${id}`

  return {
    id,
    orderNumber,
    status: mapStatus(dto.Survey?.SerivceStatus),
    customerName: nonEmpty(dto.Survey?.ShipperName) ?? null,
    scheduledDate: dto.KeyMoveDates?.Survey?.Planned ?? null,
    packingActualDate: dto.KeyMoveDates?.Pack?.Actual ?? null,
    createdAt: dto.OrderDate ?? EPOCH,
    updatedAt: dto.ModifiedDate ?? EPOCH,
  }
}
