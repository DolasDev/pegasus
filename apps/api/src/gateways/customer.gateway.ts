// ---------------------------------------------------------------------------
// CustomerGateway — the read seam that lets the Customer aggregate be served
// from EITHER the cloud Postgres repository OR the pegII on-prem domain API,
// selected per-tenant. See customer-gateway.factory.ts for selection.
//
// Unlike the repository functions (which are `(db, ...)`-first free functions),
// a gateway is constructed already bound to its tenant/request context — a
// pegII-backed implementation has no PrismaClient to thread through. The
// Prisma-backed implementation is a thin adapter over customer.repository.ts,
// so the existing repo functions and their callers are untouched.
//
// v1 is reads-only. Writes stay on the direct repository path (handlers keep
// calling createCustomer/updateCustomer/... from ../repositories). When the
// pegII API exposes writes, add the members below and implement them in
// pegii-customer.gateway.ts + the Prisma adapter; handler write routes then
// swap to the gateway with no new abstraction.
// ---------------------------------------------------------------------------

import type { Customer } from '@pegasus/domain'

export interface CustomerGateway {
  findCustomerById(id: string): Promise<Customer | null>
  findCustomerByEmail(email: string): Promise<Customer | null>
  listCustomers(opts?: { limit?: number; offset?: number }): Promise<Customer[]>
  countCustomers(): Promise<number>

  // --- Future write slice (declared here as the seam, not implemented in v1) ---
  // createCustomer(input: CreateCustomerInput, primaryContact: CreateContactInput): Promise<Customer>
  // updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer | null>
  // deleteCustomer(id: string): Promise<void>
  // createContact(customerId: string, input: CreateContactInput): Promise<Contact>
}
