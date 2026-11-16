// ---------------------------------------------------------------------------
// Driver To Do — the facts the @pegasus/domain task rules read, from the
// driver's itinerary (one legacy read), their act facts and the order
// documents (Postgres).
//
// FAIL CLOSED, the opposite of the itinerary screen: the itinerary shows its
// items even when the act facts can't be read, but here an unread fact must
// not look like a missing one, or every past act would ask to be marked done.
// A failed read is passed to the rules as `unknown` / `null` (they then
// produce nothing that depends on it) and reported in `unavailable`.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { DriverTaskRuleId, TaskAct, DriverTaskFacts } from '@pegasus/domain'
import { attachAssertions } from '../itinerary/act-facts'
import type { ItineraryItem } from '../itinerary/types'
import { logger } from '../logger'

/** Documents attach to a shipment as ('shipment', order_num) — mobile documentService. */
const SHIPMENT_ENTITY = 'shipment'

/** A Postgres read the rules depend on that failed. */
export type TaskFactSource = 'actFacts' | 'documents'

export function taskActFrom(item: ItineraryItem, factsRead: boolean): TaskAct {
  return {
    itemKey: item.key,
    source: item.source.kind,
    orderNum: item.orderNum,
    shipperName: item.shipperName,
    actCode: item.actCode,
    actName: item.actName,
    kind: item.kind,
    known: item.known,
    day: item.day,
    legacyDone: item.actual != null,
    assertedDone: factsRead ? (item.assertion?.done ?? null) : 'unknown',
  }
}

/** ACTIVE (uploaded, not deleted) document types per order. */
export async function documentTypesByOrder(
  db: PrismaClient,
  orderNums: readonly number[],
): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>()
  if (orderNums.length === 0) return out
  const rows = await db.document.findMany({
    where: {
      entityType: SHIPMENT_ENTITY,
      entityId: { in: [...new Set(orderNums)].map(String) },
      // upload-url reserves a PENDING_UPLOAD row before any bytes exist.
      status: 'ACTIVE',
      deletedAt: null,
    },
    select: { entityId: true, documentType: true },
  })
  for (const r of rows) {
    const n = Number(r.entityId)
    const set = out.get(n) ?? new Set<string>()
    set.add(r.documentType)
    out.set(n, set)
  }
  return out
}

/** `db` is the tenant-scoped client. */
export async function driverTaskFacts(
  db: PrismaClient,
  items: ItineraryItem[],
  today: string,
  enabledRules: ReadonlySet<DriverTaskRuleId>,
): Promise<{ facts: DriverTaskFacts; unavailable: TaskFactSource[] }> {
  const unavailable: TaskFactSource[] = []

  let withFacts = items
  let factsRead = true
  try {
    withFacts = await attachAssertions(db, items)
  } catch (err) {
    factsRead = false
    unavailable.push('actFacts')
    logger.warn('driver tasks: act facts unavailable', { error: String(err) })
  }

  let docs: Map<number, Set<string>> | null = null
  if (enabledRules.has('submit-bol') || enabledRules.has('submit-weight-ticket')) {
    try {
      docs = await documentTypesByOrder(
        db,
        items.map((i) => i.orderNum),
      )
    } catch (err) {
      unavailable.push('documents')
      logger.warn('driver tasks: documents unavailable', { error: String(err) })
    }
  }

  return {
    facts: {
      today,
      acts: withFacts.map((i) => taskActFrom(i, factsRead)),
      documentTypesByOrder: docs,
      enabledRules,
    },
    unavailable,
  }
}
