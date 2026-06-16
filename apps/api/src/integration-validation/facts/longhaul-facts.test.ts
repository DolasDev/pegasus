import { describe, it, expect } from 'vitest'
import { deriveLonghaulFacts } from './longhaul-facts'
import type { CanonicalContext } from '../types'
import type { CanonicalOrder } from '../canonical-order'

const order = (o: Partial<CanonicalOrder>): CanonicalOrder => ({
  id: null,
  status: { id: 1, name: null },
  driver: null,
  dispatcher: null,
  shipments: [],
  activities: [],
  ...o,
})

const ctx = (c: Partial<CanonicalContext>): CanonicalContext => ({
  order: order({}),
  prior: null,
  action: 'save',
  ...c,
})

describe('deriveLonghaulFacts', () => {
  it('derives neutral scalar facts from the proposed order', () => {
    const facts = deriveLonghaulFacts(
      ctx({
        order: order({
          status: { id: 4, name: 'In Progress' },
          driver: { id: 7 },
          shipments: [{ orderNum: 1 }, { orderNum: 2 }],
          activities: [
            { orderNum: 1, typeCode: 'LOAD', actualDate: '2026-01-01' },
            { orderNum: 1, typeCode: 'DELIVER', actualDate: null },
          ],
        }),
      }),
    )
    expect(facts).toMatchObject({
      statusId: 4,
      driverAssigned: true,
      shipmentCount: 2,
      activitiesMissingActualDate: 1,
      priorExists: false,
      action: 'save',
    })
  })

  it('detects a driver change against prior state', () => {
    const facts = deriveLonghaulFacts(
      ctx({
        order: order({ driver: { id: 99 } }),
        prior: order({ driver: { id: 7 } }),
      }),
    )
    expect(facts.priorExists).toBe(true)
    expect(facts.driverChanged).toBe(true)
  })

  it('counts removed activities that had an actual date', () => {
    const facts = deriveLonghaulFacts(
      ctx({
        order: order({ activities: [] }),
        prior: order({
          activities: [
            { orderNum: 1, typeCode: 'LOAD', actualDate: '2026-01-01' },
            { orderNum: 1, typeCode: 'DELIVER', actualDate: null },
          ],
        }),
      }),
    )
    // Only the actualized one counts; the null-date removal is allowed.
    expect(facts.removedActivitiesWithActualDate).toBe(1)
  })

  it('does not count a retained activity as removed', () => {
    const a = { orderNum: 1, typeCode: 'LOAD', actualDate: '2026-01-01' }
    const facts = deriveLonghaulFacts(
      ctx({ order: order({ activities: [a] }), prior: order({ activities: [a] }) }),
    )
    expect(facts.removedActivitiesWithActualDate).toBe(0)
  })
})
