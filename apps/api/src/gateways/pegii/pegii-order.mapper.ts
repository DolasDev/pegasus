// ---------------------------------------------------------------------------
// pegII → OrderRecord mapper — the anti-corruption layer that translates a
// serialized PegiiOrderDto (legacy Sale shape) into the OrderRecord the
// SDK/runtime surface exposes (services/pegii-orders.ts).
//
// Along with pegii-order.dto.ts, this is the single point of change when the
// real pegII serialized contract firms up.
//
// pegII gaps handled here (until the real contract specifies them):
//   - missing orderNumber    → derived "SO-<id>" (mirrors the retired stub)
//   - unknown/absent status  → 'booked' (the safe default the stub used)
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

/** Map a serialized pegII order DTO onto the OrderRecord surface shape. */
export function mapPegiiOrderToRecord(dto: PegiiOrderDto): OrderRecord {
  const id = String(dto.SaleId)
  return {
    id,
    orderNumber: dto.OrderNumber ?? `SO-${id}`,
    status: mapStatus(dto.Status),
    customerName: dto.CustomerName ?? null,
    scheduledDate: dto.ScheduledDate ?? null,
    packingActualDate: dto.PackingActualDate ?? null,
    createdAt: dto.CreatedDate ?? EPOCH,
    updatedAt: dto.ModifiedDate ?? EPOCH,
  }
}
