import type { Prisma } from '@prisma/client'
import type { Customer, Contact } from '@pegasus/domain'
import {
  toCustomerId,
  toContactId,
  toUserId,
  toAccountId,
  toLeadSourceId,
} from '@pegasus/domain'
import { db } from '../db'

// ---------------------------------------------------------------------------
// Include shape used in all customer queries
// ---------------------------------------------------------------------------

const customerInclude = { contacts: true } satisfies Prisma.CustomerInclude

type RawCustomer = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>
type RawContact = RawCustomer['contacts'][number]

// ---------------------------------------------------------------------------
// Mappers — Prisma types → domain types
// ---------------------------------------------------------------------------

function mapContact(row: RawContact): Contact {
  return {
    id: toContactId(row.id),
    customerId: toCustomerId(row.customerId),
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    isPrimary: row.isPrimary,
    ...(row.phone != null ? { phone: row.phone } : {}),
  }
}

function mapCustomer(row: RawCustomer): Customer {
  return {
    id: toCustomerId(row.id),
    userId: toUserId(row.userId),
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    contacts: row.contacts.map(mapContact),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.phone != null ? { phone: row.phone } : {}),
    ...(row.accountId != null ? { accountId: toAccountId(row.accountId) } : {}),
    ...(row.leadSourceId != null ? { leadSourceId: toLeadSourceId(row.leadSourceId) } : {}),
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export type CreateCustomerInput = {
  userId: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  accountId?: string
  leadSourceId?: string
}

export type CreateContactInput = {
  firstName: string
  lastName: string
  email: string
  phone?: string
  isPrimary?: boolean
}

/** Persists a new customer together with an initial primary contact. */
export async function createCustomer(
  input: CreateCustomerInput,
  primaryContact: CreateContactInput,
): Promise<Customer> {
  const row = await db.customer.create({
    data: {
      userId: input.userId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      ...(input.phone != null ? { phone: input.phone } : {}),
      ...(input.accountId != null ? { accountId: input.accountId } : {}),
      ...(input.leadSourceId != null ? { leadSourceId: input.leadSourceId } : {}),
      contacts: {
        create: {
          firstName: primaryContact.firstName,
          lastName: primaryContact.lastName,
          email: primaryContact.email,
          isPrimary: true,
          ...(primaryContact.phone != null ? { phone: primaryContact.phone } : {}),
        },
      },
    },
    include: customerInclude,
  })
  return mapCustomer(row)
}

/** Returns a customer by ID, including all contacts. Returns null if not found. */
export async function findCustomerById(id: string): Promise<Customer | null> {
  const row = await db.customer.findUnique({ where: { id }, include: customerInclude })
  return row ? mapCustomer(row) : null
}

/** Returns a customer by email address. Returns null if not found. */
export async function findCustomerByEmail(email: string): Promise<Customer | null> {
  const row = await db.customer.findUnique({ where: { email }, include: customerInclude })
  return row ? mapCustomer(row) : null
}

/** Lists all customers, newest first. */
export async function listCustomers(opts: { limit?: number; offset?: number } = {}): Promise<Customer[]> {
  const rows = await db.customer.findMany({
    include: customerInclude,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 50,
    skip: opts.offset ?? 0,
  })
  return rows.map(mapCustomer)
}

/** Deletes a customer and all cascading records. Used only in tests. */
export async function deleteCustomer(id: string): Promise<void> {
  await db.customer.delete({ where: { id } })
}

export type UpdateCustomerInput = {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
}

/** Updates mutable fields on a customer. Returns null if not found. */
export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer | null> {
  const exists = await db.customer.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return null
  await db.customer.update({
    where: { id },
    data: {
      ...(input.firstName != null ? { firstName: input.firstName } : {}),
      ...(input.lastName != null ? { lastName: input.lastName } : {}),
      ...(input.email != null ? { email: input.email } : {}),
      ...(input.phone != null ? { phone: input.phone } : {}),
    },
  })
  return findCustomerById(id)
}

/** Adds a new contact to an existing customer. */
export async function createContact(customerId: string, input: CreateContactInput): Promise<Contact> {
  const row = await db.contact.create({
    data: {
      customerId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      isPrimary: input.isPrimary ?? false,
      ...(input.phone != null ? { phone: input.phone } : {}),
    },
  })
  return {
    id: toContactId(row.id),
    customerId: toCustomerId(row.customerId),
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    isPrimary: row.isPrimary,
    ...(row.phone != null ? { phone: row.phone } : {}),
  }
}
