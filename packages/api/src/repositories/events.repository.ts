// ---------------------------------------------------------------------------
// Events repository — CRUD for PegasusEvent (integration event queue)
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Include shape & raw type
// ---------------------------------------------------------------------------

const eventSelect = {
  id: true,
  tenantId: true,
  eventApiId: true,
  eventType: true,
  eventDatetime: true,
  eventStatus: true,
  eventPublisher: true,
  eventData: true,
  receivedAt: true,
  processedAt: true,
} satisfies Prisma.PegasusEventSelect

type RawEvent = Prisma.PegasusEventGetPayload<{ select: typeof eventSelect }>

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PegasusEventRow = RawEvent

export interface CreateEventInput {
  eventApiId: string
  eventType: string
  eventDatetime?: Date
  eventPublisher?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventData?: Record<string, any>
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

export async function createEvent(
  db: PrismaClient,
  tenantId: string,
  input: CreateEventInput,
): Promise<PegasusEventRow> {
  return db.pegasusEvent.create({
    data: {
      tenantId,
      eventApiId: input.eventApiId,
      eventType: input.eventType,
      ...(input.eventDatetime != null ? { eventDatetime: input.eventDatetime } : {}),
      ...(input.eventPublisher != null ? { eventPublisher: input.eventPublisher } : {}),
      ...(input.eventData != null ? { eventData: input.eventData } : {}),
    },
    select: eventSelect,
  })
}

export async function listEventsByType(
  db: PrismaClient,
  eventType: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<PegasusEventRow[]> {
  const limit = Math.min(opts.limit ?? 100, 500)
  const offset = opts.offset ?? 0
  return db.pegasusEvent.findMany({
    where: { eventType, eventStatus: 'NEW' },
    select: eventSelect,
    orderBy: { receivedAt: 'asc' },
    take: limit,
    skip: offset,
  })
}

export async function findEventById(
  db: PrismaClient,
  id: string,
): Promise<PegasusEventRow | null> {
  return db.pegasusEvent.findUnique({
    where: { id },
    select: eventSelect,
  })
}

export async function findEventByApiId(
  db: PrismaClient,
  eventApiId: string,
): Promise<PegasusEventRow | null> {
  return db.pegasusEvent.findUnique({
    where: { eventApiId },
    select: eventSelect,
  })
}

export async function updateEvent(
  db: PrismaClient,
  id: string,
  patch: { eventStatus?: string; processedAt?: Date | null },
): Promise<PegasusEventRow> {
  return db.pegasusEvent.update({
    where: { id },
    data: {
      ...(patch.eventStatus != null ? { eventStatus: patch.eventStatus } : {}),
      ...(patch.processedAt !== undefined ? { processedAt: patch.processedAt } : {}),
    },
    select: eventSelect,
  })
}

export async function deleteEvent(db: PrismaClient, id: string): Promise<void> {
  await db.pegasusEvent.delete({ where: { id } })
}
