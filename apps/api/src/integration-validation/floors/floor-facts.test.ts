// ---------------------------------------------------------------------------
// Unit tests for the generic inbound floors' fact derivation + projection keys.
// deriveFacts is a pure function over the canonical entity; the projection key
// derives the 0026 landing-zone natural key. Both branch on presence, so they are
// covered directly here (cheap, no gate/DB) rather than only through the gate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  deriveShipmentLifecycleEventFacts,
  shipmentLifecycleEventFloor,
} from './shipment-lifecycle-event.floor'
import { deriveSalesLeadFacts, salesLeadFloor } from './sales-lead.floor'
import {
  deriveFinancialSettlementFacts,
  financialSettlementFloor,
} from './financial-settlement.floor'
import { deriveDocumentRecordFacts, documentRecordFloor } from './document-record.floor'
import { listFloorIds, getFloor } from '../registry'
import type { CanonicalContext } from '../types'

const ctx = <T>(order: T): CanonicalContext<T> => ({ order, prior: null, action: 'save' })

describe('every floor documents its facts, and only its facts', () => {
  // factDocs is what an author reads to choose between similarly-named facts, so
  // a doc for a fact that no longer exists — or a fact that gained no doc — is a
  // silent hole in the authoring contract. Both directions are pinned here.
  for (const id of listFloorIds()) {
    it(`${id}: factDocs covers exactly the fact catalog`, () => {
      const floor = getFloor(id)!
      expect(floor.factDocs, `floor "${id}" declares no factDocs`).toBeDefined()
      expect(Object.keys(floor.factDocs!).sort()).toEqual(Object.keys(floor.factCatalog).sort())
      for (const [fact, doc] of Object.entries(floor.factDocs!)) {
        expect(doc.trim().length, `fact "${fact}" has an empty doc`).toBeGreaterThan(0)
      }
    })
  }
})

describe('shipment_lifecycle_event facts + key', () => {
  it('derives presence + upper-cased raw values from a full entity', () => {
    const facts = deriveShipmentLifecycleEventFacts(
      ctx({
        Id: '111422',
        Reference: { Brand: 'avl' },
        Lifecycle: { Status: 'loaded' },
        Dates: { Delivery: { Actual: '2018-05-09' } },
      } as never),
    )
    expect(facts).toEqual({
      idPresent: true,
      brand: 'AVL',
      brandPresent: true,
      status: 'LOADED',
      statusPresent: true,
      deliveryDatePresent: true,
    })
  })

  it('treats absent sections/fields as not-present, empty raw values', () => {
    const facts = deriveShipmentLifecycleEventFacts(ctx({} as never))
    expect(facts).toEqual({
      idPresent: false,
      brand: '',
      brandPresent: false,
      status: '',
      statusPresent: false,
      deliveryDatePresent: false,
    })
  })

  it('projection key is {Brand}:{Number}:{Year}, null when the number is missing', () => {
    const key = shipmentLifecycleEventFloor.projection!.key
    expect(key({ Reference: { Brand: 'AVL', Number: '111422', Year: '2014' } })).toBe(
      'AVL:111422:2014',
    )
    expect(key({ Reference: { Number: '111422' } })).toBe('?:111422:?')
    expect(key({ Reference: {} })).toBeNull()
    expect(key({})).toBeNull()
  })
})

describe('sales_lead facts + key', () => {
  it('derives status + phone-type presence', () => {
    expect(
      deriveSalesLeadFacts(
        ctx({ Id: 'L-1', Status: 'New', Contact: { PrimaryPhoneType: 'Cell' } } as never),
      ),
    ).toEqual({
      idPresent: true,
      status: 'New',
      statusPresent: true,
      primaryPhoneType: 'Cell',
      primaryPhoneTypePresent: true,
    })
    expect(deriveSalesLeadFacts(ctx({} as never))).toEqual({
      idPresent: false,
      status: '',
      statusPresent: false,
      primaryPhoneType: '',
      primaryPhoneTypePresent: false,
    })
  })

  it('projection key prefers OpportunityId, then LeadId, else null', () => {
    const key = salesLeadFloor.projection!.key
    expect(key({ Reference: { OpportunityId: 'O-9', LeadId: 'L-1' } })).toBe('O-9')
    expect(key({ Reference: { LeadId: 'L-1' } })).toBe('L-1')
    expect(key({ Reference: {} })).toBeNull()
  })
})

describe('financial_settlement facts + key', () => {
  it('derives id/party presence + brand', () => {
    expect(
      deriveFinancialSettlementFacts(
        ctx({ Id: '456721', Reference: { PartyId: '0008000', Brand: 'nvl' } } as never),
      ),
    ).toEqual({ idPresent: true, partyIdPresent: true, brand: 'NVL', brandPresent: true })
    expect(deriveFinancialSettlementFacts(ctx({} as never))).toEqual({
      idPresent: false,
      partyIdPresent: false,
      brand: '',
      brandPresent: false,
    })
  })

  it('projection key is {Id}:{PartyId}, null without an id', () => {
    const key = financialSettlementFloor.projection!.key
    expect(key({ Id: '456721', Reference: { PartyId: '0008000' } })).toBe('456721:0008000')
    expect(key({ Id: '456721', Reference: {} })).toBe('456721:?')
    expect(key({ Reference: { PartyId: '0008000' } })).toBeNull()
  })
})

describe('document_record facts + key', () => {
  it('derives id/format/brand presence, upper-casing format + brand', () => {
    expect(
      deriveDocumentRecordFacts(
        ctx({ Id: '939', Format: 'pdf', Reference: { Brand: 'avl' } } as never),
      ),
    ).toEqual({
      idPresent: true,
      format: 'PDF',
      formatPresent: true,
      brand: 'AVL',
      brandPresent: true,
    })
    expect(deriveDocumentRecordFacts(ctx({} as never))).toEqual({
      idPresent: false,
      format: '',
      formatPresent: false,
      brand: '',
      brandPresent: false,
    })
  })

  it('projection key is the document Id, null when absent', () => {
    const key = documentRecordFloor.projection!.key
    expect(key({ Id: '93953304' })).toBe('93953304')
    expect(key({ Id: '' })).toBeNull()
    expect(key({})).toBeNull()
  })
})
