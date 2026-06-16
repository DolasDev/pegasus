// ---------------------------------------------------------------------------
// Longhaul fact derivation: CanonicalContext → neutral scalar facts.
//
// Derivation computes NEUTRAL, reusable facts (counts, booleans, the status
// number). The decision table then COMPOSES them into rules with thresholds, so
// the business logic lives in the declarative table — not buried here. Quantifier
// work that a flat predicate can't express (diffing prior vs proposed activities)
// is reduced to a count here; the rule just tests `> 0`.
// ---------------------------------------------------------------------------

import type { CanonicalContext } from '../types'
import type { CanonicalActivity } from '../canonical-order'
import type { Facts, FactCatalog } from '../rules/types'

/** Identity of an activity "slot" for diffing prior vs proposed (orderNum + type). */
function slotKey(a: CanonicalActivity): string {
  return `${a.orderNum ?? ''}::${a.typeCode ?? ''}`
}

export const longhaulFactCatalog: FactCatalog = {
  statusId: 'number',
  driverAssigned: 'boolean',
  shipmentCount: 'number',
  activitiesMissingActualDate: 'number',
  priorExists: 'boolean',
  driverChanged: 'boolean',
  removedActivitiesWithActualDate: 'number',
  action: 'string',
}

export function deriveLonghaulFacts(ctx: CanonicalContext): Facts {
  const { order, prior, action } = ctx

  const proposedSlots = new Set(order.activities.map(slotKey))
  const removedWithActualDate = (prior?.activities ?? []).filter(
    (a) => a.actualDate != null && !proposedSlots.has(slotKey(a)),
  ).length

  return {
    statusId: order.status.id,
    driverAssigned: order.driver?.id != null,
    shipmentCount: order.shipments.length,
    activitiesMissingActualDate: order.activities.filter((a) => a.actualDate == null).length,
    priorExists: prior != null,
    driverChanged: prior != null && (prior.driver?.id ?? null) !== (order.driver?.id ?? null),
    removedActivitiesWithActualDate: removedWithActualDate,
    action,
  }
}
