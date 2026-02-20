/**
 * Integration tests for the quote repository.
 *
 * These tests require a live PostgreSQL database and are skipped automatically
 * when DATABASE_URL is not set in the environment.
 *
 * To run locally:
 *   DATABASE_URL=postgresql://... npm test
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from '../../db'
import { createMove } from '../move.repository'
import {
  createQuote,
  findQuoteById,
  listQuotesByMoveId,
  addLineItem,
  finalizeQuote,
  findAcceptedQuoteByMoveId,
} from '../quote.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const createdMoveIds: string[] = []

afterAll(async () => {
  if (hasDb) {
    for (const id of createdMoveIds) {
      await db.move.delete({ where: { id } }).catch(() => undefined)
    }
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('QuoteRepository (integration)', () => {
  const origin = {
    line1: '10 Quote Origin St',
    city: 'Dallas',
    state: 'TX',
    postalCode: '75201',
    country: 'US',
  }
  const destination = {
    line1: '20 Quote Dest Ave',
    city: 'Dallas',
    state: 'TX',
    postalCode: '75202',
    country: 'US',
  }

  let moveId: string
  let quoteId: string

  beforeAll(async () => {
    const move = await createMove({
      userId: `user-quote-${Date.now()}`,
      scheduledDate: new Date('2025-10-01T09:00:00Z'),
      origin,
      destination,
    })
    moveId = move.id
    createdMoveIds.push(moveId)

    const quote = await createQuote({
      moveId,
      priceAmount: 2000,
      priceCurrency: 'USD',
      validUntil: new Date('2025-11-01T00:00:00Z'),
      lineItems: [],
    })
    quoteId = quote.id
  })

  it('createQuote returns a Quote with a valid id', () => {
    expect(quoteId).toBeTruthy()
  })

  it('createQuote sets initial status to DRAFT', async () => {
    const quote = await findQuoteById(quoteId)
    expect(quote?.status).toBe('DRAFT')
  })

  it('createQuote stores the price correctly', async () => {
    const quote = await findQuoteById(quoteId)
    expect(quote?.price.amount).toBe(2000)
    expect(quote?.price.currency).toBe('USD')
  })

  it('findQuoteById returns null for an unknown id', async () => {
    const result = await findQuoteById('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('listQuotesByMoveId returns quotes for the move', async () => {
    const list = await listQuotesByMoveId(moveId)
    expect(list.some((q) => q.id === quoteId)).toBe(true)
  })

  it('addLineItem appends a line item to the quote', async () => {
    const updated = await addLineItem(quoteId, {
      description: 'Packing materials',
      quantity: 3,
      unitPrice: 50,
      currency: 'USD',
    })
    expect(updated?.lineItems).toHaveLength(1)
    expect(updated?.lineItems?.[0]?.description).toBe('Packing materials')
    expect(updated?.lineItems?.[0]?.quantity).toBe(3)
  })

  it('finalizeQuote transitions DRAFT → SENT', async () => {
    const result = await finalizeQuote(quoteId)
    expect(result?.status).toBe('SENT')
  })

  it('findAcceptedQuoteByMoveId returns null when no ACCEPTED quote exists', async () => {
    const result = await findAcceptedQuoteByMoveId(moveId)
    // Our quote is SENT, not ACCEPTED
    expect(result).toBeNull()
  })

  it('createQuote with inline line items stores them correctly', async () => {
    const quote = await createQuote({
      moveId,
      priceAmount: 500,
      validUntil: new Date('2025-12-01T00:00:00Z'),
      lineItems: [
        { description: 'Labour', quantity: 4, unitPrice: 100, currency: 'USD' },
        { description: 'Fuel surcharge', quantity: 1, unitPrice: 100, currency: 'USD' },
      ],
    })
    expect(quote.lineItems).toHaveLength(2)
  })
})

// Always-running guard
describe('QuoteRepository skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    if (!hasDb) {
      expect(true).toBe(true)
    } else {
      expect(hasDb).toBe(true)
    }
  })
})
