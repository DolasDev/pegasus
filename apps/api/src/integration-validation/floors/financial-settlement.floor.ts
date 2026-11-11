// ---------------------------------------------------------------------------
// financial_settlement — a per-TYPE integration floor (sdk-feedback 0024) for a
// financial SETTLEMENT / compensation statement: a subject (a shipment) with a
// paying/paid party, credit/debit/net totals, and line items. PARTNER-NEUTRAL —
// any settlement / agent-compensation feed (Sirva ADE Agent Compensation is the
// first) builds on this floor. Exposes only GENERIC facts; partner value sets
// live in the overlay rules via `nin`.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { CanonicalContext, TypeFloor } from '../types'
import type { Facts, FactCatalog } from '../rules/types'

export const FINANCIAL_SETTLEMENT_FLOOR = 'financial_settlement'

const optStr = z.string().nullish()
const optNum = z.number().nullish()

const LineItemSchema = z.object({
  Code: optStr,
  Description: optStr,
  Credit: optNum,
  Debit: optNum,
  Driver1: optStr,
  Driver2: optStr,
  Group: optStr,
})

// Every section is optional: a partner-neutral floor accepts a config that maps
// only the fields it cares about.
export const FinancialSettlementSchema = z.object({
  Id: optStr,
  Reference: z.object({ Brand: optStr, PartyId: optStr }).nullish(),
  Totals: z.object({ Credit: optNum, Debit: optNum, Net: optNum }).nullish(),
  Subject: z
    .object({
      ShipperFirstName: optStr,
      ShipperLastName: optStr,
      OriginCity: optStr,
      OriginState: optStr,
      DestinationCity: optStr,
      DestinationState: optStr,
      BilledWeight: optNum,
      BilledMileage: optNum,
      ActualLoadDate: optStr,
      ActualDeliveryDate: optStr,
      AgreementReference: optStr,
      TransactionDateTime: optStr,
    })
    .nullish(),
  LineItems: z.array(LineItemSchema).nullish(),
})

export type FinancialSettlement = z.infer<typeof FinancialSettlementSchema>

const has = (v: string | null | undefined): boolean => v != null && v !== ''

export const financialSettlementFactCatalog: FactCatalog = {
  idPresent: 'boolean',
  partyIdPresent: 'boolean',
  brand: 'string',
  brandPresent: 'boolean',
}

export const financialSettlementFactDocs: Record<string, string> = {
  idPresent: 'True when the settlement carries an id.',
  partyIdPresent: 'True when the settlement names a party id (who is being settled with).',
  brand:
    'The reference brand code, UPPER-CASED; empty string when absent. Compare with `in`/`nin` to enforce your own brand vocabulary.',
  brandPresent: 'True when a reference brand code is present.',
}

export function deriveFinancialSettlementFacts(ctx: CanonicalContext<FinancialSettlement>): Facts {
  const { order } = ctx
  const brand = order.Reference?.Brand
  return {
    idPresent: has(order.Id),
    partyIdPresent: has(order.Reference?.PartyId),
    brand: has(brand) ? String(brand).toUpperCase() : '',
    brandPresent: has(brand),
  }
}

export const financialSettlementFloor: TypeFloor = {
  floor: FINANCIAL_SETTLEMENT_FLOOR,
  structuralContract: FinancialSettlementSchema,
  deriveFacts: deriveFinancialSettlementFacts,
  factCatalog: financialSettlementFactCatalog,
  factDocs: financialSettlementFactDocs,
  defaultAction: 'save',
  // Natural key {Id}:{PartyId} (0026).
  // A settlement is always ABOUT one move (the Subject block is its
  // shipper/origin/destination/weight), so a settlement record binds to exactly
  // one Pegasus entity. Note the canonical shape carries no Pegasus id — see
  // IntegrationCorrelationBinding for why the id is supplied rather than derived.
  //
  // WHY 'order' AND NOT 'shipment'. There is no Pegasus "shipment id" a caller
  // could supply: moves live in pegII and are addressed by ORDER NUMBER
  // (services/pegii-orders.ts, /api/v1/pegii/orders/{orderNumber}; `grep
  // orderNumber prisma/schema.prisma` returns nothing). `shipment_status_update`
  // already declares 'order' for exactly this identifier (#812), so 'shipment'
  // here named a kind the caller cannot produce and disagreed with the only
  // other floor that declares a correlation.
  //
  // Safe to change because this is a free string validated only against this
  // declaration — and because it was measured, not assumed: on 2026-11-10 a
  // read-only audit of prod AND staging found ZERO correlation rows at all
  // (prod also had zero projections), against databases holding 19 and 3
  // tenants respectively. So no stored row is orphaned by the rename and no
  // data migration is needed.
  correlation: {
    localEntityType: 'order',
  },
  // The one capability needed to ship the pilot (Gap B). Deliberately NOT
  // joined by `documents`/`status`/`estimates`: with a single example there is
  // nothing to check a naming scheme against, and a name guessed now is a name
  // we would be stuck matching later. Name the second capability when a second
  // domain is real — that is the first moment the decision is informed.
  capabilities: ['settlements'],
  projection: {
    entityType: 'settlement',
    key: (o) => {
      const id = typeof o?.Id === 'string' && o.Id !== '' ? o.Id : null
      const ref = (o?.Reference ?? {}) as Record<string, unknown>
      const party = typeof ref['PartyId'] === 'string' ? ref['PartyId'] : '?'
      return id ? `${id}:${party}` : null
    },
  },
}
