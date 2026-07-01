// ---------------------------------------------------------------------------
// pegII → domain mapper — the anti-corruption layer that translates a
// PegiiCustomerDto (legacy shape) into a @pegasus/domain Customer aggregate.
//
// Structurally parallel to mapCustomer/mapContact in
// repositories/customer.repository.ts, but sourced from the pegII DTO instead
// of a Prisma row. Along with pegii-customer.dto.ts, this is the single point
// of change when the real pegII contract firms up.
//
// pegII gaps handled here (until the real contract specifies them):
//   - missing email      → '' (the domain Customer/Contact require a string)
//   - missing contacts   → []
//   - no audit timestamps → epoch (new Date(0))
//   - no cloud userId    → caller-injected placeholder (pegII has no concept of
//                          the cloud's owning platform user)
// ---------------------------------------------------------------------------

import type { Customer, Contact } from '@pegasus/domain'
import { toCustomerId, toContactId, toUserId, toAccountId, toLeadSourceId } from '@pegasus/domain'
import type { PegiiCustomerDto, PegiiContactDto } from './pegii-customer.dto'

function mapPegiiContact(dto: PegiiContactDto, customerId: string): Contact {
  return {
    id: toContactId(String(dto.personId)),
    customerId: toCustomerId(customerId),
    firstName: dto.firstName,
    lastName: dto.lastName,
    email: dto.email ?? '',
    isPrimary: dto.isPrimary,
    ...(dto.phone != null ? { phone: dto.phone } : {}),
  }
}

/**
 * Map a pegII customer DTO onto the domain Customer aggregate.
 *
 * @param placeholderUserId injected owning-user id — pegII has no cloud user
 *   concept, so callers pass a synthetic value (e.g. 'pegii-system').
 */
export function mapPegiiCustomerToDomain(
  dto: PegiiCustomerDto,
  placeholderUserId: string,
): Customer {
  const id = String(dto.accountId)
  return {
    id: toCustomerId(id),
    userId: toUserId(placeholderUserId),
    firstName: dto.firstName,
    lastName: dto.lastName,
    email: dto.email ?? '',
    contacts: (dto.contacts ?? []).map((c) => mapPegiiContact(c, id)),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...(dto.phone != null ? { phone: dto.phone } : {}),
    ...(dto.companyName != null ? { accountId: toAccountId(id) } : {}),
    ...(dto.leadNumber != null ? { leadSourceId: toLeadSourceId(String(dto.leadNumber)) } : {}),
  }
}
