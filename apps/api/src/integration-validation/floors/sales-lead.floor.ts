// ---------------------------------------------------------------------------
// sales_lead — a per-TYPE integration floor (sdk-feedback 0024) for a sales
// LEAD / opportunity: a prospective move with a contact, addresses, a move
// profile, a status, and free-form notes/activities. PARTNER-NEUTRAL — any lead
// source (Sirva ADE Lead/Opportunity is the first) builds on this floor.
//
// Exposes only GENERIC facts (presence + raw values). Partner value sets (which
// statuses, which phone types) live in the overlay's rules.json via `nin`.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { CanonicalContext, TypeFloor } from '../types'
import type { Facts, FactCatalog } from '../rules/types'

export const SALES_LEAD_FLOOR = 'sales_lead'

const optStr = z.string().nullish()
const optNum = z.number().nullish()

const PlaceSchema = z.object({
  Address: optStr,
  City: optStr,
  State: optStr,
  PostalCode: optStr,
  Country: optStr,
})
const NoteSchema = z.object({
  RowId: optStr,
  Note: optStr,
  Source: optStr,
  DateTime: optStr,
  CreatedBy: optStr,
})
const ActivitySchema = z.object({
  RowId: optStr,
  Description: optStr,
  AssignedTo: optStr,
  Type: optStr,
  StartDate: optStr,
  EndDate: optStr,
  Duration: optNum,
  Status: optStr,
})

// Every section is optional: a partner-neutral floor accepts a config that maps
// only the fields it cares about.
export const SalesLeadSchema = z.object({
  Id: optStr,
  Reference: z
    .object({ LeadId: optStr, OpportunityId: optStr, ExternalReference: optStr, Brand: optStr })
    .nullish(),
  Status: optStr,
  Disposition: optStr,
  Contact: z
    .object({
      FirstName: optStr,
      LastName: optStr,
      Email: optStr,
      PrimaryPhoneType: optStr,
      Phone: z.object({ Home: optStr, Work: optStr, Cell: optStr }).nullish(),
    })
    .nullish(),
  Addresses: z.object({ Origin: PlaceSchema, Destination: PlaceSchema }).nullish(),
  MoveProfile: z
    .object({
      MoveType: optStr,
      RequestedMoveDate: optStr,
      ExpectedDeliveryDate: optStr,
      BusinessChannel: optStr,
    })
    .nullish(),
  Notes: z.array(NoteSchema).nullish(),
  Activities: z.array(ActivitySchema).nullish(),
})

export type SalesLead = z.infer<typeof SalesLeadSchema>

const has = (v: string | null | undefined): boolean => v != null && v !== ''

export const salesLeadFactCatalog: FactCatalog = {
  idPresent: 'boolean',
  status: 'string',
  statusPresent: 'boolean',
  primaryPhoneType: 'string',
  primaryPhoneTypePresent: 'boolean',
}

export const salesLeadFactDocs: Record<string, string> = {
  idPresent: 'True when the lead carries an id.',
  status:
    'The lead status, verbatim (NOT case-folded); empty string when absent. Compare with `in`/`nin` to enforce your own status vocabulary.',
  statusPresent: 'True when a lead status is present.',
  primaryPhoneType:
    'The primary phone type, verbatim (e.g. "Cell"); empty string when absent. The floor bakes in no picklist.',
  primaryPhoneTypePresent: 'True when a primary phone type is present.',
}

export function deriveSalesLeadFacts(ctx: CanonicalContext<SalesLead>): Facts {
  const { order } = ctx
  const status = order.Status
  const phoneType = order.Contact?.PrimaryPhoneType
  return {
    idPresent: has(order.Id),
    status: has(status) ? String(status) : '',
    statusPresent: has(status),
    primaryPhoneType: has(phoneType) ? String(phoneType) : '',
    primaryPhoneTypePresent: has(phoneType),
  }
}

export const salesLeadFloor: TypeFloor = {
  floor: SALES_LEAD_FLOOR,
  structuralContract: SalesLeadSchema,
  deriveFacts: deriveSalesLeadFacts,
  factCatalog: salesLeadFactCatalog,
  factDocs: salesLeadFactDocs,
  defaultAction: 'save',
  // Natural key {OpportunityId||LeadId} (0026).
  projection: {
    entityType: 'lead',
    key: (o) => {
      const ref = (o?.Reference ?? {}) as Record<string, unknown>
      const opp = typeof ref['OpportunityId'] === 'string' ? ref['OpportunityId'] : null
      const lead = typeof ref['LeadId'] === 'string' ? ref['LeadId'] : null
      return opp || lead || null
    },
  },
}
