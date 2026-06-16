// ---------------------------------------------------------------------------
// Longhaul: legacy trip DTO → CanonicalOrder mapping (DATA).
//
// Source shape is the same trip DTO the cloud save path consumes
// (handlers/longhaul-cloud/trip-save.ts → computeTripSavePlan), which itself
// mirrors the legacy saveTripLogic input — so this transform is exactly the
// inbound translation the WinForms caller (and tenant-web) would feed in.
//
// Fallback chains mirror the guards' own `?? ` reads, e.g. status comes from
// `TripStatus_id` or the nested `status.status_id`; driver from `driver.id` or
// the flat `driver_id`.
// ---------------------------------------------------------------------------

import type { TransformSpec } from './engine'

export const longhaulTransform: TransformSpec = [
  { to: 'id', from: ['id'], default: null, coerce: 'toNumberOrNull' },
  { to: 'status.id', from: ['TripStatus_id', 'status.status_id'], default: 1, coerce: 'toNumber' },
  { to: 'status.name', from: ['status.status'], default: null },
  { to: 'driver.id', from: ['driver.id', 'driver_id'], default: null, coerce: 'toNumberOrNull' },
  // Dispatcher code is an identifier that the legacy DTO carries as either a
  // string or a number; coerce to a stable string so the canonical type is fixed.
  {
    to: 'dispatcher.code',
    from: ['dispatcher.code', 'dispatcher_id'],
    default: null,
    coerce: 'toString',
  },
  {
    to: 'shipments',
    from: ['shipments'],
    default: [],
    each: [{ to: 'orderNum', from: ['order_num'], default: null, coerce: 'toNumberOrNull' }],
  },
  {
    to: 'activities',
    from: ['activities'],
    default: [],
    each: [
      { to: 'orderNum', from: ['order_num'], default: null, coerce: 'toNumberOrNull' },
      { to: 'typeCode', from: ['ActivityType_code', 'activityType.code'], default: null },
      { to: 'actualDate', from: ['actual_date'], default: null },
    ],
  },
]
