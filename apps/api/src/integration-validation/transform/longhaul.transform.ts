// ---------------------------------------------------------------------------
// Longhaul: legacy trip DTO → CanonicalOrder mapping, authored in the
// OUTPUT-SHAPED mapping format (see mapping-format.ts). This is the worked
// reference for the format — a new integration (e.g. weichert) is authored the
// same way. The document is COMPILED to the engine's TransformSpec by the
// registry; the validator itself is unchanged.
//
// Source shape is the same trip DTO the cloud save path consumes. Fallback chains
// mirror the guards' own `??` reads (status from `TripStatus_id` or the nested
// `status.status_id`; driver from `driver.id` or the flat `driver_id`).
// ---------------------------------------------------------------------------

import type { MappingTemplate } from './mapping-format'

export const longhaulMapping: MappingTemplate = {
  id: { $from: 'id', coerce: 'toNumberOrNull', default: null },
  status: {
    id: { $from: ['TripStatus_id', 'status.status_id'], coerce: 'toNumber', default: 1 },
    name: { $from: 'status.status', default: null },
  },
  driver: {
    id: { $from: ['driver.id', 'driver_id'], coerce: 'toNumberOrNull', default: null },
  },
  dispatcher: {
    // Dispatcher code is an identifier the legacy DTO carries as string or number;
    // coerce to a stable string so the canonical type is fixed.
    code: { $from: ['dispatcher.code', 'dispatcher_id'], coerce: 'toString', default: null },
  },
  shipments: {
    $from: 'shipments',
    default: [],
    $each: { orderNum: { $from: 'order_num', coerce: 'toNumberOrNull', default: null } },
  },
  activities: {
    $from: 'activities',
    default: [],
    $each: {
      orderNum: { $from: 'order_num', coerce: 'toNumberOrNull', default: null },
      typeCode: { $from: ['ActivityType_code', 'activityType.code'], default: null },
      actualDate: { $from: 'actual_date', default: null },
    },
  },
}

/**
 * Top-level keys the legacy longhaul DTO is allowed to provide. Used by the
 * mapping static checker to flag a `$from` that reads a field the input never
 * sends (a typo guard). The legacy trip DTO is otherwise loose/passthrough.
 */
export const longhaulInputFieldRoots = [
  'id',
  'TripStatus_id',
  'status',
  'driver',
  'driver_id',
  'dispatcher',
  'dispatcher_id',
  'shipments',
  'activities',
]
