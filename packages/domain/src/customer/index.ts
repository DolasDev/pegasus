// ---------------------------------------------------------------------------
// Customer bounded context
// Manages contacts, accounts, and the lead sources that brought them in.
// ---------------------------------------------------------------------------

import type { Brand, UserId } from '../shared/types'

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

/** Uniquely identifies a Customer aggregate. */
export type CustomerId = Brand<string, 'CustomerId'>

/** Uniquely identifies a Contact within a Customer. */
export type ContactId = Brand<string, 'ContactId'>

/** Uniquely identifies a marketing LeadSource. */
export type LeadSourceId = Brand<string, 'LeadSourceId'>

/** Uniquely identifies a billing Account. */
export type AccountId = Brand<string, 'AccountId'>

export const toCustomerId = (raw: string): CustomerId => raw as CustomerId
export const toContactId = (raw: string): ContactId => raw as ContactId
export const toLeadSourceId = (raw: string): LeadSourceId => raw as LeadSourceId
export const toAccountId = (raw: string): AccountId => raw as AccountId

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/**
 * The marketing channel or referral that generated the customer lead.
 */
export interface LeadSource {
  readonly id: LeadSourceId
  readonly name: string
  readonly description?: string
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * An individual person associated with a Customer.
 * One contact must be designated as primary for all communications.
 *
 * @invariant At least one Contact per Customer must have `isPrimary: true`.
 */
export interface Contact {
  readonly id: ContactId
  readonly customerId: CustomerId
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone?: string
  /** True for the single contact that receives all primary communications. */
  readonly isPrimary: boolean
}

/**
 * The Customer aggregate root.
 *
 * A Customer represents a household or business requesting moving services.
 * Every customer is linked to a platform user and optionally to a billing
 * Account (for corporate/repeat clients).
 *
 * @invariant `contacts` must contain exactly one entry with `isPrimary: true`.
 */
export interface Customer {
  readonly id: CustomerId
  /** Platform user that owns or manages this customer record. */
  readonly userId: UserId
  readonly accountId?: AccountId
  readonly leadSourceId?: LeadSourceId
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone?: string
  readonly contacts: readonly Contact[]
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * Returns true when the customer has exactly one primary contact.
 */
export function hasPrimaryContact(customer: Customer): boolean {
  return customer.contacts.filter((c) => c.isPrimary).length === 1
}
