import type { PrismaClient, Prisma } from '@prisma/client'
import type { Quote, QuoteLineItem } from '@pegasus/domain'
import { toQuoteId, toQuoteLineItemId, toMoveId, toRateTableId } from '@pegasus/domain'

// ---------------------------------------------------------------------------
// Include shape
// ---------------------------------------------------------------------------

const quoteInclude = { lineItems: true } satisfies Prisma.QuoteInclude

type RawQuote = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>
type RawLineItem = RawQuote['lineItems'][number]

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapLineItem(row: RawLineItem): QuoteLineItem {
  return {
    id: toQuoteLineItemId(row.id),
    quoteId: toQuoteId(row.quoteId),
    description: row.description,
    quantity: row.quantity,
    unitPrice: { amount: Number(row.unitPrice), currency: row.currency },
  }
}

function mapQuote(row: RawQuote): Quote {
  return {
    id: toQuoteId(row.id),
    moveId: toMoveId(row.moveId),
    status: row.status,
    price: { amount: Number(row.priceAmount), currency: row.priceCurrency },
    validUntil: row.validUntil,
    createdAt: row.createdAt,
    lineItems: row.lineItems.map(mapLineItem),
    ...(row.rateTableId != null ? { rateTableId: toRateTableId(row.rateTableId) } : {}),
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export type CreateQuoteInput = {
  moveId: string
  priceAmount: number
  priceCurrency?: string
  validUntil: Date
  rateTableId?: string
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; currency?: string }>
}

export async function createQuote(db: PrismaClient, tenantId: string, input: CreateQuoteInput): Promise<Quote> {
  const row = await db.quote.create({
    data: {
      tenantId,
      moveId: input.moveId,
      priceAmount: input.priceAmount,
      priceCurrency: input.priceCurrency ?? 'USD',
      validUntil: input.validUntil,
      ...(input.rateTableId != null ? { rateTableId: input.rateTableId } : {}),
      lineItems: {
        create: input.lineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          currency: li.currency ?? 'USD',
        })),
      },
    },
    include: quoteInclude,
  })
  return mapQuote(row)
}

export async function findQuoteById(db: PrismaClient, id: string): Promise<Quote | null> {
  const row = await db.quote.findUnique({ where: { id }, include: quoteInclude })
  return row ? mapQuote(row) : null
}

export async function listQuotesByMoveId(db: PrismaClient, moveId: string): Promise<Quote[]> {
  const rows = await db.quote.findMany({
    where: { moveId },
    include: quoteInclude,
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(mapQuote)
}

/** Lists all quotes for every move belonging to a given customer. */
export async function listQuotesByCustomerId(db: PrismaClient, customerId: string): Promise<Quote[]> {
  const rows = await db.quote.findMany({
    where: { move: { customerId } },
    include: quoteInclude,
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(mapQuote)
}

export async function listQuotes(
  db: PrismaClient,
  opts: { limit?: number; offset?: number } = {},
): Promise<Quote[]> {
  const rows = await db.quote.findMany({
    include: quoteInclude,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 50,
    skip: opts.offset ?? 0,
  })
  return rows.map(mapQuote)
}

export async function findAcceptedQuoteByMoveId(db: PrismaClient, moveId: string): Promise<Quote | null> {
  const row = await db.quote.findFirst({
    where: { moveId, status: 'ACCEPTED' },
    include: quoteInclude,
  })
  return row ? mapQuote(row) : null
}

export type AddLineItemInput = {
  description: string
  quantity: number
  unitPrice: number
  currency?: string
}

/** Appends a line item to an existing quote. Returns the updated quote, or null if not found. */
export async function addLineItem(
  db: PrismaClient,
  quoteId: string,
  input: AddLineItemInput,
): Promise<Quote | null> {
  const exists = await db.quote.findUnique({ where: { id: quoteId }, select: { id: true } })
  if (!exists) return null
  await db.quoteLineItem.create({
    data: {
      quoteId,
      description: input.description,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      currency: input.currency ?? 'USD',
    },
  })
  return findQuoteById(db, quoteId)
}

/** Transitions a DRAFT quote to SENT status. Returns the updated quote, or null if not found. */
export async function finalizeQuote(db: PrismaClient, id: string): Promise<Quote | null> {
  const exists = await db.quote.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return null
  await db.quote.update({ where: { id }, data: { status: 'SENT' } })
  return findQuoteById(db, id)
}
