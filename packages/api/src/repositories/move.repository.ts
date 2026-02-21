import type { PrismaClient, Prisma } from '@prisma/client'
import type { Move, Stop, MoveStatus } from '@pegasus/domain'
import {
  toMoveId,
  toStopId,
  toUserId,
  toCustomerId,
  toCrewMemberId,
  toVehicleId,
  toAddressId,
} from '@pegasus/domain'

// ---------------------------------------------------------------------------
// Include shape
// ---------------------------------------------------------------------------

const moveInclude = {
  origin: true,
  destination: true,
  stops: { include: { address: true }, orderBy: { sequence: 'asc' as const } },
  crewAssignments: true,
  vehicleAssignments: true,
} satisfies Prisma.MoveInclude

type RawMove = Prisma.MoveGetPayload<{ include: typeof moveInclude }>
type RawStop = RawMove['stops'][number]

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapStop(row: RawStop): Stop {
  return {
    id: toStopId(row.id),
    moveId: toMoveId(row.moveId),
    type: row.type,
    sequence: row.sequence,
    address: {
      id: toAddressId(row.address.id),
      line1: row.address.line1,
      city: row.address.city,
      state: row.address.state,
      postalCode: row.address.postalCode,
      country: row.address.country,
      ...(row.address.line2 != null ? { line2: row.address.line2 } : {}),
    },
    ...(row.scheduledAt != null ? { scheduledAt: row.scheduledAt } : {}),
    ...(row.arrivedAt != null ? { arrivedAt: row.arrivedAt } : {}),
    ...(row.departedAt != null ? { departedAt: row.departedAt } : {}),
    ...(row.notes != null ? { notes: row.notes } : {}),
  }
}

function mapMove(row: RawMove): Move {
  return {
    id: toMoveId(row.id),
    userId: toUserId(row.userId),
    status: row.status,
    origin: {
      id: toAddressId(row.origin.id),
      line1: row.origin.line1,
      city: row.origin.city,
      state: row.origin.state,
      postalCode: row.origin.postalCode,
      country: row.origin.country,
      ...(row.origin.line2 != null ? { line2: row.origin.line2 } : {}),
    },
    destination: {
      id: toAddressId(row.destination.id),
      line1: row.destination.line1,
      city: row.destination.city,
      state: row.destination.state,
      postalCode: row.destination.postalCode,
      country: row.destination.country,
      ...(row.destination.line2 != null ? { line2: row.destination.line2 } : {}),
    },
    scheduledDate: row.scheduledDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    stops: row.stops.map(mapStop),
    assignedCrewIds: row.crewAssignments.map((a) => toCrewMemberId(a.crewMemberId)),
    assignedVehicleIds: row.vehicleAssignments.map((a) => toVehicleId(a.vehicleId)),
    ...(row.customerId != null ? { customerId: toCustomerId(row.customerId) } : {}),
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export type CreateMoveInput = {
  userId: string
  customerId?: string
  scheduledDate: Date
  origin: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string }
  destination: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string }
}

export async function createMove(db: PrismaClient, tenantId: string, input: CreateMoveInput): Promise<Move> {
  // Use the relation-based "connect" for customerId to stay in MoveCreateInput
  // territory (required when also using nested relation creates for addresses).
  // Use relation-based inputs (MoveCreateInput) throughout to avoid the
  // Without<> constraint conflict with exactOptionalPropertyTypes.
  // tenant/customer/origin/destination all use { connect } or { create } forms.
  const row = await db.move.create({
    data: {
      tenant: { connect: { id: tenantId } },
      userId: input.userId,
      scheduledDate: input.scheduledDate,
      origin: { create: { ...input.origin } },
      destination: { create: { ...input.destination } },
      ...(input.customerId != null
        ? { customer: { connect: { id: input.customerId } } }
        : {}),
    },
    include: moveInclude,
  })
  return mapMove(row)
}

export async function findMoveById(db: PrismaClient, id: string): Promise<Move | null> {
  const row = await db.move.findUnique({ where: { id }, include: moveInclude })
  return row ? mapMove(row) : null
}

export async function listMovesByStatus(db: PrismaClient, status: MoveStatus): Promise<Move[]> {
  const rows = await db.move.findMany({
    where: { status },
    include: moveInclude,
    orderBy: { scheduledDate: 'asc' },
  })
  return rows.map(mapMove)
}

export async function updateMoveStatus(db: PrismaClient, id: string, status: MoveStatus): Promise<Move | null> {
  // Update then re-fetch with full includes so the mapper has all required fields.
  await db.move.update({ where: { id }, data: { status } })
  return findMoveById(db, id)
}

/** Lists all moves, ordered by scheduled date ascending, with optional pagination. */
export async function listMoves(
  db: PrismaClient,
  opts: { limit?: number; offset?: number } = {},
): Promise<Move[]> {
  const rows = await db.move.findMany({
    include: moveInclude,
    orderBy: { scheduledDate: 'asc' },
    take: opts.limit ?? 50,
    skip: opts.offset ?? 0,
  })
  return rows.map(mapMove)
}

/** Assigns a crew member to a move. Idempotent — duplicate assignments are ignored. */
export async function assignCrewMember(
  db: PrismaClient,
  moveId: string,
  crewMemberId: string,
): Promise<Move | null> {
  const move = await db.move.findUnique({ where: { id: moveId }, select: { id: true } })
  if (!move) return null
  await db.moveCrewAssignment.upsert({
    where: { moveId_crewMemberId: { moveId, crewMemberId } },
    create: { moveId, crewMemberId },
    update: {},
  })
  return findMoveById(db, moveId)
}

/** Assigns a vehicle to a move. Idempotent — duplicate assignments are ignored. */
export async function assignVehicle(
  db: PrismaClient,
  moveId: string,
  vehicleId: string,
): Promise<Move | null> {
  const move = await db.move.findUnique({ where: { id: moveId }, select: { id: true } })
  if (!move) return null
  await db.moveVehicleAssignment.upsert({
    where: { moveId_vehicleId: { moveId, vehicleId } },
    create: { moveId, vehicleId },
    update: {},
  })
  return findMoveById(db, moveId)
}
