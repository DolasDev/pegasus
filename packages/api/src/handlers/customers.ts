// ---------------------------------------------------------------------------
// Customer handler — CRUD for customers and contacts
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { hasPrimaryContact } from '@pegasus/domain'
import type { AppEnv } from '../types'
import {
  createCustomer,
  findCustomerById,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  createContact,
  listQuotesByCustomerId,
} from '../repositories'

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
    try {
      const body = c.req.valid('json')
      const customer = await createCustomer(
        db,
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
          ...(body.primaryContact.phone !== undefined
            ? { phone: body.primaryContact.phone }
            : {}),
        },
      )
      return c.json({ data: customer }, 201)
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

customersHandler.get('/', async (c) => {
  const db = c.get('db')
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100)
  const offset = Number(c.req.query('offset') ?? '0')
  try {
    const data = await listCustomers(db, { limit, offset })
    return c.json({ data, meta: { count: data.length, limit, offset } })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

customersHandler.get('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  try {
    const data = await findCustomerById(db, id)
    if (!data) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
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
    try {
      const body = c.req.valid('json')
      const data = await updateCustomer(db, id, {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
      })
      if (!data) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
      return c.json({ data })
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

customersHandler.delete('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  try {
    const existing = await findCustomerById(db, id)
    if (!existing) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
    await deleteCustomer(db, id)
    return c.body(null, 204)
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
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
    try {
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
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

customersHandler.get('/:customerId/quotes', async (c) => {
  const db = c.get('db')
  const customerId = c.req.param('customerId')
  try {
    const customer = await findCustomerById(db, customerId)
    if (!customer) return c.json({ error: 'Customer not found', code: 'NOT_FOUND' }, 404)
    // Use domain invariant to verify customer has a primary contact
    if (!hasPrimaryContact(customer)) {
      return c.json({ error: 'Customer has no primary contact', code: 'INVALID_STATE' }, 422)
    }
    const data = await listQuotesByCustomerId(db, customerId)
    return c.json({ data, meta: { count: data.length } })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})
