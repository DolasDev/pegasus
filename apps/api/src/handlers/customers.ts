// ---------------------------------------------------------------------------
// Customer handler — CRUD for customers and contacts
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { hasPrimaryContact } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { emitDomainEvent } from '../lib/domain-events'
import {
  createCustomer,
  findCustomerById,
  updateCustomer,
  deleteCustomer,
  createContact,
  listQuotesByCustomerId,
} from '../repositories'
import { resolveCustomerGateway } from '../gateways/customer-gateway.factory'

const ContactBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  isPrimary: z.boolean().optional(),
})

const CreateCustomerBody = z.object({
  userId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  leadSourceId: z.string().min(1).optional(),
  primaryContact: ContactBody,
})

const UpdateCustomerBody = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
})

export const customersHandler = new Hono<AppEnv>()

customersHandler.post(
  '/',
  validator('json', (value, c) => {
    const r = CreateCustomerBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')
    // The customer write and the outbox row commit atomically.
    const customer = await db.$transaction(async (tx) => {
      const created = await createCustomer(
        tx as PrismaClient,
        tenantId,
        {
          userId: body.userId,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.accountId !== undefined ? { accountId: body.accountId } : {}),
          ...(body.leadSourceId !== undefined ? { leadSourceId: body.leadSourceId } : {}),
        },
        {
          firstName: body.primaryContact.firstName,
          lastName: body.primaryContact.lastName,
          email: body.primaryContact.email,
          ...(body.primaryContact.phone !== undefined ? { phone: body.primaryContact.phone } : {}),
        },
      )
      await emitDomainEvent(tx, {
        tenantId,
        eventType: 'customer.created',
        payload: { customerId: created.id },
      })
      return created
    })
    return c.json({ data: customer }, 201)
  },
)

customersHandler.get('/', async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100)
  const offset = Number(c.req.query('offset') ?? '0')
  // Reads resolve through the gateway so a tenant flagged customerSource=pegii
  // is served from the on-prem pegII API instead of cloud Postgres. Default
  // (null/'prisma') wraps the same repository functions as before.
  const gateway = await resolveCustomerGateway(db, tenantId)
  const [data, total] = await Promise.all([
    gateway.listCustomers({ limit, offset }),
    gateway.countCustomers(),
  ])
  return c.json({ data, meta: { total, count: data.length, limit, offset } })
})

customersHandler.get('/:id', async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const gateway = await resolveCustomerGateway(db, tenantId)
  const data = await gateway.findCustomerById(id)
  if (!data) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data })
})

customersHandler.put(
  '/:id',
  validator('json', (value, c) => {
    const r = UpdateCustomerBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const data = await updateCustomer(db, id, {
      ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
      ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
    })
    if (!data) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data })
  },
)

customersHandler.delete('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const existing = await findCustomerById(db, id)
  if (!existing) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
  await deleteCustomer(db, id)
  return c.body(null, 204)
})

customersHandler.post(
  '/:id/contacts',
  validator('json', (value, c) => {
    const r = ContactBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const customer = await findCustomerById(db, id)
    if (!customer) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
    const data = await createContact(db, id, {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
    })
    return c.json({ data }, 201)
  },
)

customersHandler.get('/:customerId/quotes', async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const customerId = c.req.param('customerId')
  const gateway = await resolveCustomerGateway(db, tenantId)
  const customer = await gateway.findCustomerById(customerId)
  if (!customer) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
  // Use domain invariant to verify customer has a primary contact
  if (!hasPrimaryContact(customer)) {
    return c.json({ error: 'Customer has no primary contact', code: 'INVALID_STATE' }, 422)
  }
  const data = await listQuotesByCustomerId(db, customerId)
  return c.json({ data, meta: { count: data.length } })
})
