// ---------------------------------------------------------------------------
// shipment_lifecycle_event — a per-TYPE integration floor (sdk-feedback 0024) for
// a shipment / move OPERATIONAL EVENT: a shipment identified by a reference, with
// a lifecycle status, parties, origin/destination, key dates, measures, and
// assigned resources. PARTNER-NEUTRAL and reusable — any mover / logistics
// partner that pushes shipment lifecycle events (Sirva ADE is the first) builds
// on this floor and supplies its own native→canonical mapping + rules as a
// published config overlay.
//
// The floor exposes only GENERIC facts — presence booleans and raw field values.
// It bakes in NO partner-specific value sets: which brand codes or status strings
// are valid is the partner's business rule, authored in the overlay's rules.json
// (e.g. `{brandPresent eq true} AND {brand nin [AVL,NVL]}`, using the `nin`
// operator). So the same floor serves partners with different vocabularies.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { CanonicalContext, TypeFloor } from '../types'
import type { Facts, FactCatalog } from '../rules/types'

export const SHIPMENT_LIFECYCLE_EVENT_FLOOR = 'shipment_lifecycle_event'

const optStr = z.string().nullish()
const optNum = z.number().nullish()
const actual = z.object({ Actual: optStr })

const PartySchema = z.object({
  Identity: z.object({ FirstName: optStr, LastName: optStr }),
  PhoneNumber: optStr,
})
const PlaceSchema = z.object({
  City: optStr,
  State: optStr,
  PostalCode: optStr,
  Country: optStr,
})
const ResourceSchema = z.object({ Id: optStr, Name: optStr, Type: optStr, Owner: optStr })

// Every section is optional: a partner-neutral floor must accept a config that
// maps only the fields it cares about (an unmapped section is simply absent).
export const ShipmentLifecycleEventSchema = z.object({
  Id: optStr,
  Reference: z
    .object({ Brand: optStr, Number: optStr, Year: optStr, CarrierRef: optStr, TripId: optStr })
    .nullish(),
  Lifecycle: z
    .object({ EventType: optStr, EventId: optStr, EventDateTime: optStr, Status: optStr })
    .nullish(),
  Parties: z.object({ Shipper: PartySchema, Consignee: PartySchema }).nullish(),
  Addresses: z.object({ Origin: PlaceSchema, Destination: PlaceSchema }).nullish(),
  Dates: z.object({ Registration: actual, Load: actual, Delivery: actual }).nullish(),
  Measures: z
    .object({
      EstimatedWeight: optNum,
      ActualWeight: optNum,
      EstimatedVolume: optNum,
      ActualVolume: optNum,
    })
    .nullish(),
  Resources: z.array(ResourceSchema).nullish(),
})

export type ShipmentLifecycleEvent = z.infer<typeof ShipmentLifecycleEventSchema>

const has = (v: string | null | undefined): boolean => v != null && v !== ''

export const shipmentLifecycleEventFactCatalog: FactCatalog = {
  idPresent: 'boolean',
  brand: 'string',
  brandPresent: 'boolean',
  status: 'string',
  statusPresent: 'boolean',
  deliveryDatePresent: 'boolean',
}

export const shipmentLifecycleEventFactDocs: Record<string, string> = {
  idPresent: 'True when the event carries a shipment id.',
  brand:
    'The reference brand code, UPPER-CASED; empty string when absent. Compare with `in`/`nin` to enforce your own brand vocabulary — the floor bakes in none.',
  brandPresent: 'True when a reference brand code is present.',
  status:
    'The lifecycle status, UPPER-CASED; empty string when absent. Value sets are partner business rules, so author them in the overlay.',
  statusPresent: 'True when a lifecycle status is present.',
  deliveryDatePresent: 'True when an actual delivery date is present.',
}

export function deriveShipmentLifecycleEventFacts(
  ctx: CanonicalContext<ShipmentLifecycleEvent>,
): Facts {
  const { order } = ctx
  const brand = order.Reference?.Brand
  const status = order.Lifecycle?.Status
  return {
    idPresent: has(order.Id),
    brand: has(brand) ? String(brand).toUpperCase() : '',
    brandPresent: has(brand),
    status: has(status) ? String(status).toUpperCase() : '',
    statusPresent: has(status),
    deliveryDatePresent: has(order.Dates?.Delivery?.Actual),
  }
}

export const shipmentLifecycleEventFloor: TypeFloor = {
  floor: SHIPMENT_LIFECYCLE_EVENT_FLOOR,
  structuralContract: ShipmentLifecycleEventSchema,
  // No inputFieldRoots: a partner-neutral floor can't know each partner's native
  // field names — the overlay mapping is checked only against the canonical targets.
  deriveFacts: deriveShipmentLifecycleEventFacts,
  factCatalog: shipmentLifecycleEventFactCatalog,
  factDocs: shipmentLifecycleEventFactDocs,
  defaultAction: 'save',
  // Natural key {Brand}:{Number}:{Year} (0026 landing-zone convention).
  projection: {
    entityType: 'shipment',
    key: (o) => {
      const ref = (o?.Reference ?? {}) as Record<string, unknown>
      const brand = typeof ref['Brand'] === 'string' ? ref['Brand'] : '?'
      const num = typeof ref['Number'] === 'string' ? ref['Number'] : null
      const year = typeof ref['Year'] === 'string' ? ref['Year'] : '?'
      return num ? `${brand}:${num}:${year}` : null
    },
  },
}
