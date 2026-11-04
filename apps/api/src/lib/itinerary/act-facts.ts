// ---------------------------------------------------------------------------
// Driver itinerary — act facts: a driver's own ETA and "done" for one act.
//
// Kept in Pegasus Postgres and NEVER written to legacy (Steve, 2026-11-02 /
// 2026-11-03): a local job's `is_final` completes every act on the job, an
// activity's `actual_date` feeds the trip settlement and finalize guard, and
// the dispatcher's local ETA is the one legacy emails the customer. An
// activity's ETA is the exception — it already has a legacy editor
// (`PATCH /driver/activities/:id/eta`), so it is not a fact here.
//
// Facts are ATTACHED to items (`assertion`), never overlaid on the legacy
// dates: the itinerary's SQL filters on legacy dates, so moving `day` to an
// ETA in another week would drop the act from both weeks.
//
// Rows are append-only. The current value per (itemKey, basis) is the newest
// row; a row with a null `day` clears.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { ItineraryAssertion, ItineraryItem } from './types'

export type FactBasis = 'ETA' | 'DONE'

export interface RecordFactInput {
  tenantId: string
  item: ItineraryItem
  basis: FactBasis
  /** `YYYY-MM-DD`, or null to clear. */
  day: string | null
  /** ETA only; both or neither. */
  window: { start: string; end: string } | null
  userId: string | null
  capturedBy: string
}

type FactRow = {
  itemKey: string
  basis: string
  day: Date | null
  windowStart: string | null
  windowEnd: string | null
  assertedById: string | null
  assertedAt: Date
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** The assertion for one item from its rows, newest first; null when nothing is current. */
export function assertionFrom(rows: readonly FactRow[]): ItineraryAssertion | null {
  const eta = rows.find((r) => r.basis === 'ETA')
  const done = rows.find((r) => r.basis === 'DONE')
  const current = [eta, done].filter((r): r is FactRow => r !== undefined && r.day !== null)
  if (current.length === 0) return null
  const newest = current.reduce((a, b) => (b.assertedAt > a.assertedAt ? b : a))
  return {
    eta:
      eta && eta.day
        ? {
            day: isoDay(eta.day),
            window:
              eta.windowStart && eta.windowEnd
                ? { start: eta.windowStart, end: eta.windowEnd }
                : null,
          }
        : null,
    done: done && done.day ? isoDay(done.day) : null,
    assertedAt: newest.assertedAt.toISOString(),
    byUserId: newest.assertedById,
  }
}

/**
 * `items` with each one's current assertion attached. `db` is the
 * tenant-scoped client, so only the caller's tenant's facts are read.
 */
export async function attachAssertions(
  db: PrismaClient,
  items: ItineraryItem[],
): Promise<ItineraryItem[]> {
  if (items.length === 0) return items
  const rows: FactRow[] = await db.itineraryActFact.findMany({
    where: { itemKey: { in: [...new Set(items.map((i) => i.key))] } },
    orderBy: { assertedAt: 'desc' },
    select: {
      itemKey: true,
      basis: true,
      day: true,
      windowStart: true,
      windowEnd: true,
      assertedById: true,
      assertedAt: true,
    },
  })
  const byKey = new Map<string, FactRow[]>()
  for (const r of rows) {
    const list = byKey.get(r.itemKey)
    if (list) list.push(r)
    else byKey.set(r.itemKey, [r])
  }
  return items.map((i) => ({ ...i, assertion: assertionFrom(byKey.get(i.key) ?? []) }))
}

/** Append one fact for an item the caller has already been shown to own. */
export async function recordFact(db: PrismaClient, input: RecordFactInput): Promise<void> {
  const { item } = input
  await db.itineraryActFact.create({
    data: {
      tenantId: input.tenantId,
      itemKey: item.key,
      sourceKind: item.source.kind,
      orderNum: item.orderNum,
      actCode: item.actCode,
      basis: input.basis,
      day: input.day === null ? null : new Date(`${input.day}T00:00:00.000Z`),
      windowStart: input.window?.start ?? null,
      windowEnd: input.window?.end ?? null,
      assertedById: input.userId,
      capturedBy: input.capturedBy,
    },
  })
}
