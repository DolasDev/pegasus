import type { Prisma } from '@prisma/client'
import type { Invoice, Payment } from '@pegasus/domain'
import { toInvoiceId, toPaymentId, toMoveId, toQuoteId } from '@pegasus/domain'
import { db } from '../db'

// ---------------------------------------------------------------------------
// Include shape
// ---------------------------------------------------------------------------

const invoiceInclude = { payments: true } satisfies Prisma.InvoiceInclude

type RawInvoice = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>
type RawPayment = RawInvoice['payments'][number]

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapPayment(row: RawPayment): Payment {
  return {
    id: toPaymentId(row.id),
    invoiceId: toInvoiceId(row.invoiceId),
    amount: { amount: Number(row.amount), currency: row.currency },
    method: row.method,
    paidAt: row.paidAt,
    ...(row.reference != null ? { reference: row.reference } : {}),
  }
}

function mapInvoice(row: RawInvoice): Invoice {
  return {
    id: toInvoiceId(row.id),
    moveId: toMoveId(row.moveId),
    status: row.status,
    total: { amount: Number(row.totalAmount), currency: row.totalCurrency },
    payments: row.payments.map(mapPayment),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.quoteId != null ? { quoteId: toQuoteId(row.quoteId) } : {}),
    ...(row.issuedAt != null ? { issuedAt: row.issuedAt } : {}),
    ...(row.dueAt != null ? { dueAt: row.dueAt } : {}),
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export type CreateInvoiceInput = {
  moveId: string
  totalAmount: number
  totalCurrency?: string
  quoteId?: string
  dueAt?: Date
}

export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const row = await db.invoice.create({
    data: {
      moveId: input.moveId,
      totalAmount: input.totalAmount,
      totalCurrency: input.totalCurrency ?? 'USD',
      ...(input.quoteId != null ? { quoteId: input.quoteId } : {}),
      ...(input.dueAt != null ? { dueAt: input.dueAt } : {}),
    },
    include: invoiceInclude,
  })
  return mapInvoice(row)
}

export async function findInvoiceById(id: string): Promise<Invoice | null> {
  const row = await db.invoice.findUnique({ where: { id }, include: invoiceInclude })
  return row ? mapInvoice(row) : null
}

export async function listInvoices(opts: { limit?: number; offset?: number } = {}): Promise<Invoice[]> {
  const rows = await db.invoice.findMany({
    include: invoiceInclude,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 50,
    skip: opts.offset ?? 0,
  })
  return rows.map(mapInvoice)
}

export async function findInvoiceByMoveId(moveId: string): Promise<Invoice | null> {
  const row = await db.invoice.findFirst({
    where: { moveId },
    include: invoiceInclude,
    orderBy: { createdAt: 'desc' },
  })
  return row ? mapInvoice(row) : null
}

export type RecordPaymentInput = {
  invoiceId: string
  amount: number
  currency?: string
  method: 'CARD' | 'BANK_TRANSFER' | 'CASH' | 'CHECK'
  paidAt?: Date
  reference?: string
}

export async function recordPayment(input: RecordPaymentInput): Promise<Invoice> {
  await db.payment.create({
    data: {
      invoiceId: input.invoiceId,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      method: input.method,
      paidAt: input.paidAt ?? new Date(),
      ...(input.reference != null ? { reference: input.reference } : {}),
    },
  })
  const row = await db.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    include: invoiceInclude,
  })
  return mapInvoice(row)
}
