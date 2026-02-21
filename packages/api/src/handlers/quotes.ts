// ---------------------------------------------------------------------------
// Quotes handler — create quote, add line items, finalize, retrieve
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { canFinalizeQuote } from '@pegasus/domain'
import {
  createQuote,
  findQuoteById,
  listQuotes,
  addLineItem,
  finalizeQuote,
} from '../repositories'

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  currency: z.string().min(1).optional(),
})

const CreateQuoteBody = z.object({
  moveId: z.string().min(1),
  priceAmount: z.number().positive(),
  priceCurrency: z.string().min(1).optional(),
  validUntil: z.string().datetime(),
  rateTableId: z.string().min(1).optional(),
  lineItems: z.array(LineItemSchema).optional().default([]),
})

const AddLineItemBody = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  currency: z.string().min(1).optional(),
})

export const quotesHandler = new Hono()

quotesHandler.post(
  '/',
  validator('json', (value, c) => {
    const r = CreateQuoteBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    try {
      const body = c.req.valid('json')
      const data = await createQuote({
        moveId: body.moveId,
        priceAmount: body.priceAmount,
        validUntil: new Date(body.validUntil),
        lineItems: body.lineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          ...(li.currency !== undefined ? { currency: li.currency } : {}),
        })),
        ...(body.priceCurrency !== undefined ? { priceCurrency: body.priceCurrency } : {}),
        ...(body.rateTableId !== undefined ? { rateTableId: body.rateTableId } : {}),
      })
      return c.json({ data }, 201)
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

quotesHandler.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100)
  const offset = Number(c.req.query('offset') ?? '0')
  try {
    const data = await listQuotes({ limit, offset })
    return c.json({ data, meta: { count: data.length, limit, offset } })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

quotesHandler.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const data = await findQuoteById(id)
    if (!data) return c.json({ error: 'Quote not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

quotesHandler.post(
  '/:id/line-items',
  validator('json', (value, c) => {
    const r = AddLineItemBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const id = c.req.param('id')
    try {
      const body = c.req.valid('json')
      const quote = await findQuoteById(id)
      if (!quote) return c.json({ error: 'Quote not found', code: 'NOT_FOUND' }, 404)
      if (quote.status !== 'DRAFT') {
        return c.json(
          { error: 'Line items can only be added to DRAFT quotes', code: 'INVALID_STATE' },
          422,
        )
      }
      const data = await addLineItem(id, {
        description: body.description,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
      })
      return c.json({ data }, 201)
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

quotesHandler.post('/:id/finalize', async (c) => {
  const id = c.req.param('id')
  try {
    const quote = await findQuoteById(id)
    if (!quote) return c.json({ error: 'Quote not found', code: 'NOT_FOUND' }, 404)
    if (quote.status !== 'DRAFT') {
      return c.json(
        { error: 'Only DRAFT quotes can be finalized', code: 'INVALID_STATE' },
        422,
      )
    }
    if (!canFinalizeQuote(quote)) {
      return c.json(
        { error: 'Quote must have at least one line item before finalizing', code: 'INVALID_STATE' },
        422,
      )
    }
    const data = await finalizeQuote(id)
    return c.json({ data })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})
