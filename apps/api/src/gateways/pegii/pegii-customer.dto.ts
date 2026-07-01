// ---------------------------------------------------------------------------
// pegII Customer DTO — the typed anti-corruption boundary for the legacy pegII
// team's forthcoming "true domain layer" Customer resource(s).
//
// ⚠️ PROVISIONAL CONTRACT. The pegII team's API is still being defined. These
// field names are best-effort guesses informed by this repo's own legacy field
// vocabulary (see handlers/pegii/domains/{account,person,lead}.ts): account
// company/name/agent_id, People organization_id, leads lead_number/source_code.
// They are NOT a confirmed contract.
//
// This file and pegii-customer.mapper.ts are the ONLY two files that should
// need to change shape-wise when the real contract lands. Everything downstream
// (gateway, factory, handler) is insulated from the DTO shape.
// ---------------------------------------------------------------------------

/** A single contact/person attached to a pegII customer/account. */
export interface PegiiContactDto {
  personId: string | number
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  isPrimary: boolean
}

/** A pegII customer, flattened from the legacy Account/Person/Lead trio. */
export interface PegiiCustomerDto {
  /** Legacy account id — becomes the domain Customer id. */
  accountId: string | number
  companyName?: string | null
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  /** Legacy lead number — becomes the domain leadSourceId when present. */
  leadNumber?: string | number | null
  active?: boolean
  contacts?: PegiiContactDto[]
}
