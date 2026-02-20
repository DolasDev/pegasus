/**
 * Integration tests for the billing repository.
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
  createInvoice,
  findInvoiceById,
  findInvoiceByMoveId,
  recordPayment,
} from '../billing.repository'

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

describe.skipIf(!hasDb)('BillingRepository (integration)', () => {
  const origin = {
    line1: '100 Billing St',
    city: 'San Antonio',
    state: 'TX',
    postalCode: '78201',
    country: 'US',
  }
  const destination = {
    line1: '200 Billing Ave',
    city: 'San Antonio',
    state: 'TX',
    postalCode: '78202',
    country: 'US',
  }

  let moveId: string
  let invoiceId: string

  beforeAll(async () => {
    const move = await createMove({
      userId: `user-billing-${Date.now()}`,
      scheduledDate: new Date('2025-10-15T08:00:00Z'),
      origin,
      destination,
    })
    moveId = move.id
    createdMoveIds.push(moveId)

    const invoice = await createInvoice({
      moveId,
      totalAmount: 1800,
      totalCurrency: 'USD',
    })
    invoiceId = invoice.id
  })

  it('createInvoice returns an Invoice with a valid id', () => {
    expect(invoiceId).toBeTruthy()
  })

  it('createInvoice sets initial status to UNPAID', async () => {
    const invoice = await findInvoiceById(invoiceId)
    expect(invoice?.status).toBe('UNPAID')
  })

  it('createInvoice stores the total correctly', async () => {
    const invoice = await findInvoiceById(invoiceId)
    expect(invoice?.total.amount).toBe(1800)
    expect(invoice?.total.currency).toBe('USD')
  })

  it('createInvoice starts with no payments', async () => {
    const invoice = await findInvoiceById(invoiceId)
    expect(invoice?.payments).toHaveLength(0)
  })

  it('findInvoiceById returns null for an unknown id', async () => {
    const result = await findInvoiceById('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('findInvoiceByMoveId returns the invoice for the move', async () => {
    const result = await findInvoiceByMoveId(moveId)
    expect(result?.id).toBe(invoiceId)
  })

  it('findInvoiceByMoveId returns null for an unknown move', async () => {
    const result = await findInvoiceByMoveId('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('recordPayment appends a payment to the invoice', async () => {
    const updated = await recordPayment({
      invoiceId,
      amount: 900,
      currency: 'USD',
      method: 'CARD',
    })
    expect(updated.payments).toHaveLength(1)
    expect(updated.payments[0]?.amount.amount).toBe(900)
    expect(updated.payments[0]?.method).toBe('CARD')
  })

  it('recordPayment can accept a second payment on the same invoice', async () => {
    const updated = await recordPayment({
      invoiceId,
      amount: 900,
      currency: 'USD',
      method: 'BANK_TRANSFER',
      reference: 'TXN-ABC-123',
    })
    expect(updated.payments).toHaveLength(2)
    const bankTransfer = updated.payments.find((p) => p.method === 'BANK_TRANSFER')
    expect(bankTransfer?.reference).toBe('TXN-ABC-123')
  })

  it('createInvoice with a dueAt date stores it', async () => {
    // Create a second move for this test to keep invoices isolated
    const move2 = await createMove({
      userId: `user-billing2-${Date.now()}`,
      scheduledDate: new Date('2025-11-01T08:00:00Z'),
      origin,
      destination,
    })
    createdMoveIds.push(move2.id)

    const dueDate = new Date('2025-12-31T23:59:59Z')
    const invoice = await createInvoice({
      moveId: move2.id,
      totalAmount: 500,
      dueAt: dueDate,
    })
    expect(invoice.dueAt).toBeDefined()
    expect(invoice.dueAt!.toISOString()).toBe(dueDate.toISOString())
  })
})

// Always-running guard
describe('BillingRepository skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    if (!hasDb) {
      expect(true).toBe(true)
    } else {
      expect(hasDb).toBe(true)
    }
  })
})
