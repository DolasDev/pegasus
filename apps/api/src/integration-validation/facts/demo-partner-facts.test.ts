// ---------------------------------------------------------------------------
// Unit tests for the shipment_status_update floor's fact derivation
// (sdk-feedback 0035). deriveDemoPartnerFacts is a pure function over the
// canonical order, so the milestone counts are covered directly here — cheap,
// no gate, no DB.
//
// The per-date facts exist so an overlay can decide WHICH dates make up a
// milestone (load-without-pack moves are real); the composite pack+load facts
// stay untouched so every already-published config keeps its meaning.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { deriveDemoPartnerFacts, demoPartnerFactCatalog } from './demo-partner-facts'
import { analyzeRuleSet } from '../static-check'
import { evaluateRules } from '../rules/engine'
import type { RuleSet } from '../rules/types'
import type { DemoPartnerOrder, DemoPartnerShipment } from '../canonical-demo-partner'
import type { CanonicalContext } from '../types'

interface Actuals {
  pack?: string
  load?: string
  delivery?: string
  /**
   * The `estimated` (planned) halves, added to the floor by sdk-feedback 0040.
   * Facts derive from the actuals ONLY, so setting these must never move a count.
   */
  planned?: { pack?: string; load?: string; delivery?: string; survey?: string }
}

const shipment = (id: string, { pack, load, delivery, planned }: Actuals): DemoPartnerShipment => ({
  supplierShipmentId: id,
  shipmentStatus: 'In Process',
  netWeight: { estimated: null, actual: null },
  ...(planned?.survey ? { surveyDate: { estimated: planned.survey, actual: null } } : {}),
  packDate1: { estimated: planned?.pack ?? null, actual: pack ?? null },
  loadDate1: { estimated: planned?.load ?? null, actual: load ?? null },
  deliveryDate1: { estimated: planned?.delivery ?? null, actual: delivery ?? null },
  surveyedStorageCostFirstDay: null,
  surveyedStorageCostAdditionalDays: null,
  surveyedStorageCostDeliveryOut: null,
  surveyedThirdPartyCrateAndUncrateCosts: null,
  surveyedThirdPartyCosts: null,
  surveyedThirdPartyOtherCosts: null,
  notIncludedComments: null,
  thirdPartyAndOtherCostsComments: null,
  comments: null,
})

const facts = (shipments: DemoPartnerShipment[], serviceStatus = 'In Progress') => {
  const order: DemoPartnerOrder = {
    serviceOrderNumber: 'O-1',
    supplierContactName: 'Cora',
    supplierContactEmail: 'cora@example.com',
    serviceStatus: serviceStatus as DemoPartnerOrder['serviceStatus'],
    contactMadeDate: '2026-01-02',
    surveyDate: '2026-01-03',
    shipments,
  }
  const ctx: CanonicalContext<DemoPartnerOrder> = { order, prior: null, action: 'save' }
  return deriveDemoPartnerFacts(ctx)
}

describe('deriveDemoPartnerFacts — per-date actuals counts', () => {
  it('counts a load-without-pack shipment under load, not pack (the 0035 case)', () => {
    const f = facts([shipment('S1', { load: '2026-02-01' })])

    expect(f['shipmentsWithLoadActual']).toBe(1)
    expect(f['shipmentsWithPackActual']).toBe(0)
    expect(f['shipmentsWithDeliveryActual']).toBe(0)
    // Back-compat: the composite fact still requires pack, so it stays 0.
    expect(f['shipmentsWithPackLoadActual']).toBe(0)
  })

  it('counts load + delivery on one shipment with no pack actual', () => {
    const f = facts([shipment('S1', { load: '2026-02-01', delivery: '2026-02-05' })], 'Delivered')

    expect(f['shipmentsWithLoadActual']).toBe(1)
    expect(f['shipmentsWithDeliveryActual']).toBe(1)
    expect(f['shipmentsWithLoadDeliveryActual']).toBe(1)
    expect(f['shipmentsWithPackLoadDeliveryActual']).toBe(0)
  })

  it('derives 0 for every milestone count on an order with no shipments', () => {
    const f = facts([])

    expect(f['shipmentsWithPackActual']).toBe(0)
    expect(f['shipmentsWithLoadActual']).toBe(0)
    expect(f['shipmentsWithDeliveryActual']).toBe(0)
    expect(f['shipmentsWithLoadDeliveryActual']).toBe(0)
    expect(f['shipmentsWithPackLoadActual']).toBe(0)
    expect(f['shipmentsWithPackLoadDeliveryActual']).toBe(0)
    expect(f['shipmentCount']).toBe(0)
  })

  it('separates decomposed from paired semantics across shipments', () => {
    // Load on one shipment, delivery on a DIFFERENT one: the per-date facts each
    // see a hit, but no single shipment reached both milestones — so the paired
    // fact is 0. A rule that must not accept that split points at the pair.
    const f = facts([
      shipment('S1', { load: '2026-02-01' }),
      shipment('S2', { delivery: '2026-02-05' }),
    ])

    expect(f['shipmentsWithLoadActual']).toBe(1)
    expect(f['shipmentsWithDeliveryActual']).toBe(1)
    expect(f['shipmentsWithLoadDeliveryActual']).toBe(0)
  })

  it('treats an empty-string actual as absent, like the composite facts do', () => {
    const f = facts([shipment('S1', { pack: '', load: '', delivery: '' })])

    expect(f['shipmentsWithPackActual']).toBe(0)
    expect(f['shipmentsWithLoadActual']).toBe(0)
    expect(f['shipmentsWithDeliveryActual']).toBe(0)
  })

  it('leaves the composite pack+load facts unchanged on a fully-dated shipment', () => {
    const f = facts([
      shipment('S1', { pack: '2026-01-30', load: '2026-02-01', delivery: '2026-02-05' }),
    ])

    expect(f['shipmentsWithPackActual']).toBe(1)
    expect(f['shipmentsWithLoadActual']).toBe(1)
    expect(f['shipmentsWithDeliveryActual']).toBe(1)
    expect(f['shipmentsWithLoadDeliveryActual']).toBe(1)
    expect(f['shipmentsWithPackLoadActual']).toBe(1)
    expect(f['shipmentsWithPackLoadDeliveryActual']).toBe(1)
  })

  // sdk-feedback 0040 — the estimated halves are new OUTPUT fields, deliberately
  // fact-neutral: a planned date is not a milestone reached, so the counts (which
  // gate real production writes) must not budge.
  it('counts a planned-but-not-actual shipment as having NO actuals', () => {
    const f = facts([
      shipment('S1', {
        planned: {
          pack: '2026-07-16',
          load: '2026-07-17',
          delivery: '2026-07-18',
          survey: '2026-07-09',
        },
      }),
    ])

    expect(f['shipmentsWithPackActual']).toBe(0)
    expect(f['shipmentsWithLoadActual']).toBe(0)
    expect(f['shipmentsWithDeliveryActual']).toBe(0)
    expect(f['shipmentsWithLoadDeliveryActual']).toBe(0)
    expect(f['shipmentsWithPackLoadActual']).toBe(0)
    expect(f['shipmentsWithPackLoadDeliveryActual']).toBe(0)
  })

  it('derives identical facts with and without the estimated halves populated', () => {
    const actuals = { pack: '2026-01-30', load: '2026-02-01', delivery: '2026-02-05' }
    const withoutPlanned = facts([shipment('S1', actuals)])
    const withPlanned = facts([
      shipment('S1', {
        ...actuals,
        planned: { pack: '2026-01-29', load: '2026-01-31', delivery: '2026-02-04' },
      }),
    ])

    expect(withPlanned).toEqual(withoutPlanned)
  })

  it('adds no new facts to the catalog for the estimated halves', () => {
    // If an estimated-bearing fact is ever wanted it must be a separate, additive
    // catalog entry — not a redefinition of these.
    expect(Object.keys(demoPartnerFactCatalog)).not.toContain('shipmentsWithPackEstimated')
  })

  it('declares every derived fact in the catalog with a matching type', () => {
    // A fact derived but undeclared is invisible to rule authors; a fact
    // declared but underived resolves undefined at evaluation time. The gate
    // rejects rules pointing at either, so pin both directions.
    const f = facts([shipment('S1', { load: '2026-02-01' })])

    expect(Object.keys(f).sort()).toEqual(Object.keys(demoPartnerFactCatalog).sort())
    for (const [name, type] of Object.entries(demoPartnerFactCatalog)) {
      expect(typeof f[name], `fact "${name}"`).toBe(type)
    }
  })
})

describe('load-only milestone rules an overlay can now author (sdk-feedback 0035)', () => {
  // The rules a partner with load-without-pack moves wants. Authoring them was
  // what produced `unknown fact "shipmentsWithLoadActual"` from the gate.
  const loadOnlyRules: RuleSet = [
    {
      id: 'in-progress-requires-load-actual',
      description: 'Advancing to In Progress requires a Load Date 1 Actual.',
      field: 'shipments',
      message: 'Please update Load Date 1 Actual for at least one of the related Shipment Orders.',
      when: [
        { fact: 'serviceStatus', op: 'eq', value: 'In Progress' },
        { fact: 'shipmentsWithLoadActual', op: 'lte', value: 0 },
      ],
    },
    {
      id: 'delivered-requires-load-delivery-actuals',
      description: 'Advancing to Delivered or Completed requires Load + Delivery Date 1 Actual.',
      field: 'shipments',
      message:
        'Please update Load Date 1 Actual and Delivery Date 1 Actual on the related Shipment Orders.',
      when: [
        { fact: 'serviceStatus', op: 'in', value: ['Delivered', 'Completed'] },
        { fact: 'shipmentsWithLoadDeliveryActual', op: 'lte', value: 0 },
      ],
    },
  ]

  it('passes the static check against the floor catalog', () => {
    expect(analyzeRuleSet(loadOnlyRules, demoPartnerFactCatalog)).toEqual([])
  })

  it('accepts In Progress with a load actual and no pack actual', () => {
    const f = facts([shipment('S1', { load: '2026-02-01' })], 'In Progress')
    expect(evaluateRules(loadOnlyRules, f)).toEqual([])
  })

  it('still rejects In Progress with no load actual', () => {
    const f = facts([shipment('S1', { pack: '2026-01-30' })], 'In Progress')
    expect(evaluateRules(loadOnlyRules, f).map((i) => i.ruleId)).toEqual([
      'in-progress-requires-load-actual',
    ])
  })

  it('accepts Delivered with load + delivery actuals and no pack actual', () => {
    const f = facts([shipment('S1', { load: '2026-02-01', delivery: '2026-02-05' })], 'Delivered')
    expect(evaluateRules(loadOnlyRules, f)).toEqual([])
  })

  // sdk-feedback 0040: these are the two live Weichert rules. A shipment whose
  // dates are all PLANNED must still be blocked — otherwise mapping the estimated
  // halves would silently widen what the partner accepts as "delivered".
  it('still blocks In Progress / Delivered when only the estimated dates are set', () => {
    const planned = { pack: '2026-07-16', load: '2026-07-17', delivery: '2026-07-18' }

    expect(
      evaluateRules(loadOnlyRules, facts([shipment('S1', { planned })], 'In Progress')).map(
        (i) => i.ruleId,
      ),
    ).toEqual(['in-progress-requires-load-actual'])

    expect(
      evaluateRules(loadOnlyRules, facts([shipment('S1', { planned })], 'Delivered')).map(
        (i) => i.ruleId,
      ),
    ).toEqual(['delivered-requires-load-delivery-actuals'])
  })
})
