// ---------------------------------------------------------------------------
// Billing handler — generate invoice from move, record payment, get invoice
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { calculateInvoiceBalance } from '@pegasus/domain'
import type { AppEnv } from '../types'
import {
  findMoveById,
  findAcceptedQuoteByMoveId,
  findInvoiceByMoveId,
  findInvoiceById,
  listInvoices,
  countInvoices,
  createInvoice,
  recordPayment,
} from '../repositories'

const GenerateInvoiceBody = z.object({
  moveId: z.string().min(1),
  dueAt: z.string().datetime().optional(),
})

const RecordPaymentBody = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1).optional(),
  method: z.enum(['CARD', 'BANK_TRANSFER', 'CASH', 'CHECK']),
  paidAt: z.string().datetime().optional(),
  reference: z.string().min(1).optional(),
})

export const billingHandler = new Hono<AppEnv>()

billingHandler.post(
  '/',
  validator('json', (value, c) => {
    const r = GenerateInvoiceBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')
    const { moveId } = body

    const move = await findMoveById(db, moveId)
    if (!move) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)

    const existing = await findInvoiceByMoveId(db, moveId)
    if (existing) {
      return c.json({ error: 'Invoice already exists for this move', code: 'CONFLICT' }, 409)
    }

    const quote = await findAcceptedQuoteByMoveId(db, moveId)
    if (!quote) {
      return c.json(
        { error: 'No accepted quote found for this move', code: 'PRECONDITION_FAILED' },
        422,
      )
    }

    const invoice = await createInvoice(db, tenantId, {
      moveId,
      totalAmount: quote.price.amount,
      totalCurrency: quote.price.currency,
      quoteId: quote.id,
      ...(body.dueAt !== undefined ? { dueAt: new Date(body.dueAt) } : {}),
    })

    const balance = calculateInvoiceBalance(invoice)
    return c.json({ data: { ...invoice, balance } }, 201)
  },
)

billingHandler.get('/', async (c) => {
  const db = c.get('db')
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100)
  const offset = Number(c.req.query('offset') ?? '0')
  const [data, total] = await Promise.all([
    listInvoices(db, { limit, offset }),
    countInvoices(db),
  ])
  return c.json({ data, meta: { total, count: data.length, limit, offset } })
})

billingHandler.get('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const invoice = await findInvoiceById(db, id)
  if (!invoice) return c.json({ error: 'Invoice not found', code: 'NOT_FOUND' }, 404)
  const balance = calculateInvoiceBalance(invoice)
  return c.json({ data: { ...invoice, balance } })
})

billingHandler.post(
  '/:id/payments',
  validator('json', (value, c) => {
    const r = RecordPaymentBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const invoice = await findInvoiceById(db, id)
    if (!invoice) return c.json({ error: 'Invoice not found', code: 'NOT_FOUND' }, 404)

    const updated = await recordPayment(db, {
      invoiceId: id,
      amount: body.amount,
      method: body.method,
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.paidAt !== undefined ? { paidAt: new Date(body.paidAt) } : {}),
      ...(body.reference !== undefined ? { reference: body.reference } : {}),
    })

    const balance = calculateInvoiceBalance(updated)
    return c.json({ data: { ...updated, balance } }, 201)
  },
)
