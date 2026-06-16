// ---------------------------------------------------------------------------
// Longhaul behavioral rules — the SIX hardcoded guards, lifted into a decision
// table. Each rule's `sourceRef` points at the imperative guard it replaces, so
// parity is auditable (and the golden corpus proves it guard-for-guard).
//
// Note on R4: the imperative guard is a TRANSITION check (advancing past the
// CURRENT status without a driver). Expressed here as the equivalent STATE
// INVARIANT — "a non-pending trip must have a driver" — which is a pure function
// of the proposed order and the cleanest fit for save-time validation. This is a
// deliberate, documented semantic refinement (POC plan, Phase 2).
// ---------------------------------------------------------------------------

import type { RuleSet } from './types'

export const longhaulRules: RuleSet = [
  {
    id: 'trip-must-have-shipments',
    description: 'A trip must contain at least one shipment.',
    field: 'shipments',
    message: 'Trip must have shipments',
    sourceRef: 'handlers/longhaul-cloud/trip-save.ts:72',
    when: [{ fact: 'shipmentCount', op: 'lt', value: 1 }],
  },
  {
    id: 'no-driver-change-in-progress',
    description: 'The driver cannot be changed once a trip is in progress (status ≥ 4).',
    field: 'driver',
    message: 'Cannot change driver on in-progress trip',
    sourceRef: 'lib/longhaul-trip-save.ts:132',
    when: [
      { fact: 'priorExists', op: 'eq', value: true },
      { fact: 'statusId', op: 'gte', value: 4 },
      { fact: 'driverChanged', op: 'eq', value: true },
    ],
  },
  {
    id: 'no-remove-activity-with-actual-date',
    description: 'Activities that already have an actual date cannot be removed from a trip.',
    field: 'activities',
    message: 'Cannot remove activities with actual dates from trip',
    sourceRef: 'lib/longhaul-trip-save.ts:174',
    when: [{ fact: 'removedActivitiesWithActualDate', op: 'gt', value: 0 }],
  },
  {
    id: 'no-advance-without-driver',
    description: 'A trip past pending status (> 1) must have a driver assigned.',
    field: 'driver',
    message: 'Advancing trip past pending status without an assigned driver is not allowed',
    sourceRef: 'handlers/longhaul-cloud/trips-write.ts:128',
    when: [
      { fact: 'statusId', op: 'gt', value: 1 },
      { fact: 'driverAssigned', op: 'eq', value: false },
    ],
  },
  {
    id: 'no-finalize-without-actual-dates',
    description: 'A trip cannot be finalized (status ≥ 5) until every activity has an actual date.',
    field: 'activities',
    message: 'Advancing trip to finalized is not allowed until all activities have actual dates',
    sourceRef: 'handlers/longhaul-cloud/trips-write.ts:138',
    when: [
      { fact: 'statusId', op: 'gte', value: 5 },
      { fact: 'activitiesMissingActualDate', op: 'gt', value: 0 },
    ],
  },
  {
    id: 'no-cancel-after-in-progress',
    description: 'A trip cannot be cancelled once it is in progress (status ≥ 4).',
    field: 'status',
    message: 'Cancelling trip after in-progress status is not allowed',
    sourceRef: 'handlers/longhaul-cloud/trips-write.ts:233',
    when: [
      { fact: 'action', op: 'eq', value: 'cancel' },
      { fact: 'statusId', op: 'gte', value: 4 },
    ],
  },
]
