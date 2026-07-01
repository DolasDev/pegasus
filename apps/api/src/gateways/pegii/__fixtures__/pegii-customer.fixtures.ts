// ---------------------------------------------------------------------------
// Hand-authored PegiiCustomerDto fixtures. These let the mapper, gateway, and
// (via a stub server / BASE_OVERRIDE) the handler slice be built and tested
// BEFORE the pegII team's real API exists. Update alongside pegii-customer.dto
// when the real contract lands.
// ---------------------------------------------------------------------------

import type { PegiiCustomerDto } from '../pegii-customer.dto'

/** Happy path — company account, one primary contact, full fields. */
export const happyPathCustomer: PegiiCustomerDto = {
  accountId: 1001,
  companyName: 'Acme Relocations',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@acme.example',
  phone: '+15551230001',
  leadNumber: 'LEAD-77',
  active: true,
  contacts: [
    {
      personId: 5001,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.example',
      phone: '+15551230001',
      isPrimary: true,
    },
  ],
}

/** Missing email + no phone/company/lead — exercises the string fallbacks. */
export const missingEmailCustomer: PegiiCustomerDto = {
  accountId: 1002,
  firstName: 'Grace',
  lastName: 'Hopper',
  email: null,
  contacts: [
    { personId: 5002, firstName: 'Grace', lastName: 'Hopper', email: null, isPrimary: true },
  ],
}

/** No contacts array at all — mapper must default to []. */
export const noContactsCustomer: PegiiCustomerDto = {
  accountId: 1003,
  firstName: 'Alan',
  lastName: 'Turing',
  email: 'alan@example',
}

/**
 * Two contacts, NEITHER flagged primary — the domain invariant hasPrimaryContact
 * will be false, so callers of GET /:customerId/quotes still 422 correctly.
 */
export const noPrimaryContactCustomer: PegiiCustomerDto = {
  accountId: 1004,
  firstName: 'Katherine',
  lastName: 'Johnson',
  email: 'kj@example',
  contacts: [
    {
      personId: 5003,
      firstName: 'Katherine',
      lastName: 'Johnson',
      email: 'kj@example',
      isPrimary: false,
    },
    {
      personId: 5004,
      firstName: 'Dorothy',
      lastName: 'Vaughan',
      email: 'dv@example',
      isPrimary: false,
    },
  ],
}

/** A small list used by list/count gateway tests. */
export const customerList: PegiiCustomerDto[] = [
  happyPathCustomer,
  missingEmailCustomer,
  noContactsCustomer,
]
